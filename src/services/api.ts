export const API_BASE = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/$/, "");

const BASE = API_BASE;

export interface Representante {
  rep_codigo: string;
  rep_nome: string;
}

export interface Meta {
  id?: number;
  rep_codigo: string;
  rep_nome: string;
  loja: string;
  meta_valor: number;
  dias_uteis?: number | null;
  mes: number;
  ano: number;
}

export const LOJAS = [
  { value: "bh", label: "BH" },
  { value: "l2", label: "Santana" },
  { value: "l3", label: "Rio de Janeiro" },
];

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Erro ${res.status}`);
  }
  return res.json();
}

export interface VendaConsolidada {
  rep_codigo: string;
  rep_nome: string;
  total_vendas: number;
}

export async function getRepresentantes(loja: string): Promise<Representante[]> {
  const res = await fetch(`${BASE}/representantes?loja=${loja}`);
  return handleResponse<Representante[]>(res);
}

export async function getVendas(loja: string, mes: number, ano: number): Promise<VendaConsolidada[]> {
  const res = await fetch(`${BASE}/sync/vendas?loja=${loja}&mes=${mes}&ano=${ano}`);
  return handleResponse<VendaConsolidada[]>(res);
}

export async function getVendasHoje(loja: string): Promise<VendaConsolidada[]> {
  const res = await fetch(`${BASE}/sync/vendas-hoje?loja=${loja}`);
  return handleResponse<VendaConsolidada[]>(res);
}

export async function getMetas(loja: string, mes: number, ano: number): Promise<Meta[]> {
  const res = await fetch(`${BASE}/metas?loja=${loja}&mes=${mes}&ano=${ano}`);
  return handleResponse<Meta[]>(res);
}

export async function saveMeta(meta: Omit<Meta, "id">): Promise<void> {
  const res = await fetch(`${BASE}/metas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(meta),
  });
  return handleResponse<void>(res);
}

export async function saveDiasUteis(loja: string, mes: number, ano: number, dias_uteis: number): Promise<void> {
  const res = await fetch(`${BASE}/metas/dias-uteis`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loja, mes, ano, dias_uteis }),
  });
  return handleResponse<void>(res);
}

export async function deleteMeta(id: number): Promise<void> {
  const res = await fetch(`${BASE}/metas/${id}`, { method: "DELETE" });
  return handleResponse<void>(res);
}
