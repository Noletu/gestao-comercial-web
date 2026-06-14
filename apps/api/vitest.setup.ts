// Carrega apps/api/.env (DATABASE_URL, DIRECT_DATABASE_URL, ENCRYPTION_KEY)
// antes de qualquer módulo instanciar o PrismaClient ou ler a chave de cripto.
import "dotenv/config";
