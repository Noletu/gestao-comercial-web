"use client";

import { useId, useState, type FormEvent } from "react";
import { Modal } from "./modal";
import { PencilIcon } from "./icons";
import { apiFetchJson, extractErrorMessage, type CategoryItem } from "@/lib/api";

/**
 * Painel de categorias (spec estoque-interface-parte-1.md §5.3/§6.2): cria e
 * renomeia, nunca exclui — não existe rota `DELETE` para isso. Nome
 * repetido (ignorando maiúsculas/espaços) responde 400 com mensagem pronta
 * para exibir, tratada aqui como qualquer outro erro de validação.
 */

interface CategoryManagerProps {
  open: boolean;
  onClose: () => void;
  categories: CategoryItem[];
  onCategoriesChange: (categories: CategoryItem[]) => void;
  /** Renomear muda também o nome que aparece em cada peça da tabela. */
  onCategoryRenamed: (category: CategoryItem) => void;
}

/** Mesma ordem que o `GET /api/categories` garante: alfabética pelo nome. */
function sortedByName(categories: CategoryItem[]): CategoryItem[] {
  return [...categories].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export function CategoryManager({
  open,
  onClose,
  categories,
  onCategoriesChange,
  onCategoryRenamed,
}: CategoryManagerProps): JSX.Element {
  return (
    <Modal open={open} onClose={onClose} title="Gerenciar categorias">
      <div className="flex flex-col gap-4">
        <CreateCategoryForm
          categories={categories}
          onCreated={(category) => onCategoriesChange(sortedByName([...categories, category]))}
        />
        <ul className="flex flex-col gap-2 border-t border-border pt-3">
          {categories.length === 0 && (
            <li className="text-sm text-text-muted">Nenhuma categoria cadastrada ainda.</li>
          )}
          {categories.map((category) => (
            <CategoryRow
              key={category.id}
              category={category}
              onRenamed={(updated) => {
                onCategoriesChange(
                  sortedByName(categories.map((c) => (c.id === updated.id ? updated : c))),
                );
                onCategoryRenamed(updated);
              }}
            />
          ))}
        </ul>
      </div>
    </Modal>
  );
}

function CreateCategoryForm({
  categories,
  onCreated,
}: {
  categories: CategoryItem[];
  onCreated: (category: CategoryItem) => void;
}): JSX.Element {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fieldId = useId();

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await apiFetchJson("/api/categories", "POST", { name });
      if (!res.ok) {
        setError(await extractErrorMessage(res, "Não foi possível criar a categoria."));
        return;
      }
      const category = (await res.json()) as CategoryItem;
      onCreated(category);
      setName("");
    } catch {
      setError("Não foi possível conectar ao servidor. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <label htmlFor={fieldId} className="flex flex-col gap-1 text-sm">
        Nova categoria
        <div className="flex gap-2">
          <input
            id={fieldId}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Calça"
            className="flex-1 rounded border border-border bg-surface-raised p-2 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
          <button
            type="submit"
            disabled={submitting}
            className="shrink-0 rounded bg-accent px-3 py-2 text-sm font-semibold text-on-accent disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {submitting ? "Criando..." : "Criar"}
          </button>
        </div>
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <p className="text-xs text-text-muted">
        {categories.length} {categories.length === 1 ? "categoria cadastrada" : "categorias cadastradas"}
      </p>
    </form>
  );
}

function CategoryRow({
  category,
  onRenamed,
}: {
  category: CategoryItem;
  onRenamed: (category: CategoryItem) => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fieldId = useId();

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await apiFetchJson(`/api/categories/${category.id}`, "PATCH", { name });
      if (!res.ok) {
        setError(await extractErrorMessage(res, "Não foi possível renomear a categoria."));
        return;
      }
      const updated = (await res.json()) as CategoryItem;
      onRenamed(updated);
      setEditing(false);
    } catch {
      setError("Não foi possível conectar ao servidor. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  if (editing) {
    return (
      <li>
        <form onSubmit={onSubmit} className="flex flex-col gap-1">
          <label htmlFor={fieldId} className="sr-only">
            Renomear categoria {category.name}
          </label>
          <div className="flex gap-2">
            <input
              id={fieldId}
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 rounded border border-border bg-surface-raised p-2 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
            <button
              type="submit"
              disabled={submitting}
              className="shrink-0 rounded bg-accent px-3 py-2 text-sm font-semibold text-on-accent disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {submitting ? "Salvando..." : "Salvar"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setName(category.name);
                setError("");
              }}
              className="shrink-0 rounded border border-border px-3 py-2 text-sm font-medium text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Cancelar
            </button>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-2 rounded px-1 py-1 text-sm">
      <span>
        {category.name}{" "}
        <span className="text-text-muted">
          · {category.productCount} {category.productCount === 1 ? "peça" : "peças"}
        </span>
      </span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Renomear categoria ${category.name}`}
        className="rounded p-1 text-text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <PencilIcon className="h-4 w-4" />
      </button>
    </li>
  );
}
