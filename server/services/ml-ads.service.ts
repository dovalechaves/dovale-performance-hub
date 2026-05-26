import { getPool } from "../db/sqlserver";

const BASE_URL = "https://api.mercadolibre.com";
const SELLER_ID = process.env.ML_SELLER_ID ?? "159732894";

export interface MlAdsData {
  expense: number;
  gmv: number;
  roas: number;
  clicks: number;
  impressions: number;
  orders: number;
  fonte: "api" | "fallback";
}

interface CacheEntry {
  data: MlAdsData;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

async function getToken(): Promise<string | null> {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      "SELECT TOP 1 TOKEN FROM DOVALE.dbo.TOKEN_FULL ORDER BY ID DESC"
    );
    return result.recordset[0]?.TOKEN ?? null;
  } catch {
    return null;
  }
}

async function apiGet(path: string, token: string, params: Record<string, string> = {}): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${path}${qs ? `?${qs}` : ""}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  return r.json();
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0]; // YYYY-MM-DD
}

async function fetchPerformance(token: string, dateFrom: string, dateTo: string): Promise<MlAdsData | null> {
  try {
    // Tenta endpoint de performance por anunciante
    const res = await apiGet(
      `/advertising/advertisers/${SELLER_ID}/product_ads/performance`,
      token,
      { date_from: dateFrom, date_to: dateTo }
    );

    if (res.error || !res.results) return null;

    let expense = 0, gmv = 0, clicks = 0, impressions = 0, orders = 0;
    for (const row of res.results) {
      expense     += row.cost        ?? row.expense     ?? 0;
      gmv         += row.gmv         ?? row.revenue     ?? 0;
      clicks      += row.clicks      ?? 0;
      impressions += row.impressions ?? row.prints      ?? 0;
      orders      += row.orders      ?? row.conversions ?? 0;
    }
    const roas = expense > 0 ? parseFloat((gmv / expense).toFixed(2)) : 0;
    return { expense, gmv, roas, clicks, impressions, orders, fonte: "api" };
  } catch {
    return null;
  }
}

export async function getMlAdsData(periodo: "diario" | "mensal"): Promise<MlAdsData> {
  const fallback: MlAdsData = {
    expense: 0, gmv: 0, roas: 0, clicks: 0, impressions: 0, orders: 0, fonte: "fallback",
  };

  const cached = cache.get(periodo);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const token = await getToken();
  if (!token) return fallback;

  const now = new Date();
  const dateFrom = periodo === "diario"
    ? formatDate(now)
    : formatDate(new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000));
  const dateTo = formatDate(now);

  const data = await fetchPerformance(token, dateFrom, dateTo);
  if (!data) return fallback;

  cache.set(periodo, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

// Usado pelo endpoint de teste para ver o response cru da API
export async function getMlAdsRaw(): Promise<Record<string, any>> {
  const token = await getToken();
  if (!token) return { erro: "Token não encontrado no banco" };

  const now = new Date();
  const dateFrom = formatDate(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
  const dateTo = formatDate(now);

  const [advertisers, campaigns, itemsMetrics, campaignsSearch] = await Promise.allSettled([
    apiGet(`/advertising/advertisers`, token, { product_id: "PADS" }),
    apiGet(`/advertising/advertisers/${SELLER_ID}/product_ads/campaigns`, token, { limit: "5" }),
    apiGet(`/advertising/advertisers/${SELLER_ID}/product_ads/items`, token, {
      date_from: dateFrom,
      date_to:   dateTo,
    }),
    apiGet(`/marketplace/advertising/MLB/advertisers/${SELLER_ID}/product_ads/campaigns/search`, token, {
      date_from: dateFrom,
      date_to:   dateTo,
      limit:     "5",
    }),
  ]);

  return {
    seller_id:  SELLER_ID,
    date_from:  dateFrom,
    date_to:    dateTo,
    token_preview: token.slice(0, 20) + "...",
    advertisers:      advertisers.status      === "fulfilled" ? advertisers.value      : { erro: String(advertisers.reason) },
    campaigns:        campaigns.status        === "fulfilled" ? campaigns.value        : { erro: String(campaigns.reason) },
    items_metrics:    itemsMetrics.status     === "fulfilled" ? itemsMetrics.value     : { erro: String(itemsMetrics.reason) },
    campaigns_search: campaignsSearch.status  === "fulfilled" ? campaignsSearch.value  : { erro: String(campaignsSearch.reason) },
  };
}
