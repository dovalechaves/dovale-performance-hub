/**
 * Relatório: Segmentação de clientes A1(VIP)/A2/B/C — setores TELEVENDAS e
 * TELEVENDAS MG, bases SJC e MG, últimos 12 meses (rolling).
 *
 * Critério (definido pelo Willian em 2026-09-17 — ver memória
 * project-client-abc-segmentation): clientes ordenados por faturamento desc,
 * classificados pelo % ACUMULADO sobre o total (mesmo método já usado na
 * curva ABC de fornecedores, scripts/relatorio-fornecedores-curva-abc-revenda.ts):
 *   A1 (VIP) = até 10% acumulado
 *   A2       = de 10% até 30% acumulado
 *   B        = de 30% até 70% acumulado
 *   C        = de 70% até 100% acumulado
 *
 * Setor = representante do PEDIDO (pdv_rep_codigo) → representantes.rep_rvs_codigo
 * → representantes_supervisores.rvs_nome IN ('TELEVENDAS', 'TELEVENDAS MG').
 *
 * Valor de venda = SUM(pvi_totalitem + pvi_substicms + pvi_vl_fcp_st + pvi_ipivalor)
 * (padrão do projeto). Exclui cancelados (pdv_psi_codigo NOT IN ('CC')) e situações
 * de não-venda (pdv_tve_codigo NOT IN ('6','7','26','34')).
 *
 * Unificação: SJC + MG somados por CNPJ (mesmo cliente físico cadastrado nas
 * duas bases vira uma linha só, mesmo padrão do relatório de fornecedores).
 *
 * Exclusão fixa: cliente I.J.S. RODRIGUES FERRAGENS E AUTOPECAS LTDA. (cli_codigo
 * 30683, CNPJ 21.648.518/0001-06, presente em SJC e MG) é sempre excluído, antes
 * de calcular total/percentuais.
 *
 * "Representante" = representante do CADASTRO do cliente (cli_rep_codigo), não
 * do pedido — mesma convenção de scripts/relatorio-chaves-televendas-separado.ts.
 *
 * Rodar: npx tsx scripts/relatorio-clientes-abc-televendas.ts
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

const CLIENTE_EXCLUIDO_CNPJ = "21648518000106"; // I.J.S. RODRIGUES FERRAGENS E AUTOPECAS LTDA.
const CLIENTE_EXCLUIDO_CODIGO = 30683;

const BASES = [
  { lojaKey: "sjc" as const, nome: "SJC" },
  { lojaKey: "mg" as const, nome: "MG" },
];

const SETORES = ["TELEVENDAS", "TELEVENDAS MG"];

interface VendaClienteRow {
  CLI_CODIGO: any;
  RVS_NOME: any;
  VALOR: any;
}

interface ClienteInfoRow {
  CLI_CODIGO: any;
  CLI_NOME: any;
  CLI_CNPJ: any;
  CLI_REP_CODIGO: any;
}

function sqlVendasPorClienteSetor() {
  const listaSetores = SETORES.map((s) => `'${s}'`).join(",");
  return `
    SELECT
      ped.pdv_cli_codigo AS cli_codigo,
      rs.rvs_nome AS rvs_nome,
      SUM(i.pvi_totalitem + i.pvi_substicms + i.pvi_vl_fcp_st + i.pvi_ipivalor) AS valor
    FROM pedidos_vendas ped
    INNER JOIN pedidos_vendas_itens i ON i.pvi_numero = ped.pdv_numero
    INNER JOIN representantes r ON r.rep_codigo = ped.pdv_rep_codigo
    INNER JOIN representantes_supervisores rs ON rs.rvs_codigo = r.rep_rvs_codigo
    WHERE rs.rvs_nome IN (${listaSetores})
      AND ped.pdv_data >= CAST('${PERIODO_INICIO}' AS DATE)
      AND ped.pdv_data < CAST('${PERIODO_FIM}' AS DATE)
      AND ped.pdv_psi_codigo NOT IN ('CC')
      AND ped.pdv_tve_codigo NOT IN ('6', '7', '26', '34')
    GROUP BY ped.pdv_cli_codigo, rs.rvs_nome
  `;
}

function normalizarCnpj(cnpj: any): string {
  const digitos = String(cnpj ?? "").replace(/\D/g, "");
  return digitos || "";
}

interface ClienteUnificado {
  chave: string;
  codigosPorBase: Partial<Record<"SJC" | "MG", number>>;
  nome: string;
  cnpjExibicao: string;
  valor: number;
  setores: Set<string>;
}

async function main() {
  console.log(`=== Segmentação A1/A2/B/C — Clientes Televendas/Televendas MG — SJC+MG ===\n`);
  console.log(`Período (últimos 12 meses): ${PERIODO_INICIO} a ${PERIODO_FIM}\n`);

  const porCliente = new Map<string, ClienteUnificado>();
  // codigo (string) -> info do cadastro, por base, pra resolver depois
  const infoPorBaseECodigo: Record<"SJC" | "MG", Map<string, ClienteInfoRow>> = { SJC: new Map(), MG: new Map() };

  for (const base of BASES) {
    console.log(`Consultando vendas em ${base.nome}...`);
    const rows = await queryFirebird<VendaClienteRow>(base.lojaKey, sqlVendasPorClienteSetor());
    console.log(`  ${rows.length} linhas cliente/setor com venda`);

    const codigosUnicos = [...new Set(rows.map((r) => Number(r.CLI_CODIGO)))].filter((c) => !!c);
    if (codigosUnicos.length === 0) continue;

    const LOTE = 1000;
    for (let i = 0; i < codigosUnicos.length; i += LOTE) {
      const pedaco = codigosUnicos.slice(i, i + LOTE);
      const lista = pedaco.join(",");
      const infoRows = await queryFirebird<ClienteInfoRow>(
        base.lojaKey,
        `SELECT cli_codigo, cli_nome, cli_cnpj, cli_rep_codigo FROM clientes WHERE cli_codigo IN (${lista})`
      );
      for (const info of infoRows) {
        infoPorBaseECodigo[base.nome].set(String(info.CLI_CODIGO).trim(), info);
      }
    }

    for (const row of rows) {
      const valor = Number(row.VALOR) || 0;
      if (valor <= 0) continue;
      const codigo = Number(row.CLI_CODIGO);
      const info = infoPorBaseECodigo[base.nome].get(String(codigo).trim());
      const cnpjNormalizado = normalizarCnpj(info?.CLI_CNPJ);
      const chave = cnpjNormalizado || `SEMCNPJ-${base.nome}-${codigo}`;

      if (cnpjNormalizado === CLIENTE_EXCLUIDO_CNPJ || codigo === CLIENTE_EXCLUIDO_CODIGO) continue;

      const nome = info?.CLI_NOME?.toString().trim() || "";
      const cnpjExibicao = String(info?.CLI_CNPJ ?? "").trim();
      const setor = row.RVS_NOME?.toString().trim() || "";

      const atual = porCliente.get(chave);
      if (atual) {
        atual.valor += valor;
        atual.setores.add(setor);
        atual.codigosPorBase[base.nome] = codigo;
        if (!atual.nome && nome) atual.nome = nome;
      } else {
        porCliente.set(chave, {
          chave,
          codigosPorBase: { [base.nome]: codigo },
          nome,
          cnpjExibicao,
          valor,
          setores: new Set([setor]),
        });
      }
    }
  }

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
  for (const c of porCliente.values()) {
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

  const clientes = Array.from(porCliente.values()).sort((a, b) => b.valor - a.valor);
  const totalGeral = clientes.reduce((s, c) => s + c.valor, 0);

  console.log(`\nClientes únicos (excluído I.J.S. Rodrigues): ${clientes.length}`);
  console.log(`Faturamento total (12 meses): ${totalGeral.toFixed(2)}`);

  let acumulado = 0;
  let countA1 = 0, countA2 = 0, countB = 0, countC = 0;
  const classificados = clientes.map((c) => {
    acumulado += c.valor;
    const percentual = Math.round((c.valor / totalGeral) * 10000) / 100;
    const acumuladoPercentual = Math.round((acumulado / totalGeral) * 10000) / 100;
    let tier: "A1 (VIP)" | "A2" | "B" | "C";
    if (acumuladoPercentual <= 10) {
      tier = "A1 (VIP)";
      countA1++;
    } else if (acumuladoPercentual <= 30) {
      tier = "A2";
      countA2++;
    } else if (acumuladoPercentual <= 70) {
      tier = "B";
      countB++;
    } else {
      tier = "C";
      countC++;
    }
    const repCodigo = representanteDoCliente(c);
    return {
      tier,
      codigo: c.codigosPorBase.SJC ?? c.codigosPorBase.MG ?? "",
      nome: c.nome,
      cnpj: c.cnpjExibicao,
      representante: nomesRepresentantes.get(repCodigo) || "",
      setores: [...c.setores].sort().join(" / "),
      valor: c.valor,
      percentual,
      acumuladoPercentual,
    };
  });

  console.log(`A1 (VIP): ${countA1} | A2: ${countA2} | B: ${countB} | C: ${countC}\n`);

  const sheetClientes = classificados.map((c) => ({
    "Classificação": c.tier,
    "Código": c.codigo,
    "Cliente": c.nome,
    "CNPJ": c.cnpj,
    "Representante": c.representante,
    "Setor(es)": c.setores,
    "Faturamento (12 meses)": Math.round(c.valor * 100) / 100,
    "% do Total": c.percentual,
    "% Acumulado": c.acumuladoPercentual,
  }));

  const sheetResumo = [
    { "Classificação": "A1 (VIP)", "Faixa % Acumulado": "0% a 10%", "Qtde Clientes": countA1 },
    { "Classificação": "A2", "Faixa % Acumulado": "10% a 30%", "Qtde Clientes": countA2 },
    { "Classificação": "B", "Faixa % Acumulado": "30% a 70%", "Qtde Clientes": countB },
    { "Classificação": "C", "Faixa % Acumulado": "70% a 100%", "Qtde Clientes": countC },
    { "Classificação": "Total", "Faixa % Acumulado": "-", "Qtde Clientes": clientes.length },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetResumo), "Resumo");
  const wsClientes = XLSX.utils.json_to_sheet(sheetClientes);
  wsClientes["!cols"] = [
    { wch: 12 }, { wch: 12 }, { wch: 40 }, { wch: 20 }, { wch: 26 }, { wch: 22 }, { wch: 18 }, { wch: 12 }, { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, wsClientes, "Clientes");

  const fileName = `Clientes_ABC_Televendas.xlsx`;
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
