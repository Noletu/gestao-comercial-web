import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth.middleware.js";
import {
  createProduct,
  listProducts,
  ProductValidationError,
  updateProduct,
} from "../services/products.service.js";
import {
  applyStockMovement,
  StockValidationError,
} from "../services/inventory.service.js";

/**
 * Estoque manual (spec estoque-manual.md) + busca por SKU, filtro de estoque
 * baixo e preço/custo/margem (spec estoque-busca-filtro-preco.md). Rotas de
 * negócio de verdade — `/api/me*` continua existindo à parte, sem mudança
 * (não editar me.route.ts).
 */
export const productsRouter = Router();

// Filtros de situação/categoria (spec estoque-interface-parte-1.md §5.3).
// Validados via Zod como os demais: erro de validação nunca cai no 500 genérico.
const listProductsQuerySchema = z.object({
  status: z.enum(["ativos", "inativos", "todos"]).optional().default("ativos"),
  categoryId: z
    .union([z.literal("sem-categoria"), z.string().uuid()])
    .optional(),
});

productsRouter.get("/products", requireAuth, (req, res, next) => {
  void (async () => {
    const parsed = listProductsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? "Filtro inválido." });
      return;
    }
    const q = typeof req.query.q === "string" ? req.query.q.trim() || undefined : undefined;
    const lowStock = req.query.lowStock === "true";
    const products = await listProducts(req.tenantId!, {
      q,
      lowStock,
      status: parsed.data.status,
      categoryId: parsed.data.categoryId,
    });
    res.json({ products });
  })().catch(next);
});

// price/cost: número >= 0 quando enviados (spec estoque-busca-filtro-preco.md
// §4.4/§4.5) — mesmo padrão dos outros campos da rota, rejeita negativo com
// 400 e mensagem clara antes de chegar no service.
const priceSchema = z.number().nonnegative("O preço não pode ser negativo.").optional();
const costSchema = z.number().nonnegative("O custo não pode ser negativo.").optional();

// categoryId em criação (spec §5.3): opcional, uuid de uma categoria já existente.
const categoryIdCreateSchema = z.string().uuid("Categoria inválida.").optional();

const createProductSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do produto."),
  sku: z
    .string()
    .trim()
    .min(1, "O código não pode ser vazio.")
    .optional(),
  price: priceSchema,
  cost: costSchema,
  categoryId: categoryIdCreateSchema,
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

// Corpo `{ name, sku?, price?, cost?, categoryId?, status? }` — spec
// estoque-interface-parte-1.md §5.3/§5.4. `name` é o único campo obrigatório;
// todos os demais usam a MESMA semântica de update parcial: chave AUSENTE preserva o
// valor atual, `null` explícito limpa (vira "—"/"Sem categoria" na tela),
// valor presente grava. sku vazio/só-espaços é tratado como `null` (limpa) —
// é o jeito de um formulário mandar "apaguei o campo" sem precisar saber
// mandar `null` de propósito.
const skuUpdateSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().min(1, "O código não pode ser vazio.").nullable().optional(),
);
const priceUpdateSchema = z
  .number()
  .nonnegative("O preço não pode ser negativo.")
  .nullable()
  .optional();
const costUpdateSchema = z
  .number()
  .nonnegative("O custo não pode ser negativo.")
  .nullable()
  .optional();
const categoryIdUpdateSchema = z
  .string()
  .uuid("Categoria inválida.")
  .nullable()
  .optional();
const statusUpdateSchema = z.enum(["ativo", "inativo"]).optional();

const updateProductSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do produto."),
  sku: skuUpdateSchema,
  price: priceUpdateSchema,
  cost: costUpdateSchema,
  categoryId: categoryIdUpdateSchema,
  status: statusUpdateSchema,
});

productsRouter.patch("/products/:variantId", requireAuth, (req, res, next) => {
  void (async () => {
    const parsed = updateProductSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." });
      return;
    }
    try {
      const product = await updateProduct(
        req.tenantId!,
        req.params.variantId!,
        parsed.data,
      );
      res.json(product);
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
