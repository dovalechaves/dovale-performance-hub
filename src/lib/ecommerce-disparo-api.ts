const API_BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:3001/api").replace(/\/$/, "");
const BASE = `${API_BASE}/ecommerce-disparo`;

export type PeriodoRelatorio = "diario" | "mensal";

export interface CanalResumo {
  canal: string;
  faturamento: number;
  pedidos: number;
  ticket_medio: number;
  conversao: number;
  variacao: number;
}

export interface TrafegoPagoItem {
  origem: string;
  investimento: number | null;
  receita: number | null;
  roas: number | null;
  conversao: number | null;
  fonte?: string;
  status?: string;
}

export interface EcommerceReport {
  periodo: PeriodoRelatorio;
  gerado_em: string;
  fonte: string;
  integracoes: {
    tray: string;
    whatsapp: string;
  };
  destinatarios: Array<{ nome: string; telefone: string }>;
  agenda: {
    diario: string;
    mensal: string;
  };
  kpis: {
    faturamento: number;
    pedidos: number;
    ticket_medio: number;
    conversao: number;
    roas: number;
    investimento: number;
    receita_paga: number;
    meta: number;
    realizado_meta: number;
    projecao_fechamento: number;
  };
  comparativos: {
    dia_anterior: number | null;
    semana_anterior: number | null;
    mes_anterior: number | null;
  };
  canais: CanalResumo[];
  trafego_pago: TrafegoPagoItem[];
  analise: AnaliseBot | null;
}

export interface AnaliseBot {
  texto: string;
  gerado_em?: string;
  data_referencia?: string;
  modelo?: string;
}

export interface HistoricoEnvio {
  id: number;
  periodo: PeriodoRelatorio;
  data_envio: string;
  destinatario: string;
  status: string;
}

function headers(usuario: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-dovale-usuario": usuario,
  };
}

async function handleResponse<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.erro || json.error || `Erro ${res.status}`);
  return json as T;
}

export async function fetchEcommerceReport(usuario: string, periodo: PeriodoRelatorio, data?: string): Promise<EcommerceReport> {
  const params = new URLSearchParams({ periodo });
  if (data) params.set("data", data);
  const res = await fetch(`${BASE}/overview?${params}`, { headers: headers(usuario) });
  return handleResponse<EcommerceReport>(res);
}

export async function fetchHistoricoEcommerce(usuario: string): Promise<{ total: number; items: HistoricoEnvio[] }> {
  const res = await fetch(`${BASE}/historico`, { headers: headers(usuario) });
  return handleResponse<{ total: number; items: HistoricoEnvio[] }>(res);
}

export async function previewRelatorioEcommerce(
  usuario: string,
  periodo: PeriodoRelatorio,
  data?: string,
): Promise<{ periodo: PeriodoRelatorio; mensagem: string; modo_simulacao: boolean }> {
  const res = await fetch(`${BASE}/preview`, {
    method: "POST",
    headers: headers(usuario),
    body: JSON.stringify({ periodo, data }),
  });
  return handleResponse<{ periodo: PeriodoRelatorio; mensagem: string; modo_simulacao: boolean }>(res);
}

export async function gerarAnaliseEcommerce(usuario: string, periodo: PeriodoRelatorio, data?: string): Promise<AnaliseBot> {
  const params = new URLSearchParams({ periodo });
  if (data) params.set("data", data);
  const res = await fetch(`${BASE}/analise/gerar?${params}`, {
    method: "POST",
    headers: headers(usuario),
  });
  return handleResponse<AnaliseBot>(res);
}

export interface EcommerceMetas {
  meta_diario: number;
  meta_mensal: number;
}

export async function fetchEcommerceMetas(usuario: string): Promise<EcommerceMetas> {
  const res = await fetch(`${BASE}/metas`, { headers: headers(usuario) });
  return handleResponse<EcommerceMetas>(res);
}

export async function salvarEcommerceMetas(usuario: string, metas: EcommerceMetas): Promise<void> {
  const res = await fetch(`${BASE}/metas`, {
    method: "PUT",
    headers: headers(usuario),
    body: JSON.stringify(metas),
  });
  return handleResponse<void>(res);
}

export async function enviarRelatorioEcommerce(
  usuario: string,
  periodo: PeriodoRelatorio,
  data?: string,
): Promise<{ ok: boolean; periodo: PeriodoRelatorio; modo_simulacao: boolean; enviados: number; falhas?: string[]; mensagem: string }> {
  const res = await fetch(`${BASE}/enviar`, {
    method: "POST",
    headers: headers(usuario),
    body: JSON.stringify({ periodo, data }),
  });
  return handleResponse<{ ok: boolean; periodo: PeriodoRelatorio; modo_simulacao: boolean; enviados: number; falhas?: string[]; mensagem: string }>(res);
}
