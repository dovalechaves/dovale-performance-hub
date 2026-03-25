import { Router } from "express";
import { queryFirebird } from "../db/firebird";
import { querySqlServer, getPool } from "../db/sqlserver";
import { sqlServerFiltroRep } from "../db/filters";

const router = Router();

interface VendaFirebird {
  REP_CODIGO: string;
  REP_NOME: string;
  PDV_NUMERO: string;
  PDV_DATA: Date;
  STATUS: string;
  TOTAL: number;
}

/**
 * POST /api/sync?loja=bh
 * Busca vendas recentes no Firebird e faz upsert no SQL Server.
 * Chamado automaticamente pelo job a cada 5 minutos.
 */
router.post("/", async (req, res) => {
  const loja = (req.query.loja as string) || "bh";

  try {
    // 1. Busca últimos 2 dias no Firebird
    const vendas = await queryFirebird<VendaFirebird>(loja as "bh", `
      SELECT
        r.REP_CODIGO,
        r.REP_NOME,
        pv.PDV_NUMERO,
        pv.PDV_DATA,
        pv.PDV_PSI_CODIGO  AS STATUS,
        SUM(pvi.PVI_TOTALITEM) AS TOTAL
      FROM PEDIDOS_VENDAS pv
      INNER JOIN REPRESENTANTES r       ON r.REP_CODIGO  = pv.PDV_REP_CODIGO
      INNER JOIN PEDIDOS_VENDAS_ITENS pvi ON pvi.PVI_NUMERO = pv.PDV_NUMERO
      WHERE pv.PDV_PSI_CODIGO NOT IN ('CC')
        AND pv.PDV_DATA >= '01.01.${new Date().getFullYear()}'
      GROUP BY r.REP_CODIGO, r.REP_NOME, pv.PDV_NUMERO, pv.PDV_DATA, pv.PDV_PSI_CODIGO
    `);

    if (vendas.length === 0) {
      return res.json({ sincronizados: 0, loja });
    }

    // 2. Upsert no SQL Server
    const pool = await getPool();
    let count = 0;

    for (const v of vendas) {
      await pool.request()
        .input("loja",       loja)
        .input("rep_codigo", v.REP_CODIGO)
        .input("rep_nome",   v.REP_NOME)
        .input("pdv_numero", v.PDV_NUMERO)
        .input("pdv_data",   v.PDV_DATA)
        .input("status",     v.STATUS)
        .input("valor_total", v.TOTAL)
        .query(`
          MERGE dbo.VENDAS_LOJAS_APP AS target
          USING (SELECT @loja AS loja, @pdv_numero AS pdv_numero) AS source
            ON target.loja = source.loja AND target.pdv_numero = source.pdv_numero
          WHEN MATCHED THEN
            UPDATE SET
              rep_codigo     = @rep_codigo,
              rep_nome       = @rep_nome,
              pdv_data       = @pdv_data,
              status         = @status,
              valor_total    = @valor_total,
              sincronizado_em = GETDATE()
          WHEN NOT MATCHED THEN
            INSERT (loja, rep_codigo, rep_nome, pdv_numero, pdv_data, status, valor_total)
            VALUES (@loja, @rep_codigo, @rep_nome, @pdv_numero, @pdv_data, @status, @valor_total);
        `);
      count++;
    }

    res.json({ sincronizados: count, loja });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/sync/vendas?loja=bh&mes=3&ano=2026
 * Lê vendas consolidadas do SQL Server (sem bater no Firebird).
 */
router.get("/vendas", async (req, res) => {
  const loja = (req.query.loja as string) || "bh";
  const mes  = Number(req.query.mes)  || new Date().getMonth() + 1;
  const ano  = Number(req.query.ano)  || new Date().getFullYear();

  try {
    const rows = await querySqlServer(`
      SELECT
        rep_codigo,
        rep_nome,
        SUM(valor_total) AS total_vendas
      FROM dbo.VENDAS_LOJAS_APP
      WHERE loja  = @loja
        AND MONTH(pdv_data) = @mes
        AND YEAR(pdv_data)  = @ano
        AND status NOT IN ('CC')
        ${sqlServerFiltroRep("rep_nome")}
      GROUP BY rep_codigo, rep_nome
      ORDER BY total_vendas DESC
    `, { loja, mes, ano });

    res.json(rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
