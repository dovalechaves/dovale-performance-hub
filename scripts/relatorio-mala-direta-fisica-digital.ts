/**
 * Relatório: venda de itens das malas diretas (física x digital) — Jun/Jul/Ago/Set 2026, bases SJC+MG somadas.
 *
 * Códigos extraídos dos PDFs das malas mensais (páginas 1-6 = mala física, página 7 em diante = mala
 * digital, conforme numeração impressa no rodapé de cada página do encarte). Lista de códigos por mês
 * está em `_mala-direta-codigos.json` (gerado a partir dos PDFs: Junho/Julho/Agosto/Setembro 2026).
 *
 * Agosto e Setembro têm um encarte extra de "Lançamentos" na contracapa, sem numeração de página —
 * esses códigos ficaram de fora dos grupos física/digital e aparecem à parte na aba "Lançamentos".
 *
 * Valor de venda = SUM(pvi_totalitem + pvi_substicms + pvi_vl_fcp_st + pvi_ipivalor).
 * Exclui cancelados (pdv_psi_codigo NOT IN ('CC')) e situações de não-venda
 * (pdv_tve_codigo NOT IN ('6','7','26','34')), padrão do projeto.
 *
 * Uma aba por mês (Física + Digital juntas, coluna "Mala" identifica o grupo), aba "Lançamentos"
 * e aba "Notas" com metodologia. Traz todos os códigos do encarte (mesmo os sem venda no período).
 *
 * Rodar: npx tsx scripts/relatorio-mala-direta-fisica-digital.ts
 */

import "dotenv/config";
import path from "path";
import os from "os";
import fs from "fs";
import { fileURLToPath } from "url";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASES = [
  { lojaKey: "sjc" as const, nome: "SJC" },
  { lojaKey: "mg" as const, nome: "MG" },
];

interface MesCodigos {
  period: [string, string];
  physical: string[];
  digital: string[];
  lancamentos_sem_pagina: string[];
}

const CODIGOS: Record<"junho" | "julho" | "agosto" | "setembro", MesCodigos> = JSON.parse(
  fs.readFileSync(path.join(__dirname, "_mala-direta-codigos.json"), "utf-8")
);

const MESES_ORDEM: (keyof typeof CODIGOS)[] = ["junho", "julho", "agosto", "setembro"];
const MES_LABEL: Record<string, string> = { junho: "Junho", julho: "Julho", agosto: "Agosto", setembro: "Setembro" };

interface ProdutoRow {
  PRO_CODIGO: any;
  PRO_RESUMO: any;
  PRO_TIPO: any;
}

interface VendaRow {
  PRO_CODIGO: any;
  QTD: any;
  VALOR: any;
}

function sqlProdutos(codigos: string[]) {
  return `SELECT pro_codigo, pro_resumo, pro_tipo FROM produtos WHERE pro_codigo IN (${codigos.map((c) => `'${c}'`).join(",")})`;
}

function sqlVenda(codigos: string[], inicio: string, fim: string) {
  return `
    SELECT i.pvi_pro_codigo AS pro_codigo,
      SUM(i.pvi_quantidade) AS qtd,
      SUM(i.pvi_totalitem + i.pvi_substicms + i.pvi_vl_fcp_st + i.pvi_ipivalor) AS valor
    FROM pedidos_vendas_itens i
    INNER JOIN pedidos_vendas ped ON ped.pdv_numero = i.pvi_numero
    WHERE i.pvi_pro_codigo IN (${codigos.map((c) => `'${c}'`).join(",")})
      AND ped.pdv_data >= CAST('${inicio}' AS DATE)
      AND ped.pdv_data <= CAST('${fim}' AS DATE)
      AND ped.pdv_psi_codigo NOT IN ('CC')
      AND ped.pdv_tve_codigo NOT IN ('6', '7', '26', '34')
    GROUP BY i.pvi_pro_codigo
  `;
}

interface Metrica {
  codigo: string;
  resumo: string;
  tipo: string;
  qtd: number;
  valor: number;
}

async function buscarDados(codigos: string[], inicio: string, fim: string): Promise<Map<string, Metrica>> {
  const mapa = new Map<string, Metrica>();
  for (const c of codigos) mapa.set(c, { codigo: c, resumo: "", tipo: "", qtd: 0, valor: 0 });

  if (codigos.length === 0) return mapa;

  for (const base of BASES) {
    const produtos = await queryFirebird<ProdutoRow>(base.lojaKey, sqlProdutos(codigos));
    for (const p of produtos) {
      const codigo = p.PRO_CODIGO?.toString().trim();
      if (!codigo || !mapa.has(codigo)) continue;
      const m = mapa.get(codigo)!;
      if (!m.resumo) m.resumo = p.PRO_RESUMO?.toString().trim() || "";
      if (!m.tipo) m.tipo = p.PRO_TIPO?.toString().trim() || "";
    }

    const vendas = await queryFirebird<VendaRow>(base.lojaKey, sqlVenda(codigos, inicio, fim));
    for (const row of vendas) {
      const codigo = row.PRO_CODIGO?.toString().trim();
      if (!codigo || !mapa.has(codigo)) continue;
      const m = mapa.get(codigo)!;
      m.qtd += Number(row.QTD) || 0;
      m.valor += Number(row.VALOR) || 0;
    }
  }

  return mapa;
}

function linhaSheet(m: Metrica, mala: string) {
  return {
    "Mala": mala,
    "Código": m.codigo,
    "Produto": m.resumo,
    "Tipo (pro_tipo)": m.tipo,
    "Quantidade Vendida": Math.round(m.qtd * 100) / 100,
    "Valor Vendido (R$)": Math.round(m.valor * 100) / 100,
  };
}

async function main() {
  console.log("=== Relatório Mala Direta Física x Digital — SJC/MG ===\n");

  const wb = XLSX.utils.book_new();
  const lancamentosRows: any[] = [];

  for (const mesKey of MESES_ORDEM) {
    const cfg = CODIGOS[mesKey];
    const [inicio, fim] = cfg.period;
    console.log(`--- ${MES_LABEL[mesKey]} (${inicio} a ${fim}) ---`);
    console.log(`  Física: ${cfg.physical.length} códigos | Digital: ${cfg.digital.length} códigos`);

    const dadosFisica = await buscarDados(cfg.physical, inicio, fim);
    const dadosDigital = await buscarDados(cfg.digital, inicio, fim);

    const linhas = [
      ...cfg.physical.map((c) => linhaSheet(dadosFisica.get(c)!, "Física")),
      ...cfg.digital.map((c) => linhaSheet(dadosDigital.get(c)!, "Digital")),
    ].sort((a, b) => {
      if (a["Mala"] !== b["Mala"]) return a["Mala"] === "Física" ? -1 : 1;
      return b["Valor Vendido (R$)"] - a["Valor Vendido (R$)"];
    });

    const totalFisicaQtd = linhas.filter((l) => l["Mala"] === "Física").reduce((s, l) => s + l["Quantidade Vendida"], 0);
    const totalFisicaValor = linhas.filter((l) => l["Mala"] === "Física").reduce((s, l) => s + l["Valor Vendido (R$)"], 0);
    const totalDigitalQtd = linhas.filter((l) => l["Mala"] === "Digital").reduce((s, l) => s + l["Quantidade Vendida"], 0);
    const totalDigitalValor = linhas.filter((l) => l["Mala"] === "Digital").reduce((s, l) => s + l["Valor Vendido (R$)"], 0);
    console.log(`  Física: qtd=${totalFisicaQtd} valor=R$${totalFisicaValor.toFixed(2)}`);
    console.log(`  Digital: qtd=${totalDigitalQtd} valor=R$${totalDigitalValor.toFixed(2)}`);

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), MES_LABEL[mesKey]);

    if (cfg.lancamentos_sem_pagina.length > 0) {
      const dadosLanc = await buscarDados(cfg.lancamentos_sem_pagina, inicio, fim);
      for (const c of cfg.lancamentos_sem_pagina) {
        lancamentosRows.push({ "Mês": MES_LABEL[mesKey], ...linhaSheet(dadosLanc.get(c)!, "Lançamentos (sem página)") });
      }
    }
  }

  if (lancamentosRows.length > 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lancamentosRows), "Lançamentos");
  }

  const notas = [
    { Nota: "Período de venda considerado: mês inteiro do calendário de 2026 correspondente a cada mala (ex.: Julho = 01/07/26 a 31/07/26)." },
    { Nota: "Bases SJC e MG somadas (tratadas como uma única base), conforme pedido." },
    { Nota: "Física = páginas 1 a 6 do PDF da mala (numeração impressa no rodapé). Digital = página 7 em diante." },
    { Nota: "Valor Vendido = SUM(pvi_totalitem + pvi_substicms + pvi_vl_fcp_st + pvi_ipivalor) — inclui ICMS-ST/FCP-ST/IPI, padrão usado nos demais relatórios do projeto." },
    { Nota: "Exclui pedidos cancelados (pdv_psi_codigo NOT IN ('CC')) e situações de não-venda (pdv_tve_codigo NOT IN ('6','7','26','34'))." },
    { Nota: "Cada aba mensal traz TODOS os códigos do encarte daquele mês, mesmo os que não venderam no período (Quantidade/Valor = 0), para dar visão completa do desempenho da mala." },
    { Nota: "Agosto e Setembro têm um encarte extra de 'Lançamentos' na contracapa, sem numeração de página impressa — não entrou nem em Física nem em Digital; está listado à parte na aba 'Lançamentos'." },
    { Nota: "Um mesmo código pode aparecer tanto na Física quanto na Digital do mesmo mês, se o produto estiver de fato nas duas seções do PDF." },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(notas), "Notas");

  const fileName = `Relatorio_Mala_Direta_Fisica_Digital_SJC_MG.xlsx`;
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
