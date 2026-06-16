// Seed inicial: a loja do casal, com 2 usuários OWNER reais (senha via env),
// 1 localização default e produtos/variantes/movimentações de exemplo.
//
// Os usuários são criados pelo Better Auth (hash de senha scrypt) — nunca
// guardamos senha em texto, e NUNCA versionamos senha real (repo público): a
// senha vem de SEED_OWNER_PASSWORD no .env local.
import "dotenv/config";
import { adminPrisma } from "../src/db/index.js";
import { auth } from "../src/auth/auth.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} não definido. Defina-o em apps/api/.env (ver .env.example).`,
    );
  }
  return value;
}

/** Cria o usuário via Better Auth (hash de senha) e devolve o id. */
async function createOwner(
  email: string,
  password: string,
  name: string,
): Promise<string> {
  await auth.api.signUpEmail({ body: { email, password, name } });
  const user = await adminPrisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`Falha ao criar o usuário ${email}.`);
  return user.id;
}

async function seedMovements(params: {
  tenantId: string;
  variantId: string;
  locationId: string;
  deltas: {
    quantity: number;
    type: "PURCHASE_ENTRY" | "SALE" | "ADJUSTMENT";
  }[];
}): Promise<void> {
  const { tenantId, variantId, locationId, deltas } = params;
  for (const d of deltas) {
    await adminPrisma.stockMovement.create({
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
  await adminPrisma.inventoryLevel.upsert({
    where: { variantId_locationId: { variantId, locationId } },
    create: { tenantId, variantId, locationId, stock },
    update: { stock },
  });
}

async function main(): Promise<void> {
  const owner1Email = requireEnv("SEED_OWNER1_EMAIL");
  const owner2Email = requireEnv("SEED_OWNER2_EMAIL");
  const password = requireEnv("SEED_OWNER_PASSWORD");

  // Idempotência: TRUNCATE (não DELETE — o ledger bloqueia DELETE) das tabelas de
  // negócio E das de auth. CASCADE cobre as FKs.
  await adminPrisma.$executeRawUnsafe(
    `TRUNCATE TABLE "stock_movement","inventory_level","variant","product",` +
      `"location","membership","nuvemshop_connection","sync_state",` +
      `"two_factor","session","account","verification","tenant","user" ` +
      `RESTART IDENTITY CASCADE`,
  );

  const tenant = await adminPrisma.tenant.create({
    data: { name: "Loja do Casal" },
  });

  const owner1Id = await createOwner(owner1Email, password, "Owner Um");
  const owner2Id = await createOwner(owner2Email, password, "Owner Dois");
  await adminPrisma.membership.createMany({
    data: [
      { tenantId: tenant.id, userId: owner1Id, role: "OWNER" },
      { tenantId: tenant.id, userId: owner2Id, role: "OWNER" },
    ],
  });

  const location = await adminPrisma.location.create({
    data: { tenantId: tenant.id, name: "Loja", isDefault: true },
  });

  const vestido = await adminPrisma.product.create({
    data: { tenantId: tenant.id, name: "Vestido Floral", status: "ACTIVE" },
  });
  const vestidoP = await adminPrisma.variant.create({
    data: {
      tenantId: tenant.id,
      productId: vestido.id,
      sku: "VEST-FLORAL-P",
      price: "159.90",
      cost: "70.00",
      attributes: { size: "P", color: "Floral" },
    },
  });
  const vestidoM = await adminPrisma.variant.create({
    data: {
      tenantId: tenant.id,
      productId: vestido.id,
      sku: "VEST-FLORAL-M",
      price: "159.90",
      cost: "70.00",
      attributes: { size: "M", color: "Floral" },
    },
  });

  const blusa = await adminPrisma.product.create({
    data: { tenantId: tenant.id, name: "Blusa Básica", status: "ACTIVE" },
  });
  const blusaU = await adminPrisma.variant.create({
    data: {
      tenantId: tenant.id,
      productId: blusa.id,
      sku: "BLUSA-BASICA-U",
      price: "79.90",
      cost: "30.00",
      attributes: { size: "Único", color: "Branco" },
    },
  });

  await seedMovements({
    tenantId: tenant.id,
    variantId: vestidoP.id,
    locationId: location.id,
    deltas: [
      { quantity: 10, type: "PURCHASE_ENTRY" },
      { quantity: -3, type: "SALE" },
    ],
  });
  await seedMovements({
    tenantId: tenant.id,
    variantId: vestidoM.id,
    locationId: location.id,
    deltas: [
      { quantity: 15, type: "PURCHASE_ENTRY" },
      { quantity: -3, type: "SALE" },
    ],
  });
  await seedMovements({
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
  console.log(
    `   users:  ${owner1Email}, ${owner2Email} (OWNER, senha via env)`,
  );
  console.log(`   location default: ${location.name}`);
  console.log(`   produtos: 2 | variantes: 3 | estoques esperados: 7, 12, 20`);
}

main()
  .then(async () => {
    await adminPrisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error("❌ Seed falhou:", error);
    await adminPrisma.$disconnect();
    process.exit(1);
  });
