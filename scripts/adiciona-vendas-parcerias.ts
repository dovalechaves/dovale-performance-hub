/**
 * Adiciona uma nova aba ao "Solicitacao_TI_Parcerias_FINAL_Revisada.xlsx" (não mexe
 * em mais nada do arquivo — "Solicitação TI" e "Controle" ficam exatamente como
 * estão) com as vendas, uma linha por pedido, dos 48 clientes listados na aba
 * "Solicitação TI" (linhas 6+, coluna "Código"), no período 01/07/2025 a 31/08/2026,
 * bases SJC + MG.
 *
 * Colunas: Base, Código Cliente, Cliente, Vendedora (representante do PEDIDO —
 * pdv_rep_codigo, quem vendeu de fato, não o cadastro), Data da Compra, Valor
 * Faturado (R$).
 *
 * Padrão de venda real do projeto: pdv_psi_codigo NOT IN ('CC') e
 * pdv_tve_codigo NOT IN ('6','7','26','34').
 *
 * Rodar: npx tsx scripts/adiciona-vendas-parcerias.ts
 */
import "dotenv/config";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const ARQUIVO = "C:/Users/willian.rubim/Documents/Solicitacao_TI_Parcerias_FINAL_Revisada.xlsx";
const ABA_LISTA = "Solicitação TI";
const ABA_NOVA = "Vendas Detalhadas";

const DATA_INI = "2025-07-01";
const DATA_FIM = "2026-08-31";

const BASES = [
  { lojaKey: "sjc" as const, nome: "SJC" },
  { lojaKey: "mg" as const, nome: "MG" },
];

function sqlVendasClientes(codigos: string[]) {
  const lista = codigos.map((c) => `'${c}'`).join(",");
  return `
    select
      ped.pdv_cli_codigo as codigo,
      c.cli_nome as cliente,
      r.rep_nome as vendedora,
      ped.pdv_data as data_compra,
      ped.pdv_numero as pedido,
      sum(coalesce(i.pvi_totalitem,0)+coalesce(i.pvi_substicms,0)+coalesce(i.pvi_vl_fcp_st,0)+coalesce(i.pvi_ipivalor,0)) as valor
    from pedidos_vendas ped
    inner join clientes c on c.cli_codigo = ped.pdv_cli_codigo
    inner join pedidos_vendas_itens i on i.pvi_numero = ped.pdv_numero
    left join representantes r on r.rep_codigo = ped.pdv_rep_codigo
    where ped.pdv_cli_codigo in (${lista})
    and ped.pdv_data >= date '${DATA_INI}'
    and ped.pdv_data <= date '${DATA_FIM}'
    and ped.pdv_psi_codigo not in ('CC')
    and ped.pdv_tve_codigo not in ('6','7','26','34')
    group by 1,2,3,4,5
    order by ped.pdv_data
  `;
}

function fmtData(d: any): string {
  if (!d) return "";
  const data = d instanceof Date ? d : new Date(String(d));
  if (isNaN(data.getTime())) return "";
  return data.toISOString().slice(0, 10).split("-").reverse().join("/");
}

async function main() {
  console.log("=== Adicionando aba de vendas detalhadas — Parcerias Tatiana A./Tatiana R. ===\n");

  const wb = XLSX.readFile(ARQUIVO);
  const wsLista = wb.Sheets[ABA_LISTA];
  if (!wsLista) throw new Error(`Aba "${ABA_LISTA}" não encontrada`);

  const linhasLista = XLSX.utils.sheet_to_json(wsLista, { header: 1 }) as any[];
  const cabecalho = linhasLista[5] as string[];
  const idxCodigo = cabecalho.indexOf("Código");
  if (idxCodigo === -1) throw new Error(`Coluna "Código" não encontrada no cabeçalho da linha 6`);

  const codigos = linhasLista
    .slice(6)
    .map((l) => l[idxCodigo]?.toString().trim())
    .filter((c): c is string => !!c);
  console.log(`Clientes na lista: ${codigos.length}`);

  const linhasSaida: Record<string, any>[] = [];
  const codigosEncontrados = new Set<string>();

  for (const base of BASES) {
    console.log(`Consultando base ${base.nome}...`);
    const rows = await queryFirebird<any>(base.lojaKey, sqlVendasClientes(codigos));
    console.log(`  ${rows.length} pedidos encontrados`);
    rows.forEach((r: any) => {
      const codigo = r.CODIGO?.toString().trim();
      codigosEncontrados.add(codigo);
      linhasSaida.push({
        "Base": base.nome,
        "Código Cliente": codigo,
        "Cliente": r.CLIENTE?.toString().trim() || "",
        "Vendedora": r.VENDEDORA?.toString().trim() || "",
        "Data da Compra": fmtData(r.DATA_COMPRA),
        "Valor Faturado (R$)": Number(r.VALOR) || 0,
      });
    });
  }

  console.log(`\nTotal de linhas (pedidos): ${linhasSaida.length}`);
  const semVenda = codigos.filter((c) => !codigosEncontrados.has(c));
  console.log(`Clientes da lista sem nenhuma venda no período: ${semVenda.length}`);
  if (semVenda.length > 0) console.log(`  Códigos: ${semVenda.join(", ")}`);

  // Ordena por cliente e depois por data
  linhasSaida.sort((a, b) => a["Código Cliente"].localeCompare(b["Código Cliente"], undefined, { numeric: true }) || a["Data da Compra"].localeCompare(b["Data da Compra"]));

  const wsNova = XLSX.utils.json_to_sheet(linhasSaida);
  wsNova["!cols"] = [{ wch: 8 }, { wch: 14 }, { wch: 45 }, { wch: 22 }, { wch: 14 }, { wch: 16 }];

  // Remove a aba se já existir (reexecução) e adiciona de novo — não mexe nas outras
  if (wb.SheetNames.includes(ABA_NOVA)) {
    XLSX.utils.book_delete_sheet(wb, ABA_NOVA);
  }
  XLSX.utils.book_append_sheet(wb, wsNova, ABA_NOVA);

  XLSX.writeFile(wb, ARQUIVO);
  console.log(`\nArquivo atualizado (mesmo caminho, aba "${ABA_NOVA}" adicionada): ${ARQUIVO}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro:", err);
    process.exit(1);
  });
