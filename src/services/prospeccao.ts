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
  temCadastro: boolean;
  cnae: string | null;
}

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
  foraBase: number; // potenciais (mercado) ainda fora da base
}

export interface StateCoverage {
  sigla: string;
  nome: string;
  naBase: number;
  foraBase: number;
  cidades: CityCoverage[];
}

export interface Cobertura {
  totais: { naBase: number; foraBase: number };
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

// ── Transformação: resposta da API -> cobertura por estado/cidade ────────────
export function buildCobertura(resp: VerificarCadastrosResponse): Cobertura {
  // Acumulador por UF -> por cidade -> { naBase, foraBase }
  const porUf = new Map<string, { na: number; fora: number; cidades: Map<string, CityCoverage> }>();

  const registrar = (reg: CadastroRegistro, naBase: boolean) => {
    const sigla = (reg.uf ?? "").trim().toUpperCase();
    if (!sigla || !UF_NOME[sigla]) return; // ignora UF inválida/ausente no mapa
    let uf = porUf.get(sigla);
    if (!uf) {
      uf = { na: 0, fora: 0, cidades: new Map() };
      porUf.set(sigla, uf);
    }
    const cidadeNome = reg.cidade?.trim() ? tituloCidade(reg.cidade.trim()) : "Não informado";
    let cid = uf.cidades.get(cidadeNome);
    if (!cid) {
      cid = { cidade: cidadeNome, naBase: 0, foraBase: 0 };
      uf.cidades.set(cidadeNome, cid);
    }
    if (naBase) {
      uf.na += 1;
      cid.naBase += 1;
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
      foraBase: v.fora,
      cidades: [...v.cidades.values()].sort(
        (a, b) => b.naBase + b.foraBase - (a.naBase + a.foraBase),
      ),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  const statesBySigla = Object.fromEntries(states.map((s) => [s.sigla, s]));

  return {
    // Cabeçalho usa os agregados oficiais da API (mais fiéis ao total do mercado).
    totais: { naBase: resp.quantidadeComCadastro, foraBase: resp.quantidadeSemCadastro },
    states,
    statesBySigla,
  };
}
