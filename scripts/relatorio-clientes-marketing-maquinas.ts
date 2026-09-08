/**
 * Relatório: clientes do representante MARKETING (cli_rep_codigo = 949) que compraram
 * as máquinas (pro_codigo) 79220, 79225, 77041, 77042, em 2025/2026 — bases SJC e MG.
 *
 * Colunas: Código, Razão Social, Cidade, UF, Telefone
 * (COALESCE(c.cli_whatsapp, c.cli_fone, c.cli_celular, 0)).
 *
 * Padrão de venda real do projeto: pdv_psi_codigo NOT IN ('CC') e
 * pdv_tve_codigo NOT IN ('6','7','26','34').
 *
 * Rodar: npx tsx scripts/relatorio-clientes-marketing-maquinas.ts
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

const REP_CODIGO = 949;
const CODIGOS_MAQUINA = ["79220", "79225", "77041", "77042"];

function sqlClientesMarketing() {
  return `
    select distinct
      c.cli_codigo as cod,
      c.cli_nome as razao,
      m.mun_nome as cidade,
      m.mun_uf as uf,
      COALESCE(c.cli_whatsapp, c.cli_fone, c.cli_celular, 0) AS cli_whatsapp
    from clientes c
    inner join municipios m on m.mun_codigo = c.cli_mun_codigo
    inner join pedidos_vendas ped on ped.pdv_cli_codigo = c.cli_codigo
    inner join pedidos_vendas_itens i on i.pvi_numero = ped.pdv_numero
    where c.cli_rep_codigo = ${REP_CODIGO}
    and i.pvi_pro_codigo in (${CODIGOS_MAQUINA.map((c) => `'${c}'`).join(",")})
    and extract(year from ped.pdv_data) in (2025,2026)
    and ped.pdv_psi_codigo not in ('CC')
    and ped.pdv_tve_codigo not in ('6','7','26','34')
  `;
}

interface ClienteRow {
  COD: any;
  RAZAO: any;
  CIDADE: any;
  UF: any;
  CLI_WHATSAPP: any;
}

async function main() {
  console.log("=== Clientes Marketing (rep 949) que compraram máquinas — 2025/2026 — SJC/MG ===\n");

  const linhas: { base: string; row: ClienteRow }[] = [];

  for (const base of BASES) {
    console.log(`Consultando base ${base.nome}...`);
    const rows = await queryFirebird<ClienteRow>(base.lojaKey, sqlClientesMarketing());
    console.log(`  ${rows.length} clientes encontrados`);
    rows.forEach((row) => linhas.push({ base: base.nome, row }));
  }

  console.log(`\nTotal de linhas: ${linhas.length}`);

  const sheetDados = linhas.map(({ base, row }) => ({
    "Base": base,
    "Código": row.COD?.toString().trim() || "",
    "Razão Social": row.RAZAO?.toString().trim() || "",
    "Cidade": row.CIDADE?.toString().trim() || "",
    "UF": row.UF?.toString().trim() || "",
    "Telefone": row.CLI_WHATSAPP,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetDados);
  ws["!cols"] = [{ wch: 8 }, { wch: 12 }, { wch: 42 }, { wch: 25 }, { wch: 6 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws, "Clientes Marketing Máquinas");

  const outPath = path.join(os.homedir(), "Desktop", "Clientes_Marketing_Maquinas_2025_2026.xlsx");
  XLSX.writeFile(wb, outPath);

  console.log(`\nRelatório salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
