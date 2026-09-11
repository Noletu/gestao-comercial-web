import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminPrisma, prisma } from "../../db/index.js";
import { applyStockMovement, StockValidationError } from "../inventory.service.js";

/**
 * PROVA NÃO-NEGOCIÁVEL (spec estoque-manual.md §5.3): estoque nunca fica
 * negativo, Ajuste delta-zero não grava ruído no ledger, e o lock por linha
 * (upsert + SELECT ... FOR UPDATE) fecha a corrida de verdade sob concorrência
 * real — tanto para saldo baixo (Saída) quanto para duas Entradas simultâneas.
 */

let tenantId: string;
let locationId: string;

async function truncateAll(): Promise<void> {
  await adminPrisma.$executeRawUnsafe(
    `TRUNCATE TABLE "stock_movement","inventory_level","variant","product",` +
      `"location","membership","nuvemshop_connection","sync_state",` +
      `"tenant","user" RESTART IDENTITY CASCADE`,
  );
}

/** Cria uma variante nova, opcionalmente com um saldo inicial (via ADJUSTMENT direto). */
async function createVariant(initialStock = 0): Promise<string> {
  const product = await adminPrisma.product.create({
    data: { tenantId, name: "Produto Teste" },
  });
  const variant = await adminPrisma.variant.create({
    data: { tenantId, productId: product.id },
  });
  if (initialStock !== 0) {
    await adminPrisma.stockMovement.create({
      data: {
        tenantId,
        variantId: variant.id,
        locationId,
        quantity: initialStock,
        type: "ADJUSTMENT",
        source: "INITIAL_SYNC",
        reason: "Fixture de teste",
      },
    });
    await adminPrisma.inventoryLevel.upsert({
      where: { variantId_locationId: { variantId: variant.id, locationId } },
      create: { tenantId, variantId: variant.id, locationId, stock: initialStock },
      update: { stock: initialStock },
    });
  }
  return variant.id;
}

async function stockOf(variantId: string): Promise<number> {
  const level = await adminPrisma.inventoryLevel.findUnique({
    where: { variantId_locationId: { variantId, locationId } },
  });
  return level?.stock ?? 0;
}

beforeAll(async () => {
  await truncateAll();
  const tenant = await adminPrisma.tenant.create({
    data: { name: "Movimentações" },
  });
  tenantId = tenant.id;
  const location = await adminPrisma.location.create({
    data: { tenantId, name: "Loja", isDefault: true },
  });
  locationId = location.id;
});

afterAll(async () => {
  await prisma.$disconnect();
  await adminPrisma.$disconnect();
});

describe("applyStockMovement — estoque não pode ficar negativo", () => {
  it("recusa uma Saída maior que o saldo atual e não grava nada", async () => {
    const variantId = await createVariant(5);

    await expect(
      applyStockMovement(tenantId, { variantId, kind: "saida", quantity: 10 }),
    ).rejects.toThrow(StockValidationError);

    // só o ADJUSTMENT do fixture — a saída recusada não deixou rastro.
    const count = await adminPrisma.stockMovement.count({ where: { variantId } });
    expect(count).toBe(1);
    expect(await stockOf(variantId)).toBe(5);
  });

  it("a mensagem de erro informa exatamente o saldo disponível", async () => {
    const variantId = await createVariant(3);

    await expect(
      applyStockMovement(tenantId, { variantId, kind: "saida", quantity: 4 }),
    ).rejects.toThrow("Só há 3 em estoque.");
  });
});

describe("applyStockMovement — Ajuste calcula o delta a partir da contagem", () => {
  it("contagem igual ao saldo atual não grava movimento nenhum", async () => {
    const variantId = await createVariant(8);

    const result = await applyStockMovement(tenantId, {
      variantId,
      kind: "ajuste",
      quantity: 8,
    });

    expect(result.message).toBe("Estoque já está correto");
    const count = await adminPrisma.stockMovement.count({ where: { variantId } });
    expect(count).toBe(1); // só o ADJUSTMENT do fixture, nenhum novo
  });

  it("contagem diferente do saldo grava o delta certo (contagem - saldo)", async () => {
    const variantId = await createVariant(10);

    const result = await applyStockMovement(tenantId, {
      variantId,
      kind: "ajuste",
      quantity: 7,
    });

    expect(result.stock).toBe(7);
    const movement = await adminPrisma.stockMovement.findFirst({
      where: { variantId, type: "ADJUSTMENT", quantity: -3 },
    });
    expect(movement).not.toBeNull();
  });
});

describe("applyStockMovement — concorrência real (Promise.all, chamadas em paralelo)", () => {
  it("duas Saídas simultâneas com saldo baixo: só uma é aplicada, saldo nunca fica negativo", async () => {
    const variantId = await createVariant(5);

    const results = await Promise.allSettled([
      applyStockMovement(tenantId, { variantId, kind: "saida", quantity: 4 }),
      applyStockMovement(tenantId, { variantId, kind: "saida", quantity: 4 }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const finalStock = await stockOf(variantId);
    expect(finalStock).toBe(1); // 5 - 4 (só a primeira saída aplicada)
    expect(finalStock).toBeGreaterThanOrEqual(0);
  });

  it("duas Entradas simultâneas no mesmo item somam exatamente, nenhuma se perde", async () => {
    const variantId = await createVariant(10);

    const results = await Promise.all([
      applyStockMovement(tenantId, { variantId, kind: "entrada", quantity: 3 }),
      applyStockMovement(tenantId, { variantId, kind: "entrada", quantity: 5 }),
    ]);

    expect(results.every((r) => r.stock >= 0)).toBe(true);
    expect(await stockOf(variantId)).toBe(18); // 10 + 3 + 5, nenhuma perdida
  });
});
