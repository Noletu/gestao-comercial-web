import type {
  MovementSource,
  MovementType,
  StockMovement,
} from "@prisma/client";
import { withTenant, type TenantTransaction } from "../db/index.js";

export interface RecordMovementInput {
  variantId: string;
  locationId: string;
  quantity: number; // sinal: + entrada, - saída
  type: MovementType;
  source: MovementSource;
  reason?: string;
  sourceRef?: string;
  reversalOfId?: string;
  occurredAt?: Date;
}

/**
 * Registra uma movimentação no ledger e recalcula o agregado de estoque na MESMA
 * transação.
 *
 * Estratégia de consistência: a verdade é o ledger (append-only). Após inserir a
 * movimentação, recomputamos `inventory_level.stock` como a SOMA de todas as
 * movimentações daquela variante+localização e gravamos via upsert. Recalcular
 * (em vez de incrementar) é à prova de drift: o agregado sempre bate com o ledger,
 * inclusive após estornos. Tudo numa transação → nunca há estado intermediário
 * inconsistente. (Para alto volume, dá para trocar por incremento ou trigger no
 * banco — ver sugestões.)
 *
 * `tx` é opcional: quando fornecido (ex.: por `applyStockMovement`, que já abriu
 * sua própria `withTenant` para travar a linha do estoque), reusa essa MESMA
 * transação em vez de abrir uma nova — necessário para a checagem de saldo
 * negativo (spec estoque-manual.md §5.3) valer sob concorrência real. Quando
 * ausente, comportamento idêntico ao anterior (abre a própria `withTenant`).
 */
export async function recordMovement(
  tenantId: string,
  input: RecordMovementInput,
  tx?: TenantTransaction,
): Promise<StockMovement> {
  const run = async (activeTx: TenantTransaction): Promise<StockMovement> => {
    const movement = await activeTx.stockMovement.create({
      data: {
        tenantId,
        variantId: input.variantId,
        locationId: input.locationId,
        quantity: input.quantity,
        type: input.type,
        source: input.source,
        reason: input.reason,
        sourceRef: input.sourceRef,
        reversalOfId: input.reversalOfId,
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      },
    });

    await recomputeStock(activeTx, tenantId, input.variantId, input.locationId);
    return movement;
  };

  if (tx) return run(tx);
  return withTenant(tenantId, run);
}

/** Erro de validação de negócio (não 500): mensagem já pronta para a tela, em português. */
export class StockValidationError extends Error {}

export type MovementKind = "entrada" | "saida" | "ajuste";

export interface ApplyStockMovementInput {
  variantId: string;
  kind: MovementKind;
  /** Como o usuário digitou: positivo para entrada/saída, contagem total para ajuste. */
  quantity: number;
  reason?: string;
}

export interface ApplyStockMovementResult {
  stock: number;
  message: string;
}

/**
 * Aplica um lançamento de estoque (entrada, saída ou ajuste) respeitando a regra
 * "estoque não pode ficar negativo" sob concorrência real (spec estoque-manual.md
 * §5.3). Vale para os TRÊS tipos: mesmo Entrada, que nunca viola saldo, passa pelo
 * mesmo lock — sem ele, duas Entradas simultâneas podem se sobrescrever (lost
 * update), já que `recomputeStock` grava um `stock` resolvido em JavaScript, não
 * uma expressão atômica no banco.
 *
 * Fluxo, dentro de uma única `withTenant` (nunca abre uma segunda transação):
 *  1. upsert da linha de InventoryLevel (garante que existe; idempotente sob
 *     concorrência — INSERT ... ON CONFLICT).
 *  2. SELECT ... FOR UPDATE (SQL bruto) trava a linha até o fim da transação.
 *  3. calcula a quantidade a gravar a partir do saldo travado.
 *  4. Ajuste delta-zero → não grava nada (checado ANTES de saldo negativo).
 *     Senão, saldo resultante negativo → erro, rollback, nada foi escrito.
 *  5. Senão, grava via `recordMovement(..., tx)` — mesmo `tx`, mesmo lock.
 */
export async function applyStockMovement(
  tenantId: string,
  input: ApplyStockMovementInput,
): Promise<ApplyStockMovementResult> {
  return withTenant(tenantId, async (tx) => {
    // Pré-condição (fora dos 5 passos do lock): a variante precisa existir E
    // pertencer a este tenant. Sob RLS, uma variante de outro tenant some da
    // leitura (não dá pra distinguir "não existe" de "é de outra loja", e não
    // deveria dar — não vazamos existência entre lojas).
    const variant = await tx.variant.findFirst({
      where: { id: input.variantId },
      select: { id: true },
    });
    if (!variant) {
      throw new StockValidationError("Produto não encontrado.");
    }

    const location = await tx.location.findFirst({ where: { isDefault: true } });
    if (!location) {
      // Não deveria acontecer (o seed sempre cria uma) — falha alta e clara,
      // nunca cria uma localização "fantasma" silenciosamente (spec §4).
      throw new Error("Nenhuma localização padrão configurada para esta loja.");
    }
    const locationId = location.id;

    // Passo 1
    await tx.inventoryLevel.upsert({
      where: { variantId_locationId: { variantId: input.variantId, locationId } },
      create: { tenantId, variantId: input.variantId, locationId, stock: 0 },
      update: {},
    });

    // Passo 2 — SELECT ... FOR UPDATE: o Prisma Client não expõe isso na API normal.
    const rows = await tx.$queryRaw<{ stock: number }[]>`
      SELECT "stock" FROM "inventory_level"
      WHERE "variant_id" = ${input.variantId}::uuid AND "location_id" = ${locationId}::uuid
      FOR UPDATE
    `;
    const currentStock = rows[0]?.stock ?? 0;

    // Passo 3
    let movementQuantity: number;
    let movementType: "PURCHASE_ENTRY" | "SALE" | "ADJUSTMENT";
    if (input.kind === "entrada") {
      movementQuantity = input.quantity;
      movementType = "PURCHASE_ENTRY";
    } else if (input.kind === "saida") {
      movementQuantity = -input.quantity;
      movementType = "SALE";
    } else {
      movementQuantity = input.quantity - currentStock;
      movementType = "ADJUSTMENT";
    }

    // Passo 4 — Ajuste delta-zero primeiro, saldo negativo depois (nesta ordem).
    if (input.kind === "ajuste" && movementQuantity === 0) {
      return { stock: currentStock, message: "Estoque já está correto" };
    }
    const resultingStock = currentStock + movementQuantity;
    if (resultingStock < 0) {
      throw new StockValidationError(`Só há ${currentStock} em estoque.`);
    }

    // Passo 5 — mesmo tx, nunca uma segunda transação.
    await recordMovement(
      tenantId,
      {
        variantId: input.variantId,
        locationId,
        quantity: movementQuantity,
        type: movementType,
        source: "APP",
        reason: input.reason,
      },
      tx,
    );

    return { stock: resultingStock, message: "Movimentação registrada." };
  });
}

/** Recalcula e materializa o estoque de uma variante+localização a partir do ledger. */
async function recomputeStock(
  tx: TenantTransaction,
  tenantId: string,
  variantId: string,
  locationId: string,
): Promise<void> {
  const aggregate = await tx.stockMovement.aggregate({
    where: { variantId, locationId },
    _sum: { quantity: true },
  });
  const stock = aggregate._sum.quantity ?? 0;

  await tx.inventoryLevel.upsert({
    where: { variantId_locationId: { variantId, locationId } },
    create: { tenantId, variantId, locationId, stock },
    update: { stock },
  });
}
