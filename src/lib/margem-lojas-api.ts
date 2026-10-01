import { API_BASE, authFetch } from "./disparo-api";

const BASE = `${API_BASE}/api/margem-lojas`;

export interface LojaMargem {
  key: string;
  nome: string;
}

export interface LinhaMargem {
  loja: string;
  pro_codigo: number;
  pro_resumo: string;
  eh_chave: boolean;
  fonte: "EP+INDÚSTRIA" | "EP" | "INDÚSTRIA";
  qtde_vendida: number;
  valor_venda: number;
  preco_unitario: number;
  preco_industria: number | null;
  preco_ep: number | null;
  custo_unitario: number | null;
  custo_total: number | null;
  lucro: number | null;
  margem_percentual: number | null;
}

export interface StatusLoja {
  loja: string;
  status: string;
}

export interface ResultadoMargem {
  linhas: LinhaMargem[];
  status: StatusLoja[];
}

export interface CustoFamilia {
  familia_codigo: number;
  familia_nome: string;
  custo: number | null;
}

export async function fetchLojasMargem(): Promise<LojaMargem[]> {
  const r = await authFetch(`${BASE}/lojas`);
  const json = await r.json();
  if (!r.ok) throw new Error(json.erro ?? "Falha ao carregar lojas");
  return json;
}

export async function fetchMargem(params: {
  loja?: string;
  produto?: string;
  inicio: string;
  fim: string;
}): Promise<ResultadoMargem> {
  const qs = new URLSearchParams();
  if (params.loja) qs.set("loja", params.loja);
  if (params.produto) qs.set("produto", params.produto);
  qs.set("inicio", params.inicio);
  qs.set("fim", params.fim);
  const r = await authFetch(`${BASE}?${qs}`);
  const json = await r.json();
  if (!r.ok) throw new Error(json.erro ?? "Falha ao carregar margem");
  return json;
}

export async function fetchCustosFamilia(): Promise<CustoFamilia[]> {
  const r = await authFetch(`${BASE}/custo-familia`);
  const json = await r.json();
  if (!r.ok) throw new Error(json.erro ?? "Falha ao carregar custos por família");
  return json;
}

export async function salvarCustoFamilia(familia_codigo: number, custo: number): Promise<void> {
  const r = await authFetch(`${BASE}/custo-familia`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ familia_codigo, custo }),
  });
  if (!r.ok) {
    const json = await r.json().catch(() => ({}));
    throw new Error(json.erro ?? "Falha ao salvar custo");
  }
}
