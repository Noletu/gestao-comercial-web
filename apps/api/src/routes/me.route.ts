import { Router } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth/auth.js";
import { requireAuth } from "../middlewares/requireAuth.middleware.js";

/**
 * Rotas protegidas de exemplo (placeholder pós-login). Provam que o gate do
 * Express funciona e que `req.db` (isolado por RLS para o tenant da sessão)
 * só enxerga dados do próprio tenant. As rotas de negócio de verdade chegam no
 * Épico 1.
 */
export const meRouter = Router();

// Quem sou eu + qual a loja ativa. Usado pelo front para decidir o redirect.
meRouter.get("/me", requireAuth, (req, res) => {
  void (async () => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    res.json({
      user: session
        ? {
            id: session.user.id,
            email: session.user.email,
            name: session.user.name,
          }
        : null,
      tenantId: req.tenantId,
      role: req.role,
    });
  })();
});

// Lista os produtos do tenant ativo. req.db já vem isolado por RLS — esta rota é
// a prova de que A não vê dados de B (o tenant vem da SESSÃO, não do cliente).
meRouter.get("/me/products", requireAuth, (req, res, next) => {
  void (async () => {
    const products = await req.db!.product.findMany({
      select: { id: true, name: true, status: true },
      orderBy: { name: "asc" },
    });
    res.json({ tenantId: req.tenantId, products });
  })().catch(next);
});
