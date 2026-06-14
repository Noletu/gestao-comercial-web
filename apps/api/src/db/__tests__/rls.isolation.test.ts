import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminPrisma, forTenant, prisma } from "../tenant";

/**
 * PROVA NÃO-NEGOCIÁVEL: isolamento multi-tenant via Row-Level Security.
 *
 * Cria 2 tenants com dados, seta o contexto do tenant A e confirma que nenhuma
 * query retorna dados do tenant B — mesmo pedindo o registro do B pelo id. A
 * defesa está no banco (RLS), não no código da query.
 */

interface TenantFixture {
  tenantId: string;
  productId: string;
  variantId: string;
  locationId: string;
}

async function truncateAll(): Promise<void> {
  await adminPrisma.$executeRawUnsafe(
    `TRUNCATE TABLE "stock_movement","inventory_level","variant","product",` +
      `"location","membership","nuvemshop_connection","sync_state",` +
      `"tenant","user" RESTART IDENTITY CASCADE`,
  );
}

/** Cria, como owner (bypassa RLS), um tenant completo com 1 produto/variante/estoque. */
async function createTenant(name: string): Promise<TenantFixture> {
  const tenant = await adminPrisma.tenant.create({ data: { name } });
  const location = await adminPrisma.location.create({
    data: { tenantId: tenant.id, name: "Loja", isDefault: true },
  });
  const product = await adminPrisma.product.create({
    data: { tenantId: tenant.id, name: `Produto ${name}` },
  });
  const variant = await adminPrisma.variant.create({
    data: { tenantId: tenant.id, productId: product.id, sku: `SKU-${name}` },
  });
  await adminPrisma.stockMovement.create({
    data: {
      tenantId: tenant.id,
      variantId: variant.id,
      locationId: location.id,
      quantity: 5,
      type: "PURCHASE_ENTRY",
      source: "INITIAL_SYNC",
    },
  });
  return {
    tenantId: tenant.id,
    productId: product.id,
    variantId: variant.id,
    locationId: location.id,
  };
}

let tenantA: TenantFixture;
let tenantB: TenantFixture;

beforeAll(async () => {
  await truncateAll();
  tenantA = await createTenant("A");
  tenantB = await createTenant("B");
});

afterAll(async () => {
  await prisma.$disconnect();
  await adminPrisma.$disconnect();
});

describe("RLS — isolamento entre tenants", () => {
  it("tenant A só enxerga produtos do tenant A", async () => {
    const products = await forTenant(tenantA.tenantId).product.findMany();
    expect(products).toHaveLength(1);
    expect(products[0]?.id).toBe(tenantA.productId);
  });

  it("tenant B só enxerga produtos do tenant B", async () => {
    const products = await forTenant(tenantB.tenantId).product.findMany();
    expect(products).toHaveLength(1);
    expect(products[0]?.id).toBe(tenantB.productId);
  });

  it("tenant A NÃO acessa o produto do B nem pedindo pelo id", async () => {
    const found = await forTenant(tenantA.tenantId).product.findUnique({
      where: { id: tenantB.productId },
    });
    expect(found).toBeNull();
  });

  it("o isolamento vale para variantes e movimentações", async () => {
    const dbA = forTenant(tenantA.tenantId);
    const variants = await dbA.variant.findMany();
    const movements = await dbA.stockMovement.findMany();
    expect(variants).toHaveLength(1);
    expect(variants[0]?.tenantId).toBe(tenantA.tenantId);
    expect(movements).toHaveLength(1);
    expect(movements[0]?.tenantId).toBe(tenantA.tenantId);
  });

  it("a própria tabela tenant é filtrada (A só vê o tenant A)", async () => {
    const tenants = await forTenant(tenantA.tenantId).tenant.findMany();
    expect(tenants).toHaveLength(1);
    expect(tenants[0]?.id).toBe(tenantA.tenantId);
  });

  it("WITH CHECK: A não consegue gravar linha com tenant_id do B", async () => {
    await expect(
      forTenant(tenantA.tenantId).product.create({
        data: { tenantId: tenantB.tenantId, name: "Intruso" },
      }),
    ).rejects.toThrow();
  });

  it("fail-closed: sem contexto de tenant, nenhuma linha é retornada", async () => {
    // Client base (app_user) sem set_config → current_setting é NULL → 0 linhas.
    const products = await prisma.product.findMany();
    expect(products).toHaveLength(0);
  });
});
