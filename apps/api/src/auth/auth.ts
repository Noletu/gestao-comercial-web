import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { twoFactor } from "better-auth/plugins";
import { prisma } from "../db/index.js";
import { env } from "../lib/env.js";
import { emailSender } from "./email.js";

/**
 * Better Auth self-hosted no nosso Postgres.
 *
 * Decisões:
 *  - **Prisma adapter sobre o MESMO banco**: as tabelas de auth (user, session,
 *    account, verification, two_factor) vivem no nosso schema Prisma e são
 *    migradas pelo Prisma — não há um segundo banco nem migrations paralelas.
 *    Better Auth só lê/escreve via o client `prisma` (role app_user). Essas
 *    tabelas são identidade global (sem RLS), como já era o caso de `user`.
 *  - **generateId: "uuid"**: Better Auth gera UUIDs, compatíveis com as colunas
 *    @db.Uuid e com os FKs existentes (membership.user_id).
 *  - **Hash de senha, expiração de sessão e tokens de reset**: defaults seguros da
 *    lib (senha = scrypt; sessão = 7 dias com refresh; token de reset = 1h, uso
 *    único). Não reimplementamos criptografia.
 *  - **2FA (TOTP) OPCIONAL**: plugin habilitado, mas o usuário ativa se quiser.
 */
export const auth = betterAuth({
  appName: "Gestão Comercial",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  advanced: {
    database: { generateId: "uuid" },
    // Cookie de sessão (httpOnly por default).
    //  - Dev: front (:3000) e api (:3001) são same-site (localhost) → Lax basta.
    //  - Prod: no Railway o front e a api ficam em DOMÍNIOS distintos
    //    (web-*.up.railway.app vs api-*.up.railway.app). O navegador só envia o
    //    cookie numa requisição cross-site com credentials se ele for
    //    SameSite=None; e None exige Secure (HTTPS) — que o Railway provê.
    defaultCookieAttributes: {
      sameSite: env.NODE_ENV === "production" ? "none" : "lax",
      secure: env.NODE_ENV === "production",
    },
  },
  trustedOrigins: [env.WEB_ORIGIN],
  emailAndPassword: {
    enabled: true,
    // Login do casal sem fricção: não exigimos verificação de email no MVP.
    requireEmailVerification: false,
    sendResetPassword: async ({ user, url }) => {
      await emailSender.sendPasswordReset(user.email, url);
    },
  },
  plugins: [twoFactor()],
});

export type Auth = typeof auth;
