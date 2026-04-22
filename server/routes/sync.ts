import { Router } from "express";
import { queryFirebird } from "../db/firebird";
import { querySqlServer, getPool } from "../db/sqlserver";
import { sqlServerFiltroRep, firebirdFiltroRep, firebirdFiltroVendas, consolidarVendas, MULTI_DB_LOJAS, MULTI_DB_FILTRO, codigoPaiRepresentante, codigosFilhosExtraDb } from "../db/filters";

const router = Router();

interface VendaFirebird {
  REP_CODIGO: string;
  REP_NOME: string;
  PDV_NUMERO: string;
  PDV_DATA: Date;
  STATUS: string;
  TOTAL: number;
}

type VendaMultiDbRow = {
  REP_CODIGO: string;
  REP_NOME: string;
  TOTAL_VENDAS: number;
  ORIGEM_DB: string;
};

function origemLabel(db: string) {
  if (db === "riopreto") return "RIO PRETO";
  if (db === "sjc") return "SJC";
  if (db === "mg") return "MG";
  return db.toUpperCase();
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
      WHERE pv.PDV_DATA >= '01.01.${new Date().getFullYear()}'
        AND r.REP_NOME IS NOT NULL
        AND pv.PDV_TVE_CODIGO NOT IN ('7','6','26','34')
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

/** Agrupa vendas de múltiplos bancos pelo REP_NOME, somando totais */
function mergeVendasMultiDb(
  rows: VendaMultiDbRow[],
  loja: string
) {
  const map = new Map<string, { rep_codigo: string; rep_nome: string; total_vendas: number; origem: string; detalhes: { db: string; total: number }[] }>();
  for (const r of rows) {
    const repCodigo = codigoPaiRepresentante(loja, r.REP_CODIGO);
    const nome = (r.REP_NOME || "").trim().toUpperCase();
    const key = loja === "riopreto" ? repCodigo : nome;
    const existing = map.get(key);
    const origem = origemLabel(r.ORIGEM_DB);
    if (existing) {
      existing.total_vendas += r.TOTAL_VENDAS;
      const partes = new Set(existing.origem.split(" /").map(p => p.trim()).filter(Boolean));
      partes.add(origem);
      existing.origem = Array.from(partes).join(" /");
      existing.detalhes.push({ db: origem, total: r.TOTAL_VENDAS });
    } else {
      map.set(key, { rep_codigo: repCodigo, rep_nome: r.REP_NOME, total_vendas: r.TOTAL_VENDAS, origem, detalhes: [{ db: origem, total: r.TOTAL_VENDAS }] });
    }
  }
  return Array.from(map.values());
}

/**
 * GET /api/sync/vendas?loja=bh&mes=3&ano=2026
 * Busca diretamente do Firebird — sempre fresco, sem intermediário.
 */
router.get("/vendas", async (req, res) => {
  const loja = (req.query.loja as string) || "bh";
  const mes  = Number(req.query.mes)  || new Date().getMonth() + 1;
  const ano  = Number(req.query.ano)  || new Date().getFullYear();

  try {
    const extraDbs = MULTI_DB_LOJAS[loja] || [];
    const filtroPrincipal = firebirdFiltroVendas("r", loja);
    const codigosConsolidados = codigosFilhosExtraDb(loja);
    const filtroExtra = MULTI_DB_FILTRO[loja]
      ? `AND r.REP_NOME IS NOT NULL
         AND (
           UPPER(r.REP_NOME) CONTAINING UPPER('${MULTI_DB_FILTRO[loja]}')
           ${codigosConsolidados.length ? `OR r.REP_CODIGO IN (${codigosConsolidados.join(",")})` : ""}
         )`
      : filtroPrincipal;

    const buildSql = (filtro: string) => `SELECT
            r.REP_CODIGO,
            r.REP_NOME,
            SUM(pvi.PVI_TOTALITEM) AS TOTAL_VENDAS
          FROM PEDIDOS_VENDAS pv
          INNER JOIN REPRESENTANTES r         ON r.REP_CODIGO  = pv.PDV_REP_CODIGO
          INNER JOIN PEDIDOS_VENDAS_ITENS pvi ON pvi.PVI_NUMERO = pv.PDV_NUMERO
          WHERE EXTRACT(MONTH FROM pv.PDV_DATA) = ${mes}
            AND EXTRACT(YEAR  FROM pv.PDV_DATA) = ${ano}
            AND pv.PDV_PSI_CODIGO NOT IN ('CC')
            AND pv.PDV_TVE_CODIGO NOT IN ('7','6','26','34')
            ${filtro}
          GROUP BY r.REP_CODIGO, r.REP_NOME
          ORDER BY TOTAL_VENDAS DESC`;

    const queries = [
      queryFirebird<{ REP_CODIGO: string; REP_NOME: string; TOTAL_VENDAS: number }>(loja as any, buildSql(filtroPrincipal))
        .then(rows => rows.map(r => ({ ...r, ORIGEM_DB: loja })))
        .catch(err => { console.error(`[sync/vendas] Erro DB ${loja}:`, err instanceof Error ? err.message : err); return [] as VendaMultiDbRow[]; }),
      ...extraDbs.map(db =>
        queryFirebird<{ REP_CODIGO: string; REP_NOME: string; TOTAL_VENDAS: number }>(db as any, buildSql(filtroExtra))
          .then(rows => rows.map(r => ({ ...r, ORIGEM_DB: db })))
          .catch(err => { console.error(`[sync/vendas] Erro DB ${db} para loja ${loja}:`, err instanceof Error ? err.message : err); return [] as VendaMultiDbRow[]; })
      ),
    ];

    const allRows = (await Promise.all(queries)).flat();
    const merged = mergeVendasMultiDb(allRows, loja);
    res.json(consolidarVendas(merged, loja));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/sync/vendas-hoje?loja=bh
 * Busca vendas do dia atual diretamente do Firebird.
 */
router.get("/vendas-hoje", async (req, res) => {
  const loja = (req.query.loja as string) || "bh";

  try {
    const extraDbs = MULTI_DB_LOJAS[loja] || [];
    const filtroPrincipal = firebirdFiltroVendas("r", loja);
    const codigosConsolidados = codigosFilhosExtraDb(loja);
    const filtroExtra = MULTI_DB_FILTRO[loja]
      ? `AND r.REP_NOME IS NOT NULL
         AND (
           UPPER(r.REP_NOME) CONTAINING UPPER('${MULTI_DB_FILTRO[loja]}')
           ${codigosConsolidados.length ? `OR r.REP_CODIGO IN (${codigosConsolidados.join(",")})` : ""}
         )`
      : filtroPrincipal;

    const buildSql = (filtro: string) => `SELECT
            r.REP_CODIGO,
            r.REP_NOME,
            SUM(pvi.PVI_TOTALITEM) AS TOTAL_VENDAS
          FROM PEDIDOS_VENDAS pv
          INNER JOIN REPRESENTANTES r         ON r.REP_CODIGO  = pv.PDV_REP_CODIGO
          INNER JOIN PEDIDOS_VENDAS_ITENS pvi ON pvi.PVI_NUMERO = pv.PDV_NUMERO
          WHERE CAST(pv.PDV_DATA AS DATE) = CURRENT_DATE
            AND pv.PDV_PSI_CODIGO NOT IN ('CC')
            AND pv.PDV_TVE_CODIGO NOT IN ('7','6','26','34')
            ${filtro}
          GROUP BY r.REP_CODIGO, r.REP_NOME
          ORDER BY TOTAL_VENDAS DESC`;

    const queries = [
      queryFirebird<{ REP_CODIGO: string; REP_NOME: string; TOTAL_VENDAS: number }>(loja as any, buildSql(filtroPrincipal))
        .then(rows => rows.map(r => ({ ...r, ORIGEM_DB: loja })))
        .catch(err => { console.error(`[sync/vendas-hoje] Erro DB ${loja}:`, err instanceof Error ? err.message : err); return [] as VendaMultiDbRow[]; }),
      ...extraDbs.map(db =>
        queryFirebird<{ REP_CODIGO: string; REP_NOME: string; TOTAL_VENDAS: number }>(db as any, buildSql(filtroExtra))
          .then(rows => rows.map(r => ({ ...r, ORIGEM_DB: db })))
          .catch(err => { console.error(`[sync/vendas-hoje] Erro DB ${db} para loja ${loja}:`, err instanceof Error ? err.message : err); return [] as VendaMultiDbRow[]; })
      ),
    ];

    const allRows = (await Promise.all(queries)).flat();
    const merged = mergeVendasMultiDb(allRows, loja);
    res.json(consolidarVendas(merged, loja));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
