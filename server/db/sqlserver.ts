import sql from "mssql";

const config: sql.config = {
  server: process.env.DB_SQLSERVER_HOST!,
  port: Number(process.env.DB_SQLSERVER_PORT) || 1433,
  user: process.env.DB_SQLSERVER_USER!,
  password: process.env.DB_SQLSERVER_PASSWORD!,
  database: process.env.DB_SQLSERVER_NAME!,
  options: {
    trustServerCertificate: true,
    encrypt: false,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool: sql.ConnectionPool | null = null;

export async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool || !pool.connected) {
    pool = await new sql.ConnectionPool(config).connect();
  }
  return pool;
}

export async function querySqlServer<T = Record<string, unknown>>(
  query: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const p = await getPool();
  const request = p.request();
  for (const [key, value] of Object.entries(params)) {
    request.input(key, value);
  }
  const result = await request.query(query);
  return result.recordset as T[];
}
