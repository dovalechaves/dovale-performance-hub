import { getPool } from '../../db/sqlserver';

export async function ensureVendedorAtivoTable(): Promise<void> {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = 'TI-PAINELCOMISSAO_VENDEDOR_ATIVO'
    )
    CREATE TABLE [TI-PAINELCOMISSAO_VENDEDOR_ATIVO] (
      nome_vendedor VARCHAR(200) PRIMARY KEY,
      ativo BIT NOT NULL DEFAULT 1
    )
  `);
}

// Nomes de vendedores marcados como inativos (vale para todos os setores).
export async function getVendedoresInativos(): Promise<Set<string>> {
  await ensureVendedorAtivoTable();
  const pool = await getPool();
  const r = await pool.request().query(
    `SELECT nome_vendedor FROM [TI-PAINELCOMISSAO_VENDEDOR_ATIVO] WHERE ativo = 0`
  );
  return new Set(r.recordset.map((row: { nome_vendedor: string }) => row.nome_vendedor));
}
