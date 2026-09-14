import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Tokens do tema escuro (spec estoque-interface-parte-1.md §4.1),
      // definidos como CSS custom properties em app/globals.css. Não
      // sobrescreve a escala padrão de `fontSize` do Tailwind (usada por
      // outras telas do app, ex. login) — a escala 12/13/14/18/24 da spec é
      // aplicada com `text-xs`/`text-[13px]`/`text-sm`/`text-lg`/`text-2xl`
      // nos componentes novos.
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-raised": "var(--surface-raised)",
        border: "var(--border)",
        text: "var(--text)",
        "text-muted": "var(--text-muted)",
        accent: "var(--accent)",
        "on-accent": "var(--on-accent)",
        ok: "var(--ok)",
        "ok-bg": "var(--ok-bg)",
        warn: "var(--warn)",
        "warn-bg": "var(--warn-bg)",
        danger: "var(--danger)",
        "danger-bg": "var(--danger-bg)",
      },
    },
  },
  plugins: [],
};

export default config;
