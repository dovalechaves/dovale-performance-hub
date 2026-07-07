import { useEffect, useState } from 'react';
import AppShell from './layout/AppShell';
import KPICard from './ui/KPICard';
import { DashboardSummary } from './_shared/types';
import { formatBRL, formatNumber, MESES } from './_shared/format';
import { useComissaoApi } from './_shared/hooks';
import {
  DollarSign,
  Users,
  TrendingUp,
  Building2,
  RefreshCw,
  ChevronDown,
  ArrowUpRight,
  BarChart2,
  Wallet,
  Award,
} from 'lucide-react';

const ANO_ATUAL = new Date().getFullYear();
const ANOS = [ANO_ATUAL, ANO_ATUAL - 1, ANO_ATUAL - 2];

function contarDiasUteis(ano: number, mes: number, ate?: number): number {
  const totalDias = new Date(ano, mes, 0).getDate();
  const limite = ate ?? totalDias;
  let count = 0;
  for (let d = 1; d <= limite; d++) {
    const dow = new Date(ano, mes - 1, d).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

function ProjecaoCard({
  icon,
  title,
  atual,
  projecao,
  pctDU,
  duDecorridos,
  duTotal,
  isMesAtual,
  accentColor = '#00205C',
}: {
  icon: React.ReactNode;
  title: string;
  atual: number;
  projecao: number;
  pctDU: number;
  duDecorridos: number;
  duTotal: number;
  isMesAtual: boolean;
  accentColor?: string;
}) {
  return (
    <div className="rounded-xl p-5 shadow-sm flex flex-col gap-3"
      style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
      <div className="flex items-center gap-2">
        <span style={{ color: accentColor }}>{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#64748b' }}>
          {title}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-xs mb-0.5" style={{ color: '#94a3b8' }}>Até agora</p>
          <p className="text-lg font-bold leading-tight truncate" style={{ color: '#0a1628' }}>{formatBRL(atual)}</p>
        </div>
        {isMesAtual && (
          <div className="min-w-0">
            <p className="text-xs mb-0.5" style={{ color: '#94a3b8' }}>Projeção do mês</p>
            <div className="flex items-center gap-1">
              <ArrowUpRight size={13} style={{ color: '#16a34a', flexShrink: 0 }} />
              <p className="text-base font-bold leading-tight truncate" style={{ color: '#16a34a' }}>{formatBRL(projecao)}</p>
            </div>
          </div>
        )}
      </div>

      {isMesAtual && (
        <>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#f1f5f9' }}>
            <div className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(pctDU, 100)}%`, background: accentColor }} />
          </div>
          <p className="text-xs" style={{ color: '#94a3b8' }}>
            {duDecorridos} de {duTotal} dias úteis &nbsp;·&nbsp; {pctDU.toFixed(0)}% do mês
          </p>
        </>
      )}
    </div>
  );
}

export default function ComissaoDashboard() {
  const api = useComissaoApi();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [ano, setAno] = useState(ANO_ATUAL);
  const [mes, setMes] = useState<number | null>(new Date().getMonth() + 1);

  const hoje = new Date();

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ ano: ano.toString() });
      if (mes) params.set('mes', mes.toString());
      const res = await api(`/dashboard?${params}`, { cache: 'no-store' });
      if (!res.ok) {
        setData(null);
        return;
      }
      const json = await res.json();
      setData(
        json && Array.isArray(json.vendas_por_setor) && Array.isArray(json.top_vendedores)
          ? json
          : null
      );
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ano, mes]);

  // Revalidação: ao voltar pra essa aba, busca os dados de novo sem precisar de F5.
  useEffect(() => {
    const revalidar = () => { if (document.visibilityState === 'visible') fetchData(); };
    window.addEventListener('focus', revalidar);
    document.addEventListener('visibilitychange', revalidar);
    return () => {
      window.removeEventListener('focus', revalidar);
      document.removeEventListener('visibilitychange', revalidar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ano, mes]);

  const SETOR_CORES: Record<string, string> = {
    'DISTRIBUIDORES': '#00205C',
    'FERRAGENS':       '#1e40af',
    'TELEVENDAS':      '#b45309',
    'TELEVENDAS MG':   '#065f46',
  };

  // Projeção (apenas mês atual)
  const isMesAtual = mes !== null && mes === hoje.getMonth() + 1 && ano === hoje.getFullYear();
  const duTotal = mes ? contarDiasUteis(ano, mes) : 0;
  const duDecorridos = isMesAtual && mes ? contarDiasUteis(ano, mes, hoje.getDate()) : duTotal;
  const pctDU = duTotal > 0 ? (duDecorridos / duTotal) * 100 : 0;
  const ratioProjecao = duDecorridos > 0 ? duTotal / duDecorridos : 1;

  const fatProjecao = (data?.total_vendas_mes ?? 0) * ratioProjecao;
  const paProjecao = (data?.total_pa_televendas ?? 0) * ratioProjecao;
  const recProjecao = (data?.total_recebimentos_televendas ?? 0) * ratioProjecao;
  const comProjecao = (data?.total_comissao_televendas ?? 0) * ratioProjecao;

  return (
    <AppShell loading={loading}>
      <div className="p-6 space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: '#00205C' }}>
              Dashboard de Vendas
            </h1>
            <p className="text-sm" style={{ color: '#64748b' }}>
              Acompanhe o desempenho em tempo real
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <select
                value={mes || ''}
                onChange={(e) => setMes(e.target.value ? parseInt(e.target.value) : null)}
                className="appearance-none rounded-lg px-3 py-2 pr-8 text-sm font-medium cursor-pointer"
                style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#00205C' }}
              >
                <option value="">Todos os meses</option>
                {MESES.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
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
                {ANOS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-2 top-3 pointer-events-none" style={{ color: '#64748b' }} />
            </div>

            <button
              onClick={fetchData}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              style={{ background: '#00205C', color: '#FFD700' }}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Atualizar
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <KPICard
            title="Total de Vendas"
            value={data ? formatBRL(data.total_vendas) : '—'}
            subtitle={`Ano ${ano}`}
            icon={<DollarSign size={18} />}
            accent
          />
          <KPICard
            title={mes ? `Vendas em ${MESES[mes - 1]}` : 'Vendas no Período'}
            value={data ? formatBRL(data.total_vendas_mes) : '—'}
            subtitle="Período selecionado"
            icon={<TrendingUp size={18} />}
          />
          <KPICard
            title="Vendedores Ativos"
            value={data ? formatNumber(data.total_vendedores) : '—'}
            subtitle={`No ano de ${ano}`}
            icon={<Users size={18} />}
          />
          <KPICard
            title="Setores"
            value={data ? formatNumber(data.total_setores) : '—'}
            subtitle="Canais de venda"
            icon={<Building2 size={18} />}
          />
        </div>

        {/* ── Projeções e Comissão (quando mês selecionado) ── */}
        {mes && !loading && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-bold" style={{ color: '#00205C' }}>
                {isMesAtual ? `Projeções — ${MESES[mes - 1]} ${ano}` : `Resumo — ${MESES[mes - 1]} ${ano}`}
              </h2>
              {isMesAtual && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: '#dbeafe', color: '#1e40af' }}>
                  {duDecorridos}/{duTotal} dias úteis
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
              <ProjecaoCard
                icon={<TrendingUp size={15} />}
                title="Faturamento"
                atual={data?.total_vendas_mes ?? 0}
                projecao={fatProjecao}
                pctDU={pctDU}
                duDecorridos={duDecorridos}
                duTotal={duTotal}
                isMesAtual={isMesAtual}
                accentColor="#00205C"
              />
              <ProjecaoCard
                icon={<BarChart2 size={15} />}
                title="Vendas PA Televendas"
                atual={data?.total_pa_televendas ?? 0}
                projecao={paProjecao}
                pctDU={pctDU}
                duDecorridos={duDecorridos}
                duTotal={duTotal}
                isMesAtual={isMesAtual}
                accentColor="#1e40af"
              />
              <ProjecaoCard
                icon={<Wallet size={15} />}
                title="Recebimentos Televendas"
                atual={data?.total_recebimentos_televendas ?? 0}
                projecao={recProjecao}
                pctDU={pctDU}
                duDecorridos={duDecorridos}
                duTotal={duTotal}
                isMesAtual={isMesAtual}
                accentColor="#065f46"
              />
              <ProjecaoCard
                icon={<Award size={15} />}
                title="Comissão Estimada"
                atual={data?.total_comissao_televendas ?? 0}
                projecao={comProjecao}
                pctDU={pctDU}
                duDecorridos={duDecorridos}
                duTotal={duTotal}
                isMesAtual={isMesAtual}
                accentColor="#92400e"
              />
            </div>
          </div>
        )}

        {/* ── Setores + Top Vendedores ── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Vendas por Setor */}
          <div className="rounded-xl p-5 shadow-sm flex flex-col gap-4"
            style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold" style={{ color: '#00205C' }}>
                Vendas por Setor
              </h2>
              {data && Array.isArray(data.vendas_por_setor) && (
                <span className="text-xs" style={{ color: '#94a3b8' }}>
                  {formatBRL(data.vendas_por_setor.reduce((s, r) => s + r.total_vendas, 0))} total
                </span>
              )}
            </div>
            {loading ? (
              <div className="flex-1 flex items-center justify-center text-sm" style={{ color: '#94a3b8' }}>
                Carregando...
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {(data?.vendas_por_setor ?? []).map((s, i) => {
                  const totalGeral = data.vendas_por_setor.reduce((acc, r) => acc + r.total_vendas, 0);
                  const pct = totalGeral > 0 ? (s.total_vendas / totalGeral) * 100 : 0;
                  const cor = SETOR_CORES[s.setor] ?? '#94a3b8';
                  return (
                    <div key={i}>
                      <div className="flex items-baseline justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                            style={{ background: cor }} />
                          <span className="text-xs font-semibold" style={{ color: '#0a1628' }}>
                            {s.setor}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold" style={{ color: cor }}>
                            {formatBRL(s.total_vendas)}
                          </span>
                          <span className="text-xs w-9 text-right tabular-nums" style={{ color: '#94a3b8' }}>
                            {pct.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: '#f1f5f9' }}>
                        <div className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: cor }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Top Vendedores */}
          <div className="col-span-2 rounded-xl p-5 shadow-sm"
            style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold" style={{ color: '#00205C' }}>
                Top 10 Vendedores
              </h2>
              <span className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: '#f1f5f9', color: '#64748b' }}>
                {mes ? MESES[mes - 1] + ' ' + ano : `Ano ${ano}`}
              </span>
            </div>
            {loading ? (
              <div className="h-48 flex items-center justify-center text-sm" style={{ color: '#94a3b8' }}>
                Carregando...
              </div>
            ) : (
              <div className="space-y-3">
                {(data?.top_vendedores ?? []).map((v, i) => {
                  const pct = data.top_vendedores[0]
                    ? (v.total_vendas / data.top_vendedores[0].total_vendas) * 100
                    : 0;
                  const isTop = i === 0;
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span
                        className="text-xs font-bold w-5 text-center shrink-0 rounded-full flex items-center justify-center"
                        style={{
                          width: 22, height: 22,
                          background: isTop ? '#FFD700' : '#f1f5f9',
                          color: isTop ? '#00205C' : '#94a3b8',
                          fontSize: 11,
                        }}
                      >
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline mb-1">
                          <p className="text-xs font-semibold truncate"
                            style={{ color: isTop ? '#00205C' : '#0a1628', maxWidth: 240 }}>
                            {v.vendedor}
                          </p>
                          <p className="text-xs font-bold shrink-0 ml-3"
                            style={{ color: isTop ? '#00205C' : '#334155' }}>
                            {formatBRL(v.total_vendas)}
                          </p>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#f1f5f9' }}>
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${pct}%`,
                              background: isTop ? '#FFD700' : i < 3 ? '#00205C' : '#94a3b8',
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
