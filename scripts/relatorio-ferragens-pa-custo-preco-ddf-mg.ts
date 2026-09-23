/**
 * Relatório: Produtos "Ferragens PA" — base MG.
 *
 * Filtro: pro_tipo = 'PA' AND pro_nivel2 <> 1 (tudo que é Produto Acabado,
 * exceto o subgrupo CHAVE — pro_nivel2 1 = CHAVE, ver memória
 * project-data-landscape).
 *
 * Saldo em estoque: PRODUTOS_SALDOS (saldo físico), filial 7 (MG), local de
 * estoque 1 (Almoxarifado — única loja de estoque cadastrada em MG, sem
 * split Ecommerce como SJC/outras lojas, ver server/routes/inventario.ts).
 *
 * Custo e Preço: tabela "DDF" = TABELAS_PRODUTOS com TBP_TAB_CODIGO = 4
 * (mesma tabela usada em server/routes/multi-preco.ts e ecommerce.ts).
 * TBP_CUSTO = custo, TBP_PRECO = preço de venda dessa tabela — confirmado
 * empiricamente (2026-09-18) que TBP_CUSTO é igual entre tabelas de preço
 * (custo não varia por tabela), só TBP_PRECO muda.
 *
 * Colunas extras: Preço da Tabela 1 e Preço da Tabela 6 (mesma TABELAS_PRODUTOS,
 * TBP_TAB_CODIGO = 1 e 6, join independente do DDF).
 *
 * Produtos sem saldo ou sem cadastro na tabela DDF entram com 0/vazio, não
 * são excluídos da lista.
 *
 * Rodar: npx tsx scripts/relatorio-ferragens-pa-custo-preco-ddf-mg.ts
 */

import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const FILIAL_MG = 7;
const LOCAL_ESTOQUE = 1; // Almoxarifado (única loja de estoque em MG)
const TABELA_DDF = 4;
const TABELA_1 = 1;
const TABELA_6 = 6;

interface ProdutoRow {
  PRO_CODIGO: any;
  PRO_RESUMO: any;
  SALDO: any;
  CUSTO: any;
  PRECO: any;
  PRECO_T1: any;
  PRECO_T6: any;
}

function sqlProdutos() {
  return `
    SELECT
      p.pro_codigo AS pro_codigo,
      p.pro_resumo AS pro_resumo,
      COALESCE(s.prs_saldo, 0) AS saldo,
      t4.tbp_custo AS custo,
      t4.tbp_preco AS preco,
      t1.tbp_preco AS preco_t1,
      t6.tbp_preco AS preco_t6
    FROM produtos p
    LEFT JOIN produtos_saldos s
      ON s.prs_pro_codigo = p.pro_codigo
     AND s.prs_fil_codigo = '${FILIAL_MG}'
     AND s.prs_ple_codigo = '${LOCAL_ESTOQUE}'
    LEFT JOIN tabelas_produtos t4
      ON t4.tbp_pro_codigo = p.pro_codigo
     AND t4.tbp_tab_codigo = ${TABELA_DDF}
    LEFT JOIN tabelas_produtos t1
      ON t1.tbp_pro_codigo = p.pro_codigo
     AND t1.tbp_tab_codigo = ${TABELA_1}
    LEFT JOIN tabelas_produtos t6
      ON t6.tbp_pro_codigo = p.pro_codigo
     AND t6.tbp_tab_codigo = ${TABELA_6}
    WHERE p.pro_tipo = 'PA' AND p.pro_nivel2 <> 1
    ORDER BY p.pro_codigo
  `;
}

async function main() {
  console.log(`=== Relatório Ferragens PA (custo/preço DDF) — Base MG ===\n`);

  const rows = await queryFirebird<ProdutoRow>("mg", sqlProdutos());
  console.log(`${rows.length} produtos (pro_tipo = 'PA' e pro_nivel2 <> 1)`);

  const produtos = rows.map((r) => ({
    "Código": Number(r.PRO_CODIGO),
    "Resumo": r.PRO_RESUMO?.toString().trim() || "",
    "Saldo em Estoque": Math.round((Number(r.SALDO) || 0) * 100) / 100,
    "Custo (DDF)": r.CUSTO != null ? Math.round(Number(r.CUSTO) * 100) / 100 : "",
    "Preço (DDF)": r.PRECO != null ? Math.round(Number(r.PRECO) * 100) / 100 : "",
    "Preço (Tabela 1)": r.PRECO_T1 != null ? Math.round(Number(r.PRECO_T1) * 100) / 100 : "",
    "Preço (Tabela 6)": r.PRECO_T6 != null ? Math.round(Number(r.PRECO_T6) * 100) / 100 : "",
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(produtos);
  ws["!cols"] = [{ wch: 10 }, { wch: 45 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws, "Ferragens PA - MG");

  const fileName = `Ferragens_PA_Custo_Preco_DDF_MG.xlsx`;
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
