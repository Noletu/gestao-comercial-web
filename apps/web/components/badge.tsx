import type { ReactNode } from "react";
import { stockStatus } from "@/lib/format";
import type { ProductStatusApi } from "@/lib/api";

/**
 * Badge de estado (spec estoque-interface-parte-1.md §4.1): texto na cor
 * cheia do estado sobre um fundo pré-misturado a 12% contra `--bg` (ver
 * comentário em `app/globals.css` sobre por que é uma cor sólida, não
 * transparência real). Números usam `tabular-nums` — numa tabela de
 * conferência, dígito que não alinha é erro de leitura (spec §4.2).
 */

export type BadgeTone = "ok" | "warn" | "danger" | "neutral";

const TONE_CLASSES: Record<BadgeTone, string> = {
  ok: "text-ok bg-ok-bg",
  warn: "text-warn bg-warn-bg",
  danger: "text-danger bg-danger-bg",
  neutral: "text-text-muted bg-surface-raised",
};

export function Badge({
  tone,
  children,
}: {
  tone: BadgeTone;
  children: ReactNode;
}): JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium tabular-nums ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

const STOCK_STATUS_LABELS: Record<ReturnType<typeof stockStatus>, string> = {
  zerado: "Zerado",
  baixo: "Baixo",
  ok: "Ok",
};

const STOCK_STATUS_TONES: Record<ReturnType<typeof stockStatus>, BadgeTone> = {
  zerado: "danger",
  baixo: "warn",
  ok: "ok",
};

export function StockBadge({ stock }: { stock: number }): JSX.Element {
  const status = stockStatus(stock);
  return (
    <Badge tone={STOCK_STATUS_TONES[status]}>
      {stock} · {STOCK_STATUS_LABELS[status]}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: ProductStatusApi }): JSX.Element {
  return (
    <Badge tone={status === "ativo" ? "ok" : "neutral"}>
      {status === "ativo" ? "Ativo" : "Inativo"}
    </Badge>
  );
}
