import "dotenv/config";
import { queryFirebird } from "./server/db/firebird";

async function cols(tabela: string) {
  const sql = `SELECT TRIM(RDB$FIELD_NAME) AS COLUNA FROM RDB$RELATION_FIELDS WHERE RDB$RELATION_NAME = '${tabela}' ORDER BY RDB$FIELD_POSITION`;
  const rows = await queryFirebird<any>("sjc", sql);
  console.log(`\n--- ${tabela} colunas ---`);
  console.log(rows.map(r=>r.COLUNA).join(", "));
}

async function main() {
  await cols("PRODUTOS_CFG_FILIAL");
  console.log("\n--- amostra PRODUTOS_CFG_FILIAL ---");
  console.log(await queryFirebird<any>("sjc", "SELECT FIRST 10 * FROM PRODUTOS_CFG_FILIAL"));

  console.log("\n--- distinct FILIAL em VW_CONSULTA_ESTOQUE_FILIAL (com timeout maior) ---");
  console.log(await queryFirebird<any>("sjc", "SELECT DISTINCT FILIAL FROM VW_CONSULTA_ESTOQUE_FILIAL"));
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
