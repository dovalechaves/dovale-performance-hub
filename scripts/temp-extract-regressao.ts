/**
 * Extração de dados mensais (SJC e MG) para modelagem de regressão:
 * - Faturamento e quantidade por mês, separado em CHAVES (nivel2=1), FERRAGENS (nivel2=6) e OUTROS.
 * - Headcount mensal (representantes com pelo menos 1 pedido no mês).
 * - Maturidade média (meses desde o 1º pedido de cada representante) dos representantes ativos no mês.
 *
 * Saída: JSON em scratchpad para processamento posterior em Python/pandas.
 */
import "dotenv/config";
import fs from "fs";
import { queryFirebird } from "../server/db/firebird";

const BASES = ["sjc", "mg"] as const;
const DATA_INICIO = "2024-01-01";

const FILTRO_VENDA = `
  AND ped.pdv_psi_codigo NOT IN ('CC')
  AND ped.pdv_tve_codigo NOT IN ('6', '7', '26', '34')
`;

function sqlVendasMensais() {
  return `
    SELECT
      EXTRACT(YEAR FROM ped.pdv_data) AS ano,
      EXTRACT(MONTH FROM ped.pdv_data) AS mes,
      CASE WHEN p.pro_nivel2 = 1 THEN 'chaves'
           WHEN p.pro_nivel2 = 6 THEN 'ferragens'
           ELSE 'outros' END AS categoria,
      SUM(i.pvi_quantidade) AS qtd,
      SUM(COALESCE(i.pvi_totalitem,0) + COALESCE(i.pvi_substicms,0) + COALESCE(i.pvi_vl_fcp_st,0) + COALESCE(i.pvi_ipivalor,0)) AS valor
    FROM pedidos_vendas_itens i
    INNER JOIN pedidos_vendas ped ON ped.pdv_numero = i.pvi_numero
    INNER JOIN produtos p ON p.pro_codigo = i.pvi_pro_codigo
    WHERE ped.pdv_data >= CAST('${DATA_INICIO}' AS DATE)
    ${FILTRO_VENDA}
    GROUP BY ano, mes, categoria
    ORDER BY ano, mes, categoria
  `;
}

function sqlHeadcountMensal() {
  return `
    SELECT
      EXTRACT(YEAR FROM ped.pdv_data) AS ano,
      EXTRACT(MONTH FROM ped.pdv_data) AS mes,
      COUNT(DISTINCT ped.pdv_rep_codigo) AS headcount
    FROM pedidos_vendas ped
    WHERE ped.pdv_data >= CAST('${DATA_INICIO}' AS DATE)
    ${FILTRO_VENDA}
    GROUP BY ano, mes
    ORDER BY ano, mes
  `;
}

function sqlPrimeiroPedidoPorRep() {
  return `
    SELECT ped.pdv_rep_codigo AS rep, MIN(ped.pdv_data) AS primeiro
    FROM pedidos_vendas ped
    WHERE ped.pdv_rep_codigo IS NOT NULL
    ${FILTRO_VENDA}
    GROUP BY ped.pdv_rep_codigo
  `;
}

function sqlRepsAtivosPorMes() {
  return `
    SELECT
      EXTRACT(YEAR FROM ped.pdv_data) AS ano,
      EXTRACT(MONTH FROM ped.pdv_data) AS mes,
      ped.pdv_rep_codigo AS rep
    FROM pedidos_vendas ped
    WHERE ped.pdv_data >= CAST('${DATA_INICIO}' AS DATE)
      AND ped.pdv_rep_codigo IS NOT NULL
    ${FILTRO_VENDA}
    GROUP BY ano, mes, ped.pdv_rep_codigo
  `;
}

function monthKey(ano: number, mes: number) {
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

async function main() {
  const resultado: Record<string, any> = {};

  for (const base of BASES) {
    console.log(`\n=== Extraindo base ${base.toUpperCase()} ===`);

    const vendasRows = await queryFirebird<any>(base, sqlVendasMensais());
    const headcountRows = await queryFirebird<any>(base, sqlHeadcountMensal());
    const primeiroPedidoRows = await queryFirebird<any>(base, sqlPrimeiroPedidoPorRep());
    const repsAtivosRows = await queryFirebird<any>(base, sqlRepsAtivosPorMes());

    // Mapa rep -> data do primeiro pedido (histórico completo, não só desde 2024)
    const primeiroPedidoPorRep = new Map<string, string>();
    for (const r of primeiroPedidoRows) {
      const rep = String(r.REP);
      const data = new Date(r.PRIMEIRO).toISOString().slice(0, 10);
      primeiroPedidoPorRep.set(rep, data);
    }

    // Agrupa reps ativos por mês
    const repsPorMes = new Map<string, Set<string>>();
    for (const r of repsAtivosRows) {
      const key = monthKey(Number(r.ANO), Number(r.MES));
      const rep = String(r.REP);
      if (!repsPorMes.has(key)) repsPorMes.set(key, new Set());
      repsPorMes.get(key)!.add(rep);
    }

    // Vendas por mês/categoria
    const vendasPorMes = new Map<string, any>();
    for (const r of vendasRows) {
      const key = monthKey(Number(r.ANO), Number(r.MES));
      if (!vendasPorMes.has(key)) {
        vendasPorMes.set(key, { chaves_qtd: 0, chaves_valor: 0, ferragens_qtd: 0, ferragens_valor: 0, outros_qtd: 0, outros_valor: 0 });
      }
      const entry = vendasPorMes.get(key);
      const cat = String(r.CATEGORIA).trim();
      entry[`${cat}_qtd`] = Number(r.QTD) || 0;
      entry[`${cat}_valor`] = Number(r.VALOR) || 0;
    }

    // Headcount por mês
    const headcountPorMes = new Map<string, number>();
    for (const r of headcountRows) {
      const key = monthKey(Number(r.ANO), Number(r.MES));
      headcountPorMes.set(key, Number(r.HEADCOUNT) || 0);
    }

    // Monta série mensal final
    const meses = Array.from(vendasPorMes.keys()).sort();
    const serie: any[] = [];
    for (const key of meses) {
      const [anoStr, mesStr] = key.split("-");
      const ano = Number(anoStr);
      const mes = Number(mesStr);
      const vendas = vendasPorMes.get(key) || {};
      const headcount = headcountPorMes.get(key) || 0;

      // Maturidade média (em meses) dos reps ativos nesse mês
      const repsAtivos = repsPorMes.get(key) || new Set();
      let somaMaturidade = 0;
      let n = 0;
      const refDate = new Date(ano, mes - 1, 1);
      for (const rep of repsAtivos) {
        const primeiro = primeiroPedidoPorRep.get(rep);
        if (!primeiro) continue;
        const [pAno, pMes] = primeiro.split("-").map(Number);
        const dataPrimeiro = new Date(pAno, pMes - 1, 1);
        const diffMeses = (refDate.getFullYear() - dataPrimeiro.getFullYear()) * 12 + (refDate.getMonth() - dataPrimeiro.getMonth());
        somaMaturidade += Math.max(0, diffMeses);
        n++;
      }
      const maturidadeMedia = n > 0 ? somaMaturidade / n : null;

      serie.push({
        ano,
        mes,
        chaves_qtd: vendas.chaves_qtd || 0,
        chaves_valor: vendas.chaves_valor || 0,
        ferragens_qtd: vendas.ferragens_qtd || 0,
        ferragens_valor: vendas.ferragens_valor || 0,
        outros_qtd: vendas.outros_qtd || 0,
        outros_valor: vendas.outros_valor || 0,
        headcount,
        maturidade_media_meses: maturidadeMedia,
      });
    }

    resultado[base] = serie;
    console.log(`${base}: ${serie.length} meses extraídos`);
  }

  const outPath = process.argv[2] || "regressao_dados.json";
  fs.writeFileSync(outPath, JSON.stringify(resultado, null, 2));
  console.log(`\nDados salvos em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro:", err);
    process.exit(1);
  });
