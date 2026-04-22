import { queryFirebird } from "../db/firebird";
import { getPool } from "../db/sqlserver";

const LOJAS = ["bh", "l2", "l3", "campinas", "riopreto"] as const;

interface VendaFirebird {
  REP_CODIGO: string;
  REP_NOME: string;
  PDV_NUMERO: string;
  PDV_DATA: Date;
  STATUS: string;
  TOTAL: number;
}

async function syncLoja(loja: typeof LOJAS[number]) {
  const ano = new Date().getFullYear();
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
    WHERE pv.PDV_DATA >= '01.01.${ano}'
      AND r.REP_NOME IS NOT NULL
      AND pv.PDV_TVE_CODIGO NOT IN ('7','6','26','34')
    GROUP BY r.REP_CODIGO, r.REP_NOME, pv.PDV_NUMERO, pv.PDV_DATA, pv.PDV_PSI_CODIGO
  `);

  if (vendas.length === 0) return 0;

  // Deduplica por pdv_numero — mantém o de maior valor caso repita
  const map = new Map<string, VendaFirebird>();
  for (const v of vendas) {
    const key = String(v.PDV_NUMERO);
    const existing = map.get(key);
    if (!existing || v.TOTAL > existing.TOTAL) map.set(key, v);
  }
  const unicas = Array.from(map.values());

  const pool = await getPool();

  // Apaga todo o ano e reinserida tudo do Firebird — garante dados sempre frescos
  await pool.request()
    .input("loja", loja)
    .input("ano",  ano)
    .query(`
      DELETE FROM dbo.VENDAS_LOJAS_APP
      WHERE loja = @loja
        AND YEAR(pdv_data) = @ano
    `);

  for (const v of unicas) {
    await pool.request()
      .input("loja",        loja)
      .input("rep_codigo",  String(v.REP_CODIGO).trim())
      .input("rep_nome",    v.REP_NOME)
      .input("pdv_numero",  String(v.PDV_NUMERO).trim())
      .input("pdv_data",    v.PDV_DATA)
      .input("status",      v.STATUS)
      .input("valor_total", v.TOTAL)
      .query(`
        INSERT INTO dbo.VENDAS_LOJAS_APP
          (loja, rep_codigo, rep_nome, pdv_numero, pdv_data, status, valor_total)
        SELECT @loja, @rep_codigo, @rep_nome, @pdv_numero, @pdv_data, @status, @valor_total
        WHERE NOT EXISTS (
          SELECT 1 FROM dbo.VENDAS_LOJAS_APP
          WHERE loja = @loja AND pdv_numero = @pdv_numero
        )
      `);
  }

  return unicas.length;
}

export function startSyncJob(intervalMs = 5 * 60 * 1000) {
  let running = false;

  const run = async () => {
    if (running) return; // evita execução paralela
    running = true;
    for (const loja of LOJAS) {
      try {
        const count = await syncLoja(loja);
        console.log(`[sync] ${loja}: ${count} registros — ${new Date().toLocaleTimeString("pt-BR")}`);
      } catch (err) {
        console.error(`[sync] ERRO na loja ${loja}:`, err instanceof Error ? err.message : err);
      }
    }
    running = false;
  };

  run();
  setInterval(run, intervalMs);
  console.log(`[sync] job iniciado — intervalo: ${intervalMs / 1000}s`);
}
