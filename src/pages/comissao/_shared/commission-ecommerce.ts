// Regras de comissão do setor E-COMMERCE (cálculo puro, sem acesso a banco).
// Espelhado em src/pages/comissao/_shared/commission-ecommerce.ts (usado na Simulação) — mantenha os dois iguais.
//
//  1. Comissão do setor = % da maior meta atingida × faturamento do setor (Meta 1/2/3).
//     Sem meta atingida: percentual_sem_meta (padrão 0,25%) × faturamento.
//  2. Bônus por plataforma: crescimento sobre o mês anterior, por plataforma, em faixas "a partir de X%"
//     (ex.: 5% → R$ 50, 10% → R$ 100, 20% → R$ 150). Soma de todas as plataformas.
//     Só é pago se a Meta 1 foi batida.
//  3. Total do setor = comissão + bônus, dividido igualmente entre as vendedoras ativas.

export interface EcomMeta {
  meta1_valor: number; meta1_percentual: number;
  meta2_valor: number; meta2_percentual: number;
  meta3_valor: number; meta3_percentual: number;
  percentual_sem_meta: number;
}

/** Faixa de bônus: crescimento (em %) a partir do qual a plataforma ganha `valor`. */
export interface EcomFaixa { cresc_min: number; valor: number }

export interface EcomPlataformaEntrada { plataforma: string; atual: number; anterior: number }

export interface EcomPlataformaCalculada extends EcomPlataformaEntrada {
  /** crescimento % sobre o mês anterior (2 casas); null quando não havia venda no mês anterior */
  crescimento: number | null;
  elegivel: boolean;
  faixa_min: number | null;
  bonus: number;
}

export interface ComissaoEcommerce {
  vendas_total: number;
  meta_atingida: { label: string; valor: number; percentual: number } | null;
  percentual_aplicado: number;
  comissao_meta: number;
  bonus_desbloqueado: boolean;
  plataformas: EcomPlataformaCalculada[];
  bonus_potencial: number;
  comissao_bonus: number;
  comissao_total: number;
  vendedoras: number;
  comissao_por_vendedora: number;
}

export const PERCENTUAL_SEM_META_PADRAO = 0.25;

/** Plataformas que não entram no bônus. Hoje nenhuma: venda direta e não identificadas contam como Loja Virtual. */
export const PLATAFORMAS_SEM_BONUS: string[] = [];

export const FAIXAS_BONUS_PADRAO: EcomFaixa[] = [
  { cresc_min: 5, valor: 50 },
  { cresc_min: 10, valor: 100 },
  { cresc_min: 20, valor: 150 },
];

export function crescimentoPct(atual: number, anterior: number): number | null {
  if (!(anterior > 0)) return null;
  return Math.round(((atual / anterior - 1) * 100) * 100) / 100;
}

/** Maior faixa cujo mínimo foi alcançado (faixas sem buraco entre 9,99 e 10). */
export function faixaDoCrescimento(crescimento: number | null, faixas: EcomFaixa[]): EcomFaixa | null {
  if (crescimento === null) return null;
  const ordenadas = [...faixas].filter((f) => f.valor > 0).sort((a, b) => b.cresc_min - a.cresc_min);
  return ordenadas.find((f) => crescimento >= f.cresc_min) ?? null;
}

export function calcularComissaoEcommerce(
  vendas_total: number,
  meta: EcomMeta | null,
  plataformas: EcomPlataformaEntrada[],
  faixas: EcomFaixa[],
  vendedoras: number,
): ComissaoEcommerce {
  const nVend = Math.max(1, vendedoras || 1);
  const psm = meta?.percentual_sem_meta ?? PERCENTUAL_SEM_META_PADRAO;

  const tiers = meta ? [
    { label: 'Meta 3', valor: meta.meta3_valor, percentual: meta.meta3_percentual },
    { label: 'Meta 2', valor: meta.meta2_valor, percentual: meta.meta2_percentual },
    { label: 'Meta 1', valor: meta.meta1_valor, percentual: meta.meta1_percentual },
  ].filter((t) => t.valor > 0) : [];
  const meta_atingida = tiers.find((t) => vendas_total >= t.valor) ?? null;

  const percentual_aplicado = meta_atingida ? meta_atingida.percentual : psm;
  const comissao_meta = (percentual_aplicado / 100) * vendas_total;

  // Bônus só é aceito se a meta foi batida (pelo menos a Meta 1).
  const bonus_desbloqueado = !!meta && meta.meta1_valor > 0 && vendas_total >= meta.meta1_valor;

  const calculadas: EcomPlataformaCalculada[] = plataformas.map((p) => {
    const elegivel = !PLATAFORMAS_SEM_BONUS.includes(p.plataforma);
    const crescimento = crescimentoPct(p.atual, p.anterior);
    const faixa = elegivel ? faixaDoCrescimento(crescimento, faixas) : null;
    return { ...p, crescimento, elegivel, faixa_min: faixa?.cresc_min ?? null, bonus: faixa?.valor ?? 0 };
  });
  const bonus_potencial = calculadas.reduce((s, p) => s + p.bonus, 0);
  const comissao_bonus = bonus_desbloqueado ? bonus_potencial : 0;
  const comissao_total = comissao_meta + comissao_bonus;

  return {
    vendas_total, meta_atingida, percentual_aplicado, comissao_meta,
    bonus_desbloqueado, plataformas: calculadas, bonus_potencial, comissao_bonus,
    comissao_total, vendedoras: nVend, comissao_por_vendedora: comissao_total / nVend,
  };
}

export function isEcommerce(setor: string): boolean {
  return setor?.toUpperCase() === 'ECOMMERCE';
}
