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
