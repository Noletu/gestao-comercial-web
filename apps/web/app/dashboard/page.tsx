"use client";

import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface Me {
  user: { id: string; email: string; name: string } | null;
  tenantId: string;
  role: string;
}

interface ProductItem {
  variantId: string;
  productId: string;
  name: string;
  sku: string | null;
  stock: number;
  price: number | null;
  cost: number | null;
  margin: number | null;
}

type MovementKind = "entrada" | "saida" | "ajuste";

interface MovementResult {
  stock: number;
  message: string;
}

/**
 * Limite de estoque baixo, fixo pra loja toda (spec
 * estoque-busca-filtro-preco.md §4.2 — mesmo valor do backend,
 * `LOW_STOCK_THRESHOLD` em `products.service.ts`; não há pacote compartilhado
 * entre web/api pra essa constante, então mantemos os dois em sincronia).
 */
const LOW_STOCK_THRESHOLD = 2;

type StockStatus = "zerado" | "baixo" | "ok";

function stockStatus(stock: number): StockStatus {
  if (stock === 0) return "zerado";
  if (stock <= LOW_STOCK_THRESHOLD) return "baixo";
  return "ok";
}

const STOCK_STATUS_STYLES: Record<StockStatus, string> = {
  zerado: "bg-red-100 text-red-800",
  baixo: "bg-amber-100 text-amber-800",
  ok: "bg-green-100 text-green-800",
};

const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  zerado: "Zerado",
  baixo: "Baixo",
  ok: "Ok",
};

function StockBadge({ stock }: { stock: number }): JSX.Element {
  const status = stockStatus(stock);
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STOCK_STATUS_STYLES[status]}`}
    >
      {stock} · {STOCK_STATUS_LABELS[status]}
    </span>
  );
}

/** `null` (valor não cadastrado) sempre vira "—" — nunca "R$ NaN" (spec §4.3/§6). */
function formatCurrency(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** `null` (margem indeterminada) sempre vira "—" — nunca "0%" fingindo que é zero de verdade. */
function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

/**
 * Campo numérico opcional (preço/custo) do formulário: vazio vira `undefined`
 * (o campo é omitido no corpo enviado — omitido/vazio limpa o valor, spec
 * §4.5). Texto que não é um número válido ≥ 0 retorna erro explícito — nunca
 * deixa um NaN ou negativo seguir silenciosamente para a API.
 */
function parseOptionalNonNegativeNumber(
  raw: string,
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: undefined };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return {
      ok: false,
      error: "Informe um valor numérico válido, maior ou igual a zero.",
    };
  }
  return { ok: true, value: parsed };
}

/**
 * Tenta extrair uma mensagem de erro amigável do corpo da resposta — a API
 * responde `{ error }` nos 400 de validação e `{ status, message }` no 500
 * genérico. Nunca deixa a tela sem mensagem: cai num texto padrão se o corpo
 * não vier no formato esperado (falha silenciosa é proibida).
 */
async function extractErrorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      if (typeof record.error === "string") return record.error;
      if (typeof record.message === "string") return record.message;
    }
  } catch {
    // Corpo não é JSON válido — usa o fallback abaixo.
  }
  return fallback;
}

/**
 * Formulário de cadastro de produto (nome + SKU opcional — spec §5.4/§8 da
 * gestão manual, preço e custo opcionais adicionados pela spec
 * estoque-busca-filtro-preco.md §4.4/§6).
 */
function NewProductForm({
  onCreated,
}: {
  onCreated: (item: ProductItem) => void;
}): JSX.Element {
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
      const res = await fetch(`${API}/api/products`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          sku: sku.trim() || undefined,
          price: parsedPrice.value,
          cost: parsedCost.value,
        }),
      });
      if (!res.ok) {
        setError(
          await extractErrorMessage(res, "Não foi possível cadastrar o produto."),
        );
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
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded border border-gray-200 p-3"
    >
      <label className="flex flex-col gap-1 text-sm">
        Nome
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded border border-gray-300 p-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Código (SKU, opcional)
        <input
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          className="rounded border border-gray-300 p-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Preço de venda (opcional)
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="rounded border border-gray-300 p-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Custo (opcional)
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          className="rounded border border-gray-300 p-2"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-gray-900 p-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitting ? "Cadastrando..." : "Cadastrar"}
      </button>
    </form>
  );
}

/**
 * Formulário de edição (rota nova `PATCH /api/products/:variantId` — spec
 * estoque-busca-filtro-preco.md §4.5/§6). Substituição total: campo deixado
 * em branco limpa o valor no backend (nunca "mantém o que já tinha").
 */
function EditProductForm({
  item,
  onSaved,
}: {
  item: ProductItem;
  onSaved: (item: ProductItem) => void;
}): JSX.Element {
  const [name, setName] = useState(item.name);
  const [sku, setSku] = useState(item.sku ?? "");
  const [price, setPrice] = useState(item.price !== null ? String(item.price) : "");
  const [cost, setCost] = useState(item.cost !== null ? String(item.cost) : "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
      const res = await fetch(`${API}/api/products/${item.variantId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          sku: sku.trim() || undefined,
          price: parsedPrice.value,
          cost: parsedCost.value,
        }),
      });
      if (!res.ok) {
        setError(
          await extractErrorMessage(res, "Não foi possível salvar as alterações."),
        );
        return;
      }
      const updated = (await res.json()) as ProductItem;
      onSaved(updated);
    } catch {
      setError("Não foi possível conectar ao servidor. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 border-t border-gray-200 pt-3"
    >
      <label className="flex flex-col gap-1 text-sm">
        Nome
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded border border-gray-300 p-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Código (SKU)
        <input
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          className="rounded border border-gray-300 p-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Preço de venda
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="rounded border border-gray-300 p-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Custo
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          className="rounded border border-gray-300 p-2"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-gray-900 p-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitting ? "Salvando..." : "Salvar alterações"}
      </button>
    </form>
  );
}

/** Formulário de lançamento (Entrada/Saída/Ajuste — spec §5.1/§8). */
function MovementForm({
  variantId,
  onSuccess,
}: {
  variantId: string;
  onSuccess: (result: MovementResult) => void;
}): JSX.Element {
  const [kind, setKind] = useState<MovementKind>("entrada");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    setFeedback("");

    const parsedQuantity = Number(quantity);
    if (quantity.trim() === "" || !Number.isInteger(parsedQuantity)) {
      setError("Informe uma quantidade válida.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/products/${variantId}/movements`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          quantity: parsedQuantity,
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) {
        setError(
          await extractErrorMessage(
            res,
            "Não foi possível registrar a movimentação.",
          ),
        );
        return;
      }
      const result = (await res.json()) as MovementResult;
      setFeedback(result.message);
      setQuantity("");
      setNote("");
      onSuccess(result);
    } catch {
      setError("Não foi possível conectar ao servidor. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-3 flex flex-col gap-3 border-t border-gray-200 pt-3"
    >
      <label className="flex flex-col gap-1 text-sm">
        Tipo
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as MovementKind)}
          className="rounded border border-gray-300 p-2"
        >
          <option value="entrada">Entrada</option>
          <option value="saida">Saída</option>
          <option value="ajuste">Ajuste</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {kind === "ajuste" ? "Quantidade contada" : "Quantidade"}
        <input
          type="number"
          inputMode="numeric"
          required
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="rounded border border-gray-300 p-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Observação (opcional)
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="rounded border border-gray-300 p-2"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {feedback && <p className="text-sm text-green-700">{feedback}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-gray-900 p-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitting ? "Salvando..." : "Salvar"}
      </button>
    </form>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const [products, setProducts] = useState<ProductItem[] | null>(null);
  const [listError, setListError] = useState("");
  const [query, setQuery] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const [showNewProduct, setShowNewProduct] = useState(false);
  const [openMovementFor, setOpenMovementFor] = useState<string | null>(null);
  const [openEditFor, setOpenEditFor] = useState<string | null>(null);

  const loadProducts = useCallback(async (q: string, onlyLowStock: boolean) => {
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (onlyLowStock) params.set("lowStock", "true");
      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`${API}/api/products${qs}`, {
        credentials: "include",
      });
      if (!res.ok) {
        setListError(
          await extractErrorMessage(res, "Não foi possível carregar os produtos."),
        );
        return;
      }
      const data = (await res.json()) as { products: ProductItem[] };
      setProducts(data.products);
      setListError("");
    } catch {
      setListError("Não foi possível conectar ao servidor. Tente novamente.");
    }
  }, []);

  useEffect(() => {
    // O gate REAL é aqui: pedimos /api/me ao backend. Se a sessão não vale, o
    // Express responde 401 e redirecionamos. O front não decide autorização.
    fetch(`${API}/api/me`, { credentials: "include" })
      .then(async (r) => {
        if (r.status === 401) {
          router.push("/login");
          return null;
        }
        return (await r.json()) as Me;
      })
      .then((data) => {
        if (data) setMe(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!loading && me) void loadProducts(query, lowStockOnly);
    // Só na entrada (depois do gate de sessão resolver) — busca manual usa
    // onSearchSubmit, e o toggle de estoque baixo usa onToggleLowStock, não
    // este efeito, para não recarregar a cada tecla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, me]);

  async function onSearchSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    await loadProducts(query, lowStockOnly);
  }

  async function onToggleLowStock(checked: boolean): Promise<void> {
    setLowStockOnly(checked);
    await loadProducts(query, checked);
  }

  async function onLogout(): Promise<void> {
    await authClient.signOut();
    router.push("/login");
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-gray-500">Carregando...</p>
      </main>
    );
  }

  const lowStockCount =
    products?.filter((item) => item.stock <= LOW_STOCK_THRESHOLD).length ?? 0;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">Painel</h1>
      {me?.user && (
        <div className="rounded border border-gray-200 p-4 text-sm">
          <p>
            <strong>Usuário:</strong> {me.user.name} ({me.user.email})
          </p>
          <p>
            <strong>Loja ativa:</strong> {me.tenantId}
          </p>
          <p>
            <strong>Papel:</strong> {me.role}
          </p>
        </div>
      )}
      <Link href="/two-factor" className="text-sm text-gray-700 underline">
        Ativar verificação em duas etapas (2FA)
      </Link>
      <button
        onClick={onLogout}
        className="rounded border border-gray-300 p-2 text-sm font-medium"
      >
        Sair
      </button>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-bold">Estoque</h2>

        <form onSubmit={onSearchSubmit} className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome ou código"
            className="flex-1 rounded border border-gray-300 p-2"
          />
          <button
            type="submit"
            className="rounded border border-gray-300 p-2 text-sm font-medium"
          >
            Buscar
          </button>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={lowStockOnly}
              onChange={(e) => void onToggleLowStock(e.target.checked)}
            />
            Só estoque baixo
          </label>
        </form>

        {lowStockCount > 0 && (
          <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            {lowStockCount} {lowStockCount === 1 ? "peça" : "peças"} com estoque baixo
          </p>
        )}

        <button
          onClick={() => setShowNewProduct((v) => !v)}
          className="rounded bg-gray-900 p-2 text-sm font-medium text-white"
        >
          {showNewProduct ? "Cancelar" : "Novo produto"}
        </button>
        {showNewProduct && (
          <NewProductForm
            onCreated={(item) => {
              setProducts((prev) => (prev ? [...prev, item] : [item]));
              setShowNewProduct(false);
            }}
          />
        )}

        {listError && <p className="text-sm text-red-600">{listError}</p>}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                <th className="p-2">Peça</th>
                <th className="p-2">Código</th>
                <th className="p-2">Preço</th>
                <th className="p-2">Custo</th>
                <th className="p-2">Margem</th>
                <th className="p-2">Estoque</th>
                <th className="p-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {products?.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-3 text-sm text-gray-500">
                    Nenhum produto encontrado.
                  </td>
                </tr>
              )}
              {products?.map((item) => (
                <Fragment key={item.variantId}>
                  <tr className="border-b border-gray-100">
                    <td className="p-2 font-medium">{item.name}</td>
                    <td className="p-2 text-gray-700">{item.sku ?? "—"}</td>
                    <td className="p-2 text-gray-700">{formatCurrency(item.price)}</td>
                    <td className="p-2 text-gray-700">{formatCurrency(item.cost)}</td>
                    <td className="p-2 text-gray-700">{formatPercent(item.margin)}</td>
                    <td className="p-2">
                      <StockBadge stock={item.stock} />
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() =>
                            setOpenEditFor((current) =>
                              current === item.variantId ? null : item.variantId,
                            )
                          }
                          className="shrink-0 rounded border border-gray-300 p-2 text-xs font-medium"
                        >
                          {openEditFor === item.variantId ? "Cancelar" : "Editar"}
                        </button>
                        <button
                          onClick={() =>
                            setOpenMovementFor((current) =>
                              current === item.variantId ? null : item.variantId,
                            )
                          }
                          className="shrink-0 rounded border border-gray-300 p-2 text-xs font-medium"
                        >
                          {openMovementFor === item.variantId
                            ? "Cancelar"
                            : "Registrar movimentação"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {openEditFor === item.variantId && (
                    <tr className="border-b border-gray-100">
                      <td colSpan={7} className="p-2">
                        <EditProductForm
                          item={item}
                          onSaved={(updated) => {
                            setProducts((prev) =>
                              prev
                                ? prev.map((p) =>
                                    p.variantId === updated.variantId ? updated : p,
                                  )
                                : prev,
                            );
                            setOpenEditFor(null);
                          }}
                        />
                      </td>
                    </tr>
                  )}
                  {openMovementFor === item.variantId && (
                    <tr className="border-b border-gray-100">
                      <td colSpan={7} className="p-2">
                        <MovementForm
                          variantId={item.variantId}
                          onSuccess={(result) => {
                            setProducts((prev) =>
                              prev
                                ? prev.map((p) =>
                                    p.variantId === item.variantId
                                      ? { ...p, stock: result.stock }
                                      : p,
                                  )
                                : prev,
                            );
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
