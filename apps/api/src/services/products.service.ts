import { Prisma, type ProductStatus } from "@prisma/client";
import { forTenant, withTenant } from "../db/index.js";

/** Erro de validação de negócio (não 500): mensagem já pronta para a tela, em português. */
export class ProductValidationError extends Error {}

/**
 * Limite de estoque baixo, fixo pra loja toda (decisão do Lucas, spec
 * estoque-busca-filtro-preco.md §4.2 — configurável por peça é outra conversa).
 * zerado: stock === 0 · baixo: 0 < stock <= LOW_STOCK_THRESHOLD · ok: o resto.
 */
export const LOW_STOCK_THRESHOLD = 2;

/** Situação do produto na borda da API — sempre em português (spec estoque-interface-parte-1.md §5.2). */
export type ProductStatusApi = "ativo" | "inativo";

/** Filtro de situação aceito por `GET /api/products` (spec §5.3). */
export type ProductStatusFilter = "ativos" | "inativos" | "todos";

/**
 * Única tradução do enum do Prisma (`ACTIVE | ARCHIVED | DRAFT`) para a
 * situação em português exposta pela API. `DRAFT` não é usado nesta etapa
 * (spec §5.2); tratamos como "inativo" só por segurança de tipos — não deve
 * ocorrer na prática.
 */
export function productStatusToApi(status: ProductStatus): ProductStatusApi {
  return status === "ACTIVE" ? "ativo" : "inativo";
}

/** Única tradução do português da API para o enum do Prisma. */
export function apiStatusToProductStatus(status: ProductStatusApi): ProductStatus {
  return status === "ativo" ? "ACTIVE" : "ARCHIVED";
}

export interface ProductListItem {
  variantId: string;
  productId: string;
  name: string;
  sku: string | null;
  stock: number;
  price: number | null;
  cost: number | null;
  margin: number | null;
  status: ProductStatusApi;
  category: { id: string; name: string } | null;
}

export interface ProductWriteInput {
  name: string;
  sku?: string;
  price?: number;
  cost?: number;
  /** Só em criação (spec §5.3): categoria já vinculada ao nascer, opcional. */
  categoryId?: string;
}

/**
 * Corpo de `PATCH /api/products/:variantId` (spec §5.3/§5.4). Não estende
 * `ProductWriteInput`: TODOS os campos aqui usam a MESMA semântica de update
 * parcial — chave AUSENTE (`undefined`) NÃO altera o valor atual; chave
 * presente com `null` limpa (vira "—" na tela); chave presente com valor
 * grava. Vale para `sku`/`price`/`cost` também.
 *
 * A ação de inativar/reativar e a de trocar categoria podem mandar só os
 * campos que mudam, sem reenviar o resto do formulário.
 */
export interface ProductUpdateInput {
  name: string;
  /** Ausente = preserva · `null` = limpa ("—") · string = grava. */
  sku?: string | null;
  /** Ausente = preserva · `null` = limpa ("—") · number = grava. */
  price?: number | null;
  /** Ausente = preserva · `null` = limpa ("—") · number = grava. */
  cost?: number | null;
  /** Ausente = preserva · `null` = limpa ("Sem categoria") · uuid = troca. */
  categoryId?: string | null;
  /** Ausente = preserva a situação atual. */
  status?: ProductStatusApi;
}

export interface ListProductsOptions {
  /** Busca por nome do produto OU SKU da variante, case-insensitive, contains. */
  q?: string;
  /** Só itens com estoque <= LOW_STOCK_THRESHOLD (inclui zerado). Combina com `q` (E, não OU). */
  lowStock?: boolean;
  /** Padrão "ativos" (spec §5.3) — decidido na rota, mas default aqui também por segurança. */
  status?: ProductStatusFilter;
  /** uuid de uma categoria, ou "sem-categoria" (produtos com categoryId nulo). */
  categoryId?: string;
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
  product: {
    id: string;
    name: string;
    status: ProductStatus;
    category: { id: string; name: string } | null;
  };
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
    status: productStatusToApi(variant.product.status),
    category: variant.product.category,
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
 *
 * `status` (spec estoque-interface-parte-1.md §5.3) filtra por situação do
 * produto — padrão "ativos", nunca traz produto arquivado sem o caller pedir
 * explicitamente. `categoryId` filtra por categoria vinculada; o valor
 * especial "sem-categoria" filtra os produtos sem nenhuma categoria.
 */
export async function listProducts(
  tenantId: string,
  options: ListProductsOptions = {},
): Promise<ProductListItem[]> {
  const db = forTenant(tenantId);
  const { q, lowStock, categoryId } = options;
  const status = options.status ?? "ativos";

  const productConditions: Prisma.ProductWhereInput[] = [];
  if (status !== "todos") {
    productConditions.push({
      status: status === "inativos" ? "ARCHIVED" : "ACTIVE",
    });
  }
  if (categoryId === "sem-categoria") {
    productConditions.push({ categoryId: null });
  } else if (categoryId) {
    productConditions.push({ categoryId });
  }

  const conditions: Prisma.VariantWhereInput[] = [];
  if (q) {
    conditions.push({
      OR: [
        { product: { name: { contains: q, mode: "insensitive" } } },
        { sku: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (productConditions.length > 0) {
    conditions.push({ product: { AND: productConditions } });
  }

  const variants = await db.variant.findMany({
    where: conditions.length > 0 ? { AND: conditions } : undefined,
    include: {
      product: {
        select: {
          id: true,
          name: true,
          status: true,
          category: { select: { id: true, name: true } },
        },
      },
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
 *
 * `categoryId`, quando enviado, é vinculado via `category: { connect }`
 * (nunca `categoryId` escalar direto): a checagem de FOREIGN KEY do Postgres
 * NÃO respeita Row-Level Security (é um caveat documentado do Postgres — a
 * checagem de integridade referencial enxerga a linha referenciada mesmo que
 * a policy de RLS a esconda de um SELECT normal). `connect` faz o Prisma
 * resolver a categoria através de uma consulta que passa pelo RLS de verdade
 * (mesma transação, mesmo `app.tenant_id`) antes de vincular — sem isso, uma
 * loja conseguiria prender um produto seu a uma categoria de outra loja só
 * acertando o uuid, mesmo sem enxergá-la em nenhuma listagem.
 */
export async function createProduct(
  tenantId: string,
  input: ProductWriteInput,
): Promise<ProductListItem> {
  try {
    return await withTenant(tenantId, async (tx) => {
      const product = await tx.product.create({
        data: input.categoryId
          ? {
              tenant: { connect: { id: tenantId } },
              name: input.name,
              category: { connect: { id: input.categoryId } },
            }
          : {
              tenant: { connect: { id: tenantId } },
              name: input.name,
            },
        select: {
          id: true,
          name: true,
          status: true,
          category: { select: { id: true, name: true } },
        },
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
        product,
        inventoryLevels: [],
      });
    });
  } catch (error) {
    throw toProductWriteError(error);
  }
}

/**
 * Edita nome/sku/price/cost/categoria/situação de uma variante existente
 * (spec estoque-interface-parte-1.md §5.3, semântica de update PARCIAL:
 * TODO campo (sku/price/cost/categoryId/
 * status) só muda quando a chave está PRESENTE no corpo; chave ausente
 * preserva o valor atual; `null` explícito limpa (sku/price/cost viram "—",
 * categoryId vira "Sem categoria"). Nenhum campo aqui é "substituição total"
 * — quem quiser limpar precisa mandar `null` de propósito. `Product.name`
 * (via `productId` da variante) e `Variant.sku`/`price`/`cost` são
 * atualizados numa única transação (`withTenant`) — mesmo motivo do
 * `createProduct`: nunca um fica atualizado e o outro não. `productId` da
 * variante em si não é editável aqui.
 */
export async function updateProduct(
  tenantId: string,
  variantId: string,
  input: ProductUpdateInput,
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

      // Só entra no `data` quem está de fato PRESENTE no corpo: chave ausente
      // preserva o valor atual, `null` explícito limpa. Um PATCH parcial
      // (ex. `{ name, status }`) não pode tocar sku/price/cost.
      const variantUpdateData: Prisma.VariantUpdateInput = {};
      if (input.sku !== undefined) variantUpdateData.sku = input.sku;
      if (input.price !== undefined) variantUpdateData.price = input.price;
      if (input.cost !== undefined) variantUpdateData.cost = input.cost;

      const variant = await tx.variant.update({
        where: { id: variantId },
        data: variantUpdateData,
      });

      const productUpdateData: Prisma.ProductUpdateInput = { name: input.name };
      if (input.categoryId !== undefined) {
        productUpdateData.category =
          input.categoryId === null
            ? { disconnect: true }
            : { connect: { id: input.categoryId } };
      }
      if (input.status !== undefined) {
        productUpdateData.status = apiStatusToProductStatus(input.status);
      }

      const product = await tx.product.update({
        where: { id: existing.productId },
        data: productUpdateData,
        select: {
          id: true,
          name: true,
          status: true,
          category: { select: { id: true, name: true } },
        },
      });
      const inventoryLevel = await tx.inventoryLevel.findFirst({
        where: { variantId },
        select: { stock: true },
      });

      return toListItem({
        ...variant,
        product,
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
 * escapar como 500 — é o banco que já impede o dado duplicado. `categoryId`
 * apontando pra uma categoria que não existe (ou existe, mas é de outra loja
 * — RLS esconde a linha do `connect`) vira P2025 do Prisma ("registro para
 * conectar não encontrado"); tratamos como o mesmo tipo de erro amigável.
 */
function toProductWriteError(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return new ProductValidationError(
        "Esse código já está sendo usado por outro produto.",
      );
    }
    if (error.code === "P2025" || error.code === "P2003") {
      return new ProductValidationError("Categoria não encontrada.");
    }
  }
  return error;
}
