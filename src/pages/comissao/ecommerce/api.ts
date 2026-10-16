import { useQuery } from '@tanstack/react-query';
import { useComissaoApi } from '../_shared/hooks';
import type { ComissaoEcommerce, EcomFaixa, EcomMeta } from '../_shared/commission-ecommerce';

export interface EcomAcesso {
  ecommerce: boolean;
  papel: 'ADM' | 'GESTOR' | 'VENDEDORA' | null;
  vendedora: string | null;
  pode_configurar: boolean;
  /** vendedoras ativas do setor (para a vendedora, só ela mesma) */
  vendedoras: string[];
}

export interface EcomFilial { emp: string; filial: string; total: number }
export interface EcomPlataformaMes { plataforma: string; atual: number; anterior: number }

export interface EcomResumo {
  ano: number;
  mes: number;
  acesso: { papel: EcomAcesso['papel']; vendedora: string | null; pode_configurar: boolean };
  dados: {
    mes_em_andamento: boolean;
    total: number;
    total_anterior: number;
    por_filial: EcomFilial[];
    por_plataforma: EcomPlataformaMes[];
  };
  serie: Array<{ mes: number; total: number }>;
  config: {
    meta: EcomMeta | null;
    faixas: EcomFaixa[];
    faixas_origem: { ano: number; mes: number } | 'padrao';
    percentual_sem_meta_padrao: number;
  };
  comissao: ComissaoEcommerce;
  vendedoras: Array<{ nome: string; comissao: number }>;
  minha_comissao: number | null;
}

export interface EcomConfig {
  meta: EcomMeta | null;
  faixas: EcomFaixa[];
  faixas_origem: { ano: number; mes: number } | 'padrao';
  vendedoras: Array<{ nome: string; ativo: boolean }>;
  plataformas: EcomPlataformaMes[];
  percentual_sem_meta_padrao: number;
}

const SEM_ACESSO: EcomAcesso = { ecommerce: false, papel: null, vendedora: null, pode_configurar: false, vendedoras: [] };

// Decide se o usuário enxerga as telas do e-commerce. Em qualquer falha, devolve "sem acesso"
// (o painel geral continua funcionando como antes).
export function useEcommerceAcesso() {
  const api = useComissaoApi();
  return useQuery({
    queryKey: ['comissao', 'ecommerce', 'acesso'],
    queryFn: async (): Promise<EcomAcesso> => {
      const r = await api('/ecommerce/acesso');
      if (!r.ok) return SEM_ACESSO;
      return (await r.json()) as EcomAcesso;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

// staleTime 0: quem vê a própria comissão nunca deve ver número velho (mesmo critério do Vendedor.tsx).
export function useEcommerceResumo(ano: number, mes: number) {
  const api = useComissaoApi();
  return useQuery({
    queryKey: ['comissao', 'ecommerce', 'resumo', ano, mes],
    queryFn: async (): Promise<EcomResumo> => {
      const r = await api(`/ecommerce/resumo?ano=${ano}&mes=${mes}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error || 'Erro ao carregar o e-commerce');
      return (await r.json()) as EcomResumo;
    },
    staleTime: 0,
  });
}

export function useEcommerceConfig(ano: number, mes: number) {
  const api = useComissaoApi();
  return useQuery({
    queryKey: ['comissao', 'ecommerce', 'config', ano, mes],
    queryFn: async (): Promise<EcomConfig> => {
      const r = await api(`/ecommerce/config?ano=${ano}&mes=${mes}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error || 'Erro ao carregar a configuração');
      return (await r.json()) as EcomConfig;
    },
    staleTime: 0,
  });
}

export function usePutEcommerce() {
  const api = useComissaoApi();
  return async (rota: 'metas' | 'bonus-faixas' | 'vendedoras', body: unknown): Promise<void> => {
    const r = await api(`/ecommerce/${rota}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error || 'Erro ao salvar');
  };
}
