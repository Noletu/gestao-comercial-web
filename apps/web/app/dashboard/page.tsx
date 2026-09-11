"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
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
}

type MovementKind = "entrada" | "saida" | "ajuste";

interface MovementResult {
  stock: number;
  message: string;
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

/** Formulário de cadastro de produto (nome + SKU opcional — spec §5.4/§8). */
function NewProductForm({
  onCreated,
}: {
  onCreated: (item: ProductItem) => void;
}): JSX.Element {
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/products`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, sku: sku.trim() || undefined }),
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
        SKU (opcional)
        <input
          value={sku}
          onChange={(e) => setSku(e.target.value)}
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

  const [showNewProduct, setShowNewProduct] = useState(false);
  const [openMovementFor, setOpenMovementFor] = useState<string | null>(null);

  const loadProducts = useCallback(async (q: string) => {
    try {
      const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
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
    if (!loading && me) void loadProducts(query);
    // Só na entrada (depois do gate de sessão resolver) — busca manual usa
    // onSearchSubmit, não este efeito, para não recarregar a cada tecla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, me]);

  async function onSearchSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    await loadProducts(query);
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

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
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

        <form onSubmit={onSearchSubmit} className="flex gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome"
            className="flex-1 rounded border border-gray-300 p-2"
          />
          <button
            type="submit"
            className="rounded border border-gray-300 p-2 text-sm font-medium"
          >
            Buscar
          </button>
        </form>

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

        <ul className="flex flex-col gap-3">
          {products?.length === 0 && (
            <li className="text-sm text-gray-500">Nenhum produto encontrado.</li>
          )}
          {products?.map((item) => (
            <li
              key={item.variantId}
              className="rounded border border-gray-200 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{item.name}</p>
                  {item.sku && (
                    <p className="text-xs text-gray-500">SKU: {item.sku}</p>
                  )}
                  <p className="text-sm text-gray-700">
                    Estoque: {item.stock}
                  </p>
                </div>
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
              {openMovementFor === item.variantId && (
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
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
