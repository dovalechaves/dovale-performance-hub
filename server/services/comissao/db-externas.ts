import type { FirebirdOptions } from './firebird';
import type { MySQLExtOptions } from './mysql-ext';

function env(...nomes: string[]): string {
  for (const nome of nomes) {
    const valor = process.env[nome];
    if (valor && valor.trim()) return valor.trim();
  }
  return '';
}

function envInt(padrao: number, ...nomes: string[]): number {
  const valor = env(...nomes);
  const parsed = Number.parseInt(valor, 10);
  return Number.isFinite(parsed) ? parsed : padrao;
}

function firebirdTarget(nome: string): { host: string; database: string; emp?: string } | null {
  const target = (process.env.TARGET_DBS || '')
    .split(',')
    .map((parte) => parte.trim())
    .find((parte) => parte.toUpperCase().startsWith(`${nome.toUpperCase()}|`));

  if (!target) return null;
  const [, caminho, emp] = target.split('|');
  const sep = caminho.indexOf(':');
  if (sep <= 0) return null;

  return {
    host: caminho.slice(0, sep),
    database: caminho.slice(sep + 1),
    emp,
  };
}

const targetLockeySP = firebirdTarget('LockeySP');
const targetLockeyMG = firebirdTarget('LockeyMG');

export const fbSJC: FirebirdOptions = {
  host: env('DB_SJC_HOST', 'DB_FIREBIRD_SJC_HOST', 'DB_FIREBIRD_ECOMMERCE_HOST'),
  port: envInt(3050, 'DB_SJC_PORT', 'DB_FIREBIRD_SJC_PORT', 'DB_FIREBIRD_ECOMMERCE_PORT'),
  database: env('DB_SJC_DATABASE', 'DB_FIREBIRD_SJC_PATH', 'DB_FIREBIRD_ECOMMERCE_PATH'),
  user: env('DB_SJC_USER', 'DB_FIREBIRD_SJC_USER', 'DB_FIREBIRD_ECOMMERCE_USER', 'DB_USER', 'FB_USER') || 'SYSDBA',
  password: env('DB_SJC_PASSWORD', 'DB_FIREBIRD_SJC_PASSWORD', 'DB_FIREBIRD_ECOMMERCE_PASSWORD', 'DB_PASSWORD', 'FB_PASSWORD') || 'masterkey',
};

// SPM usa o banco MG
export const fbSPM: FirebirdOptions = {
  host: env('DB_MG_HOST', 'DB_FIREBIRD_MG_HOST'),
  port: envInt(3050, 'DB_MG_PORT', 'DB_FIREBIRD_MG_PORT'),
  database: env('DB_MG_DATABASE', 'DB_FIREBIRD_MG_PATH'),
  user: env('DB_MG_USER', 'DB_FIREBIRD_MG_USER', 'DB_USER', 'FB_USER') || 'SYSDBA',
  password: env('DB_MG_PASSWORD', 'DB_FIREBIRD_MG_PASSWORD', 'DB_PASSWORD', 'FB_PASSWORD') || 'masterkey',
};

export const fbLockeyMG: FirebirdOptions = {
  host: env('DB_LOCKEY_MG_HOST') || targetLockeyMG?.host || env('DB_FIREBIRD_FAST_HOST'),
  port: envInt(3050, 'DB_LOCKEY_MG_PORT', 'DB_FIREBIRD_FAST_PORT'),
  database: env('DB_LOCKEY_MG_DATABASE') || targetLockeyMG?.database || env('DB_FIREBIRD_FAST_PATH'),
  user: env('DB_LOCKEY_MG_USER', 'DB_FIREBIRD_FAST_USER', 'DB_USER', 'FB_USER') || 'SYSDBA',
  password: env('DB_LOCKEY_MG_PASSWORD', 'DB_FIREBIRD_FAST_PASSWORD', 'DB_PASSWORD', 'FB_PASSWORD') || 'masterkey',
};

// Lockey SP + FAST (mesma base, separados por emp_fil_codigo)
export const fbLockey: FirebirdOptions = {
  host: env('DB_LOCKEY_HOST', 'DB_FIREBIRD_FAST_HOST') || targetLockeySP?.host,
  port: envInt(3050, 'DB_LOCKEY_PORT', 'DB_FIREBIRD_FAST_PORT'),
  database: env('DB_LOCKEY_DATABASE', 'DB_FIREBIRD_FAST_PATH') || targetLockeySP?.database || '',
  user: env('DB_LOCKEY_USER', 'DB_FIREBIRD_FAST_USER', 'DB_USER', 'FB_USER') || 'SYSDBA',
  password: env('DB_LOCKEY_PASSWORD', 'DB_FIREBIRD_FAST_PASSWORD', 'DB_PASSWORD', 'FB_PASSWORD') || 'masterkey',
};

export const myLockeyRS: MySQLExtOptions = {
  host: env('MYSQL_POA_HOST', 'RS_DB_MYSQL_HOST'),
  port: envInt(3377, 'MYSQL_POA_PORT', 'RS_DB_MYSQL_PORT'),
  database: env('MYSQL_POA_DATABASE', 'RS_DB_MYSQL_NAME'),
  user: env('MYSQL_POA_USER', 'RS_DB_MYSQL_USER'),
  password: env('MYSQL_POA_PASSWORD', 'RS_DB_MYSQL_PASSWORD'),
};

export const myNiteroi: MySQLExtOptions = {
  host: env('MYSQL_NITEROI_HOST', 'NITEROI_DB_MYSQL_HOST'),
  port: envInt(3377, 'MYSQL_NITEROI_PORT', 'NITEROI_DB_MYSQL_PORT'),
  database: env('MYSQL_NITEROI_DATABASE', 'NITEROI_DB_MYSQL_NAME'),
  user: env('MYSQL_NITEROI_USER', 'NITEROI_DB_MYSQL_USER'),
  password: env('MYSQL_NITEROI_PASSWORD', 'NITEROI_DB_MYSQL_PASSWORD'),
};

export const fbLockeyRJ: FirebirdOptions = {
  host: env('DB_LOCKEY_RJ_HOST', 'DB_FIREBIRD_L3_HOST'),
  port: envInt(3050, 'DB_LOCKEY_RJ_PORT', 'DB_FIREBIRD_L3_PORT'),
  database: env('DB_LOCKEY_RJ_DATABASE', 'DB_FIREBIRD_L3_PATH'),
  user: env('DB_LOCKEY_RJ_USER', 'DB_FIREBIRD_L3_USER', 'DB_USER', 'FB_USER') || 'SYSDBA',
  password: env('DB_LOCKEY_RJ_PASSWORD', 'DB_FIREBIRD_L3_PASSWORD', 'DB_PASSWORD', 'FB_PASSWORD') || 'masterkey',
};

export const fbLockeyBH: FirebirdOptions = {
  host: env('DB_LOCKEY_BH_HOST', 'DB_FIREBIRD_BH_HOST'),
  port: envInt(3050, 'DB_LOCKEY_BH_PORT', 'DB_FIREBIRD_BH_PORT'),
  database: env('DB_LOCKEY_BH_DATABASE', 'DB_FIREBIRD_BH_PATH'),
  user: env('DB_LOCKEY_BH_USER', 'DB_FIREBIRD_BH_USER', 'DB_USER', 'FB_USER') || 'SYSDBA',
  password: env('DB_LOCKEY_BH_PASSWORD', 'DB_FIREBIRD_BH_PASSWORD', 'DB_PASSWORD', 'FB_PASSWORD') || 'masterkey',
};
