// Cotação USD->BRL com cache em memória (TTL curto) e fallback configurável.
// Fonte: AwesomeAPI (economia.awesomeapi.com.br) — pública, sem chave.

const FALLBACK_RATE = Number(process.env.USD_BRL_FALLBACK) || 5.4;
const TTL_MS = 30 * 60 * 1000; // 30 min

let _cache: { rate: number; fonte: string; ts: number } | null = null;

export async function obterCotacaoUsdBrl(): Promise<{ rate: number; fonte: string }> {
  if (_cache && Date.now() - _cache.ts < TTL_MS) {
    return { rate: _cache.rate, fonte: _cache.fonte };
  }
  try {
    const r = await fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL", {
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const json = await r.json();
      const bid = Number(json?.USDBRL?.bid);
      if (bid > 0) {
        _cache = { rate: bid, fonte: "awesomeapi", ts: Date.now() };
        return { rate: bid, fonte: "awesomeapi" };
      }
    }
  } catch {
    /* usa fallback abaixo */
  }
  return { rate: FALLBACK_RATE, fonte: "fallback" };
}
