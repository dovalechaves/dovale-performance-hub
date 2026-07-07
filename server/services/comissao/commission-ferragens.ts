export interface FerrMetaConfig {
  meta1_valor: number; meta1_percentual: number;
  meta2_valor: number; meta2_percentual: number;
  meta3_valor: number; meta3_percentual: number;
  metadesafio_valor: number; metadesafio_percentual: number;
  percentual_sem_meta: number;
}

export interface FerrBonusConfig {
  bonus1_valor: number;
  bonus2_valor: number;
  bonus3_valor: number;
  bonusdesafio_valor: number;
}

export interface FerrMetaGrupoConfig {
  meta1_valor: number; meta1_bonus: number;
  meta2_valor: number; meta2_bonus: number;
  meta3_valor: number; meta3_bonus: number;
  metadesafio_valor: number; metadesafio_bonus: number;
}

export interface ComissaoFerragens {
  vendas_total: number;
  recebido: number;
  meta_atingida: { label: string; valor: number; percentual: number } | null;
  comissao_meta: number;
  comissao_bonus: number;
  grupo_meta_atingida: { label: string; valor: number } | null;
  comissao_grupo: number;
  comissao_total: number;
}

export function calcularComissaoFerragens(
  vendas_total: number,
  recebido: number,
  meta: FerrMetaConfig | null,
  bonus: FerrBonusConfig | null,
  vendas_setor: number,
  meta_grupo: FerrMetaGrupoConfig | null,
): ComissaoFerragens {
  const empty: ComissaoFerragens = {
    vendas_total, recebido,
    meta_atingida: null, comissao_meta: 0, comissao_bonus: 0,
    grupo_meta_atingida: null, comissao_grupo: 0, comissao_total: 0,
  };
  if (!meta) return empty;

  // Faixas individuais em ordem decrescente — maior faixa atingida
  const faixas = [
    { label: 'Meta Desafio', valor: meta.metadesafio_valor, percentual: meta.metadesafio_percentual, bonus_val: bonus?.bonusdesafio_valor ?? 0 },
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

  // Bônus do grupo — só libera se a vendedora atingiu ao menos Meta 1
  let grupo_meta_atingida: ComissaoFerragens['grupo_meta_atingida'] = null;
  let comissao_grupo = 0;

  if (faixaHit && meta_grupo) {
    const faixasGrupo = [
      { label: 'Meta Desafio', valor: meta_grupo.metadesafio_valor, bonus: meta_grupo.metadesafio_bonus },
      { label: 'Meta 3',       valor: meta_grupo.meta3_valor,       bonus: meta_grupo.meta3_bonus },
      { label: 'Meta 2',       valor: meta_grupo.meta2_valor,       bonus: meta_grupo.meta2_bonus },
      { label: 'Meta 1',       valor: meta_grupo.meta1_valor,       bonus: meta_grupo.meta1_bonus },
    ].filter(g => g.valor > 0);

    const grupoHit = faixasGrupo.find(g => vendas_setor >= g.valor) ?? null;
    if (grupoHit) {
      grupo_meta_atingida = { label: grupoHit.label, valor: grupoHit.valor };
      comissao_grupo = grupoHit.bonus;
    }
  }

  return {
    vendas_total, recebido, meta_atingida, comissao_meta, comissao_bonus,
    grupo_meta_atingida, comissao_grupo,
    comissao_total: comissao_meta + comissao_bonus + comissao_grupo,
  };
}

export function isFerragens(setor: string): boolean {
  return setor?.toUpperCase() === 'FERRAGENS';
}
