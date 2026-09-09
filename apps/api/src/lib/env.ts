import { z } from "zod";

/**
 * Schema das variáveis de ambiente consumidas pela API.
 *
 * A partir da issue #2 validamos também o banco e a chave de criptografia. As
 * credenciais da Nuvemshop entram na #6, quando forem de fato consumidas.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  // Runtime (role app_user, RLS aplicado).
  DATABASE_URL: z.string().url(),
  // Migrations/seed (role owner). Opcional no runtime do servidor.
  DIRECT_DATABASE_URL: z.string().url().optional(),
  // Senha do role app_user (GATE 1, issue #4). NÃO é usada pelo runtime do
  // servidor (que já a carrega embutida em DATABASE_URL); é consumida pelo script
  // `scripts/provision-db-role.mjs` para aplicar a senha sem versioná-la. Opcional
  // aqui para não quebrar o boot de quem só sobe o servidor.
  APP_USER_PASSWORD: z.string().optional(),
  // Chave AES-256-GCM, base64 de 32 bytes (= 44 chars com padding).
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      message: "ENCRYPTION_KEY deve ser base64 de exatamente 32 bytes.",
    }),
  // Segredo do Better Auth (assina sessões/tokens). Mínimo 32 chars.
  BETTER_AUTH_SECRET: z.string().min(32),
  // URL pública da própria API (base do Better Auth).
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3001"),
  // Origem do front (Next) — usada em CORS e trustedOrigins do Better Auth.
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Falha ruidosa no boot: env inválido é erro de configuração/operação, não de
  // runtime. Queremos quebrar no deploy (cedo e óbvio), não num request perdido
  // em produção com comportamento imprevisível.
  console.error("❌ Variáveis de ambiente inválidas:");
  const fieldErrors = parsed.error.flatten().fieldErrors;
  console.error(fieldErrors);

  // Dica acionável em português para o caso mais comum e mais difícil de
  // diagnosticar sem ler stack trace: senha do app_user contendo `/`, que
  // quebra a URL do banco (ver DEPLOY.md, seção "Secrets e variáveis"). Quem
  // opera este projeto não é programador e não lê o fieldErrors acima.
  //
  // A dica cita só a barra de propósito: medido, `/` é o único caractere que
  // faz `new URL()` — usado por baixo pelo `.url()` do Zod — rejeitar a
  // string. `+`, `=` e espaço passam nesta validação, então prometer que a
  // mensagem cobre esses casos seria mentir sobre o que o código detecta.
  if (fieldErrors.DATABASE_URL ?? fieldErrors.DIRECT_DATABASE_URL) {
    console.error(
      "\n💡 O endereço do banco de dados está inválido. A causa mais " +
        "provável: a senha do banco contém uma barra (`/`), que parte o " +
        "endereço ao meio. O que fazer: gere uma senha nova com " +
        "`openssl rand -hex 32` (só números e letras de a-f, sempre seguros " +
        "aqui) e atualize APP_USER_PASSWORD e a DATABASE_URL (ou " +
        "DIRECT_DATABASE_URL) que a referencia.",
    );
  }

  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
