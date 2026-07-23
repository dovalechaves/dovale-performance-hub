// Cliente da ApiDovale (https://api.dovale.online) para o app de Prospecção.
// A API é orientada por CNAE: /api/verificarcadastros?cnae=X retorna, para aquele
// segmento, quantos CNPJs do mercado já estão na base (comCadastro) e quantos ainda
// não estão (semCadastro). Cada registro traz uf e cidade, então montamos a cobertura
// por estado (mapa) e por cidade (drill) agrupando no cliente.
//
// Observações da API (verificadas em 2026-07):
//  - Sem `cnae` a resposta vem zerada; o `cnae` é obrigatório.
//  - O parâmetro `uf=` não filtra de fato — usamos o campo `uf` de cada registro.
//  - A ApiDovale precisa liberar CORS para a origem do hub para a chamada direta
//    do browser funcionar (ver README/observação no PR).

export const APIDOVALE_BASE = (
  import.meta.env.VITE_APIDOVALE_URL ?? "https://api.dovale.online"
).replace(/\/$/, "");

// ── Tipos da API ────────────────────────────────────────────────────────────
export interface CadastroRegistro {
  cnpj: string;
  situacaoInterna: string | null;
  razao: string | null;
  cidade: string | null;
  uf: string | null;
  telefone: string | null;
  email: string | null;
  temCadastro: boolean;
  cnae: string | null;
  // Como o registro do mercado foi casado com a base interna: "CNPJ", "CEP" ou
  // "Telefone". Só vem preenchido para quem está na base (temCadastro = true).
  formaCadastro: string | null;
}

// Formas de vínculo (por onde o cliente foi encontrado na base interna).
export type FormaCadastro = "CNPJ" | "CEP" | "Telefone" | "Outro";
export const FORMAS_CADASTRO: FormaCadastro[] = ["CNPJ", "CEP", "Telefone", "Outro"];
export type FormasBreakdown = Record<FormaCadastro, number>;

const formasZero = (): FormasBreakdown => ({ CNPJ: 0, CEP: 0, Telefone: 0, Outro: 0 });

// Normaliza o valor bruto de formaCadastro para um dos rótulos canônicos.
export function normalizaForma(raw: string | null | undefined): FormaCadastro {
  const v = (raw ?? "").trim().toLocaleLowerCase("pt-BR");
  if (v === "cnpj") return "CNPJ";
  if (v === "cep") return "CEP";
  if (v === "telefone" || v === "fone" || v === "tel") return "Telefone";
  return "Outro";
}

export const somaFormas = (f: FormasBreakdown): number =>
  FORMAS_CADASTRO.reduce((acc, k) => acc + f[k], 0);

export const mergeFormas = (into: FormasBreakdown, from: FormasBreakdown): void => {
  FORMAS_CADASTRO.forEach((k) => { into[k] += from[k]; });
};

export interface VerificarCadastrosResponse {
  total: number;
  quantidadeComCadastro: number;
  quantidadeSemCadastro: number;
  comCadastro: CadastroRegistro[];
  semCadastro: CadastroRegistro[];
}

// ── Tipos de domínio (consumidos pela página) ───────────────────────────────
export interface CityCoverage {
  cidade: string;
  naBase: number; // clientes já existentes na base
  ativos: number; // dos que estão na base, quantos estão ativos
  foraBase: number; // potenciais (mercado) ainda fora da base
}

export interface StateCoverage {
  sigla: string;
  nome: string;
  naBase: number;
  ativos: number;
  foraBase: number;
  cidades: CityCoverage[];
  formas: FormasBreakdown; // quebra dos que estão na base por forma de vínculo
}

export interface Cobertura {
  totais: { naBase: number; ativos: number; foraBase: number; formas: FormasBreakdown };
  states: StateCoverage[];
  statesBySigla: Record<string, StateCoverage>;
}

// ── Metadados de UF (sigla -> nome) ──────────────────────────────────────────
const UF_NOME: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia",
  CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás",
  MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais",
  PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí",
  RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul",
  RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo",
  SE: "Sergipe", TO: "Tocantins",
};

export const coberturaPct = (naBase: number, foraBase: number): number => {
  const total = naBase + foraBase;
  return total === 0 ? 0 : Math.round((naBase / total) * 100);
};

// Capitaliza "SAO PAULO" -> "São Paulo" (aproximação simples para exibição).
function tituloCidade(c: string): string {
  return c
    .toLocaleLowerCase("pt-BR")
    .replace(/\b\p{L}/gu, (ch) => ch.toLocaleUpperCase("pt-BR"));
}

// ── Chamadas HTTP ─────────────────────────────────────────────────────────────
async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${APIDOVALE_BASE}${path}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`ApiDovale ${res.status} em ${path}`);
  return res.json() as Promise<T>;
}

export function fetchCnaes(signal?: AbortSignal): Promise<string[]> {
  return getJson<string[]>("/api/cnaes", signal);
}

export function fetchVerificarCadastros(
  cnae: string,
  signal?: AbortSignal,
): Promise<VerificarCadastrosResponse> {
  return getJson<VerificarCadastrosResponse>(
    `/api/verificarcadastros?cnae=${encodeURIComponent(cnae)}`,
    signal,
  );
}

// Um registro já na base é "ativo" quando a API marca situacaoInterna = "Ativo"
// (os demais vêm como "Inativo"; registros fora da base vêm como "Sem cadastro").
function isAtivo(reg: CadastroRegistro): boolean {
  return (reg.situacaoInterna ?? "").trim().toLocaleLowerCase("pt-BR") === "ativo";
}

// ── Transformação: resposta da API -> cobertura por estado/cidade ────────────
export function buildCobertura(resp: VerificarCadastrosResponse): Cobertura {
  // Acumulador por UF -> por cidade -> { naBase, ativos, foraBase }
  const porUf = new Map<string, { na: number; ativos: number; fora: number; formas: FormasBreakdown; cidades: Map<string, CityCoverage> }>();

  const registrar = (reg: CadastroRegistro, naBase: boolean) => {
    const sigla = (reg.uf ?? "").trim().toUpperCase();
    if (!sigla || !UF_NOME[sigla]) return; // ignora UF inválida/ausente no mapa
    let uf = porUf.get(sigla);
    if (!uf) {
      uf = { na: 0, ativos: 0, fora: 0, formas: formasZero(), cidades: new Map() };
      porUf.set(sigla, uf);
    }
    const cidadeNome = reg.cidade?.trim() ? tituloCidade(reg.cidade.trim()) : "Não informado";
    let cid = uf.cidades.get(cidadeNome);
    if (!cid) {
      cid = { cidade: cidadeNome, naBase: 0, ativos: 0, foraBase: 0 };
      uf.cidades.set(cidadeNome, cid);
    }
    if (naBase) {
      uf.na += 1;
      cid.naBase += 1;
      uf.formas[normalizaForma(reg.formaCadastro)] += 1;
      if (isAtivo(reg)) {
        uf.ativos += 1;
        cid.ativos += 1;
      }
    } else {
      uf.fora += 1;
      cid.foraBase += 1;
    }
  };

  (resp.comCadastro ?? []).forEach((r) => registrar(r, true));
  (resp.semCadastro ?? []).forEach((r) => registrar(r, false));

  const states: StateCoverage[] = [...porUf.entries()]
    .map(([sigla, v]) => ({
      sigla,
      nome: UF_NOME[sigla],
      naBase: v.na,
      ativos: v.ativos,
      foraBase: v.fora,
      formas: v.formas,
      cidades: [...v.cidades.values()].sort(
        (a, b) => b.naBase + b.foraBase - (a.naBase + a.foraBase),
      ),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  const statesBySigla = Object.fromEntries(states.map((s) => [s.sigla, s]));

  // "ativos" e a quebra por forma não têm agregado próprio na API — somam-se dos estados.
  const totalAtivos = states.reduce((acc, s) => acc + s.ativos, 0);
  const totalFormas = states.reduce((acc, s) => { mergeFormas(acc, s.formas); return acc; }, formasZero());

  return {
    // naBase/foraBase usam os agregados oficiais da API (mais fiéis ao total do mercado).
    totais: { naBase: resp.quantidadeComCadastro, ativos: totalAtivos, foraBase: resp.quantidadeSemCadastro, formas: totalFormas },
    states,
    statesBySigla,
  };
}
