import { useCallback, useEffect, useState, useRef } from 'react';
import AppShell from './layout/AppShell';
import KPICard from './ui/KPICard';
import { formatBRL, formatNumber, MESES } from './_shared/format';
import { DollarSign, TrendingUp, ChevronDown, Search, User } from 'lucide-react';
import { useComissaoUser as useUser, useComissaoApi } from './_shared/hooks';
import { calcularComissaoTelevendas, type MetaConfig, type BonusConfig } from './_shared/commission';
import { calcularComissaoFerragens, type FerrMetaConfig, type FerrBonusConfig, type FerrMetaGrupoConfig, type ComissaoFerragens } from './_shared/commission-ferragens';
import { calcularComissaoDistribuidores, type DistMetaConfig, type DistBonusConfig, type ComissaoDistribuidores } from './_shared/commission-distribuidores';

const ANO_ATUAL = new Date().getFullYear();
const ANOS = [ANO_ATUAL, ANO_ATUAL - 1, ANO_ATUAL - 2];

interface VendedorData {
  resumo: Array<{ vendedor: string; setor: string; empresa: string; total_vendas: number }>;
  mensal: Array<{ mes: number; total_vendas: number }>;
  porSubgrupo: Array<{ subgrupo: string; total_vendas: number }>;
  meta_vendedor?: {
    meta1_valor: number; meta1_percentual: number;
    meta2_valor: number; meta2_percentual: number;
    meta3_valor: number; meta3_percentual: number;
    percentual_sem_meta?: number;
  } | null;
  is_televendas?: boolean;
  is_ferragens?: boolean;
  is_distribuidores?: boolean;
  valor_pa?: number;
  valor_chave?: number;
  valor_ferragens_pa?: number;
  valor_mercadoria?: number;
  total_recebido?: number;
  bonus_config?: BonusConfig | null;
  comissao_televendas?: {
    valor_pa: number; total_recebido: number;
    meta_atingida: { label: string; valor: number; percentual: number } | null;
    comissao_meta: number; percentual_sem_meta: number;
    bonus_desbloqueado: boolean;
    bonus_tier: { label: string; valor: number; percentual: number } | null;
    comissao_bonus: number; comissao_total: number;
  } | null;
  comissao_ferragens?: ComissaoFerragens | null;
  ferr_meta?: FerrMetaConfig | null;
  ferr_bonus?: FerrBonusConfig | null;
  ferr_meta_grupo?: FerrMetaGrupoConfig | null;
  vendas_setor_ferragens?: number;
  comissao_distribuidores?: ComissaoDistribuidores | null;
  dist_meta?: DistMetaConfig | null;
  dist_bonus?: DistBonusConfig | null;
}

interface ComissaoConfig { setor: string; percentual: number; meta_mensal: number; }

function contarDiasUteis(ano: number, mes: number, ate?: number): number {
  const totalDias = new Date(ano, mes, 0).getDate();
  const limite = ate ?? totalDias;
  let count = 0;
  for (let d = 1; d <= limite; d++) {
    const dow = new Date(ano, mes - 1, d).getDay(); // 0=Dom, 6=Sáb
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

const CORES_FAIXA = [
  { bg: '#eff6ff', fill: '#3b82f6', text: '#1e40af', bar: '#dbeafe' },
  { bg: '#f0fdf4', fill: '#16a34a', text: '#065f46', bar: '#d1fae5' },
  { bg: '#fffbeb', fill: '#f59e0b', text: '#92400e', bar: '#fef3c7' },
  { bg: '#fdf4ff', fill: '#a855f7', text: '#6b21a8', bar: '#e9d5ff' },
];

export default function ComissaoVendedor() {
  const usuario = useUser();
  const api = useComissaoApi();
  const [vendedores, setVendedores] = useState<string[]>([]);
  const [vendedorSel, setVendedorSel] = useState('');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(false);
  const [ano, setAno] = useState(ANO_ATUAL);
  const [mes, setMes] = useState<number | null>(new Date().getMonth() + 1);
  const [data, setData] = useState<VendedorData | null>(null);
  const [comissoes, setComissoes] = useState<ComissaoConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isVendedor = usuario && usuario !== 'loading' && usuario.cargo === 'VENDEDOR' && vendedores.length <= 1;

  const carregarVendedores = useCallback(() => {
    api('/filtros', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        const lista: string[] = d.vendedores || [];
        setVendedores(lista);
        setVendedorSel((atual) => {
          if (atual && lista.includes(atual)) return atual;
          const primeiro = lista[0] ?? '';
          setBusca(primeiro);
          return primeiro;
        });
      });
  }, [api]);

  useEffect(() => {
    carregarVendedores();
    api('/config-setor')
      .then((r) => r.json())
      .then(setComissoes)
      .catch(() => {});
  }, [api, carregarVendedores]);

  // Revalidação: ao voltar pra essa aba (ex: depois de mexer em Vínculos na Configuração),
  // busca a lista de vendedores de novo sem precisar de F5.
  useEffect(() => {
    const revalidar = () => { if (document.visibilityState === 'visible') carregarVendedores(); };
    window.addEventListener('focus', revalidar);
    document.addEventListener('visibilitychange', revalidar);
    return () => {
      window.removeEventListener('focus', revalidar);
      document.removeEventListener('visibilitychange', revalidar);
    };
  }, [carregarVendedores]);

  useEffect(() => {
    if (!vendedorSel) return;
    setLoading(true);
    const params = new URLSearchParams({ ano: ano.toString() });
    if (mes) params.set('mes', mes.toString());
    api(`/vendedor/${encodeURIComponent(vendedorSel)}?${params}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [api, vendedorSel, ano, mes]);

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setAberto(false);
        setBusca(vendedorSel);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [vendedorSel]);

  const selecionar = (v: string) => {
    setVendedorSel(v);
    setBusca(v);
    setAberto(false);
  };

  const vendedoresFiltrados = vendedores.filter((v) =>
    v.toLowerCase().includes(busca.toLowerCase())
  );

  const resumo = Array.isArray(data?.resumo) ? data.resumo : [];
  const totalVendas = resumo.reduce((s, r) => s + r.total_vendas, 0) || 0;
  const setor = resumo[0]?.setor || '';
  const metaIndividual = data?.meta_vendedor;
  const comissaoConfigSetor = comissoes.find((c) => c.setor === setor);

  type FaixaMeta = { valor: number; percentual: number; label: string };
  const faixas: FaixaMeta[] = metaIndividual
    ? [
        { valor: metaIndividual.meta1_valor, percentual: metaIndividual.meta1_percentual, label: 'Meta 1' },
        { valor: metaIndividual.meta2_valor, percentual: metaIndividual.meta2_percentual, label: 'Meta 2' },
        { valor: metaIndividual.meta3_valor, percentual: metaIndividual.meta3_percentual, label: 'Meta 3' },
      ]
    : comissaoConfigSetor
    ? [{ valor: comissaoConfigSetor.meta_mensal, percentual: comissaoConfigSetor.percentual, label: 'Meta' }]
    : [];

  const isTelevendas = data?.is_televendas ?? false;
  const isFerragens = data?.is_ferragens ?? false;
  const isDistribuidores = data?.is_distribuidores ?? false;
  const bonusConfigData: BonusConfig | null = data?.bonus_config ?? null;
  const valorPAAtual = data?.valor_pa ?? 0;
  const recebidoAtual = data?.total_recebido ?? 0;

  // MetaConfig montado direto do meta_vendedor para garantir percentual_sem_meta correto
  const metaConfigObj: MetaConfig | null = metaIndividual ? {
    meta1_valor: metaIndividual.meta1_valor, meta1_percentual: metaIndividual.meta1_percentual,
    meta2_valor: metaIndividual.meta2_valor, meta2_percentual: metaIndividual.meta2_percentual,
    meta3_valor: metaIndividual.meta3_valor, meta3_percentual: metaIndividual.meta3_percentual,
    percentual_sem_meta: metaIndividual.percentual_sem_meta ?? 0,
  } : null;

  // Comissão Televendas
  const ctv = isTelevendas && mes
    ? calcularComissaoTelevendas(valorPAAtual, recebidoAtual, metaConfigObj, bonusConfigData)
    : null;

  // Ferragens — faixas de meta (4 níveis: M1, M2, M3, Desafio)
  const ferrMeta = data?.ferr_meta ?? null;
  const ferrBonus = data?.ferr_bonus ?? null;
  const ferrMetaGrupo = data?.ferr_meta_grupo ?? null;
  const ferrFaixas: { label: string; valor: number; percentual: number }[] = ferrMeta
    ? [
        { label: 'Meta 1', valor: ferrMeta.meta1_valor, percentual: ferrMeta.meta1_percentual },
        { label: 'Meta 2', valor: ferrMeta.meta2_valor, percentual: ferrMeta.meta2_percentual },
        { label: 'Meta 3', valor: ferrMeta.meta3_valor, percentual: ferrMeta.meta3_percentual },
        { label: 'Meta Desafio', valor: ferrMeta.metadesafio_valor, percentual: ferrMeta.metadesafio_percentual },
      ].filter(f => f.valor > 0)
    : [];
  const cfv = isFerragens && mes ? data?.comissao_ferragens ?? null : null;

  // Distribuidores — mesmas faixas de meta do Ferragens (4 níveis: M1, M2, M3, Desafio)
  const distMeta = data?.dist_meta ?? null;
  const distBonus = data?.dist_bonus ?? null;
  const distFaixas: { label: string; valor: number; percentual: number }[] = distMeta
    ? [
        { label: 'Meta 1', valor: distMeta.meta1_valor, percentual: distMeta.meta1_percentual },
        { label: 'Meta 2', valor: distMeta.meta2_valor, percentual: distMeta.meta2_percentual },
        { label: 'Meta 3', valor: distMeta.meta3_valor, percentual: distMeta.meta3_percentual },
        { label: 'Meta Desafio', valor: distMeta.metadesafio_valor, percentual: distMeta.metadesafio_percentual },
      ].filter(f => f.valor > 0)
    : [];
  const cdv = isDistribuidores && mes ? data?.comissao_distribuidores ?? null : null;

  const temMetaDefinida = isFerragens
    ? ferrFaixas.length > 0
    : isDistribuidores
    ? distFaixas.length > 0
    : faixas.some((f) => f.valor > 0);

  const compareRealizado = isTelevendas ? valorPAAtual : totalVendas;
  const faixasExibidas = isFerragens ? ferrFaixas : isDistribuidores ? distFaixas : faixas;
  const faixaAtingida = [...faixasExibidas].reverse().find((f) => f.valor > 0 && compareRealizado >= f.valor) || null;
  const comissaoValor = isTelevendas
    ? (ctv?.comissao_total ?? null)
    : isFerragens
    ? (cfv?.comissao_total ?? null)
    : isDistribuidores
    ? (cdv?.comissao_total ?? null)
    : faixaAtingida ? (totalVendas * faixaAtingida.percentual) / 100 : null;

  // Projeção do mês — baseada em dias úteis (seg–sex)
  const hoje = new Date();
  const mesSel = mes || hoje.getMonth() + 1;
  const anoSel = ano;
  const daysInMonth = new Date(anoSel, mesSel, 0).getDate();
  const isMesAtual = mesSel === hoje.getMonth() + 1 && anoSel === hoje.getFullYear();
  const diasUteisNoMes = contarDiasUteis(anoSel, mesSel);
  const diasUteisDecorridos = isMesAtual ? contarDiasUteis(anoSel, mesSel, hoje.getDate()) : diasUteisNoMes;
  const temProjecao = mes !== null && (isTelevendas ? valorPAAtual > 0 : totalVendas > 0) && diasUteisDecorridos > 0;
  const projecaoVendas = temProjecao && !isTelevendas ? (totalVendas / diasUteisDecorridos) * diasUteisNoMes : 0;
  const projecaoPA = temProjecao && isTelevendas ? (valorPAAtual / diasUteisDecorridos) * diasUteisNoMes : 0;
  const projecaoRecebidos = temProjecao && isTelevendas ? (recebidoAtual / diasUteisDecorridos) * diasUteisNoMes : 0;
  const ctvProjecao = isTelevendas && projecaoPA > 0
    ? calcularComissaoTelevendas(projecaoPA, projecaoRecebidos, metaConfigObj, bonusConfigData)
    : null;
  const projecaoExibida = isTelevendas ? projecaoPA : projecaoVendas;
  const faixaProjetada = temProjecao
    ? [...faixasExibidas].reverse().find((f) => f.valor > 0 && projecaoExibida >= f.valor) || null
    : null;
  const projecaoFerragens = isFerragens && projecaoVendas > 0
    ? calcularComissaoFerragens(projecaoVendas, recebidoAtual, ferrMeta, ferrBonus, data?.vendas_setor_ferragens ?? 0, ferrMetaGrupo)
    : null;
  const projecaoDistribuidores = isDistribuidores && projecaoVendas > 0
    ? calcularComissaoDistribuidores(projecaoVendas, recebidoAtual, distMeta, distBonus)
    : null;
  const projecaoComissao = isTelevendas
    ? (ctvProjecao?.comissao_total ?? null)
    : isFerragens
    ? (projecaoFerragens?.comissao_total ?? null)
    : isDistribuidores
    ? (projecaoDistribuidores?.comissao_total ?? null)
    : faixaProjetada ? (projecaoVendas * faixaProjetada.percentual) / 100 : null;

  return (
    <AppShell loading={loading}>
      <div className="p-6 space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: '#00205C' }}>Painel do Vendedor</h1>
            <p className="text-sm" style={{ color: '#64748b' }}>Suas vendas e comissões em tempo real</p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Slicer de vendedor */}
            {!isVendedor && (
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-2.5 pointer-events-none z-10" style={{ color: '#64748b' }} />
                <input
                  ref={inputRef}
                  type="text"
                  value={busca}
                  onChange={(e) => { setBusca(e.target.value); setAberto(true); }}
                  onFocus={() => { setBusca(''); setAberto(true); }}
                  placeholder="Buscar vendedor..."
                  className="rounded-lg pl-8 pr-3 py-2 text-sm font-medium w-64 outline-none"
                  style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#00205C' }}
                />
                {aberto && vendedoresFiltrados.length > 0 && (
                  <div
                    ref={dropdownRef}
                    className="absolute top-full left-0 mt-1 w-full rounded-lg z-50 overflow-hidden"
                    style={{
                      background: '#0a1628',
                      border: '1px solid #1a3a6e',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                      maxHeight: 240,
                      overflowY: 'auto',
                    }}
                  >
                    {vendedoresFiltrados.map((v) => (
                      <button
                        key={v}
                        onMouseDown={() => selecionar(v)}
                        className="w-full text-left px-3 py-2.5 text-xs transition-colors"
                        style={{
                          color: vendedorSel === v ? '#FFD700' : '#cbd5e1',
                          background: vendedorSel === v ? '#1a3a6e' : 'transparent',
                          borderBottom: '1px solid #1a3a6e20',
                        }}
                        onMouseEnter={(e) => { if (vendedorSel !== v) (e.currentTarget as HTMLElement).style.background = '#1a3a6e'; }}
                        onMouseLeave={(e) => { if (vendedorSel !== v) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

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
          </div>
        </div>

        {/* Vendedor Info Card */}
        {resumo[0] && (
          <div
            className="rounded-xl p-4 flex items-center gap-4"
            style={{ background: '#0a1628', border: '1px solid #1a3a6e' }}
          >
            <div
              className="flex items-center justify-center rounded-full shrink-0"
              style={{ width: 48, height: 48, background: '#FFD700' }}
            >
              <User size={24} color="#00205C" />
            </div>
            <div>
              <p className="font-bold text-white">{resumo[0].vendedor}</p>
              <p className="text-xs" style={{ color: '#94a3b8' }}>
                {resumo[0].setor}
              </p>
            </div>
            {faixaAtingida && (
              <div className="ml-auto text-right">
                <p className="text-xs" style={{ color: '#94a3b8' }}>{faixaAtingida.label} atingida</p>
                <p className="text-lg font-bold" style={{ color: '#FFD700' }}>{faixaAtingida.percentual}%</p>
              </div>
            )}
          </div>
        )}

        {/* KPI + Metas */}
        <div className="grid grid-cols-4 gap-4">
          <KPICard
            title={isTelevendas ? 'Total PA' : 'Total Vendido'}
            value={loading ? '...' : formatBRL(isTelevendas ? (data?.valor_pa ?? 0) : totalVendas)}
            subtitle={mes ? MESES[mes - 1] : `Ano ${ano}`}
            icon={<DollarSign size={18} />}
            accent
          />
          <KPICard
            title="Comissão Estimada"
            value={loading ? '...' : comissaoValor !== null ? formatBRL(comissaoValor) : temMetaDefinida ? '—' : 'Meta não definida'}
            subtitle={faixaAtingida ? `${faixaAtingida.percentual}% — ${faixaAtingida.label}` : temMetaDefinida ? 'Meta não batida' : 'Cadastre em Configuração'}
            icon={<TrendingUp size={18} />}
          />
          <div
            className="col-span-2 rounded-xl p-5 shadow-sm"
            style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}
          >
            <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: '#64748b' }}>
              Faixas de Meta
            </p>
            {faixasExibidas.length === 0 ? (
              <p className="text-sm" style={{ color: '#94a3b8' }}>Meta não configurada</p>
            ) : (
              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${faixasExibidas.length}, 1fr)` }}>
                {faixasExibidas.map((f, i) => {
                  const pct = f.valor > 0 ? Math.min((compareRealizado / f.valor) * 100, 100) : 0;
                  const atingida = f.valor > 0 && compareRealizado >= f.valor;
                  const cor = CORES_FAIXA[i] || CORES_FAIXA[0];
                  return (
                    <div key={i} className="rounded-lg p-3" style={{ background: cor.bg, border: `1px solid ${cor.bar}` }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold" style={{ color: cor.text }}>
                          {f.label}{atingida && <span className="ml-1">✓</span>}
                        </span>
                        <span className="text-xs font-bold" style={{ color: cor.text }}>{f.percentual}%</span>
                      </div>
                      <p className="text-xs mb-2" style={{ color: cor.text }}>
                        {f.valor > 0 ? formatBRL(f.valor) : '—'}
                      </p>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: cor.bar }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: cor.fill }} />
                      </div>
                      <p className="text-xs mt-1 text-right" style={{ color: cor.text }}>
                        {formatNumber(Math.round(pct))}%
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Comissão Televendas — bloco detalhado para TELEVENDAS / TELEVENDAS MG */}
        {isTelevendas && mes && ctv && (
          <div className="grid grid-cols-2 gap-4">

            {/* PA Breakdown */}
            <div className="rounded-xl p-5 shadow-sm" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
              <h2 className="text-sm font-bold mb-4" style={{ color: '#00205C' }}>Vendas PA — {MESES[mesSel - 1]}</h2>
              <div className="space-y-3">
                {[
                  { label: 'Chave', valor: data?.valor_chave ?? 0, color: '#1e40af', bg: '#eff6ff' },
                  { label: 'Ferragens PA', valor: data?.valor_ferragens_pa ?? 0, color: '#065f46', bg: '#f0fdf4' },
                  { label: 'Total PA', valor: ctv.valor_pa, color: '#00205C', bg: '#f8fafc', bold: true },
                  { label: 'Recebimentos', valor: ctv.total_recebido, color: '#92400e', bg: '#fffbeb' },
                ].map((row, i) => (
                  <div key={i} className="flex justify-between items-center py-1.5 px-3 rounded-lg text-sm"
                    style={{ background: row.bg }}>
                    <span style={{ color: '#64748b', fontWeight: row.bold ? 700 : 400 }}>{row.label}</span>
                    <span style={{ color: row.color, fontWeight: row.bold ? 700 : 600 }}>{formatBRL(row.valor)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Comissão Detalhada */}
            <div className="rounded-xl p-5 shadow-sm" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
              <h2 className="text-sm font-bold mb-4" style={{ color: '#00205C' }}>Comissão Televendas — {MESES[mesSel - 1]}</h2>

              {/* Meta PA */}
              <div className="rounded-lg p-3 mb-3" style={{
                background: ctv.meta_atingida ? '#f0fdf4' : '#fff1f2',
                border: `1px solid ${ctv.meta_atingida ? '#bbf7d0' : '#fecdd3'}`
              }}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold" style={{ color: ctv.meta_atingida ? '#065f46' : '#991b1b' }}>
                    {ctv.meta_atingida ? `${ctv.meta_atingida.label} atingida ✓` : 'Nenhuma meta PA atingida'}
                  </span>
                  {ctv.meta_atingida && (
                    <span className="text-xs font-bold" style={{ color: '#065f46' }}>
                      {ctv.meta_atingida.percentual}% × recebimentos
                    </span>
                  )}
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: '#64748b' }}>Comissão meta</span>
                  <span className="font-bold" style={{ color: ctv.meta_atingida ? '#16a34a' : '#dc2626' }}>
                    {formatBRL(ctv.comissao_meta)}
                  </span>
                </div>
                {!ctv.meta_atingida && ctv.percentual_sem_meta > 0 && (
                  <p className="text-xs mt-1" style={{ color: '#94a3b8' }}>
                    Aplicado {ctv.percentual_sem_meta}% (% sem meta) sobre recebimentos
                  </p>
                )}
              </div>

              {/* Bônus */}
              <div className="rounded-lg p-3 mb-3" style={{
                background: ctv.bonus_desbloqueado ? '#f0fdf4' : '#f8fafc',
                border: `1px solid ${ctv.bonus_desbloqueado ? '#bbf7d0' : '#e2e8f0'}`
              }}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold" style={{ color: ctv.bonus_desbloqueado ? '#065f46' : '#94a3b8' }}>
                    {ctv.bonus_desbloqueado
                      ? ctv.bonus_tier ? `${ctv.bonus_tier.label} atingida ✓` : 'Bônus desbloqueado'
                      : 'Bônus não desbloqueado'}
                  </span>
                  {ctv.bonus_tier && (
                    <span className="text-xs font-bold" style={{ color: '#065f46' }}>
                      {ctv.bonus_tier.percentual}% × valor PA
                    </span>
                  )}
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: '#64748b' }}>Comissão bônus</span>
                  <span className="font-bold" style={{ color: ctv.comissao_bonus > 0 ? '#16a34a' : '#94a3b8' }}>
                    {formatBRL(ctv.comissao_bonus)}
                  </span>
                </div>
              </div>

              {/* Total */}
              <div className="rounded-lg p-4 text-center"
                style={{ background: '#00205C', border: '1px solid #1a3a6e' }}>
                <p className="text-xs uppercase tracking-wide mb-1" style={{ color: '#94a3b8' }}>Total Comissão</p>
                <p className="text-2xl font-bold" style={{ color: '#FFD700' }}>
                  {formatBRL(ctv.comissao_total)}
                </p>
                <p className="text-xs mt-1" style={{ color: '#64748b' }}>
                  Meta + Bônus
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Comissão Ferragens — bloco detalhado para FERRAGENS */}
        {isFerragens && mes && cfv && (
          <div className="grid grid-cols-2 gap-4">

            {/* Vendas Breakdown */}
            <div className="rounded-xl p-5 shadow-sm" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
              <h2 className="text-sm font-bold mb-4" style={{ color: '#00205C' }}>Vendas Ferragens — {MESES[mesSel - 1]}</h2>
              <div className="space-y-3">
                {[
                  { label: 'Total Vendido', valor: cfv.vendas_total, color: '#00205C', bg: '#f8fafc', bold: true },
                  { label: 'Recebimentos', valor: cfv.recebido, color: '#92400e', bg: '#fffbeb' },
                  { label: 'Vendas do Setor', valor: data?.vendas_setor_ferragens ?? 0, color: '#1e40af', bg: '#eff6ff' },
                ].map((row, i) => (
                  <div key={i} className="flex justify-between items-center py-1.5 px-3 rounded-lg text-sm"
                    style={{ background: row.bg }}>
                    <span style={{ color: '#64748b', fontWeight: row.bold ? 700 : 400 }}>{row.label}</span>
                    <span style={{ color: row.color, fontWeight: row.bold ? 700 : 600 }}>{formatBRL(row.valor)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Comissão Detalhada */}
            <div className="rounded-xl p-5 shadow-sm" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
              <h2 className="text-sm font-bold mb-4" style={{ color: '#00205C' }}>Comissão Ferragens — {MESES[mesSel - 1]}</h2>

              {/* Meta atingida */}
              <div className="rounded-lg p-3 mb-3" style={{
                background: cfv.meta_atingida ? '#f0fdf4' : '#fff1f2',
                border: `1px solid ${cfv.meta_atingida ? '#bbf7d0' : '#fecdd3'}`
              }}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold" style={{ color: cfv.meta_atingida ? '#065f46' : '#991b1b' }}>
                    {cfv.meta_atingida ? `${cfv.meta_atingida.label} atingida ✓` : 'Nenhuma meta atingida'}
                  </span>
                  {cfv.meta_atingida && (
                    <span className="text-xs font-bold" style={{ color: '#065f46' }}>
                      {cfv.meta_atingida.percentual}% × recebimentos
                    </span>
                  )}
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: '#64748b' }}>Comissão meta</span>
                  <span className="font-bold" style={{ color: cfv.meta_atingida ? '#16a34a' : '#dc2626' }}>
                    {formatBRL(cfv.comissao_meta)}
                  </span>
                </div>
                {!cfv.meta_atingida && ferrMeta && ferrMeta.percentual_sem_meta > 0 && (
                  <p className="text-xs mt-1" style={{ color: '#94a3b8' }}>
                    Aplicado {ferrMeta.percentual_sem_meta}% (% sem meta) sobre recebimentos
                  </p>
                )}
              </div>

              {/* Bônus individual */}
              <div className="rounded-lg p-3 mb-3" style={{
                background: cfv.comissao_bonus > 0 ? '#f0fdf4' : '#f8fafc',
                border: `1px solid ${cfv.comissao_bonus > 0 ? '#bbf7d0' : '#e2e8f0'}`
              }}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold" style={{ color: cfv.comissao_bonus > 0 ? '#065f46' : '#94a3b8' }}>
                    {cfv.meta_atingida ? `Bônus ${cfv.meta_atingida.label}` : 'Bônus individual'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: '#64748b' }}>Bônus individual</span>
                  <span className="font-bold" style={{ color: cfv.comissao_bonus > 0 ? '#16a34a' : '#94a3b8' }}>
                    {formatBRL(cfv.comissao_bonus)}
                  </span>
                </div>
              </div>

              {/* Bônus grupo */}
              <div className="rounded-lg p-3 mb-3" style={{
                background: cfv.grupo_meta_atingida ? '#eff6ff' : '#f8fafc',
                border: `1px solid ${cfv.grupo_meta_atingida ? '#bfdbfe' : '#e2e8f0'}`
              }}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold" style={{ color: cfv.grupo_meta_atingida ? '#1e40af' : '#94a3b8' }}>
                    {cfv.grupo_meta_atingida ? `${cfv.grupo_meta_atingida.label} do setor atingida ✓` : 'Meta do setor não atingida'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: '#64748b' }}>Bônus grupo</span>
                  <span className="font-bold" style={{ color: cfv.comissao_grupo > 0 ? '#1e40af' : '#94a3b8' }}>
                    {formatBRL(cfv.comissao_grupo)}
                  </span>
                </div>
              </div>

              {/* Total */}
              <div className="rounded-lg p-4 text-center"
                style={{ background: '#00205C', border: '1px solid #1a3a6e' }}>
                <p className="text-xs uppercase tracking-wide mb-1" style={{ color: '#94a3b8' }}>Total Comissão</p>
                <p className="text-2xl font-bold" style={{ color: '#FFD700' }}>
                  {formatBRL(cfv.comissao_total)}
                </p>
                <p className="text-xs mt-1" style={{ color: '#64748b' }}>
                  Meta + Bônus individual + Bônus grupo
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Comissão Distribuidores — bloco detalhado para DISTRIBUIDORES */}
        {isDistribuidores && mes && cdv && (
          <div className="grid grid-cols-2 gap-4">

            {/* Vendas Breakdown */}
            <div className="rounded-xl p-5 shadow-sm" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
              <h2 className="text-sm font-bold mb-4" style={{ color: '#00205C' }}>Vendas Distribuidores — {MESES[mesSel - 1]}</h2>
              <div className="space-y-3">
                {[
                  { label: 'Total Vendido', valor: cdv.vendas_total, color: '#00205C', bg: '#f8fafc', bold: true },
                  { label: 'Recebimentos', valor: cdv.recebido, color: '#92400e', bg: '#fffbeb' },
                ].map((row, i) => (
                  <div key={i} className="flex justify-between items-center py-1.5 px-3 rounded-lg text-sm"
                    style={{ background: row.bg }}>
                    <span style={{ color: '#64748b', fontWeight: row.bold ? 700 : 400 }}>{row.label}</span>
                    <span style={{ color: row.color, fontWeight: row.bold ? 700 : 600 }}>{formatBRL(row.valor)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Comissão Detalhada */}
            <div className="rounded-xl p-5 shadow-sm" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
              <h2 className="text-sm font-bold mb-4" style={{ color: '#00205C' }}>Comissão Distribuidores — {MESES[mesSel - 1]}</h2>

              {/* Meta atingida */}
              <div className="rounded-lg p-3 mb-3" style={{
                background: cdv.meta_atingida ? '#f0fdf4' : '#fff1f2',
                border: `1px solid ${cdv.meta_atingida ? '#bbf7d0' : '#fecdd3'}`
              }}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold" style={{ color: cdv.meta_atingida ? '#065f46' : '#991b1b' }}>
                    {cdv.meta_atingida ? `${cdv.meta_atingida.label} atingida ✓` : 'Nenhuma meta atingida'}
                  </span>
                  {cdv.meta_atingida && (
                    <span className="text-xs font-bold" style={{ color: '#065f46' }}>
                      {cdv.meta_atingida.percentual}% × recebimentos
                    </span>
                  )}
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: '#64748b' }}>Comissão meta</span>
                  <span className="font-bold" style={{ color: cdv.meta_atingida ? '#16a34a' : '#dc2626' }}>
                    {formatBRL(cdv.comissao_meta)}
                  </span>
                </div>
                {!cdv.meta_atingida && distMeta && distMeta.percentual_sem_meta > 0 && (
                  <p className="text-xs mt-1" style={{ color: '#94a3b8' }}>
                    Aplicado {distMeta.percentual_sem_meta}% (% sem meta) sobre recebimentos
                  </p>
                )}
              </div>

              {/* Bônus individual */}
              <div className="rounded-lg p-3 mb-3" style={{
                background: cdv.comissao_bonus > 0 ? '#f0fdf4' : '#f8fafc',
                border: `1px solid ${cdv.comissao_bonus > 0 ? '#bbf7d0' : '#e2e8f0'}`
              }}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold" style={{ color: cdv.comissao_bonus > 0 ? '#065f46' : '#94a3b8' }}>
                    {cdv.meta_atingida ? `Bônus ${cdv.meta_atingida.label}` : 'Bônus individual'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: '#64748b' }}>Bônus individual</span>
                  <span className="font-bold" style={{ color: cdv.comissao_bonus > 0 ? '#16a34a' : '#94a3b8' }}>
                    {formatBRL(cdv.comissao_bonus)}
                  </span>
                </div>
              </div>

              {/* Total */}
              <div className="rounded-lg p-4 text-center"
                style={{ background: '#00205C', border: '1px solid #1a3a6e' }}>
                <p className="text-xs uppercase tracking-wide mb-1" style={{ color: '#94a3b8' }}>Total Comissão</p>
                <p className="text-2xl font-bold" style={{ color: '#FFD700' }}>
                  {formatBRL(cdv.comissao_total)}
                </p>
                <p className="text-xs mt-1" style={{ color: '#64748b' }}>
                  Meta + Bônus individual
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Projeções do Mês */}
        {temProjecao && (
          <div className="grid grid-cols-2 gap-4">

            {/* Projeção de Vendas / PA */}
            <div className="rounded-xl p-5 shadow-sm" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold" style={{ color: '#00205C' }}>
                  {isTelevendas ? 'Projeção de PA' : 'Projeção de Vendas'} — {MESES[mesSel - 1]}
                </h2>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#eff6ff', color: '#1e40af' }}>
                  Dia {hoje.getDate()}/{daysInMonth} • {diasUteisDecorridos}/{diasUteisNoMes} DU
                </span>
              </div>

              <p className="text-2xl font-bold mb-1" style={{ color: '#00205C' }}>
                {formatBRL(projecaoExibida)}
              </p>
              <p className="text-xs mb-4" style={{ color: '#64748b' }}>
                Ritmo: {formatBRL((isTelevendas ? valorPAAtual : totalVendas) / diasUteisDecorridos)}/dia útil &bull; Realizado: {formatBRL(isTelevendas ? valorPAAtual : totalVendas)}
              </p>

              {(() => {
                const realizadoExib = isTelevendas ? valorPAAtual : totalVendas;
                const metaRef = faixas.filter(f => f.valor > 0).sort((a,b) => b.valor - a.valor)[0]?.valor || projecaoExibida;
                const base = Math.max(projecaoExibida, metaRef) * 1.05;
                const pctReal = Math.min((realizadoExib / base) * 100, 100);
                const pctProj = Math.min((projecaoExibida / base) * 100, 100);
                return (
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-xs mb-1" style={{ color: '#64748b' }}>
                        <span>Realizado</span><span>{formatBRL(realizadoExib)}</span>
                      </div>
                      <div className="h-3 rounded-full overflow-hidden" style={{ background: '#f1f5f9' }}>
                        <div className="h-full rounded-full" style={{ width: `${pctReal}%`, background: '#00205C' }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1" style={{ color: '#64748b' }}>
                        <span>Projeção</span><span>{formatBRL(projecaoExibida)}</span>
                      </div>
                      <div className="h-3 rounded-full overflow-hidden" style={{ background: '#f1f5f9' }}>
                        <div className="h-full rounded-full" style={{ width: `${pctProj}%`, background: '#FFD700' }} />
                      </div>
                    </div>
                    {faixas.filter(f => f.valor > 0).map((f, i) => {
                      const atingeProj = projecaoExibida >= f.valor;
                      // % de progresso em direção a CADA meta individualmente (não posição na escala comum)
                      const pctMeta = Math.min((projecaoExibida / f.valor) * 100, 100);
                      return (
                        <div key={i}>
                          <div className="flex justify-between text-xs mb-1" style={{ color: '#64748b' }}>
                            <span>{f.label}</span>
                            <span style={{ color: atingeProj ? '#16a34a' : '#94a3b8' }}>
                              {formatBRL(f.valor)} {atingeProj ? '✓' : ''}
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#f1f5f9' }}>
                            <div className="h-full rounded-full" style={{ width: `${pctMeta}%`, background: atingeProj ? '#16a34a' : '#94a3b8' }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Projeção de Comissão */}
            <div className="rounded-xl p-5 shadow-sm" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold" style={{ color: '#00205C' }}>
                  Projeção de Comissão — {MESES[mesSel - 1]}
                </h2>
                {(isTelevendas ? ctvProjecao?.meta_atingida : faixaProjetada) && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: '#d1fae5', color: '#065f46' }}>
                    {isTelevendas ? ctvProjecao?.meta_atingida?.label : faixaProjetada?.label} projetada
                  </span>
                )}
              </div>

              <p className="text-2xl font-bold mb-1" style={{ color: projecaoComissao ? '#16a34a' : '#94a3b8' }}>
                {projecaoComissao ? formatBRL(projecaoComissao) : 'Nenhuma meta projetada'}
              </p>
              <p className="text-xs mb-4" style={{ color: '#64748b' }}>
                {isTelevendas
                  ? ctvProjecao?.meta_atingida
                    ? `${ctvProjecao.meta_atingida.percentual}% × recebimentos proj. (${formatBRL(projecaoRecebidos)})`
                    : 'Ritmo atual não atinge nenhuma meta PA'
                  : faixaProjetada
                    ? `${faixaProjetada.percentual}% sobre ${formatBRL(projecaoVendas)}`
                    : 'Ritmo atual não atinge nenhuma meta'}
              </p>

              {isTelevendas ? (
                ctvProjecao && (() => {
                  const maxComissao = Math.max(ctvProjecao.comissao_total, ctv?.comissao_total || 0) * 1.05 || 1;
                  return (
                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-xs mb-1" style={{ color: '#64748b' }}>
                          <span>Comissão atual</span>
                          <span>{ctv ? formatBRL(ctv.comissao_total) : '—'}</span>
                        </div>
                        <div className="h-3 rounded-full overflow-hidden" style={{ background: '#f1f5f9' }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.min(((ctv?.comissao_total || 0) / maxComissao) * 100, 100)}%`, background: '#00205C' }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1" style={{ color: '#64748b' }}>
                          <span>Comissão projetada</span>
                          <span style={{ color: '#16a34a', fontWeight: 600 }}>{formatBRL(ctvProjecao.comissao_total)}</span>
                        </div>
                        <div className="h-3 rounded-full overflow-hidden" style={{ background: '#f1f5f9' }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.min((ctvProjecao.comissao_total / maxComissao) * 100, 100)}%`, background: '#FFD700' }} />
                        </div>
                      </div>
                      <div className="pt-2 grid grid-cols-2 gap-2">
                        <div className="rounded-lg p-2 text-center" style={{ background: ctvProjecao.meta_atingida ? '#f0fdf4' : '#fff1f2', border: `1px solid ${ctvProjecao.meta_atingida ? '#bbf7d0' : '#fecdd3'}` }}>
                          <p className="text-xs font-semibold mb-0.5" style={{ color: ctvProjecao.meta_atingida ? '#065f46' : '#991b1b' }}>Meta projetada</p>
                          <p className="text-xs font-bold" style={{ color: ctvProjecao.meta_atingida ? '#065f46' : '#991b1b' }}>
                            {ctvProjecao.meta_atingida?.label ?? 'Nenhuma'}
                          </p>
                          <p className="text-sm font-bold mt-1" style={{ color: ctvProjecao.meta_atingida ? '#16a34a' : '#dc2626' }}>{formatBRL(ctvProjecao.comissao_meta)}</p>
                        </div>
                        <div className="rounded-lg p-2 text-center" style={{ background: ctvProjecao.bonus_desbloqueado ? '#f0fdf4' : '#f8fafc', border: `1px solid ${ctvProjecao.bonus_desbloqueado ? '#bbf7d0' : '#e2e8f0'}` }}>
                          <p className="text-xs font-semibold mb-0.5" style={{ color: ctvProjecao.bonus_desbloqueado ? '#065f46' : '#94a3b8' }}>Bônus projetado</p>
                          <p className="text-xs font-bold" style={{ color: ctvProjecao.bonus_desbloqueado ? '#065f46' : '#94a3b8' }}>
                            {ctvProjecao.bonus_tier?.label ?? (ctvProjecao.bonus_desbloqueado ? 'Sem tier' : 'Não desbloqueado')}
                          </p>
                          <p className="text-sm font-bold mt-1" style={{ color: ctvProjecao.bonus_desbloqueado ? '#16a34a' : '#94a3b8' }}>{formatBRL(ctvProjecao.comissao_bonus)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : (
                faixas.filter(f => f.valor > 0).length > 0 && (() => {
                  const comissoes_proj = faixas.filter(f => f.valor > 0).map(f => ({
                    ...f,
                    comissaoProjeto: projecaoVendas >= f.valor ? (projecaoVendas * f.percentual) / 100 : 0,
                    comissaoReal:    totalVendas  >= f.valor ? (totalVendas  * f.percentual) / 100 : 0,
                  }));
                  const maxComissao = Math.max(...comissoes_proj.map(c => c.comissaoProjeto), comissaoValor || 0) * 1.05 || 1;
                  return (
                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-xs mb-1" style={{ color: '#64748b' }}>
                          <span>Comissão atual</span>
                          <span>{comissaoValor ? formatBRL(comissaoValor) : '—'}</span>
                        </div>
                        <div className="h-3 rounded-full overflow-hidden" style={{ background: '#f1f5f9' }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.min(((comissaoValor || 0) / maxComissao) * 100, 100)}%`, background: '#00205C' }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1" style={{ color: '#64748b' }}>
                          <span>Comissão projetada</span>
                          <span style={{ color: '#16a34a', fontWeight: 600 }}>{projecaoComissao ? formatBRL(projecaoComissao) : '—'}</span>
                        </div>
                        <div className="h-3 rounded-full overflow-hidden" style={{ background: '#f1f5f9' }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.min(((projecaoComissao || 0) / maxComissao) * 100, 100)}%`, background: '#FFD700' }} />
                        </div>
                      </div>
                      <div className="pt-2 grid grid-cols-3 gap-2">
                        {faixas.filter(f => f.valor > 0).map((f, i) => {
                          const atingeProj = projecaoVendas >= f.valor;
                          const atingeReal = totalVendas >= f.valor;
                          const cor = CORES_FAIXA[i] || CORES_FAIXA[0];
                          return (
                            <div key={i} className="rounded-lg p-2 text-center" style={{ background: cor.bg, border: `1px solid ${cor.bar}` }}>
                              <p className="text-xs font-semibold mb-0.5" style={{ color: cor.text }}>{f.label}</p>
                              <p className="text-xs font-bold" style={{ color: cor.text }}>
                                {atingeProj ? formatBRL(projecaoVendas * f.percentual / 100) : '—'}
                              </p>
                              <p className="text-xs mt-0.5" style={{ color: atingeReal ? '#16a34a' : atingeProj ? '#f59e0b' : '#94a3b8' }}>
                                {atingeReal ? 'Atingida ✓' : atingeProj ? 'Projetada' : 'Não atingida'}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()
              )}
            </div>

          </div>
        )}

      </div>
    </AppShell>
  );
}
