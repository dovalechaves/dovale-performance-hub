/**
 * Relatório: todos os clientes dos setores FERRAGENS e POLYFORTE com venda nos
 * últimos 12 meses — bases SJC e MG tratadas como uma base só (mesmo cliente/
 * representante nas duas é somado numa linha, sem coluna de Base). Inclui parcerias
 * E vendas individuais (confirmado com a pessoa que pediu: "as que vierem individuais
 * são bem-vindas tbm"). Exclui vendas para Leroy Merlin (todas as filiais/CNPJs —
 * filtro por "LEROY MERLIN" no nome do cliente).
 *
 * O nome do representante embute duas informações via "/":
 *   "FERRAGENS ANESIA/ AMILTON RJ"  → Vendedora Interna = ANESIA, Representante = AMILTON RJ
 *   "FERRAGENS ANESIA SIQUEIRA"     → venda individual: Vendedora Interna = ANESIA SIQUEIRA, sem parceiro
 *   "FERRAGENS ADILSON / BA"        → representante externo vendendo direto, sem vendedora interna
 *
 * Não há como distinguir os três casos só pela posição do "/" — o texto à esquerda
 * tanto pode ser a vendedora interna (em uma parceria) quanto o próprio representante
 * externo (quando vende sozinho, só com a UF ao lado). A regra usada aqui: o texto à
 * esquerda do "/" só conta como "Vendedora Interna" se esse mesmo nome também aparece
 * em ALGUM registro de representante SEM "/" no cadastro (prova de que essa pessoa tem
 * uma carteira própria como vendedora interna) — senão, o nome inteiro (dos dois lados
 * do "/") é tratado como Representante externo solo. É uma inferência sobre a convenção
 * de nomenclatura, não um campo do banco — a coluna "Representante (nome original)" foi
 * mantida para conferência.
 *
 * Colunas: Código Cliente | Cliente | Vendedora Interna | Representante |
 * Faturamento no Período (R$) | Última Compra.
 *
 * Padrão de venda real do projeto: pdv_psi_codigo NOT IN ('CC') e
 * pdv_tve_codigo NOT IN ('6','7','26','34'). Janela: últimos 12 meses (hoje - 12 meses).
 *
 * Rodar: npx tsx scripts/relatorio-ferragens-parceria-sjc-mg.ts
 */
import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const BASES = [
  { lojaKey: "sjc" as const, nome: "SJC" },
  { lojaKey: "mg" as const, nome: "MG" },
];

const SETORES = "'FERRAGENS','POLYFORTE'";

function sqlClientesSetor() {
  // O representante da "parceria" é atribuído no PEDIDO (pdv_rep_codigo), não no
  // cadastro do cliente (cli_rep_codigo) — o cadastro quase sempre mantém a vendedora
  // interna "casa"; quem realmente vendeu (sozinho ou em parceria) fica no pedido.
  // Por isso um mesmo cliente pode aparecer mais de uma vez, uma por representante
  // diferente que vendeu para ele no período.
  return `
    select
      c.cli_codigo,
      c.cli_nome,
      r.rep_nome as representante,
      sum(coalesce(i.pvi_totalitem,0)+coalesce(i.pvi_substicms,0)+coalesce(i.pvi_vl_fcp_st,0)+coalesce(i.pvi_ipivalor,0)) as faturamento,
      max(ped.pdv_data) as ultima_compra
    from pedidos_vendas ped
    inner join clientes c on c.cli_codigo = ped.pdv_cli_codigo
    inner join representantes r on r.rep_codigo = ped.pdv_rep_codigo
    inner join representantes_supervisores rs on rs.rvs_codigo = r.rep_rvs_codigo
    inner join pedidos_vendas_itens i on i.pvi_numero = ped.pdv_numero
    where rs.rvs_nome in (${SETORES})
    and upper(c.cli_nome) not like '%LEROY MERLIN%'
    and ped.pdv_data >= dateadd(month, -12, current_date)
    and ped.pdv_psi_codigo not in ('CC')
    and ped.pdv_tve_codigo not in ('6','7','26','34')
    group by 1,2,3
    order by 1
  `;
}

function sqlNomesSoloSetor() {
  // Todos os nomes de representante do setor SEM "/" — usados como referência para
  // saber quais nomes correspondem a uma "vendedora interna" com carteira própria.
  return `
    select r.rep_nome
    from representantes r
    inner join representantes_supervisores rs on rs.rvs_codigo = r.rep_rvs_codigo
    where rs.rvs_nome in (${SETORES})
    and r.rep_nome not like '%/%'
  `;
}

function stripSetor(nome: string): string {
  return nome.replace(/^\*?\s*(FERRAGENS|POLYFORTE)\s+/i, "").trim();
}

function construirClassificador(nomesSolo: string[]) {
  const soloSet = nomesSolo.map((n) => stripSetor(n).toUpperCase()).filter(Boolean);
  return function classificar(repNomeOriginal: string): { vendedoraInterna: string; representante: string } {
    const semSetor = stripSetor(repNomeOriginal || "");
    const idx = semSetor.indexOf("/");
    if (idx === -1) {
      return { vendedoraInterna: semSetor, representante: "" };
    }
    const esquerda = semSetor.slice(0, idx).trim();
    const direita = semSetor.slice(idx + 1).trim();
    const esquerdaUpper = esquerda.toUpperCase();
    const bateComVendedoraInterna = soloSet.some((solo) => solo === esquerdaUpper || solo.startsWith(esquerdaUpper + " "));
    if (bateComVendedoraInterna) {
      return { vendedoraInterna: esquerda, representante: direita };
    }
    return { vendedoraInterna: "", representante: `${esquerda} ${direita}`.trim() };
  };
}

interface LinhaCliente {
  CLI_CODIGO: any;
  CLI_NOME: any;
  REPRESENTANTE: any;
  FATURAMENTO: any;
  ULTIMA_COMPRA: any;
}

function fmtData(d: any): string {
  if (!d) return "";
  const data = d instanceof Date ? d : new Date(String(d));
  if (isNaN(data.getTime())) return "";
  return data.toISOString().slice(0, 10).split("-").reverse().join("/");
}

interface Merge {
  codigo: string;
  cliente: string;
  repOriginal: string;
  vendedoraInterna: string;
  representante: string;
  faturamento: number;
  ultimaCompra: Date | null;
}

async function main() {
  console.log("=== Relatório: Clientes Ferragens/Polyforte (parceria + individual) — últimos 12 meses — SJC+MG como uma base só ===\n");

  // SJC e MG são tratadas como uma base única: se o mesmo cliente (mesmo código)
  // vendeu pelo mesmo representante nas duas bases, soma o faturamento e fica com a
  // data de última compra mais recente entre as duas.
  const merge = new Map<string, Merge>();

  for (const base of BASES) {
    console.log(`Consultando base ${base.nome}...`);
    const [rows, nomesSolo] = await Promise.all([
      queryFirebird<LinhaCliente>(base.lojaKey, sqlClientesSetor()),
      queryFirebird<{ REP_NOME: any }>(base.lojaKey, sqlNomesSoloSetor()),
    ]);
    console.log(`  ${rows.length} clientes ativos | ${nomesSolo.length} nomes de referência "sem parceiro" na base ${base.nome}`);

    const classificar = construirClassificador(nomesSolo.map((n) => (n.REP_NOME ?? "").toString()));

    for (const row of rows) {
      const codigo = row.CLI_CODIGO?.toString().trim() || "";
      const repOriginal = row.REPRESENTANTE?.toString().trim() || "";
      const chave = `${codigo}|${repOriginal}`;
      const { vendedoraInterna, representante } = classificar(repOriginal);
      const faturamento = Number(row.FATURAMENTO) || 0;
      const ultimaCompra = row.ULTIMA_COMPRA ? new Date(row.ULTIMA_COMPRA) : null;

      const existente = merge.get(chave);
      if (existente) {
        existente.faturamento += faturamento;
        if (ultimaCompra && (!existente.ultimaCompra || ultimaCompra > existente.ultimaCompra)) {
          existente.ultimaCompra = ultimaCompra;
        }
      } else {
        merge.set(chave, {
          codigo,
          cliente: row.CLI_NOME?.toString().trim() || "",
          repOriginal,
          vendedoraInterna,
          representante,
          faturamento,
          ultimaCompra,
        });
      }
    }
  }

  const sheetDados = Array.from(merge.values())
    .sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }))
    .map((l) => ({
      "Código Cliente": l.codigo,
      "Cliente": l.cliente,
      "Vendedora Interna": l.vendedoraInterna,
      "Representante": l.representante,
      "Faturamento no Período (R$)": Number(l.faturamento.toFixed(2)),
      "Última Compra": fmtData(l.ultimaCompra),
      "Representante (nome original)": l.repOriginal,
    }));

  console.log(`\nTotal de linhas: ${sheetDados.length}`);

  const totalParceria = sheetDados.filter((l) => l["Vendedora Interna"] && l["Representante"]).length;
  const totalSoInterna = sheetDados.filter((l) => l["Vendedora Interna"] && !l["Representante"]).length;
  const totalSoExterno = sheetDados.filter((l) => !l["Vendedora Interna"] && l["Representante"]).length;
  console.log(`  Parceria (interna + externo): ${totalParceria}`);
  console.log(`  Só vendedora interna (individual): ${totalSoInterna}`);
  console.log(`  Só representante externo (individual): ${totalSoExterno}`);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetDados);
  ws["!cols"] = [
    { wch: 14 }, { wch: 40 }, { wch: 22 }, { wch: 22 }, { wch: 20 }, { wch: 14 }, { wch: 34 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Ferragens e Polyforte");

  const fileName = "Ferragens_Polyforte_Parceria_Individual.xlsx";
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
