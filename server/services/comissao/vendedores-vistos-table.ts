import { getPool } from '../../db/sqlserver';
import sql from 'mssql';

let _ensured = false;

async function ensureVendedoresVistosTable(): Promise<void> {
  if (_ensured) return;
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TI-PAINELCOMISSAO_VENDEDORES_VISTOS')
    CREATE TABLE [TI-PAINELCOMISSAO_VENDEDORES_VISTOS] (
      NOME_VENDEDOR VARCHAR(200) NOT NULL,
      SETOR         VARCHAR(100) NOT NULL,
      PRIMEIRA_VEZ  DATETIME NOT NULL DEFAULT GETDATE(),
      ULTIMA_VEZ    DATETIME NOT NULL DEFAULT GETDATE(),
      CONSTRAINT PK_VENDEDORES_VISTOS PRIMARY KEY (NOME_VENDEDOR, SETOR)
    )
  `);
  _ensured = true;
}

// Throttle em memória: no máximo 1 upsert por (ano, setor) a cada 10 min, já que várias
// rotas chamam getVendedoresPermitidos a cada request.
const REGISTRO_TTL_MS = 10 * 60 * 1000;
const _ultimoRegistro = new Map<string, number>();

async function upsertLote(setor: string, nomes: string[]): Promise<void> {
  await ensureVendedoresVistosTable();
  const pool = await getPool();
  for (const nome of nomes) {
    await pool.request()
      .input('nome', sql.VarChar, nome)
      .input('setor', sql.VarChar, setor)
      .query(`
        MERGE [TI-PAINELCOMISSAO_VENDEDORES_VISTOS] AS t
        USING (SELECT @nome AS NOME_VENDEDOR, @setor AS SETOR) AS s
        ON t.NOME_VENDEDOR = s.NOME_VENDEDOR AND t.SETOR = s.SETOR
        WHEN MATCHED THEN UPDATE SET ULTIMA_VEZ = GETDATE()
        WHEN NOT MATCHED THEN INSERT (NOME_VENDEDOR, SETOR) VALUES (s.NOME_VENDEDOR, s.SETOR);
      `);
  }
}

// Registra (soma, nunca substitui) os pares vendedor/setor vistos na leitura atual de
// vendas. Fire-and-forget: nunca lança e nunca é aguardada pelo caller — uma falha aqui
// não pode derrubar a rota que a chamou, só significa que o histórico não cresce agora.
export function registrarVendedoresVistos(ano: number, pares: { nome: string; setor: string }[]): void {
  const porSetor = new Map<string, Set<string>>();
  pares.forEach(({ nome, setor }) => {
    if (!nome || !setor) return;
    if (!porSetor.has(setor)) porSetor.set(setor, new Set());
    porSetor.get(setor)!.add(nome);
  });

  porSetor.forEach((nomes, setor) => {
    const chave = `${ano}:${setor}`;
    if (Date.now() - (_ultimoRegistro.get(chave) ?? 0) < REGISTRO_TTL_MS) return;
    _ultimoRegistro.set(chave, Date.now());
    void upsertLote(setor, [...nomes]).catch((err) =>
      console.error('[vendedores-vistos] upsert:', (err as Error)?.message ?? err)
    );
  });
}

// União histórica: todo vendedor já visto nesses setores, independente de a fonte de
// vendas atual estar disponível ou não. Nunca lança — falha aqui não pode reduzir o
// que a leitura atual já tinha.
export async function getVendedoresVistosPorSetor(setores: string[]): Promise<Set<string>> {
  if (!setores.length) return new Set();
  try {
    await ensureVendedoresVistosTable();
    const pool = await getPool();
    const request = pool.request();
    const placeholders = setores
      .map((s, i) => {
        request.input(`s${i}`, sql.VarChar, s);
        return `@s${i}`;
      })
      .join(', ');
    const res = await request.query(
      `SELECT DISTINCT NOME_VENDEDOR FROM [TI-PAINELCOMISSAO_VENDEDORES_VISTOS] WHERE SETOR IN (${placeholders})`
    );
    return new Set(res.recordset.map((row: { NOME_VENDEDOR: string }) => row.NOME_VENDEDOR));
  } catch (err) {
    console.error('[vendedores-vistos] consulta:', (err as Error)?.message ?? err);
    return new Set();
  }
}
