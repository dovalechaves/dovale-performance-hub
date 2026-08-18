/**
 * Relatório: Ferragens PA (subgrupo 3) mais vendidos em 2026 — bases SJC e MG.
 * Aba 1: produtos com venda em 2026, ordenados por quantidade vendida (SJC+MG).
 * Aba 2: dentre os que venderam, os que estão com estoque zero (SJC+MG).
 *
 * Rodar: npx tsx scripts/relatorio-ferragens-pa.ts
 */

import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const ANO = 2026;
const SUBGRUPO_CODIGO = 6; // FERRAGEM

const BASES = [
  { lojaKey: "sjc" as const, filialId: 1, nome: "SJC" },
  { lojaKey: "mg" as const, filialId: 7, nome: "MG" },
];

interface Row {
  PRO_CODIGO: any;
  PRO_RESUMO: any;
  GRUPO: any;
  SUBGRUPO: any;
  QTD_ANO: any;
  MEDIA_3M: any;
  SALDO: any;
}

function sql(filialId: number) {
  return `
    SELECT p.pro_codigo, p.pro_resumo, g.nome AS grupo, sg.nome AS subgrupo,
      SUM(i.pvi_quantidade) AS qtd_ano,
      SUM(CASE WHEN ped.pdv_data > DATEADD(MONTH, -3, CAST('NOW' AS DATE)) THEN i.pvi_quantidade ELSE 0 END) / 3.0 AS media_3m,
      COALESCE((SELECT saldo FROM CONSULTA_ESTOQUE(p.pro_codigo, ${filialId}, 1, 0, CAST('NOW' AS DATE))), 0) AS saldo
    FROM pedidos_vendas_itens i
    INNER JOIN pedidos_vendas ped ON ped.pdv_numero = i.pvi_numero
    INNER JOIN produtos p ON p.pro_codigo = i.pvi_pro_codigo
    INNER JOIN produtos_nivel1 g ON g.codigo = p.pro_nivel1
    INNER JOIN produtos_nivel2 sg ON sg.codigo = p.pro_nivel2
    WHERE sg.codigo = ${SUBGRUPO_CODIGO}
      AND ped.pdv_data >= CAST('${ANO}-01-01' AS DATE)
      AND ped.pdv_data < CAST('${ANO + 1}-01-01' AS DATE)
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
  qtdAno: number;
  media3m: number;
  saldoSjc: number;
  saldoMg: number;
}

async function main() {
  console.log(`=== Relatório Ferragens PA (subgrupo ${SUBGRUPO_CODIGO}) — ${ANO} — SJC/MG ===\n`);

  const consolidado = new Map<string, Produto>();

  for (const base of BASES) {
    console.log(`Consultando base ${base.nome}...`);
    const rows = await queryFirebird<Row>(base.lojaKey, sql(base.filialId));
    console.log(`  ${rows.length} produtos com venda em ${ANO} na base ${base.nome}`);

    for (const row of rows) {
      const codigo = row.PRO_CODIGO?.toString().trim() || "";
      if (!codigo) continue;
      const existente = consolidado.get(codigo);
      const qtd = Number(row.QTD_ANO) || 0;
      const media = Number(row.MEDIA_3M) || 0;
      const saldo = Number(row.SALDO) || 0;

      if (existente) {
        existente.qtdAno += qtd;
        existente.media3m += media;
        if (base.nome === "SJC") existente.saldoSjc += saldo;
        else existente.saldoMg += saldo;
      } else {
        consolidado.set(codigo, {
          codigo,
          descricao: row.PRO_RESUMO?.toString().trim() || "",
          grupo: row.GRUPO?.toString().trim() || "",
          subgrupo: row.SUBGRUPO?.toString().trim() || "",
          qtdAno: qtd,
          media3m: media,
          saldoSjc: base.nome === "SJC" ? saldo : 0,
          saldoMg: base.nome === "MG" ? saldo : 0,
        });
      }
    }
  }

  const produtos = Array.from(consolidado.values()).sort((a, b) => b.qtdAno - a.qtdAno);
  console.log(`\nTotal de produtos consolidados (SJC+MG): ${produtos.length}`);

  const maisVendidos = produtos.map((p) => ({
    "Código": p.codigo,
    "Descrição": p.descricao,
    "Grupo": p.grupo,
    "Subgrupo": p.subgrupo,
    "Qtd. Vendida (2026)": Math.round(p.qtdAno * 100) / 100,
    "Média Mensal (Últ. 3 Meses)": Math.round(p.media3m * 100) / 100,
    "Estoque SJC": Math.round(p.saldoSjc * 100) / 100,
    "Estoque MG": Math.round(p.saldoMg * 100) / 100,
    "Estoque Total (SJC+MG)": Math.round((p.saldoSjc + p.saldoMg) * 100) / 100,
  }));

  const estoqueZero = produtos
    .filter((p) => p.saldoSjc + p.saldoMg === 0)
    .map((p) => ({
      "Código": p.codigo,
      "Descrição": p.descricao,
      "Grupo": p.grupo,
      "Subgrupo": p.subgrupo,
      "Qtd. Vendida (2026)": Math.round(p.qtdAno * 100) / 100,
      "Média Mensal (Últ. 3 Meses)": Math.round(p.media3m * 100) / 100,
      "Estoque SJC": Math.round(p.saldoSjc * 100) / 100,
      "Estoque MG": Math.round(p.saldoMg * 100) / 100,
      "Estoque Total (SJC+MG)": Math.round((p.saldoSjc + p.saldoMg) * 100) / 100,
    }));

  console.log(`Produtos com venda e estoque zero: ${estoqueZero.length}`);

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(maisVendidos);
  const ws2 = XLSX.utils.json_to_sheet(estoqueZero);
  XLSX.utils.book_append_sheet(wb, ws1, "Mais Vendidos");
  XLSX.utils.book_append_sheet(wb, ws2, "Estoque Zero");

  const fileName = `Relatorio_Ferragens_PA_SJC_MG_${ANO}_v4.xlsx`;
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
