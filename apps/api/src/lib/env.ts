import { z } from "zod";

/**
 * Schema das variáveis de ambiente consumidas pela API.
 *
 * Por ora só validamos PORT e NODE_ENV. DATABASE_URL e as credenciais da
 * Nuvemshop entram aqui nas issues #2/#6, quando forem de fato consumidas —
 * validar uma variável que ainda não é usada só gera falso atrito no boot.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Falha ruidosa no boot: env inválido é erro de configuração/operação, não de
  // runtime. Queremos quebrar no deploy (cedo e óbvio), não num request perdido
  // em produção com comportamento imprevisível.
  console.error("❌ Variáveis de ambiente inválidas:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
