import Firebird from "node-firebird";

export interface FirebirdConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

const lojas: Record<string, FirebirdConfig> = {
  bh: {
    host: process.env.DB_FIREBIRD_BH_HOST!,
    port: Number(process.env.DB_FIREBIRD_BH_PORT) || 3050,
    database: process.env.DB_FIREBIRD_BH_PATH!,
    user: process.env.DB_FIREBIRD_BH_USER!,
    password: process.env.DB_FIREBIRD_BH_PASSWORD!,
  },
  l2: {
    host: process.env.DB_FIREBIRD_L2_HOST!,
    port: Number(process.env.DB_FIREBIRD_L2_PORT) || 3050,
    database: process.env.DB_FIREBIRD_L2_PATH!,
    user: process.env.DB_FIREBIRD_L2_USER!,
    password: process.env.DB_FIREBIRD_L2_PASSWORD!,
  },
  l3: {
    host: process.env.DB_FIREBIRD_L3_HOST!,
    port: Number(process.env.DB_FIREBIRD_L3_PORT) || 3050,
    database: process.env.DB_FIREBIRD_L3_PATH!,
    user: process.env.DB_FIREBIRD_L3_USER!,
    password: process.env.DB_FIREBIRD_L3_PASSWORD!,
  },
};

export function queryFirebird<T = Record<string, unknown>>(
  loja: keyof typeof lojas,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const config = lojas[loja];
  if (!config.host || !config.database) {
    return Promise.reject(new Error(`Loja "${loja}" não configurada no .env`));
  }

  return new Promise((resolve, reject) => {
    Firebird.attach(config, (err, db) => {
      if (err) return reject(err);
      db.query(sql, params, (err2, result) => {
        db.detach();
        if (err2) return reject(err2);
        resolve(result as T[]);
      });
    });
  });
}

export const firebirdLojas = Object.keys(lojas) as (keyof typeof lojas)[];
