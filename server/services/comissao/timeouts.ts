// Limites de tempo das consultas nas bases externas (Firebird/MySQL) do Painel de Comissões.
//
// Motivo: o endpoint /api/comissao/dashboard consulta 8 bases externas em paralelo. Sem
// timeout, uma base fora do ar deixava a request pendurada (TCP desiste em ~127s no Linux),
// o Cloudflare cortava em 100s com 524 e a tela ficava "carregando infinito".
//
// O timeout de consulta precisa ficar confortavelmente abaixo dos 100s do Cloudflare.

function envInt(nome: string, padrao: number): number {
  const parsed = Number.parseInt(process.env[nome] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : padrao;
}

/** Tempo máximo para abrir a conexão TCP com a base externa. */
export const CONNECT_TIMEOUT_MS = envInt('COMISSAO_DB_CONNECT_TIMEOUT_MS', 8_000);

/** Tempo máximo para a consulta retornar depois de conectada. */
export const QUERY_TIMEOUT_MS = envInt('COMISSAO_DB_QUERY_TIMEOUT_MS', 60_000);

/** Janela em que uma base que falhou por conexão é ignorada (circuit breaker). */
export const FALHA_TTL_MS = envInt('COMISSAO_DB_FALHA_TTL_MS', 3 * 60 * 1_000);

export type TipoFalha = 'conexao' | 'consulta';

export class ErroFonteExterna extends Error {
  readonly tipo: TipoFalha;
  constructor(message: string, tipo: TipoFalha) {
    super(message);
    this.name = 'ErroFonteExterna';
    this.tipo = tipo;
  }
}

export function ehFalhaDeConexao(err: unknown): boolean {
  return err instanceof ErroFonteExterna && err.tipo === 'conexao';
}
