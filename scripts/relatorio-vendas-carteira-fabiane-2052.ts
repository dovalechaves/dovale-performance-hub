/**
 * Relatório: Valor de venda mês a mês do representante 2052 (Fabiane Miranda),
 * bases SJC e MG, fevereiro a agosto de 2026.
 *
 * Importante: a venda é atribuída pela CARTEIRA do cliente (clientes.cli_rep_codigo = 2052),
 * não pelo representante lançado no pedido (pedidos_vendas.pdv_rep_codigo) — ou seja,
 * entra toda venda feita para um cliente que tem a Fabiane como representante no
 * cadastro, não importa quem efetivamente lançou o pedido.
 *
 * Valor de venda = SUM(pvi_totalitem + pvi_substicms + pvi_vl_fcp_st + pvi_ipivalor)
 * (padrão do projeto — inclui ICMS-ST/FCP-ST/IPI, não só o preço do item).
 * Exclui cancelados (pdv_psi_codigo NOT IN ('CC')) e situações de não-venda
 * (pdv_tve_codigo NOT IN ('6','7','26','34')), padrão já usado nos demais relatórios.
 *
 * Aba 1: Valor por Mês — SJC + MG somados, com quebra por base e total.
 * Aba 2: Detalhe por Base — Base / Ano / Mês / Valor.
 * Aba 3: Clientes por Mês — para cada mês, lista os clientes da carteira
 * (Base / Código / Razão Social / Valor Comprado) que compraram naquele mês.
 *
 * Rodar: npx tsx scripts/relatorio-vendas-carteira-fabiane-2052.ts
 */

import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const REP_CODIGO = 2052;
const REP_NOME_ESPERADO = "FERRAGENS FABIANE MIRANDA";

const PERIODO_INICIO = "2026-02-01";
const PERIODO_FIM = "2026-08-31";

const BASES = [
  { lojaKey: "sjc" as const, nome: "SJC" },
  { lojaKey: "mg" as const, nome: "MG" },
];

const MESES_ABREV = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

interface VendaRow {
  ANO: any;
  MES: any;
  VALOR: any;
}

interface VendaClienteRow {
  CLI_CODIGO: any;
  CLI_NOME: any;
  ANO: any;
  MES: any;
  VALOR: any;
}

function sqlVendasCarteira() {
  return `
    SELECT
      EXTRACT(YEAR FROM ped.pdv_data) AS ano,
      EXTRACT(MONTH FROM ped.pdv_data) AS mes,
      SUM(i.pvi_totalitem + i.pvi_substicms + i.pvi_vl_fcp_st + i.pvi_ipivalor) AS valor
    FROM pedidos_vendas ped
    INNER JOIN pedidos_vendas_itens i ON i.pvi_numero = ped.pdv_numero
    INNER JOIN clientes c ON c.cli_codigo = ped.pdv_cli_codigo
    WHERE c.cli_rep_codigo = ${REP_CODIGO}
      AND ped.pdv_data >= CAST('${PERIODO_INICIO}' AS DATE)
      AND ped.pdv_data <= CAST('${PERIODO_FIM}' AS DATE)
      AND ped.pdv_psi_codigo NOT IN ('CC')
      AND ped.pdv_tve_codigo NOT IN ('6', '7', '26', '34')
    GROUP BY EXTRACT(YEAR FROM ped.pdv_data), EXTRACT(MONTH FROM ped.pdv_data)
    ORDER BY ano, mes
  `;
}

function sqlVendasClientesCarteira() {
  return `
    SELECT
      c.cli_codigo AS cli_codigo,
      c.cli_nome AS cli_nome,
      EXTRACT(YEAR FROM ped.pdv_data) AS ano,
      EXTRACT(MONTH FROM ped.pdv_data) AS mes,
      SUM(i.pvi_totalitem + i.pvi_substicms + i.pvi_vl_fcp_st + i.pvi_ipivalor) AS valor
    FROM pedidos_vendas ped
    INNER JOIN pedidos_vendas_itens i ON i.pvi_numero = ped.pdv_numero
    INNER JOIN clientes c ON c.cli_codigo = ped.pdv_cli_codigo
    WHERE c.cli_rep_codigo = ${REP_CODIGO}
      AND ped.pdv_data >= CAST('${PERIODO_INICIO}' AS DATE)
      AND ped.pdv_data <= CAST('${PERIODO_FIM}' AS DATE)
      AND ped.pdv_psi_codigo NOT IN ('CC')
      AND ped.pdv_tve_codigo NOT IN ('6', '7', '26', '34')
    GROUP BY c.cli_codigo, c.cli_nome, EXTRACT(YEAR FROM ped.pdv_data), EXTRACT(MONTH FROM ped.pdv_data)
    ORDER BY ano, mes, valor DESC
  `;
}

function sqlContaCarteira() {
  return `SELECT COUNT(*) AS cnt FROM clientes WHERE cli_rep_codigo = ${REP_CODIGO}`;
}

function sqlRepresentante() {
  return `SELECT rep_nome FROM representantes WHERE rep_codigo = ${REP_CODIGO}`;
}

function gerarChavesMeses(): { chave: string; label: string; ano: number; mes: number }[] {
  const chaves: { chave: string; label: string; ano: number; mes: number }[] = [];
  for (let mes = 2; mes <= 8; mes++) {
    const ano = 2026;
    chaves.push({
      chave: `${ano}-${String(mes).padStart(2, "0")}`,
      label: `${MESES_ABREV[mes - 1]}/${String(ano).slice(2)}`,
      ano,
      mes,
    });
  }
  return chaves;
}

async function main() {
  console.log(`=== Relatório Valor de Venda — Carteira Rep. ${REP_CODIGO} — SJC/MG ===\n`);
  console.log(`Período: ${PERIODO_INICIO} a ${PERIODO_FIM}\n`);

  const chavesMeses = gerarChavesMeses();
  const porMesConsolidado = new Map<string, number>();
  const detalhePorBase: { base: string; ano: number; mes: number; valor: number }[] = [];
  const detalheClientes: { base: string; cliCodigo: number; cliNome: string; ano: number; mes: number; valor: number }[] = [];

  for (const base of BASES) {
    console.log(`Consultando base ${base.nome}...`);

    const repRows = await queryFirebird<{ REP_NOME: any }>(base.lojaKey, sqlRepresentante());
    const repNome = repRows[0]?.REP_NOME?.toString().trim() || "";
    if (!repNome.toUpperCase().includes("FABIANE")) {
      console.warn(`  ATENÇÃO: representante ${REP_CODIGO} na base ${base.nome} é "${repNome}", esperado "${REP_NOME_ESPERADO}" — confira antes de usar o relatório.`);
    } else {
      console.log(`  Representante confirmado: ${repNome}`);
    }

    const contaRows = await queryFirebird<{ CNT: any }>(base.lojaKey, sqlContaCarteira());
    console.log(`  Clientes na carteira: ${contaRows[0]?.CNT ?? 0}`);

    const rows = await queryFirebird<VendaRow>(base.lojaKey, sqlVendasCarteira());
    console.log(`  ${rows.length} linhas ano/mês com venda na base ${base.nome}`);

    for (const row of rows) {
      const ano = Number(row.ANO);
      const mes = Number(row.MES);
      const valor = Number(row.VALOR) || 0;
      const chave = `${ano}-${String(mes).padStart(2, "0")}`;

      detalhePorBase.push({ base: base.nome, ano, mes, valor });
      porMesConsolidado.set(chave, (porMesConsolidado.get(chave) || 0) + valor);
    }

    const rowsClientes = await queryFirebird<VendaClienteRow>(base.lojaKey, sqlVendasClientesCarteira());
    console.log(`  ${rowsClientes.length} linhas cliente/mês com venda na base ${base.nome}`);

    for (const row of rowsClientes) {
      detalheClientes.push({
        base: base.nome,
        cliCodigo: Number(row.CLI_CODIGO),
        cliNome: row.CLI_NOME?.toString().trim() || "",
        ano: Number(row.ANO),
        mes: Number(row.MES),
        valor: Number(row.VALOR) || 0,
      });
    }
  }

  console.log(`\nRepresentante: ${REP_CODIGO} - ${REP_NOME_ESPERADO}`);

  const sheetPorMes = chavesMeses.map((m) => {
    const linha: Record<string, any> = { "Mês": m.label };
    for (const base of BASES) {
      const valorBase = detalhePorBase.find((d) => d.base === base.nome && d.ano === m.ano && d.mes === m.mes)?.valor || 0;
      linha[base.nome] = Math.round(valorBase * 100) / 100;
    }
    linha["Total"] = Math.round((porMesConsolidado.get(m.chave) || 0) * 100) / 100;
    return linha;
  });

  const totalGeral = chavesMeses.reduce((s, m) => s + (porMesConsolidado.get(m.chave) || 0), 0);
  sheetPorMes.push({
    "Mês": "Total",
    SJC: Math.round(detalhePorBase.filter((d) => d.base === "SJC").reduce((s, d) => s + d.valor, 0) * 100) / 100,
    MG: Math.round(detalhePorBase.filter((d) => d.base === "MG").reduce((s, d) => s + d.valor, 0) * 100) / 100,
    Total: Math.round(totalGeral * 100) / 100,
  });

  const sheetDetalhe = detalhePorBase
    .sort((a, b) => a.base.localeCompare(b.base) || a.ano - b.ano || a.mes - b.mes)
    .map((d) => ({
      "Base": d.base,
      "Ano": d.ano,
      "Mês": String(d.mes).padStart(2, "0"),
      "Valor de Venda (R$)": Math.round(d.valor * 100) / 100,
    }));

  // Aba 3: blocos por mês, com os clientes da carteira que compraram naquele mês
  // (SJC + MG unificados por código + razão social do cliente)
  const linhasClientesPorMes: any[][] = [];
  for (const m of chavesMeses) {
    const porCliente = new Map<string, { cliCodigo: number; cliNome: string; valor: number }>();
    for (const d of detalheClientes) {
      if (d.ano !== m.ano || d.mes !== m.mes) continue;
      const chave = `${d.cliCodigo}::${d.cliNome}`;
      const atual = porCliente.get(chave);
      if (atual) {
        atual.valor += d.valor;
      } else {
        porCliente.set(chave, { cliCodigo: d.cliCodigo, cliNome: d.cliNome, valor: d.valor });
      }
    }
    const clientesDoMes = Array.from(porCliente.values()).sort((a, b) => b.valor - a.valor);
    const totalMes = clientesDoMes.reduce((s, d) => s + d.valor, 0);

    linhasClientesPorMes.push([m.label]);
    linhasClientesPorMes.push(["Código", "Razão Social", "Valor Comprado (R$)"]);
    for (const c of clientesDoMes) {
      linhasClientesPorMes.push([c.cliCodigo, c.cliNome, Math.round(c.valor * 100) / 100]);
    }
    linhasClientesPorMes.push(["", "Total", Math.round(totalMes * 100) / 100]);
    linhasClientesPorMes.push([]);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetPorMes), "Valor por Mês");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetDetalhe), "Detalhe por Base");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhasClientesPorMes), "Clientes por Mês");

  const fileName = `Fabiane.xlsx`;
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
