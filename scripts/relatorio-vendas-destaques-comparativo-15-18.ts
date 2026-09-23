/**
 * Relatório: Comparativo de venda dos itens do encarte "Destaques de Setembro"
 * pelos setores TELEVENDAS e TELEVENDAS MG, bases SJC e MG (unificadas) —
 * 15 a 18/09/2026 (venda + média diária) vs. média diária de 01 a 14/09/2026.
 *
 * Mesmo esquema dos relatórios anteriores desse encarte, com 2 mudanças:
 *   - Produto 7546 trocado por 7756.
 *   - Períodos: 15-18/09 (venda total + média diária) e 01-14/09 (só média
 *     diária, pra comparar com o ritmo dos dias mais recentes).
 *
 * Setor = representante do PEDIDO (pdv_rep_codigo) → representantes.rep_rvs_codigo
 * → representantes_supervisores.rvs_nome IN ('TELEVENDAS', 'TELEVENDAS MG').
 *
 * Valor de venda = SUM(pvi_totalitem + pvi_substicms + pvi_vl_fcp_st + pvi_ipivalor)
 * (padrão do projeto). Exclui cancelados (pdv_psi_codigo NOT IN ('CC')) e situações
 * de não-venda (pdv_tve_codigo NOT IN ('6','7','26','34')).
 *
 * Nome do produto sempre aparece, mesmo sem venda no período (busca direto no
 * cadastro, independente de ter linha de venda).
 *
 * Aba 1: Resumo — Código / Nome / Qtde e Valor (15-17/09) / Média Diária
 * Qtde e Valor (15-17/09) / Média Diária Qtde e Valor (01-14/09).
 * Aba 2: Detalhe por Base, Setor e Período.
 *
 * Rodar: npx tsx scripts/relatorio-vendas-destaques-comparativo-15-17.ts
 */

import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const CODIGOS_PRODUTO = [7756, 43010, 14000, 5999, 12020, 12025, 12030, 12035, 12040, 12045, 12050];

const PERIODOS = [
  { chave: "p15_18", label: "15 a 18/09/2026", inicio: "2026-09-15", fim: "2026-09-19", dias: 4 },
  { chave: "p01_14", label: "01 a 14/09/2026", inicio: "2026-09-01", fim: "2026-09-15", dias: 14 },
] as const;

const BASES = [
  { lojaKey: "sjc" as const, nome: "SJC" },
  { lojaKey: "mg" as const, nome: "MG" },
];

const SETORES = ["TELEVENDAS", "TELEVENDAS MG"];

interface VendaRow {
  PRO_CODIGO: any;
  PRO_RESUMO: any;
  RVS_NOME: any;
  QTDE: any;
  VALOR: any;
}

function sqlVendas(inicio: string, fim: string) {
  const listaCodigos = CODIGOS_PRODUTO.join(",");
  const listaSetores = SETORES.map((s) => `'${s}'`).join(",");
  return `
    SELECT
      p.pro_codigo AS pro_codigo,
      p.pro_resumo AS pro_resumo,
      rs.rvs_nome AS rvs_nome,
      SUM(i.pvi_quantidade) AS qtde,
      SUM(i.pvi_totalitem + i.pvi_substicms + i.pvi_vl_fcp_st + i.pvi_ipivalor) AS valor
    FROM pedidos_vendas ped
    INNER JOIN pedidos_vendas_itens i ON i.pvi_numero = ped.pdv_numero
    INNER JOIN produtos p ON p.pro_codigo = i.pvi_pro_codigo
    INNER JOIN representantes r ON r.rep_codigo = ped.pdv_rep_codigo
    INNER JOIN representantes_supervisores rs ON rs.rvs_codigo = r.rep_rvs_codigo
    WHERE i.pvi_pro_codigo IN (${listaCodigos})
      AND rs.rvs_nome IN (${listaSetores})
      AND ped.pdv_data >= CAST('${inicio}' AS DATE)
      AND ped.pdv_data < CAST('${fim}' AS DATE)
      AND ped.pdv_psi_codigo NOT IN ('CC')
      AND ped.pdv_tve_codigo NOT IN ('6', '7', '26', '34')
    GROUP BY p.pro_codigo, p.pro_resumo, rs.rvs_nome
    ORDER BY p.pro_codigo
  `;
}

async function buscarNomesProdutos(): Promise<Map<number, string>> {
  const listaCodigos = CODIGOS_PRODUTO.join(",");
  const nomes = new Map<number, string>();
  for (const base of BASES) {
    const rows = await queryFirebird<{ PRO_CODIGO: any; PRO_RESUMO: any }>(
      base.lojaKey,
      `SELECT pro_codigo, pro_resumo FROM produtos WHERE pro_codigo IN (${listaCodigos})`
    );
    for (const row of rows) {
      const codigo = Number(row.PRO_CODIGO);
      if (!nomes.has(codigo)) nomes.set(codigo, row.PRO_RESUMO?.toString().trim() || "");
    }
  }
  return nomes;
}

async function main() {
  console.log(`=== Comparativo Destaques de Setembro — Televendas/Televendas MG — SJC+MG ===\n`);

  const nomesProdutos = await buscarNomesProdutos();
  const detalhe: { periodo: string; base: string; setor: string; proCodigo: number; proResumo: string; qtde: number; valor: number }[] = [];
  const totalPorPeriodoProduto = new Map<string, Map<number, { proResumo: string; qtde: number; valor: number }>>();

  for (const periodo of PERIODOS) {
    console.log(`Período ${periodo.label}...`);
    const totalPorProduto = new Map<number, { proResumo: string; qtde: number; valor: number }>();
    for (const base of BASES) {
      const rows = await queryFirebird<VendaRow>(base.lojaKey, sqlVendas(periodo.inicio, periodo.fim));
      console.log(`  ${base.nome}: ${rows.length} linhas`);
      for (const row of rows) {
        const proCodigo = Number(row.PRO_CODIGO);
        const proResumo = row.PRO_RESUMO?.toString().trim() || "";
        const qtde = Number(row.QTDE) || 0;
        const valor = Number(row.VALOR) || 0;

        detalhe.push({
          periodo: periodo.label,
          base: base.nome,
          setor: row.RVS_NOME?.toString().trim() || "",
          proCodigo,
          proResumo,
          qtde,
          valor,
        });

        const atual = totalPorProduto.get(proCodigo);
        if (atual) {
          atual.qtde += qtde;
          atual.valor += valor;
        } else {
          totalPorProduto.set(proCodigo, { proResumo, qtde, valor });
        }
      }
    }
    totalPorPeriodoProduto.set(periodo.chave, totalPorProduto);
  }

  const totaisP15_18 = totalPorPeriodoProduto.get("p15_18")!;
  const totaisP01_14 = totalPorPeriodoProduto.get("p01_14")!;
  const diasP15_18 = PERIODOS.find((p) => p.chave === "p15_18")!.dias;
  const diasP01_14 = PERIODOS.find((p) => p.chave === "p01_14")!.dias;

  const sheetResumo = CODIGOS_PRODUTO.map((codigo) => {
    const r1 = totaisP15_18.get(codigo);
    const r2 = totaisP01_14.get(codigo);
    const qtde1 = r1?.qtde ?? 0;
    const valor1 = r1?.valor ?? 0;
    const qtde2 = r2?.qtde ?? 0;
    const valor2 = r2?.valor ?? 0;
    return {
      "Código do Produto": codigo,
      "Nome do Produto": r1?.proResumo || r2?.proResumo || nomesProdutos.get(codigo) || "(produto não encontrado no cadastro)",
      "Qtde Vendida (15 a 18/09)": Math.round(qtde1 * 100) / 100,
      "Valor Total Vendido (R$) (15 a 18/09)": Math.round(valor1 * 100) / 100,
      "Média Diária Qtde (15 a 18/09)": Math.round((qtde1 / diasP15_18) * 100) / 100,
      "Média Diária Valor (R$) (15 a 18/09)": Math.round((valor1 / diasP15_18) * 100) / 100,
      "Média Diária Qtde (01 a 14/09)": Math.round((qtde2 / diasP01_14) * 100) / 100,
      "Média Diária Valor (R$) (01 a 14/09)": Math.round((valor2 / diasP01_14) * 100) / 100,
    };
  });

  const sheetDetalhe = detalhe
    .sort((a, b) => a.proCodigo - b.proCodigo || a.periodo.localeCompare(b.periodo) || a.base.localeCompare(b.base) || a.setor.localeCompare(b.setor))
    .map((d) => ({
      "Código do Produto": d.proCodigo,
      "Nome do Produto": d.proResumo,
      "Período": d.periodo,
      "Base": d.base,
      "Setor": d.setor,
      "Quantidade Vendida": Math.round(d.qtde * 100) / 100,
      "Valor Total Vendido (R$)": Math.round(d.valor * 100) / 100,
    }));

  const wb = XLSX.utils.book_new();
  const wsResumo = XLSX.utils.json_to_sheet(sheetResumo);
  wsResumo["!cols"] = [
    { wch: 14 }, { wch: 40 }, { wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetDetalhe), "Detalhe por Base e Setor");

  const fileName = `Vendas_Destaques_Setembro_Comparativo_15-18.xlsx`;
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
