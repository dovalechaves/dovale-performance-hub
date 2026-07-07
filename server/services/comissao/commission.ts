export interface MetaConfig {
  meta1_valor: number;
  meta1_percentual: number;
  meta2_valor: number;
  meta2_percentual: number;
  meta3_valor: number;
  meta3_percentual: number;
  percentual_sem_meta: number;
}

export interface BonusConfig {
  bonus1_valor: number; bonus1_percentual: number;
  bonus2_valor: number; bonus2_percentual: number;
  bonus3_valor: number; bonus3_percentual: number;
  bonus4_valor: number; bonus4_percentual: number;
  bonus5_valor: number; bonus5_percentual: number;
}

export interface ComissaoTelevendas {
  valor_pa: number;
  total_recebido: number;
  meta_atingida: { label: string; valor: number; percentual: number } | null;
  comissao_meta: number;
  percentual_sem_meta: number;
  bonus_desbloqueado: boolean;
  bonus_tier: { label: string; valor: number; percentual: number } | null;
  comissao_bonus: number;
  comissao_total: number;
}

export function calcularComissaoTelevendas(
  valor_pa: number,
  total_recebido: number,
  meta: MetaConfig | null,
  bonus: BonusConfig | null
): ComissaoTelevendas {
  const empty: ComissaoTelevendas = {
    valor_pa, total_recebido,
    meta_atingida: null, comissao_meta: 0,
    percentual_sem_meta: meta?.percentual_sem_meta ?? 0,
    bonus_desbloqueado: false, bonus_tier: null,
    comissao_bonus: 0, comissao_total: 0,
  };
  if (!meta) return empty;

  // Metas PA em ordem decrescente — encontra a mais alta atingida
  const metas = [
    { label: 'Meta PA 3', valor: meta.meta3_valor, percentual: meta.meta3_percentual },
    { label: 'Meta PA 2', valor: meta.meta2_valor, percentual: meta.meta2_percentual },
    { label: 'Meta PA 1', valor: meta.meta1_valor, percentual: meta.meta1_percentual },
  ].filter((m) => m.valor > 0);

  const meta_atingida = metas.find((m) => valor_pa >= m.valor) ?? null;

  let comissao_meta = 0;
  if (meta_atingida) {
    comissao_meta = (meta_atingida.percentual / 100) * total_recebido;
  } else if (meta.percentual_sem_meta > 0) {
    comissao_meta = (meta.percentual_sem_meta / 100) * total_recebido;
  }

  // Bônus: liberado se atingiu ao menos Meta PA 1
  const bonus_desbloqueado = meta.meta1_valor > 0 && valor_pa >= meta.meta1_valor;
  let bonus_tier: ComissaoTelevendas['bonus_tier'] = null;
  let comissao_bonus = 0;

  if (bonus_desbloqueado && bonus) {
    const tiers = [
      { label: 'Bônus 5', valor: bonus.bonus5_valor, percentual: bonus.bonus5_percentual },
      { label: 'Bônus 4', valor: bonus.bonus4_valor, percentual: bonus.bonus4_percentual },
      { label: 'Bônus 3', valor: bonus.bonus3_valor, percentual: bonus.bonus3_percentual },
      { label: 'Bônus 2', valor: bonus.bonus2_valor, percentual: bonus.bonus2_percentual },
      { label: 'Bônus 1', valor: bonus.bonus1_valor, percentual: bonus.bonus1_percentual },
    ].filter((t) => t.valor > 0);
    bonus_tier = tiers.find((t) => valor_pa >= t.valor) ?? null;
    if (bonus_tier) comissao_bonus = (bonus_tier.percentual / 100) * valor_pa;
  }

  return {
    valor_pa, total_recebido, meta_atingida, comissao_meta,
    percentual_sem_meta: meta.percentual_sem_meta,
    bonus_desbloqueado, bonus_tier, comissao_bonus,
    comissao_total: comissao_meta + comissao_bonus,
  };
}

export function isTelevendas(setor: string): boolean {
  return setor?.toUpperCase().includes('TELEVENDAS') ?? false;
}
