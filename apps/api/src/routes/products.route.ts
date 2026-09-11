import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth.middleware.js";
import {
  createProduct,
  listProducts,
  ProductValidationError,
} from "../services/products.service.js";
import {
  applyStockMovement,
  StockValidationError,
} from "../services/inventory.service.js";

/**
 * Estoque manual (spec estoque-manual.md). Rotas de negócio de verdade —
 * `/api/me*` continua existindo à parte, sem mudança (não editar me.route.ts).
 */
export const productsRouter = Router();

productsRouter.get("/products", requireAuth, (req, res, next) => {
  void (async () => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() || undefined : undefined;
    const products = await listProducts(req.tenantId!, q);
    res.json({ products });
  })().catch(next);
});

const createProductSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do produto."),
  sku: z
    .string()
    .trim()
    .min(1, "O código não pode ser vazio.")
    .optional(),
});

productsRouter.post("/products", requireAuth, (req, res, next) => {
  void (async () => {
    const parsed = createProductSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." });
      return;
    }
    try {
      const product = await createProduct(req.tenantId!, parsed.data);
      res.status(201).json(product);
    } catch (error) {
      if (error instanceof ProductValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  })().catch(next);
});

const movementSchema = z
  .object({
    kind: z.enum(["entrada", "saida", "ajuste"]),
    quantity: z.number().int("A quantidade precisa ser um número inteiro."),
    note: z.string().trim().min(1, "A observação não pode ser vazia.").optional(),
  })
  .superRefine((data, ctx) => {
    if (data.kind === "ajuste") {
      if (data.quantity < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A contagem não pode ser negativa.",
          path: ["quantity"],
        });
      }
    } else if (data.quantity <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe uma quantidade maior que zero.",
        path: ["quantity"],
      });
    }
  });

productsRouter.post(
  "/products/:variantId/movements",
  requireAuth,
  (req, res, next) => {
    void (async () => {
      const parsed = movementSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." });
        return;
      }
      try {
        const result = await applyStockMovement(req.tenantId!, {
          variantId: req.params.variantId!,
          kind: parsed.data.kind,
          quantity: parsed.data.quantity,
          reason: parsed.data.note,
        });
        res.json(result);
      } catch (error) {
        if (error instanceof StockValidationError) {
          res.status(400).json({ error: error.message });
          return;
        }
        next(error);
      }
    })().catch(next);
  },
);
