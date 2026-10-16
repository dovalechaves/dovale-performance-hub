import { getPool } from '../../db/sqlserver';

let _ensured = false;

// Tabelas de configuração do setor E-COMMERCE (SQL Server do Hub).
// - METAS: uma linha por mês, valida para o setor inteiro (as vendedoras dividem a comissão).
// - BONUS_FAIXAS: bônus por plataforma conforme o crescimento sobre o mês anterior.
//   Guardado por mês; um mês sem faixas herda as do mês mais recente que tenha (ver ecommerce.ts).
// - VENDEDORAS: lista de quem divide a comissão do setor (nome = nome_vendedor do usuário no Hub).
export async function ensureEcommerceTables(): Promise<void> {
  if (_ensured) return;
  const pool = await getPool();

  await Promise.all([
    pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TI-PAINELCOMISSAO_ECOMMERCE_METAS')
      CREATE TABLE [TI-PAINELCOMISSAO_ECOMMERCE_METAS] (
        ID INT IDENTITY(1,1) PRIMARY KEY,
        ANO INT NOT NULL,
        MES INT NOT NULL,
        META1_VALOR FLOAT DEFAULT 0,
        META1_PERCENTUAL FLOAT DEFAULT 0,
        META2_VALOR FLOAT DEFAULT 0,
        META2_PERCENTUAL FLOAT DEFAULT 0,
        META3_VALOR FLOAT DEFAULT 0,
        META3_PERCENTUAL FLOAT DEFAULT 0,
        PERCENTUAL_SEM_META FLOAT DEFAULT 0.25
      )
    `),
    pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TI-PAINELCOMISSAO_ECOMMERCE_BONUS_FAIXAS')
      CREATE TABLE [TI-PAINELCOMISSAO_ECOMMERCE_BONUS_FAIXAS] (
        ID INT IDENTITY(1,1) PRIMARY KEY,
        ANO INT NOT NULL,
        MES INT NOT NULL,
        CRESC_MIN FLOAT NOT NULL,
        VALOR FLOAT NOT NULL
      )
    `),
    pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TI-PAINELCOMISSAO_ECOMMERCE_VENDEDORAS')
      BEGIN
        CREATE TABLE [TI-PAINELCOMISSAO_ECOMMERCE_VENDEDORAS] (
          NOME VARCHAR(150) NOT NULL PRIMARY KEY,
          ATIVO BIT NOT NULL DEFAULT 1
        );
        INSERT INTO [TI-PAINELCOMISSAO_ECOMMERCE_VENDEDORAS] (NOME, ATIVO) VALUES ('ANDREZA', 1), ('FERNANDA', 1);
      END
    `),
  ]);

  _ensured = true;
}
