import { queryFirebird } from "../db/firebird";
import { getPool } from "../db/sqlserver";
import { firebirdFiltroRep } from "../db/filters";

const LOJAS = ["bh"] as const; // adicione "l2", "l3" quando configuradas

interface VendaFirebird {
  REP_CODIGO: string;
  REP_NOME: string;
  PDV_NUMERO: string;
  PDV_DATA: Date;
  STATUS: string;
  TOTAL: number;
}

async function syncLoja(loja: typeof LOJAS[number]) {
  const vendas = await queryFirebird<VendaFirebird>(loja, `
    SELECT
      r.REP_CODIGO,
      r.REP_NOME,
      pv.PDV_NUMERO,
      pv.PDV_DATA,
      pv.PDV_PSI_CODIGO  AS STATUS,
      SUM(pvi.PVI_TOTALITEM) AS TOTAL
    FROM PEDIDOS_VENDAS pv
    INNER JOIN REPRESENTANTES r         ON r.REP_CODIGO  = pv.PDV_REP_CODIGO
    INNER JOIN PEDIDOS_VENDAS_ITENS pvi ON pvi.PVI_NUMERO = pv.PDV_NUMERO
    WHERE pv.PDV_PSI_CODIGO NOT IN ('CC')
      AND pv.PDV_DATA >= '01.01.${new Date().getFullYear()}'
      ${firebirdFiltroRep("r")}
    GROUP BY r.REP_CODIGO, r.REP_NOME, pv.PDV_NUMERO, pv.PDV_DATA, pv.PDV_PSI_CODIGO
  `);

  if (vendas.length === 0) return 0;

  const pool = await getPool();
  for (const v of vendas) {
    await pool.request()
      .input("loja",        loja)
      .input("rep_codigo",  v.REP_CODIGO)
      .input("rep_nome",    v.REP_NOME)
      .input("pdv_numero",  v.PDV_NUMERO)
      .input("pdv_data",    v.PDV_DATA)
      .input("status",      v.STATUS)
      .input("valor_total", v.TOTAL)
      .query(`
        MERGE dbo.VENDAS_LOJAS_APP AS target
        USING (SELECT @loja AS loja, @pdv_numero AS pdv_numero) AS source
          ON target.loja = source.loja AND target.pdv_numero = source.pdv_numero
        WHEN MATCHED THEN
          UPDATE SET
            rep_codigo      = @rep_codigo,
            rep_nome        = @rep_nome,
            pdv_data        = @pdv_data,
            status          = @status,
            valor_total     = @valor_total,
            sincronizado_em = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (loja, rep_codigo, rep_nome, pdv_numero, pdv_data, status, valor_total)
          VALUES (@loja, @rep_codigo, @rep_nome, @pdv_numero, @pdv_data, @status, @valor_total);
      `);
  }

  return vendas.length;
}

export function startSyncJob(intervalMs = 5 * 60 * 1000) {
  const run = async () => {
    for (const loja of LOJAS) {
      try {
        const count = await syncLoja(loja);
        if (count > 0) console.log(`[sync] ${loja}: ${count} registros sincronizados`);
      } catch (err) {
        console.error(`[sync] erro na loja ${loja}:`, err);
      }
    }
  };

  // Roda imediatamente ao iniciar
  run();
  // Depois a cada X minutos
  setInterval(run, intervalMs);
  console.log(`[sync] job iniciado — intervalo: ${intervalMs / 1000}s`);
}
