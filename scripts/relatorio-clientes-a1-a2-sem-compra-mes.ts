/**
 * Relatório: Clientes A1 (VIP) e A2 — setores TELEVENDAS e TELEVENDAS MG,
 * bases SJC e MG — que NÃO compraram no mês corrente (setembro/2026).
 *
 * Reaproveita a mesma classificação e critérios de
 * scripts/relatorio-clientes-abc-televendas.ts (ver memória
 * project-client-abc-segmentation):
 *   - Últimos 12 meses (rolling) pra ranquear/classificar por % acumulado
 *     de faturamento: A1 (VIP) até 10% acumulado, A2 de 10% a 30%.
 *   - Cliente I.J.S. RODRIGUES FERRAGENS E AUTOPECAS LTDA. (CNPJ
 *     21.648.518/0001-06) sempre excluído.
 *   - Unificação SJC+MG por CNPJ.
 *   - Coluna de Representante = cadastro do cliente (cli_rep_codigo).
 *
 * "Não comprou esse mês" = zero pedidos de venda (mesmo filtro de setor e
 * exclusão de cancelados/não-venda) entre o 1º dia do mês corrente e hoje.
 *
 * Rodar: npx tsx scripts/relatorio-clientes-a1-a2-sem-compra-mes.ts
 */

import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const HOJE = new Date();
const UM_ANO_ATRAS = new Date(HOJE);
UM_ANO_ATRAS.setFullYear(UM_ANO_ATRAS.getFullYear() - 1);
const fmtData = (d: Date) => d.toISOString().slice(0, 10);
const PERIODO_INICIO = fmtData(UM_ANO_ATRAS);
const PERIODO_FIM = fmtData(HOJE);

const MES_INICIO = fmtData(new Date(HOJE.getFullYear(), HOJE.getMonth(), 1));
const PROXIMO_MES_INICIO = fmtData(new Date(HOJE.getFullYear(), HOJE.getMonth() + 1, 1));

const CLIENTE_EXCLUIDO_CNPJ = "21648518000106"; // I.J.S. RODRIGUES FERRAGENS E AUTOPECAS LTDA.
const CLIENTE_EXCLUIDO_CODIGO = 30683;

const BASES = [
  { lojaKey: "sjc" as const, nome: "SJC" },
  { lojaKey: "mg" as const, nome: "MG" },
];

const SETORES = ["TELEVENDAS", "TELEVENDAS MG"];
const listaSetoresSql = SETORES.map((s) => `'${s}'`).join(",");

interface VendaClienteRow {
  CLI_CODIGO: any;
  RVS_NOME: any;
  VALOR: any;
  ULTIMA_COMPRA: any;
}

interface ClienteInfoRow {
  CLI_CODIGO: any;
  CLI_NOME: any;
  CLI_CNPJ: any;
  CLI_REP_CODIGO: any;
}

function sqlVendasPorClienteSetor(inicio: string, fim: string, comUltimaCompra: boolean) {
  return `
    SELECT
      ped.pdv_cli_codigo AS cli_codigo,
      rs.rvs_nome AS rvs_nome,
      SUM(i.pvi_totalitem + i.pvi_substicms + i.pvi_vl_fcp_st + i.pvi_ipivalor) AS valor
      ${comUltimaCompra ? ", MAX(ped.pdv_data) AS ultima_compra" : ""}
    FROM pedidos_vendas ped
    INNER JOIN pedidos_vendas_itens i ON i.pvi_numero = ped.pdv_numero
    INNER JOIN representantes r ON r.rep_codigo = ped.pdv_rep_codigo
    INNER JOIN representantes_supervisores rs ON rs.rvs_codigo = r.rep_rvs_codigo
    WHERE rs.rvs_nome IN (${listaSetoresSql})
      AND ped.pdv_data >= CAST('${inicio}' AS DATE)
      AND ped.pdv_data < CAST('${fim}' AS DATE)
      AND ped.pdv_psi_codigo NOT IN ('CC')
      AND ped.pdv_tve_codigo NOT IN ('6', '7', '26', '34')
    GROUP BY ped.pdv_cli_codigo, rs.rvs_nome
  `;
}

function normalizarCnpj(cnpj: any): string {
  return String(cnpj ?? "").replace(/\D/g, "");
}

interface ClienteUnificado {
  chave: string;
  codigosPorBase: Partial<Record<"SJC" | "MG", number>>;
  nome: string;
  cnpjExibicao: string;
  valor: number;
  setores: Set<string>;
  ultimaCompra: string | null;
}

async function coletarClientesInfo(
  base: (typeof BASES)[number],
  codigos: number[],
  infoPorBaseECodigo: Record<"SJC" | "MG", Map<string, ClienteInfoRow>>
) {
  const LOTE = 1000;
  for (let i = 0; i < codigos.length; i += LOTE) {
    const pedaco = codigos.slice(i, i + LOTE);
    const lista = pedaco.join(",");
    const infoRows = await queryFirebird<ClienteInfoRow>(
      base.lojaKey,
      `SELECT cli_codigo, cli_nome, cli_cnpj, cli_rep_codigo FROM clientes WHERE cli_codigo IN (${lista})`
    );
    for (const info of infoRows) {
      infoPorBaseECodigo[base.nome].set(String(info.CLI_CODIGO).trim(), info);
    }
  }
}

async function coletarVendas(
  inicio: string,
  fim: string,
  comUltimaCompra: boolean,
  porCliente: Map<string, ClienteUnificado>,
  infoPorBaseECodigo: Record<"SJC" | "MG", Map<string, ClienteInfoRow>>
) {
  for (const base of BASES) {
    const rows = await queryFirebird<VendaClienteRow>(base.lojaKey, sqlVendasPorClienteSetor(inicio, fim, comUltimaCompra));
    console.log(`  ${base.nome}: ${rows.length} linhas cliente/setor`);

    const codigosUnicos = [...new Set(rows.map((r) => Number(r.CLI_CODIGO)))].filter((c) => !!c);
    const faltantes = codigosUnicos.filter((c) => !infoPorBaseECodigo[base.nome].has(String(c)));
    if (faltantes.length > 0) await coletarClientesInfo(base, faltantes, infoPorBaseECodigo);

    for (const row of rows) {
      const valor = Number(row.VALOR) || 0;
      if (valor <= 0) continue;
      const codigo = Number(row.CLI_CODIGO);
      const info = infoPorBaseECodigo[base.nome].get(String(codigo).trim());
      const cnpjNormalizado = normalizarCnpj(info?.CLI_CNPJ);

      if (cnpjNormalizado === CLIENTE_EXCLUIDO_CNPJ || codigo === CLIENTE_EXCLUIDO_CODIGO) continue;

      const chave = cnpjNormalizado || `SEMCNPJ-${base.nome}-${codigo}`;
      const nome = info?.CLI_NOME?.toString().trim() || "";
      const cnpjExibicao = String(info?.CLI_CNPJ ?? "").trim();
      const setor = row.RVS_NOME?.toString().trim() || "";
      const ultimaCompraStr = comUltimaCompra && row.ULTIMA_COMPRA
        ? new Date(row.ULTIMA_COMPRA).toISOString().slice(0, 10)
        : null;

      const atual = porCliente.get(chave);
      if (atual) {
        atual.valor += valor;
        atual.setores.add(setor);
        atual.codigosPorBase[base.nome] = codigo;
        if (!atual.nome && nome) atual.nome = nome;
        if (ultimaCompraStr && (!atual.ultimaCompra || ultimaCompraStr > atual.ultimaCompra)) {
          atual.ultimaCompra = ultimaCompraStr;
        }
      } else {
        porCliente.set(chave, {
          chave,
          codigosPorBase: { [base.nome]: codigo },
          nome,
          cnpjExibicao,
          valor,
          setores: new Set([setor]),
          ultimaCompra: ultimaCompraStr,
        });
      }
    }
  }
}

async function main() {
  console.log(`=== Clientes A1 (VIP) / A2 sem compra no mês corrente — Televendas/Televendas MG — SJC+MG ===\n`);
  console.log(`Classificação (últimos 12 meses): ${PERIODO_INICIO} a ${PERIODO_FIM}`);
  console.log(`Mês corrente: ${MES_INICIO} a ${PROXIMO_MES_INICIO} (exclusivo)\n`);

  const infoPorBaseECodigo: Record<"SJC" | "MG", Map<string, ClienteInfoRow>> = { SJC: new Map(), MG: new Map() };

  console.log("Consultando vendas últimos 12 meses (classificação)...");
  const porCliente12m = new Map<string, ClienteUnificado>();
  await coletarVendas(PERIODO_INICIO, PERIODO_FIM, true, porCliente12m, infoPorBaseECodigo);

  console.log("\nConsultando vendas do mês corrente (checar quem comprou)...");
  const porClienteMesAtual = new Map<string, ClienteUnificado>();
  await coletarVendas(MES_INICIO, PROXIMO_MES_INICIO, false, porClienteMesAtual, infoPorBaseECodigo);
  const comprouEsseMes = new Set(porClienteMesAtual.keys());

  // Representante do CADASTRO — prefere SJC, cai pra MG
  function representanteDoCliente(c: ClienteUnificado): string {
    for (const baseNome of ["SJC", "MG"] as const) {
      const codigo = c.codigosPorBase[baseNome];
      if (codigo == null) continue;
      const info = infoPorBaseECodigo[baseNome].get(String(codigo).trim());
      if (info?.CLI_REP_CODIGO != null) return String(info.CLI_REP_CODIGO).trim();
    }
    return "";
  }
  const codigosRepresentante = new Set<string>();
  for (const c of porCliente12m.values()) {
    const rc = representanteDoCliente(c);
    if (rc) codigosRepresentante.add(rc);
  }
  const nomesRepresentantes = new Map<string, string>();
  for (const base of BASES) {
    if (codigosRepresentante.size === 0) break;
    const lista = [...codigosRepresentante].join(",");
    const rows = await queryFirebird<{ REP_CODIGO: any; REP_NOME: any }>(
      base.lojaKey,
      `SELECT rep_codigo, rep_nome FROM representantes WHERE rep_codigo IN (${lista})`
    );
    for (const r of rows) {
      const codigo = String(r.REP_CODIGO).trim();
      if (!nomesRepresentantes.has(codigo)) nomesRepresentantes.set(codigo, r.REP_NOME?.toString().trim() || "");
    }
  }

  const clientes = Array.from(porCliente12m.values()).sort((a, b) => b.valor - a.valor);
  const totalGeral = clientes.reduce((s, c) => s + c.valor, 0);

  let acumulado = 0;
  const classificados = clientes.map((c) => {
    acumulado += c.valor;
    const acumuladoPercentual = Math.round((acumulado / totalGeral) * 10000) / 100;
    let tier: "A1 (VIP)" | "A2" | "B" | "C";
    if (acumuladoPercentual <= 10) tier = "A1 (VIP)";
    else if (acumuladoPercentual <= 30) tier = "A2";
    else if (acumuladoPercentual <= 70) tier = "B";
    else tier = "C";
    return { cliente: c, tier, acumuladoPercentual };
  });

  const a1a2SemCompra = classificados.filter(
    (c) => (c.tier === "A1 (VIP)" || c.tier === "A2") && !comprouEsseMes.has(c.cliente.chave)
  );

  console.log(`\nTotal A1+A2: ${classificados.filter((c) => c.tier === "A1 (VIP)" || c.tier === "A2").length}`);
  console.log(`A1/A2 sem compra no mês corrente: ${a1a2SemCompra.length}\n`);

  const sheetResultado = a1a2SemCompra
    .sort((a, b) => (a.tier === b.tier ? b.cliente.valor - a.cliente.valor : a.tier.localeCompare(b.tier)))
    .map((c) => ({
      "Classificação": c.tier,
      "Código": c.cliente.codigosPorBase.SJC ?? c.cliente.codigosPorBase.MG ?? "",
      "Cliente": c.cliente.nome,
      "CNPJ": c.cliente.cnpjExibicao,
      "Representante": nomesRepresentantes.get(representanteDoCliente(c.cliente)) || "",
      "Setor(es)": [...c.cliente.setores].sort().join(" / "),
      "Faturamento (12 meses)": Math.round(c.cliente.valor * 100) / 100,
      "% Acumulado": c.acumuladoPercentual,
      "Última Compra (últimos 12 meses)": c.cliente.ultimaCompra || "",
    }));

  const sheetResumo = [
    { "Indicador": "Total de clientes A1 (VIP)", "Valor": classificados.filter((c) => c.tier === "A1 (VIP)").length },
    { "Indicador": "Total de clientes A2", "Valor": classificados.filter((c) => c.tier === "A2").length },
    { "Indicador": "A1 (VIP) sem compra no mês corrente", "Valor": a1a2SemCompra.filter((c) => c.tier === "A1 (VIP)").length },
    { "Indicador": "A2 sem compra no mês corrente", "Valor": a1a2SemCompra.filter((c) => c.tier === "A2").length },
    { "Indicador": "Mês corrente considerado", "Valor": `${MES_INICIO} a ${fmtData(HOJE)}` },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetResumo), "Resumo");
  const wsResultado = XLSX.utils.json_to_sheet(sheetResultado);
  wsResultado["!cols"] = [
    { wch: 12 }, { wch: 12 }, { wch: 40 }, { wch: 20 }, { wch: 26 }, { wch: 22 }, { wch: 18 }, { wch: 12 }, { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, wsResultado, "A1-A2 sem compra no mês");

  const fileName = `Clientes_A1_A2_Sem_Compra_Mes.xlsx`;
  const outPath = path.join(os.homedir(), "Desktop", fileName);
  XLSX.writeFile(wb, outPath);

  console.log(`Relatório salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
