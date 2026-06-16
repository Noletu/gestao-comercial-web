import { decrypt, forTenant } from "../db/index.js";
import { env } from "../lib/env.js";
import { apiBaseFor } from "./config.js";
import {
  NuvemshopApiError,
  NuvemshopAuthError,
  NuvemshopNotConnectedError,
  NuvemshopRateLimitError,
} from "./errors.js";

/**
 * Cliente HTTP da Nuvemshop com escopo de tenant — base para todo o Épico 1.
 *
 * Responsabilidades centralizadas aqui (para nenhuma chamada repetir isso):
 *  - resolve a conexão do tenant e DECIFRA o token (nunca trafega em texto puro
 *    fora deste processo);
 *  - injeta a base versionada com store_id, o `User-Agent` (obrigatório) e o
 *    header de auth;
 *  - traduz erros HTTP em erros tipados (401 → invalida a conexão; 429 → backoff).
 *
 * Pegadinha da plataforma: a Nuvemshop autentica pelo header `Authentication`
 * (NÃO `Authorization`), valor `bearer {token}`. Usar `Authorization` resulta em
 * 401 silencioso — por isso está fixo e comentado aqui.
 */

export interface NuvemshopClient {
  storeId: string;
  /** Chamada crua à API de recursos do tenant. `path` começa com "/". */
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  /** Prova de fim-a-fim: dados da loja conectada (`GET /store`). */
  getStore: () => Promise<{ id: number; name: unknown; [k: string]: unknown }>;
}

export async function nuvemshopClient(
  tenantId: string,
): Promise<NuvemshopClient> {
  const db = forTenant(tenantId);
  const conn = await db.nuvemshopConnection.findUnique({ where: { tenantId } });
  if (!conn) {
    throw new NuvemshopNotConnectedError();
  }

  const accessToken = decrypt(conn.accessTokenEncrypted);
  const baseUrl = apiBaseFor(conn.storeId);

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    // PONTO DE EXTENSÃO: throttle/leaky-bucket entra aqui (issue de sync). Hoje
    // as chamadas são pontuais (status do painel), então não há limitador ainda.
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        // Header NÃO-padrão da Nuvemshop (ver nota no topo).
        Authentication: `bearer ${accessToken}`,
        "User-Agent": env.NUVEMSHOP_USER_AGENT,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });

    if (res.status === 401) {
      // Token inválido/revogado: marca a conexão para o painel pedir reconexão.
      await forTenant(tenantId).nuvemshopConnection.update({
        where: { tenantId },
        data: { status: "ERROR" },
      });
      throw new NuvemshopAuthError();
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      throw new NuvemshopRateLimitError(
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }

    if (!res.ok) {
      throw new NuvemshopApiError(
        res.status,
        `Nuvemshop respondeu HTTP ${res.status} em ${path}.`,
      );
    }

    return (await res.json()) as T;
  }

  return {
    storeId: conn.storeId,
    request,
    getStore: () =>
      request<{ id: number; name: unknown; [k: string]: unknown }>("/store"),
  };
}
