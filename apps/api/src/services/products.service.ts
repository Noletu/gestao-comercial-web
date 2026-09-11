import { Prisma } from "@prisma/client";
import { forTenant, withTenant } from "../db/index.js";

/** Erro de validação de negócio (não 500): mensagem já pronta para a tela, em português. */
export class ProductValidationError extends Error {}

/**
 * Limite de estoque baixo, fixo pra loja toda (decisão do Lucas, spec
 * estoque-busca-filtro-preco.md §4.2 — configurável por peça é outra conversa).
 * zerado: stock === 0 · baixo: 0 < stock <= LOW_STOCK_THRESHOLD · ok: o resto.
 */
export const LOW_STOCK_THRESHOLD = 2;

export interface ProductListItem {
  variantId: string;
  productId: string;
  name: string;
  sku: string | null;
  stock: number;
  price: number | null;
  cost: number | null;
  margin: number | null;
}

export interface ProductWriteInput {
  name: string;
  sku?: string;
  price?: number;
  cost?: number;
}

export interface ListProductsOptions {
  /** Busca por nome do produto OU SKU da variante, case-insensitive, contains. */
  q?: string;
  /** Só itens com estoque <= LOW_STOCK_THRESHOLD (inclui zerado). Combina com `q` (E, não OU). */
  lowStock?: boolean;
}

/**
 * Margem = (price - cost) / price * 100, só quando os dois estão preenchidos
 * E price > 0. Qualquer outro caso (um dos dois ausente, ou price === 0) é
 * `null` — a tela mostra "—", nunca 0%, NaN ou Infinity (spec §4.3).
 */
function computeMargin(price: number | null, cost: number | null): number | null {
  if (price === null || cost === null || price <= 0) return null;
  return ((price - cost) / price) * 100;
}

function toListItem(variant: {
  id: string;
  sku: string | null;
  price: Prisma.Decimal | null;
  cost: Prisma.Decimal | null;
  product: { id: string; name: string };
  inventoryLevels: { stock: number }[];
}): ProductListItem {
  const price = variant.price !== null ? variant.price.toNumber() : null;
  const cost = variant.cost !== null ? variant.cost.toNumber() : null;
  return {
    variantId: variant.id,
    productId: variant.product.id,
    name: variant.product.name,
    sku: variant.sku,
    stock: variant.inventoryLevels[0]?.stock ?? 0,
    price,
    cost,
    margin: computeMargin(price, cost),
  };
}

/**
 * Lista achatada (1 linha por variante — v1 é sempre 1 produto = 1 variante,
 * spec estoque-manual.md §4). `q` filtra por nome do produto OU SKU da
 * variante, case-insensitive, contains (spec estoque-busca-filtro-preco.md
 * §4.1). `lowStock` filtra em memória depois de montar a lista — dataset
 * pequeno (~100-200 itens), não vale expressar isso em SQL via `having` num
 * agregado hoje lido de InventoryLevel direto (spec §4.2). Variante sem
 * nenhuma movimentação ainda não tem linha em InventoryLevel — tratamos a
 * ausência como estoque 0, nunca como erro (spec estoque-manual.md §4).
 */
export async function listProducts(
  tenantId: string,
  options: ListProductsOptions = {},
): Promise<ProductListItem[]> {
  const db = forTenant(tenantId);
  const { q, lowStock } = options;
  const variants = await db.variant.findMany({
    where: q
      ? {
          OR: [
            { product: { name: { contains: q, mode: "insensitive" } } },
            { sku: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    include: {
      product: { select: { id: true, name: true } },
      inventoryLevels: { select: { stock: true } },
    },
    orderBy: { product: { name: "asc" } },
  });

  const items = variants.map(toListItem);
  return lowStock ? items.filter((item) => item.stock <= LOW_STOCK_THRESHOLD) : items;
}

/**
 * Cria produto+variante (1:1, v1 — spec estoque-manual.md §4). Nasce com
 * saldo 0 (nenhuma linha em InventoryLevel ainda). `price`/`cost` opcionais
 * (spec estoque-busca-filtro-preco.md §4.4) — validação de "não-negativo" é
 * feita na rota via Zod, mesmo padrão dos outros campos. Escrita multi-passo
 * → `withTenant` (não `forTenant`, que é para 1 operação só), atômica: nunca
 * fica um Product órfão sem Variant.
 */
export async function createProduct(
  tenantId: string,
  input: ProductWriteInput,
): Promise<ProductListItem> {
  try {
    return await withTenant(tenantId, async (tx) => {
      const product = await tx.product.create({
        data: { tenantId, name: input.name },
      });
      const variant = await tx.variant.create({
        data: {
          tenantId,
          productId: product.id,
          sku: input.sku,
          price: input.price,
          cost: input.cost,
        },
      });
      return toListItem({
        ...variant,
        product: { id: product.id, name: product.name },
        inventoryLevels: [],
      });
    });
  } catch (error) {
    throw toProductWriteError(error);
  }
}

/**
 * Edita nome/sku/price/cost de uma variante existente (rota nova — spec
 * estoque-busca-filtro-preco.md §4.5). Semântica de substituição total: campo
 * omitido vira `null`/`undefined` no banco — não existe update parcial de
 * fato, o formulário da tela sempre envia o estado atual completo.
 * `Product.name` (via `productId` da variante) e `Variant.sku`/`price`/`cost`
 * são atualizados numa única transação (`withTenant`) — mesmo motivo do
 * `createProduct`: nunca um fica atualizado e o outro não. `productId` da
 * variante em si não é editável aqui.
 */
export async function updateProduct(
  tenantId: string,
  variantId: string,
  input: ProductWriteInput,
): Promise<ProductListItem> {
  try {
    return await withTenant(tenantId, async (tx) => {
      // Sob RLS, uma variante de outro tenant some da leitura — mesmo padrão
      // de applyStockMovement (inventory.service.ts): não vazamos existência
      // entre lojas, "não existe" e "é de outra loja" respondem igual.
      const existing = await tx.variant.findFirst({
        where: { id: variantId },
        select: { productId: true },
      });
      if (!existing) {
        throw new ProductValidationError("Produto não encontrado.");
      }

      const variant = await tx.variant.update({
        where: { id: variantId },
        data: {
          sku: input.sku ?? null,
          price: input.price ?? null,
          cost: input.cost ?? null,
        },
      });
      const product = await tx.product.update({
        where: { id: existing.productId },
        data: { name: input.name },
      });
      const inventoryLevel = await tx.inventoryLevel.findFirst({
        where: { variantId },
        select: { stock: true },
      });

      return toListItem({
        ...variant,
        product: { id: product.id, name: product.name },
        inventoryLevels: inventoryLevel ? [inventoryLevel] : [],
      });
    });
  } catch (error) {
    if (error instanceof ProductValidationError) throw error;
    throw toProductWriteError(error);
  }
}

/**
 * SKU é único por loja (@@unique([tenantId, sku])) — capturamos o erro de
 * constraint do próprio Prisma/Postgres (P2002) na escrita, não só um SELECT
 * prévio: dois cadastros/edições com o mesmo SKU ao mesmo tempo não podem
 * escapar como 500 — é o banco que já impede o dado duplicado.
 */
function toProductWriteError(error: unknown): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return new ProductValidationError(
      "Esse código já está sendo usado por outro produto.",
    );
  }
  return error;
}
