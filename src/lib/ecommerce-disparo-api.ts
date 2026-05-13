const API_BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:3001/api").replace(/\/$/, "");
const BASE = `${API_BASE}/ecommerce-disparo`;

export type PeriodoRelatorio = "diario" | "mensal";

export interface CanalResumo {
  canal: string;
  faturamento: number;
  pedidos: number;
  ticket_medio: number;
  conversao: number;
  margem: number;
  variacao: number;
}

export interface TrafegoPagoItem {
  origem: string;
  investimento: number;
  receita: number;
  roas: number;
  conversao: number;
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
    margem: number;
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
  pontos_criticos: string[];
  direcionamentos: string[];
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

export async function fetchEcommerceReport(usuario: string, periodo: PeriodoRelatorio): Promise<EcommerceReport> {
  const params = new URLSearchParams({ periodo });
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
): Promise<{ periodo: PeriodoRelatorio; mensagem: string; modo_simulacao: boolean }> {
  const res = await fetch(`${BASE}/preview`, {
    method: "POST",
    headers: headers(usuario),
    body: JSON.stringify({ periodo }),
  });
  return handleResponse<{ periodo: PeriodoRelatorio; mensagem: string; modo_simulacao: boolean }>(res);
}

export async function enviarRelatorioEcommerce(
  usuario: string,
  periodo: PeriodoRelatorio,
): Promise<{ ok: boolean; periodo: PeriodoRelatorio; modo_simulacao: boolean; enviados: number; mensagem: string }> {
  const res = await fetch(`${BASE}/enviar`, {
    method: "POST",
    headers: headers(usuario),
    body: JSON.stringify({ periodo }),
  });
  return handleResponse<{ ok: boolean; periodo: PeriodoRelatorio; modo_simulacao: boolean; enviados: number; mensagem: string }>(res);
}
