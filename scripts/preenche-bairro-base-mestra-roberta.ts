/**
 * Preenche a coluna "Bairro" (já existente, vazia) da planilha
 * "Base_Mestra_Roberta_707_com_63_pendentes_TI (2).xlsx", cruzando o "Código do
 * Cliente" com o cadastro (cli_bairro) nas bases SJC e MG. Não mexe em mais nada da
 * planilha — mesmas colunas, mesma ordem, mesmas duas abas.
 *
 * Rodar: npx tsx scripts/preenche-bairro-base-mestra-roberta.ts
 */
import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const ARQUIVO_ENTRADA = "C:/Users/willian.rubim/Documents/Base_Mestra_Roberta_707_com_63_pendentes_TI (2).xlsx";
const ABA_DADOS = "Base Mestra Roberta 707";

async function buscarBairros(loja: "sjc" | "mg", codigos: string[]): Promise<Map<string, string>> {
  const lista = codigos.map((c) => `'${c}'`).join(",");
  const rows = await queryFirebird<any>(loja, `select cli_codigo, cli_bairro from clientes where cli_codigo in (${lista})`);
  const mapa = new Map<string, string>();
  rows.forEach((r: any) => {
    const codigo = r.CLI_CODIGO?.toString().trim();
    const bairro = r.CLI_BAIRRO?.toString().trim();
    if (codigo && bairro) mapa.set(codigo, bairro);
  });
  return mapa;
}

async function main() {
  console.log("=== Preenchendo Bairro na Base Mestra Roberta (707) — SJC/MG ===\n");

  const wb = XLSX.readFile(ARQUIVO_ENTRADA);
  const ws = wb.Sheets[ABA_DADOS];
  const linhas = XLSX.utils.sheet_to_json<Record<string, any>>(ws);
  console.log(`Linhas na planilha: ${linhas.length}`);

  const codigos = linhas.map((l) => String(l["Código do Cliente"]).trim());

  const [bairrosSjc, bairrosMg] = await Promise.all([
    buscarBairros("sjc", codigos),
    buscarBairros("mg", codigos),
  ]);
  console.log(`Encontrados na SJC: ${bairrosSjc.size} | Encontrados na MG: ${bairrosMg.size}`);

  let preenchidos = 0;
  let conflitos = 0;
  let naoEncontrados = 0;

  const linhasAtualizadas = linhas.map((l) => {
    const codigo = String(l["Código do Cliente"]).trim();
    const bSjc = bairrosSjc.get(codigo);
    const bMg = bairrosMg.get(codigo);

    let bairro = "";
    if (bSjc && bMg) {
      if (bSjc.toUpperCase() !== bMg.toUpperCase()) {
        conflitos++;
        console.log(`  [conflito] Código ${codigo}: SJC="${bSjc}" x MG="${bMg}" — usando SJC`);
      }
      bairro = bSjc;
    } else if (bSjc) {
      bairro = bSjc;
    } else if (bMg) {
      bairro = bMg;
    } else {
      naoEncontrados++;
    }

    if (bairro) preenchidos++;

    return { ...l, "Bairro": bairro || l["Bairro"] || "" };
  });

  console.log(`\nBairro preenchido: ${preenchidos}/${linhas.length}`);
  console.log(`Não encontrados em nenhuma base: ${naoEncontrados}`);
  console.log(`Conflitos SJC x MG (bairro diferente para o mesmo código): ${conflitos}`);

  // Reconstrói o workbook preservando as duas abas originais, só trocando a de dados
  const colunas = Object.keys(linhas[0]);
  const wsNova = XLSX.utils.json_to_sheet(linhasAtualizadas, { header: colunas });
  wb.Sheets[ABA_DADOS] = wsNova;

  const outPath = path.join(os.homedir(), "Desktop", "Base_Mestra_Roberta_707_com_Bairro.xlsx");
  XLSX.writeFile(wb, outPath);

  console.log(`\nArquivo salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro:", err);
    process.exit(1);
  });
