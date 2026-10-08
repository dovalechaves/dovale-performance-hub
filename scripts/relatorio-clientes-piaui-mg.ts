/**
 * Relatório: cadastro de todos os clientes do Piauí (PI) — base MG.
 * Campos: código, razão social, telefone (COALESCE whatsapp/fone/celular), UF, município, rua, número, bairro.
 * UF/município vêm de municipios (cli_mun_codigo); cli_estado é usado como fallback quando o município não tem UF.
 *
 * Rodar: npx tsx scripts/relatorio-clientes-piaui-mg.ts
 */
import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

async function main() {
  const rows = await queryFirebird<any>(
    "mg",
    `
    select c.cli_codigo, c.cli_nome,
           COALESCE(c.cli_whatsapp, c.cli_fone, c.cli_celular, 0) as telefone,
           COALESCE(m.mun_uf, c.cli_estado) as uf,
           m.mun_nome as municipio,
           c.cli_endereco as rua, c.cli_numeroimovel as numero, c.cli_bairro as bairro
    from clientes c
    left join municipios m on m.mun_codigo = c.cli_mun_codigo
    where COALESCE(m.mun_uf, c.cli_estado) = 'PI'
    order by m.mun_nome, c.cli_nome
  `,
  );

  const t = (v: any) => (v ?? "").toString().trim();
  const dados = rows.map((r) => ({
    "Código": t(r.CLI_CODIGO),
    "Razão Social": t(r.CLI_NOME),
    "Telefone": t(r.TELEFONE) === "0" ? "" : t(r.TELEFONE),
    "UF": t(r.UF),
    "Município": t(r.MUNICIPIO),
    "Rua": t(r.RUA),
    "Número": t(r.NUMERO),
    "Bairro": t(r.BAIRRO),
  }));

  const ws = XLSX.utils.json_to_sheet(dados);
  ws["!cols"] = [{ wch: 10 }, { wch: 45 }, { wch: 16 }, { wch: 5 }, { wch: 25 }, { wch: 40 }, { wch: 10 }, { wch: 25 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Clientes PI");
  const outPath = path.join(os.homedir(), "Desktop", "Clientes_Piaui_MG.xlsx");
  XLSX.writeFile(wb, outPath);

  console.log(`${dados.length} clientes do PI. Sem telefone: ${dados.filter((d) => !d["Telefone"]).length}`);
  console.log(`Relatório salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
