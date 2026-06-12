/**
 * Configuração ESLint para o app Next.js. Estende a base e adiciona as regras
 * oficiais do Next (`next/core-web-vitals`), resolvidas a partir do
 * `eslint-config-next` instalado em apps/web.
 */
/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: ["./base.js", "next/core-web-vitals"],
  env: {
    browser: true,
  },
};
