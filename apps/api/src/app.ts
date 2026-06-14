import express, { type Express } from "express";
import { healthRouter } from "./routes/health.route";
import { tenantContext } from "./middlewares/tenantContext.middleware";
import { notFoundHandler } from "./middlewares/notFound.middleware";
import { errorHandler } from "./middlewares/error.middleware";

/**
 * Monta a aplicação Express sem iniciar o servidor (o `listen` fica no index.ts).
 * Separar a construção da escuta deixa o app importável em testes futuros sem
 * ocupar uma porta.
 */
export function createApp(): Express {
  const app = express();

  app.use(express.json());

  // Contexto de tenant (RLS) por request. No-op até a auth (issue #3) popular
  // req.tenantId; rotas de negócio com banco chegam no Épico 1.
  app.use(tenantContext);

  // Rotas da aplicação.
  app.use(healthRouter);

  // 404 e erro centralizado por último, nesta ordem.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
