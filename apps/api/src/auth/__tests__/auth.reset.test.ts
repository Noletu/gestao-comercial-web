import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { adminPrisma, prisma } from "../../db/index.js";
import { emailSender } from "../email.js";

/**
 * Critério #3: fluxo de "esqueci minha senha" — gera token, troca a senha,
 * invalida o token usado. O envio de email é abstraído (ConsoleEmailSender);
 * lemos o link do "outbox" em memória.
 */

const app = createApp();
const email = "reset.user@example.com";
const OLD_PASSWORD = "SenhaAntiga!1";
const NEW_PASSWORD = "SenhaNova!2";

function extractToken(resetUrl: string): string {
  const url = new URL(resetUrl);
  const fromQuery = url.searchParams.get("token");
  if (fromQuery) return fromQuery;
  // fallback: último segmento do path
  const seg = url.pathname.split("/").filter(Boolean).pop();
  if (!seg) throw new Error(`token não encontrado em ${resetUrl}`);
  return seg;
}

beforeAll(async () => {
  await adminPrisma.$executeRawUnsafe(
    `TRUNCATE TABLE "two_factor","session","account","verification",` +
      `"membership","tenant","user" RESTART IDENTITY CASCADE`,
  );
  await request(app)
    .post("/api/auth/sign-up/email")
    .send({ email, password: OLD_PASSWORD, name: "Reset User" })
    .expect((res) => {
      if (res.status >= 400)
        throw new Error(`signup: ${res.status} ${res.text}`);
    });
});

afterAll(async () => {
  await prisma.$disconnect();
  await adminPrisma.$disconnect();
});

describe("Recuperação de senha", () => {
  let token: string;

  it("request-password-reset gera um token e 'envia' o link", async () => {
    emailSender.outbox.length = 0;
    const res = await request(app)
      .post("/api/auth/request-password-reset")
      .send({ email, redirectTo: "http://localhost:3000/reset-password" });
    expect(res.status).toBe(200);
    expect(emailSender.outbox).toHaveLength(1);
    expect(emailSender.outbox[0]?.to).toBe(email);
    token = extractToken(emailSender.outbox[0]!.resetUrl);
    expect(token.length).toBeGreaterThan(10);
  });

  it("reset-password troca a senha; login novo funciona, o antigo não", async () => {
    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ newPassword: NEW_PASSWORD, token });
    expect(reset.status).toBe(200);

    const withNew = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email, password: NEW_PASSWORD });
    expect(withNew.status).toBe(200);

    const withOld = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email, password: OLD_PASSWORD });
    expect(withOld.status).toBeGreaterThanOrEqual(400);
  });

  it("o token usado é invalidado (não serve de novo)", async () => {
    const reuse = await request(app)
      .post("/api/auth/reset-password")
      .send({ newPassword: "OutraSenha!3", token });
    expect(reuse.status).toBeGreaterThanOrEqual(400);
  });
});
