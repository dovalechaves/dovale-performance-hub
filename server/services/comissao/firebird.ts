/* eslint-disable @typescript-eslint/no-explicit-any */
import Firebird from 'node-firebird';
import net from 'net';
import { CONNECT_TIMEOUT_MS, QUERY_TIMEOUT_MS, ErroFonteExterna } from './timeouts';

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

// node-firebird não expõe timeout de conexão: se o host está fora do ar, o attach fica
// pendurado até o TCP desistir (no Linux ~127s), o que estoura o limite de 100s do Cloudflare
// e derruba o endpoint inteiro. Um probe TCP curto antes do attach garante falha rápida.
function probeTcp(host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const finalizar = (err?: Error) => {
      socket.removeAllListeners();
      socket.destroy();
      if (err) reject(err); else resolve();
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finalizar());
    socket.once('timeout', () => finalizar(
      new ErroFonteExterna(`sem resposta de ${host}:${port} em ${timeoutMs}ms`, 'conexao')
    ));
    socket.once('error', (err: Error) => finalizar(
      new ErroFonteExterna(`falha ao conectar em ${host}:${port} — ${err.message}`, 'conexao')
    ));
  });
}

export async function queryFirebird(
  opts: FirebirdOptions,
  sql: string,
): Promise<Record<string, unknown>[]> {
  if (!opts.host || !opts.database) {
    throw new ErroFonteExterna('host/database não configurados', 'conexao');
  }

  await probeTcp(opts.host, opts.port, CONNECT_TIMEOUT_MS);

  return new Promise((resolve, reject) => {
    let finalizado = false;
    let conexao: any = null;

    const timer = setTimeout(() => {
      if (finalizado) return;
      finalizado = true;
      try { conexao?.detach(); } catch { /* conexão já morta */ }
      reject(new ErroFonteExterna(
        `consulta em ${opts.host} excedeu ${QUERY_TIMEOUT_MS}ms`, 'consulta',
      ));
    }, QUERY_TIMEOUT_MS);

    const encerrar = (err: Error | null, rows?: Record<string, unknown>[]) => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(timer);
      if (err) reject(err); else resolve(rows ?? []);
    };

    Firebird.attach(opts, (err: Error | null, db: any) => {
      if (err) {
        return encerrar(new ErroFonteExterna(
          `attach em ${opts.host} falhou — ${err.message}`, 'conexao',
        ));
      }
      conexao = db;
      if (finalizado) {
        // timeout já disparou enquanto o attach estava em curso
        try { db.detach(); } catch { /* ignora */ }
        return;
      }
      db.query(sql, [], (qErr: Error | null, result: any[]) => {
        try { db.detach(); } catch { /* ignora */ }
        if (qErr) return encerrar(new ErroFonteExterna(
          `consulta em ${opts.host} falhou — ${qErr.message}`, 'consulta',
        ));
        encerrar(null, (result ?? []).map(trimRow));
      });
    });
  });
}
