"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Modal } from "./modal";
import { CategoryManager } from "./category-manager";
import type { ProductLoadState } from "./product-table";
import { CloseIcon, FilterIcon, PlusIcon, SearchIcon } from "./icons";
import { parseOptionalNonNegativeNumber } from "@/lib/format";
import {
  apiFetchJson,
  extractErrorMessage,
  type CategoryItem,
  type ProductItem,
  type ProductStatusFilter,
} from "@/lib/api";

/**
 * Barra de busca + filtros + ações da tela de estoque (spec
 * estoque-interface-parte-1.md §6.1/§6.2).
 *
 * Busca dispara automaticamente (debounce curto) além de no Enter — a
 * referência visual não mostra um botão "Buscar" ao lado do campo, então a
 * busca-enquanto-digita é a leitura mais direta do layout. Decisão técnica
 * (interação, não regra de negócio): não muda o que a busca filtra, só
 * quando ela dispara.
 */

const SEARCH_DEBOUNCE_MS = 300;

interface FiltersBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  status: ProductStatusFilter;
  onStatusChange: (value: ProductStatusFilter) => void;
  categoryId: string | undefined;
  onCategoryChange: (value: string | undefined) => void;
  lowStockOnly: boolean;
  onToggleLowStock: (value: boolean) => void;
  categories: CategoryItem[];
  onCategoriesChange: (categories: CategoryItem[]) => void;
  onCategoryRenamed: (category: CategoryItem) => void;
  onProductCreated: (item: ProductItem) => void;
  /**
   * Cadastrar peça e gerenciar categoria só valem com a lista carregada: ver
   * `blockedReason`.
   */
  loadState: ProductLoadState;
  /**
   * Contador incrementado pela página a cada "Limpar filtros". É o COMANDO de
   * limpar, que `query` sozinho não expressa quando a busca já está vazia.
   */
  resetSignal: number;
}

/**
 * Fora de `"ready"` a tela não conhece o estoque: cadastrar criaria uma lista
 * que afirma uma peça só, e o painel de categorias mostraria uma lista vazia
 * como se a loja não tivesse categoria nenhuma. Os dois botões ficam
 * desabilitados, dizendo em qual dos dois estados a tela está.
 */
function blockedReason(loadState: ProductLoadState): string | undefined {
  if (loadState === "ready") return undefined;
  return loadState === "loading"
    ? "Carregando o estoque..."
    : "O estoque não foi carregado. Recarregue a página.";
}

export function FiltersBar({
  query,
  onQueryChange,
  status,
  onStatusChange,
  categoryId,
  onCategoryChange,
  lowStockOnly,
  onToggleLowStock,
  categories,
  onCategoriesChange,
  onCategoryRenamed,
  onProductCreated,
  loadState,
  resetSignal,
}: FiltersBarProps): JSX.Element {
  const [panelOpen, setPanelOpen] = useState(false);
  const [newProductOpen, setNewProductOpen] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(query);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Última busca que ESTE componente empurrou para a página (ver efeito abaixo). */
  const pushedQuery = useRef(query);
  /** Último `resetSignal` já atendido pelo efeito de sincronia. */
  const handledReset = useRef(resetSignal);

  // O campo é local, para a lista não re-renderizar a cada tecla. A página
  // manda o campo de volta ao que ela decidiu por duas vias: `query` mudou
  // sem ter partido daqui, ou `resetSignal` avançou ("Limpar filtros"). A
  // segunda via existe porque limpar uma busca já vazia não muda `query`, e o
  // comando precisa chegar mesmo assim. Nos dois casos o debounce pendente
  // morre aqui: é a única coisa que ainda poderia empurrar o texto antigo.
  useEffect(() => {
    const resetRequested = resetSignal !== handledReset.current;
    if (!resetRequested && query === pushedQuery.current) return;
    handledReset.current = resetSignal;
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
    pushedQuery.current = query;
    setSearchDraft(query);
  }, [query, resetSignal]);

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  function pushQuery(value: string): void {
    pushedQuery.current = value;
    onQueryChange(value);
  }

  function onSearchChange(value: string): void {
    setSearchDraft(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => pushQuery(value), SEARCH_DEBOUNCE_MS);
  }

  function onSearchSubmit(event: FormEvent): void {
    event.preventDefault();
    if (searchTimer.current) clearTimeout(searchTimer.current);
    pushQuery(searchDraft);
  }

  const blocked = blockedReason(loadState);
  const hasNonDefaultFilters = status !== "ativos" || categoryId !== undefined || lowStockOnly;
  const categoryLabel =
    categoryId === "sem-categoria"
      ? "Sem categoria"
      : categories.find((c) => c.id === categoryId)?.name;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={onSearchSubmit} className="flex min-w-[220px] flex-1">
          <label className="relative flex-1">
            <span className="sr-only">Buscar por nome ou código</span>
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              value={searchDraft}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar por nome ou código"
              className="w-full rounded border border-border bg-surface-raised py-2 pl-9 pr-3 text-sm text-text placeholder:text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          </label>
        </form>

        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          aria-expanded={panelOpen}
          className={`flex shrink-0 items-center gap-2 rounded border px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            hasNonDefaultFilters
              ? "border-accent bg-bg text-accent"
              : "border-border text-text hover:bg-surface-raised"
          }`}
        >
          <FilterIcon className="h-4 w-4" />
          Filtros
        </button>

        <button
          type="button"
          onClick={() => setCategoryManagerOpen(true)}
          disabled={blocked !== undefined}
          title={blocked}
          aria-label={blocked === undefined ? undefined : `Gerenciar categorias — ${blocked}`}
          className="shrink-0 rounded border border-border px-3 py-2 text-sm font-medium text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
        >
          Gerenciar categorias
        </button>

        <button
          type="button"
          onClick={() => setNewProductOpen(true)}
          disabled={blocked !== undefined}
          title={blocked}
          aria-label={
            blocked === undefined
              ? "Cadastrar novo produto"
              : `Cadastrar novo produto — ${blocked}`
          }
          className="flex shrink-0 items-center gap-1 rounded bg-accent px-3 py-2 text-sm font-semibold text-on-accent hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:opacity-50 motion-safe:transition-opacity"
        >
          <PlusIcon className="h-4 w-4" />
          Novo produto
        </button>
      </div>

      {panelOpen && (
        <div className="flex flex-wrap items-end gap-4 rounded border border-border bg-surface p-3">
          <label className="flex flex-col gap-1 text-sm">
            Situação
            <select
              value={status}
              onChange={(e) => onStatusChange(e.target.value as ProductStatusFilter)}
              className="rounded border border-border bg-surface-raised p-2 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <option value="ativos">Ativos</option>
              <option value="inativos">Inativos</option>
              <option value="todos">Todos</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Categoria
            <select
              value={categoryId ?? ""}
              onChange={(e) => onCategoryChange(e.target.value === "" ? undefined : e.target.value)}
              className="rounded border border-border bg-surface-raised p-2 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <option value="">Todas</option>
              <option value="sem-categoria">Sem categoria</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={lowStockOnly}
              onChange={(e) => onToggleLowStock(e.target.checked)}
              className="h-4 w-4 accent-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
            Só estoque baixo
          </label>
        </div>
      )}

      {hasNonDefaultFilters && (
        <div className="flex flex-wrap items-center gap-2">
          {lowStockOnly && (
            <FilterChip label="Estoque baixo" onRemove={() => onToggleLowStock(false)} />
          )}
          {status !== "ativos" && (
            <FilterChip
              label={`Situação: ${status === "inativos" ? "Inativos" : "Todos"}`}
              onRemove={() => onStatusChange("ativos")}
            />
          )}
          {categoryId !== undefined && (
            <FilterChip
              label={`Categoria: ${categoryLabel ?? "—"}`}
              onRemove={() => onCategoryChange(undefined)}
            />
          )}
        </div>
      )}

      <Modal open={newProductOpen} onClose={() => setNewProductOpen(false)} title="Novo produto">
        <NewProductForm
          categories={categories}
          onCreated={(item) => {
            onProductCreated(item);
            setNewProductOpen(false);
          }}
        />
      </Modal>

      <CategoryManager
        open={categoryManagerOpen}
        onClose={() => setCategoryManagerOpen(false)}
        categories={categories}
        onCategoriesChange={onCategoriesChange}
        onCategoryRenamed={onCategoryRenamed}
      />
    </div>
  );
}

/**
 * Contraste (spec §6.3): `--accent` como cor de TEXTO só alcança 4.14:1
 * sobre `--surface-raised` e 4.4956:1 sobre `--surface` — que REPROVA no
 * mínimo de 4.5:1, por pouco. Sobre `--bg` (o fundo da área de conteúdo,
 * onde o marcador vive) dá 4.8058:1 — por isso o chip declara `bg-bg`, em
 * vez de herdar o fundo de quem o contém.
 */
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }): JSX.Element {
  return (
    <span className="flex items-center gap-1 rounded-full border border-accent bg-bg py-1 pl-3 pr-1 text-xs font-medium text-accent">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remover filtro: ${label}`}
        className="rounded-full p-0.5 hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <CloseIcon className="h-3 w-3" />
      </button>
    </span>
  );
}

/**
 * Cadastro de produto (nome + SKU/preço/custo/categoria opcionais). Corpo do
 * `POST /api/products`: campos opcionais vazios são omitidos (`undefined`) —
 * ao contrário do formulário de edição, aqui não existe valor anterior a
 * limpar, então "vazio" e "não enviado" dão no mesmo (a rota de criação nem
 * aceita `categoryId: null`, só uuid ou ausente).
 */
function NewProductForm({
  categories,
  onCreated,
}: {
  categories: CategoryItem[];
  onCreated: (item: ProductItem) => void;
}): JSX.Element {
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const nameId = useId();
  const skuId = useId();
  const priceId = useId();
  const costId = useId();
  const categoryFieldId = useId();

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError("");

    const parsedPrice = parseOptionalNonNegativeNumber(price);
    if (!parsedPrice.ok) {
      setError(parsedPrice.error);
      return;
    }
    const parsedCost = parseOptionalNonNegativeNumber(cost);
    if (!parsedCost.ok) {
      setError(parsedCost.error);
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetchJson("/api/products", "POST", {
        name,
        sku: sku.trim() || undefined,
        price: parsedPrice.value,
        cost: parsedCost.value,
        categoryId: categoryId || undefined,
      });
      if (!res.ok) {
        setError(await extractErrorMessage(res, "Não foi possível cadastrar o produto."));
        return;
      }
      const item = (await res.json()) as ProductItem;
      onCreated(item);
    } catch {
      setError("Não foi possível conectar ao servidor. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label htmlFor={nameId} className="flex flex-col gap-1 text-sm">
        Nome
        <input
          id={nameId}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded border border-border bg-surface-raised p-2 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </label>
      <label htmlFor={skuId} className="flex flex-col gap-1 text-sm">
        Código (SKU, opcional)
        <input
          id={skuId}
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          className="rounded border border-border bg-surface-raised p-2 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </label>
      <label htmlFor={priceId} className="flex flex-col gap-1 text-sm">
        Preço de venda (opcional)
        <input
          id={priceId}
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="rounded border border-border bg-surface-raised p-2 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </label>
      <label htmlFor={costId} className="flex flex-col gap-1 text-sm">
        Custo (opcional)
        <input
          id={costId}
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          className="rounded border border-border bg-surface-raised p-2 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </label>
      <label htmlFor={categoryFieldId} className="flex flex-col gap-1 text-sm">
        Categoria (opcional)
        <select
          id={categoryFieldId}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="rounded border border-border bg-surface-raised p-2 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <option value="">Sem categoria</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-accent p-2 text-sm font-semibold text-on-accent disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {submitting ? "Cadastrando..." : "Cadastrar"}
      </button>
    </form>
  );
}
