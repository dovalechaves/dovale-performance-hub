import mysql from 'mysql2/promise';

export interface MySQLExtOptions {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export async function queryMySQL(opts: MySQLExtOptions, sql: string): Promise<Record<string, unknown>[]> {
  const conn = await mysql.createConnection(opts);
  try {
    const [rows] = await conn.execute(sql);
    return rows as Record<string, unknown>[];
  } finally {
    await conn.end();
  }
}
