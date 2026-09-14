/**
 * Fetch com credenciais + tratamento de erro para a API Express, e os tipos
 * de dado trocados com ela. Movido/consolidado de `app/dashboard/page.tsx`
 * (spec estoque-interface-parte-1.md §6.1) — hoje duplicado em cada
 * formulário; centralizado aqui.
 */

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** `fetch` já com `credentials: "include"` (cookie de sessão) e base da API. */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API}${path}`, {
    credentials: "include",
    ...init,
  });
}

/** Igual a `apiFetch`, mas já serializa `body` como JSON com o header certo. */
export function apiFetchJson(
  path: string,
  method: "POST" | "PATCH",
  body: unknown,
): Promise<Response> {
  return apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Tenta extrair uma mensagem de erro amigável do corpo da resposta — a API
 * responde `{ error }` nos 400 de validação e `{ status, message }` no 500
 * genérico. Nunca deixa a tela sem mensagem: cai num texto padrão se o corpo
 * não vier no formato esperado (falha silenciosa é proibida).
 */
export async function extractErrorMessage(
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

export interface Me {
  user: { id: string; email: string; name: string } | null;
  tenantId: string;
  role: string;
}

export type ProductStatusApi = "ativo" | "inativo";

/** Filtro de situação aceito por `GET /api/products` (spec §5.3). */
export type ProductStatusFilter = "ativos" | "inativos" | "todos";

export interface ProductItem {
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

export interface CategoryItem {
  id: string;
  name: string;
  /** Quantas peças estão vinculadas a esta categoria. */
  productCount: number;
}

export type MovementKind = "entrada" | "saida" | "ajuste";

export interface MovementResult {
  stock: number;
  message: string;
}
