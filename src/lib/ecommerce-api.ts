const BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:3001/api").replace(/\/api$/, "") + "/api/ecommerce";

export interface Produto {
  pro_codigo: number;
  resumo: string;
  custo: number;
  preco: number;
  peso: number;
}

export interface SimulateParams {
  price: number;
  cost?: number;
  listing_type_id?: string;
  weight?: number;
  tax_regime?: string;
  free_shipping?: boolean;
}

export interface SimulateResults {
  gross_revenue: number;
  ml_fee_percent: number;
  ml_fee_amount: number;
  shipping_cost: number;
  tax_rate_percent: number;
  tax_amount: number;
  product_cost: number;
  net_profit: number;
  margin_percent: number;
}

export interface CustoOperacionalItem {
  perc_participacao: number;
  valor_participacao_rateado: number;
  qtd_media_mensal: number;
  custo_operacional_unit: number | null;
}

export async function fetchProduto(codigo: string): Promise<Produto> {
  const res = await fetch(`${BASE}/produto/${encodeURIComponent(codigo)}`);
  if (!res.ok) throw new Error("Produto não encontrado");
  return res.json();
}

export async function fetchProdutos(): Promise<Produto[]> {
  const res = await fetch(`${BASE}/produtos`);
  if (!res.ok) throw new Error("Erro ao carregar produtos");
  return res.json();
}

export async function fetchMyItems(sellerId: string, token: string): Promise<any[]> {
  const res = await fetch(`${BASE}/my-items?seller_id=${sellerId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Erro ao carregar anúncios");
  const data = await res.json();
  return data.items || [];
}

export async function fetchTokenSalvo(): Promise<{ token: string }> {
  const res = await fetch(`${BASE}/token-salvo`);
  if (!res.ok) throw new Error("Token não disponível");
  return res.json();
}

export async function authToken(token: string): Promise<{ seller_id: string; nickname: string }> {
  const res = await fetch(`${BASE}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: token }),
  });
  if (!res.ok) throw new Error("Token inválido");
  return res.json();
}

export async function simulate(
  params: SimulateParams,
  token?: string
): Promise<{ results: SimulateResults }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/simulate`, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Erro na simulação");
  return res.json();
}

export async function fetchCustoOperacional(
  valorParticipacao: number
): Promise<Record<number, CustoOperacionalItem>> {
  const res = await fetch(`${BASE}/custo-operacional?valor_participacao=${valorParticipacao}`);
  if (!res.ok) throw new Error("Erro ao carregar custo operacional");
  return res.json();
}

export type LojaCalc = "fast" | "santana" | "rj";

export async function fetchContasPagar(loja: LojaCalc): Promise<{ loja: string; total: number }> {
  const res = await fetch(`${BASE}/contas-pagar?loja=${loja}`);
  if (!res.ok) throw new Error("Erro ao carregar contas a pagar");
  return res.json();
}
