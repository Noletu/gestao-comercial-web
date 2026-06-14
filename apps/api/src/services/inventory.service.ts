import type {
  MovementSource,
  MovementType,
  StockMovement,
} from "@prisma/client";
import { withTenant, type TenantTransaction } from "../db";

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
 */
export async function recordMovement(
  tenantId: string,
  input: RecordMovementInput,
): Promise<StockMovement> {
  return withTenant(tenantId, async (tx) => {
    const movement = await tx.stockMovement.create({
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

    await recomputeStock(tx, tenantId, input.variantId, input.locationId);
    return movement;
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
