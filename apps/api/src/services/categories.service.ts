import { Prisma } from "@prisma/client";
import { forTenant, withTenant } from "../db/index.js";

/** Erro de validação de negócio (não 500): mensagem já pronta para a tela, em português. */
export class CategoryValidationError extends Error {}

export interface CategoryListItem {
  id: string;
  name: string;
  /** Quantas peças (produtos) estão vinculadas a esta categoria (spec §5.3). */
  productCount: number;
}

/** Nome normalizado (trim) — a comparação de duplicata em si é feita no banco (índice funcional). */
function normalizeCategoryName(name: string): string {
  return name.trim();
}

/**
 * Lista as categorias da loja em ordem alfabética, com a contagem de peças de
 * cada uma (spec estoque-interface-parte-1.md §5.3).
 */
export async function listCategories(tenantId: string): Promise<CategoryListItem[]> {
  const db = forTenant(tenantId);
  const categories = await db.category.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true } } },
  });
  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    productCount: category._count.products,
  }));
}

/**
 * Cria uma categoria. Nome repetido — ignorando maiúsculas/minúsculas e
 * espaços nas pontas, inclusive sob corrida real — responde com um erro de
 * validação amigável, nunca 500 (spec §5.3/§5.4 item 2). A defesa é o índice
 * único funcional `category_tenant_id_name_normalized_key` (migration
 * add_category): tentamos o INSERT direto e capturamos a violação (P2002),
 * mesmo padrão já usado para SKU duplicado em products.service.ts — sem
 * SELECT prévio, que teria janela de corrida.
 */
export async function createCategory(
  tenantId: string,
  name: string,
): Promise<CategoryListItem> {
  try {
    const db = forTenant(tenantId);
    const category = await db.category.create({
      data: { tenantId, name: normalizeCategoryName(name) },
    });
    return { id: category.id, name: category.name, productCount: 0 };
  } catch (error) {
    throw toCategoryWriteError(error);
  }
}

/**
 * Renomeia uma categoria existente. Mesma regra de nome duplicado da criação.
 * Sob RLS, categoria de outro tenant some da leitura — "não existe" e "é de
 * outra loja" respondem igual (mesmo padrão de updateProduct).
 */
export async function renameCategory(
  tenantId: string,
  categoryId: string,
  name: string,
): Promise<CategoryListItem> {
  try {
    return await withTenant(tenantId, async (tx) => {
      const existing = await tx.category.findFirst({ where: { id: categoryId } });
      if (!existing) {
        throw new CategoryValidationError("Categoria não encontrada.");
      }
      const updated = await tx.category.update({
        where: { id: categoryId },
        data: { name: normalizeCategoryName(name) },
      });
      const productCount = await tx.product.count({ where: { categoryId } });
      return { id: updated.id, name: updated.name, productCount };
    });
  } catch (error) {
    if (error instanceof CategoryValidationError) throw error;
    throw toCategoryWriteError(error);
  }
}

function toCategoryWriteError(error: unknown): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return new CategoryValidationError("Essa categoria já existe.");
  }
  return error;
}
