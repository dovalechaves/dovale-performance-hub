import "dotenv/config";
import { getPool } from "../server/db/sqlserver";

async function main() {
  const pool = await getPool();
  const r = await pool.request().query(
    `DELETE FROM dbo.MARGEM_LOJAS_PRECO_CHAVE WHERE preco = 0`
  );
  console.log(`Removidas ${r.rowsAffected[0]} linha(s) com preço 0.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
