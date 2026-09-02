/**
 * Relatório: clientes da base MG atendidos por representante(s) "Polyfort".
 * Critério: o representante principal (cli_rep_codigo) OU o secundário (cli_rep_secundario)
 * do cadastro do cliente tem "POLYFORT" no nome (ex.: "POLYFORT", "POLYFORTE VANESSA VAZ", etc).
 *
 * Colunas: código, razão social, endereço, bairro, cidade/UF, WhatsApp (coalesce whatsapp/fone/celular),
 * CPF/CNPJ, ramo de atividade do cadastro (proxy interno de CNAE — ver nota no console).
 *
 * Rodar: npx tsx scripts/relatorio-clientes-polyfort-mg.ts
 */
import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

function sql() {
  return `
    SELECT c.cli_codigo, c.cli_nome, c.cli_pessoa, c.cli_cnpj,
      c.cli_endereco, c.cli_bairro, m.mun_nome, m.mun_uf,
      COALESCE(c.cli_whatsapp, c.cli_fone, c.cli_celular, 0) AS numero,
      ea.eta_descricao,
      r1.rep_nome AS rep_primario,
      r2.rep_nome AS rep_secundario
    FROM clientes c
    LEFT JOIN municipios m ON m.mun_codigo = c.cli_mun_codigo
    LEFT JOIN entidades_atividades ea ON ea.eta_codigo = c.cli_eta_codigo
    LEFT JOIN representantes r1 ON r1.rep_codigo = c.cli_rep_codigo
    LEFT JOIN representantes r2 ON r2.rep_codigo = c.cli_rep_secundario
    WHERE UPPER(COALESCE(r1.rep_nome, '')) LIKE '%POLYFORT%'
       OR UPPER(COALESCE(r2.rep_nome, '')) LIKE '%POLYFORT%'
    ORDER BY c.cli_codigo
  `;
}

async function main() {
  console.log("=== Relatório: Clientes Polyfort — base MG ===\n");
  console.log("Nota: não existe CNAE oficial (Receita Federal) armazenado no cadastro do cliente");
  console.log("(a tabela que teria esse campo — CLIENTES_SERASA_INFATIV — está vazia na base MG).");
  console.log("Uso como proxy o \"ramo de atividade\" do próprio cadastro Microsys (CLI_ETA_CODIGO),");
  console.log("que já classifica direto como CHAVEIRO / FERRAGISTA / SERRALHEIRO quando aplicável.\n");

  const rows = await queryFirebird<any>("mg", sql());
  console.log(`${rows.length} clientes encontrados\n`);

  const sheet = rows.map((r) => ({
    "Código": r.CLI_CODIGO?.toString().trim() || "",
    "Razão Social": r.CLI_NOME?.toString().trim() || "",
    "Endereço": r.CLI_ENDERECO?.toString().trim() || "",
    "Bairro": r.CLI_BAIRRO?.toString().trim() || "",
    "Cidade": r.MUN_NOME?.toString().trim() || "",
    "UF": r.MUN_UF?.toString().trim() || "",
    "WhatsApp": r.NUMERO,
    "CPF/CNPJ": r.CLI_CNPJ?.toString().trim() || "",
    "Pessoa (F/J)": r.CLI_PESSOA?.toString().trim() || "",
    "Ramo de Atividade (proxy CNAE)": r.ETA_DESCRICAO?.toString().trim() || "",
    "Representante Principal": r.REP_PRIMARIO?.toString().trim() || "",
    "Representante Secundário": r.REP_SECUNDARIO?.toString().trim() || "",
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheet);
  ws["!cols"] = [
    { wch: 10 }, { wch: 42 }, { wch: 30 }, { wch: 18 }, { wch: 20 }, { wch: 6 },
    { wch: 18 }, { wch: 20 }, { wch: 10 }, { wch: 24 }, { wch: 26 }, { wch: 26 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Clientes Polyfort MG");

  const outPath = path.join(os.homedir(), "Desktop", "Clientes_Polyfort_MG.xlsx");
  XLSX.writeFile(wb, outPath);
  console.log(`Relatório salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
