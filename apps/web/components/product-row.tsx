"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Modal } from "./modal";
import { StatusBadge, StockBadge } from "./badge";
import { MoveIcon, PencilIcon, PowerIcon, UndoIcon } from "./icons";
import { formatCurrency, formatPercent, parseOptionalNonNegativeNumber } from "@/lib/format";
import {
  apiFetchJson,
  extractErrorMessage,
  type CategoryItem,
  type MovementKind,
  type MovementResult,
  type ProductItem,
} from "@/lib/api";

/**
 * Uma peça — versão linha de tabela (`ProductRow`, desktop, >=768px) e
 * versão cartão (`ProductCard`, mobile, spec §4.3: "abaixo de 768px a tabela
 * vira lista de cartões"). As duas compartilham a mesma lógica de ações
 * (`ProductActions`) para não duplicar as três operações (movimentar,
 * editar, inativar/reativar) e seus modais.
 *
 * Contrato do `PATCH /api/products/:variantId` (revisado — spec
 * estoque-interface-parte-1.md §5.3): chave AUSENTE preserva o valor atual;
 * chave presente com `null` limpa; chave presente com valor grava. Por isso:
 * - Inativar/reativar manda só `{ name, status }` — sku/price/cost/categoryId
 *   ficam de fora do corpo (preservados). `name` é sempre reenviado porque a
 *   rota o exige em qualquer PATCH, não porque este fluxo o edita.
 * - O formulário de edição completo manda `name`, `sku`, `price`, `cost` e
 *   `categoryId` sempre presentes, com `null` explícito quando o campo foi
 *   apagado/deixado em "Sem categoria" — nunca omitido, porque omitido aqui
 *   significaria "não mexe", e a intenção do formulário é gravar exatamente
 *   o que está na tela.
 */

/** Quanto tempo a peça recém-cadastrada fica destacada, em milissegundos. */
export const HIGHLIGHT_MS = 4000;

interface ProductActionsProps {
  item: ProductItem;
  categories: CategoryItem[];
  onUpdated: (item: ProductItem) => void;
  onFeedback: (message: string, tone: "ok" | "danger") => void;
}

interface ProductLineProps extends ProductActionsProps {
  /** Peça recém-cadastrada (spec: rolar até ela e destacá-la). */
  highlighted: boolean;
}

/**
 * Traz a peça recém-cadastrada para a área visível. Sob
 * `prefers-reduced-motion: reduce` o salto é seco, sem rolagem suave; o
 * destaque em si é estático, então continua valendo nos dois casos.
 *
 * A linha (desktop) e o cartão (mobile) ficam os dois montados, escondidos um
 * ou outro por CSS: o escondido não tem caixa de layout e `scrollIntoView`
 * nele não move nada.
 */
function useScrollIntoViewWhenHighlighted<T extends HTMLElement>(
  highlighted: boolean,
): React.RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (!highlighted || element === null) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "center",
    });
  }, [highlighted]);
  return ref;
}

/**
 * Destaque da peça recém-cadastrada: contorno + fundo elevado. Não é só cor —
 * o contorno é uma borda visível também em escala de cinza — e o texto segue
 * `--text` sobre `--surface-raised`, o mesmo par do estado sob o cursor.
 */
const HIGHLIGHT_CLASSES = "bg-surface-raised outline outline-2 -outline-offset-2 outline-accent";

function ProductActions({ item, categories, onUpdated, onFeedback }: ProductActionsProps): JSX.Element {
  const [editOpen, setEditOpen] = useState(false);
  const [movementOpen, setMovementOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reactivating, setReactivating] = useState(false);

  async function reactivate(): Promise<void> {
    setReactivating(true);
    try {
      const res = await apiFetchJson(`/api/products/${item.variantId}`, "PATCH", {
        name: item.name,
        status: "ativo",
      });
      if (!res.ok) {
        onFeedback(
          await extractErrorMessage(res, "Não foi possível reativar a peça."),
          "danger",
        );
        return;
      }
      const updated = (await res.json()) as ProductItem;
      onUpdated(updated);
      onFeedback(`"${updated.name}" foi reativada e voltou para a lista.`, "ok");
    } catch {
      onFeedback("Não foi possível conectar ao servidor. Tente novamente.", "danger");
    } finally {
      setReactivating(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => setMovementOpen(true)}
        aria-label={`Movimentar estoque de ${item.name}`}
        title="Movimentar estoque"
        className="rounded border border-border p-2 text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <MoveIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setEditOpen(true)}
        aria-label={`Editar ${item.name}`}
        title="Editar"
        className="rounded border border-border p-2 text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <PencilIcon className="h-4 w-4" />
      </button>
      {item.status === "ativo" ? (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          aria-label={`Inativar ${item.name}`}
          title="Inativar"
          className="rounded border border-border p-2 text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <PowerIcon className="h-4 w-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void reactivate()}
          disabled={reactivating}
          aria-label={`Reativar ${item.name}`}
          title="Reativar"
          className="rounded border border-border p-2 text-text hover:bg-surface-raised disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <UndoIcon className="h-4 w-4" />
        </button>
      )}

      <Modal open={movementOpen} onClose={() => setMovementOpen(false)} title={`Movimentar — ${item.name}`}>
        <MovementForm
          variantId={item.variantId}
          onSuccess={(result) => onUpdated({ ...item, stock: result.stock })}
        />
      </Modal>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Editar — ${item.name}`}>
        <EditProductForm
          item={item}
          categories={categories}
          onSaved={(updated) => {
            onUpdated(updated);
            setEditOpen(false);
          }}
        />
      </Modal>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Inativar peça">
        <ConfirmInactivate
          item={item}
          onCancel={() => setConfirmOpen(false)}
          onInactivated={(updated) => {
            onUpdated(updated);
            setConfirmOpen(false);
            onFeedback(
              `"${updated.name}" foi guardada — não aparece mais na lista de ativas, mas nada foi apagado. Você pode reativar quando quiser.`,
              "ok",
            );
          }}
        />
      </Modal>
    </div>
  );
}

export function ProductRow({ highlighted, ...props }: ProductLineProps): JSX.Element {
  const { item } = props;
  const ref = useScrollIntoViewWhenHighlighted<HTMLTableRowElement>(highlighted);
  return (
    <tr
      ref={ref}
      className={`border-b border-border last:border-0 hover:bg-surface-raised ${
        highlighted ? HIGHLIGHT_CLASSES : ""
      }`}
    >
      <td className="p-3 font-semibold">
        {item.name}
        {item.category && <p className="text-xs font-normal text-text-muted">{item.category.name}</p>}
      </td>
      <td className="p-3 tabular-nums text-text-muted">{item.sku ?? "—"}</td>
      <td className="p-3 tabular-nums">{formatCurrency(item.price)}</td>
      <td className="p-3 tabular-nums text-text-muted">{formatCurrency(item.cost)}</td>
      <td className="p-3 tabular-nums text-text-muted">{formatPercent(item.margin)}</td>
      <td className="p-3">
        <StockBadge stock={item.stock} />
      </td>
      <td className="p-3">
        <StatusBadge status={item.status} />
      </td>
      <td className="p-3">
        <ProductActions {...props} />
      </td>
    </tr>
  );
}

export function ProductCard({ highlighted, ...props }: ProductLineProps): JSX.Element {
  const { item } = props;
  const ref = useScrollIntoViewWhenHighlighted<HTMLLIElement>(highlighted);
  return (
    <li
      ref={ref}
      className={`flex flex-col gap-3 rounded-lg border border-border p-4 ${
        highlighted ? HIGHLIGHT_CLASSES : "bg-surface"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{item.name}</p>
          <p className="text-xs text-text-muted">
            {item.category?.name ?? "Sem categoria"} · {item.sku ?? "Sem código"}
          </p>
        </div>
        <StatusBadge status={item.status} />
      </div>
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-xs text-text-muted">Preço</dt>
          <dd className="tabular-nums">{formatCurrency(item.price)}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Custo</dt>
          <dd className="tabular-nums">{formatCurrency(item.cost)}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Margem</dt>
          <dd className="tabular-nums">{formatPercent(item.margin)}</dd>
        </div>
      </dl>
      <div className="flex items-center justify-between gap-2">
        <StockBadge stock={item.stock} />
        <ProductActions {...props} />
      </div>
    </li>
  );
}

/** Confirmação — única desta tela (spec §6.2/§2). */
function ConfirmInactivate({
  item,
  onCancel,
  onInactivated,
}: {
  item: ProductItem;
  onCancel: () => void;
  onInactivated: (item: ProductItem) => void;
}): JSX.Element {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onConfirm(): Promise<void> {
    setError("");
    setSubmitting(true);
    try {
      const res = await apiFetchJson(`/api/products/${item.variantId}`, "PATCH", {
        name: item.name,
        status: "inativo",
      });
      if (!res.ok) {
        setError(await extractErrorMessage(res, "Não foi possível inativar a peça."));
        return;
      }
      const updated = (await res.json()) as ProductItem;
      onInactivated(updated);
    } catch {
      setError("Não foi possível conectar ao servidor. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text">
        Inativar <strong>{item.name}</strong>? A peça sai da lista de ativas, mas continua
        guardada com todo o histórico — você pode reativar quando quiser.
      </p>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-border px-3 py-2 text-sm font-medium text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => void onConfirm()}
          disabled={submitting}
          className="rounded border border-accent bg-bg px-3 py-2 text-sm font-medium text-accent disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {submitting ? "Inativando..." : "Inativar"}
        </button>
      </div>
    </div>
  );
}

/**
 * Formulário de edição completa: substitui nome/sku/preço/custo/categoria
 * pelo que está na tela. Campo apagado vira `null` explícito no corpo (ver
 * comentário no topo do arquivo e em `lib/format.ts`), nunca omitido.
 */
function EditProductForm({
  item,
  categories,
  onSaved,
}: {
  item: ProductItem;
  categories: CategoryItem[];
  onSaved: (item: ProductItem) => void;
}): JSX.Element {
  const [name, setName] = useState(item.name);
  const [sku, setSku] = useState(item.sku ?? "");
  const [price, setPrice] = useState(item.price !== null ? String(item.price) : "");
  const [cost, setCost] = useState(item.cost !== null ? String(item.cost) : "");
  const [categoryId, setCategoryId] = useState(item.category?.id ?? "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const nameId = useId();
  const skuId = useId();
  const priceId = useId();
  const costId = useId();
  const categoryFieldId = useId();

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError("");

    const parsedPrice = parseOptionalNonNegativeNumber(price);
    if (!parsedPrice.ok) {
      setError(parsedPrice.error);
      return;
    }
    const parsedCost = parseOptionalNonNegativeNumber(cost);
    if (!parsedCost.ok) {
      setError(parsedCost.error);
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetchJson(`/api/products/${item.variantId}`, "PATCH", {
        name,
        // Campo vazio limpa de propósito: `null` explícito, nunca omitido
        // (omitido preservaria o valor atual no novo contrato do PATCH).
        sku: sku.trim() || null,
        price: parsedPrice.value ?? null,
        cost: parsedCost.value ?? null,
        categoryId: categoryId === "" ? null : categoryId,
      });
      if (!res.ok) {
        setError(await extractErrorMessage(res, "Não foi possível salvar as alterações."));
        return;
      }
      const updated = (await res.json()) as ProductItem;
      onSaved(updated);
    } catch {
      setError("Não foi possível conectar ao servidor. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label htmlFor={nameId} className="flex flex-col gap-1 text-sm">
        Nome
        <input
          id={nameId}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded border border-border bg-surface-raised p-2 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </label>
      <label htmlFor={skuId} className="flex flex-col gap-1 text-sm">
        Código (SKU)
        <input
          id={skuId}
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          className="rounded border border-border bg-surface-raised p-2 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </label>
      <label htmlFor={priceId} className="flex flex-col gap-1 text-sm">
        Preço de venda
        <input
          id={priceId}
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="rounded border border-border bg-surface-raised p-2 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </label>
      <label htmlFor={costId} className="flex flex-col gap-1 text-sm">
        Custo
        <input
          id={costId}
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          className="rounded border border-border bg-surface-raised p-2 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </label>
      <label htmlFor={categoryFieldId} className="flex flex-col gap-1 text-sm">
        Categoria
        <select
          id={categoryFieldId}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="rounded border border-border bg-surface-raised p-2 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <option value="">Sem categoria</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-accent p-2 text-sm font-semibold text-on-accent disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {submitting ? "Salvando..." : "Salvar alterações"}
      </button>
    </form>
  );
}

/** Lançamento de movimentação (Entrada/Saída/Ajuste) — rota inalterada por esta spec. */
function MovementForm({
  variantId,
  onSuccess,
}: {
  variantId: string;
  onSuccess: (result: MovementResult) => void;
}): JSX.Element {
  const [kind, setKind] = useState<MovementKind>("entrada");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const quantityId = useId();
  const noteId = useId();

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    setFeedback("");

    const parsedQuantity = Number(quantity);
    if (quantity.trim() === "" || !Number.isInteger(parsedQuantity)) {
      setError("Informe uma quantidade válida.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetchJson(`/api/products/${variantId}/movements`, "POST", {
        kind,
        quantity: parsedQuantity,
        note: note.trim() || undefined,
      });
      if (!res.ok) {
        setError(await extractErrorMessage(res, "Não foi possível registrar a movimentação."));
        return;
      }
      const result = (await res.json()) as MovementResult;
      setFeedback(result.message);
      setQuantity("");
      setNote("");
      onSuccess(result);
    } catch {
      setError("Não foi possível conectar ao servidor. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Tipo
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as MovementKind)}
          className="rounded border border-border bg-surface-raised p-2 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <option value="entrada">Entrada</option>
          <option value="saida">Saída</option>
          <option value="ajuste">Ajuste</option>
        </select>
      </label>
      <label htmlFor={quantityId} className="flex flex-col gap-1 text-sm">
        {kind === "ajuste" ? "Quantidade contada" : "Quantidade"}
        <input
          id={quantityId}
          type="number"
          inputMode="numeric"
          required
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="rounded border border-border bg-surface-raised p-2 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </label>
      <label htmlFor={noteId} className="flex flex-col gap-1 text-sm">
        Observação (opcional)
        <input
          id={noteId}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="rounded border border-border bg-surface-raised p-2 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      {feedback && <p className="text-sm text-ok">{feedback}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-accent p-2 text-sm font-semibold text-on-accent disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {submitting ? "Salvando..." : "Salvar"}
      </button>
    </form>
  );
}
