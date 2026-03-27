import { Router } from "express";
import { queryFirebird, firebirdLojas } from "../db/firebird";

const router = Router();

/**
 * GET /api/vendas?loja=bh
 * Retorna vendas do dia por vendedor de uma loja Firebird.
 * Ajuste o SQL conforme a estrutura da tabela no MicrosysBH.
 */
router.get("/", async (req, res) => {
  const loja = (req.query.loja as string) || "bh";

  if (!firebirdLojas.includes(loja as "bh" | "l2" | "l3")) {
    return res.status(400).json({ error: `Loja inválida. Use: ${firebirdLojas.join(", ")}` });
  }

  try {
    // TODO: ajuste a query conforme as tabelas do Microsys
    const rows = await queryFirebird(loja as "bh", `
      SELECT
        V.CODVEND   AS id,
        V.NOMEVEND  AS nome,
        SUM(P.VLTOTAL) AS vendas
      FROM PEDIDOS P
      JOIN VENDEDORES V ON V.CODVEND = P.CODVEND
      WHERE CAST(P.DTEMISSAO AS DATE) = CAST(CURRENT_DATE AS DATE)
        AND P.SITUACAO NOT IN ('CC')
      GROUP BY V.CODVEND, V.NOMEVEND
      ORDER BY vendas DESC
    `);
    res.json(rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
