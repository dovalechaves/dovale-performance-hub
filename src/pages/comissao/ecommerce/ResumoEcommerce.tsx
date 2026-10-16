import { DollarSign, TrendingUp, Award, Users } from 'lucide-react';
import KPICard from '../ui/KPICard';
import { formatBRL, MESES, MESES_COMPLETOS } from '../_shared/format';
import { useEcommerceResumo } from './api';
import { Aviso, Card, descreverFaixas, fmtPct, rotuloPlataforma, td, tdR, th, thR } from './ui';

// Painel do setor E-commerce, compartilhado entre a tela da vendedora e a do gestor.
export default function ResumoEcommerce({ ano, mes, modo, vendedora }: { ano: number; mes: number; modo: 'vendedora' | 'gestor'; vendedora?: string }) {
  const q = useEcommerceResumo(ano, mes);

  if (q.isLoading) return <p className="text-sm" style={{ color: '#64748b' }}>Carregando dados do e-commerce...</p>;
  if (q.isError || !q.data) {
    return <Aviso tipo="alerta">Não foi possível carregar os dados do e-commerce agora. Tente novamente em alguns instantes.</Aviso>;
  }

  const { dados, comissao, config } = q.data;
  const meta = config.meta;
  const tiers = meta ? [
    { label: 'Meta 1', valor: meta.meta1_valor, percentual: meta.meta1_percentual },
    { label: 'Meta 2', valor: meta.meta2_valor, percentual: meta.meta2_percentual },
    { label: 'Meta 3', valor: meta.meta3_valor, percentual: meta.meta3_percentual },
  ].filter((t) => t.valor > 0) : [];
  const proxima = tiers.find((t) => dados.total < t.valor) ?? null;
  const faixas = descreverFaixas(config.faixas);
  const maxFilial = Math.max(1, ...dados.por_filial.map((f) => f.total));
  const maxSerie = Math.max(1, ...q.data.serie.map((s) => s.total));
  const minha = q.data.minha_comissao;

  return (
    <div className="space-y-6">
      {dados.mes_em_andamento && (
        <Aviso tipo="info">
          {MESES_COMPLETOS[mes - 1]} ainda está em andamento: o crescimento por plataforma compara o que já foi vendido
          com o mês anterior inteiro, então tende a subir até o fechamento do mês.
        </Aviso>
      )}
      {!meta && (
        <Aviso tipo="alerta">
          Meta de {MESES_COMPLETOS[mes - 1]} ainda não cadastrada. Enquanto isso vale a comissão de {fmtPct(config.percentual_sem_meta_padrao)} sobre o faturamento e o bônus por plataforma fica bloqueado.
        </Aviso>
      )}

      <div className="grid grid-cols-4 gap-4">
        <KPICard title="Faturamento do setor" value={formatBRL(dados.total)}
          subtitle={`${MESES[mes - 1]}/${ano} · mês anterior ${formatBRL(dados.total_anterior)}`} icon={<DollarSign size={18} />} accent />
        <KPICard title="Meta atingida"
          value={comissao.meta_atingida ? comissao.meta_atingida.label : 'Nenhuma'}
          subtitle={comissao.meta_atingida ? `${fmtPct(comissao.meta_atingida.percentual)} sobre o faturamento` : `Vale ${fmtPct(comissao.percentual_aplicado)} (sem meta)`}
          icon={<Award size={18} />} />
        <KPICard title="Comissão do setor" value={formatBRL(comissao.comissao_total)}
          extra={`Meta ${formatBRL(comissao.comissao_meta)} + bônus ${formatBRL(comissao.comissao_bonus)}`}
          subtitle={comissao.bonus_desbloqueado ? 'Bônus liberado' : comissao.bonus_potencial > 0 ? `Bônus de ${formatBRL(comissao.bonus_potencial)} bloqueado: bata a Meta 1` : 'Sem bônus no mês'}
          icon={<TrendingUp size={18} />} />
        <KPICard title={modo === 'vendedora' ? (vendedora ? `Parte de ${vendedora}` : 'Sua parte') : 'Por vendedora'}
          value={formatBRL(modo === 'vendedora' && minha !== null ? minha : comissao.comissao_por_vendedora)}
          subtitle={`Dividido igualmente entre ${comissao.vendedoras} vendedora${comissao.vendedoras > 1 ? 's' : ''}`}
          icon={<Users size={18} />} green />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card titulo="Faixas de meta do mês">
          {tiers.length === 0 ? (
            <p className="text-sm" style={{ color: '#64748b' }}>Nenhuma faixa cadastrada.</p>
          ) : (
            <table className="w-full">
              <thead><tr style={{ color: '#64748b' }}><th className={th}>Faixa</th><th className={thR}>Faturamento</th><th className={thR}>Comissão</th><th className={thR}>Situação</th></tr></thead>
              <tbody>
                {tiers.map((t) => {
                  const ok = dados.total >= t.valor;
                  return (
                    <tr key={t.label} style={{ borderTop: '1px solid #e2e8f0' }}>
                      <td className={td}>{t.label}</td>
                      <td className={tdR}>{formatBRL(t.valor)}</td>
                      <td className={tdR}>{fmtPct(t.percentual)}</td>
                      <td className={tdR} style={{ color: ok ? '#16a34a' : '#94a3b8', fontWeight: 600 }}>{ok ? 'Atingida ✓' : 'Pendente'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {proxima && (
            <p className="text-xs mt-3" style={{ color: '#64748b' }}>
              Faltam {formatBRL(proxima.valor - dados.total)} para a {proxima.label}.
            </p>
          )}
        </Card>

        <Card titulo="Faturamento por filial">
          <div className="space-y-3">
            {dados.por_filial.length === 0 && <p className="text-sm" style={{ color: '#64748b' }}>Sem vendas no período.</p>}
            {dados.por_filial.map((f) => (
              <div key={f.emp}>
                <div className="flex justify-between text-sm">
                  <span>{f.filial}</span>
                  <span className="tabular-nums font-medium">{formatBRL(f.total)} <span style={{ color: '#94a3b8' }}>· {fmtPct(dados.total ? (f.total / dados.total) * 100 : 0, 1)}</span></span>
                </div>
                <div className="h-2 rounded mt-1" style={{ background: '#e2e8f0' }}>
                  <div className="h-2 rounded" style={{ width: `${(f.total / maxFilial) * 100}%`, background: '#00205C' }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card titulo="Bônus por plataforma (crescimento sobre o mês anterior)">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs mb-3" style={{ color: '#64748b' }}>
          {faixas.map((f) => <span key={f.cresc_min}>{f.texto}: <b style={{ color: '#00205C' }}>{formatBRL(f.valor)}</b></span>)}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr style={{ color: '#64748b' }}>
              <th className={th}>Plataforma</th><th className={thR}>Mês anterior</th><th className={thR}>Mês atual</th>
              <th className={thR}>Crescimento</th><th className={thR}>Bônus</th>
            </tr></thead>
            <tbody>
              {comissao.plataformas.map((p) => (
                <tr key={p.plataforma} style={{ borderTop: '1px solid #e2e8f0', opacity: p.elegivel ? 1 : 0.55 }}>
                  <td className={td}>{rotuloPlataforma(p.plataforma)}{!p.elegivel && <span className="text-xs" style={{ color: '#94a3b8' }}> · sem bônus</span>}</td>
                  <td className={tdR}>{formatBRL(p.anterior)}</td>
                  <td className={tdR}>{formatBRL(p.atual)}</td>
                  <td className={tdR} style={{ color: p.crescimento === null ? '#94a3b8' : p.crescimento < 0 ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
                    {p.crescimento === null ? 'sem base' : fmtPct(p.crescimento)}
                  </td>
                  <td className={tdR} style={{ fontWeight: 600 }}>{p.bonus > 0 ? formatBRL(p.bonus) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid #e2e8f0' }}>
                <td className={td} colSpan={4} style={{ fontWeight: 600 }}>Total de bônus {comissao.bonus_desbloqueado ? '(liberado)' : '(bloqueado: Meta 1 não atingida)'}</td>
                <td className={tdR} style={{ fontWeight: 700, color: comissao.bonus_desbloqueado ? '#16a34a' : '#94a3b8' }}>{formatBRL(comissao.bonus_potencial)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {modo === 'gestor' && (
        <div className="grid grid-cols-2 gap-4">
          <Card titulo="Divisão entre as vendedoras">
            <table className="w-full">
              <thead><tr style={{ color: '#64748b' }}><th className={th}>Vendedora</th><th className={thR}>Comissão a receber</th></tr></thead>
              <tbody>
                {q.data.vendedoras.map((v) => (
                  <tr key={v.nome} style={{ borderTop: '1px solid #e2e8f0' }}>
                    <td className={td}>{v.nome}</td><td className={tdR} style={{ fontWeight: 600 }}>{formatBRL(v.comissao)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card titulo={`Faturamento mês a mês · ${ano}`}>
            <div className="flex items-end gap-2" style={{ height: 120 }}>
              {q.data.serie.map((s) => (
                <div key={s.mes} className="flex-1 flex flex-col items-center justify-end h-full" title={`${MESES[s.mes - 1]}: ${formatBRL(s.total)}`}>
                  <div className="w-full rounded-t" style={{ height: `${(s.total / maxSerie) * 100}%`, minHeight: s.total ? 2 : 0, background: s.mes === mes ? '#FFD700' : '#00205C' }} />
                  <span className="text-[10px] mt-1" style={{ color: '#64748b' }}>{MESES[s.mes - 1]}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
