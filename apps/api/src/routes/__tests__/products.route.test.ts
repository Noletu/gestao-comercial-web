import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { adminPrisma, prisma } from "../../db/index.js";

/**
 * PROVA (spec estoque-manual.md §7): as três rotas novas (GET /api/products,
 * POST /api/products, POST /api/products/:variantId/movements) respeitam o
 * contrato — busca por nome, SKU duplicado responde 400 amigável (inclusive
 * sob corrida real), erros de validação nunca caem no 500 genérico, e uma loja
 * nunca lista/cria/movimenta nada de outra loja.
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

async function createVariant(
  tenantId: string,
  name: string,
  opts: { sku?: string; stock?: number } = {},
): Promise<string> {
  const product = await adminPrisma.product.create({ data: { tenantId, name } });
  const variant = await adminPrisma.variant.create({
    data: { tenantId, productId: product.id, sku: opts.sku },
  });
  if (opts.stock) {
    const location = await adminPrisma.location.findFirstOrThrow({
      where: { tenantId, isDefault: true },
    });
    await adminPrisma.stockMovement.create({
      data: {
        tenantId,
        variantId: variant.id,
        locationId: location.id,
        quantity: opts.stock,
        type: "ADJUSTMENT",
        source: "INITIAL_SYNC",
      },
    });
    await adminPrisma.inventoryLevel.upsert({
      where: { variantId_locationId: { variantId: variant.id, locationId: location.id } },
      create: { tenantId, variantId: variant.id, locationId: location.id, stock: opts.stock },
      update: { stock: opts.stock },
    });
  }
  return variant.id;
}

let tenantA: TenantFixture;
let tenantB: TenantFixture;

beforeAll(async () => {
  await truncateAll();
  tenantA = await setupTenantWithUser("A", "prod.a@example.com");
  tenantB = await setupTenantWithUser("B", "prod.b@example.com");
});

afterAll(async () => {
  await prisma.$disconnect();
  await adminPrisma.$disconnect();
});

interface ProductListItem {
  variantId: string;
  productId: string;
  name: string;
  sku: string | null;
  stock: number;
}

describe("GET /api/products", () => {
  it("lista os itens do tenant ativo, achatados (1 linha por variante)", async () => {
    const variantId = await createVariant(tenantA.tenantId, "Vestido Floral", {
      sku: "V1",
      stock: 5,
    });
    const res = await tenantA.agent.get("/api/products");
    expect(res.status).toBe(200);
    const item = (res.body.products as ProductListItem[]).find(
      (p) => p.variantId === variantId,
    );
    expect(item).toMatchObject({ name: "Vestido Floral", sku: "V1", stock: 5 });
  });

  it("variante sem nenhuma movimentação aparece com estoque 0 (não erro)", async () => {
    const variantId = await createVariant(tenantA.tenantId, "Sem Movimento");
    const res = await tenantA.agent.get("/api/products");
    expect(res.status).toBe(200);
    const item = (res.body.products as ProductListItem[]).find(
      (p) => p.variantId === variantId,
    );
    expect(item?.stock).toBe(0);
  });

  it("busca por nome parcial, case-insensitive, filtra a lista", async () => {
    await createVariant(tenantA.tenantId, "Calça Jeans Azul");
    const res = await tenantA.agent.get("/api/products").query({ q: "jeans" });
    expect(res.status).toBe(200);
    const products = res.body.products as ProductListItem[];
    expect(products.length).toBeGreaterThan(0);
    expect(products.every((p) => p.name.toLowerCase().includes("jeans"))).toBe(
      true,
    );
  });

  it("uma loja não lista produtos de outra loja", async () => {
    const variantB = await createVariant(tenantB.tenantId, "Produto Exclusivo B");
    const res = await tenantA.agent.get("/api/products");
    const ids = (res.body.products as ProductListItem[]).map((p) => p.variantId);
    expect(ids).not.toContain(variantB);
  });
});

describe("POST /api/products", () => {
  it("cria produto+variante e devolve o item com estoque 0", async () => {
    const res = await tenantA.agent
      .post("/api/products")
      .send({ name: "Blusa Nova", sku: "BLZ-NOVA" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Blusa Nova",
      sku: "BLZ-NOVA",
      stock: 0,
    });
  });

  it("SKU duplicado responde 400 com mensagem amigável, não cai no 500 genérico", async () => {
    await tenantA.agent.post("/api/products").send({ name: "Item Um", sku: "DUP-1" });
    const res = await tenantA.agent
      .post("/api/products")
      .send({ name: "Item Dois", sku: "DUP-1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "Esse código já está sendo usado por outro produto.",
    );
  });

  it("dois cadastros com o mesmo SKU ao mesmo tempo: um 201 e um 400, nenhum 500", async () => {
    const results = await Promise.all([
      tenantA.agent
        .post("/api/products")
        .send({ name: "Concorrente A", sku: "RACE-SKU" }),
      tenantA.agent
        .post("/api/products")
        .send({ name: "Concorrente B", sku: "RACE-SKU" }),
    ]);
    const statuses = results.map((r) => r.status).sort((a, b) => a - b);
    expect(statuses).toEqual([201, 400]);
  });

  it("nome vazio responde 400, não 500", async () => {
    const res = await tenantA.agent.post("/api/products").send({ name: "" });
    expect(res.status).toBe(400);
  });

  it("produto criado por uma loja não aparece na lista de outra loja", async () => {
    const res = await tenantB.agent.post("/api/products").send({ name: "Produto da B" });
    expect(res.status).toBe(201);
    const listA = await tenantA.agent.get("/api/products");
    expect(
      (listA.body.products as ProductListItem[]).some(
        (p) => p.name === "Produto da B",
      ),
    ).toBe(false);
  });
});

describe("POST /api/products/:variantId/movements", () => {
  it("registra uma Entrada e devolve o estoque atualizado", async () => {
    const variantId = await createVariant(tenantA.tenantId, "Item Movimentado");
    const res = await tenantA.agent
      .post(`/api/products/${variantId}/movements`)
      .send({ kind: "entrada", quantity: 4 });
    expect(res.status).toBe(200);
    expect(res.body.stock).toBe(4);
  });

  it("Saída maior que o saldo responde 400 com a mensagem exata", async () => {
    const variantId = await createVariant(tenantA.tenantId, "Item Pequeno", {
      stock: 2,
    });
    const res = await tenantA.agent
      .post(`/api/products/${variantId}/movements`)
      .send({ kind: "saida", quantity: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Só há 2 em estoque.");
  });

  it("Ajuste com contagem igual ao saldo responde sucesso sem gravar nada", async () => {
    const variantId = await createVariant(tenantA.tenantId, "Item Ajustado", {
      stock: 6,
    });
    const res = await tenantA.agent
      .post(`/api/products/${variantId}/movements`)
      .send({ kind: "ajuste", quantity: 6 });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Estoque já está correto");
  });

  it("quantidade zero em entrada é inválida e responde 400, não 500", async () => {
    const variantId = await createVariant(tenantA.tenantId, "Item Validação");
    const res = await tenantA.agent
      .post(`/api/products/${variantId}/movements`)
      .send({ kind: "entrada", quantity: 0 });
    expect(res.status).toBe(400);
  });

  it("não lança movimentação na variante de outra loja", async () => {
    const variantB = await createVariant(tenantB.tenantId, "Produto Exclusivo B2");
    const res = await tenantA.agent
      .post(`/api/products/${variantB}/movements`)
      .send({ kind: "entrada", quantity: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Produto não encontrado.");
  });
});
