import { createHmac } from "crypto";

const BASE_URL = "https://partner.shopeemobile.com";

export interface ShopeeAdsData {
  expense: number;
  gmv: number;
  roas: number;
  clicks: number;
  impressions: number;
  orders: number;
  fonte: "api" | "fallback";
}

interface CacheEntry {
  data: ShopeeAdsData;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

function credentials() {
  return {
    partnerId: parseInt(process.env.SHOPEE_PARTNER_ID ?? "0"),
    partnerKey: process.env.SHOPEE_PARTNER_KEY ?? "",
    shopId: parseInt(process.env.SHOPEE_SHOP_ID ?? "0"),
    accessToken: process.env.SHOPEE_ACCESS_TOKEN ?? "",
  };
}

function isConfigured(): boolean {
  const c = credentials();
  return !!(c.partnerId && c.partnerKey && c.shopId && c.accessToken);
}

function sign(apiPath: string, ts: number): string {
  const { partnerId, partnerKey, shopId, accessToken } = credentials();
  const base = `${partnerId}${apiPath}${ts}${accessToken}${shopId}`;
  return createHmac("sha256", partnerKey).update(base).digest("hex");
}

async function apiGet(apiPath: string, extra: Record<string, string> = {}): Promise<any> {
  const { partnerId, shopId, accessToken } = credentials();
  const ts = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    partner_id: String(partnerId),
    shop_id: String(shopId),
    access_token: accessToken,
    timestamp: String(ts),
    sign: sign(apiPath, ts),
    ...extra,
  });
  const r = await fetch(`${BASE_URL}${apiPath}?${params}`, {
    signal: AbortSignal.timeout(10_000),
  });
  return r.json();
}

function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function aggregateRows(rows: any[]): ShopeeAdsData {
  let expense = 0, gmv = 0, clicks = 0, impressions = 0, orders = 0;
  for (const row of rows) {
    expense     += row.expense ?? 0;
    gmv         += row.broad_gmv ?? 0;
    clicks      += row.clicks ?? 0;
    impressions += row.impression ?? 0;
    orders      += row.broad_order ?? 0;
  }
  const roas = expense > 0 ? parseFloat((gmv / expense).toFixed(2)) : 0;
  return { expense, gmv, roas, clicks, impressions, orders, fonte: "api" };
}

async function fetchHourly(date: Date): Promise<ShopeeAdsData | null> {
  try {
    const res = await apiGet("/api/v2/ads/get_all_cpc_ads_hourly_performance", {
      performance_date: formatDate(date),
    });
    if (res.error || !Array.isArray(res.response)) {
      console.warn("[shopee-ads] fetchHourly falhou:", JSON.stringify(res));
      return null;
    }
    return aggregateRows(res.response);
  } catch (err) {
    console.warn("[shopee-ads] fetchHourly exception:", err);
    return null;
  }
}

async function fetchDaily(startDate: Date, endDate: Date): Promise<ShopeeAdsData | null> {
  try {
    const res = await apiGet("/api/v2/ads/get_all_cpc_ads_daily_performance", {
      start_date: formatDate(startDate),
      end_date: formatDate(endDate),
    });
    if (res.error || !Array.isArray(res.response)) {
      console.warn("[shopee-ads] fetchDaily falhou:", JSON.stringify(res));
      return null;
    }
    return aggregateRows(res.response);
  } catch (err) {
    console.warn("[shopee-ads] fetchDaily exception:", err);
    return null;
  }
}

export async function refreshShopeeToken(): Promise<{ access_token: string; refresh_token: string } | null> {
  const { partnerId, partnerKey, shopId } = credentials();
  const refreshToken = process.env.SHOPEE_REFRESH_TOKEN ?? "";
  if (!partnerId || !partnerKey || !shopId || !refreshToken) return null;

  const apiPath = "/api/v2/auth/access_token/get";
  const ts = Math.floor(Date.now() / 1000);
  const base = `${partnerId}${apiPath}${ts}`;
  const sig = createHmac("sha256", partnerKey).update(base).digest("hex");

  try {
    const r = await fetch(`${BASE_URL}${apiPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partner_id: partnerId,
        shop_id: shopId,
        refresh_token: refreshToken,
        timestamp: ts,
        sign: sig,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = await r.json();
    if (json.access_token && json.refresh_token) {
      // Atualiza em memória para uso imediato sem reiniciar
      process.env.SHOPEE_ACCESS_TOKEN = json.access_token;
      process.env.SHOPEE_REFRESH_TOKEN = json.refresh_token;
      cache.clear();
      console.log("[shopee-ads] Token renovado com sucesso.");
      return { access_token: json.access_token, refresh_token: json.refresh_token };
    }
    console.warn("[shopee-ads] Falha ao renovar token:", JSON.stringify(json));
    return null;
  } catch (e: any) {
    console.warn("[shopee-ads] Erro ao renovar token:", e.message);
    return null;
  }
}

export async function getShopeeAdsRaw(): Promise<any> {
  const now = new Date();
  const configured = isConfigured();
  const creds = credentials();
  try {
    const hourly = await apiGet("/api/v2/ads/get_all_cpc_ads_hourly_performance", {
      performance_date: formatDate(now),
    });
    return {
      configured,
      partner_id: creds.partnerId,
      shop_id: creds.shopId,
      has_access_token: !!creds.accessToken,
      performance_date: formatDate(now),
      hourly_raw: hourly,
    };
  } catch (e: any) {
    return { configured, erro: e.message };
  }
}

export async function getShopeeAdsData(periodo: "diario" | "mensal"): Promise<ShopeeAdsData> {
  const fallback: ShopeeAdsData = {
    expense: 0, gmv: 0, roas: 0, clicks: 0, impressions: 0, orders: 0, fonte: "fallback",
  };

  if (!isConfigured()) return fallback;

  const cacheKey = periodo;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const now = new Date();
  let data: ShopeeAdsData | null = null;

  if (periodo === "diario") {
    data = await fetchHourly(now);
  } else {
    const start = new Date(now);
    start.setDate(start.getDate() - 28);
    data = await fetchDaily(start, now);
  }

  if (!data) return fallback;

  cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}
