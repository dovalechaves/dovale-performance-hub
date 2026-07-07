import { useEffect, useState } from 'react';
import AppShell from './layout/AppShell';
import { formatBRL, formatNumber, MESES, CORES_GRAFICO } from './_shared/format';
import { calcularComissaoTelevendas, type MetaConfig, type BonusConfig } from './_shared/commission';
import { calcularComissaoFerragens, type FerrMetaConfig, type FerrBonusConfig, type FerrMetaGrupoConfig } from './_shared/commission-ferragens';
import { calcularComissaoDistribuidores, type DistMetaConfig, type DistBonusConfig } from './_shared/commission-distribuidores';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList,
} from 'recharts';
import { ChevronDown, Download, Filter } from 'lucide-react';
import { useComissaoUser as useUser, useComissaoApi } from './_shared/hooks';
import { useNavigate } from 'react-router-dom';

const ANO_ATUAL = new Date().getFullYear();
const ANOS = [ANO_ATUAL, ANO_ATUAL - 1, ANO_ATUAL - 2];

interface ResumoVendedor {
  vendedor: string;
  setor: string;
  empresa: string;
  total_vendas: number;
  total_qtde: number;
  total_registros: number;
  valor_pa: number;
  total_recebido: number;
  is_televendas: boolean;
}

interface MetaVendedor {
  nome_vendedor: string;
  meta1_valor: number; meta1_percentual: number;
  meta2_valor: number; meta2_percentual: number;
  meta3_valor: number; meta3_percentual: number;
  percentual_sem_meta: number;
}

interface FerrVendedorMeta {
  nome_vendedor: string;
  meta1_valor: number; meta1_percentual: number;
  meta2_valor: number; meta2_percentual: number;
  meta3_valor: number; meta3_percentual: number;
  metadesafio_valor: number; metadesafio_percentual: number;
  percentual_sem_meta: number;
}

interface FerrVendedorBonus {
  nome_vendedor: string;
  bonus1_valor: number;
  bonus2_valor: number;
  bonus3_valor: number;
  bonusdesafio_valor: number;
}

interface DistVendedorMeta {
  nome_vendedor: string;
  meta1_valor: number; meta1_percentual: number;
  meta2_valor: number; meta2_percentual: number;
  meta3_valor: number; meta3_percentual: number;
  metadesafio_valor: number; metadesafio_percentual: number;
  percentual_sem_meta: number;
}

interface DistVendedorBonus {
  nome_vendedor: string;
  bonus1_valor: number;
  bonus2_valor: number;
  bonus3_valor: number;
  bonusdesafio_valor: number;
}

export default function ComissaoGestor() {
  const usuario = useUser();
  const api = useComissaoApi();
  const navigate = useNavigate();
  const [vendedores, setVendedores] = useState<ResumoVendedor[]>([]);
  const [metasMap, setMetasMap] = useState<Record<string, MetaVendedor>>({});
  const [setores, setSetores] = useState<string[]>([]);
  const [empresas, setEmpresas] = useState<string[]>([]);
  const [filtroSetor, setFiltroSetor] = useState('');
  const [filtroEmpresa, setFiltroEmpresa] = useState('');
  const [ano, setAno] = useState(ANO_ATUAL);
  const [mes, setMes] = useState<number | null>(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [bonusConfig, setBonusConfig] = useState<BonusConfig | null>(null);
  const [ferrMetasMap, setFerrMetasMap] = useState<Record<string, FerrVendedorMeta>>({});
  const [ferrBonusMap, setFerrBonusMap] = useState<Record<string, FerrVendedorBonus>>({});
  const [ferrMetaGrupo, setFerrMetaGrupo] = useState<FerrMetaGrupoConfig | null>(null);
  const [ferrCarregado, setFerrCarregado] = useState(false);
  const [distMetasMap, setDistMetasMap] = useState<Record<string, DistVendedorMeta>>({});
  const [distBonusMap, setDistBonusMap] = useState<Record<string, DistVendedorBonus>>({});
  const [distCarregado, setDistCarregado] = useState(false);

  useEffect(() => {
    if (usuario && usuario !== 'loading' && usuario.cargo === 'VENDEDOR') {
      navigate('/comissao/vendedor');
    }
  }, [usuario, navigate]);

  useEffect(() => {
    api('/filtros', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setSetores(d.setores || []);
        setEmpresas(d.empresas || []);
      });
    api('/bonus-config')
      .then((r) => r.json())
      .then(setBonusConfig)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const url = mes
      ? `/metas-mensais?ano=${ano}&mes=${mes}`
      : '/metas';
    api(url)
      .then((r) => r.json())
      .then((list: MetaVendedor[]) => {
        const map: Record<string, MetaVendedor> = {};
        list.forEach((m) => { map[m.nome_vendedor] = m; });
        setMetasMap(map);
      })
      .catch(() => {});
  }, [ano, mes]);

  useEffect(() => {
    setFerrCarregado(false);
    const mesFetch = mes || new Date().getMonth() + 1;
    api(`/ferragens/config?ano=${ano}&mes=${mesFetch}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(({ metas, bonus, metaGrupo }) => {
        const mm: Record<string, FerrVendedorMeta> = {};
        (metas as FerrVendedorMeta[]).forEach(m => { mm[m.nome_vendedor] = m; });
        setFerrMetasMap(mm);
        const bm: Record<string, FerrVendedorBonus> = {};
        (bonus as FerrVendedorBonus[]).forEach(b => { bm[b.nome_vendedor] = b; });
        setFerrBonusMap(bm);
        setFerrMetaGrupo((metaGrupo as FerrMetaGrupoConfig) ?? null);
        setFerrCarregado(true);
      })
      .catch(err => {
        console.error('[gestor] ferragens/config:', err);
        setFerrCarregado(true);
      });
  }, [ano, mes]);

  useEffect(() => {
    setDistCarregado(false);
    const mesFetch = mes || new Date().getMonth() + 1;
    api(`/distribuidores/config?ano=${ano}&mes=${mesFetch}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(({ metas, bonus }) => {
        const mm: Record<string, DistVendedorMeta> = {};
        (metas as DistVendedorMeta[]).forEach(m => { mm[m.nome_vendedor] = m; });
        setDistMetasMap(mm);
        const bm: Record<string, DistVendedorBonus> = {};
        (bonus as DistVendedorBonus[]).forEach(b => { bm[b.nome_vendedor] = b; });
        setDistBonusMap(bm);
        setDistCarregado(true);
      })
      .catch(err => {
        console.error('[gestor] distribuidores/config:', err);
        setDistCarregado(true);
      });
  }, [ano, mes]);

  const carregarVendedores = () => {
    setLoading(true);
    const params = new URLSearchParams({ ano: ano.toString() });
    if (mes) params.set('mes', mes.toString());
    if (filtroSetor) params.set('setor', filtroSetor);
    if (filtroEmpresa) params.set('empresa', filtroEmpresa);

    api(`/vendedores?${params}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then(setVendedores)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    carregarVendedores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ano, mes, filtroSetor, filtroEmpresa]);

  // Revalidação: ao voltar pra essa aba (ex: depois de mexer em Vínculos na Configuração),
  // busca os dados de novo sem precisar de F5.
  useEffect(() => {
    const revalidar = () => { if (document.visibilityState === 'visible') carregarVendedores(); };
    window.addEventListener('focus', revalidar);
    document.addEventListener('visibilitychange', revalidar);
    return () => {
      window.removeEventListener('focus', revalidar);
      document.removeEventListener('visibilitychange', revalidar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ano, mes, filtroSetor, filtroEmpresa]);

  // Lógica para vendedores normais (não-Televendas): compara total_vendas vs metas
  const getFaixa = (vendedor: string, totalVendas: number) => {
    const m = metasMap[vendedor];
    if (!m) return null;
    const tiers = [
      { label: 'Meta 3', valor: Number(m.meta3_valor), percentual: Number(m.meta3_percentual) },
      { label: 'Meta 2', valor: Number(m.meta2_valor), percentual: Number(m.meta2_percentual) },
      { label: 'Meta 1', valor: Number(m.meta1_valor), percentual: Number(m.meta1_percentual) },
    ];
    const atingida = tiers.find((t) => t.valor > 0 && totalVendas >= t.valor) || null;
    const proxima = [...tiers].reverse().find((t) => t.valor > 0 && totalVendas < t.valor) || null;
    const referencia = proxima?.valor || atingida?.valor || 0;
    return {
      atingida,
      referencia,
      comissao: atingida ? (totalVendas * atingida.percentual) / 100 : null,
    };
  };

  // Lógica Televendas: compara valor_pa vs metas, comissão sobre recebimentos
  const getComissaoTV = (v: ResumoVendedor) => {
    const m = metasMap[v.vendedor];
    if (!m) return null;
    const metaConfig: MetaConfig = {
      meta1_valor: Number(m.meta1_valor), meta1_percentual: Number(m.meta1_percentual),
      meta2_valor: Number(m.meta2_valor), meta2_percentual: Number(m.meta2_percentual),
      meta3_valor: Number(m.meta3_valor), meta3_percentual: Number(m.meta3_percentual),
      percentual_sem_meta: Number(m.percentual_sem_meta ?? 0),
    };
    return calcularComissaoTelevendas(v.valor_pa, v.total_recebido, metaConfig, bonusConfig);
  };

  // Lógica Ferragens: comissão baseada em total_vendas e total_recebido
  const vendasSetorFerragens = vendedores
    .filter(v => v.setor === 'FERRAGENS')
    .reduce((s, v) => s + v.total_vendas, 0);

  const getComissaoFerr = (v: ResumoVendedor) => {
    const mRec = ferrMetasMap[v.vendedor];
    const bRec = ferrBonusMap[v.vendedor];
    if (!mRec) return null;
    const metaCfg: FerrMetaConfig = {
      meta1_valor: Number(mRec.meta1_valor), meta1_percentual: Number(mRec.meta1_percentual),
      meta2_valor: Number(mRec.meta2_valor), meta2_percentual: Number(mRec.meta2_percentual),
      meta3_valor: Number(mRec.meta3_valor), meta3_percentual: Number(mRec.meta3_percentual),
      metadesafio_valor: Number(mRec.metadesafio_valor), metadesafio_percentual: Number(mRec.metadesafio_percentual),
      percentual_sem_meta: Number(mRec.percentual_sem_meta ?? 0),
    };
    const bonusCfg: FerrBonusConfig | null = bRec ? {
      bonus1_valor: Number(bRec.bonus1_valor),
      bonus2_valor: Number(bRec.bonus2_valor),
      bonus3_valor: Number(bRec.bonus3_valor),
      bonusdesafio_valor: Number(bRec.bonusdesafio_valor),
    } : null;
    return calcularComissaoFerragens(v.total_vendas, v.total_recebido, metaCfg, bonusCfg, vendasSetorFerragens, ferrMetaGrupo);
  };

  // Lógica Distribuidores: igual Ferragens (meta sobre total_vendas, comissão % sobre recebido + bônus por faixa)
  const getComissaoDist = (v: ResumoVendedor) => {
    const mRec = distMetasMap[v.vendedor];
    if (!mRec) return null;
    const bRec = distBonusMap[v.vendedor];
    const metaCfg: DistMetaConfig = {
      meta1_valor: Number(mRec.meta1_valor), meta1_percentual: Number(mRec.meta1_percentual),
      meta2_valor: Number(mRec.meta2_valor), meta2_percentual: Number(mRec.meta2_percentual),
      meta3_valor: Number(mRec.meta3_valor), meta3_percentual: Number(mRec.meta3_percentual),
      metadesafio_valor: Number(mRec.metadesafio_valor), metadesafio_percentual: Number(mRec.metadesafio_percentual),
      percentual_sem_meta: Number(mRec.percentual_sem_meta ?? 0),
    };
    const bonusCfg: DistBonusConfig | null = bRec ? {
      bonus1_valor: Number(bRec.bonus1_valor),
      bonus2_valor: Number(bRec.bonus2_valor),
      bonus3_valor: Number(bRec.bonus3_valor),
      bonusdesafio_valor: Number(bRec.bonusdesafio_valor),
    } : null;
    return calcularComissaoDistribuidores(v.total_vendas, v.total_recebido, metaCfg, bonusCfg);
  };

  const vendedoresFiltrados = vendedores.filter((v) =>
    !busca || v.vendedor.toLowerCase().includes(busca.toLowerCase())
  );

  const totalVendas = vendedoresFiltrados.reduce((s, v) => s + v.total_vendas, 0);
  const totalPA = vendedoresFiltrados.reduce((s, v) => s + (v.setor === 'FERRAGENS' ? 0 : (v.valor_pa ?? 0)), 0);
  const todasTelevendas = vendedoresFiltrados.length > 0 && vendedoresFiltrados.every((v) => v.is_televendas);
  const algumaTelevendas = vendedoresFiltrados.some((v) => v.is_televendas);
  const totalEquipeExibido = todasTelevendas ? totalPA : totalVendas;
  const totalComissoes = vendedoresFiltrados.reduce((s, v) => {
    if (v.setor === 'FERRAGENS') return s + (getComissaoFerr(v)?.comissao_total ?? 0);
    if (v.setor === 'DISTRIBUIDORES') return s + (getComissaoDist(v)?.comissao_total ?? 0);
    if (v.is_televendas) return s + (getComissaoTV(v)?.comissao_total ?? 0);
    return s + (getFaixa(v.vendedor, v.total_vendas)?.comissao ?? 0);
  }, 0);

  // Remove o prefixo do setor (primeira palavra) e trunca o restante
  const nomeAbrev = (vendedor: string) => {
    const partes = vendedor.split(' ');
    const nome = partes.slice(1).join(' ') || partes[0];
    return nome.length > 14 ? nome.substring(0, 14) + '…' : nome;
  };

  const isSetorTelevendas = filtroSetor === 'TELEVENDAS' || filtroSetor === 'TELEVENDAS MG';
  const isSetorFaturamentoTotal = filtroSetor === 'FERRAGENS' || filtroSetor === 'DISTRIBUIDORES';
  const legendaFaturamento = isSetorFaturamentoTotal
    ? 'Faturamento'
    : isSetorTelevendas
      ? 'Venda PA'
      : 'Faturamento (ou PA)';
  const labelColunaVendas = isSetorFaturamentoTotal
    ? 'Faturamento'
    : isSetorTelevendas
      ? 'Venda PA'
      : 'Vendas';

  const top8Grafico = vendedoresFiltrados.slice(0, 8).map((v) => ({
    name: v.is_televendas ? `${nomeAbrev(v.vendedor)} (PA)` : nomeAbrev(v.vendedor),
    Faturamento: v.is_televendas ? (v.valor_pa ?? 0) : v.total_vendas,
    Recebimento: v.total_recebido ?? 0,
  }));

  const exportCSV = () => {
    const header = ['Vendedor', 'Setor', 'Total Vendas', 'Valor PA', 'Recebimentos', 'Meta Atingida', 'Comissão (R$)'].join(';');
    const rows = vendedoresFiltrados.map((v) => {
      let metaLabel = '-', comissao = '-';
      if (v.setor === 'FERRAGENS') {
        const cf = getComissaoFerr(v);
        metaLabel = cf?.meta_atingida?.label || '-';
        comissao = cf ? cf.comissao_total.toFixed(2) : '-';
      } else if (v.setor === 'DISTRIBUIDORES') {
        const cd = getComissaoDist(v);
        metaLabel = cd?.meta_atingida?.label || '-';
        comissao = cd ? cd.comissao_total.toFixed(2) : '-';
      } else if (v.is_televendas) {
        const ctv = getComissaoTV(v);
        metaLabel = ctv?.meta_atingida?.label || '-';
        comissao = ctv ? ctv.comissao_total.toFixed(2) : '-';
      } else {
        const f = getFaixa(v.vendedor, v.total_vendas);
        metaLabel = f?.atingida?.label || '-';
        comissao = f?.comissao != null ? f.comissao.toFixed(2) : '-';
      }
      return [
        v.vendedor, v.setor,
        v.total_vendas.toFixed(2),
        (v.valor_pa ?? 0).toFixed(2),
        (v.total_recebido ?? 0).toFixed(2),
        metaLabel, comissao,
      ].join(';');
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vendedores_${ano}${mes ? `_${MESES[mes - 1]}` : ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell loading={loading}>
      <div className="p-6 space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: '#00205C' }}>
              Painel do Gestor
            </h1>
            <p className="text-sm" style={{ color: '#64748b' }}>
              Acompanhe o desempenho da equipe
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Filtros */}
            <div className="relative">
              <select
                value={filtroSetor}
                onChange={(e) => setFiltroSetor(e.target.value)}
                className="appearance-none rounded-lg pl-8 pr-8 py-2 text-sm font-medium cursor-pointer"
                style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#00205C' }}
              >
                <option value="">Todos os setores</option>
                {setores.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <Filter size={13} className="absolute left-2.5 top-3 pointer-events-none" style={{ color: '#64748b' }} />
              <ChevronDown size={14} className="absolute right-2 top-3 pointer-events-none" style={{ color: '#64748b' }} />
            </div>

            <div className="relative">
              <select
                value={filtroEmpresa}
                onChange={(e) => setFiltroEmpresa(e.target.value)}
                className="appearance-none rounded-lg px-3 py-2 pr-8 text-sm font-medium cursor-pointer"
                style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#00205C' }}
              >
                <option value="">Todas as empresas</option>
                {empresas.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
              <ChevronDown size={14} className="absolute right-2 top-3 pointer-events-none" style={{ color: '#64748b' }} />
            </div>

            <div className="relative">
              <select
                value={mes || ''}
                onChange={(e) => setMes(e.target.value ? parseInt(e.target.value) : null)}
                className="appearance-none rounded-lg px-3 py-2 pr-8 text-sm font-medium cursor-pointer"
                style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#00205C' }}
              >
                <option value="">Todos os meses</option>
                {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
              <ChevronDown size={14} className="absolute right-2 top-3 pointer-events-none" style={{ color: '#64748b' }} />
            </div>

            <div className="relative">
              <select
                value={ano}
                onChange={(e) => setAno(parseInt(e.target.value))}
                className="appearance-none rounded-lg px-3 py-2 pr-8 text-sm font-medium cursor-pointer"
                style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#00205C' }}
              >
                {ANOS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <ChevronDown size={14} className="absolute right-2 top-3 pointer-events-none" style={{ color: '#64748b' }} />
            </div>

            <button
              onClick={exportCSV}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
              style={{ background: '#FFD700', color: '#00205C' }}
            >
              <Download size={14} />
              Exportar CSV
            </button>
          </div>
        </div>

        {/* KPI resumo */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl p-5 shadow-sm" style={{ background: '#00205C' }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#94a3b8' }}>
              {todasTelevendas ? 'Total PA (Equipe)' : algumaTelevendas ? 'Total Vendas / PA (Equipe)' : 'Total Vendas (Equipe)'}
            </p>
            <p className="text-2xl font-bold mt-2 text-white">{formatBRL(totalEquipeExibido)}</p>
            {algumaTelevendas && !todasTelevendas && (
              <p className="text-xs mt-0.5" style={{ color: '#94a3b8' }}>
                PA: {formatBRL(totalPA)}
              </p>
            )}
            <p className="text-xs mt-1" style={{ color: '#FFD700' }}>
              {filtroSetor || 'Todos os setores'} — {ano}{mes ? ` / ${MESES[mes - 1]}` : ''}
            </p>
          </div>
          <div className="rounded-xl p-5 shadow-sm" style={{ background: '#FFD700' }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#00205C' }}>
              Total Comissões Estimadas
            </p>
            <p className="text-2xl font-bold mt-2" style={{ color: '#00205C' }}>{formatBRL(totalComissoes)}</p>
            <p className="text-xs mt-1" style={{ color: '#1a3a6e' }}>
              Calculado com configurações ativas
            </p>
          </div>
          <div className="rounded-xl p-5 shadow-sm" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#64748b' }}>
              Vendedores na Equipe
            </p>
            <p className="text-2xl font-bold mt-2" style={{ color: '#00205C' }}>{formatNumber(vendedoresFiltrados.length)}</p>
            <p className="text-xs mt-1" style={{ color: '#94a3b8' }}>
              Com vendas no período
            </p>
          </div>
        </div>

        {/* Gráfico Top vendedores */}
        <div className="rounded-xl p-5 shadow-sm" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold" style={{ color: '#00205C' }}>
              Top 8 Vendedores — Faturamento e Recebimento
            </h2>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ background: '#00205C' }} />
                <span className="text-xs" style={{ color: '#64748b' }}>{legendaFaturamento}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ background: '#FFD700' }} />
                <span className="text-xs" style={{ color: '#64748b' }}>Recebimento</span>
              </div>
            </div>
          </div>
          {loading ? (
            <div className="h-48 flex items-center justify-center text-sm" style={{ color: '#94a3b8' }}>Carregando...</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={top8Grafico} barCategoryGap="25%" barGap={3}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.18 / 10000) * 10000]}
                />
                <Tooltip
                  formatter={(v, name) => [formatBRL(Number(v)), String(name)]}
                  contentStyle={{ background: '#0a1628', border: 'none', borderRadius: 8 }}
                  labelStyle={{ color: '#ffffff' }}
                  itemStyle={{ color: '#ffffff' }}
                />
                <Bar dataKey="Faturamento" fill="#00205C" radius={[3, 3, 0, 0]}>
                  <LabelList
                    dataKey="Faturamento"
                    position="insideTop"
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(v: any) => v > 0 ? `${(Number(v) / 1000).toFixed(0)}k` : ''}
                    style={{ fontSize: 9, fill: '#ffffff', fontWeight: 600 }}
                  />
                </Bar>
                <Bar dataKey="Recebimento" fill="#FFD700" radius={[3, 3, 0, 0]}>
                  <LabelList
                    dataKey="Recebimento"
                    position="insideTop"
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(v: any) => v > 0 ? `${(Number(v) / 1000).toFixed(0)}k` : ''}
                    style={{ fontSize: 9, fill: '#00205C', fontWeight: 600 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Tabela completa */}
        <div className="rounded-xl shadow-sm overflow-hidden" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #e2e8f0' }}>
            <h2 className="text-sm font-semibold" style={{ color: '#00205C' }}>
              Desempenho da Equipe — {vendedoresFiltrados.length} vendedores
            </h2>
            <input
              type="text"
              placeholder="Buscar vendedor..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="text-sm rounded-lg px-3 py-1.5 outline-none"
              style={{ border: '1px solid #e2e8f0', color: '#00205C', width: 200 }}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {[
                    { label: '#', align: 'left' },
                    { label: 'Vendedor', align: 'left' },
                    { label: 'Setor', align: 'left' },
                    { label: labelColunaVendas, align: 'center' },
                    { label: 'Meta Atingida', align: 'left' },
                    { label: 'Comissão Est.', align: 'center' },
                    { label: 'Atingimento', align: 'left' },
                  ].map(({ label, align }) => (
                    <th key={label} className={`text-${align} px-4 py-3 font-semibold`} style={{ color: '#64748b' }}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading || !ferrCarregado || !distCarregado ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8" style={{ color: '#94a3b8' }}>Carregando...</td>
                  </tr>
                ) : vendedoresFiltrados.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8" style={{ color: '#94a3b8' }}>Nenhum vendedor encontrado</td>
                  </tr>
                ) : (
                  vendedoresFiltrados.map((v, i) => {
                    const isFerragens = v.setor === 'FERRAGENS';
                    const isDist = v.setor === 'DISTRIBUIDORES';
                    const cferr = isFerragens ? getComissaoFerr(v) : null;
                    const cdist = isDist ? getComissaoDist(v) : null;
                    const ctv = !isFerragens && !isDist && v.is_televendas ? getComissaoTV(v) : null;
                    const f = !isFerragens && !isDist && !v.is_televendas ? getFaixa(v.vendedor, v.total_vendas) : null;

                    // Coluna "Total Vendas"
                    const vendaCell = isFerragens || isDist ? (
                      <div>
                        <span className="font-semibold" style={{ color: '#00205C' }}>{formatBRL(v.total_vendas)}</span>
                        {v.total_recebido > 0 && (
                          <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>Rec: {formatBRL(v.total_recebido)}</p>
                        )}
                      </div>
                    ) : v.is_televendas ? (
                      <div>
                        <span className="font-semibold" style={{ color: '#00205C' }}>{formatBRL(v.valor_pa)}</span>
                        <span className="ml-1 text-xs font-normal px-1 rounded" style={{ background: '#eff6ff', color: '#1d4ed8' }}>PA</span>
                        {v.total_recebido > 0 && (
                          <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>Rec: {formatBRL(v.total_recebido)}</p>
                        )}
                      </div>
                    ) : (
                      <span className="font-semibold" style={{ color: '#00205C' }}>{formatBRL(v.total_vendas)}</span>
                    );

                    // Meta atingida — só considera "cadastrada" se tiver ao menos um valor real > 0
                    const mTV = !isFerragens && !isDist ? metasMap[v.vendedor] : undefined;
                    const mFerr = isFerragens ? ferrMetasMap[v.vendedor] : undefined;
                    const mDist = isDist ? distMetasMap[v.vendedor] : undefined;
                    const temMetaCadastrada = isFerragens
                      ? !!(mFerr && (mFerr.meta1_valor > 0 || mFerr.meta2_valor > 0 || mFerr.meta3_valor > 0 || mFerr.metadesafio_valor > 0))
                      : isDist
                        ? !!(mDist && (mDist.meta1_valor > 0 || mDist.meta2_valor > 0 || mDist.meta3_valor > 0 || mDist.metadesafio_valor > 0))
                        : !!(mTV && (mTV.meta1_valor > 0 || mTV.meta2_valor > 0 || mTV.meta3_valor > 0));
                    const metaLabel = isFerragens ? cferr?.meta_atingida?.label : isDist ? cdist?.meta_atingida?.label : v.is_televendas ? ctv?.meta_atingida?.label : f?.atingida?.label;
                    const metaValor = isFerragens ? cferr?.meta_atingida?.valor : isDist ? cdist?.meta_atingida?.valor : v.is_televendas ? ctv?.meta_atingida?.valor : f?.atingida?.valor;

                    // Comissão estimada — sem meta = 0; com meta sem faixa = percentual_sem_meta
                    const comissaoDisplay = !temMetaCadastrada
                      ? 0
                      : isFerragens
                        ? (cferr?.comissao_total ?? 0)
                        : isDist
                          ? (cdist?.comissao_total ?? 0)
                          : v.is_televendas
                            ? (ctv?.comissao_total ?? 0)
                            : f?.comissao != null
                              ? f.comissao
                              : (Number(mTV?.percentual_sem_meta ?? 0) / 100) * v.total_vendas;

                    // Atingimento (barra de progresso)
                    const metaRef = isFerragens
                      ? (Number(ferrMetasMap[v.vendedor]?.meta1_valor) || 0)
                      : isDist
                        ? (Number(distMetasMap[v.vendedor]?.meta1_valor) || 0)
                        : v.is_televendas
                          ? (Number(metasMap[v.vendedor]?.meta1_valor) || 0)
                          : (f?.referencia ?? 0);
                    const realizado = isFerragens || isDist ? v.total_vendas : v.is_televendas ? v.valor_pa : v.total_vendas;
                    const pct = metaRef > 0 ? Math.min((realizado / metaRef) * 100, 100) : 0;

                    return (
                      <tr
                        key={i}
                        style={{ borderTop: '1px solid #f1f5f9' }}
                        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#f8fafc')}
                        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '')}
                      >
                        <td className="px-4 py-3 font-bold" style={{ color: i < 3 ? '#FFD700' : '#94a3b8' }}>
                          {i + 1}
                        </td>
                        <td className="px-4 py-3 font-medium" style={{ color: '#0a1628', maxWidth: 200 }}>
                          {v.vendedor}
                        </td>
                        <td className="px-4 py-3" style={{ color: '#64748b' }}>{v.setor}</td>
                        <td className="px-4 py-3 text-center">
                          {vendaCell}
                        </td>
                        <td className="px-4 py-3">
                          {metaLabel ? (
                            <div>
                              <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: '#d1fae5', color: '#065f46' }}>
                                {metaLabel}
                              </span>
                              {metaValor ? <p className="text-xs mt-0.5" style={{ color: '#94a3b8' }}>{formatBRL(metaValor)}</p> : null}
                            </div>
                          ) : temMetaCadastrada ? (
                            <span className="text-xs" style={{ color: '#94a3b8' }}>Nenhuma</span>
                          ) : (
                            <span className="text-xs font-medium" style={{ color: '#f59e0b' }}>Meta não definida</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center font-semibold" style={{ color: '#16a34a' }}>
                          {formatBRL(comissaoDisplay)}
                        </td>
                        <td className="px-4 py-3" style={{ minWidth: 120 }}>
                          {metaRef > 0 ? (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#f1f5f9' }}>
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${pct}%`, background: pct >= 100 ? '#16a34a' : pct >= 70 ? '#FFD700' : '#00205C' }}
                                />
                              </div>
                              <span className="text-xs shrink-0" style={{ color: '#64748b' }}>{pct.toFixed(0)}%</span>
                            </div>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
