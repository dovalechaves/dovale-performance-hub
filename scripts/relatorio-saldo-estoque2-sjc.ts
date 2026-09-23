/**
 * Relatório: Produtos com saldo no Local de Estoque 2 — base SJC.
 *
 * Local de Estoque 2 (PRODUTOS_LOCAIS_ESTOQUE.PLE_CODIGO) na base SJC = "Ecommerce"
 * (mesmo mapeamento usado pelo módulo de Inventário, server/routes/inventario.ts —
 * SJC tem filial 1 e ecommercePle 2; Almoxarifado é sempre PLE_CODIGO 1).
 *
 * Saldo = PRODUTOS_SALDOS.PRS_SALDO (saldo físico bruto), filtrado por
 * PRS_FIL_CODIGO = 1 (filial da SJC) e PRS_PLE_CODIGO = 2, PRS_SALDO > 0.
 *
 * Aba 1: Resumo — total de produtos com saldo e total de produtos distintos
 * (confirmado empiricamente: PRODUTOS_SALDOS tem no máximo 1 linha por
 * produto/filial/local, então os dois números coincidem — sem duplicidade).
 * Aba 2: Produtos — lista completa (Código / Descrição / Tipo / Saldo).
 *
 * Rodar: npx tsx scripts/relatorio-saldo-estoque2-sjc.ts
 */

import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const FILIAL = 1;
const LOCAL_ESTOQUE = 2;

interface ProdutoSaldoRow {
  PRO_CODIGO: any;
  PRO_RESUMO: any;
  PRO_TIPO: any;
  SALDO: any;
}

function sqlProdutosComSaldo() {
  return `
    SELECT
      p.PRO_CODIGO AS pro_codigo,
      p.PRO_RESUMO AS pro_resumo,
      p.PRO_TIPO AS pro_tipo,
      s.PRS_SALDO AS saldo
    FROM PRODUTOS p
    INNER JOIN PRODUTOS_SALDOS s
      ON s.PRS_PRO_CODIGO = p.PRO_CODIGO
     AND s.PRS_FIL_CODIGO = '${FILIAL}'
     AND s.PRS_PLE_CODIGO = '${LOCAL_ESTOQUE}'
    WHERE s.PRS_SALDO > 0
    ORDER BY p.PRO_CODIGO
  `;
}

async function main() {
  console.log(`=== Relatório Saldo de Estoque — Local ${LOCAL_ESTOQUE} — Base SJC ===\n`);

  const rows = await queryFirebird<ProdutoSaldoRow>("sjc", sqlProdutosComSaldo());
  console.log(`${rows.length} produtos com saldo > 0 no local de estoque ${LOCAL_ESTOQUE} (filial ${FILIAL})`);

  const produtos = rows.map((r) => ({
    "Código": Number(r.PRO_CODIGO),
    "Descrição": r.PRO_RESUMO?.toString().trim() || "",
    "Tipo": r.PRO_TIPO?.toString().trim() || "",
    "Saldo": Number(r.SALDO) || 0,
  }));

  const codigosDistintos = new Set(produtos.map((p) => p["Código"])).size;

  const sheetResumo = [
    { "Indicador": "Produtos com saldo (linhas)", "Valor": produtos.length },
    { "Indicador": "Produtos distintos com saldo", "Valor": codigosDistintos },
    { "Indicador": "Base", "Valor": "SJC" },
    { "Indicador": "Local de Estoque", "Valor": LOCAL_ESTOQUE },
    { "Indicador": "Filial", "Valor": FILIAL },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetResumo), "Resumo");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(produtos), "Produtos");

  const fileName = `Saldo_Estoque2_SJC.xlsx`;
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
