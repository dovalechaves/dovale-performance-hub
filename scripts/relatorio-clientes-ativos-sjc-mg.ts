/**
 * Relatório: clientes ativos (SJC + MG) — mesma consulta enviada pelo Willian, sem alterar
 * nenhuma coluna nem nenhuma condição do WHERE original. Único acréscimo: exigir que o
 * cliente tenha pedido nos últimos 6 meses e que esse pedido não esteja cancelado
 * (pdv_psi_codigo NOT IN ('CC')), usando o filtro padrão de "venda real" do projeto
 * (pdv_tve_codigo NOT IN ('6','7','26','34')).
 *
 * Roda a mesma query nas duas bases (SJC e MG) e junta o resultado sem duplicar cliente
 * (dedupe por cli_codigo).
 *
 * Rodar: npx tsx scripts/relatorio-clientes-ativos-sjc-mg.ts
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

const MUNICIPIOS_EXCLUIDOS = [
  3549805, 3136702, 1501402, 1500800, 5208707, 5220454, 5208806, 5214507, 5209200, 5201801,
  5200050, 5200100, 5200308, 5221193, 5201405, 5201108, 3555408, 3554104, 3550706, 3549906,
  3546407, 3545805, 3530607, 3526901, 3524403, 3518304, 3513404, 3510608, 3508701, 3506804,
  3506358, 3503701, 3509502, 3171002, 3170702, 3169308, 3168706, 3167205, 3161607, 3161108,
  3154004, 3150807, 3149103, 3147007, 3146102, 3144806, 3141209, 3139905, 3139102, 3138203,
  3137801, 3136207, 3133808, 3131307, 3130300, 3127701, 3126604, 3124500, 3118601, 3118302,
  3112405, 3112306, 3112207, 3111506, 3110804, 3107108, 3106705, 3106200, 3103701, 3102208,
  3549904, 3524402, 3503901, 3546009, 3506359, 3508504, 3513405, 3550704, 3554102, 3171204,
  3137601, 3153608, 3167202, 3140704, 3129806, 3101607, 3169307, 3170701, 3101804, 3500501,
  3500600, 3501608, 3501905, 3503307, 3509205, 3509601, 3510401, 3511706, 3512209, 3512704,
  3514908, 3519071, 3520509, 3521408, 3522604, 3523404, 3523909, 3524709, 3525201, 3525904,
  3526704, 3526902, 3527009, 3530706, 3530805, 3531803, 3532009, 3538709, 3544004, 3545159,
  3545209, 3545803, 3549102, 3550407, 3552106, 3556206, 3556503, 3556701,
];

const REP_CODIGOS_EXCLUIDOS = [172, 11, 1664, 944, 29, 70, 674, 949, 515, 1133, 917, 729, 1863];

function sqlClientesAtivos() {
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
    and c.cli_rep_codigo not in (${REP_CODIGOS_EXCLUIDOS.join(",")})
    and c.cli_ind_maladireta = '1'
    and c.cli_cliente = '1'
    and r.rep_rvs_codigo in (1,16)
    and r.rep_nome not like '%DISTRIBUIDOR%'
    and m.mun_uf not in ('PR','SE')
    and m.mun_codigo not in (${MUNICIPIOS_EXCLUIDOS.join(",\n    ")})
    and exists (
      select 1 from pedidos_vendas p
      where p.pdv_cli_codigo = c.cli_codigo
        and p.pdv_data >= DATEADD(MONTH, -6, CURRENT_DATE)
        and p.pdv_psi_codigo not in ('CC')
        and p.pdv_tve_codigo not in ('6','7','26','34')
    )
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

async function main() {
  console.log("=== Relatório: Clientes ativos (pedido nos últimos 6 meses, não cancelado) — SJC/MG ===\n");

  const registros = new Map<string, ClienteRow>();

  for (const base of BASES) {
    console.log(`Consultando base ${base.nome}...`);
    const rows = await queryFirebird<ClienteRow>(base.lojaKey, sqlClientesAtivos());
    console.log(`  ${rows.length} clientes ativos na base ${base.nome}`);

    for (const row of rows) {
      const codigo = row.COD_CLIENTE?.toString().trim() || "";
      if (!codigo) continue;
      if (!registros.has(codigo)) registros.set(codigo, row);
    }
  }

  console.log(`\nTotal de clientes ativos únicos (SJC ∪ MG): ${registros.size}`);

  const lista = Array.from(registros.values()).sort((a, b) =>
    (a.COD_CLIENTE?.toString() || "").localeCompare(b.COD_CLIENTE?.toString() || "", undefined, { numeric: true })
  );

  const sheetDados = lista.map((r) => ({
    "Código Cliente": r.COD_CLIENTE,
    "Cliente": r.CLIENTE,
    "Endereço": r.ENDERECO,
    "Número": r.NUMERO,
    "Complemento": r.COMPLEMENTO,
    "Bairro": r.BAIRRO,
    "Cidade": r.CIDADE,
    "Estado": r.ESTADO,
    "CEP": r.CEP,
    "Vendedor": r.REP_NOME,
    "Código Vendedor": r.REP_CODIGO,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetDados);
  ws["!cols"] = [
    { wch: 12 }, { wch: 40 }, { wch: 35 }, { wch: 10 }, { wch: 20 },
    { wch: 22 }, { wch: 25 }, { wch: 8 }, { wch: 12 }, { wch: 25 }, { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Clientes ativos");

  const fileName = `Clientes_Ativos_SJC_MG.xlsx`;
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
