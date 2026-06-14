import type { TenantClient } from "../db";

// Augmenta o Request do Express com o contexto de tenant.
// `tenantId` é populado pela camada de auth (issue #3); `db` é o client já
// isolado por RLS para aquele tenant.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenantId?: string;
      db?: TenantClient;
    }
  }
}

export {};
