import { Router } from "express";
import { getHealth } from "../services/health.service.js";

/**
 * GET /health — usado pelo healthcheck do Railway (issue #4).
 * Resposta: { status: "ok", timestamp }.
 */
export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.status(200).json(getHealth());
});
