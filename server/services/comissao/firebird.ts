/* eslint-disable @typescript-eslint/no-explicit-any */
import Firebird from 'node-firebird';

export interface FirebirdOptions {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

function trimRow(row: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    const v = row[key];
    out[key.toLowerCase()] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

export function queryFirebird(opts: FirebirdOptions, sql: string): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    Firebird.attach(opts, (err: Error | null, db: any) => {
      if (err) return reject(err);
      db.query(sql, [], (qErr: Error | null, result: any[]) => {
        db.detach();
        if (qErr) return reject(qErr);
        resolve((result ?? []).map(trimRow));
      });
    });
  });
}
