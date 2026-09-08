/**
 * Relatório: os 338 melhores clientes INATIVOS (SJC + MG), a partir da mesma lista
 * de clientes do SQL que o Willian já usa (sem alterar nenhuma condição do WHERE).
 * Exclui qualquer cliente (por COD_CLIENTE) que já apareça em "mala direta.xlsx" ou
 * "mala direta 2.xlsx" — essas duas listas já foram usadas em outro envio, não pode
 * repetir cliente.
 *
 * "Inativo" = sem NENHUMA compra (qualquer produto, padrão de venda real do projeto)
 * nos últimos 4 meses (última compra antes de hoje - 4 meses).
 * "Melhores" = ranqueados pelo valor total comprado em 2026 (SUM padrão:
 * pvi_totalitem + pvi_substicms + pvi_vl_fcp_st + pvi_ipivalor), descendente — pega
 * os 338 primeiros.
 *
 * SJC e MG tratadas como a mesma base de clientes (mesmo código = mesmo cliente,
 * mesmo critério já usado nos relatórios anteriores de SJC/MG) — soma valor e fica
 * com a última compra mais recente entre as duas quando o código aparece nas duas.
 *
 * Colunas exatamente como no SQL original (cod_cliente, cliente, endereco, numero,
 * complemento, bairro, cidade, estado, cep, rep_nome, rep_codigo), mais duas colunas
 * de apoio pra mostrar o critério de seleção: Valor 2026 (R$) e Última Compra.
 *
 * Rodar: npx tsx scripts/relatorio-melhores-inativos-338.ts
 */
import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const ARQUIVOS_EXCLUSAO = [
  "C:/Users/willian.rubim/Documents/mala direta.xlsx",
  "C:/Users/willian.rubim/Documents/mala direta 2.xlsx",
];

function carregarCodigosExcluidos(): Set<string> {
  const excluidos = new Set<string>();
  for (const arquivo of ARQUIVOS_EXCLUSAO) {
    const wb = XLSX.readFile(arquivo);
    const primeiraAba = wb.SheetNames[0];
    const linhas = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[primeiraAba]);
    linhas.forEach((l) => {
      const codigo = l["COD_CLIENTE"]?.toString().trim();
      if (codigo) excluidos.add(codigo);
    });
  }
  return excluidos;
}

const BASES = [
  { lojaKey: "sjc" as const, nome: "SJC" },
  { lojaKey: "mg" as const, nome: "MG" },
];

const QTD_ALVO = 338;
const MESES_INATIVIDADE = 4;

// SQL original do Willian — sem nenhuma alteração no WHERE.
function sqlClientesBase() {
  return `
    select c.cli_codigo as cod_cliente, c.cli_nome as cliente, c.cli_endereco as endereco, c.cli_numeroimovel as numero, c.cli_complemento as complemento,
    c.cli_bairro as bairro, m.mun_nome as cidade, m.mun_uf as estado, c.cli_cep as cep, r.rep_nome, r.rep_codigo
    from clientes c
    inner join municipios m on m.mun_codigo = c.cli_mun_codigo
    inner join representantes r on r.rep_codigo = c.cli_rep_codigo
    where c.cli_eta_codigo in ('1','2','3')
    and c.cli_cep is not null
    and c.cli_cep not like '-'
    and c.cli_cep not like '00000-000'
    and c.cli_cep not like '000000000'
    and c.cli_cep not like '00'
    and c.cli_cep not like '99999-990'
    and c.cli_cep not like '-00000000'
    and c.cli_cep not like '0000'
    and m.mun_nome not like 'São Paulo'
    and r.rep_nome not like '*%'
    and c.cli_rep_codigo not in (172,11,1664,944,29,70,674,949,515,1133,917,729,1863)
    and c.cli_ind_maladireta = '1'
    and c.cli_cliente = '1'
    and r.rep_rvs_codigo in (1,16)
    and r.rep_nome not like '%DISTRIBUIDOR%'
    and m.mun_uf not in ('PR','SE')
    and m.mun_codigo not in( 3549805,
    3136702,
    1501402,
    1500800,
    5208707,
    5220454,
    5208806,
    5214507,
    5209200,
    5201801,
    5200050,
    5200100,
    5200308,
    5221193    ,
    5201405    ,
    5201108    ,
    3555408    ,
    3554104    ,
    3550706    ,
    3549906    ,
    3546407    ,
    3545805    ,
    3530607    ,
    3526901    ,
    3524403    ,
    3518304    ,
    3513404    ,
    3510608    ,
    3508701    ,
    3506804    ,
    3506358    ,
    3503701    ,
    3509502    ,
    3171002    ,
    3170702    ,
    3169308    ,
    3168706    ,
    3167205    ,
    3161607    ,
    3161108    ,
    3154004    ,
    3150807    ,
    3149103    ,
    3147007    ,
    3146102    ,
    3144806    ,
    3141209    ,
    3139905    ,
    3139102    ,
    3138203    ,
    3137801    ,
    3136207    ,
    3133808    ,
    3131307    ,
    3130300    ,
    3127701    ,
    3126604    ,
    3124500    ,
    3118601    ,
    3118302    ,
    3112405    ,
    3112306    ,
    3112207    ,
    3111506    ,
    3110804    ,
    3107108    ,
    3106705    ,
    3106200    ,
    3103701    ,
    3102208    ,
    3549904    ,
    3524402    ,
    3503901    ,
    3546009    ,
    3506359    ,
    3508504    ,
    3513405    ,
    3550704    ,
    3554102    ,
    3171204    ,
    3137601    ,
    3153608    ,
    3167202    ,
    3140704    ,
    3129806    ,
    3101607    ,
    3169307    ,
    3170701    ,
    3101804,
    3500501,
    3500600,
    3501608,
    3501905,
    3503307,
    3509205,
    3509601,
    3510401,
    3511706,
    3512209,
    3512704,
    3514908,
    3519071,
    3520509,
    3521408,
    3522604,
    3523404,
    3523909,
    3524709,
    3525201,
    3525904,
    3526704,
    3526902,
    3527009,
    3530706,
    3530805,
    3531803,
    3532009,
    3538709,
    3544004,
    3545159,
    3545209,
    3545803,
    3549102,
    3550407,
    3552106,
    3556206,
    3556503,
    3556701    )
  `;
}

// Última compra (qualquer produto), valor comprado em 2026 e em 2025, por cliente
function sqlHistoricoCliente() {
  return `
    select
      ped.pdv_cli_codigo as codigo,
      max(ped.pdv_data) as ultima_compra,
      sum(case when extract(year from ped.pdv_data) = 2026
        then coalesce(i.pvi_totalitem,0)+coalesce(i.pvi_substicms,0)+coalesce(i.pvi_vl_fcp_st,0)+coalesce(i.pvi_ipivalor,0)
        else 0 end) as valor_2026,
      sum(case when extract(year from ped.pdv_data) = 2025
        then coalesce(i.pvi_totalitem,0)+coalesce(i.pvi_substicms,0)+coalesce(i.pvi_vl_fcp_st,0)+coalesce(i.pvi_ipivalor,0)
        else 0 end) as valor_2025
    from pedidos_vendas ped
    inner join pedidos_vendas_itens i on i.pvi_numero = ped.pdv_numero
    where ped.pdv_psi_codigo not in ('CC')
    and ped.pdv_tve_codigo not in ('6','7','26','34')
    group by ped.pdv_cli_codigo
  `;
}

interface ClienteRow {
  COD_CLIENTE: any;
  CLIENTE: any;
  ENDERECO: any;
  NUMERO: any;
  COMPLEMENTO: any;
  BAIRRO: any;
  CIDADE: any;
  ESTADO: any;
  CEP: any;
  REP_NOME: any;
  REP_CODIGO: any;
}

function fmtData(d: any): string {
  if (!d) return "";
  const data = d instanceof Date ? d : new Date(String(d));
  if (isNaN(data.getTime())) return "";
  return data.toISOString().slice(0, 10).split("-").reverse().join("/");
}

async function main() {
  console.log("=== Melhores 338 clientes inativos (sem comprar há 4+ meses) — SJC/MG ===\n");

  const clientesPorCodigo = new Map<string, ClienteRow & { base: string }>();
  const historicoPorCodigo = new Map<string, { ultimaCompra: Date | null; valor2026: number; valor2025: number }>();

  for (const base of BASES) {
    console.log(`Consultando base ${base.nome}...`);
    const [clientes, historico] = await Promise.all([
      queryFirebird<ClienteRow>(base.lojaKey, sqlClientesBase()),
      queryFirebird<any>(base.lojaKey, sqlHistoricoCliente()),
    ]);
    console.log(`  ${clientes.length} clientes na lista base | ${historico.length} clientes com histórico de pedidos`);

    clientes.forEach((row) => {
      const codigo = row.COD_CLIENTE?.toString().trim();
      if (!codigo) return;
      if (!clientesPorCodigo.has(codigo)) clientesPorCodigo.set(codigo, { ...row, base: base.nome });
    });

    historico.forEach((row: any) => {
      const codigo = row.CODIGO?.toString().trim();
      if (!codigo) return;
      const ultimaCompra = row.ULTIMA_COMPRA ? new Date(row.ULTIMA_COMPRA) : null;
      const valor2026 = Number(row.VALOR_2026) || 0;
      const valor2025 = Number(row.VALOR_2025) || 0;
      const existente = historicoPorCodigo.get(codigo);
      if (existente) {
        existente.valor2026 += valor2026;
        existente.valor2025 += valor2025;
        if (ultimaCompra && (!existente.ultimaCompra || ultimaCompra > existente.ultimaCompra)) {
          existente.ultimaCompra = ultimaCompra;
        }
      } else {
        historicoPorCodigo.set(codigo, { ultimaCompra, valor2026, valor2025 });
      }
    });
  }

  console.log(`\nTotal de clientes distintos na lista base (SJC ∪ MG): ${clientesPorCodigo.size}`);

  const codigosExcluidos = carregarCodigosExcluidos();
  console.log(`Códigos a excluir (mala direta.xlsx + mala direta 2.xlsx): ${codigosExcluidos.size}`);
  const antesExclusao = clientesPorCodigo.size;
  for (const codigo of codigosExcluidos) clientesPorCodigo.delete(codigo);
  console.log(`Clientes da lista base após excluir os já usados: ${clientesPorCodigo.size} (removidos ${antesExclusao - clientesPorCodigo.size})`);

  const cortoInatividade = new Date();
  cortoInatividade.setMonth(cortoInatividade.getMonth() - MESES_INATIVIDADE);

  const candidatos = [...clientesPorCodigo.entries()]
    .map(([codigo, cliente]) => {
      const hist = historicoPorCodigo.get(codigo) ?? { ultimaCompra: null, valor2026: 0, valor2025: 0 };
      return { codigo, cliente, ultimaCompra: hist.ultimaCompra, valor2026: hist.valor2026, valor2025: hist.valor2025 };
    })
    .filter((c) => !c.ultimaCompra || c.ultimaCompra < cortoInatividade);

  console.log(`Clientes da lista base que estão inativos (sem comprar há ${MESES_INATIVIDADE}+ meses): ${candidatos.length}`);

  const semNenhumaCompra = candidatos.filter((c) => c.valor2026 <= 0 && c.valor2025 <= 0).length;
  console.log(`  Desses, sem nenhum valor comprado em 2026 nem 2025: ${semNenhumaCompra}`);

  // Ranqueia primeiro por valor 2026 (quem tem, fica na frente); entre os que não têm
  // valor em 2026, usa o valor de 2025 como critério — pedido do Willian pra completar
  // os 338 com quem foi bom cliente recentemente, mesmo sem compra em 2026.
  const top338 = candidatos
    .sort((a, b) => b.valor2026 - a.valor2026 || b.valor2025 - a.valor2025)
    .slice(0, QTD_ALVO);

  console.log(`\nSelecionados: ${top338.length} (pedido: ${QTD_ALVO})`);
  if (top338.length < QTD_ALVO) {
    console.log(`Aviso: só existem ${top338.length} clientes inativos na lista base — não dá pra completar ${QTD_ALVO}.`);
  }

  const sheetDados = top338.map((c) => ({
    "Código Cliente": c.cliente.COD_CLIENTE?.toString().trim() || "",
    "Cliente": c.cliente.CLIENTE?.toString().trim() || "",
    "Endereço": c.cliente.ENDERECO?.toString().trim() || "",
    "Número": c.cliente.NUMERO,
    "Complemento": c.cliente.COMPLEMENTO?.toString().trim() || "",
    "Bairro": c.cliente.BAIRRO?.toString().trim() || "",
    "Cidade": c.cliente.CIDADE?.toString().trim() || "",
    "Estado": c.cliente.ESTADO?.toString().trim() || "",
    "CEP": c.cliente.CEP?.toString().trim() || "",
    "Vendedor": c.cliente.REP_NOME?.toString().trim() || "",
    "Código Vendedor": c.cliente.REP_CODIGO,
    "Valor 2026 (R$)": Number(c.valor2026.toFixed(2)),
    "Valor 2025 (R$)": Number(c.valor2025.toFixed(2)),
    "Última Compra": c.ultimaCompra ? fmtData(c.ultimaCompra) : "Nunca comprou",
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetDados);
  ws["!cols"] = [
    { wch: 12 }, { wch: 40 }, { wch: 35 }, { wch: 10 }, { wch: 20 },
    { wch: 22 }, { wch: 25 }, { wch: 8 }, { wch: 12 }, { wch: 25 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Melhores Inativos");

  const outPath = path.join(os.homedir(), "Desktop", "Melhores_338_Clientes_Inativos_SJC_MG.xlsx");
  XLSX.writeFile(wb, outPath);

  console.log(`\nRelatório salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
