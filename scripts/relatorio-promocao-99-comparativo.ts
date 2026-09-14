/**
 * Relatório: efeito da promoção "9.9" — compara a venda do dia 09/09/2026 com a
 * média DIÁRIA (Jan-Ago/2026) dos mesmos itens, bases SJC e MG.
 *
 * Itens da promoção (códigos do encarte):
 *   17911, 67700, 95100, 77237, 36101, 37801, 99969, 43149, 42189
 *
 * Valor de venda = SUM(pvi_totalitem + pvi_substicms + pvi_vl_fcp_st + pvi_ipivalor)
 * (padrão do projeto). Exclui cancelados (pdv_psi_codigo NOT IN ('CC')) e situações
 * de não-venda (pdv_tve_codigo NOT IN ('6','7','26','34')), padrão já usado nos
 * demais relatórios.
 *
 * "Média diária Jan-Ago" = soma do período dividida pelo total de dias CORRIDOS
 * do período (01/01 a 31/08/2026 = 243 dias) — não é média só dos dias em que
 * houve venda, e não desconta domingo/feriado (se a loja não abre todo dia,
 * isso sub-estima um pouco a média "por dia útil"; avisar se precisar ajustar
 * pra dias úteis em vez de dias corridos).
 *
 * Aba única "Comparativo" — SJC+MG somados, por produto: Código, Nome,
 * Quantidade Vendida 09/09, Valor Total Vendido 09/09, Média de Venda em
 * Quantidade por Dia (Jan-Ago), Valor Total em Média Diária de Jan-Ago.
 *
 * Rodar: npx tsx scripts/relatorio-promocao-99-comparativo.ts
 */

import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const CODIGOS = ["17911", "67700", "95100", "77237", "36101", "37801", "99969", "43149", "42189"];

const DIA_PROMO = "2026-09-09";
const MEDIA_INICIO = "2026-01-01";
const MEDIA_FIM = "2026-08-31";
// Dias corridos de 01/01/2026 a 31/08/2026 (2026 não é bissexto): 31+28+31+30+31+30+31+31
const DIAS_MEDIA = 243;

const BASES = [
  { lojaKey: "sjc" as const, nome: "SJC" },
  { lojaKey: "mg" as const, nome: "MG" },
];

interface ProdutoRow {
  PRO_CODIGO: any;
  PRO_RESUMO: any;
}

interface VendaAgregada {
  PRO_CODIGO: any;
  QTD: any;
  VALOR: any;
}

function sqlProdutos() {
  return `SELECT pro_codigo, pro_resumo FROM produtos WHERE pro_codigo IN (${CODIGOS.map((c) => `'${c}'`).join(",")})`;
}

function sqlVendaDia() {
  return `
    SELECT i.pvi_pro_codigo AS pro_codigo,
      SUM(i.pvi_quantidade) AS qtd,
      SUM(i.pvi_totalitem + i.pvi_substicms + i.pvi_vl_fcp_st + i.pvi_ipivalor) AS valor
    FROM pedidos_vendas_itens i
    INNER JOIN pedidos_vendas ped ON ped.pdv_numero = i.pvi_numero
    WHERE i.pvi_pro_codigo IN (${CODIGOS.map((c) => `'${c}'`).join(",")})
      AND ped.pdv_data = CAST('${DIA_PROMO}' AS DATE)
      AND ped.pdv_psi_codigo NOT IN ('CC')
      AND ped.pdv_tve_codigo NOT IN ('6', '7', '26', '34')
    GROUP BY i.pvi_pro_codigo
  `;
}

function sqlVendaMedia() {
  return `
    SELECT i.pvi_pro_codigo AS pro_codigo,
      SUM(i.pvi_quantidade) AS qtd,
      SUM(i.pvi_totalitem + i.pvi_substicms + i.pvi_vl_fcp_st + i.pvi_ipivalor) AS valor
    FROM pedidos_vendas_itens i
    INNER JOIN pedidos_vendas ped ON ped.pdv_numero = i.pvi_numero
    WHERE i.pvi_pro_codigo IN (${CODIGOS.map((c) => `'${c}'`).join(",")})
      AND ped.pdv_data >= CAST('${MEDIA_INICIO}' AS DATE)
      AND ped.pdv_data <= CAST('${MEDIA_FIM}' AS DATE)
      AND ped.pdv_psi_codigo NOT IN ('CC')
      AND ped.pdv_tve_codigo NOT IN ('6', '7', '26', '34')
    GROUP BY i.pvi_pro_codigo
  `;
}

interface Metrica { qtdDia: number; valorDia: number; qtdMedia: number; valorMedia: number; }

async function main() {
  console.log(`=== Relatório Promoção 9.9 — Comparativo Dia x Média Diária — SJC/MG ===\n`);

  const descricoes = new Map<string, string>();
  for (const c of CODIGOS) descricoes.set(c, "");

  const consolidado = new Map<string, Metrica>();
  for (const c of CODIGOS) consolidado.set(c, { qtdDia: 0, valorDia: 0, qtdMedia: 0, valorMedia: 0 });

  for (const base of BASES) {
    console.log(`Consultando base ${base.nome}...`);
    const baseMap = new Map<string, Metrica>();
    for (const c of CODIGOS) baseMap.set(c, { qtdDia: 0, valorDia: 0, qtdMedia: 0, valorMedia: 0 });

    const produtos = await queryFirebird<ProdutoRow>(base.lojaKey, sqlProdutos());
    for (const p of produtos) {
      const codigo = p.PRO_CODIGO?.toString().trim();
      const resumo = p.PRO_RESUMO?.toString().trim() || "";
      if (codigo && resumo && !descricoes.get(codigo)) descricoes.set(codigo, resumo);
    }

    const vendaDia = await queryFirebird<VendaAgregada>(base.lojaKey, sqlVendaDia());
    for (const row of vendaDia) {
      const codigo = row.PRO_CODIGO?.toString().trim();
      if (!codigo || !baseMap.has(codigo)) continue;
      const m = baseMap.get(codigo)!;
      m.qtdDia += Number(row.QTD) || 0;
      m.valorDia += Number(row.VALOR) || 0;
    }

    const vendaMedia = await queryFirebird<VendaAgregada>(base.lojaKey, sqlVendaMedia());
    for (const row of vendaMedia) {
      const codigo = row.PRO_CODIGO?.toString().trim();
      if (!codigo || !baseMap.has(codigo)) continue;
      const m = baseMap.get(codigo)!;
      m.qtdMedia += (Number(row.QTD) || 0) / DIAS_MEDIA;
      m.valorMedia += (Number(row.VALOR) || 0) / DIAS_MEDIA;
    }

    for (const c of CODIGOS) {
      const m = baseMap.get(c)!;
      const total = consolidado.get(c)!;
      total.qtdDia += m.qtdDia;
      total.valorDia += m.valorDia;
      total.qtdMedia += m.qtdMedia;
      total.valorMedia += m.valorMedia;
    }
  }

  const sheetComparativo = CODIGOS.map((c) => {
    const m = consolidado.get(c)!;
    return {
      "Código do Produto": c,
      "Nome do Produto": descricoes.get(c) || "",
      "Quantidade Vendida 09/09": Math.round(m.qtdDia * 100) / 100,
      "Valor Total Vendido 09/09 (R$)": Math.round(m.valorDia * 100) / 100,
      "Média de Venda em Quantidade por Dia (Jan-Ago)": Math.round(m.qtdMedia * 100) / 100,
      "Valor Total em Média Diária de Jan-Ago (R$)": Math.round(m.valorMedia * 100) / 100,
    };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetComparativo), "Comparativo");

  const fileName = `Relatorio_Promocao_99_Comparativo_SJC_MG.xlsx`;
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
