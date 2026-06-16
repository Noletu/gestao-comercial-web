import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { authenticator } from "otplib";
import { createApp } from "../../app.js";
import { adminPrisma, prisma } from "../../db/index.js";

/**
 * Critério #4: 2FA (TOTP) OPCIONAL.
 *  - Ativar gera segredo TOTP (+ backup codes); verificar confirma.
 *  - Com 2FA ativo, o login passa a exigir o código (twoFactorRedirect).
 *  - Desativar volta ao login normal.
 *
 * O header Origin é obrigatório nas rotas sensíveis do Better Auth (proteção
 * anti-CSRF) — o navegador o envia; nos testes setamos explicitamente.
 */

const app = createApp();
const ORIGIN = "http://localhost:3000";
const email = "tfa.user@example.com";
const password = "Senha2fa!123";

const agent = request.agent(app);
let secret: string;

beforeAll(async () => {
  await adminPrisma.$executeRawUnsafe(
    `TRUNCATE TABLE "two_factor","session","account","verification",` +
      `"membership","tenant","user" RESTART IDENTITY CASCADE`,
  );
  await agent
    .post("/api/auth/sign-up/email")
    .set("Origin", ORIGIN)
    .send({ email, password, name: "TFA User" });
});

afterAll(async () => {
  await prisma.$disconnect();
  await adminPrisma.$disconnect();
});

async function twoFactorEnabled(): Promise<boolean> {
  const u = await adminPrisma.user.findUnique({
    where: { email },
    select: { twoFactorEnabled: true },
  });
  return u?.twoFactorEnabled ?? false;
}

describe("2FA (TOTP) opcional", () => {
  it("ativar gera segredo TOTP e backup codes; verificar confirma", async () => {
    const enable = await agent
      .post("/api/auth/two-factor/enable")
      .set("Origin", ORIGIN)
      .send({ password });
    expect(enable.status).toBe(200);
    expect(Array.isArray(enable.body.backupCodes)).toBe(true);

    const totpSecret = new URL(enable.body.totpURI as string).searchParams.get(
      "secret",
    );
    expect(totpSecret).toBeTruthy();
    secret = totpSecret!;

    const verify = await agent
      .post("/api/auth/two-factor/verify-totp")
      .set("Origin", ORIGIN)
      .send({ code: authenticator.generate(secret) });
    expect(verify.status).toBe(200);
    expect(await twoFactorEnabled()).toBe(true);
  });

  it("com 2FA ativo, o login exige o código TOTP", async () => {
    const loginAgent = request.agent(app);
    const signin = await loginAgent
      .post("/api/auth/sign-in/email")
      .set("Origin", ORIGIN)
      .send({ email, password });
    expect(signin.status).toBe(200);
    // Sessão NÃO é estabelecida ainda — precisa do 2º fator.
    expect(signin.body.twoFactorRedirect).toBe(true);

    const verify = await loginAgent
      .post("/api/auth/two-factor/verify-totp")
      .set("Origin", ORIGIN)
      .send({ code: authenticator.generate(secret) });
    expect(verify.status).toBe(200);
    expect(verify.body.token).toBeTruthy();
  });

  it("desativar 2FA volta ao login normal (sem 2º fator)", async () => {
    const disable = await agent
      .post("/api/auth/two-factor/disable")
      .set("Origin", ORIGIN)
      .send({ password });
    expect(disable.status).toBe(200);
    expect(await twoFactorEnabled()).toBe(false);

    const loginAgent = request.agent(app);
    const signin = await loginAgent
      .post("/api/auth/sign-in/email")
      .set("Origin", ORIGIN)
      .send({ email, password });
    expect(signin.status).toBe(200);
    expect(signin.body.twoFactorRedirect).toBeFalsy();
  });
});
