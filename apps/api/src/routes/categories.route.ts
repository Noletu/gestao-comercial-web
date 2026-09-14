import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth.middleware.js";
import {
  CategoryValidationError,
  createCategory,
  listCategories,
  renameCategory,
} from "../services/categories.service.js";

/**
 * Categorias de produto (spec estoque-interface-parte-1.md §5.3): lista
 * própria que o Lucas gerencia, não texto livre. Sem `DELETE` — decisão
 * travada na spec (§2): nada nesta tela se apaga.
 */
export const categoriesRouter = Router();

categoriesRouter.get("/categories", requireAuth, (req, res, next) => {
  void (async () => {
    const categories = await listCategories(req.tenantId!);
    res.json({ categories });
  })().catch(next);
});

const categoryNameSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da categoria."),
});

categoriesRouter.post("/categories", requireAuth, (req, res, next) => {
  void (async () => {
    const parsed = categoryNameSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." });
      return;
    }
    try {
      const category = await createCategory(req.tenantId!, parsed.data.name);
      res.status(201).json(category);
    } catch (error) {
      if (error instanceof CategoryValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  })().catch(next);
});

categoriesRouter.patch("/categories/:id", requireAuth, (req, res, next) => {
  void (async () => {
    const parsed = categoryNameSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." });
      return;
    }
    try {
      const category = await renameCategory(
        req.tenantId!,
        req.params.id!,
        parsed.data.name,
      );
      res.json(category);
    } catch (error) {
      if (error instanceof CategoryValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  })().catch(next);
});
