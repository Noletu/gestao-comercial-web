/**
 * Configuração ESLint base, compartilhada por todos os pacotes do monorepo.
 * Usa o formato `.eslintrc` (ESLint 8) por compatibilidade com `next lint`
 * do Next.js 14, que ainda não suporta totalmente o flat config do ESLint 9.
 */
/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "turbo",
    "prettier",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint"],
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: ["node_modules/", "dist/", ".next/", ".turbo/"],
  rules: {
    // TS estrito: `any` explícito é proibido (CLAUDE.md / PROJETO.md DoD).
    "@typescript-eslint/no-explicit-any": "error",
    // Permite parâmetros/variáveis intencionalmente não usados com prefixo `_`
    // (ex.: assinatura de error handler do Express exige 4 args).
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
  },
};
