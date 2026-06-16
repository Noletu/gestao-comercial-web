import { env } from "../lib/env.js";
import { NuvemshopConfigError } from "./errors.js";

/**
 * Endpoints e configuração da Nuvemshop.
 *
 * Atenção a uma pegadinha da plataforma: o endpoint que TROCA o code por token
 * fica em um host DIFERENTE da API de recursos:
 *  - Autorização/instalação e troca de token → www.nuvemshop.com.br/apps/...
 *  - Recursos (store, products, ...)          → api.nuvemshop.com.br/{versao}/{store_id}/...
 * Por isso são bases separadas, não um prefixo só.
 */

/** Base de instalação/autorização (onde o lojista autoriza o app). */
const AUTHORIZE_BASE = "https://www.nuvemshop.com.br/apps";

/** Endpoint server-side que troca `code` por `access_token`. */
export const TOKEN_URL = "https://www.nuvemshop.com.br/apps/authorize/token";

/** Base da API de recursos (versionada e com store_id no path). */
const API_HOST = "https://api.nuvemshop.com.br";

/** Credenciais do app. client_id = app_id (público); client_secret é SEGREDO. */
export interface NuvemshopCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Lê as credenciais e falha com erro claro se a integração não estiver
 * configurada. Validamos aqui (não no schema de env) para que o boot e os
 * testes que não tocam na Nuvemshop não exijam essas variáveis. A leitura é em
 * `process.env` (tardia) de propósito: o segredo nunca é exigido no boot e os
 * testes conseguem injetá-lo antes da chamada. As demais configs (versão, UA)
 * têm default e vêm do schema `env`.
 */
export function getCredentials(): NuvemshopCredentials {
  const clientId = process.env.NUVEMSHOP_CLIENT_ID;
  const clientSecret = process.env.NUVEMSHOP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new NuvemshopConfigError(
      "Nuvemshop não configurada: defina NUVEMSHOP_CLIENT_ID e NUVEMSHOP_CLIENT_SECRET.",
    );
  }
  return { clientId, clientSecret };
}

/**
 * URL para onde mandamos o lojista iniciar a instalação. O `state` (anti-CSRF)
 * vai junto e a Nuvemshop o devolve no callback, provando que aquele callback
 * nasceu de um fluxo que NÓS iniciamos.
 *
 * A "URL de redirecionamento" (callback) NÃO vai aqui: é fixa no portal do app.
 * Por isso a mantemos configurável por env (NUVEMSHOP_REDIRECT_URI) e o operador
 * cadastra a mesma URL no portal.
 */
export function buildAuthorizeUrl(clientId: string, state: string): string {
  const url = new URL(`${AUTHORIZE_BASE}/${clientId}/authorize`);
  url.searchParams.set("state", state);
  return url.toString();
}

/** Base de recursos do tenant: `${API_HOST}/{versao}/{store_id}`. */
export function apiBaseFor(storeId: string): string {
  return `${API_HOST}/${env.NUVEMSHOP_API_VERSION}/${storeId}`;
}
