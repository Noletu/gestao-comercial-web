import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminPrisma, forTenant, prisma } from "../../db/index.js";
import { recordMovement } from "../inventory.service.js";

/**
 * PROVA NÃO-NEGOCIÁVEL: o agregado materializado (inventory_level.stock) é sempre
 * igual à soma do ledger (stock_movement) — inclusive após um estorno.
 */

let tenantId: string;
let variantId: string;
let locationId: string;

async function truncateAll(): Promise<void> {
  await adminPrisma.$executeRawUnsafe(
    `TRUNCATE TABLE "stock_movement","inventory_level","variant","product",` +
      `"location","membership","nuvemshop_connection","sync_state",` +
      `"tenant","user" RESTART IDENTITY CASCADE`,
  );
}

beforeAll(async () => {
  await truncateAll();
  const tenant = await adminPrisma.tenant.create({ data: { name: "Ledger" } });
  const location = await adminPrisma.location.create({
    data: { tenantId: tenant.id, name: "Loja", isDefault: true },
  });
  const product = await adminPrisma.product.create({
    data: { tenantId: tenant.id, name: "Produto" },
  });
  const variant = await adminPrisma.variant.create({
    data: { tenantId: tenant.id, productId: product.id, sku: "SKU-LEDGER" },
  });
  tenantId = tenant.id;
  variantId = variant.id;
  locationId = location.id;
});

afterAll(async () => {
  await prisma.$disconnect();
  await adminPrisma.$disconnect();
});

/** Soma do ledger calculada de forma independente (como owner, fonte de verdade). */
async function ledgerSum(): Promise<number> {
  const agg = await adminPrisma.stockMovement.aggregate({
    where: { variantId, locationId },
    _sum: { quantity: true },
  });
  return agg._sum.quantity ?? 0;
}

/** Estoque materializado lido pelo caminho do app (RLS). */
async function materializedStock(): Promise<number> {
  const level = await forTenant(tenantId).inventoryLevel.findUnique({
    where: { variantId_locationId: { variantId, locationId } },
  });
  return level?.stock ?? 0;
}

describe("Ledger ↔ agregado de estoque", () => {
  it("após entradas e saídas, stock = soma das movimentações", async () => {
    await recordMovement(tenantId, {
      variantId,
      locationId,
      quantity: 10,
      type: "PURCHASE_ENTRY",
      source: "APP",
    });
    await recordMovement(tenantId, {
      variantId,
      locationId,
      quantity: 15,
      type: "PURCHASE_ENTRY",
      source: "APP",
    });
    await recordMovement(tenantId, {
      variantId,
      locationId,
      quantity: -4,
      type: "SALE",
      source: "APP",
    });

    expect(await materializedStock()).toBe(21);
    expect(await materializedStock()).toBe(await ledgerSum());
  });

  it("um estorno (REVERSAL) também mantém o agregado coerente", async () => {
    await recordMovement(tenantId, {
      variantId,
      locationId,
      quantity: 4, // estorna a venda de -4
      type: "REVERSAL",
      source: "APP",
      reason: "Estorno da venda",
    });

    expect(await materializedStock()).toBe(25);
    expect(await materializedStock()).toBe(await ledgerSum());
  });
});
