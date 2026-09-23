/**
 * Relatório consolidado (venda do dia + venda 01-15/09 + média diária) do
 * produto 7456 (CHAVE CANIVETE GM MODELO CRUZE 2 BOTÕES OCA), pelos setores
 * TELEVENDAS e TELEVENDAS MG, bases SJC e MG — mesmo modelo da planilha
 * "Destaques de Setembro" que o Willian já vinha montando manualmente
 * juntando os dois relatórios anteriores (venda do dia 16/09 e média
 * diária 01-15/09), agora numa aba só, pra esse produto específico.
 *
 * Nota: 7456 é o código correto no cadastro pra "CHAVE CANIVETE GM MODELO
 * CRUZE 2 BOTÕES OCA" (confirmado em SJC e MG) — o código 7546 usado nos
 * relatórios anteriores é outro produto (CHAVE CANIVETE GM ASTRA/VECTRA).
 *
 * Setor = representante do PEDIDO (pdv_rep_codigo) → representantes.rep_rvs_codigo
 * → representantes_supervisores.rvs_nome IN ('TELEVENDAS', 'TELEVENDAS MG').
 *
 * Valor de venda = SUM(pvi_totalitem + pvi_substicms + pvi_vl_fcp_st + pvi_ipivalor)
 * (padrão do projeto). Exclui cancelados (pdv_psi_codigo NOT IN ('CC')) e situações
 * de não-venda (pdv_tve_codigo NOT IN ('6','7','26','34')).
 *
 * Média diária = Total de 01-15/09 / 15 dias corridos.
 *
 * Aba 1: Resumo — Código / Nome do Produto / Qtde e Valor do dia 16/09 /
 * Qtde e Valor de 01-15/09 / Média Diária (Qtde e Valor).
 * Aba 2: Detalhe por Base, Setor e Período.
 *
 * Rodar: npx tsx scripts/relatorio-vendas-7456-consolidado.ts
 */

import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const PRO_CODIGO = 7456;

const PERIODOS = [
  { chave: "dia16", label: "16/09/2026", inicio: "2026-09-16", fim: "2026-09-17", dias: 1 },
  { chave: "periodo0115", label: "01 a 15/09/2026", inicio: "2026-09-01", fim: "2026-09-16", dias: 15 },
] as const;

const BASES = [
  { lojaKey: "sjc" as const, nome: "SJC" },
  { lojaKey: "mg" as const, nome: "MG" },
];

const SETORES = ["TELEVENDAS", "TELEVENDAS MG"];

interface VendaRow {
  PRO_RESUMO: any;
  RVS_NOME: any;
  QTDE: any;
  VALOR: any;
}

function sqlVendas(inicio: string, fim: string) {
  const listaSetores = SETORES.map((s) => `'${s}'`).join(",");
  return `
    SELECT
      p.pro_resumo AS pro_resumo,
      rs.rvs_nome AS rvs_nome,
      SUM(i.pvi_quantidade) AS qtde,
      SUM(i.pvi_totalitem + i.pvi_substicms + i.pvi_vl_fcp_st + i.pvi_ipivalor) AS valor
    FROM pedidos_vendas ped
    INNER JOIN pedidos_vendas_itens i ON i.pvi_numero = ped.pdv_numero
    INNER JOIN produtos p ON p.pro_codigo = i.pvi_pro_codigo
    INNER JOIN representantes r ON r.rep_codigo = ped.pdv_rep_codigo
    INNER JOIN representantes_supervisores rs ON rs.rvs_codigo = r.rep_rvs_codigo
    WHERE i.pvi_pro_codigo = ${PRO_CODIGO}
      AND rs.rvs_nome IN (${listaSetores})
      AND ped.pdv_data >= CAST('${inicio}' AS DATE)
      AND ped.pdv_data < CAST('${fim}' AS DATE)
      AND ped.pdv_psi_codigo NOT IN ('CC')
      AND ped.pdv_tve_codigo NOT IN ('6', '7', '26', '34')
    GROUP BY p.pro_resumo, rs.rvs_nome
  `;
}

async function buscarNomeProduto(): Promise<string> {
  for (const base of BASES) {
    const rows = await queryFirebird<{ PRO_RESUMO: any }>(
      base.lojaKey,
      `SELECT pro_resumo FROM produtos WHERE pro_codigo = ${PRO_CODIGO}`
    );
    if (rows[0]?.PRO_RESUMO) return rows[0].PRO_RESUMO.toString().trim();
  }
  return "(produto não encontrado no cadastro)";
}

async function main() {
  console.log(`=== Relatório Consolidado — Produto ${PRO_CODIGO} — Televendas/Televendas MG — SJC+MG ===\n`);

  const nomeProduto = await buscarNomeProduto();
  console.log(`Produto: ${PRO_CODIGO} - ${nomeProduto}\n`);

  const detalhe: { periodo: string; base: string; setor: string; qtde: number; valor: number }[] = [];
  const totalPorPeriodo = new Map<string, { qtde: number; valor: number }>();

  for (const periodo of PERIODOS) {
    console.log(`Período ${periodo.label}...`);
    let qtdeTotal = 0;
    let valorTotal = 0;
    for (const base of BASES) {
      const rows = await queryFirebird<VendaRow>(base.lojaKey, sqlVendas(periodo.inicio, periodo.fim));
      console.log(`  ${base.nome}: ${rows.length} linhas`);
      for (const row of rows) {
        const qtde = Number(row.QTDE) || 0;
        const valor = Number(row.VALOR) || 0;
        detalhe.push({
          periodo: periodo.label,
          base: base.nome,
          setor: row.RVS_NOME?.toString().trim() || "",
          qtde,
          valor,
        });
        qtdeTotal += qtde;
        valorTotal += valor;
      }
    }
    totalPorPeriodo.set(periodo.chave, { qtde: qtdeTotal, valor: valorTotal });
  }

  const dia16 = totalPorPeriodo.get("dia16") || { qtde: 0, valor: 0 };
  const periodo0115 = totalPorPeriodo.get("periodo0115") || { qtde: 0, valor: 0 };
  const diasMedia = PERIODOS.find((p) => p.chave === "periodo0115")!.dias;

  const sheetResumo = [
    {
      "Código do Produto": PRO_CODIGO,
      "Nome do Produto": nomeProduto,
      "Quantidade Vendida (16/09)": Math.round(dia16.qtde * 100) / 100,
      "Valor Total Vendido (R$) (16/09)": Math.round(dia16.valor * 100) / 100,
      "Qtde Vendida (01 a 15/09)": Math.round(periodo0115.qtde * 100) / 100,
      "Total Vendido (R$) (01 a 15/09)": Math.round(periodo0115.valor * 100) / 100,
      "Média Diária (Qtde)": Math.round((periodo0115.qtde / diasMedia) * 100) / 100,
      "Média Diária (R$)": Math.round((periodo0115.valor / diasMedia) * 100) / 100,
    },
  ];

  const sheetDetalhe = detalhe
    .sort((a, b) => a.periodo.localeCompare(b.periodo) || a.base.localeCompare(b.base) || a.setor.localeCompare(b.setor))
    .map((d) => ({
      "Período": d.periodo,
      "Base": d.base,
      "Setor": d.setor,
      "Quantidade Vendida": Math.round(d.qtde * 100) / 100,
      "Valor Total Vendido (R$)": Math.round(d.valor * 100) / 100,
    }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetResumo), "Resumo");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetDetalhe), "Detalhe por Base e Setor");

  const fileName = `Vendas_Produto_7456_Consolidado.xlsx`;
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
