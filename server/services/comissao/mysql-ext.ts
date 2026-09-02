import mysql from 'mysql2/promise';
import { CONNECT_TIMEOUT_MS, QUERY_TIMEOUT_MS, ErroFonteExterna } from './timeouts';

export interface MySQLExtOptions {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export async function queryMySQL(
  opts: MySQLExtOptions,
  sql: string,
): Promise<Record<string, unknown>[]> {
  if (!opts.host || !opts.database) {
    throw new ErroFonteExterna('host/database não configurados', 'conexao');
  }

  let conn: mysql.Connection;
  try {
    conn = await mysql.createConnection({ ...opts, connectTimeout: CONNECT_TIMEOUT_MS });
  } catch (err) {
    throw new ErroFonteExterna(
      `falha ao conectar em ${opts.host}:${opts.port} — ${(err as Error).message}`, 'conexao',
    );
  }

  let timer: NodeJS.Timeout | undefined;
  try {
    const limite = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        conn.destroy(); // aborta a consulta em curso
        reject(new ErroFonteExterna(
          `consulta em ${opts.host} excedeu ${QUERY_TIMEOUT_MS}ms`, 'consulta',
        ));
      }, QUERY_TIMEOUT_MS);
    });
    const [rows] = await Promise.race([conn.execute(sql), limite]);
    return rows as unknown as Record<string, unknown>[];
  } catch (err) {
    if (err instanceof ErroFonteExterna) throw err;
    throw new ErroFonteExterna(
      `consulta em ${opts.host} falhou — ${(err as Error).message}`, 'consulta',
    );
  } finally {
    if (timer) clearTimeout(timer);
    try { await conn.end(); } catch { /* conexão já derrubada pelo timeout */ }
  }
}
