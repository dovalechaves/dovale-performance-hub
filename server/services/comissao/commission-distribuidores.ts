import { calcularComissaoFerragens, type FerrMetaConfig, type FerrBonusConfig, type ComissaoFerragens } from './commission-ferragens';

export type DistMetaConfig = FerrMetaConfig;
export type DistBonusConfig = FerrBonusConfig;
export type ComissaoDistribuidores = ComissaoFerragens;
export function calcularComissaoDistribuidores(
  vendas_total: number,
  recebido: number,
  meta: DistMetaConfig | null,
  bonus: DistBonusConfig | null = null,
): ComissaoDistribuidores {
  return calcularComissaoFerragens(vendas_total, recebido, meta, bonus, 0, null);
}

export function isDistribuidores(setor: string): boolean {
  return setor?.toUpperCase() === 'DISTRIBUIDORES';
}
