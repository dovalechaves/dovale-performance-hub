import { getPool } from "../db/sqlserver";

const BASE_URL = "https://api.mercadolibre.com";
const SELLER_ID = process.env.ML_SELLER_ID ?? "159732894";
const METRICAS_PRODUCT_ADS = "clicks,prints,cost,total_amount,units_quantity";

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
let advertiserIdCache: { value: string; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

async function getToken(): Promise<string | null> {
  try {
    const pool = await getPool();
    let result;
    try {
      result = await pool.request().query("SELECT TOP 1 TOKEN FROM DOVALE.dbo.TOKEN_FULL ORDER BY ID DESC");
    } catch {
      result = await pool.request().query("SELECT TOP 1 TOKEN FROM dbo.TOKEN_FULL ORDER BY ID DESC");
    }
    return result.recordset[0]?.TOKEN ?? null;
  } catch {
    return null;
  }
}

async function apiGet(path: string, token: string, params: Record<string, string> = {}, apiVersion?: string): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${path}${qs ? `?${qs}` : ""}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(apiVersion ? { "Api-Version": apiVersion } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  return r.json();
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0]; // YYYY-MM-DD
}

async function fetchPerformance(token: string, dateFrom: string, dateTo: string): Promise<MlAdsData | null> {
  try {
    const advertiserId = await resolveAdvertiserId(token) ?? SELLER_ID;
    const res = await apiGet(
      `/advertising/advertisers/${advertiserId}/product_ads/campaigns`,
      token,
      {
        date_from: dateFrom,
        date_to: dateTo,
        metrics: METRICAS_PRODUCT_ADS,
        limit: "100",
      },
      "2"
    );

    if (res.error || !res.results) return null;

    let expense = 0, gmv = 0, clicks = 0, impressions = 0, orders = 0;
    for (const row of res.results ?? []) {
      const metrics = row.metrics ?? row;
      expense     += Number(metrics.cost           ?? metrics.expense     ?? 0);
      gmv         += Number(metrics.total_amount   ?? metrics.gmv         ?? metrics.revenue ?? 0);
      clicks      += Number(metrics.clicks         ?? 0);
      impressions += Number(metrics.prints         ?? metrics.impressions ?? 0);
      orders      += Number(metrics.units_quantity ?? metrics.orders      ?? metrics.conversions ?? 0);
    }
    const roas = expense > 0 ? parseFloat((gmv / expense).toFixed(2)) : 0;
    return { expense, gmv, roas, clicks, impressions, orders, fonte: "api" };
  } catch {
    return null;
  }
}

async function resolveAdvertiserId(token: string): Promise<string | null> {
  if (advertiserIdCache && advertiserIdCache.expiresAt > Date.now()) return advertiserIdCache.value;

  try {
    const res = await apiGet("/advertising/advertisers", token, { product_id: "PADS" });
    const raw = res.advertisers?.[0]?.advertiser_id ?? res.results?.[0]?.advertiser_id ?? null;
    const advertiserId = raw != null ? String(raw) : null;
    if (advertiserId) {
      advertiserIdCache = { value: advertiserId, expiresAt: Date.now() + CACHE_TTL_MS };
      return advertiserId;
    }
  } catch {
    return null;
  }

  return null;
}

export async function getMlAdsData(periodo: "diario" | "mensal", date?: string): Promise<MlAdsData> {
  const fallback: MlAdsData = {
    expense: 0, gmv: 0, roas: 0, clicks: 0, impressions: 0, orders: 0, fonte: "fallback",
  };

  const cacheKey = date ? `${periodo}_${date}` : periodo;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const token = await getToken();
  if (!token) return fallback;

  const now = new Date();
  const targetDate = date ? new Date(`${date}T00:00:00`) : now;

  const dateFrom = periodo === "diario"
    ? formatDate(targetDate)
    : formatDate(new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000));
  const dateTo = periodo === "diario" ? formatDate(targetDate) : formatDate(now);

  const data = await fetchPerformance(token, dateFrom, dateTo);
  if (!data) return fallback;

  cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

// Usado pelo endpoint de teste para ver o response cru da API
export async function getMlAdsRaw(): Promise<Record<string, any>> {
  const token = await getToken();
  if (!token) return { erro: "Token não encontrado no banco" };

  const now = new Date();
  const dateFrom = formatDate(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
  const dateTo = formatDate(now);
  const advertiserId = await resolveAdvertiserId(token) ?? SELLER_ID;

  const [advertisers, campaigns, performance] = await Promise.allSettled([
    apiGet(`/advertising/advertisers`, token, { product_id: "PADS" }),
    apiGet(`/advertising/advertisers/${advertiserId}/product_ads/campaigns`, token, {
      date_from: dateFrom,
      date_to: dateTo,
      metrics: METRICAS_PRODUCT_ADS,
      metrics_summary: "true",
      limit: "100",
    }, "2"),
    fetchPerformance(token, dateFrom, dateTo),
  ]);

  return {
    seller_id: SELLER_ID,
    advertiser_id: advertiserId,
    date_from: dateFrom,
    date_to: dateTo,
    token_preview: token.slice(0, 20) + "...",
    advertisers: advertisers.status === "fulfilled" ? advertisers.value : { erro: String(advertisers.reason) },
    campaigns: campaigns.status === "fulfilled" ? campaigns.value : { erro: String(campaigns.reason) },
    agregado_calculado: performance.status === "fulfilled" ? performance.value : { erro: String(performance.reason) },
  };
}
