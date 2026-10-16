import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatBRL, MESES_COMPLETOS } from '../_shared/format';
import { calcularComissaoEcommerce, PERCENTUAL_SEM_META_PADRAO, type EcomMeta } from '../_shared/commission-ecommerce';
import { useEcommerceConfig, usePutEcommerce } from './api';
import { Aviso, Card, PeriodoSelect, fmtPct, maskPct, maskValor, numParaInput, parseNum, rotuloPlataforma, selecionarTudo, td, tdR, th, thR } from './ui';

interface FaixaForm { cresc_min: string; valor: string }
interface VendForm { nome: string; ativo: boolean }

// Configuração do setor E-commerce: metas do mês, faixas do bônus por plataforma e vendedoras do setor.
export default function ConfigEcommerce() {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const q = useEcommerceConfig(ano, mes);
  const put = usePutEcommerce();
  const qc = useQueryClient();

  const [m, setM] = useState({ m1v: '', m1p: '', m2v: '', m2p: '', m3v: '', m3p: '', psm: '' });
  const [faixas, setFaixas] = useState<FaixaForm[]>([]);
  const [vend, setVend] = useState<VendForm[]>([]);
  const [novoNome, setNovoNome] = useState('');
  const [salvando, setSalvando] = useState<string | null>(null);

  useEffect(() => {
    if (!q.data) return;
    const meta = q.data.meta;
    setM({
      m1v: numParaInput(meta?.meta1_valor), m1p: numParaInput(meta?.meta1_percentual),
      m2v: numParaInput(meta?.meta2_valor), m2p: numParaInput(meta?.meta2_percentual),
      m3v: numParaInput(meta?.meta3_valor), m3p: numParaInput(meta?.meta3_percentual),
      psm: numParaInput(meta?.percentual_sem_meta ?? q.data.percentual_sem_meta_padrao),
    });
    setFaixas([...q.data.faixas].sort((a, b) => a.cresc_min - b.cresc_min).map((f) => ({ cresc_min: numParaInput(f.cresc_min), valor: numParaInput(f.valor) })));
    setVend(q.data.vendedoras.map((v) => ({ ...v })));
  }, [q.data]);

  const invalidar = () => qc.invalidateQueries({ queryKey: ['comissao', 'ecommerce'] });
  const salvar = async (qual: string, rota: 'metas' | 'bonus-faixas' | 'vendedoras', body: unknown) => {
    setSalvando(qual);
    try {
      await put(rota, body);
      toast.success('Configuração salva');
      await invalidar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(null);
    }
  };

  const faixasNum = faixas.map((f) => ({ cresc_min: parseNum(f.cresc_min), valor: parseNum(f.valor) }));
  // Pré-visualização: o bônus que cada plataforma ganharia com as faixas digitadas, sobre o mês selecionado.
  const preview = useMemo(() => {
    if (!q.data) return [];
    const metaFicticia: EcomMeta = { meta1_valor: 1, meta1_percentual: 0, meta2_valor: 0, meta2_percentual: 0, meta3_valor: 0, meta3_percentual: 0, percentual_sem_meta: PERCENTUAL_SEM_META_PADRAO };
    return calcularComissaoEcommerce(1, metaFicticia, q.data.plataformas, faixasNum.filter((f) => f.valor > 0), 1).plataformas;
  }, [q.data, faixas]); // eslint-disable-line react-hooks/exhaustive-deps

  const campo = 'rounded-lg px-3 py-2 text-sm w-full outline-none text-right tabular-nums';
  const estiloCampo = { background: '#ffffff', border: '1px solid #e2e8f0', color: '#00205C' };
  const botao = 'text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-50';
  const estiloBotao = { background: '#00205C', color: '#FFD700' };

  const salvarMetas = () => salvar('metas', 'metas', {
    ano, mes,
    meta1_valor: parseNum(m.m1v), meta1_percentual: parseNum(m.m1p),
    meta2_valor: parseNum(m.m2v), meta2_percentual: parseNum(m.m2p),
    meta3_valor: parseNum(m.m3v), meta3_percentual: parseNum(m.m3p),
    percentual_sem_meta: m.psm.trim() === '' ? PERCENTUAL_SEM_META_PADRAO : parseNum(m.psm),
  });

  const origemFaixas = q.data?.faixas_origem;
  const textoOrigem = !origemFaixas ? '' : origemFaixas === 'padrao'
    ? 'Ainda não há faixas salvas: estão aparecendo as padrão (5% = R$ 50, 10% = R$ 100, 20% = R$ 150).'
    : origemFaixas.ano === ano && origemFaixas.mes === mes
      ? `Faixas definidas para ${MESES_COMPLETOS[mes - 1]}/${ano}.`
      : `Este mês herda as faixas de ${MESES_COMPLETOS[origemFaixas.mes - 1]}/${origemFaixas.ano}. Ao salvar, passam a valer só a partir de ${MESES_COMPLETOS[mes - 1]}/${ano}.`;

  return (
    <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm" style={{ color: '#64748b' }}>Metas, bônus por plataforma e vendedoras do setor</p>
          <PeriodoSelect ano={ano} mes={mes} onAno={setAno} onMes={setMes} />
        </div>

        {q.isLoading && <p className="text-sm" style={{ color: '#64748b' }}>Carregando...</p>}
        {q.isError && <Aviso tipo="alerta">Não foi possível carregar a configuração do e-commerce.</Aviso>}

        {q.data && (
          <>
            <Card titulo={`Metas de ${MESES_COMPLETOS[mes - 1]}/${ano} (faturamento do setor inteiro)`}>
              <table className="w-full max-w-2xl">
                <thead><tr style={{ color: '#64748b' }}><th className={th}>Faixa</th><th className={thR}>Faturamento (R$)</th><th className={thR}>Comissão (%)</th></tr></thead>
                <tbody>
                  {([['Meta 1', 'm1v', 'm1p'], ['Meta 2', 'm2v', 'm2p'], ['Meta 3', 'm3v', 'm3p']] as const).map(([rot, kv, kp]) => (
                    <tr key={rot} style={{ borderTop: '1px solid #e2e8f0' }}>
                      <td className={td}>{rot}</td>
                      <td className="py-1 px-1"><input className={campo} style={estiloCampo} inputMode="decimal" placeholder="0,00" value={m[kv]} onFocus={selecionarTudo} onChange={(e) => setM({ ...m, [kv]: maskValor(e.target.value) })} /></td>
                      <td className="py-1 px-1"><input className={campo} style={estiloCampo} inputMode="decimal" placeholder="0,00" value={m[kp]} onFocus={selecionarTudo} onChange={(e) => setM({ ...m, [kp]: maskPct(e.target.value) })} /></td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '1px solid #e2e8f0' }}>
                    <td className={td}>Sem meta atingida</td><td />
                    <td className="py-1 px-1"><input className={campo} style={estiloCampo} inputMode="decimal" placeholder="0,25" value={m.psm} onFocus={selecionarTudo} onChange={(e) => setM({ ...m, psm: maskPct(e.target.value) })} /></td>
                  </tr>
                </tbody>
              </table>
              <p className="text-xs mt-2" style={{ color: '#64748b' }}>O percentual incide sobre o faturamento do setor. O bônus por plataforma só é pago se a Meta 1 for batida.</p>
              <button className={`${botao} mt-3`} style={estiloBotao} disabled={salvando !== null} onClick={salvarMetas}>
                {salvando === 'metas' ? 'Salvando...' : 'Salvar metas'}
              </button>
            </Card>

            <Card titulo="Bônus por plataforma (crescimento sobre o mês anterior)">
              <p className="text-xs mb-3" style={{ color: '#64748b' }}>{textoOrigem}</p>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <table className="w-full">
                    <thead><tr style={{ color: '#64748b' }}><th className={thR}>A partir de (%)</th><th className={thR}>Bônus por plataforma (R$)</th><th /></tr></thead>
                    <tbody>
                      {faixas.map((f, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #e2e8f0' }}>
                          <td className="py-1 px-1"><input className={campo} style={estiloCampo} inputMode="decimal" placeholder="0,00" value={f.cresc_min} onFocus={selecionarTudo}
                            onChange={(e) => setFaixas((a) => a.map((x, j) => j === i ? { ...x, cresc_min: maskPct(e.target.value) } : x))} /></td>
                          <td className="py-1 px-1"><input className={campo} style={estiloCampo} inputMode="decimal" placeholder="0,00" value={f.valor} onFocus={selecionarTudo}
                            onChange={(e) => setFaixas((a) => a.map((x, j) => j === i ? { ...x, valor: maskValor(e.target.value) } : x))} /></td>
                          <td className="px-1"><button aria-label="Remover faixa" className="text-sm px-2" style={{ color: '#dc2626' }}
                            onClick={() => setFaixas((a) => a.filter((_, j) => j !== i))}>✕</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex gap-3 mt-3">
                    <button className="text-sm font-semibold rounded-lg px-3 py-2" style={{ border: '1px solid #e2e8f0', color: '#00205C' }}
                      onClick={() => setFaixas((a) => [...a, { cresc_min: '', valor: '' }])}>+ Adicionar faixa</button>
                    <button className={botao} style={estiloBotao} disabled={salvando !== null || faixas.length === 0}
                      onClick={() => salvar('faixas', 'bonus-faixas', { ano, mes, faixas: faixasNum })}>
                      {salvando === 'faixas' ? 'Salvando...' : 'Salvar faixas'}
                    </button>
                  </div>
                  <p className="text-xs mt-2" style={{ color: '#64748b' }}>Cada faixa vale a partir do crescimento informado até a próxima faixa. Ex.: 5% → R$ 50 vale de 5% a 9,99%.</p>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#64748b' }}>Como ficaria em {MESES_COMPLETOS[mes - 1]}/{ano}</p>
                  <table className="w-full">
                    <thead><tr style={{ color: '#64748b' }}><th className={th}>Plataforma</th><th className={thR}>Crescimento</th><th className={thR}>Bônus</th></tr></thead>
                    <tbody>
                      {preview.map((p) => (
                        <tr key={p.plataforma} style={{ borderTop: '1px solid #e2e8f0', opacity: p.elegivel ? 1 : 0.55 }}>
                          <td className={td}>{rotuloPlataforma(p.plataforma)}</td>
                          <td className={tdR}>{p.crescimento === null ? 'sem base' : fmtPct(p.crescimento)}</td>
                          <td className={tdR} style={{ fontWeight: 600 }}>{p.bonus > 0 ? formatBRL(p.bonus) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr style={{ borderTop: '2px solid #e2e8f0' }}>
                      <td className={td} colSpan={2} style={{ fontWeight: 600 }}>Total (se a Meta 1 for batida)</td>
                      <td className={tdR} style={{ fontWeight: 700 }}>{formatBRL(preview.reduce((s, p) => s + p.bonus, 0))}</td>
                    </tr></tfoot>
                  </table>
                </div>
              </div>
            </Card>

            <Card titulo="Vendedoras do setor (dividem a comissão igualmente)">
              <table className="w-full max-w-xl">
                <thead><tr style={{ color: '#64748b' }}><th className={th}>Nome</th><th className={thR}>Ativa</th><th /></tr></thead>
                <tbody>
                  {vend.map((v, i) => (
                    <tr key={v.nome} style={{ borderTop: '1px solid #e2e8f0' }}>
                      <td className={td}>{v.nome}</td>
                      <td className={tdR}><input type="checkbox" checked={v.ativo} aria-label={`${v.nome} ativa`}
                        onChange={(e) => setVend((a) => a.map((x, j) => j === i ? { ...x, ativo: e.target.checked } : x))} /></td>
                      <td className="px-1 text-right"><button aria-label={`Remover ${v.nome}`} className="text-sm px-2" style={{ color: '#dc2626' }}
                        onClick={() => setVend((a) => a.filter((_, j) => j !== i))}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex gap-3 mt-3 items-center flex-wrap">
                <input className="rounded-lg px-3 py-2 text-sm outline-none" style={{ ...estiloCampo, width: 220 }} placeholder="Nome da vendedora" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
                <button className="text-sm font-semibold rounded-lg px-3 py-2" style={{ border: '1px solid #e2e8f0', color: '#00205C' }}
                  onClick={() => { const n = novoNome.trim().toUpperCase(); if (n && !vend.some((v) => v.nome === n)) { setVend((a) => [...a, { nome: n, ativo: true }]); setNovoNome(''); } }}>
                  + Adicionar
                </button>
                <button className={botao} style={estiloBotao} disabled={salvando !== null || !vend.some((v) => v.ativo)}
                  onClick={() => salvar('vend', 'vendedoras', vend)}>
                  {salvando === 'vend' ? 'Salvando...' : 'Salvar vendedoras'}
                </button>
              </div>
              <p className="text-xs mt-2" style={{ color: '#64748b' }}>
                O nome precisa ser o mesmo informado em "Nome do vendedor no sistema" ao cadastrar o usuário (cargo Vendedor) no Hub.
              </p>
            </Card>
          </>
        )}
    </div>
  );
}
