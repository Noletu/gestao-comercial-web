import type { Request, Response } from "express";

/**
 * Handler 404 para qualquer rota não registrada. Vem antes do error handler na
 * cadeia de middlewares (ver app.ts).
 */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ status: "error", message: "Recurso não encontrado" });
}
