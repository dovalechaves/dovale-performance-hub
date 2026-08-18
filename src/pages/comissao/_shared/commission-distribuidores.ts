import type { ComissaoFerragens } from './commission-ferragens';

export interface DistMetaConfig {
  meta1_valor: number; meta1_percentual: number;
  meta2_valor: number; meta2_percentual: number;
  meta3_valor: number; meta3_percentual: number;
  meta4_valor: number; meta4_percentual: number;
  metadesafio_valor: number; metadesafio_percentual: number;
  percentual_sem_meta: number;
}

export interface DistBonusConfig {
  bonus1_valor: number;
  bonus2_valor: number;
  bonus3_valor: number;
  bonus4_valor: number;
  bonusdesafio_valor: number;
}

export type ComissaoDistribuidores = ComissaoFerragens;

export function calcularComissaoDistribuidores(
  vendas_total: number,
  recebido: number,
  meta: DistMetaConfig | null,
  bonus: DistBonusConfig | null = null,
): ComissaoDistribuidores {
  const empty: ComissaoDistribuidores = {
    vendas_total, recebido,
    meta_atingida: null, comissao_meta: 0, comissao_bonus: 0,
    grupo_meta_atingida: null, comissao_grupo: 0, comissao_total: 0,
  };
  if (!meta) return empty;

  // Faixas individuais em ordem decrescente — maior faixa atingida
  const faixas = [
    { label: 'Meta Desafio', valor: meta.metadesafio_valor, percentual: meta.metadesafio_percentual, bonus_val: bonus?.bonusdesafio_valor ?? 0 },
    { label: 'Meta 4',       valor: meta.meta4_valor,       percentual: meta.meta4_percentual,       bonus_val: bonus?.bonus4_valor ?? 0 },
    { label: 'Meta 3',       valor: meta.meta3_valor,       percentual: meta.meta3_percentual,       bonus_val: bonus?.bonus3_valor ?? 0 },
    { label: 'Meta 2',       valor: meta.meta2_valor,       percentual: meta.meta2_percentual,       bonus_val: bonus?.bonus2_valor ?? 0 },
    { label: 'Meta 1',       valor: meta.meta1_valor,       percentual: meta.meta1_percentual,       bonus_val: bonus?.bonus1_valor ?? 0 },
  ].filter(f => f.valor > 0);

  const faixaHit = faixas.find(f => vendas_total >= f.valor) ?? null;
  const meta_atingida = faixaHit
    ? { label: faixaHit.label, valor: faixaHit.valor, percentual: faixaHit.percentual }
    : null;

  let comissao_meta = 0;
  let comissao_bonus = 0;

  if (!faixaHit) {
    comissao_meta = ((meta.percentual_sem_meta ?? 0) / 100) * recebido;
  } else {
    comissao_meta = (faixaHit.percentual / 100) * recebido;
    comissao_bonus = faixaHit.bonus_val;
  }

  // Distribuidores não tem bônus de grupo — sempre null/0
  return {
    vendas_total, recebido, meta_atingida, comissao_meta, comissao_bonus,
    grupo_meta_atingida: null, comissao_grupo: 0,
    comissao_total: comissao_meta + comissao_bonus,
  };
}

export function isDistribuidores(setor: string): boolean {
  return setor?.toUpperCase() === 'DISTRIBUIDORES';
}
