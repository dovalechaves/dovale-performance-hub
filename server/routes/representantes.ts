import { Router } from "express";
import { queryFirebird } from "../db/firebird";
import { firebirdFiltroRep } from "../db/filters";

const router = Router();

interface RepFirebird {
  REP_CODIGO: string;
  REP_NOME: string;
}

/**
 * GET /api/representantes?loja=bh
 * Retorna lista de vendedores ativos do Firebird.
 */
router.get("/", async (req, res) => {
  const loja = (req.query.loja as string) || "bh";

  try {
    const rows = await queryFirebird<RepFirebird>(loja as "bh" | "l2" | "l3", `
      SELECT DISTINCT
        r.REP_CODIGO,
        r.REP_NOME
      FROM REPRESENTANTES r
      WHERE r.REP_NOME IS NOT NULL
        ${firebirdFiltroRep("r", loja)}
        AND EXISTS (
          SELECT 1 FROM PEDIDOS_VENDAS pv
          WHERE pv.PDV_REP_CODIGO = r.REP_CODIGO
            AND pv.PDV_DATA >= (CURRENT_DATE - 90)
        )
      ORDER BY r.REP_NOME
    `);

    res.json(rows.map(r => ({
      rep_codigo: r.REP_CODIGO,
      rep_nome:   r.REP_NOME,
    })));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
