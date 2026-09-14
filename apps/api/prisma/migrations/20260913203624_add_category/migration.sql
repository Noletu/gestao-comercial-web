-- AlterTable
ALTER TABLE "product" ADD COLUMN     "category_id" UUID;

-- CreateTable
CREATE TABLE "category" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "category_tenant_id_idx" ON "category"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "category_tenant_id_name_key" ON "category"("tenant_id", "name");

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  SQL ESCRITO À MÃO (não gerado pelo Prisma)                                ║
-- ║  RLS da tabela "category" (spec estoque-interface-parte-1.md §5.1) +       ║
-- ║  índice de unicidade case-insensitive/trim para o nome da categoria.       ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- Mesmo padrão literal das tabelas de negócio existentes (migration
-- 20260614222145_init): USING filtra leitura/update/delete, WITH CHECK
-- impede escrever linha com tenant_id de outra loja, FORCE garante RLS até
-- para o dono da tabela. app_user já recebe SELECT/INSERT/UPDATE/DELETE nesta
-- tabela nova via ALTER DEFAULT PRIVILEGES aplicado na migration inicial
-- (mesmo role/owner roda as migrations) — sem GRANT explícito necessário aqui;
-- confirmado rodando a query de privilégios após aplicar (ver relatório).
ALTER TABLE "category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "category" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "category"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Nome de categoria repetido tem que ser recusado ignorando maiúsculas e
-- espaços nas pontas, inclusive sob corrida real (spec §5.4 item 2). O
-- @@unique([tenantId, name]) do Prisma (índice acima) só pega duplicata
-- EXATA (mesma caixa, mesmos espaços). Este índice funcional adicional pega
-- a duplicata "Calça" vs "calça " de forma atômica no Postgres — mesma
-- defesa (violação de índice único vira P2002 no Prisma, capturado no
-- service exatamente como já se faz para SKU duplicado), sem exigir um
-- SELECT prévio que teria janela de corrida.
CREATE UNIQUE INDEX "category_tenant_id_name_normalized_key"
  ON "category" ("tenant_id", lower(btrim("name")));
