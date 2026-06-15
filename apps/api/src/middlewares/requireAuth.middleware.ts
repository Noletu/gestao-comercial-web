import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth/auth.js";
import { adminPrisma, forTenant } from "../db/index.js";

/**
 * Gate de autorização REAL — no servidor Express, a cada request protegido.
 *
 * Por que aqui e não só no middleware do Next: o CVE-2025-29927 mostrou que
 * proteção feita apenas no middleware do Next.js é burlável forjando o header
 * `x-middleware-subrequest`. O front pode redirecionar por UX, mas o gate de
 * verdade verifica a sessão no backend.
 *
 * Além de autenticar, resolve o tenant ativo e popula `req.tenantId` ANTES de
 * qualquer query de negócio — é o que faz o RLS funcionar (req.db = forTenant).
 *
 * A resolução de membership usa o client ADMIN: descobrir "a quais tenants este
 * usuário pertence" é uma operação de IDENTIDADE, inerentemente cross-tenant, e a
 * tabela membership tem RLS (sem contexto retornaria 0). É seguro: filtramos
 * estritamente por `userId` do usuário já autenticado.
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  void (async () => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      res.status(401).json({ error: "Não autenticado" });
      return;
    }

    req.userId = session.user.id;

    const memberships = await adminPrisma.membership.findMany({
      where: { userId: session.user.id },
      select: { tenantId: true, role: true },
    });

    if (memberships.length === 0) {
      res.status(403).json({ error: "Usuário sem acesso a nenhuma loja" });
      return;
    }

    // 1 tenant (caso do casal) → automático. N tenants → exige seleção via header.
    const requestedTenantId = req.header("x-tenant-id");
    const active =
      memberships.length === 1
        ? memberships[0]
        : memberships.find((m) => m.tenantId === requestedTenantId);

    if (!active) {
      res.status(409).json({
        error: "Selecione a loja ativa (header x-tenant-id)",
        tenants: memberships.map((m) => m.tenantId),
      });
      return;
    }

    req.tenantId = active.tenantId;
    req.role = active.role;
    req.db = forTenant(active.tenantId);
    next();
  })().catch(next);
}
