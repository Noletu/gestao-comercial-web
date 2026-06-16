import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { adminPrisma, prisma } from "../../db/index.js";

/**
 * PROVA NÃO-NEGOCIÁVEL (segurança):
 *  - O gate real é no Express: request sem sessão é recusado (401).
 *  - Auth + RLS juntos: um usuário autenticado do tenant A NÃO acessa dados do
 *    tenant B. O tenant vem da SESSÃO (resolvido do Membership), não do cliente.
 */

const app = createApp();

async function truncateAll(): Promise<void> {
  await adminPrisma.$executeRawUnsafe(
    `TRUNCATE TABLE "stock_movement","inventory_level","variant","product",` +
      `"location","membership","nuvemshop_connection","sync_state",` +
      `"two_factor","session","account","verification","tenant","user" ` +
      `RESTART IDENTITY CASCADE`,
  );
}

/** Cria um tenant com 1 produto e um usuário OWNER já logado (agent com cookie). */
async function setupTenantWithUser(
  name: string,
  email: string,
): Promise<{
  tenantId: string;
  productId: string;
  agent: ReturnType<typeof request.agent>;
}> {
  const tenant = await adminPrisma.tenant.create({ data: { name } });
  const product = await adminPrisma.product.create({
    data: { tenantId: tenant.id, name: `Produto ${name}` },
  });

  const agent = request.agent(app);
  await agent
    .post("/api/auth/sign-up/email")
    .send({ email, password: "Senha!12345", name: `User ${name}` })
    .expect((res) => {
      if (res.status >= 400)
        throw new Error(`signup falhou: ${res.status} ${res.text}`);
    });

  const user = await adminPrisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("usuário não criado");
  await adminPrisma.membership.create({
    data: { tenantId: tenant.id, userId: user.id, role: "OWNER" },
  });

  return { tenantId: tenant.id, productId: product.id, agent };
}

let tenantA: Awaited<ReturnType<typeof setupTenantWithUser>>;
let tenantB: Awaited<ReturnType<typeof setupTenantWithUser>>;

beforeAll(async () => {
  await truncateAll();
  tenantA = await setupTenantWithUser("A", "user.a@example.com");
  tenantB = await setupTenantWithUser("B", "user.b@example.com");
});

afterAll(async () => {
  await prisma.$disconnect();
  await adminPrisma.$disconnect();
});

describe("Gate de autenticação no Express", () => {
  it("recusa request sem sessão (401)", async () => {
    const res = await request(app).get("/api/me");
    expect(res.status).toBe(401);
  });

  it("aceita request com sessão válida e devolve o tenant ativo", async () => {
    const res = await tenantA.agent.get("/api/me");
    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe(tenantA.tenantId);
    expect(res.body.role).toBe("OWNER");
    expect(res.body.user.email).toBe("user.a@example.com");
  });
});

describe("Isolamento multi-tenant (auth + RLS)", () => {
  it("usuário do tenant A só vê produtos do tenant A", async () => {
    const res = await tenantA.agent.get("/api/me/products");
    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe(tenantA.tenantId);
    expect(res.body.products).toHaveLength(1);
    expect(res.body.products[0].id).toBe(tenantA.productId);
  });

  it("usuário do tenant A NÃO acessa dados do tenant B", async () => {
    const res = await tenantA.agent.get("/api/me/products");
    const ids = res.body.products.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(tenantB.productId);
  });

  it("usuário do tenant B só vê os próprios dados", async () => {
    const res = await tenantB.agent.get("/api/me/products");
    expect(res.body.tenantId).toBe(tenantB.tenantId);
    expect(res.body.products).toHaveLength(1);
    expect(res.body.products[0].id).toBe(tenantB.productId);
  });
});
