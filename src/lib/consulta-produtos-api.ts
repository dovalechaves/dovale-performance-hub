import { API_BASE, authFetch } from "./disparo-api";

const BASE = `${API_BASE}/api/consulta-produtos`;

export interface PrecoCusto {
  preco: number | null;
  custo: number | null;
}

export interface DadosFilial {
  saldo: number | null;
  reservado: number | null;
  disponivel: number | null;
  tabelas: { atacado: PrecoCusto; ddf: PrecoCusto };
  /** Preço na tabela "PROMOÇÃO MENSAL ..." ativa; null quando o produto não está em promoção. */
  promocao: { nome: string; preco: number; validade: string | null } | null;
}

export interface ProdutoConsulta {
  codigo: string;
  descricao: string;
  tipo: string;
  filiais: Partial<Record<"sjc" | "mg", DadosFilial>>;
}

export interface ResultadoConsulta {
  filiais: { key: "sjc" | "mg"; nome: string }[];
  tabelas: { codigo: number; chave: "atacado" | "ddf"; nome: string }[];
  status: Record<string, string>;
  produtos: ProdutoConsulta[];
}

export interface Sugestao {
  codigo: string;
  descricao: string;
}

export async function sugerirProdutos(q: string, signal?: AbortSignal): Promise<Sugestao[]> {
  const r = await authFetch(`${BASE}/sugestoes?q=${encodeURIComponent(q)}`, { signal });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.erro ?? "Falha ao buscar sugestões");
  return json.sugestoes ?? [];
}

/** Busca por texto/código (lista) ou, com `codigo`, um produto exato. */
export async function buscarProdutos(q: string, signal?: AbortSignal, codigo?: string): Promise<ResultadoConsulta> {
  const qs = codigo ? `codigo=${encodeURIComponent(codigo)}` : `q=${encodeURIComponent(q)}`;
  const r = await authFetch(`${BASE}/buscar?${qs}`, { signal });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.erro ?? "Falha ao consultar produtos");
  return json;
}
