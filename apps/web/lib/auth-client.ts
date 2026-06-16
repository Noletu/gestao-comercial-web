import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

/**
 * Cliente Better Auth do front. Aponta para a API Express (backend separado).
 * As chamadas vão para `${baseURL}/api/auth/*` com cookie httpOnly (credentials).
 *
 * Importante: a proteção REAL é no servidor (ver requireAuth no apps/api). Este
 * cliente serve para UX (formulários, redirecionar quem não tem sessão).
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
  plugins: [twoFactorClient()],
});
