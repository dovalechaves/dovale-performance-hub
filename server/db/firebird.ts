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
  campinas: {
    host: process.env.DB_FIREBIRD_CAMPINAS_HOST!,
    port: Number(process.env.DB_FIREBIRD_CAMPINAS_PORT) || 3050,
    database: process.env.DB_FIREBIRD_CAMPINAS_PATH!,
    user: process.env.DB_FIREBIRD_CAMPINAS_USER!,
    password: process.env.DB_FIREBIRD_CAMPINAS_PASSWORD!,
  },
  riopreto: {
    host: process.env.DB_FIREBIRD_RIOPRETO_HOST!,
    port: Number(process.env.DB_FIREBIRD_RIOPRETO_PORT) || 3050,
    database: process.env.DB_FIREBIRD_RIOPRETO_PATH!,
    user: process.env.DB_FIREBIRD_RIOPRETO_USER!,
    password: process.env.DB_FIREBIRD_RIOPRETO_PASSWORD!,
  },
  sjc: {
    host: process.env.DB_FIREBIRD_SJC_HOST || process.env.DB_FIREBIRD_ECOMMERCE_HOST!,
    port: Number(process.env.DB_FIREBIRD_SJC_PORT || process.env.DB_FIREBIRD_ECOMMERCE_PORT) || 3050,
    database: process.env.DB_FIREBIRD_SJC_PATH || process.env.DB_FIREBIRD_ECOMMERCE_PATH!,
    user: process.env.DB_FIREBIRD_SJC_USER || process.env.DB_FIREBIRD_ECOMMERCE_USER!,
    password: process.env.DB_FIREBIRD_SJC_PASSWORD || process.env.DB_FIREBIRD_ECOMMERCE_PASSWORD!,
  },
  mg: {
    host: process.env.DB_FIREBIRD_MG_HOST || process.env.DB_FIREBIRD_SPM_HOST || process.env.DB_FIREBIRD_ECOMMERCE_HOST!,
    port: Number(process.env.DB_FIREBIRD_MG_PORT || process.env.DB_FIREBIRD_SPM_PORT || process.env.DB_FIREBIRD_ECOMMERCE_PORT) || 3050,
    database: process.env.DB_FIREBIRD_MG_PATH || process.env.DB_FIREBIRD_SPM_PATH!,
    user: process.env.DB_FIREBIRD_MG_USER || process.env.DB_FIREBIRD_SPM_USER || process.env.DB_FIREBIRD_ECOMMERCE_USER!,
    password: process.env.DB_FIREBIRD_MG_PASSWORD || process.env.DB_FIREBIRD_SPM_PASSWORD || process.env.DB_FIREBIRD_ECOMMERCE_PASSWORD!,
  },
};

export function queryFirebird<T = Record<string, unknown>>(
  loja: keyof typeof lojas,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const config = lojas[loja];
  console.log(`[firebird] ${loja} config: host=${config.host}, db=${config.database}`);
  if (!config.host || !config.database) {
    console.error(`[firebird] ${loja} NOT CONFIGURED — host or database missing`);
    return Promise.reject(new Error(`Loja "${loja}" não configurada no .env`));
  }

  return new Promise((resolve, reject) => {
    Firebird.attach(config, (err, db) => {
      if (err) {
        console.error(`[firebird] ${loja} attach FAILED:`, err.message);
        return reject(err);
      }
      db.transaction(Firebird.ISOLATION_READ_COMMITTED, (err2, transaction) => {
        if (err2) { db.detach(); console.error(`[firebird] ${loja} transaction FAILED:`, err2.message); return reject(err2); }
        transaction.query(sql, params, (err3, result) => {
          transaction.commit(() => db.detach());
          if (err3) {
            console.error(`[firebird] ${loja} query FAILED:`, err3.message);
            return reject(err3);
          }
          const rows = (result as T[]) || [];
          console.log(`[firebird] ${loja} query OK: ${rows.length} rows`);
          resolve(rows);
        });
      });
    });
  });
}

export const firebirdLojas = Object.keys(lojas) as (keyof typeof lojas)[];
