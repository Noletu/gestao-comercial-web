import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { adminPrisma, prisma } from "../../db/index.js";

/**
 * PROVA (spec estoque-interface-parte-1.md §5.4 itens 1 e 2): categoria de
 * uma loja nunca aparece, é editada ou é vinculada a um produto de outra
 * loja; e nome repetido (ignorando maiúsculas e espaços nas pontas) responde
 * 400 amigável, inclusive sob corrida real — nunca 500.
 */

const app = createApp();

async function truncateAll(): Promise<void> {
  await adminPrisma.$executeRawUnsafe(
    `TRUNCATE TABLE "stock_movement","inventory_level","variant","product","category",` +
      `"location","membership","nuvemshop_connection","sync_state",` +
      `"two_factor","session","account","verification","tenant","user" ` +
      `RESTART IDENTITY CASCADE`,
  );
}

interface TenantFixture {
  tenantId: string;
  agent: ReturnType<typeof request.agent>;
}

async function setupTenantWithUser(
  name: string,
  email: string,
): Promise<TenantFixture> {
  const tenant = await adminPrisma.tenant.create({ data: { name } });
  await adminPrisma.location.create({
    data: { tenantId: tenant.id, name: "Loja", isDefault: true },
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

  return { tenantId: tenant.id, agent };
}

let tenantA: TenantFixture;
let tenantB: TenantFixture;

beforeAll(async () => {
  await truncateAll();
  tenantA = await setupTenantWithUser("CatA", "cat.a@example.com");
  tenantB = await setupTenantWithUser("CatB", "cat.b@example.com");
});

afterAll(async () => {
  await prisma.$disconnect();
  await adminPrisma.$disconnect();
});

interface CategoryItem {
  id: string;
  name: string;
  productCount: number;
}

describe("POST /api/categories", () => {
  it("cria categoria e devolve id/nome/contagem zero", async () => {
    const res = await tenantA.agent.post("/api/categories").send({ name: "Calça" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Calça", productCount: 0 });
  });

  it("nome vazio (só espaços) responde 400, não 500", async () => {
    const res = await tenantA.agent.post("/api/categories").send({ name: "   " });
    expect(res.status).toBe(400);
  });

  it("nome repetido (ignorando maiúsculas e espaços nas pontas) responde 400 amigável, não 500", async () => {
    await tenantA.agent.post("/api/categories").send({ name: "Camisa" });
    const res = await tenantA.agent.post("/api/categories").send({ name: "  camisa  " });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Essa categoria já existe.");
  });

  it("duas criações simultâneas com nomes que só diferem em caixa/espaço: uma 201 e uma 400, nenhuma 500 (corrida real)", async () => {
    const results = await Promise.all([
      tenantA.agent.post("/api/categories").send({ name: "Corrida" }),
      tenantA.agent.post("/api/categories").send({ name: " corrida " }),
    ]);
    const statuses = results.map((r) => r.status).sort((a, b) => a - b);
    expect(statuses).toEqual([201, 400]);
  });

  it("mesmo nome em lojas diferentes não colide — unicidade é por loja", async () => {
    const res = await tenantB.agent.post("/api/categories").send({ name: "Calça" });
    expect(res.status).toBe(201);
  });
});

describe("GET /api/categories", () => {
  it("lista em ordem alfabética com a contagem de peças de cada categoria", async () => {
    const created = await tenantA.agent
      .post("/api/categories")
      .send({ name: "Vestidos Listagem" });
    const categoryId = created.body.id as string;
    await tenantA.agent
      .post("/api/products")
      .send({ name: "Vestido Longo Listagem", categoryId });

    const res = await tenantA.agent.get("/api/categories");
    expect(res.status).toBe(200);
    const categories = res.body.categories as CategoryItem[];
    const names = categories.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    const found = categories.find((c) => c.id === categoryId);
    expect(found?.productCount).toBe(1);
  });

  it("categoria de uma loja nunca aparece na lista de outra loja", async () => {
    const created = await tenantB.agent
      .post("/api/categories")
      .send({ name: "Exclusiva B Listagem" });
    const res = await tenantA.agent.get("/api/categories");
    const ids = (res.body.categories as CategoryItem[]).map((c) => c.id);
    expect(ids).not.toContain(created.body.id);
  });
});

describe("PATCH /api/categories/:id", () => {
  it("renomeia e devolve o novo nome", async () => {
    const created = await tenantA.agent.post("/api/categories").send({ name: "Nome Antigo" });
    const res = await tenantA.agent
      .patch(`/api/categories/${created.body.id}`)
      .send({ name: "Nome Novo" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Nome Novo");
  });

  it("renomear para um nome já existente (ignorando caixa/espaços) responde 400, não 500", async () => {
    await tenantA.agent.post("/api/categories").send({ name: "Alvo Existente" });
    const created = await tenantA.agent.post("/api/categories").send({ name: "A Renomear" });
    const res = await tenantA.agent
      .patch(`/api/categories/${created.body.id}`)
      .send({ name: " alvo existente " });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Essa categoria já existe.");
  });

  it("uma loja nunca edita nem vincula produto à categoria de outra loja", async () => {
    const categoryB = await tenantB.agent
      .post("/api/categories")
      .send({ name: "Categoria So Da B" });

    const renameRes = await tenantA.agent
      .patch(`/api/categories/${categoryB.body.id}`)
      .send({ name: "Tentativa Indevida" });
    expect(renameRes.status).toBe(400);
    expect(renameRes.body.error).toBe("Categoria não encontrada.");

    const linkRes = await tenantA.agent
      .post("/api/products")
      .send({ name: "Produto A Tentando Vincular", categoryId: categoryB.body.id as string });
    expect(linkRes.status).toBe(400);
    expect(linkRes.body.error).toBe("Categoria não encontrada.");
  });
});
