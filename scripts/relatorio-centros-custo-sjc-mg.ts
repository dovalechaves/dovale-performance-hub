/**
 * Relatório: Centros de custo (tabela DEPARTAMENTOS no ERP Microsys) — bases SJC e MG.
 * DEP_IND_ATIVO: 0 = inativo, 1 = ativo.
 *
 * Rodar: npx tsx scripts/relatorio-centros-custo-sjc-mg.ts
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

interface DepartamentoRow {
  DEP_CODIGO: any;
  DEP_NOME: any;
  DEP_IND_ATIVO: any;
  EMP_FIL_CODIGO: any;
  DEP_TIPO: any;
  DEP_NM_PESSOAS: any;
  DEP_COD_CONTABIL: any;
}

function sqlDepartamentos() {
  return `
    SELECT dep_codigo, dep_nome, dep_ind_ativo, emp_fil_codigo, dep_tipo, dep_nm_pessoas, dep_cod_contabil
    FROM departamentos
    ORDER BY dep_ind_ativo DESC, dep_codigo
  `;
}

async function main() {
  console.log("=== Relatório Centros de Custo (DEPARTAMENTOS) — SJC/MG ===\n");

  const linhas: Record<string, any>[] = [];

  for (const base of BASES) {
    console.log(`Consultando base ${base.nome}...`);
    const rows = await queryFirebird<DepartamentoRow>(base.lojaKey, sqlDepartamentos());
    console.log(`  ${rows.length} centros de custo na base ${base.nome}`);

    for (const row of rows) {
      linhas.push({
        "Base": base.nome,
        "Código": Number(row.DEP_CODIGO),
        "Nome": row.DEP_NOME?.toString().trim() || "",
        "Situação": Number(row.DEP_IND_ATIVO) === 1 ? "Ativo" : "Inativo",
        "Filial": row.EMP_FIL_CODIGO?.toString().trim() || "",
        "Tipo": row.DEP_TIPO?.toString().trim() || "",
        "Nº Pessoas": row.DEP_NM_PESSOAS != null ? Number(row.DEP_NM_PESSOAS) : "",
        "Cód. Contábil": row.DEP_COD_CONTABIL?.toString().trim() || "",
      });
    }
  }

  const totalAtivos = linhas.filter((l) => l["Situação"] === "Ativo").length;
  console.log(`\nTotal de centros de custo: ${linhas.length} (${totalAtivos} ativos, ${linhas.length - totalAtivos} inativos)`);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), "Centros de Custo");

  const fileName = `Relatorio_Centros_Custo_SJC_MG.xlsx`;
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
