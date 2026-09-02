/**
 * Relatório: Chaves (subgrupo 1) vendidas para clientes de CE, PE e BA em 2026.
 * Bases: SJC, MG e Fortaleza. Quebra por canal de venda (Distribuidores, Ferragens, Televendas).
 *
 * Canal de venda = representantes_supervisores.rvs_nome (via representantes.rep_rvs_codigo).
 * UF do cliente = municipios.mun_uf (via clientes.cli_mun_codigo).
 *
 * Rodar: npx tsx scripts/relatorio-chaves-ce-pe-ba.ts
 */

import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const ANO = 2026;
const SUBGRUPO_CODIGO = 1; // CHAVE
const UFS = ["CE", "PE", "BA"];
const BASES = [
  { lojaKey: "sjc" as const, nome: "SJC" },
  { lojaKey: "mg" as const, nome: "MG" },
  { lojaKey: "fortaleza" as const, nome: "Fortaleza" },
];

const CANAL_MAP: Record<string, string> = {
  "TELEVENDAS": "Televendas",
  "TELEVENDAS MG": "Televendas",
  "DISTRIBUIDORES": "Distribuidores",
  "FERRAGENS": "Ferragens",
};
const CANAIS_ALVO = ["Distribuidores", "Ferragens", "Televendas"];

interface Row {
  UF: any;
  RVS_NOME: any;
  QTD: any;
  VALOR: any;
}

function sql() {
  return `
    SELECT
      m.mun_uf AS UF,
      rs.rvs_nome AS RVS_NOME,
      SUM(i.pvi_quantidade) AS QTD,
      SUM(COALESCE(i.pvi_totalitem,0) + COALESCE(i.pvi_substicms,0) + COALESCE(i.pvi_vl_fcp_st,0) + COALESCE(i.pvi_ipivalor,0)) AS VALOR
    FROM pedidos_vendas ped
    INNER JOIN pedidos_vendas_itens i ON i.pvi_numero = ped.pdv_numero
    INNER JOIN produtos p ON p.pro_codigo = i.pvi_pro_codigo
    INNER JOIN clientes c ON c.cli_codigo = ped.pdv_cli_codigo
    INNER JOIN municipios m ON m.mun_codigo = c.cli_mun_codigo
    LEFT JOIN representantes r ON r.rep_codigo = ped.pdv_rep_codigo
    LEFT JOIN representantes_supervisores rs ON rs.rvs_codigo = r.rep_rvs_codigo
    WHERE p.pro_nivel2 = ${SUBGRUPO_CODIGO}
      AND m.mun_uf IN (${UFS.map((u) => `'${u}'`).join(", ")})
      AND ped.pdv_data >= CAST('${ANO}-01-01' AS DATE)
      AND ped.pdv_data < CAST('${ANO + 1}-01-01' AS DATE)
      AND ped.pdv_psi_codigo NOT IN ('CC')
      AND ped.pdv_tve_codigo NOT IN ('6', '7', '26', '34')
    GROUP BY m.mun_uf, rs.rvs_nome
  `;
}

interface Consolidado {
  uf: string;
  canal: string;
  qtd: number;
  valor: number;
}

async function main() {
  console.log(`=== Relatório Chaves (subgrupo ${SUBGRUPO_CODIGO}) — UF ${UFS.join("/")} — ${ANO} — SJC/MG/Fortaleza ===\n`);

  // UF x Canal (só os 3 canais alvo)
  const consolidadoAlvo = new Map<string, Consolidado>();
  // Detalhe por base (para auditoria/transparência)
  const detalheBase: { base: string; uf: string; canal: string; qtd: number; valor: number }[] = [];
  // Vendas em CE/PE/BA que existem mas não caem nos 3 canais alvo (ex.: LOJA em Fortaleza, E-COMMERCE, etc.)
  const naoClassificado: { base: string; uf: string; rvsNomeOriginal: string; qtd: number; valor: number }[] = [];

  for (const base of BASES) {
    console.log(`Consultando base ${base.nome}...`);
    const rows = await queryFirebird<Row>(base.lojaKey, sql());
    console.log(`  ${rows.length} combinações UF/canal com venda em ${ANO} na base ${base.nome}`);

    for (const row of rows) {
      const uf = row.UF?.toString().trim() || "";
      const rvsOriginal = row.RVS_NOME?.toString().trim() || "(sem representante)";
      const qtd = Number(row.QTD) || 0;
      const valor = Number(row.VALOR) || 0;
      if (!uf) continue;

      const canal = CANAL_MAP[rvsOriginal];

      if (canal) {
        const key = `${uf}|${canal}`;
        const existente = consolidadoAlvo.get(key);
        if (existente) {
          existente.qtd += qtd;
          existente.valor += valor;
        } else {
          consolidadoAlvo.set(key, { uf, canal, qtd, valor });
        }
        detalheBase.push({ base: base.nome, uf, canal, qtd, valor });
      } else {
        naoClassificado.push({ base: base.nome, uf, rvsNomeOriginal: rvsOriginal, qtd, valor });
      }
    }
  }

  const linhasPorUfCanal = Array.from(consolidadoAlvo.values()).sort((a, b) =>
    a.uf === b.uf ? a.canal.localeCompare(b.canal) : a.uf.localeCompare(b.uf)
  );

  // ── Sheet 1: UF x Canal (consolidado SJC+MG+Fortaleza) ──────────────────────
  const sheetUfCanal = linhasPorUfCanal.map((l) => ({
    "UF": l.uf,
    "Canal de Venda": l.canal,
    "Qtd. Chaves Vendidas": Math.round(l.qtd * 100) / 100,
    "Valor Total (R$)": Math.round(l.valor * 100) / 100,
  }));

  const totalGeralQtd = linhasPorUfCanal.reduce((s, l) => s + l.qtd, 0);
  const totalGeralValor = linhasPorUfCanal.reduce((s, l) => s + l.valor, 0);
  sheetUfCanal.push({
    "UF": "TOTAL",
    "Canal de Venda": "",
    "Qtd. Chaves Vendidas": Math.round(totalGeralQtd * 100) / 100,
    "Valor Total (R$)": Math.round(totalGeralValor * 100) / 100,
  });

  // ── Sheet 2: Resumo por Canal (todas as UFs somadas) ─────────────────────────
  const porCanal = new Map<string, { qtd: number; valor: number }>();
  for (const l of linhasPorUfCanal) {
    const existente = porCanal.get(l.canal) ?? { qtd: 0, valor: 0 };
    existente.qtd += l.qtd;
    existente.valor += l.valor;
    porCanal.set(l.canal, existente);
  }
  const sheetResumoCanal = CANAIS_ALVO.map((canal) => {
    const v = porCanal.get(canal) ?? { qtd: 0, valor: 0 };
    return {
      "Canal de Venda": canal,
      "Qtd. Chaves Vendidas": Math.round(v.qtd * 100) / 100,
      "Valor Total (R$)": Math.round(v.valor * 100) / 100,
    };
  });
  sheetResumoCanal.push({
    "Canal de Venda": "TOTAL",
    "Qtd. Chaves Vendidas": Math.round(totalGeralQtd * 100) / 100,
    "Valor Total (R$)": Math.round(totalGeralValor * 100) / 100,
  });

  // ── Sheet 3: Detalhe por Base (SJC/MG/Fortaleza) ─────────────────────────────
  const sheetDetalheBase = detalheBase
    .sort((a, b) => a.base.localeCompare(b.base) || a.uf.localeCompare(b.uf) || a.canal.localeCompare(b.canal))
    .map((d) => ({
      "Base": d.base,
      "UF": d.uf,
      "Canal de Venda": d.canal,
      "Qtd. Chaves Vendidas": Math.round(d.qtd * 100) / 100,
      "Valor Total (R$)": Math.round(d.valor * 100) / 100,
    }));

  // ── Sheet 4: Não classificado nos 3 canais (transparência — não é descartado silenciosamente) ──
  const sheetNaoClassificado = naoClassificado
    .sort((a, b) => a.base.localeCompare(b.base) || a.uf.localeCompare(b.uf))
    .map((d) => ({
      "Base": d.base,
      "UF": d.uf,
      "Setor/Representante (RVS_NOME original)": d.rvsNomeOriginal,
      "Qtd. Chaves Vendidas": Math.round(d.qtd * 100) / 100,
      "Valor Total (R$)": Math.round(d.valor * 100) / 100,
    }));

  console.log(`\nTotal geral (Distribuidores+Ferragens+Televendas): ${totalGeralQtd} chaves, R$ ${totalGeralValor.toFixed(2)}`);
  console.log(`Linhas não classificadas nos 3 canais (ex.: LOJA em Fortaleza): ${sheetNaoClassificado.length}`);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetUfCanal), "UF x Canal");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetResumoCanal), "Resumo por Canal");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetDetalheBase), "Detalhe por Base");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetNaoClassificado), "Não Classificado");

  const fileName = `Relatorio_Chaves_CE_PE_BA_${ANO}.xlsx`;
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
