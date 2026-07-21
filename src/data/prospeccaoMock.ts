// Mock de cobertura de base para o dashboard de Prospecção.
// Frontend-only: nenhum dado vem de backend. Números gerados de forma
// determinística (a partir da sigla) para a UI ficar estável entre renders.

export interface CityCoverage {
  cidade: string;
  naBase: number;   // clientes já existentes na base
  foraBase: number; // clientes potenciais (mercado) ainda fora da base
}

export interface StateCoverage {
  sigla: string;
  nome: string;
  naBase: number;
  foraBase: number;
  cidades: CityCoverage[];
}

const UFS: { sigla: string; nome: string; capital: string }[] = [
  { sigla: "AC", nome: "Acre", capital: "Rio Branco" },
  { sigla: "AL", nome: "Alagoas", capital: "Maceió" },
  { sigla: "AP", nome: "Amapá", capital: "Macapá" },
  { sigla: "AM", nome: "Amazonas", capital: "Manaus" },
  { sigla: "BA", nome: "Bahia", capital: "Salvador" },
  { sigla: "CE", nome: "Ceará", capital: "Fortaleza" },
  { sigla: "DF", nome: "Distrito Federal", capital: "Brasília" },
  { sigla: "ES", nome: "Espírito Santo", capital: "Vitória" },
  { sigla: "GO", nome: "Goiás", capital: "Goiânia" },
  { sigla: "MA", nome: "Maranhão", capital: "São Luís" },
  { sigla: "MT", nome: "Mato Grosso", capital: "Cuiabá" },
  { sigla: "MS", nome: "Mato Grosso do Sul", capital: "Campo Grande" },
  { sigla: "MG", nome: "Minas Gerais", capital: "Belo Horizonte" },
  { sigla: "PA", nome: "Pará", capital: "Belém" },
  { sigla: "PB", nome: "Paraíba", capital: "João Pessoa" },
  { sigla: "PR", nome: "Paraná", capital: "Curitiba" },
  { sigla: "PE", nome: "Pernambuco", capital: "Recife" },
  { sigla: "PI", nome: "Piauí", capital: "Teresina" },
  { sigla: "RJ", nome: "Rio de Janeiro", capital: "Rio de Janeiro" },
  { sigla: "RN", nome: "Rio Grande do Norte", capital: "Natal" },
  { sigla: "RS", nome: "Rio Grande do Sul", capital: "Porto Alegre" },
  { sigla: "RO", nome: "Rondônia", capital: "Porto Velho" },
  { sigla: "RR", nome: "Roraima", capital: "Boa Vista" },
  { sigla: "SC", nome: "Santa Catarina", capital: "Florianópolis" },
  { sigla: "SP", nome: "São Paulo", capital: "São Paulo" },
  { sigla: "SE", nome: "Sergipe", capital: "Aracaju" },
  { sigla: "TO", nome: "Tocantins", capital: "Palmas" },
];

// hash determinístico simples (string -> inteiro positivo)
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function pseudo(seed: number, min: number, max: number): number {
  const x = Math.sin(seed) * 10000;
  const frac = x - Math.floor(x);
  return Math.floor(min + frac * (max - min + 1));
}

const CIDADE_SUFIXOS = ["Região Metropolitana", "Interior Norte", "Interior Sul", "Litoral"];

export const STATES: StateCoverage[] = UFS.map((uf) => {
  const h = hash(uf.sigla);
  const mercadoTotal = pseudo(h, 300, 4000);
  const cobertura = pseudo(h + 7, 12, 78) / 100; // 12% a 78%
  const naBase = Math.round(mercadoTotal * cobertura);
  const foraBase = mercadoTotal - naBase;

  // cidades: capital + alguns municípios genéricos; somam ~ o total do estado
  const nCidades = 3 + (h % 3); // 3 a 5 cidades
  const nomes = [uf.capital, ...CIDADE_SUFIXOS.slice(0, nCidades - 1).map((s) => `${uf.capital} — ${s}`)];
  const pesos = nomes.map((_, i) => pseudo(h + i * 13, 1, 10));
  const somaPesos = pesos.reduce((a, b) => a + b, 0);

  const cidades: CityCoverage[] = nomes.map((cidade, i) => {
    const fatia = pesos[i] / somaPesos;
    const cNa = Math.round(naBase * fatia);
    const cFora = Math.round(foraBase * fatia);
    return { cidade, naBase: cNa, foraBase: cFora };
  });

  return { sigla: uf.sigla, nome: uf.nome, naBase, foraBase, cidades };
});

export const STATE_BY_SIGLA: Record<string, StateCoverage> = Object.fromEntries(
  STATES.map((s) => [s.sigla, s]),
);

export const TOTAIS = STATES.reduce(
  (acc, s) => {
    acc.naBase += s.naBase;
    acc.foraBase += s.foraBase;
    return acc;
  },
  { naBase: 0, foraBase: 0 },
);

export const coberturaPct = (naBase: number, foraBase: number): number => {
  const total = naBase + foraBase;
  return total === 0 ? 0 : Math.round((naBase / total) * 100);
};
