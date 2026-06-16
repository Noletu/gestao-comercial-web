import { randomBytes } from "node:crypto";
import { adminPrisma, encrypt, withTenant } from "../db/index.js";
import { env } from "../lib/env.js";
import { TOKEN_URL, buildAuthorizeUrl, getCredentials } from "./config.js";
import { NuvemshopTokenExchangeError } from "./errors.js";

/** Validade do `state`: curta — é só a janela do redirect de ida e volta. */
const STATE_TTL_MS = 10 * 60 * 1000; // 10 min

/**
 * Resposta da troca de code por token. `user_id` da Nuvemshop É o store_id da
 * loja — obrigatório em toda chamada de recurso depois. O token NÃO expira (só
 * invalida em reinstalação/desinstalação), então não há refresh_token no MVP.
 */
interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  user_id: number;
}

/**
 * Inicia o fluxo: gera um `state` de alta entropia ligado ao tenant logado,
 * persiste (escopo do tenant → RLS valida o INSERT) e devolve a URL de
 * autorização. O `state` impede um callback forjado: sem um state válido que
 * NÓS emitimos, o callback é rejeitado.
 */
export async function startInstall(
  tenantId: string,
): Promise<{ authorizeUrl: string; state: string }> {
  const { clientId } = getCredentials();
  const state = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + STATE_TTL_MS);

  await withTenant(tenantId, async (tx) => {
    // Limpa states vencidos do tenant (higiene; o consumo já é single-use).
    await tx.nuvemshopOauthState.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    await tx.nuvemshopOauthState.create({
      data: { state, tenantId, expiresAt },
    });
  });

  return { authorizeUrl: buildAuthorizeUrl(clientId, state), state };
}

/**
 * Valida e CONSOME o `state` recebido no callback (uso único). Lê via client
 * ADMIN porque resolver "qual tenant iniciou este state" é cross-tenant por
 * natureza (identidade), como a busca de membership no requireAuth. Retorna o
 * tenantId dono do fluxo, ou null se o state não existe / expirou.
 */
export async function consumeState(
  state: string | undefined,
): Promise<string | null> {
  if (!state) return null;
  // deleteMany retorna a contagem; usamos um findUnique antes para pegar o
  // tenantId e a expiração, e só então apagamos — tudo numa transação para que
  // o state não possa ser usado duas vezes em corrida.
  return adminPrisma.$transaction(async (tx) => {
    const record = await tx.nuvemshopOauthState.findUnique({
      where: { state },
    });
    if (!record) return null;
    await tx.nuvemshopOauthState.delete({ where: { state } });
    if (record.expiresAt.getTime() < Date.now()) return null;
    return record.tenantId;
  });
}

/**
 * Troca o `code` pelo access_token no endpoint de autorização (server-side). O
 * client_secret SÓ é usado aqui, no backend — nunca chega ao front. Lança
 * NuvemshopTokenExchangeError se a resposta não vier no formato esperado.
 */
export async function exchangeCodeForToken(code: string): Promise<{
  storeId: string;
  accessToken: string;
  scope: string;
}> {
  const { clientId, clientSecret } = getCredentials();

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // UA obrigatório em toda requisição à Nuvemshop, inclusive a de token.
      "User-Agent": env.NUVEMSHOP_USER_AGENT,
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
    }),
  });

  if (!res.ok) {
    // NÃO logamos o corpo bruto: poderia conter eco do code/credenciais.
    throw new NuvemshopTokenExchangeError(
      `Troca de code por token falhou (HTTP ${res.status}).`,
    );
  }

  const data = (await res.json()) as Partial<TokenResponse>;
  if (!data.access_token || data.user_id == null) {
    throw new NuvemshopTokenExchangeError(
      "Resposta de token sem access_token/user_id.",
    );
  }

  return {
    storeId: String(data.user_id), // user_id == store_id
    accessToken: data.access_token,
    scope: data.scope ?? "",
  };
}

/**
 * Persiste/atualiza a conexão do tenant de forma IDEMPOTENTE. tenantId é único
 * (1 conexão por tenant): reinstalar apenas regenera o token, nunca duplica. O
 * token vai CIFRADO (AES-256-GCM). Escopo do tenant → RLS valida a escrita.
 */
export async function upsertConnection(
  tenantId: string,
  conn: { storeId: string; accessToken: string; scope: string },
): Promise<void> {
  const accessTokenEncrypted = encrypt(conn.accessToken);
  await withTenant(tenantId, async (tx) => {
    await tx.nuvemshopConnection.upsert({
      where: { tenantId },
      create: {
        tenantId,
        storeId: conn.storeId,
        accessTokenEncrypted,
        scope: conn.scope,
        status: "ACTIVE",
      },
      update: {
        storeId: conn.storeId,
        accessTokenEncrypted,
        scope: conn.scope,
        status: "ACTIVE",
      },
    });
  });
}
