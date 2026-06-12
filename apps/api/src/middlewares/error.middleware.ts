import type { NextFunction, Request, Response } from "express";

/**
 * Middleware de erro centralizado. Sem lógica de negócio: apenas garante uma
 * resposta JSON consistente e não vaza detalhes internos em produção.
 *
 * O Express só reconhece um handler como "de erro" se ele tiver os 4 parâmetros
 * (err, req, res, next) — por isso `_next` existe mesmo sem ser usado.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const isProduction = process.env.NODE_ENV === "production";
  const message =
    err instanceof Error ? err.message : "Erro interno inesperado";

  console.error("[error]", err);

  res.status(500).json({
    status: "error",
    message: isProduction ? "Erro interno do servidor" : message,
  });
}
