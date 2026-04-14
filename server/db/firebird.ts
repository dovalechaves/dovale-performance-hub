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
  fast: {
    host: process.env.DB_FIREBIRD_FAST_HOST!,
    port: Number(process.env.DB_FIREBIRD_FAST_PORT) || 3050,
    database: process.env.DB_FIREBIRD_FAST_PATH!,
    user: process.env.DB_FIREBIRD_FAST_USER!,
    password: process.env.DB_FIREBIRD_FAST_PASSWORD!,
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
      db.transaction(Firebird.ISOLATION_READ_COMMITTED, (err2, transaction) => {
        if (err2) { db.detach(); return reject(err2); }
        transaction.query(sql, params, (err3, result) => {
          transaction.commit(() => db.detach());
          if (err3) return reject(err3);
          resolve(result as T[]);
        });
      });
    });
  });
}

export const firebirdLojas = Object.keys(lojas) as (keyof typeof lojas)[];
