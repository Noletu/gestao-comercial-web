import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // Os testes de integração compartilham o mesmo Postgres e mexem nas mesmas
    // tabelas; rodar em série evita interferência entre arquivos.
    fileParallelism: false,
    sequence: { concurrent: false },
    include: ["src/**/*.test.ts"],
  },
});
