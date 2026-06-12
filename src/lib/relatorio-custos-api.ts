import { API_BASE, authFetch } from "./disparo-api";

const BASE = `${API_BASE}/api/relatorio-custos`;

export interface CustoTemplate {
  template: string;
  volume: number;
  custoUsd: number;
  custoBrl: number;
}

export interface CustoSetor {
  setor: string;
  volume: number;
  custoUsd: number;
  custoBrl: number;
  templates: CustoTemplate[];
}

export interface RelatorioCustos {
  mes: string;
  periodo: { start: number; end: number };
  cambio: { rate: number; fonte: string };
  totalUsd: number;
  totalBrl: number;
  totalVolume: number;
  setores: CustoSetor[];
}

export interface TemplateDePara {
  id: string;
  name: string;
  status: string;
  category: string;
  etiqueta: string;
  etiquetaValida: boolean;
}

export async function fetchCustos(mes: string): Promise<RelatorioCustos> {
  const r = await authFetch(`${BASE}/custos?mes=${encodeURIComponent(mes)}`);
  const json = await r.json();
  if (!r.ok) throw new Error(json.erro ?? "Falha ao carregar custos");
  return json;
}

export async function fetchDePara(): Promise<{ templates: TemplateDePara[]; etiquetas: string[] }> {
  const r = await authFetch(`${BASE}/de-para`);
  const json = await r.json();
  if (!r.ok) throw new Error(json.erro ?? "Falha ao carregar mapeamento");
  return json;
}

export async function salvarDePara(template_nome: string, etiqueta: string): Promise<void> {
  const r = await authFetch(`${BASE}/de-para`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template_nome, etiqueta }),
  });
  if (!r.ok) {
    const json = await r.json().catch(() => ({}));
    throw new Error(json.erro ?? "Falha ao salvar mapeamento");
  }
}
