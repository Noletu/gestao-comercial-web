// Seed inicial: a loja do casal, com produtos/variantes/movimentações de exemplo.
// Roda como OWNER (DIRECT_DATABASE_URL) e portanto bypassa o RLS — necessário
// para popular livremente. Carrega o .env antes de instanciar o client.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL,
});

/**
 * Insere movimentações no ledger e materializa o estoque (stock = soma do ledger).
 * Mantém o agregado coerente com o ledger já no seed — o mesmo invariante que o
 * inventory.service garante em runtime.
 */
async function seedMovements(
  db: PrismaClient,
  params: {
    tenantId: string;
    variantId: string;
    locationId: string;
    deltas: {
      quantity: number;
      type: "PURCHASE_ENTRY" | "SALE" | "ADJUSTMENT";
    }[];
  },
): Promise<void> {
  const { tenantId, variantId, locationId, deltas } = params;
  for (const d of deltas) {
    await db.stockMovement.create({
      data: {
        tenantId,
        variantId,
        locationId,
        quantity: d.quantity,
        type: d.type,
        source: "INITIAL_SYNC",
        reason: "Seed inicial",
      },
    });
  }
  const stock = deltas.reduce((sum, d) => sum + d.quantity, 0);
  await db.inventoryLevel.upsert({
    where: { variantId_locationId: { variantId, locationId } },
    create: { tenantId, variantId, locationId, stock },
    update: { stock },
  });
}

async function main(): Promise<void> {
  // Idempotência: TRUNCATE (e não DELETE) porque o ledger stock_movement tem
  // trigger de imutabilidade que bloqueia DELETE. TRUNCATE roda como owner e não
  // dispara o trigger de linha.
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "stock_movement","inventory_level","variant","product",` +
      `"location","membership","nuvemshop_connection","sync_state",` +
      `"tenant","user" RESTART IDENTITY CASCADE`,
  );

  const tenant = await prisma.tenant.create({
    data: { name: "Loja do Casal" },
  });

  // Os dois OWNER (placeholders).
  const owner1 = await prisma.user.create({
    data: { email: "owner1@example.com", displayName: "Owner Um" },
  });
  const owner2 = await prisma.user.create({
    data: { email: "owner2@example.com", displayName: "Owner Dois" },
  });
  await prisma.membership.createMany({
    data: [
      { tenantId: tenant.id, userId: owner1.id, role: "OWNER" },
      { tenantId: tenant.id, userId: owner2.id, role: "OWNER" },
    ],
  });

  const location = await prisma.location.create({
    data: { tenantId: tenant.id, name: "Loja", isDefault: true },
  });

  // Produto 1 com 2 variantes.
  const vestido = await prisma.product.create({
    data: { tenantId: tenant.id, name: "Vestido Floral", status: "ACTIVE" },
  });
  const vestidoP = await prisma.variant.create({
    data: {
      tenantId: tenant.id,
      productId: vestido.id,
      sku: "VEST-FLORAL-P",
      price: "159.90",
      cost: "70.00",
      attributes: { size: "P", color: "Floral" },
    },
  });
  const vestidoM = await prisma.variant.create({
    data: {
      tenantId: tenant.id,
      productId: vestido.id,
      sku: "VEST-FLORAL-M",
      price: "159.90",
      cost: "70.00",
      attributes: { size: "M", color: "Floral" },
    },
  });

  // Produto 2 "simples" — ainda assim modelado como 1 variante.
  const blusa = await prisma.product.create({
    data: { tenantId: tenant.id, name: "Blusa Básica", status: "ACTIVE" },
  });
  const blusaU = await prisma.variant.create({
    data: {
      tenantId: tenant.id,
      productId: blusa.id,
      sku: "BLUSA-BASICA-U",
      price: "79.90",
      cost: "30.00",
      attributes: { size: "Único", color: "Branco" },
    },
  });

  // Movimentações → estoque final esperado: 7, 12, 20.
  await seedMovements(prisma, {
    tenantId: tenant.id,
    variantId: vestidoP.id,
    locationId: location.id,
    deltas: [
      { quantity: 10, type: "PURCHASE_ENTRY" },
      { quantity: -3, type: "SALE" },
    ],
  });
  await seedMovements(prisma, {
    tenantId: tenant.id,
    variantId: vestidoM.id,
    locationId: location.id,
    deltas: [
      { quantity: 15, type: "PURCHASE_ENTRY" },
      { quantity: -3, type: "SALE" },
    ],
  });
  await seedMovements(prisma, {
    tenantId: tenant.id,
    variantId: blusaU.id,
    locationId: location.id,
    deltas: [
      { quantity: 25, type: "PURCHASE_ENTRY" },
      { quantity: -5, type: "SALE" },
    ],
  });

  console.log("✅ Seed concluído:");
  console.log(`   tenant: ${tenant.name} (${tenant.id})`);
  console.log(`   users:  ${owner1.email}, ${owner2.email} (OWNER)`);
  console.log(`   location default: ${location.name}`);
  console.log(`   produtos: 2 | variantes: 3 | estoques esperados: 7, 12, 20`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error("❌ Seed falhou:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
