import express, { type Express } from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth/auth.js";
import { env } from "./lib/env.js";
import { healthRouter } from "./routes/health.route.js";
import { meRouter } from "./routes/me.route.js";
import { notFoundHandler } from "./middlewares/notFound.middleware.js";
import { errorHandler } from "./middlewares/error.middleware.js";

/**
 * Monta a aplicação Express sem iniciar o servidor (o `listen` fica no index.ts).
 */
export function createApp(): Express {
  const app = express();

  // CORS com credenciais: o front (WEB_ORIGIN) envia o cookie de sessão.
  // Origin específico (não "*") é obrigatório quando credentials=true.
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));

  // Better Auth monta /api/auth/* (login, signup, reset, 2FA...). DEVE vir ANTES
  // do express.json(): o handler precisa do corpo cru da requisição.
  app.all("/api/auth/*", toNodeHandler(auth));

  app.use(express.json());

  app.use(healthRouter); // GET /health (healthcheck do Railway)
  app.use("/api", meRouter); // GET /api/me, /api/me/products (protegidas)

  // 404 e erro centralizado por último, nesta ordem.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
