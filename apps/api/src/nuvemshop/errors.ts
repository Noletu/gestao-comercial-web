/**
 * Erros tipados da integração Nuvemshop. Tipar (em vez de Error genérico) deixa
 * o chamador decidir o tratamento: 401 invalida a conexão, 429 pede backoff,
 * config ausente é erro de operação, etc. Nenhum deles carrega token/secret.
 */

/** Integração não configurada (faltam client_id/secret no ambiente). */
export class NuvemshopConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NuvemshopConfigError";
  }
}

/** O tenant ainda não conectou uma loja (sem NuvemshopConnection). */
export class NuvemshopNotConnectedError extends Error {
  constructor(message = "Loja Nuvemshop não conectada para este tenant.") {
    super(message);
    this.name = "NuvemshopNotConnectedError";
  }
}

/** Token inválido/revogado (HTTP 401). Sinaliza reconexão necessária. */
export class NuvemshopAuthError extends Error {
  constructor(message = "Token Nuvemshop inválido ou revogado.") {
    super(message);
    this.name = "NuvemshopAuthError";
  }
}

/** Rate limit atingido (HTTP 429). `retryAfterSeconds` vem do header, se houver. */
export class NuvemshopRateLimitError extends Error {
  readonly retryAfterSeconds?: number;
  constructor(retryAfterSeconds?: number) {
    super("Rate limit da Nuvemshop atingido (429).");
    this.name = "NuvemshopRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Qualquer outra resposta não-2xx da API de recursos. */
export class NuvemshopApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "NuvemshopApiError";
    this.status = status;
  }
}

/** Falha na troca de `code` por token (resposta inválida do endpoint de auth). */
export class NuvemshopTokenExchangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NuvemshopTokenExchangeError";
  }
}
