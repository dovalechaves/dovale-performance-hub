import { useEffect, useMemo, useState } from 'react';
import { formatBRL } from '../_shared/format';
import { calcularComissaoEcommerce } from '../_shared/commission-ecommerce';
import { useEcommerceResumo } from './api';
import { Aviso, Card, PeriodoSelect, fmtPct, maskValor, numParaInput, parseNum, rotuloPlataforma, selecionarTudo, td, tdR, th, thR } from './ui';

interface Linha { plataforma: string; anterior: string; atual: string }

// Simulação do setor E-commerce: parte dos números reais do mês e deixa a pessoa alterar
// o faturamento e as vendas por plataforma para ver comissão, bônus e a parte de cada vendedora.
export default function SimulacaoEcommerce() {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const q = useEcommerceResumo(ano, mes);
  const [faturamento, setFaturamento] = useState('');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [usarSoma, setUsarSoma] = useState(true);

  const carregar = () => {
    if (!q.data) return;
    setFaturamento(numParaInput(Math.round(q.data.dados.total * 100) / 100));
    setLinhas(q.data.dados.por_plataforma.map((p) => ({
      plataforma: p.plataforma,
      anterior: numParaInput(Math.round(p.anterior * 100) / 100),
      atual: numParaInput(Math.round(p.atual * 100) / 100),
    })));
  };
  // Preenche com os números reais sempre que o mês/ano mudar e os dados chegarem.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { carregar(); }, [q.data?.ano, q.data?.mes, q.dataUpdatedAt]);

  const somaPlataformas = useMemo(() => linhas.reduce((s, l) => s + parseNum(l.atual), 0), [linhas]);
  const totalSimulado = usarSoma ? somaPlataformas : parseNum(faturamento);

  const resultado = useMemo(() => {
    if (!q.data) return null;
    return calcularComissaoEcommerce(
      totalSimulado, q.data.config.meta,
      linhas.map((l) => ({ plataforma: l.plataforma, atual: parseNum(l.atual), anterior: parseNum(l.anterior) })),
      q.data.config.faixas, q.data.comissao.vendedoras,
    );
  }, [q.data, linhas, totalSimulado]);

  const campo = 'rounded-lg px-3 py-2 text-sm w-full outline-none text-right tabular-nums';
  const estiloCampo = { background: '#ffffff', border: '1px solid #e2e8f0', color: '#00205C' };

  return (
    <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm" style={{ color: '#64748b' }}>Altere o faturamento e as vendas por plataforma para ver a comissão e o bônus</p>
          <PeriodoSelect ano={ano} mes={mes} onAno={setAno} onMes={setMes} />
        </div>

        {q.isLoading && <p className="text-sm" style={{ color: '#64748b' }}>Carregando...</p>}
        {q.isError && <Aviso tipo="alerta">Não foi possível carregar os dados do e-commerce agora.</Aviso>}
        {q.data && !q.data.config.meta && (
          <Aviso tipo="alerta">Este mês ainda não tem meta cadastrada. A simulação usa {fmtPct(q.data.config.percentual_sem_meta_padrao)} sobre o faturamento e o bônus fica bloqueado.</Aviso>
        )}

        {q.data && resultado && (
          <div className="grid grid-cols-2 gap-4">
            <Card titulo="Números simulados">
              <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                <label className="text-sm flex items-center gap-2" style={{ color: '#00205C' }}>
                  <input type="checkbox" checked={usarSoma} onChange={(e) => setUsarSoma(e.target.checked)} />
                  Faturamento = soma das plataformas
                </label>
                <button onClick={carregar} className="text-xs font-semibold rounded-lg px-3 py-1.5" style={{ background: '#00205C', color: '#FFD700' }}>
                  Voltar aos números reais do mês
                </button>
              </div>
              {!usarSoma && (
                <div className="mb-3">
                  <label className="text-xs font-semibold block mb-1" style={{ color: '#64748b' }}>Faturamento do setor (R$)</label>
                  <input value={faturamento} onFocus={selecionarTudo} onChange={(e) => setFaturamento(maskValor(e.target.value))} className={campo} style={estiloCampo} inputMode="decimal" placeholder="0,00" />
                </div>
              )}
              <table className="w-full">
                <thead><tr style={{ color: '#64748b' }}><th className={th}>Plataforma</th><th className={thR}>Mês anterior</th><th className={thR}>Mês simulado</th></tr></thead>
                <tbody>
                  {linhas.map((l, i) => (
                    <tr key={l.plataforma} style={{ borderTop: '1px solid #e2e8f0' }}>
                      <td className={td}>{rotuloPlataforma(l.plataforma)}</td>
                      <td className="py-1 px-1"><input value={l.anterior} inputMode="decimal" placeholder="0,00" className={campo} style={estiloCampo} onFocus={selecionarTudo}
                        onChange={(e) => setLinhas((a) => a.map((x, j) => j === i ? { ...x, anterior: maskValor(e.target.value) } : x))} /></td>
                      <td className="py-1 px-1"><input value={l.atual} inputMode="decimal" placeholder="0,00" className={campo} style={estiloCampo} onFocus={selecionarTudo}
                        onChange={(e) => setLinhas((a) => a.map((x, j) => j === i ? { ...x, atual: maskValor(e.target.value) } : x))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <div className="space-y-4">
              <Card titulo="Resultado da simulação">
                <dl className="space-y-2 text-sm">
                  <Linha rot="Faturamento simulado" val={formatBRL(resultado.vendas_total)} />
                  <Linha rot="Meta atingida" val={resultado.meta_atingida ? `${resultado.meta_atingida.label} (${fmtPct(resultado.meta_atingida.percentual)})` : `Nenhuma (${fmtPct(resultado.percentual_aplicado)})`} />
                  <Linha rot="Comissão sobre o faturamento" val={formatBRL(resultado.comissao_meta)} />
                  <Linha rot={resultado.bonus_desbloqueado ? 'Bônus por plataforma' : 'Bônus por plataforma (bloqueado)'} val={formatBRL(resultado.comissao_bonus)} />
                  <div style={{ borderTop: '2px solid #e2e8f0' }} />
                  <Linha rot="Comissão total do setor" val={formatBRL(resultado.comissao_total)} forte />
                  <Linha rot={`Por vendedora (÷ ${resultado.vendedoras})`} val={formatBRL(resultado.comissao_por_vendedora)} forte />
                </dl>
                {!resultado.bonus_desbloqueado && resultado.bonus_potencial > 0 && (
                  <p className="text-xs mt-3" style={{ color: '#92400e' }}>
                    O bônus de {formatBRL(resultado.bonus_potencial)} só é pago se a Meta 1 for batida.
                  </p>
                )}
              </Card>
              <Card titulo="Bônus por plataforma">
                <table className="w-full">
                  <thead><tr style={{ color: '#64748b' }}><th className={th}>Plataforma</th><th className={thR}>Crescimento</th><th className={thR}>Bônus</th></tr></thead>
                  <tbody>
                    {resultado.plataformas.map((p) => (
                      <tr key={p.plataforma} style={{ borderTop: '1px solid #e2e8f0', opacity: p.elegivel ? 1 : 0.55 }}>
                        <td className={td}>{rotuloPlataforma(p.plataforma)}</td>
                        <td className={tdR}>{p.crescimento === null ? 'sem base' : fmtPct(p.crescimento)}</td>
                        <td className={tdR} style={{ fontWeight: 600 }}>{p.bonus > 0 ? formatBRL(p.bonus) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          </div>
        )}
    </div>
  );
}

function Linha({ rot, val, forte }: { rot: string; val: string; forte?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt style={{ color: '#64748b' }}>{rot}</dt>
      <dd className="tabular-nums" style={{ color: '#00205C', fontWeight: forte ? 700 : 500 }}>{val}</dd>
    </div>
  );
}
