// Importação única do estoque atual da planilha Excel do Lucas (spec
// specs/estoque-manual.md §6). Roda fora da aplicação, com `adminPrisma`
// (bypassa RLS — é ferramenta operacional, não parte do runtime), no mesmo
// padrão de `prisma/seed.ts`.
//
// TRUNCA e recria tenant/usuários/localização — substitui os produtos de
// exemplo do seed pelos produtos reais. Uso:
//   npx tsx scripts/import-inventory.ts "<caminho do arquivo .xlsx>"
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { adminPrisma } from "../src/db/index.js";
import { auth } from "../src/auth/auth.js";

const SHEET_NAME = "EstoqueAtual-e-Cadastro";
const NAME_COLUMN = "Descreva o Produto";
const STOCK_COLUMN = "Estoque atual";

export interface InventoryRow {
  name: string;
  stock: number;
}

/**
 * Lê a aba de estoque e devolve só as linhas com "Estoque atual" > 0. O
 * cabeçalho não está numa posição fixa (a planilha real tem linhas em branco
 * antes dele) — localizamos a linha do cabeçalho procurando a célula com o
 * texto de `NAME_COLUMN`, e resolvemos as colunas pelo nome, não por índice
 * fixo, para não quebrar se alguém reordenar colunas na planilha.
 */
export function readInventoryRows(filePath: string): InventoryRow[] {
  // XLSX.read() lê de buffer, sem depender de acesso a fs por dentro do
  // pacote — mais portável entre resolvedores de módulo que XLSX.readFile().
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) {
    throw new Error(
      `Aba "${SHEET_NAME}" não encontrada em ${filePath}. Abas disponíveis: ${workbook.SheetNames.join(", ")}.`,
    );
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  const headerRowIndex = rows.findIndex((row) => row.includes(NAME_COLUMN));
  if (headerRowIndex === -1) {
    throw new Error(
      `Coluna "${NAME_COLUMN}" não encontrada na aba "${SHEET_NAME}" de ${filePath}.`,
    );
  }
  const header = rows[headerRowIndex] ?? [];
  const nameCol = header.indexOf(NAME_COLUMN);
  const stockCol = header.indexOf(STOCK_COLUMN);
  if (stockCol === -1) {
    throw new Error(
      `Coluna "${STOCK_COLUMN}" não encontrada na aba "${SHEET_NAME}" de ${filePath}.`,
    );
  }

  const result: InventoryRow[] = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const stockValue = row[stockCol];
    if (typeof stockValue !== "number" || stockValue <= 0) continue;

    const rawName = row[nameCol];
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name) {
      throw new Error(
        `Linha ${i + 1} de ${filePath} tem "${STOCK_COLUMN}" = ${stockValue} mas não tem "${NAME_COLUMN}" preenchido.`,
      );
    }
    result.push({ name, stock: stockValue });
  }
  return result;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} não definido. Defina-o em apps/api/.env (ver .env.example).`,
    );
  }
  return value;
}

/** Cria o usuário via Better Auth (hash de senha) e devolve o id — igual a prisma/seed.ts. */
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

export interface ImportSummary {
  productsCreated: number;
  totalStock: number;
}

/**
 * Executa a importação completa: trunca as tabelas de negócio + auth (mesmo
 * conjunto de prisma/seed.ts), recria tenant/usuários/localização, e grava um
 * Product+Variant+StockMovement(ADJUSTMENT, INITIAL_SYNC)+InventoryLevel por
 * linha filtrada — escrita direta via `adminPrisma`, sem passar por
 * `recordMovement`/`withTenant` (o script já roda fora de RLS).
 */
export async function runImport(filePath: string): Promise<ImportSummary> {
  const items = readInventoryRows(filePath);

  const owner1Email = requireEnv("SEED_OWNER1_EMAIL");
  const owner2Email = requireEnv("SEED_OWNER2_EMAIL");
  const password = requireEnv("SEED_OWNER_PASSWORD");

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

  let totalStock = 0;
  for (const item of items) {
    const product = await adminPrisma.product.create({
      data: { tenantId: tenant.id, name: item.name, status: "ACTIVE" },
    });
    const variant = await adminPrisma.variant.create({
      data: { tenantId: tenant.id, productId: product.id },
    });
    await adminPrisma.stockMovement.create({
      data: {
        tenantId: tenant.id,
        variantId: variant.id,
        locationId: location.id,
        quantity: item.stock,
        type: "ADJUSTMENT",
        source: "INITIAL_SYNC",
        reason: "Importação da planilha Excel (data de hoje)",
      },
    });
    await adminPrisma.inventoryLevel.upsert({
      where: {
        variantId_locationId: { variantId: variant.id, locationId: location.id },
      },
      create: {
        tenantId: tenant.id,
        variantId: variant.id,
        locationId: location.id,
        stock: item.stock,
      },
      update: { stock: item.stock },
    });
    totalStock += item.stock;
  }

  return { productsCreated: items.length, totalStock };
}

const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(
      "Uso: npx tsx scripts/import-inventory.ts \"<caminho do arquivo .xlsx>\"",
    );
    process.exit(1);
  }

  runImport(filePath)
    .then(async (summary) => {
      console.log("✅ Importação concluída:");
      console.log(`   produtos criados: ${summary.productsCreated}`);
      console.log(`   soma do estoque importado: ${summary.totalStock}`);
      await adminPrisma.$disconnect();
    })
    .catch(async (error: unknown) => {
      console.error("❌ Importação falhou:", error);
      await adminPrisma.$disconnect();
      process.exit(1);
    });
}
