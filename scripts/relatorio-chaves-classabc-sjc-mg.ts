/**
 * Relatório: quantidade de PRODUTOS "chave" (produtos.pro_nivel2 = 1)
 * cadastrados em cada classe ABC (produtos.pro_classabc, grupos A/B/C/D) —
 * bases SJC e MG.
 *
 * "Quantidade" aqui é contagem de produtos distintos no cadastro (não saldo
 * em estoque) — contada separadamente em cada base, porque a classe de um
 * mesmo código pode divergir levemente entre SJC e MG (confirmado: SJC
 * A=73/B=52/C=68/D=65, MG A=73/B=52/C=66/D=65).
 *
 * Rodar: npx tsx scripts/relatorio-chaves-classabc-sjc-mg.ts
 */
import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const CLASSES = ["A", "B", "C", "D"];

interface ContagemRow {
  CLASSE: any;
  TOTAL: any;
}

function sqlContagemPorClasse() {
  return `
    SELECT TRIM(pro_classabc) AS classe, COUNT(*) AS total
    FROM produtos
    WHERE pro_nivel2 = 1 AND TRIM(pro_classabc) IN (${CLASSES.map((c) => `'${c}'`).join(",")})
    GROUP BY 1
  `;
}

async function main() {
  console.log("=== Quantidade de produtos CHAVE por Classe ABC — SJC/MG ===\n");

  console.log("Consultando SJC...");
  const contagemSjc = await queryFirebird<ContagemRow>("sjc", sqlContagemPorClasse());
  const mapaSjc = new Map(contagemSjc.map((r) => [String(r.CLASSE).trim(), Number(r.TOTAL) || 0]));
  console.log(" ", contagemSjc);

  console.log("Consultando MG...");
  const contagemMg = await queryFirebird<ContagemRow>("mg", sqlContagemPorClasse());
  const mapaMg = new Map(contagemMg.map((r) => [String(r.CLASSE).trim(), Number(r.TOTAL) || 0]));
  console.log(" ", contagemMg);

  const sheet = CLASSES.map((classe) => ({
    "Classe": classe,
    "Qtde SJC": mapaSjc.get(classe) || 0,
    "Qtde MG": mapaMg.get(classe) || 0,
  }));

  console.log("\nResultado:");
  console.table(sheet);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheet);
  ws["!cols"] = [{ wch: 10 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, "Qtde Chaves por Classe");

  const fileName = `Relatorio_Chaves_ClasseABC_SJC_MG.xlsx`;
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
