import { Router } from "express";
import {
  getMonthlyFirstMovementProducts,
  getProductFirstMovementStatus,
  runProductFirstMovementCheckAndPersist,
} from "../services/productFirstMovement";

const router = Router();

router.get("/status", (_req, res) => {
  res.json(getProductFirstMovementStatus());
});

router.get("/monthly", async (req, res) => {
  try {
    const mes = req.query.mes ? Number(req.query.mes) : undefined;
    const ano = req.query.ano ? Number(req.query.ano) : undefined;
    const produtos = await getMonthlyFirstMovementProducts(mes, ano);
    res.json(produtos);
  } catch (err: any) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

router.post("/run", async (req, res) => {
  try {
    const mes = req.body?.mes ? Number(req.body.mes) : undefined;
    const ano = req.body?.ano ? Number(req.body.ano) : undefined;
    const result = await runProductFirstMovementCheckAndPersist(mes, ano);
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

export default router;
