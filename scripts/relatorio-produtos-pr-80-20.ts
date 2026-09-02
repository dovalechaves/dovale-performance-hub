/**
 * Relatório: Curva ABC (80/20) de produtos vendidos nos últimos 12 meses — bases SJC e MG.
 * Filtro: produtos com pro_nivel1 <> 1.
 * Classificação ABC por valor de venda (R$), consolidado SJC+MG:
 *   A = produtos que somam até 80% do valor acumulado
 *   B = de 80% a 95% do valor acumulado
 *   C = acima de 95% do valor acumulado
 *
 * Aba 1: Curva A (80%) — só os produtos classificados como A.
 * Aba 2: Curva ABC Completa — todos os produtos, com % participação e % acumulado.
 * Aba 3: Detalhe por Base (SJC / MG).
 *
 * Rodar: npx tsx scripts/relatorio-produtos-pr-80-20.ts
 */

import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const BASES = [
  { lojaKey: "sjc" as const, nome: "SJC" },
  { lojaKey: "mg" as const, nome: "MG" },
];

interface Row {
  PRO_CODIGO: any;
  PRO_RESUMO: any;
  GRUPO: any;
  SUBGRUPO: any;
  QTD: any;
  VALOR: any;
}

function sql() {
  return `
    SELECT p.pro_codigo, p.pro_resumo, g.nome AS grupo, sg.nome AS subgrupo,
      SUM(i.pvi_quantidade) AS qtd,
      SUM(COALESCE(i.pvi_totalitem,0) + COALESCE(i.pvi_substicms,0) + COALESCE(i.pvi_vl_fcp_st,0) + COALESCE(i.pvi_ipivalor,0)) AS valor
    FROM pedidos_vendas_itens i
    INNER JOIN pedidos_vendas ped ON ped.pdv_numero = i.pvi_numero
    INNER JOIN produtos p ON p.pro_codigo = i.pvi_pro_codigo
    LEFT JOIN produtos_nivel1 g ON g.codigo = p.pro_nivel1
    LEFT JOIN produtos_nivel2 sg ON sg.codigo = p.pro_nivel2
    WHERE p.pro_nivel1 <> 1
      AND ped.pdv_data >= DATEADD(MONTH, -12, CAST('NOW' AS DATE))
      AND ped.pdv_data <= CAST('NOW' AS DATE)
      AND ped.pdv_psi_codigo NOT IN ('CC')
      AND ped.pdv_tve_codigo NOT IN ('6', '7', '26', '34')
    GROUP BY p.pro_codigo, p.pro_resumo, g.nome, sg.nome
  `;
}

interface Produto {
  codigo: string;
  descricao: string;
  grupo: string;
  subgrupo: string;
  qtd: number;
  valor: number;
  qtdSjc: number;
  qtdMg: number;
  valorSjc: number;
  valorMg: number;
}

async function main() {
  console.log(`=== Relatório Curva ABC (80/20) — pro_nivel1 <> 1 — últimos 12 meses — SJC/MG ===\n`);

  const consolidado = new Map<string, Produto>();
  const detalheBase: { base: string; codigo: string; descricao: string; qtd: number; valor: number }[] = [];

  for (const base of BASES) {
    console.log(`Consultando base ${base.nome}...`);
    const rows = await queryFirebird<Row>(base.lojaKey, sql());
    console.log(`  ${rows.length} produtos com venda na base ${base.nome}`);

    for (const row of rows) {
      const codigo = row.PRO_CODIGO?.toString().trim() || "";
      if (!codigo) continue;
      const descricao = row.PRO_RESUMO?.toString().trim() || "";
      const qtd = Number(row.QTD) || 0;
      const valor = Number(row.VALOR) || 0;

      detalheBase.push({ base: base.nome, codigo, descricao, qtd, valor });

      const existente = consolidado.get(codigo);
      if (existente) {
        existente.qtd += qtd;
        existente.valor += valor;
        if (base.nome === "SJC") { existente.qtdSjc += qtd; existente.valorSjc += valor; }
        else { existente.qtdMg += qtd; existente.valorMg += valor; }
      } else {
        consolidado.set(codigo, {
          codigo,
          descricao,
          grupo: row.GRUPO?.toString().trim() || "",
          subgrupo: row.SUBGRUPO?.toString().trim() || "",
          qtd,
          valor,
          qtdSjc: base.nome === "SJC" ? qtd : 0,
          qtdMg: base.nome === "MG" ? qtd : 0,
          valorSjc: base.nome === "SJC" ? valor : 0,
          valorMg: base.nome === "MG" ? valor : 0,
        });
      }
    }
  }

  // Curva ABC por valor de venda (R$), consolidado SJC+MG
  const produtos = Array.from(consolidado.values()).sort((a, b) => b.valor - a.valor);
  const totalValor = produtos.reduce((s, p) => s + p.valor, 0);
  console.log(`\nTotal de produtos consolidados (SJC+MG): ${produtos.length}`);
  console.log(`Valor total vendido (últ. 12 meses): R$ ${totalValor.toFixed(2)}`);

  let acumulado = 0;
  const classificados = produtos.map((p) => {
    acumulado += p.valor;
    const percAcumulado = totalValor > 0 ? (acumulado / totalValor) * 100 : 0;
    const curva = percAcumulado <= 80 ? "A" : percAcumulado <= 95 ? "B" : "C";
    return {
      ...p,
      percParticipacao: totalValor > 0 ? (p.valor / totalValor) * 100 : 0,
      percAcumulado,
      curva,
    };
  });

  const curvaA = classificados.filter((p) => p.curva === "A");
  const contagem = { A: curvaA.length, B: classificados.filter((p) => p.curva === "B").length, C: classificados.filter((p) => p.curva === "C").length };
  console.log(`Curva A: ${contagem.A} produtos | Curva B: ${contagem.B} | Curva C: ${contagem.C}`);

  const mapLinha = (p: (typeof classificados)[number]) => ({
    "Código": p.codigo,
    "Descrição": p.descricao,
    "Grupo": p.grupo,
    "Subgrupo": p.subgrupo,
    "Qtd. Vendida SJC": Math.round(p.qtdSjc * 100) / 100,
    "Qtd. Vendida MG": Math.round(p.qtdMg * 100) / 100,
    "Qtd. Vendida Total": Math.round(p.qtd * 100) / 100,
    "Valor Total (R$)": Math.round(p.valor * 100) / 100,
    "% Participação": Math.round(p.percParticipacao * 100) / 100,
    "% Acumulado": Math.round(p.percAcumulado * 100) / 100,
    "Curva ABC": p.curva,
  });

  const sheetCurvaA = curvaA.map(mapLinha);
  const sheetCompleta = classificados.map(mapLinha);

  const sheetDetalheBase = detalheBase
    .sort((a, b) => a.base.localeCompare(b.base) || b.valor - a.valor)
    .map((d) => ({
      "Base": d.base,
      "Código": d.codigo,
      "Descrição": d.descricao,
      "Qtd. Vendida": Math.round(d.qtd * 100) / 100,
      "Valor Total (R$)": Math.round(d.valor * 100) / 100,
    }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetCurvaA), "Curva A (80%)");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetCompleta), "Curva ABC Completa");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetDetalheBase), "Detalhe por Base");

  const fileName = `Relatorio_Curva_ABC_80_20_SJC_MG.xlsx`;
  const outPath = path.join(os.homedir(), "Desktop", fileName);
  XLSX.writeFile(wb, outPath);

  console.log(`\nRelatório salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
