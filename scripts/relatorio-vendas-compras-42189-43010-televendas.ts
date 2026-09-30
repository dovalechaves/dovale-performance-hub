/**
 * Relatório: produtos 42189 e 43010 — bases SJC e MG unificadas.
 *
 * Qtde vendida mês a mês (Jan a Ago/2026), apenas setores TELEVENDAS e
 * TELEVENDAS MG (rs.rvs_nome via pdv_rep_codigo -> representantes ->
 * representantes_supervisores). Filtro padrão de venda do projeto:
 * pdv_psi_codigo NOT IN ('CC'), pdv_tve_codigo NOT IN ('6','7','26','34').
 *
 * Qtde comprada mês a mês (notas fiscais de entrada / compras, NCI_QUANTIDADE),
 * sem filtro de setor (não se aplica a compra), join notas_compras_itens ->
 * notas_compras por (cli_codigo, série, número) — mesmo padrão de
 * scripts/relatorio-fornecedores-curva-abc-revenda.ts (join por ntc_id
 * perde linhas), filtrado por ntc_data.
 *
 * Saída em estrutura de matriz: uma linha por produto, colunas intercaladas
 * por mês (Qtde Vendida / Qtde Comprada), + totais do período de cada métrica.
 *
 * Rodar: npx tsx scripts/relatorio-vendas-compras-42189-43010-televendas.ts
 */
import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const CODIGOS_PRODUTO = [42189, 43010];
const PERIODO_INICIO = "2026-01-01";
const PERIODO_FIM = "2026-09-01"; // exclusivo — cobre Jan a Ago/2026
const MESES_ABREV = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago"];

const BASES = [
  { lojaKey: "sjc" as const, nome: "SJC" },
  { lojaKey: "mg" as const, nome: "MG" },
];

interface VendaRow {
  PRO_CODIGO: any;
  PRO_RESUMO: any;
  MES: any;
  QTDE: any;
}

interface CompraRow {
  CODIGO: any;
  MES: any;
  QTDE: any;
}

function sqlVendas() {
  const lista = CODIGOS_PRODUTO.join(",");
  return `
    select p.pro_codigo as pro_codigo, p.pro_resumo as pro_resumo,
      extract(month from ped.pdv_data) as mes,
      sum(i.pvi_quantidade) as qtde
    from pedidos_vendas ped
    inner join pedidos_vendas_itens i on i.pvi_numero = ped.pdv_numero
    inner join produtos p on p.pro_codigo = i.pvi_pro_codigo
    inner join representantes r on r.rep_codigo = ped.pdv_rep_codigo
    inner join representantes_supervisores rs on rs.rvs_codigo = r.rep_rvs_codigo
    where p.pro_codigo in (${lista})
      and rs.rvs_nome in ('TELEVENDAS', 'TELEVENDAS MG')
      and ped.pdv_data >= date '${PERIODO_INICIO}'
      and ped.pdv_data < date '${PERIODO_FIM}'
      and ped.pdv_psi_codigo not in ('CC')
      and ped.pdv_tve_codigo not in ('6','7','26','34')
    group by 1,2,3
  `;
}

function sqlCompras() {
  const lista = CODIGOS_PRODUTO.join(",");
  return `
    select nci.nci_pro_codigo as codigo,
      extract(month from ntc.ntc_data) as mes,
      sum(nci.nci_quantidade) as qtde
    from notas_compras_itens nci
    inner join notas_compras ntc
      on ntc.ntc_cli_codigo = nci.nci_cli_codigo
     and ntc.ntc_serie = nci.nci_serie
     and ntc.ntc_numero = nci.nci_numero
    where nci.nci_pro_codigo in (${lista})
      and ntc.ntc_data >= date '${PERIODO_INICIO}'
      and ntc.ntc_data < date '${PERIODO_FIM}'
    group by 1,2
  `;
}

interface Produto {
  codigo: string;
  resumo: string;
  qtdePorMes: Map<number, number>; // 1..8 -> qtde vendida
  qtdeCompraPorMes: Map<number, number>; // 1..8 -> qtde comprada (NF entrada)
}

async function main() {
  console.log("=== Relatório produtos 42189/43010 — Televendas/Televendas MG — SJC+MG ===\n");
  console.log(`Período vendas/compras: ${PERIODO_INICIO} a ${PERIODO_FIM} (exclusivo)\n`);

  const produtos = new Map<string, Produto>();
  for (const codigo of CODIGOS_PRODUTO) {
    produtos.set(String(codigo), { codigo: String(codigo), resumo: "", qtdePorMes: new Map(), qtdeCompraPorMes: new Map() });
  }

  for (const base of BASES) {
    console.log(`Consultando vendas em ${base.nome}...`);
    const vendas = await queryFirebird<VendaRow>(base.lojaKey, sqlVendas());
    console.log(`  ${vendas.length} linhas produto/mês`);
    for (const row of vendas) {
      const codigo = String(row.PRO_CODIGO).trim();
      const p = produtos.get(codigo);
      if (!p) continue;
      if (!p.resumo) p.resumo = row.PRO_RESUMO?.toString().trim() || "";
      const mes = Number(row.MES);
      const qtde = Number(row.QTDE) || 0;
      p.qtdePorMes.set(mes, (p.qtdePorMes.get(mes) || 0) + qtde);
    }

    console.log(`Consultando compras (NF entrada) em ${base.nome}...`);
    const compras = await queryFirebird<CompraRow>(base.lojaKey, sqlCompras());
    console.log(`  ${compras.length} linhas`);
    for (const row of compras) {
      const codigo = String(row.CODIGO).trim();
      const p = produtos.get(codigo);
      if (!p) continue;
      const mes = Number(row.MES);
      const qtde = Number(row.QTDE) || 0;
      p.qtdeCompraPorMes.set(mes, (p.qtdeCompraPorMes.get(mes) || 0) + qtde);
    }
  }

  // Resumo (pro_resumo) pode não ter vindo se não houve venda em nenhuma base — busca direto no cadastro
  for (const p of produtos.values()) {
    if (p.resumo) continue;
    for (const base of BASES) {
      const rows = await queryFirebird<{ PRO_RESUMO: any }>(base.lojaKey, `select pro_resumo from produtos where pro_codigo = ${p.codigo}`);
      if (rows.length && rows[0].PRO_RESUMO) {
        p.resumo = rows[0].PRO_RESUMO.toString().trim();
        break;
      }
    }
  }

  const linhas = CODIGOS_PRODUTO.map((codigo) => {
    const p = produtos.get(String(codigo))!;
    const linha: Record<string, any> = {
      "Código Produto": p.codigo,
      "Resumo Produto": p.resumo,
    };
    let totalQtdeVendida = 0;
    let totalQtdeComprada = 0;
    MESES_ABREV.forEach((label, idx) => {
      const qtdeVendida = Math.round((p.qtdePorMes.get(idx + 1) || 0) * 100) / 100;
      const qtdeComprada = Math.round((p.qtdeCompraPorMes.get(idx + 1) || 0) * 100) / 100;
      linha[`${label} - Qtde Vendida`] = qtdeVendida;
      linha[`${label} - Qtde Compra (NF Entrada)`] = qtdeComprada;
      totalQtdeVendida += qtdeVendida;
      totalQtdeComprada += qtdeComprada;
    });
    linha["Total Qtde Vendida"] = Math.round(totalQtdeVendida * 100) / 100;
    linha["Total Qtde Comprada (NF Entrada)"] = Math.round(totalQtdeComprada * 100) / 100;
    return linha;
  });

  console.log("\nResultado:");
  console.table(linhas);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(linhas);
  ws["!cols"] = [
    { wch: 14 }, { wch: 50 },
    ...MESES_ABREV.flatMap(() => [{ wch: 14 }, { wch: 14 }]),
    { wch: 18 }, { wch: 26 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Produtos 42189-43010");

  const fileName = `Relatorio_Vendas_Compras_42189_43010_Televendas.xlsx`;
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
