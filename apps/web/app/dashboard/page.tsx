"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { AppShell } from "@/components/app-shell";
import { FiltersBar } from "@/components/filters-bar";
import { ProductTable, type ProductLoadState } from "@/components/product-table";
import { HIGHLIGHT_MS } from "@/components/product-row";
import { WarningIcon, CloseIcon } from "@/components/icons";
import { LOW_STOCK_THRESHOLD } from "@/lib/format";
import {
  API,
  extractErrorMessage,
  type CategoryItem,
  type Me,
  type ProductItem,
  type ProductStatusFilter,
} from "@/lib/api";

/**
 * Tela de estoque (spec estoque-interface-parte-1.md §6). Decisão técnica:
 * a lista completa (`status=todos`) é buscada UMA VEZ no carregamento, e
 * busca/filtro de situação/categoria/estoque baixo são aplicados no
 * cliente, em memória — o dataset é pequeno (~100-200 peças, mesmo
 * comentário em `products.service.ts`), e assim a contagem do cabeçalho e o
 * alerta de estoque baixo sempre refletem a realidade da loja inteira,
 * independentemente do filtro que o usuário aplicou no momento (spec §6.2:
 * o banner é clicável e a contagem não pode variar por causa de um filtro
 * já ativo). Mutações (criar/editar/movimentar/inativar/reativar) atualizam
 * o item correspondente na lista local a partir da resposta da API, sem
 * recarregar a lista inteira.
 */

interface Feedback {
  tone: "ok" | "danger";
  text: string;
}

export default function DashboardPage(): JSX.Element {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const [products, setProducts] = useState<ProductItem[] | null>(null);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [listError, setListError] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ProductStatusFilter>("ativos");
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  /**
   * Avança a cada "Limpar filtros". A barra de busca guarda o texto digitado
   * localmente; este contador é o comando "limpe" chegando até ela mesmo
   * quando a busca já estava vazia e `query` não muda.
   */
  const [filtersResetSignal, setFiltersResetSignal] = useState(0);
  /** Peça recém-cadastrada, destacada na lista por `HIGHLIGHT_MS`. */
  const [highlightedVariantId, setHighlightedVariantId] = useState<string | null>(null);

  useEffect(() => {
    // O gate REAL é aqui: pedimos /api/me ao backend. Se a sessão não vale, o
    // Express responde 401 e redirecionamos. O front não decide autorização.
    fetch(`${API}/api/me`, { credentials: "include" })
      .then(async (r) => {
        if (r.status === 401) {
          router.push("/login");
          return null;
        }
        // 409 do `requireAuth` significa "loja ativa não definida". A
        // mensagem do backend ("Selecione a loja ativa") pede uma ação que
        // esta tela não oferece; aqui ela vira o que o usuário pode fazer de
        // fato.
        if (r.status === 409) {
          setListError(
            "Não conseguimos abrir a sua loja. Recarregue a página; se continuar assim, saia e entre de novo.",
          );
          return null;
        }
        // Qualquer outra resposta fora do 200 (ex.: 403, "sem acesso a nenhuma
        // loja") vira mensagem na tela: o corpo é `{ error }`, não um usuário.
        if (!r.ok) {
          setListError(
            await extractErrorMessage(r, "Não foi possível confirmar seu acesso. Recarregue a página."),
          );
          return null;
        }
        return (await r.json()) as Me;
      })
      .then((data) => {
        if (data) setMe(data);
        setLoading(false);
      })
      .catch(() => {
        // Servidor fora do ar: `me` nulo trava a carga da lista, então a tela
        // precisa dizer por que não há nada nela.
        setListError("Não foi possível conectar ao servidor. Recarregue a página.");
        setLoading(false);
      });
  }, [router]);

  useEffect(() => {
    if (loading || !me) return;
    let cancelled = false;

    async function loadAll(): Promise<void> {
      try {
        const [productsRes, categoriesRes] = await Promise.all([
          fetch(`${API}/api/products?status=todos`, { credentials: "include" }),
          fetch(`${API}/api/categories`, { credentials: "include" }),
        ]);
        if (cancelled) return;
        // Sessão expirada entre o /api/me e esta carga: o caminho para voltar
        // é a tela de login, não uma mensagem de erro na tela de estoque.
        if (productsRes.status === 401 || categoriesRes.status === 401) {
          router.push("/login");
          return;
        }
        if (!productsRes.ok) {
          setListError(
            await extractErrorMessage(productsRes, "Não foi possível carregar os produtos."),
          );
          return;
        }
        if (!categoriesRes.ok) {
          setListError(
            await extractErrorMessage(categoriesRes, "Não foi possível carregar as categorias."),
          );
          return;
        }
        const productsData = (await productsRes.json()) as { products: ProductItem[] };
        const categoriesData = (await categoriesRes.json()) as { categories: CategoryItem[] };
        if (cancelled) return;
        setProducts(productsData.products);
        setCategories(categoriesData.categories);
        setListError("");
      } catch {
        if (!cancelled) {
          setListError("Não foi possível conectar ao servidor. Tente novamente.");
        }
      }
    }

    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [loading, me, router]);

  const activeItems = useMemo(
    () => (products ?? []).filter((item) => item.status === "ativo"),
    [products],
  );
  const totalPecas = activeItems.length;
  const totalUnidades = activeItems.reduce((sum, item) => sum + item.stock, 0);
  const lowStockCount = activeItems.filter((item) => item.stock <= LOW_STOCK_THRESHOLD).length;

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (products ?? []).filter((item) => {
      if (status !== "todos") {
        const wantsActive = status === "ativos";
        if (wantsActive !== (item.status === "ativo")) return false;
      }
      if (categoryId === "sem-categoria" && item.category !== null) return false;
      if (categoryId && categoryId !== "sem-categoria" && item.category?.id !== categoryId) {
        return false;
      }
      if (lowStockOnly && item.stock > LOW_STOCK_THRESHOLD) return false;
      if (q) {
        const matchesName = item.name.toLowerCase().includes(q);
        const matchesSku = (item.sku ?? "").toLowerCase().includes(q);
        if (!matchesName && !matchesSku) return false;
      }
      return true;
    });
  }, [products, query, status, categoryId, lowStockOnly]);

  /**
   * A contagem de peças por categoria é derivada da lista que já está em
   * memória, não do `productCount` que veio do `GET /api/categories`: a
   * lista é carregada inteira (`status=todos`, ver comentário no topo) e
   * toda mudança de vínculo passa por ela, então a contagem acompanha o que
   * o usuário acabou de fazer sem uma segunda ida ao servidor — e nunca
   * contradiz a tabela ao lado. Mesma semântica do backend, que conta peças
   * de qualquer situação.
   */
  const categoriesWithCount = useMemo(
    () =>
      products === null
        ? categories
        : categories.map((category) => ({
            ...category,
            productCount: products.filter((item) => item.category?.id === category.id).length,
          })),
    [categories, products],
  );

  function upsertProduct(updated: ProductItem): void {
    setProducts((prev) =>
      prev ? prev.map((p) => (p.variantId === updated.variantId ? updated : p)) : prev,
    );
  }

  /**
   * O nome da categoria também vive denormalizado em cada peça
   * (`item.category.name`), e renomear precisa alcançar as duas cópias para a
   * tabela não exibir o nome velho.
   */
  function renameCategoryInProducts(updated: CategoryItem): void {
    setProducts((prev) =>
      prev
        ? prev.map((item) =>
            item.category?.id === updated.id
              ? { ...item, category: { id: updated.id, name: updated.name } }
              : item,
          )
        : prev,
    );
  }

  function clearFilters(): void {
    setFiltersResetSignal((signal) => signal + 1);
    setQuery("");
    setStatus("ativos");
    setCategoryId(undefined);
    setLowStockOnly(false);
  }

  useEffect(() => {
    if (highlightedVariantId === null) return;
    const timer = setTimeout(() => setHighlightedVariantId(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightedVariantId]);

  async function onLogout(): Promise<void> {
    await authClient.signOut();
    router.push("/login");
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg p-6 text-text">
        <p className="text-text-muted">Carregando...</p>
      </main>
    );
  }

  const hasActiveFilters = status !== "ativos" || categoryId !== undefined || lowStockOnly;

  // Enquanto a lista não chegou, a tela não afirma nada sobre o estoque —
  // nem a contagem do cabeçalho, nem "nenhuma peça cadastrada".
  const loadState: ProductLoadState =
    products !== null ? "ready" : listError !== "" ? "failed" : "loading";

  const subtitle =
    loadState === "ready"
      ? `${totalPecas} ${totalPecas === 1 ? "peça" : "peças"} · ${totalUnidades} ${
          totalUnidades === 1 ? "unidade" : "unidades"
        }`
      : loadState === "loading"
        ? "Carregando estoque..."
        : "Estoque não carregado";

  return (
    <AppShell
      userName={me?.user?.name ?? ""}
      onLogout={() => void onLogout()}
      title="Estoque"
      subtitle={subtitle}
    >
      <FiltersBar
        query={query}
        onQueryChange={setQuery}
        status={status}
        onStatusChange={setStatus}
        categoryId={categoryId}
        onCategoryChange={setCategoryId}
        lowStockOnly={lowStockOnly}
        onToggleLowStock={setLowStockOnly}
        categories={categoriesWithCount}
        onCategoriesChange={setCategories}
        onCategoryRenamed={renameCategoryInProducts}
        loadState={loadState}
        resetSignal={filtersResetSignal}
        onProductCreated={(item) => {
          // Lista nula significa "não carregou": nenhuma mutação pode criá-la,
          // sob pena de a tela afirmar um estoque de uma peça só. Ordenada por
          // nome, como o backend a devolve.
          setProducts((prev) =>
            prev
              ? [...prev, item].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
              : prev,
          );
          setHighlightedVariantId(item.variantId);
          setFeedback({ tone: "ok", text: `"${item.name}" foi cadastrada.` });
        }}
      />

      {lowStockCount > 0 && (
        <button
          type="button"
          onClick={() => setLowStockOnly(true)}
          className="flex items-center gap-2 rounded border border-warn bg-warn-bg px-3 py-2 text-left text-sm text-warn focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <WarningIcon className="h-4 w-4 shrink-0" />
          {lowStockCount} {lowStockCount === 1 ? "peça" : "peças"} com estoque baixo (
          {LOW_STOCK_THRESHOLD} ou menos) — clique para filtrar
        </button>
      )}

      {/*
        O foco volta ao botão que abriu o modal, então o aviso não é lido
        sozinho por leitor de tela: `role="status"` o anuncia. A região vive
        sempre no DOM e só o conteúdo é condicional — região criada junto com
        o texto não é anunciada de forma confiável.
      */}
      <div
        role="status"
        className={
          feedback
            ? `flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm ${
                feedback.tone === "ok"
                  ? "border-ok bg-ok-bg text-ok"
                  : "border-danger bg-danger-bg text-danger"
              }`
            : "sr-only"
        }
      >
        {feedback && (
          <>
            <span>{feedback.text}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              aria-label="Fechar aviso"
              className="shrink-0 rounded p-0.5 hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {listError && (
        <p className="rounded border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
          {listError}
        </p>
      )}

      <ProductTable
        items={filteredItems}
        loadState={loadState}
        hasAnyProduct={(products?.length ?? 0) > 0}
        hasActiveFilters={hasActiveFilters || query.trim() !== ""}
        onClearFilters={clearFilters}
        categories={categoriesWithCount}
        onUpdated={upsertProduct}
        onFeedback={(text, tone) => setFeedback({ tone, text })}
        highlightedVariantId={highlightedVariantId}
      />
    </AppShell>
  );
}
