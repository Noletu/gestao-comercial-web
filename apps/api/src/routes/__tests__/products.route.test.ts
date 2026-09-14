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

async function createVariant(
  tenantId: string,
  name: string,
  opts: {
    sku?: string;
    stock?: number;
    price?: number;
    cost?: number;
    categoryId?: string;
    status?: "ACTIVE" | "ARCHIVED";
  } = {},
): Promise<string> {
  const product = await adminPrisma.product.create({
    data: { tenantId, name, categoryId: opts.categoryId, status: opts.status ?? "ACTIVE" },
  });
  const variant = await adminPrisma.variant.create({
    data: { tenantId, productId: product.id, sku: opts.sku, price: opts.price, cost: opts.cost },
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
  price: number | null;
  cost: number | null;
  margin: number | null;
  status: "ativo" | "inativo";
  category: { id: string; name: string } | null;
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

/**
 * PROVA (spec estoque-busca-filtro-preco.md §4.1/4.2/4.3): busca por SKU além
 * de nome, filtro de estoque baixo (≤ 2, inclui zerado), combinação de busca +
 * filtro (E, não OU), e margem calculada/nula nos casos certos.
 */
describe("GET /api/products - busca por SKU e filtro de estoque baixo", () => {
  it("busca por SKU (além de nome), case-insensitive, contains", async () => {
    const variantId = await createVariant(tenantA.tenantId, "Anel Dourado Único", {
      sku: "COD-EXCLUSIVO-777",
    });
    const res = await tenantA.agent.get("/api/products").query({ q: "exclusivo-777" });
    expect(res.status).toBe(200);
    const ids = (res.body.products as ProductListItem[]).map((p) => p.variantId);
    expect(ids).toContain(variantId);
  });

  it("lowStock=true traz só itens com estoque <= 2 (inclui zerado) e não traz o resto", async () => {
    const zeroId = await createVariant(tenantA.tenantId, "Peça Zerada Filtro");
    const lowId = await createVariant(tenantA.tenantId, "Peça Baixa Filtro", { stock: 2 });
    const okId = await createVariant(tenantA.tenantId, "Peça Ok Filtro", { stock: 10 });
    const res = await tenantA.agent.get("/api/products").query({ lowStock: "true" });
    expect(res.status).toBe(200);
    const ids = (res.body.products as ProductListItem[]).map((p) => p.variantId);
    expect(ids).toContain(zeroId);
    expect(ids).toContain(lowId);
    expect(ids).not.toContain(okId);
  });

  it("q e lowStock juntos combinam (E, não OU)", async () => {
    const matchLow = await createVariant(tenantA.tenantId, "Combo Filtro Junto Baixo", {
      stock: 1,
    });
    const matchHigh = await createVariant(tenantA.tenantId, "Combo Filtro Junto Alto", {
      stock: 20,
    });
    const res = await tenantA.agent
      .get("/api/products")
      .query({ q: "combo filtro junto", lowStock: "true" });
    expect(res.status).toBe(200);
    const ids = (res.body.products as ProductListItem[]).map((p) => p.variantId);
    expect(ids).toContain(matchLow);
    expect(ids).not.toContain(matchHigh);
  });
});

describe("GET /api/products - preço, custo e margem", () => {
  it("inclui price, cost e margin calculados no item da lista", async () => {
    const created = await tenantA.agent
      .post("/api/products")
      .send({ name: "Item Com Margem Listagem", price: 200, cost: 150 });
    const res = await tenantA.agent.get("/api/products");
    const item = (res.body.products as ProductListItem[]).find(
      (p) => p.variantId === created.body.variantId,
    );
    expect(item).toMatchObject({ price: 200, cost: 150, margin: 25 });
  });

  it("margem é null quando falta price", async () => {
    const created = await tenantA.agent
      .post("/api/products")
      .send({ name: "Sem Preço Margem", cost: 10 });
    expect(created.body.price).toBeNull();
    expect(created.body.margin).toBeNull();
  });

  it("margem é null quando falta cost", async () => {
    const created = await tenantA.agent
      .post("/api/products")
      .send({ name: "Sem Custo Margem", price: 50 });
    expect(created.body.cost).toBeNull();
    expect(created.body.margin).toBeNull();
  });

  it("margem é null quando price é 0 (nunca 0% nem Infinity)", async () => {
    const created = await tenantA.agent
      .post("/api/products")
      .send({ name: "Preço Zero Margem", price: 0, cost: 5 });
    expect(created.body.margin).toBeNull();
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

  it("aceita price e cost e devolve o item com eles preenchidos", async () => {
    const res = await tenantA.agent
      .post("/api/products")
      .send({ name: "Produto Com Preco Cadastro", price: 120, cost: 90 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ price: 120, cost: 90, margin: 25 });
  });

  it("rejeita price negativo com 400", async () => {
    const res = await tenantA.agent
      .post("/api/products")
      .send({ name: "Produto Preco Negativo", price: -1 });
    expect(res.status).toBe(400);
  });

  it("rejeita cost negativo com 400", async () => {
    const res = await tenantA.agent
      .post("/api/products")
      .send({ name: "Produto Custo Negativo", cost: -1 });
    expect(res.status).toBe(400);
  });
});

/**
 * PROVA (spec estoque-interface-parte-1.md §5.3/§5.4 — revisão pós-achado
 * crítico da revisão): edição usa update PARCIAL para TODO campo, inclusive
 * sku/price/cost. Chave AUSENTE preserva o valor atual; `null` explícito
 * limpa (vira "—"); SKU duplicado responde 400 (não 500); uma loja não edita
 * variante de outra loja.
 *
 * MUDANÇA DE CONTRATO em relação à versão anterior desta rota (spec
 * estoque-busca-filtro-preco.md §4.5, que tratava "campo ausente" como
 * "limpar" — full-replace): esse comportamento antigo permitia que um PATCH
 * parcial como `{ name, status: "inativo" }` (o botão Inativar da spec
 * estoque-interface-parte-1.md §6.2) zerasse sku/price/cost com HTTP 200 —
 * falha silenciosa em dado real. Os dois testes que documentavam a regra
 * antiga ("omitir... limpa o valor" e "sku vazio ou omitido... limpa o
 * valor") foram ajustados abaixo para a regra nova: omitido preserva, só
 * `null`/vazio explícito limpa.
 */
describe("PATCH /api/products/:variantId", () => {
  it("atualiza nome, sku, price e cost e devolve a margem recalculada", async () => {
    const variantId = await createVariant(tenantA.tenantId, "Produto Original Edicao");
    const res = await tenantA.agent
      .patch(`/api/products/${variantId}`)
      .send({ name: "Produto Editado", sku: "EDIT-SKU-1", price: 80, cost: 40 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      variantId,
      name: "Produto Editado",
      sku: "EDIT-SKU-1",
      price: 80,
      cost: 40,
      margin: 50,
    });
  });

  it("SKU duplicado na edição responde 400, não 500", async () => {
    await tenantA.agent
      .post("/api/products")
      .send({ name: "Item Existente Edicao", sku: "SKU-EDICAO-EXISTENTE" });
    const variantId = await createVariant(tenantA.tenantId, "Item A Editar Sku Duplicado");
    const res = await tenantA.agent
      .patch(`/api/products/${variantId}`)
      .send({ name: "Item A Editar Sku Duplicado", sku: "SKU-EDICAO-EXISTENTE" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "Esse código já está sendo usado por outro produto.",
    );
  });

  it("omitir price/cost na edição PRESERVA os valores atuais (não zera mais)", async () => {
    const created = await tenantA.agent
      .post("/api/products")
      .send({ name: "Com Custo Inicial Edicao", sku: "COM-CUSTO-1", price: 100, cost: 60 });
    const variantId = created.body.variantId as string;
    // Só `name` no corpo — nem sku, nem price, nem cost. Sob a regra ANTIGA
    // isso zerava os três; sob a regra nova (mesma do bug corrigido) preserva.
    const res = await tenantA.agent
      .patch(`/api/products/${variantId}`)
      .send({ name: "Com Custo Inicial Edicao Renomeada" });
    expect(res.status).toBe(200);
    expect(res.body.sku).toBe("COM-CUSTO-1");
    expect(res.body.price).toBe(100);
    expect(res.body.cost).toBe(60);
    expect(res.body.margin).toBe(40);
  });

  it("enviar `null` explicitamente em price limpa só o price, preserva sku e cost", async () => {
    const created = await tenantA.agent
      .post("/api/products")
      .send({ name: "Com Custo Inicial Null Explicito", sku: "COM-CUSTO-NULL-1", price: 100, cost: 60 });
    const variantId = created.body.variantId as string;
    const res = await tenantA.agent
      .patch(`/api/products/${variantId}`)
      .send({ name: "Com Custo Inicial Null Explicito", price: null });
    expect(res.status).toBe(200);
    expect(res.body.price).toBeNull();
    expect(res.body.margin).toBeNull();
    expect(res.body.sku).toBe("COM-CUSTO-NULL-1");
    expect(res.body.cost).toBe(60);
  });

  it("sku vazio (explícito) limpa o valor (vira null); sku omitido PRESERVA", async () => {
    const createdEmpty = await tenantA.agent
      .post("/api/products")
      .send({ name: "Com Sku Vazio Edicao", sku: "COM-SKU-VAZIO-1" });
    const resEmpty = await tenantA.agent
      .patch(`/api/products/${createdEmpty.body.variantId}`)
      .send({ name: "Com Sku Vazio Edicao", sku: "" });
    expect(resEmpty.status).toBe(200);
    expect(resEmpty.body.sku).toBeNull();

    const createdOmitido = await tenantA.agent
      .post("/api/products")
      .send({ name: "Com Sku Omitido Edicao", sku: "COM-SKU-OMITIDO-1" });
    // Sob a regra ANTIGA, omitir sku também limpava; sob a regra nova preserva.
    const resOmitido = await tenantA.agent
      .patch(`/api/products/${createdOmitido.body.variantId}`)
      .send({ name: "Com Sku Omitido Edicao" });
    expect(resOmitido.status).toBe(200);
    expect(resOmitido.body.sku).toBe("COM-SKU-OMITIDO-1");
  });

  it("nome vazio na edição responde 400, não 500", async () => {
    const variantId = await createVariant(tenantA.tenantId, "Produto Nome Vazio Edicao");
    const res = await tenantA.agent
      .patch(`/api/products/${variantId}`)
      .send({ name: "" });
    expect(res.status).toBe(400);
  });

  it("preço negativo na edição responde 400, não 500", async () => {
    const variantId = await createVariant(tenantA.tenantId, "Produto Preco Negativo Edicao");
    const res = await tenantA.agent
      .patch(`/api/products/${variantId}`)
      .send({ name: "Produto Preco Negativo Edicao", price: -10 });
    expect(res.status).toBe(400);
  });

  it("não edita variante de outra loja", async () => {
    const variantB = await createVariant(tenantB.tenantId, "Produto Exclusivo B Edicao");
    const res = await tenantA.agent
      .patch(`/api/products/${variantB}`)
      .send({ name: "Tentativa De Edicao Indevida" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Produto não encontrado.");
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

/**
 * PROVA (spec estoque-interface-parte-1.md §5.4 item 3): produto inativo some
 * da listagem por padrão, aparece com `status=todos`, e `status=inativos`
 * mostra só ele.
 */
describe("GET /api/products - filtro de situação (spec estoque-interface-parte-1.md §5.2/§5.3)", () => {
  it("sem filtro (padrão) não traz produto inativo", async () => {
    const activeId = await createVariant(tenantA.tenantId, "Peça Ativa Situacao Padrao");
    const archivedId = await createVariant(tenantA.tenantId, "Peça Inativa Situacao Padrao", {
      status: "ARCHIVED",
    });
    const res = await tenantA.agent.get("/api/products");
    const ids = (res.body.products as ProductListItem[]).map((p) => p.variantId);
    expect(ids).toContain(activeId);
    expect(ids).not.toContain(archivedId);
  });

  it("status=todos traz ativos e inativos", async () => {
    const activeId = await createVariant(tenantA.tenantId, "Peça Ativa Situacao Todos");
    const archivedId = await createVariant(tenantA.tenantId, "Peça Inativa Situacao Todos", {
      status: "ARCHIVED",
    });
    const res = await tenantA.agent.get("/api/products").query({ status: "todos" });
    const ids = (res.body.products as ProductListItem[]).map((p) => p.variantId);
    expect(ids).toContain(activeId);
    expect(ids).toContain(archivedId);
  });

  it("status=inativos só traz produto inativo", async () => {
    const activeId = await createVariant(tenantA.tenantId, "Peça Ativa Situacao Inativos");
    const archivedId = await createVariant(tenantA.tenantId, "Peça Inativa Situacao Inativos", {
      status: "ARCHIVED",
    });
    const res = await tenantA.agent.get("/api/products").query({ status: "inativos" });
    const ids = (res.body.products as ProductListItem[]).map((p) => p.variantId);
    expect(ids).toContain(archivedId);
    expect(ids).not.toContain(activeId);
  });

  it("status inválido responde 400, não 500", async () => {
    const res = await tenantA.agent.get("/api/products").query({ status: "banana" });
    expect(res.status).toBe(400);
  });
});

/**
 * PROVA (spec §5.4 item 4): inativar e reativar mudam só `status` — estoque e
 * o ledger de movimentações continuam intactos.
 */
describe("PATCH /api/products/:variantId - inativar e reativar (spec §5.2)", () => {
  it("inativar muda status para inativo sem alterar estoque nem apagar movimentação", async () => {
    const variantId = await createVariant(tenantA.tenantId, "Peça Para Inativar", { stock: 7 });
    const movementsBefore = await adminPrisma.stockMovement.count({ where: { variantId } });

    const res = await tenantA.agent
      .patch(`/api/products/${variantId}`)
      .send({ name: "Peça Para Inativar", status: "inativo" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("inativo");
    expect(res.body.stock).toBe(7);

    const movementsAfter = await adminPrisma.stockMovement.count({ where: { variantId } });
    expect(movementsAfter).toBe(movementsBefore);
    const level = await adminPrisma.inventoryLevel.findFirst({ where: { variantId } });
    expect(level?.stock).toBe(7);
  });

  it("reativar volta o status para ativo, sem alterar estoque", async () => {
    const variantId = await createVariant(tenantA.tenantId, "Peça Para Reativar", {
      stock: 3,
      status: "ARCHIVED",
    });
    const res = await tenantA.agent
      .patch(`/api/products/${variantId}`)
      .send({ name: "Peça Para Reativar", status: "ativo" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ativo");
    expect(res.body.stock).toBe(3);
  });

  it("editar sem enviar status não altera a situação atual", async () => {
    const variantId = await createVariant(tenantA.tenantId, "Peça Situacao Preservada", {
      status: "ARCHIVED",
    });
    const res = await tenantA.agent
      .patch(`/api/products/${variantId}`)
      .send({ name: "Peça Situacao Preservada Editada" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("inativo");
  });

  /**
   * REGRESSÃO (achado crítico de revisão): `PATCH { name, status }` — o
   * payload exato que o botão Inativar manda (spec §6.2) — rodava
   * `variant.update` incondicional em cima de sku/price/cost, zerando os três
   * com HTTP 200. Peça criada COM sku/price/cost reais, para o "antes" e o
   * "depois" serem distinguíveis (o bug não aparecia nos testes acima porque
   * as variantes eram criadas sem esses campos — null antes, null depois).
   */
  it("inativar preserva sku, price e cost intactos (regressão do achado crítico de revisão)", async () => {
    const variantId = await createVariant(tenantA.tenantId, "Peça Com Precos Para Inativar", {
      sku: "SKU-PRESERVA-INATIVAR",
      price: 150,
      cost: 90,
    });
    const res = await tenantA.agent
      .patch(`/api/products/${variantId}`)
      .send({ name: "Peça Com Precos Para Inativar", status: "inativo" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("inativo");
    expect(res.body.sku).toBe("SKU-PRESERVA-INATIVAR");
    expect(res.body.price).toBe(150);
    expect(res.body.cost).toBe(90);
  });
});

/**
 * PROVA (spec §5.4 item 5): filtro por categoria e "sem-categoria" na
 * listagem, e o item da lista carrega `category: {id, name} | null`.
 */
describe("GET /api/products - filtro por categoria (spec §5.3)", () => {
  it("filtra só as peças daquela categoria", async () => {
    const categoryRes = await tenantA.agent
      .post("/api/categories")
      .send({ name: "Calça Filtro Produtos" });
    const categoryId = categoryRes.body.id as string;
    const withCategory = await createVariant(tenantA.tenantId, "Calça Com Categoria", {
      categoryId,
    });
    const withoutCategory = await createVariant(tenantA.tenantId, "Peça Sem Categoria Filtro");

    const res = await tenantA.agent.get("/api/products").query({ categoryId });
    const ids = (res.body.products as ProductListItem[]).map((p) => p.variantId);
    expect(ids).toContain(withCategory);
    expect(ids).not.toContain(withoutCategory);
  });

  it("sem-categoria retorna só as peças sem vínculo", async () => {
    const categoryRes = await tenantA.agent
      .post("/api/categories")
      .send({ name: "Camisa Filtro Sem Categoria" });
    const categoryId = categoryRes.body.id as string;
    const withCategory = await createVariant(tenantA.tenantId, "Camisa Com Categoria Sc", {
      categoryId,
    });
    const withoutCategory = await createVariant(tenantA.tenantId, "Peça Sem Categoria Sc");

    const res = await tenantA.agent.get("/api/products").query({ categoryId: "sem-categoria" });
    const ids = (res.body.products as ProductListItem[]).map((p) => p.variantId);
    expect(ids).toContain(withoutCategory);
    expect(ids).not.toContain(withCategory);
  });

  it("item da lista traz a categoria vinculada ({id, name}) ou null", async () => {
    const categoryRes = await tenantA.agent
      .post("/api/categories")
      .send({ name: "Bolsas Item Lista" });
    const categoryId = categoryRes.body.id as string;
    const variantId = await createVariant(tenantA.tenantId, "Bolsa Com Categoria Item", {
      categoryId,
    });
    const res = await tenantA.agent.get("/api/products");
    const item = (res.body.products as ProductListItem[]).find((p) => p.variantId === variantId);
    expect(item?.category).toMatchObject({ id: categoryId, name: "Bolsas Item Lista" });

    const semCategoriaId = await createVariant(tenantA.tenantId, "Peça Sem Categoria Item Lista");
    const resSemCategoria = await tenantA.agent.get("/api/products");
    const itemSemCategoria = (resSemCategoria.body.products as ProductListItem[]).find(
      (p) => p.variantId === semCategoriaId,
    );
    expect(itemSemCategoria?.category).toBeNull();
  });

  it("categoryId inválido (não é uuid nem 'sem-categoria') responde 400, não 500", async () => {
    const res = await tenantA.agent.get("/api/products").query({ categoryId: "not-a-uuid" });
    expect(res.status).toBe(400);
  });

  it("editar o produto sem enviar categoryId não altera a categoria atual", async () => {
    const categoryRes = await tenantA.agent
      .post("/api/categories")
      .send({ name: "Sapatos Preserva Categoria" });
    const categoryId = categoryRes.body.id as string;
    const variantId = await createVariant(tenantA.tenantId, "Sapato Preserva Categoria", {
      categoryId,
    });

    const res = await tenantA.agent
      .patch(`/api/products/${variantId}`)
      .send({ name: "Sapato Preserva Categoria Editado" });
    expect(res.status).toBe(200);
    expect(res.body.category).toMatchObject({ id: categoryId, name: "Sapatos Preserva Categoria" });
  });

  it("editar o produto com categoryId explícito null limpa a categoria (vira 'Sem categoria')", async () => {
    const categoryRes = await tenantA.agent
      .post("/api/categories")
      .send({ name: "Acessorios Limpa Categoria" });
    const categoryId = categoryRes.body.id as string;
    const variantId = await createVariant(tenantA.tenantId, "Acessorio Limpa Categoria", {
      categoryId,
    });

    const res = await tenantA.agent
      .patch(`/api/products/${variantId}`)
      .send({ name: "Acessorio Limpa Categoria", categoryId: null });
    expect(res.status).toBe(200);
    expect(res.body.category).toBeNull();
  });

  /**
   * REGRESSÃO (achado crítico de revisão): `PATCH { name, categoryId }` — o
   * payload que a troca de categoria manda — também rodava `variant.update`
   * incondicional em cima de sku/price/cost. Peça criada COM sku/price/cost
   * reais para o "antes" e "depois" serem distinguíveis.
   */
  it("trocar categoria preserva sku, price e cost intactos (regressão do achado crítico de revisão)", async () => {
    const categoryRes = await tenantA.agent
      .post("/api/categories")
      .send({ name: "Camisas Preserva Precos" });
    const categoryId = categoryRes.body.id as string;
    const variantId = await createVariant(tenantA.tenantId, "Camisa Com Precos Trocar Categoria", {
      sku: "SKU-PRESERVA-CATEGORIA",
      price: 200,
      cost: 120,
    });

    const res = await tenantA.agent
      .patch(`/api/products/${variantId}`)
      .send({ name: "Camisa Com Precos Trocar Categoria", categoryId });
    expect(res.status).toBe(200);
    expect(res.body.category).toMatchObject({ id: categoryId });
    expect(res.body.sku).toBe("SKU-PRESERVA-CATEGORIA");
    expect(res.body.price).toBe(200);
    expect(res.body.cost).toBe(120);
  });

  it("editar sku/price/cost sem enviar categoryId preserva a categoria atual", async () => {
    const categoryRes = await tenantA.agent
      .post("/api/categories")
      .send({ name: "Calcados Preserva Categoria Edicao Precos" });
    const categoryId = categoryRes.body.id as string;
    const variantId = await createVariant(tenantA.tenantId, "Sapato Preserva Categoria Edicao Precos", {
      categoryId,
    });

    const res = await tenantA.agent
      .patch(`/api/products/${variantId}`)
      .send({
        name: "Sapato Preserva Categoria Edicao Precos",
        sku: "SKU-PRESERVA-CAT-EDIT",
        price: 80,
        cost: 30,
      });
    expect(res.status).toBe(200);
    expect(res.body.category).toMatchObject({ id: categoryId });
  });
});

/**
 * PROVA (spec §5.4 item 6): o alerta de estoque baixo e a contagem de peças
 * (tamanho da listagem padrão) ignoram produto inativo.
 */
describe("GET /api/products - estoque baixo e contagem ignoram produto inativo (spec §5.2)", () => {
  it("lowStock=true não traz peça inativa com estoque baixo", async () => {
    const activeLowId = await createVariant(tenantA.tenantId, "Peça Ativa Baixa Ignorar Inativo", {
      stock: 1,
    });
    const archivedLowId = await createVariant(
      tenantA.tenantId,
      "Peça Inativa Baixa Ignorar Inativo",
      { stock: 1, status: "ARCHIVED" },
    );
    const res = await tenantA.agent.get("/api/products").query({ lowStock: "true" });
    const ids = (res.body.products as ProductListItem[]).map((p) => p.variantId);
    expect(ids).toContain(activeLowId);
    expect(ids).not.toContain(archivedLowId);
  });

  it("a contagem de peças da listagem padrão ignora produto inativo recém-inativado", async () => {
    const before = await tenantA.agent.get("/api/products");
    const countBefore = (before.body.products as ProductListItem[]).length;
    await createVariant(tenantA.tenantId, "Peça Inativa Nao Conta", { status: "ARCHIVED" });
    const after = await tenantA.agent.get("/api/products");
    const countAfter = (after.body.products as ProductListItem[]).length;
    expect(countAfter).toBe(countBefore);
  });
});
