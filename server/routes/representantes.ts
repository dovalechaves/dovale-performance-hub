import { Router } from "express";
import { queryFirebird } from "../db/firebird";
import { codigoPaiRepresentante, codigosFilhosExtraDb, firebirdFiltroRep, MULTI_DB_FILTRO, MULTI_DB_LOJAS } from "../db/filters";

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
    const extraDbs = MULTI_DB_LOJAS[loja] || [];
    const filtroPrincipal = firebirdFiltroRep("r", loja);
    const codigosConsolidados = codigosFilhosExtraDb(loja);
    const filtroExtra = MULTI_DB_FILTRO[loja]
      ? `AND r.REP_NOME IS NOT NULL
         AND (
           UPPER(r.REP_NOME) CONTAINING UPPER('${MULTI_DB_FILTRO[loja]}')
           ${codigosConsolidados.length ? `OR r.REP_CODIGO IN (${codigosConsolidados.join(",")})` : ""}
         )`
      : filtroPrincipal;

    const buildSql = (filtro: string) => `
      SELECT DISTINCT
        r.REP_CODIGO,
        r.REP_NOME
      FROM REPRESENTANTES r
      WHERE r.REP_NOME IS NOT NULL
        ${filtro}
        AND EXISTS (
          SELECT 1 FROM PEDIDOS_VENDAS pv
          WHERE pv.PDV_REP_CODIGO = r.REP_CODIGO
            AND pv.PDV_DATA >= (CURRENT_DATE - 90)
        )
      ORDER BY r.REP_NOME
    `;

    function origemLabel(db: string) {
      if (db === "riopreto") return "RIO PRETO";
      if (db === "sjc") return "SJC";
      if (db === "mg") return "MG";
      return db.toUpperCase();
    }

    const queries = [
      queryFirebird<RepFirebird>(loja as any, buildSql(filtroPrincipal))
        .then(rows => rows.map(r => ({ ...r, ORIGEM_DB: loja })))
        .catch(err => {
          console.error(`[representantes] Erro DB ${loja}:`, err instanceof Error ? err.message : err);
          return [] as (RepFirebird & { ORIGEM_DB: string })[];
        }),
      ...extraDbs.map(db =>
        queryFirebird<RepFirebird>(db as any, buildSql(filtroExtra))
          .then(rows => rows.map(r => ({ ...r, ORIGEM_DB: db })))
          .catch(err => {
            console.error(`[representantes] Erro DB ${db} para loja ${loja}:`, err instanceof Error ? err.message : err);
            return [] as (RepFirebird & { ORIGEM_DB: string })[];
          })
      ),
    ];

    const allRows = (await Promise.all(queries)).flat();

    // Deduplica por nome (rep_codigo pode variar entre bancos)
    const seen = new Map<string, { rep_codigo: string; rep_nome: string; origem: string }>();
    for (const r of allRows) {
      const repCodigoPai = codigoPaiRepresentante(loja, r.REP_CODIGO);
      const nome = (r.REP_NOME || "").trim().toUpperCase();
      const key = loja === "riopreto" ? repCodigoPai : nome;
      if (!seen.has(key)) {
        seen.set(key, { rep_codigo: repCodigoPai, rep_nome: r.REP_NOME, origem: origemLabel(r.ORIGEM_DB) });
      }
    }

    const result = Array.from(seen.values()).sort((a, b) => a.rep_nome.localeCompare(b.rep_nome));
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
