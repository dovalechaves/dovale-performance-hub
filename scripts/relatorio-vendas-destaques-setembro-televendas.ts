/**
 * Relatório: Vendas dos itens do encarte "Destaques de Setembro" pelos setores
 * TELEVENDAS e TELEVENDAS MG, bases SJC e MG, apenas no dia 16/09/2026.
 *
 * Setor = representante do PEDIDO (pdv_rep_codigo) → representantes.rep_rvs_codigo
 * → representantes_supervisores.rvs_nome IN ('TELEVENDAS', 'TELEVENDAS MG')
 * (mesmo padrão de outros relatórios de setor do projeto).
 *
 * Valor de venda = SUM(pvi_totalitem + pvi_substicms + pvi_vl_fcp_st + pvi_ipivalor)
 * (padrão do projeto). Exclui cancelados (pdv_psi_codigo NOT IN ('CC')) e situações
 * de não-venda (pdv_tve_codigo NOT IN ('6','7','26','34')).
 *
 * Aba 1: Resumo — Código / Nome do Produto / Quantidade Vendida / Valor Total Vendido
 * (SJC + MG, Televendas + Televendas MG somados).
 * Aba 2: Detalhe por Base e Setor — mesma quebra, aberta por Base/Setor, para
 * conferência.
 *
 * Rodar: npx tsx scripts/relatorio-vendas-destaques-setembro-televendas.ts
 */

import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const DATA_INICIO = "2026-09-16";
const DATA_FIM = "2026-09-17"; // exclusivo

const CODIGOS_PRODUTO = [7546, 43010, 14000, 5999, 12020, 12025, 12030, 12035, 12040, 12045, 12050];

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

function sqlVendas() {
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
      AND ped.pdv_data >= CAST('${DATA_INICIO}' AS DATE)
      AND ped.pdv_data < CAST('${DATA_FIM}' AS DATE)
      AND ped.pdv_psi_codigo NOT IN ('CC')
      AND ped.pdv_tve_codigo NOT IN ('6', '7', '26', '34')
    GROUP BY p.pro_codigo, p.pro_resumo, rs.rvs_nome
    ORDER BY p.pro_codigo
  `;
}

async function buscarNomesProdutos(): Promise<Map<number, string>> {
  // Nome do produto independe de ter venda no período — busca direto no
  // cadastro (produtos.pro_resumo), SJC primeiro e completa com MG.
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
  console.log(`=== Vendas Destaques de Setembro — Televendas/Televendas MG — SJC+MG — ${DATA_INICIO} ===\n`);

  const nomesProdutos = await buscarNomesProdutos();
  const detalhe: { base: string; setor: string; proCodigo: number; proResumo: string; qtde: number; valor: number }[] = [];

  for (const base of BASES) {
    console.log(`Consultando base ${base.nome}...`);
    const rows = await queryFirebird<VendaRow>(base.lojaKey, sqlVendas());
    console.log(`  ${rows.length} linhas produto/setor com venda na base ${base.nome}`);
    for (const row of rows) {
      detalhe.push({
        base: base.nome,
        setor: row.RVS_NOME?.toString().trim() || "",
        proCodigo: Number(row.PRO_CODIGO),
        proResumo: row.PRO_RESUMO?.toString().trim() || "",
        qtde: Number(row.QTDE) || 0,
        valor: Number(row.VALOR) || 0,
      });
    }
  }

  // Aba 1: Resumo — soma por produto (SJC+MG, Televendas+Televendas MG juntos)
  const resumoPorProduto = new Map<number, { proResumo: string; qtde: number; valor: number }>();
  for (const d of detalhe) {
    const atual = resumoPorProduto.get(d.proCodigo);
    if (atual) {
      atual.qtde += d.qtde;
      atual.valor += d.valor;
    } else {
      resumoPorProduto.set(d.proCodigo, { proResumo: d.proResumo, qtde: d.qtde, valor: d.valor });
    }
  }

  const sheetResumo = CODIGOS_PRODUTO.map((codigo) => {
    const r = resumoPorProduto.get(codigo);
    return {
      "Código do Produto": codigo,
      "Nome do Produto": r?.proResumo || nomesProdutos.get(codigo) || "(produto não encontrado no cadastro)",
      "Quantidade Vendida": r ? Math.round(r.qtde * 100) / 100 : 0,
      "Valor Total Vendido (R$)": r ? Math.round(r.valor * 100) / 100 : 0,
    };
  });

  // Aba 2: Detalhe por Base e Setor
  const sheetDetalhe = detalhe
    .sort((a, b) => a.proCodigo - b.proCodigo || a.base.localeCompare(b.base) || a.setor.localeCompare(b.setor))
    .map((d) => ({
      "Código do Produto": d.proCodigo,
      "Nome do Produto": d.proResumo,
      "Base": d.base,
      "Setor": d.setor,
      "Quantidade Vendida": Math.round(d.qtde * 100) / 100,
      "Valor Total Vendido (R$)": Math.round(d.valor * 100) / 100,
    }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetResumo), "Resumo");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetDetalhe), "Detalhe por Base e Setor");

  const fileName = `Vendas_Destaques_Setembro_Televendas_16-09.xlsx`;
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
