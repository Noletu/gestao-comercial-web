import type { Role } from "@prisma/client";
import type { TenantClient } from "../db/index.js";

// Augmenta o Request do Express com o contexto de auth + tenant.
// Populados pelo middleware requireAuth a partir da sessão e do Membership.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      tenantId?: string;
      role?: Role;
      db?: TenantClient;
    }
  }
}

export {};
