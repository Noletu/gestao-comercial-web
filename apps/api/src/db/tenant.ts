import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Camada de acesso a dados com contexto de tenant para Row-Level Security.
 *
 * Como funciona o RLS aqui:
 *  - As policies no Postgres filtram por `current_setting('app.tenant_id')`.
 *  - Antes de QUALQUER query, setamos esse GUC na MESMA conexão/transação via
 *    `set_config('app.tenant_id', <id>, true)` (true = LOCAL à transação).
 *  - Se o GUC não estiver setado, `current_setting(..., true)` retorna NULL e as
 *    policies não casam nenhuma linha → fail-closed (não vaza nada por engano).
 *
 * O runtime conecta como `app_user` (NÃO superusuário, NÃO dono das tabelas), então
 * o banco SEMPRE aplica as policies — mesmo que uma query no código esqueça o
 * filtro de tenant. Essa é a defesa no nível do banco.
 */

/** Client base do runtime (DATABASE_URL = role app_user, RLS aplicado). */
export const prisma = new PrismaClient();

/**
 * Client administrativo (DIRECT_DATABASE_URL = role postgres, superusuário).
 * Bypassa RLS — uso restrito a migrations, seed e setup/teardown de testes.
 * NUNCA usar para servir requests de usuário.
 */
export const adminPrisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL,
});

/** Tipo do client transacional do Prisma (usado em withTenant). */
export type TenantTransaction = Prisma.TransactionClient;

/**
 * Client com escopo de tenant para queries simples (1 operação).
 *
 * Abordagem: Prisma Client Extension. Cada operação é embrulhada num
 * `$transaction([set_config, query])` (forma em array = sequencial, mesma
 * conexão), garantindo que o GUC valha para aquela query. Transparente para quem
 * chama: `forTenant(id).product.findMany()` já vem isolado.
 *
 * Trade-off: cada operação vira uma transação (2 idas ao banco). Aceitável para
 * o padrão de leitura do painel; escritas multi-passo usam `withTenant` (abaixo).
 */
export function forTenant(tenantId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}

/**
 * Executa um bloco multi-passo numa única transação com o contexto de tenant
 * setado. Use para escritas atômicas (ex.: gravar movimentação + recalcular o
 * agregado de estoque) — todas as queries do callback compartilham a conexão da
 * transação, então o GUC LOCAL persiste por todo o bloco.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}

export type TenantClient = ReturnType<typeof forTenant>;
