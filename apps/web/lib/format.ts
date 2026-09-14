/**
 * Formatação e regra de estoque baixo. Movido de `app/dashboard/page.tsx`
 * (spec estoque-interface-parte-1.md §6.1) — comportamento preservado
 * verbatim, é regra de negócio já conquistada em spec anterior
 * (estoque-busca-filtro-preco.md).
 */

/**
 * Limite de estoque baixo, fixo pra loja toda (spec
 * estoque-busca-filtro-preco.md §4.2 — mesmo valor do backend,
 * `LOW_STOCK_THRESHOLD` em `products.service.ts`; não há pacote compartilhado
 * entre web/api pra essa constante, então mantemos os dois em sincronia).
 */
export const LOW_STOCK_THRESHOLD = 2;

export type StockStatus = "zerado" | "baixo" | "ok";

export function stockStatus(stock: number): StockStatus {
  if (stock === 0) return "zerado";
  if (stock <= LOW_STOCK_THRESHOLD) return "baixo";
  return "ok";
}

/** `null` (valor não cadastrado) sempre vira "—" — nunca "R$ NaN" (spec §4.3/§6). */
export function formatCurrency(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** `null` (margem indeterminada) sempre vira "—" — nunca "0%" fingindo que é zero de verdade. */
export function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

/**
 * Campo numérico opcional (preço/custo) do formulário: vazio vira `undefined`.
 * Texto que não é um número válido ≥ 0 retorna erro explícito — nunca deixa
 * um NaN ou negativo seguir silenciosamente para a API.
 *
 * Atenção ao usar o resultado para montar o corpo de um PATCH de edição
 * (contrato revisado, spec estoque-interface-parte-1.md §5.3): `undefined`
 * aqui significa "campo vazio no formulário", mas no corpo da requisição
 * `undefined` (chave ausente, removida pelo `JSON.stringify`) significa "não
 * mexe nesse campo" — o oposto do que o formulário de edição completo quer
 * quando o campo é apagado de propósito. Por isso os componentes que editam
 * um produto já existente convertem `value === undefined` para `null`
 * explícito no ponto de montagem do corpo, e não aqui — esta função não muda
 * de assinatura para não quebrar quem já depende de "vazio → undefined"
 * (ex.: cadastro de produto novo, onde não existe valor anterior a limpar).
 */
export function parseOptionalNonNegativeNumber(
  raw: string,
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: undefined };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return {
      ok: false,
      error: "Informe um valor numérico válido, maior ou igual a zero.",
    };
  }
  return { ok: true, value: parsed };
}
