import { Router } from "express";
import { forcarChecagemEstoqueMinimo, getEstoqueMinimoProdutos, getEstoqueMinimoStatus } from "../jobs/estoqueMinimoJob";

const router = Router();

/** GET /api/estoque-minimo/produtos — lista cacheada (atualizada pelo cron seg-sex às 7h e 12h) */
router.get("/produtos", (_req, res) => {
  res.json(getEstoqueMinimoProdutos());
});

/** POST /api/estoque-minimo/produtos/atualizar — força uma nova checagem imediata no Firebird */
router.post("/produtos/atualizar", async (_req, res) => {
  try {
    const produtos = await forcarChecagemEstoqueMinimo();
    res.json(produtos);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[estoque-minimo] Erro ao atualizar produtos:", message);
    res.status(500).json({ error: `Erro de conexão com a loja SJC: ${message}` });
  }
});

/** GET /api/estoque-minimo/status */
router.get("/status", (_req, res) => {
  res.json(getEstoqueMinimoStatus());
});

export default router;
