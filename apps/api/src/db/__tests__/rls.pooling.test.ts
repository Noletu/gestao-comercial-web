import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminPrisma, forTenant, withTenant } from "../tenant.js";

/**
 * PROVA NÃO-NEGOCIÁVEL (GATE 2, issue #4): o isolamento por tenant continua válido
 * sob REUSO de conexão no pool.
 *
 * O medo do pooling: conexões são reaproveitadas entre requests (e portanto entre
 * tenants). Se o contexto de tenant não estivesse escopado à transação, a conexão
 * voltaria ao pool "contaminada" e o próximo request (outro tenant) leria/escreveria
 * com o contexto errado → vazamento.
 *
 * Por que o nosso desenho é seguro: setamos o GUC com `set_config(..., true)` —
 * o `true` é LOCAL, ou seja, vale só até o fim da TRANSAÇÃO. No commit/rollback o
 * Postgres reverte o GUC para '' (string vazia). E as policies usam
 * `NULLIF(current_setting('app.tenant_id', true), '')` → vazio vira NULL → nenhuma
 * linha casa (fail-closed). Logo, a conexão volta ao pool "limpa".
 *
 * Como este teste FORÇA o reuso da MESMA conexão física: um PrismaClient dedicado
 * com `connection_limit=1`. Com um único slot no pool, toda operação abaixo passa
 * pela mesma conexão TCP — exatamente o cenário de vazamento que queremos descartar.
 * O teste exercita o código REAL (forTenant/withTenant), só injetando esse client.
 */

interface TenantFixture {
  tenantId: string;
  productId: string;
}

/** Acrescenta connection_limit=1 ao DATABASE_URL (role app_user, RLS aplicado). */
function singleConnectionUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL ausente no ambiente de teste.");
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}connection_limit=1`;
}

async function truncateAll(): Promise<void> {
  await adminPrisma.$executeRawUnsafe(
    `TRUNCATE TABLE "stock_movement","inventory_level","variant","product",` +
      `"location","membership","nuvemshop_connection","sync_state",` +
      `"tenant","user" RESTART IDENTITY CASCADE`,
  );
}

async function createTenant(name: string): Promise<TenantFixture> {
  const tenant = await adminPrisma.tenant.create({ data: { name } });
  const product = await adminPrisma.product.create({
    data: { tenantId: tenant.id, name: `Produto ${name}` },
  });
  return { tenantId: tenant.id, productId: product.id };
}

// Client com UMA única conexão no pool → reuso garantido entre tenants.
const pool = new PrismaClient({ datasourceUrl: singleConnectionUrl() });

let tenantA: TenantFixture;
let tenantB: TenantFixture;

beforeAll(async () => {
  await truncateAll();
  tenantA = await createTenant("PoolA");
  tenantB = await createTenant("PoolB");
});

afterAll(async () => {
  await pool.$disconnect();
  await adminPrisma.$disconnect();
});

describe("RLS — isolamento sob reuso de conexão no pool (connection_limit=1)", () => {
  it("dois tenants alternando na MESMA conexão só veem os próprios dados", async () => {
    // Request 1 (tenant A) na conexão única.
    const aProducts = await forTenant(
      tenantA.tenantId,
      pool,
    ).product.findMany();
    expect(aProducts).toHaveLength(1);
    expect(aProducts[0]?.id).toBe(tenantA.productId);

    // Request 2 (tenant B) REUSANDO a mesma conexão: vê só o B, nunca A+B.
    const bProducts = await forTenant(
      tenantB.tenantId,
      pool,
    ).product.findMany();
    expect(bProducts).toHaveLength(1);
    expect(bProducts[0]?.id).toBe(tenantB.productId);
  });

  it("o GUC LOCAL não sobrevive à transação na conexão reusada", async () => {
    // Seta o contexto do A dentro de uma transação...
    await forTenant(tenantA.tenantId, pool).product.findMany();

    // ...e, FORA de qualquer transação, lê o GUC na MESMA conexão: deve estar vazio.
    // (Se o `set_config` não fosse LOCAL, aqui viria o id do A → vazamento.)
    const rows = await pool.$queryRawUnsafe<{ v: string | null }[]>(
      `SELECT current_setting('app.tenant_id', true) AS v`,
    );
    expect(rows[0]?.v ?? "").toBe("");
  });

  it("fail-closed: query sem contexto na conexão reusada não vê nada", async () => {
    // Primeiro um request com contexto (A), depois um acesso "cru" sem contexto.
    await forTenant(tenantA.tenantId, pool).product.findMany();

    // Mesmo client, mesma conexão, SEM set_config → policies fecham → 0 linhas.
    // Prova que a conexão volta ao pool sem herdar o tenant do uso anterior.
    const leaked = await pool.product.findMany();
    expect(leaked).toHaveLength(0);
  });

  it("withTenant (escrita multi-passo) também não vaza na conexão reusada", async () => {
    // Escreve um produto como A dentro de withTenant (transação + set_config LOCAL).
    await withTenant(
      tenantA.tenantId,
      async (tx) => {
        await tx.product.create({
          data: { tenantId: tenantA.tenantId, name: "Extra A" },
        });
      },
      pool,
    );

    // Logo após, como B na mesma conexão: não enxerga os produtos do A.
    const bView = await forTenant(tenantB.tenantId, pool).product.findMany();
    expect(bView.every((p) => p.id === tenantB.productId)).toBe(true);
    expect(bView).toHaveLength(1);
  });
});
