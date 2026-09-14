import { ProductCard, ProductRow } from "./product-row";
import type { CategoryItem, ProductItem } from "@/lib/api";

/**
 * A tabela é a heroína (spec §4.4). Duas marcações lado a lado — `<table>`
 * escondida abaixo de 768px, lista de `<li>` escondida a partir de 768px —
 * puramente por CSS (`hidden md:block` / `md:hidden`), sem detecção de
 * viewport em JS (spec §4.3/§6.3: "abaixo de 768px a tabela vira lista de
 * cartões").
 */

/**
 * Estado bruto da carga da lista, vindo da página. "Ainda não chegou", "não
 * deu para carregar" e "a loja não tem peça nenhuma" são três telas
 * distintas: só a última convida a cadastrar a primeira peça.
 */
export type ProductLoadState = "loading" | "failed" | "ready";

interface ProductTableProps {
  items: ProductItem[];
  loadState: ProductLoadState;
  hasAnyProduct: boolean;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  categories: CategoryItem[];
  onUpdated: (item: ProductItem) => void;
  onFeedback: (message: string, tone: "ok" | "danger") => void;
  /** Peça recém-cadastrada: rola até ela e a destaca por alguns segundos. */
  highlightedVariantId: string | null;
}

const COLUMNS = ["Peça", "Código", "Preço", "Custo", "Margem", "Estoque", "Situação", "Ações"];

export function ProductTable({
  items,
  loadState,
  hasAnyProduct,
  hasActiveFilters,
  onClearFilters,
  categories,
  onUpdated,
  onFeedback,
  highlightedVariantId,
}: ProductTableProps): JSX.Element {
  if (loadState === "loading") {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-text-muted">
        Carregando estoque...
      </div>
    );
  }

  if (loadState === "failed") {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-text-muted">
        O estoque não foi carregado. Veja a mensagem acima.
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        hasAnyProduct={hasAnyProduct}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={onClearFilters}
      />
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface md:block">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold text-text-muted">
              {COLUMNS.map((column) => (
                <th key={column} scope="col" className="p-3">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <ProductRow
                key={item.variantId}
                item={item}
                categories={categories}
                onUpdated={onUpdated}
                onFeedback={onFeedback}
                highlighted={item.variantId === highlightedVariantId}
              />
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-3 md:hidden">
        {items.map((item) => (
          <ProductCard
            key={item.variantId}
            item={item}
            categories={categories}
            onUpdated={onUpdated}
            onFeedback={onFeedback}
            highlighted={item.variantId === highlightedVariantId}
          />
        ))}
      </ul>
    </>
  );
}

function EmptyState({
  hasAnyProduct,
  hasActiveFilters,
  onClearFilters,
}: {
  hasAnyProduct: boolean;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}): JSX.Element {
  if (!hasAnyProduct) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface p-8 text-center">
        <p className="font-semibold">Nenhuma peça cadastrada ainda</p>
        <p className="text-sm text-text-muted">
          Cadastre a primeira peça pelo botão &quot;Novo produto&quot; acima.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-8 text-center">
      <p className="font-semibold">Nenhuma peça encontrada</p>
      <p className="text-sm text-text-muted">Nenhuma peça casa com o filtro atual.</p>
      {hasActiveFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className="rounded border border-border px-3 py-2 text-sm font-medium text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}
