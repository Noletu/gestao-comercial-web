import type { NextFunction, Request, Response } from "express";
import { forTenant } from "../db";

/**
 * Anexa ao request um client Prisma já isolado por RLS para o tenant do usuário.
 *
 * `req.tenantId` é definido pela camada de auth (issue #3), tipicamente a partir
 * do Membership do usuário autenticado. Enquanto a auth não existe, nenhuma rota
 * de negócio consome `req.db` (issue #2 entrega só schema + acesso a dados), então
 * o middleware apenas segue quando não há tenant — sem vazar nada.
 */
export function tenantContext(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (req.tenantId) {
    req.db = forTenant(req.tenantId);
  }
  next();
}
