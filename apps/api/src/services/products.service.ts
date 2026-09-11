import { Prisma } from "@prisma/client";
import { forTenant, withTenant } from "../db/index.js";

/** Erro de validação de negócio (não 500): mensagem já pronta para a tela, em português. */
export class ProductValidationError extends Error {}

export interface ProductListItem {
  variantId: string;
  productId: string;
  name: string;
  sku: string | null;
  stock: number;
}

/**
 * Lista achatada (1 linha por variante — v1 é sempre 1 produto = 1 variante,
 * spec estoque-manual.md §4). `q` filtra por nome, case-insensitive, contains.
 * Variante sem nenhuma movimentação ainda não tem linha em InventoryLevel —
 * tratamos a ausência como estoque 0, nunca como erro (spec §4).
 */
export async function listProducts(
  tenantId: string,
  q?: string,
): Promise<ProductListItem[]> {
  const db = forTenant(tenantId);
  const variants = await db.variant.findMany({
    where: q
      ? { product: { name: { contains: q, mode: "insensitive" } } }
      : undefined,
    include: {
      product: { select: { id: true, name: true } },
      inventoryLevels: { select: { stock: true } },
    },
    orderBy: { product: { name: "asc" } },
  });

  return variants.map((variant) => ({
    variantId: variant.id,
    productId: variant.product.id,
    name: variant.product.name,
    sku: variant.sku,
    stock: variant.inventoryLevels[0]?.stock ?? 0,
  }));
}

/**
 * Cria produto+variante (1:1, v1 — spec §4). Nasce com saldo 0 (nenhuma linha
 * em InventoryLevel ainda). Escrita multi-passo → `withTenant` (não `forTenant`,
 * que é para 1 operação só), atômica: nunca fica um Product órfão sem Variant.
 */
export async function createProduct(
  tenantId: string,
  input: { name: string; sku?: string },
): Promise<ProductListItem> {
  try {
    return await withTenant(tenantId, async (tx) => {
      const product = await tx.product.create({
        data: { tenantId, name: input.name },
      });
      const variant = await tx.variant.create({
        data: { tenantId, productId: product.id, sku: input.sku },
      });
      return {
        variantId: variant.id,
        productId: product.id,
        name: product.name,
        sku: variant.sku,
        stock: 0,
      };
    });
  } catch (error) {
    // SKU é único por loja (@@unique([tenantId, sku])) — capturamos o erro de
    // constraint do próprio Prisma/Postgres (P2002) na escrita, não só um SELECT
    // prévio: dois cadastros com o mesmo SKU ao mesmo tempo não podem escapar
    // como 500 (spec §7) — é o banco que já impede o dado duplicado.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ProductValidationError(
        "Esse código já está sendo usado por outro produto.",
      );
    }
    throw error;
  }
}
