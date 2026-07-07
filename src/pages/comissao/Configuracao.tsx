import { useEffect, useMemo, useState, useRef } from 'react';

// Input que aceita vírgula como separador decimal (pt-BR) sem resetar durante digitação
function PctInput({ value, onChange, className, style, placeholder }: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
}) {
  const [raw, setRaw] = useState(value === 0 ? '' : String(value).replace('.', ','));
  const lastExternal = useRef(value);

  useEffect(() => {
    if (value !== lastExternal.current) {
      lastExternal.current = value;
      setRaw(value === 0 ? '' : String(value).replace('.', ','));
    }
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      className={className}
      style={style}
      placeholder={placeholder}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const txt = e.target.value;
        setRaw(txt);
        const parsed = parseFloat(txt.replace(',', '.'));
        if (!isNaN(parsed)) {
          lastExternal.current = parsed;
          onChange(parsed);
        }
      }}
      onBlur={() => {
        const parsed = parseFloat(raw.replace(',', '.'));
        const final = isNaN(parsed) ? 0 : parsed;
        lastExternal.current = final;
        onChange(final);
        setRaw(final === 0 ? '' : String(final).replace('.', ','));
      }}
    />
  );
}
// Input de valor (R$) com máscara de milhar/decimal (pt-BR) sem resetar durante digitação
function ValorInput({ value, onChange, className, style, placeholder }: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
}) {
  const formatarExibicao = (n: number) => n === 0 ? '' : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

  const aplicarMascara = (txt: string) => {
    const limpo = txt.replace(/[^\d,]/g, '');
    const primeiraVirgula = limpo.indexOf(',');
    const semVirgulaExtra = primeiraVirgula === -1
      ? limpo
      : limpo.slice(0, primeiraVirgula + 1) + limpo.slice(primeiraVirgula + 1).replace(/,/g, '');
    const [intParteRaw, decParte] = semVirgulaExtra.split(',');
    const intParte = intParteRaw.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return decParte !== undefined ? `${intParte || '0'},${decParte.slice(0, 2)}` : intParte;
  };

  const paraNumero = (txt: string): number => {
    const n = parseFloat(txt.replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? 0 : n;
  };

  const [raw, setRaw] = useState(formatarExibicao(value));
  const lastExternal = useRef(value);

  useEffect(() => {
    if (value !== lastExternal.current) {
      lastExternal.current = value;
      setRaw(formatarExibicao(value));
    }
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      className={className}
      style={style}
      placeholder={placeholder}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const mascarado = aplicarMascara(e.target.value);
        setRaw(mascarado);
        const num = paraNumero(mascarado);
        lastExternal.current = num;
        onChange(num);
      }}
      onBlur={() => {
        const num = paraNumero(raw);
        lastExternal.current = num;
        onChange(num);
        setRaw(formatarExibicao(num));
      }}
    />
  );
}
// Select com busca — digita para filtrar, clica para escolher
function BuscaSelect({ value, onChange, options, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  const [busca, setBusca] = useState(value);
  const [aberto, setAberto] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setBusca(value); }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setAberto(false);
        setBusca(value);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [value]);

  const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const buscaNorm = normalizar(busca);
  const filtradas = options.filter(o => normalizar(o).includes(buscaNorm));

  return (
    <div className="relative" style={{ minWidth: 240 }}>
      <input
        ref={inputRef}
        type="text"
        value={busca}
        onChange={(e) => { setBusca(e.target.value); setAberto(true); if (value) onChange(''); }}
        onFocus={() => { setBusca(''); setAberto(true); }}
        placeholder={placeholder}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none"
        style={{ border: '1px solid #cbd5e1', color: '#0a1628' }}
      />
      {aberto && (
        <div ref={dropdownRef}
          className="absolute top-full left-0 mt-1 w-full rounded-lg z-50 overflow-hidden"
          style={{ background: '#0a1628', border: '1px solid #1a3a6e', boxShadow: '0 8px 24px rgba(0,0,0,0.3)', maxHeight: 240, overflowY: 'auto' }}>
          {filtradas.length > 0 ? filtradas.map((o) => (
            <button key={o} type="button"
              onMouseDown={() => { onChange(o); setBusca(o); setAberto(false); }}
              className="w-full text-left px-3 py-2 text-xs transition-colors"
              style={{ color: value === o ? '#FFD700' : '#cbd5e1', background: value === o ? '#1a3a6e' : 'transparent' }}
              onMouseEnter={(e) => { if (value !== o) (e.currentTarget as HTMLElement).style.background = '#1a3a6e'; }}
              onMouseLeave={(e) => { if (value !== o) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
              {o}
            </button>
          )) : (
            <div className="px-3 py-2 text-xs" style={{ color: '#64748b' }}>Nenhum resultado</div>
          )}
        </div>
      )}
    </div>
  );
}

import AppShell from './layout/AppShell';
import { MESES, formatBRL } from './_shared/format';
import { Save, CheckCircle, AlertCircle, Calendar, Users, Loader2 } from 'lucide-react';
import { useComissaoUser as useUser, useComissaoApi } from './_shared/hooks';
import { useNavigate } from 'react-router-dom';

interface VendedorMeta {
  nome_vendedor: string;
  meta1_valor: number; meta1_percentual: number;
  meta2_valor: number; meta2_percentual: number;
  meta3_valor: number; meta3_percentual: number;
  percentual_sem_meta: number;
}

interface BonusConfig {
  bonus1_valor: number; bonus1_percentual: number;
  bonus2_valor: number; bonus2_percentual: number;
  bonus3_valor: number; bonus3_percentual: number;
  bonus4_valor: number; bonus4_percentual: number;
  bonus5_valor: number; bonus5_percentual: number;
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

interface FerrMetaGrupo {
  meta1_valor: number; meta1_bonus: number;
  meta2_valor: number; meta2_bonus: number;
  meta3_valor: number; meta3_bonus: number;
  metadesafio_valor: number; metadesafio_bonus: number;
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

const BONUS_VAZIO: BonusConfig = {
  bonus1_valor: 0, bonus1_percentual: 0,
  bonus2_valor: 0, bonus2_percentual: 0,
  bonus3_valor: 0, bonus3_percentual: 0,
  bonus4_valor: 0, bonus4_percentual: 0,
  bonus5_valor: 0, bonus5_percentual: 0,
};

const ANO_ATUAL = new Date().getFullYear();
const ANOS_META = [ANO_ATUAL, ANO_ATUAL - 1, ANO_ATUAL - 2];
const BONUS_CORES = [
  { bg: '#eff6ff', border: '#bfdbfe', text: '#1e40af', label: 'Bônus 1' },
  { bg: '#f0fdf4', border: '#bbf7d0', text: '#065f46', label: 'Bônus 2' },
  { bg: '#fffbeb', border: '#fde68a', text: '#92400e', label: 'Bônus 3' },
  { bg: '#fdf4ff', border: '#e9d5ff', text: '#6b21a8', label: 'Bônus 4' },
  { bg: '#fff1f2', border: '#fecdd3', text: '#9f1239', label: 'Bônus 5' },
];

const FERR_META_GRUPO_VAZIO: FerrMetaGrupo = {
  meta1_valor: 0, meta1_bonus: 0,
  meta2_valor: 0, meta2_bonus: 0,
  meta3_valor: 0, meta3_bonus: 0,
  metadesafio_valor: 0, metadesafio_bonus: 0,
};

export default function ComissaoConfiguracao() {
  const usuario = useUser();
  const api = useComissaoApi();
  const navigate = useNavigate();
  const [aba, setAba] = useState<'televendas' | 'ferragens' | 'distribuidores' | 'vendedores'>('televendas');
  const [tvAba, setTvAba] = useState<'metas' | 'bonus'>('metas');

  // ── Vendedores ativo/inativo ──
  const [vendedoresComStatus, setVendedoresComStatus] = useState<{ nome: string; ativo: boolean }[]>([]);
  const [buscaAtivo, setBuscaAtivo] = useState('');
  const [loadingVendAtivo, setLoadingVendAtivo] = useState(false);
  const [togglingVend, setTogglingVend] = useState<Record<string, boolean>>({});

  // ── Metas PA ──
  const [allVendedores, setAllVendedores] = useState<string[]>([]);
  const [buscaVend, setBuscaVend] = useState('');
  const [mesMeta, setMesMeta] = useState(new Date().getMonth() + 1);
  const [anoMeta, setAnoMeta] = useState(new Date().getFullYear());
  const [metasMensaisEdit, setMetasMensaisEdit] = useState<Record<string, VendedorMeta>>({});
  const [savingMensais, setSavingMensais] = useState(false);
  const [savedMensais, setSavedMensais] = useState(false);
  const [loading, setLoading] = useState(true);

  // ── Bônus Global ──
  const [bonusEdit, setBonusEdit] = useState<BonusConfig>(BONUS_VAZIO);
  const [savingBonus, setSavingBonus] = useState(false);
  const [savedBonus, setSavedBonus] = useState(false);

  // ── Ferragens ──
  const [ferrAba, setFerrAba] = useState<'metas' | 'bonus' | 'grupo'>('metas');
  const [ferrMesConf, setFerrMesConf] = useState(new Date().getMonth() + 1);
  const [ferrAnoConf, setFerrAnoConf] = useState(new Date().getFullYear());
  const [ferrVendedores, setFerrVendedores] = useState<string[]>([]);
  const [ferrMetasEdit, setFerrMetasEdit] = useState<Record<string, FerrVendedorMeta>>({});
  const [ferrBonusEdit, setFerrBonusEdit] = useState<Record<string, FerrVendedorBonus>>({});
  const [ferrMetaGrupoEdit, setFerrMetaGrupoEdit] = useState<FerrMetaGrupo>(FERR_META_GRUPO_VAZIO);
  const [savingFerrMetas, setSavingFerrMetas] = useState(false);
  const [savedFerrMetas, setSavedFerrMetas] = useState(false);
  const [savingFerrBonus, setSavingFerrBonus] = useState(false);
  const [savedFerrBonus, setSavedFerrBonus] = useState(false);
  const [savingFerrGrupo, setSavingFerrGrupo] = useState(false);
  const [savedFerrGrupo, setSavedFerrGrupo] = useState(false);
  const [loadingFerr, setLoadingFerr] = useState(false);
  const [ferrBuscaVend, setFerrBuscaVend] = useState('');

  // ── Distribuidores ──
  const [distAba, setDistAba] = useState<'metas' | 'bonus' | 'vinculos'>('metas');
  const [distMesConf, setDistMesConf] = useState(new Date().getMonth() + 1);
  const [distAnoConf, setDistAnoConf] = useState(new Date().getFullYear());
  const [distVendedores, setDistVendedores] = useState<string[]>([]);
  const [distMetasEdit, setDistMetasEdit] = useState<Record<string, DistVendedorMeta>>({});
  const [distBonusEdit, setDistBonusEdit] = useState<Record<string, DistVendedorBonus>>({});
  const [savingDistMetas, setSavingDistMetas] = useState(false);
  const [savedDistMetas, setSavedDistMetas] = useState(false);
  const [savingDistBonus, setSavingDistBonus] = useState(false);
  const [savedDistBonus, setSavedDistBonus] = useState(false);
  const [loadingDist, setLoadingDist] = useState(false);
  const [distBuscaVend, setDistBuscaVend] = useState('');

  // ── Distribuidores: Vínculos (vendedor vinculado → vendedor principal) ──
  const [distNomesRaw, setDistNomesRaw] = useState<string[]>([]);
  const [distVinculos, setDistVinculos] = useState<Record<string, string>>({});
  const [loadingDistVinculos, setLoadingDistVinculos] = useState(false);
  const [savingDistVinculos, setSavingDistVinculos] = useState(false);
  const [savedDistVinculos, setSavedDistVinculos] = useState(false);
  const [novoVinculado, setNovoVinculado] = useState('');
  const [novoPrincipal, setNovoPrincipal] = useState('');

  useEffect(() => {
    if (usuario && usuario !== 'loading' && !['ADM', 'GESTOR'].includes(usuario.cargo)) {
      navigate('/hub');
    }
  }, [usuario, navigate]);

  useEffect(() => {
    if (!usuario || usuario === 'loading') return;
    const setores = usuario.setores || [];
    const podeTelevendas = usuario.cargo === 'ADM' || setores.some((s) => s === 'TELEVENDAS' || s === 'TELEVENDAS MG');
    if (!podeTelevendas) {
      setAllVendedores([]);
      setLoading(false);
      setLoadingVendAtivo(true);
      api('/vendedor-ativo')
        .then((r) => r.json())
        .then((data) => setVendedoresComStatus(Array.isArray(data) ? data : []))
        .catch(() => {})
        .finally(() => setLoadingVendAtivo(false));
      return;
    }
    api('/filtros?setor=TELEVENDAS,TELEVENDAS MG', { cache: 'no-store' })
      .then((r) => r.json())
      .then((filtros) => {
        setAllVendedores(filtros.vendedores || []);
        setLoading(false);
      });
    // Carrega config global de bônus
    api('/bonus-config')
      .then((r) => r.json())
      .then((b) => setBonusEdit(b))
      .catch(() => {});
    setLoadingVendAtivo(true);
    api('/vendedor-ativo')
      .then((r) => r.json())
      .then((data) => setVendedoresComStatus(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingVendAtivo(false));
  }, [api, usuario]);

  useEffect(() => {
    if (!usuario || usuario === 'loading') return;
    carregarMetasMensais(anoMeta, mesMeta);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anoMeta, mesMeta, usuario]);

  useEffect(() => {
    if (!usuario || usuario === 'loading' || aba !== 'ferragens') return;
    carregarDadosFerragens(ferrAnoConf, ferrMesConf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba, ferrAnoConf, ferrMesConf, usuario]);

  useEffect(() => {
    if (!usuario || usuario === 'loading' || aba !== 'distribuidores') return;
    carregarDadosDistribuidores(distAnoConf, distMesConf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba, distAnoConf, distMesConf, usuario]);

  useEffect(() => {
    if (!usuario || usuario === 'loading' || aba !== 'distribuidores' || distAba !== 'vinculos') return;
    carregarVinculosDistribuidores();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba, distAba, usuario]);

  const getMensal = (nome: string): VendedorMeta =>
    metasMensaisEdit[nome] || {
      nome_vendedor: nome,
      meta1_valor: 0, meta1_percentual: 0,
      meta2_valor: 0, meta2_percentual: 0,
      meta3_valor: 0, meta3_percentual: 0,
      percentual_sem_meta: 0,
    };

  const updateMensal = (
    nome: string,
    field: keyof Omit<VendedorMeta, 'nome_vendedor'>,
    value: number
  ) => {
    setSavedMensais(false);
    setMetasMensaisEdit((prev) => ({ ...prev, [nome]: { ...getMensal(nome), [field]: value } }));
  };

  const updateBonus = (field: keyof BonusConfig, value: number) => {
    setSavedBonus(false);
    setBonusEdit((prev) => ({ ...prev, [field]: value }));
  };

  const toggleVendedorAtivo = async (nome: string, novoAtivo: boolean) => {
    setVendedoresComStatus((prev) => prev.map((v) => v.nome === nome ? { ...v, ativo: novoAtivo } : v));
    // Sincroniza com a aba Metas PA imediatamente
    if (!novoAtivo) {
      setAllVendedores((prev) => prev.filter((v) => v !== nome));
    } else {
      setAllVendedores((prev) => [...prev, nome].sort());
    }
    setTogglingVend((prev) => ({ ...prev, [nome]: true }));
    try {
      const res = await api('/vendedor-ativo', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome_vendedor: nome, ativo: novoAtivo }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setVendedoresComStatus((prev) => prev.map((v) => v.nome === nome ? { ...v, ativo: !novoAtivo } : v));
      // Reverte a sincronização
      if (!novoAtivo) {
        setAllVendedores((prev) => [...prev, nome].sort());
      } else {
        setAllVendedores((prev) => prev.filter((v) => v !== nome));
      }
    } finally {
      setTogglingVend((prev) => { const n = { ...prev }; delete n[nome]; return n; });
    }
  };

  const carregarMetasMensais = async (ano: number, mes: number) => {
    try {
      const res = await api(`/metas-mensais?ano=${ano}&mes=${mes}`);
      const list: VendedorMeta[] = await res.json();
      const map: Record<string, VendedorMeta> = {};
      list.forEach((m) => { map[m.nome_vendedor] = m; });
      setMetasMensaisEdit(map);
    } catch { /* silent */ }
  };

  const salvarMetasMensais = async () => {
    setSavingMensais(true);
    try {
      const payload = allVendedores.map((v) => ({
        ...getMensal(v),
        nome_vendedor: v,
        ano: anoMeta,
        mes: mesMeta,
      }));
      const res = await api('/metas-mensais', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      setSavedMensais(true);
      setTimeout(() => setSavedMensais(false), 3000);
    } catch (err) {
      console.error('Erro ao salvar metas:', err);
      alert('Erro ao salvar. Verifique o console.');
    } finally {
      setSavingMensais(false);
    }
  };

  const salvarBonus = async () => {
    setSavingBonus(true);
    try {
      const res2 = await api('/bonus-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bonusEdit),
      });
      if (!res2.ok) throw new Error(await res2.text());
      setSavedBonus(true);
      setTimeout(() => setSavedBonus(false), 3000);
    } catch (err) {
      console.error('Erro ao salvar bônus:', err);
      alert('Erro ao salvar. Verifique o console.');
    } finally {
      setSavingBonus(false);
    }
  };

  const carregarDadosFerragens = async (ano: number, mes: number) => {
    setLoadingFerr(true);
    try {
      const [vendRes, metasRes, bonusRes, grupoRes] = await Promise.all([
        api(`/filtros?setor=FERRAGENS`, { cache: 'no-store' }).then(r => r.json()),
        api(`/ferragens/metas?ano=${ano}&mes=${mes}`).then(r => r.json()),
        api(`/ferragens/bonus?ano=${ano}&mes=${mes}`).then(r => r.json()),
        api(`/ferragens/meta-grupo?ano=${ano}&mes=${mes}`).then(r => r.json()),
      ]);
      setFerrVendedores(vendRes.vendedores || []);
      const metasMap: Record<string, FerrVendedorMeta> = {};
      if (Array.isArray(metasRes)) metasRes.forEach((m: FerrVendedorMeta) => { metasMap[m.nome_vendedor] = m; });
      setFerrMetasEdit(metasMap);
      const bonusMap: Record<string, FerrVendedorBonus> = {};
      if (Array.isArray(bonusRes)) bonusRes.forEach((b: FerrVendedorBonus) => { bonusMap[b.nome_vendedor] = b; });
      setFerrBonusEdit(bonusMap);
      if (grupoRes && typeof grupoRes === 'object' && !grupoRes.error) {
        setFerrMetaGrupoEdit(grupoRes);
      } else {
        setFerrMetaGrupoEdit(FERR_META_GRUPO_VAZIO);
      }
    } catch { /* silent */ }
    setLoadingFerr(false);
  };

  const getFerrMeta = (nome: string): FerrVendedorMeta =>
    ferrMetasEdit[nome] || { nome_vendedor: nome, meta1_valor: 0, meta1_percentual: 0, meta2_valor: 0, meta2_percentual: 0, meta3_valor: 0, meta3_percentual: 0, metadesafio_valor: 0, metadesafio_percentual: 0, percentual_sem_meta: 0 };

  const getFerrBonus = (nome: string): FerrVendedorBonus =>
    ferrBonusEdit[nome] || { nome_vendedor: nome, bonus1_valor: 0, bonus2_valor: 0, bonus3_valor: 0, bonusdesafio_valor: 0 };

  const updateFerrMeta = (nome: string, field: keyof Omit<FerrVendedorMeta, 'nome_vendedor'>, value: number) => {
    setSavedFerrMetas(false);
    setFerrMetasEdit(prev => ({ ...prev, [nome]: { ...getFerrMeta(nome), [field]: value } }));
  };

  const updateFerrBonus = (nome: string, field: keyof Omit<FerrVendedorBonus, 'nome_vendedor'>, value: number) => {
    setSavedFerrBonus(false);
    setFerrBonusEdit(prev => ({ ...prev, [nome]: { ...getFerrBonus(nome), [field]: value } }));
  };

  const updateFerrGrupo = (field: keyof FerrMetaGrupo, value: number) => {
    setSavedFerrGrupo(false);
    setFerrMetaGrupoEdit(prev => ({ ...prev, [field]: value }));
  };

  const salvarFerrMetas = async () => {
    setSavingFerrMetas(true);
    try {
      const payload = ferrVendedores.map(v => ({ ...getFerrMeta(v), nome_vendedor: v, ano: ferrAnoConf, mes: ferrMesConf }));
      const res = await api('/ferragens/metas', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(await res.text());
      setSavedFerrMetas(true);
      setTimeout(() => setSavedFerrMetas(false), 3000);
    } catch (err) { console.error(err); alert('Erro ao salvar metas Ferragens.'); }
    setSavingFerrMetas(false);
  };

  const salvarFerrBonus = async () => {
    setSavingFerrBonus(true);
    try {
      const payload = ferrVendedores.map(v => ({ ...getFerrBonus(v), nome_vendedor: v, ano: ferrAnoConf, mes: ferrMesConf }));
      const res = await api('/ferragens/bonus', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(await res.text());
      setSavedFerrBonus(true);
      setTimeout(() => setSavedFerrBonus(false), 3000);
    } catch (err) { console.error(err); alert('Erro ao salvar bônus Ferragens.'); }
    setSavingFerrBonus(false);
  };

  const salvarFerrGrupo = async () => {
    setSavingFerrGrupo(true);
    try {
      const body = { ...ferrMetaGrupoEdit, ano: ferrAnoConf, mes: ferrMesConf };
      const res = await api('/ferragens/meta-grupo', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await res.text());
      setSavedFerrGrupo(true);
      setTimeout(() => setSavedFerrGrupo(false), 3000);
    } catch (err) { console.error(err); alert('Erro ao salvar meta grupo Ferragens.'); }
    setSavingFerrGrupo(false);
  };

  const carregarDadosDistribuidores = async (ano: number, mes: number) => {
    setLoadingDist(true);
    try {
      const [vendRes, metasRes, bonusRes] = await Promise.all([
        api(`/filtros?setor=DISTRIBUIDORES`, { cache: 'no-store' }).then(r => r.json()),
        api(`/distribuidores/metas?ano=${ano}&mes=${mes}`).then(r => r.json()),
        api(`/distribuidores/bonus?ano=${ano}&mes=${mes}`).then(r => r.json()),
      ]);
      setDistVendedores(vendRes.vendedores || []);
      const metasMap: Record<string, DistVendedorMeta> = {};
      if (Array.isArray(metasRes)) metasRes.forEach((m: DistVendedorMeta) => { metasMap[m.nome_vendedor] = m; });
      setDistMetasEdit(metasMap);
      const bonusMap: Record<string, DistVendedorBonus> = {};
      if (Array.isArray(bonusRes)) bonusRes.forEach((b: DistVendedorBonus) => { bonusMap[b.nome_vendedor] = b; });
      setDistBonusEdit(bonusMap);
    } catch { /* silent */ }
    setLoadingDist(false);
  };

  const getDistMeta = (nome: string): DistVendedorMeta =>
    distMetasEdit[nome] || { nome_vendedor: nome, meta1_valor: 0, meta1_percentual: 0, meta2_valor: 0, meta2_percentual: 0, meta3_valor: 0, meta3_percentual: 0, metadesafio_valor: 0, metadesafio_percentual: 0, percentual_sem_meta: 0 };

  const getDistBonus = (nome: string): DistVendedorBonus =>
    distBonusEdit[nome] || { nome_vendedor: nome, bonus1_valor: 0, bonus2_valor: 0, bonus3_valor: 0, bonusdesafio_valor: 0 };

  const updateDistMeta = (nome: string, field: keyof Omit<DistVendedorMeta, 'nome_vendedor'>, value: number) => {
    setSavedDistMetas(false);
    setDistMetasEdit(prev => ({ ...prev, [nome]: { ...getDistMeta(nome), [field]: value } }));
  };

  const updateDistBonus = (nome: string, field: keyof Omit<DistVendedorBonus, 'nome_vendedor'>, value: number) => {
    setSavedDistBonus(false);
    setDistBonusEdit(prev => ({ ...prev, [nome]: { ...getDistBonus(nome), [field]: value } }));
  };

  const salvarDistBonus = async () => {
    setSavingDistBonus(true);
    try {
      const payload = distVendedores.map(v => ({ ...getDistBonus(v), nome_vendedor: v, ano: distAnoConf, mes: distMesConf }));
      const res = await api('/distribuidores/bonus', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(await res.text());
      setSavedDistBonus(true);
      setTimeout(() => setSavedDistBonus(false), 3000);
    } catch (err) { console.error(err); alert('Erro ao salvar bônus Distribuidores.'); }
    setSavingDistBonus(false);
  };

  const salvarDistMetas = async () => {
    setSavingDistMetas(true);
    try {
      const payload = distVendedores.map(v => ({ ...getDistMeta(v), nome_vendedor: v, ano: distAnoConf, mes: distMesConf }));
      const res = await api('/distribuidores/metas', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(await res.text());
      setSavedDistMetas(true);
      setTimeout(() => setSavedDistMetas(false), 3000);
    } catch (err) { console.error(err); alert('Erro ao salvar metas Distribuidores.'); }
    setSavingDistMetas(false);
  };

  const carregarVinculosDistribuidores = async () => {
    setLoadingDistVinculos(true);
    try {
      const [rawRes, vincRes] = await Promise.all([
        api('/distribuidores/vendedores-raw').then(r => r.json()),
        api('/distribuidores/vinculos').then(r => r.json()),
      ]);
      setDistNomesRaw(rawRes.vendedores || []);
      const map: Record<string, string> = {};
      if (Array.isArray(vincRes)) {
        vincRes.forEach((v: { vendedor_vinculado: string; vendedor_principal: string }) => {
          map[v.vendedor_vinculado] = v.vendedor_principal;
        });
      }
      setDistVinculos(map);
    } catch { /* silent */ }
    setLoadingDistVinculos(false);
  };

  const adicionarVinculo = () => {
    if (!novoVinculado || !novoPrincipal || novoVinculado === novoPrincipal) return;
    setDistVinculos(prev => ({ ...prev, [novoVinculado]: novoPrincipal }));
    setSavedDistVinculos(false);
    setNovoVinculado('');
    setNovoPrincipal('');
  };

  const removerVinculo = (vinculado: string) => {
    setDistVinculos(prev => {
      const next = { ...prev };
      delete next[vinculado];
      return next;
    });
    setSavedDistVinculos(false);
  };

  const salvarDistVinculos = async () => {
    setSavingDistVinculos(true);
    try {
      const payload = Object.entries(distVinculos).map(([vendedor_vinculado, vendedor_principal]) => ({
        vendedor_vinculado, vendedor_principal,
      }));
      const res = await api('/distribuidores/vinculos', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      setSavedDistVinculos(true);
      setTimeout(() => setSavedDistVinculos(false), 3000);
    } catch (err) { console.error(err); alert('Erro ao salvar vínculos Distribuidores.'); }
    setSavingDistVinculos(false);
  };

  const setoresUsuarioKey = usuario && usuario !== 'loading' ? (usuario.setores || []).join('|') : '';
  const setoresUsuario = useMemo(() => setoresUsuarioKey ? setoresUsuarioKey.split('|') : [], [setoresUsuarioKey]);
  const isAdm = usuario && usuario !== 'loading' && usuario.cargo === 'ADM';
  const abasPrincipais = useMemo(() => ([
    { key: 'televendas', label: 'Televendas', allowed: isAdm || setoresUsuario.some((s) => s === 'TELEVENDAS' || s === 'TELEVENDAS MG') },
    { key: 'ferragens', label: 'Ferragens', allowed: isAdm || setoresUsuario.includes('FERRAGENS') },
    { key: 'distribuidores', label: 'Distribuidores', allowed: isAdm || setoresUsuario.includes('DISTRIBUIDORES') },
    { key: 'vendedores', label: 'Vendedores', allowed: isAdm || setoresUsuario.length > 0 },
  ] as const).filter((tab) => tab.allowed), [isAdm, setoresUsuario]);

  useEffect(() => {
    if (abasPrincipais.length && !abasPrincipais.some((tab) => tab.key === aba)) {
      setAba(abasPrincipais[0].key);
    }
  }, [aba, abasPrincipais]);

  const vendedoresFiltrados = allVendedores.filter(
    (v) => !buscaVend || v.toLowerCase().includes(buscaVend.toLowerCase())
  );

  return (
    <AppShell loading={loading}>
      <div className="p-6 space-y-6 animate-fade-in">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#00205C' }}>Configuração</h1>
          <p className="text-sm mt-0.5" style={{ color: '#64748b' }}>
            Metas, bônus e configurações por setor
          </p>
        </div>

        {/* Abas principais */}
        <div className="flex items-center gap-1 rounded-xl p-1 w-fit" style={{ background: '#f1f5f9' }}>
          {abasPrincipais.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setAba(tab.key)}
              className="px-5 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: aba === tab.key ? '#00205C' : 'transparent',
                color: aba === tab.key ? '#FFD700' : '#64748b',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════
            ABA: TELEVENDAS
        ══════════════════════════════ */}
        {aba === 'televendas' && (
          <div className="space-y-5">
            {/* Sub-abas Televendas */}
            <div className="flex items-center gap-1 rounded-xl p-1 w-fit" style={{ background: '#f1f5f9' }}>
              {([
                { key: 'metas', label: 'Metas PA' },
                { key: 'bonus', label: 'Bônus' },
              ] as const).map((sub) => (
                <button key={sub.key} onClick={() => setTvAba(sub.key)}
                  className="px-4 py-1.5 rounded-lg text-sm font-semibold transition-all"
                  style={{ background: tvAba === sub.key ? '#00205C' : 'transparent', color: tvAba === sub.key ? '#FFD700' : '#64748b' }}>
                  {sub.label}
                </button>
              ))}
            </div>

          {tvAba === 'metas' && (<>
            {/* Período */}
            <div className="rounded-xl p-4 flex items-center gap-5 flex-wrap"
              style={{ background: '#ffffff', border: '2px solid #00205C' }}>
              <div className="flex items-center gap-2 shrink-0">
                <Calendar size={18} style={{ color: '#00205C' }} />
                <span className="text-sm font-semibold" style={{ color: '#00205C' }}>
                  Período de referência:
                </span>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex flex-col gap-0.5">
                  <label className="text-xs font-medium uppercase tracking-wide" style={{ color: '#64748b' }}>Mês</label>
                  <select
                    value={mesMeta}
                    onChange={(e) => setMesMeta(parseInt(e.target.value))}
                    className="rounded-lg px-3 py-2 text-sm font-semibold outline-none cursor-pointer"
                    style={{ border: '1px solid #cbd5e1', color: '#00205C', minWidth: 140 }}
                  >
                    {MESES.map((m, i) => (
                      <option key={i + 1} value={i + 1}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-0.5">
                  <label className="text-xs font-medium uppercase tracking-wide" style={{ color: '#64748b' }}>Ano</label>
                  <select
                    value={anoMeta}
                    onChange={(e) => setAnoMeta(parseInt(e.target.value))}
                    className="rounded-lg px-3 py-2 text-sm font-semibold outline-none cursor-pointer"
                    style={{ border: '1px solid #cbd5e1', color: '#00205C', minWidth: 100 }}
                  >
                    {ANOS_META.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>
                <div className="px-3 py-1.5 rounded-lg text-sm font-bold mt-4"
                  style={{ background: '#00205C', color: '#FFD700' }}>
                  {MESES[mesMeta - 1]} {anoMeta}
                </div>
              </div>
            </div>

            {loading ? (
              <div className="text-center py-12" style={{ color: '#94a3b8' }}>Carregando...</div>
            ) : (
              <div className="relative rounded-xl shadow-sm overflow-hidden"
                style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>

                {savingMensais && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl"
                    style={{ background: 'rgba(255,255,255,0.65)', backdropFilter: 'blur(3px)' }}>
                    <div className="flex items-center gap-3 px-6 py-3 rounded-xl shadow-lg"
                      style={{ background: '#00205C', color: '#FFD700' }}>
                      <Loader2 size={18} className="animate-spin" />
                      <span className="text-sm font-semibold">Salvando metas...</span>
                    </div>
                  </div>
                )}

                {/* Toolbar */}
                <div className="flex items-center justify-between px-5 py-4 gap-3 flex-wrap"
                  style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <div className="rounded-lg p-3 flex items-start gap-2 flex-1"
                    style={{ background: '#0a1628', border: '1px solid #1a3a6e' }}>
                    <AlertCircle size={15} style={{ color: '#FFD700' }} className="shrink-0 mt-0.5" />
                    <p className="text-xs" style={{ color: '#94a3b8' }}>
                      <strong className="text-white">Televendas / Televendas MG:</strong> comissão calculada sobre os recebimentos.
                      Se não bater nenhuma meta PA, aplica-se o <strong className="text-white">% Sem Meta</strong>.
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <input
                      type="text"
                      value={buscaVend}
                      onChange={(e) => setBuscaVend(e.target.value)}
                      placeholder="Buscar vendedor..."
                      className="rounded-lg px-3 py-1.5 text-sm outline-none"
                      style={{ border: '1px solid #e2e8f0', color: '#0a1628', width: 200 }}
                    />
                    <button
                      onClick={salvarMetasMensais}
                      disabled={savingMensais}
                      className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all"
                      style={{
                        background: savingMensais ? '#e2e8f0' : savedMensais ? '#16a34a' : '#FFD700',
                        color: savingMensais ? '#64748b' : savedMensais ? '#ffffff' : '#00205C',
                      }}
                    >
                      {savingMensais ? (
                        <><Loader2 size={15} className="animate-spin" /> Salvando...</>
                      ) : savedMensais ? (
                        <><CheckCircle size={15} /> Salvo!</>
                      ) : (
                        <><Save size={15} /> Salvar</>
                      )}
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  {/* Cabeçalho */}
                  <div className="grid px-5 py-2 text-xs font-semibold uppercase tracking-wider"
                    style={{
                      gridTemplateColumns: '280px repeat(3, 230px) 140px',
                      minWidth: 1210,
                      borderBottom: '1px solid #f1f5f9',
                      background: '#f8fafc',
                      color: '#64748b',
                    }}>
                    <span>Vendedor</span>
                    {(['Meta PA 1', 'Meta PA 2', 'Meta PA 3'] as const).map((label, i) => (
                      <span key={i} className="text-center px-4 py-1 rounded-full mx-2"
                        style={{
                          background: ['#dbeafe','#d1fae5','#fef3c7'][i],
                          color: ['#1e40af','#065f46','#92400e'][i],
                        }}>
                        {label}
                      </span>
                    ))}
                    <span className="text-center px-2 py-1 rounded-full"
                      style={{ background: '#fee2e2', color: '#991b1b' }}>
                      % Sem Meta
                    </span>
                  </div>

                  {/* Linhas */}
                  <div className="divide-y" style={{ borderColor: '#f1f5f9', minWidth: 1130 }}>
                    {vendedoresFiltrados.map((v) => {
                      const m = getMensal(v);
                      const temMeta = !!metasMensaisEdit[v];
                      return (
                        <div key={v}
                          className="grid items-center px-5 py-3"
                          style={{ gridTemplateColumns: '280px repeat(3, 230px) 140px' }}
                          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#f8fafc')}
                          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '')}>

                          <div className="flex items-center gap-2 pr-3">
                            <span className="text-sm font-medium" style={{ color: '#0a1628' }}>{v}</span>
                            {temMeta && (
                              <span className="text-xs px-1.5 py-0.5 rounded-full shrink-0"
                                style={{ background: '#d1fae5', color: '#065f46' }}>✓</span>
                            )}
                          </div>

                          {([
                            { vField: 'meta1_valor', pField: 'meta1_percentual', bg: '#eff6ff', border: '#bfdbfe' },
                            { vField: 'meta2_valor', pField: 'meta2_percentual', bg: '#f0fdf4', border: '#bbf7d0' },
                            { vField: 'meta3_valor', pField: 'meta3_percentual', bg: '#fffbeb', border: '#fde68a' },
                          ] as { vField: keyof Omit<VendedorMeta,'nome_vendedor'>; pField: keyof Omit<VendedorMeta,'nome_vendedor'>; bg: string; border: string }[]).map(({ vField, pField, bg, border }) => (
                            <div key={vField}
                              className="flex items-center gap-1.5 mx-2 px-2 py-1.5 rounded-lg"
                              style={{ background: bg, border: `1px solid ${border}` }}>
                              <span className="text-xs shrink-0" style={{ color: '#64748b' }}>R$</span>
                              <ValorInput value={m[vField] as number}
                                onChange={(val) => updateMensal(v, vField, val)}
                                className="flex-1 min-w-0 rounded px-1.5 py-1 text-xs text-right outline-none bg-white font-medium"
                                style={{ border: '1px solid #e2e8f0', color: '#0a1628' }}
                                placeholder="0" />
                              <input type="number" min={0} max={100} step={0.5} value={m[pField] as number}
                                onChange={(e) => updateMensal(v, pField, parseFloat(e.target.value) || 0)}
                                className="w-14 rounded px-1.5 py-1 text-xs text-center outline-none font-bold"
                                style={{ border: '1px solid #e2e8f0', color: '#00205C', background: '#ffffff' }}
                                placeholder="0" onFocus={(e) => e.target.select()} />
                              <span className="text-xs shrink-0" style={{ color: '#64748b' }}>%</span>
                            </div>
                          ))}

                          {/* % Sem Meta */}
                          <div className="flex items-center gap-1.5 mx-2 px-2 py-1.5 rounded-lg"
                            style={{ background: '#fff1f2', border: '1px solid #fecdd3' }}>
                            <PctInput
                              value={m.percentual_sem_meta}
                              onChange={(val) => updateMensal(v, 'percentual_sem_meta', val)}
                              className="flex-1 min-w-0 rounded px-1.5 py-1 text-xs text-center outline-none font-bold"
                              style={{ border: '1px solid #e2e8f0', color: '#991b1b', background: '#ffffff' }}
                              placeholder="0" />
                            <span className="text-xs shrink-0" style={{ color: '#64748b' }}>%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>)}

          {tvAba === 'bonus' && (
            <div className="space-y-5">
              <div className="rounded-xl p-4 flex items-start gap-3"
                style={{ background: '#0a1628', border: '1px solid #1a3a6e' }}>
                <AlertCircle size={18} style={{ color: '#FFD700' }} className="shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed" style={{ color: '#94a3b8' }}>
                  <strong className="text-white">Bônus global — Televendas / Televendas MG.</strong>{' '}
                  Este bônus vale para todas as vendedoras e todos os meses. Altere apenas quando quiser mudar as regras.
                  O bônus é <strong className="text-white">desbloqueado ao atingir a Meta PA 1</strong> e aplica-se
                  a <strong className="text-white">% da maior faixa atingida sobre o valor PA</strong> total.
                </p>
              </div>
              <div className="relative rounded-xl shadow-sm overflow-hidden"
                style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
                {savingBonus && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl"
                    style={{ background: 'rgba(255,255,255,0.65)', backdropFilter: 'blur(3px)' }}>
                    <div className="flex items-center gap-3 px-6 py-3 rounded-xl shadow-lg"
                      style={{ background: '#00205C', color: '#FFD700' }}>
                      <Loader2 size={18} className="animate-spin" />
                      <span className="text-sm font-semibold">Salvando bônus...</span>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between px-5 py-4"
                  style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                  <p className="text-sm font-bold" style={{ color: '#00205C' }}>
                    5 faixas de bônus sobre o valor PA
                  </p>
                  <button onClick={salvarBonus} disabled={savingBonus}
                    className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all"
                    style={{ background: savingBonus ? '#e2e8f0' : savedBonus ? '#16a34a' : '#FFD700', color: savingBonus ? '#64748b' : savedBonus ? '#ffffff' : '#00205C' }}>
                    {savingBonus ? <><Loader2 size={15} className="animate-spin" /> Salvando...</> : savedBonus ? <><CheckCircle size={15} /> Salvo!</> : <><Save size={15} /> Salvar Bônus</>}
                  </button>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-5 gap-4">
                    {BONUS_CORES.map((cor, i) => {
                      const n = (i + 1) as 1|2|3|4|5;
                      const vField = `bonus${n}_valor` as keyof BonusConfig;
                      const pField = `bonus${n}_percentual` as keyof BonusConfig;
                      return (
                        <div key={n} className="rounded-xl p-4 flex flex-col gap-3"
                          style={{ background: cor.bg, border: `1px solid ${cor.border}` }}>
                          <p className="text-xs font-bold uppercase tracking-wide text-center"
                            style={{ color: cor.text }}>{cor.label}</p>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs" style={{ color: '#64748b' }}>Mínimo de vendas PA</label>
                            <div className="flex items-center gap-1 rounded-lg px-2 py-1.5 bg-white"
                              style={{ border: '1px solid #e2e8f0' }}>
                              <span className="text-xs shrink-0" style={{ color: '#94a3b8' }}>R$</span>
                              <ValorInput
                                value={bonusEdit[vField] as number}
                                onChange={(val) => updateBonus(vField, val)}
                                className="flex-1 min-w-0 text-xs text-right outline-none font-medium bg-transparent"
                                style={{ color: '#0a1628' }} placeholder="0" />
                            </div>
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs" style={{ color: '#64748b' }}>% sobre valor PA</label>
                            <div className="flex items-center gap-1 rounded-lg px-2 py-1.5 bg-white"
                              style={{ border: '1px solid #e2e8f0' }}>
                              <input type="number" min={0} max={100} step={0.5}
                                value={bonusEdit[pField] as number}
                                onChange={(e) => updateBonus(pField, parseFloat(e.target.value) || 0)}
                                className="flex-1 min-w-0 text-sm text-center outline-none font-bold bg-transparent"
                                style={{ color: cor.text }} placeholder="0" onFocus={(e) => e.target.select()} />
                              <span className="text-xs shrink-0" style={{ color: '#64748b' }}>%</span>
                            </div>
                          </div>
                          {(bonusEdit[vField] as number) > 0 && (bonusEdit[pField] as number) > 0 && (
                            <p className="text-xs text-center rounded-lg py-1"
                              style={{ background: cor.border, color: cor.text }}>
                              A partir de R$ {((bonusEdit[vField] as number) / 1000).toFixed(0)}k → {bonusEdit[pField]}%
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
          </div>
        )}
        {/* ══════════════════════════════
            ABA: FERRAGENS
        ══════════════════════════════ */}
        {aba === 'ferragens' && (
          <div className="space-y-5">
            {/* Sub-abas Ferragens */}
            <div className="flex items-center gap-1 rounded-xl p-1 w-fit" style={{ background: '#f1f5f9' }}>
              {([
                { key: 'metas', label: 'Metas' },
                { key: 'bonus', label: 'Bônus' },
                { key: 'grupo', label: 'Meta Grupo' },
              ] as const).map((sub) => (
                <button key={sub.key} onClick={() => setFerrAba(sub.key)}
                  className="px-4 py-1.5 rounded-lg text-sm font-semibold transition-all"
                  style={{ background: ferrAba === sub.key ? '#00205C' : 'transparent', color: ferrAba === sub.key ? '#FFD700' : '#64748b' }}>
                  {sub.label}
                </button>
              ))}
            </div>

            {/* Período */}
            <div className="rounded-xl p-4 flex items-center gap-5 flex-wrap"
              style={{ background: '#ffffff', border: '2px solid #00205C' }}>
              <div className="flex items-center gap-2 shrink-0">
                <Calendar size={18} style={{ color: '#00205C' }} />
                <span className="text-sm font-semibold" style={{ color: '#00205C' }}>Período de referência:</span>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex flex-col gap-0.5">
                  <label className="text-xs font-medium uppercase tracking-wide" style={{ color: '#64748b' }}>Mês</label>
                  <select value={ferrMesConf} onChange={(e) => setFerrMesConf(parseInt(e.target.value))}
                    className="rounded-lg px-3 py-2 text-sm font-semibold outline-none cursor-pointer"
                    style={{ border: '1px solid #cbd5e1', color: '#00205C', minWidth: 140 }}>
                    {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-0.5">
                  <label className="text-xs font-medium uppercase tracking-wide" style={{ color: '#64748b' }}>Ano</label>
                  <select value={ferrAnoConf} onChange={(e) => setFerrAnoConf(parseInt(e.target.value))}
                    className="rounded-lg px-3 py-2 text-sm font-semibold outline-none cursor-pointer"
                    style={{ border: '1px solid #cbd5e1', color: '#00205C', minWidth: 100 }}>
                    {ANOS_META.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div className="px-3 py-1.5 rounded-lg text-sm font-bold mt-4"
                  style={{ background: '#00205C', color: '#FFD700' }}>
                  {MESES[ferrMesConf - 1]} {ferrAnoConf}
                </div>
              </div>
            </div>

            {loadingFerr ? (
              <div className="text-center py-12" style={{ color: '#94a3b8' }}>Carregando...</div>
            ) : (
              <>
                {/* ── METAS POR VENDEDOR ── */}
                {ferrAba === 'metas' && (
                  <div className="relative rounded-xl shadow-sm overflow-hidden"
                    style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
                    <div className="flex items-center justify-between px-5 py-4 gap-3 flex-wrap"
                      style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                      <div className="rounded-lg p-3 flex items-start gap-2 flex-1"
                        style={{ background: '#0a1628', border: '1px solid #1a3a6e' }}>
                        <AlertCircle size={15} style={{ color: '#FFD700' }} className="shrink-0 mt-0.5" />
                        <p className="text-xs" style={{ color: '#94a3b8' }}>
                          <strong className="text-white">Ferragens:</strong> comissão calculada sobre o <strong className="text-white">total vendido</strong>.
                          Se não bater nenhuma meta, aplica-se o <strong className="text-white">% Sem Meta</strong> sobre recebimentos.
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <input
                          type="text"
                          value={ferrBuscaVend}
                          onChange={(e) => setFerrBuscaVend(e.target.value)}
                          placeholder="Buscar vendedor..."
                          className="rounded-lg px-3 py-1.5 text-sm outline-none"
                          style={{ border: '1px solid #e2e8f0', color: '#0a1628', width: 200 }}
                        />
                        <button onClick={salvarFerrMetas} disabled={savingFerrMetas}
                          className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all"
                          style={{ background: savingFerrMetas ? '#e2e8f0' : savedFerrMetas ? '#16a34a' : '#FFD700', color: savingFerrMetas ? '#64748b' : savedFerrMetas ? '#ffffff' : '#00205C' }}>
                          {savingFerrMetas ? <><Loader2 size={15} className="animate-spin" /> Salvando...</> : savedFerrMetas ? <><CheckCircle size={15} /> Salvo!</> : <><Save size={15} /> Salvar Metas</>}
                        </button>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <div className="grid px-5 py-2 text-xs font-semibold uppercase tracking-wider"
                        style={{ gridTemplateColumns: '220px repeat(4, 200px) 120px', minWidth: 1200, borderBottom: '1px solid #f1f5f9', background: '#f8fafc', color: '#64748b' }}>
                        <span>Vendedor</span>
                        {['Meta 1', 'Meta 2', 'Meta 3', 'Meta Desafio'].map((l, i) => (
                          <span key={i} className="text-center px-3 py-1 rounded-full mx-2"
                            style={{ background: ['#dbeafe','#d1fae5','#fef3c7','#e9d5ff'][i], color: ['#1e40af','#065f46','#92400e','#6b21a8'][i] }}>{l}</span>
                        ))}
                        <span className="text-center px-2 py-1 rounded-full" style={{ background: '#fee2e2', color: '#991b1b' }}>% Sem Meta</span>
                      </div>
                      <div className="divide-y" style={{ borderColor: '#f1f5f9', minWidth: 1200 }}>
                        {ferrVendedores.filter(v => !ferrBuscaVend || v.toLowerCase().includes(ferrBuscaVend.toLowerCase())).map((v) => {
                          const m = getFerrMeta(v);
                          const temConf = !!ferrMetasEdit[v];
                          return (
                            <div key={v} className="grid items-center px-5 py-3"
                              style={{ gridTemplateColumns: '220px repeat(4, 200px) 120px' }}
                              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#f8fafc')}
                              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '')}>
                              <div className="flex items-center gap-2 pr-3">
                                <span className="text-sm font-medium" style={{ color: '#0a1628' }}>{v}</span>
                                {temConf && <span className="text-xs px-1.5 py-0.5 rounded-full shrink-0" style={{ background: '#d1fae5', color: '#065f46' }}>✓</span>}
                              </div>
                              {([
                                { vf: 'meta1_valor' as const, pf: 'meta1_percentual' as const, bg: '#eff6ff', border: '#bfdbfe' },
                                { vf: 'meta2_valor' as const, pf: 'meta2_percentual' as const, bg: '#f0fdf4', border: '#bbf7d0' },
                                { vf: 'meta3_valor' as const, pf: 'meta3_percentual' as const, bg: '#fffbeb', border: '#fde68a' },
                                { vf: 'metadesafio_valor' as const, pf: 'metadesafio_percentual' as const, bg: '#fdf4ff', border: '#e9d5ff' },
                              ]).map(({ vf, pf, bg, border }) => (
                                <div key={vf} className="flex items-center gap-1 mx-2 px-2 py-1.5 rounded-lg"
                                  style={{ background: bg, border: `1px solid ${border}` }}>
                                  <span className="text-xs shrink-0" style={{ color: '#64748b' }}>R$</span>
                                  <ValorInput value={m[vf]}
                                    onChange={(val) => updateFerrMeta(v, vf, val)}
                                    className="flex-1 min-w-0 rounded px-1 py-1 text-xs text-right outline-none bg-white font-medium"
                                    style={{ border: '1px solid #e2e8f0', color: '#0a1628' }}
                                    placeholder="0" />
                                  <input type="number" min={0} max={100} step={0.5} value={m[pf]}
                                    onChange={(e) => updateFerrMeta(v, pf, parseFloat(e.target.value) || 0)}
                                    className="w-12 rounded px-1 py-1 text-xs text-center outline-none font-bold"
                                    style={{ border: '1px solid #e2e8f0', color: '#00205C', background: '#ffffff' }}
                                    placeholder="0" onFocus={(e) => e.target.select()} />
                                  <span className="text-xs shrink-0" style={{ color: '#64748b' }}>%</span>
                                </div>
                              ))}
                              <div className="flex items-center gap-1 mx-2 px-2 py-1.5 rounded-lg"
                                style={{ background: '#fff1f2', border: '1px solid #fecdd3' }}>
                                <PctInput value={m.percentual_sem_meta}
                                  onChange={(val) => updateFerrMeta(v, 'percentual_sem_meta', val)}
                                  className="flex-1 min-w-0 rounded px-1.5 py-1 text-xs text-center outline-none font-bold"
                                  style={{ border: '1px solid #e2e8f0', color: '#991b1b', background: '#ffffff' }}
                                  placeholder="0" />
                                <span className="text-xs shrink-0" style={{ color: '#64748b' }}>%</span>
                              </div>
                            </div>
                          );
                        })}
                        {ferrVendedores.length === 0 && (
                          <div className="text-center py-10 text-sm" style={{ color: '#94a3b8' }}>
                            Nenhuma vendedora Ferragens encontrada
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── BÔNUS POR VENDEDOR ── */}
                {ferrAba === 'bonus' && (
                  <div className="relative rounded-xl shadow-sm overflow-hidden"
                    style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
                    <div className="flex items-center justify-between px-5 py-4 gap-3 flex-wrap"
                      style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                      <p className="text-sm font-bold" style={{ color: '#00205C' }}>
                        Bônus individual por faixa de meta — valor fixo em R$
                      </p>
                      <div className="flex items-center gap-3 shrink-0">
                        <input
                          type="text"
                          value={ferrBuscaVend}
                          onChange={(e) => setFerrBuscaVend(e.target.value)}
                          placeholder="Buscar vendedor..."
                          className="rounded-lg px-3 py-1.5 text-sm outline-none"
                          style={{ border: '1px solid #e2e8f0', color: '#0a1628', width: 200 }}
                        />
                        <button onClick={salvarFerrBonus} disabled={savingFerrBonus}
                          className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all"
                          style={{ background: savingFerrBonus ? '#e2e8f0' : savedFerrBonus ? '#16a34a' : '#FFD700', color: savingFerrBonus ? '#64748b' : savedFerrBonus ? '#ffffff' : '#00205C' }}>
                          {savingFerrBonus ? <><Loader2 size={15} className="animate-spin" /> Salvando...</> : savedFerrBonus ? <><CheckCircle size={15} /> Salvo!</> : <><Save size={15} /> Salvar Bônus</>}
                        </button>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <div className="grid px-5 py-2 text-xs font-semibold uppercase tracking-wider"
                        style={{ gridTemplateColumns: '220px repeat(4, 160px)', minWidth: 860, borderBottom: '1px solid #f1f5f9', background: '#f8fafc', color: '#64748b' }}>
                        <span>Vendedor</span>
                        {['Bônus 1', 'Bônus 2', 'Bônus 3', 'Bônus Desafio'].map((l, i) => (
                          <span key={i} className="text-center px-3 py-1 rounded-full mx-2"
                            style={{ background: ['#dbeafe','#d1fae5','#fef3c7','#e9d5ff'][i], color: ['#1e40af','#065f46','#92400e','#6b21a8'][i] }}>{l}</span>
                        ))}
                      </div>
                      <div className="divide-y" style={{ borderColor: '#f1f5f9', minWidth: 860 }}>
                        {ferrVendedores.filter(v => !ferrBuscaVend || v.toLowerCase().includes(ferrBuscaVend.toLowerCase())).map((v) => {
                          const b = getFerrBonus(v);
                          return (
                            <div key={v} className="grid items-center px-5 py-3"
                              style={{ gridTemplateColumns: '220px repeat(4, 160px)' }}
                              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#f8fafc')}
                              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '')}>
                              <span className="text-sm font-medium pr-3" style={{ color: '#0a1628' }}>{v}</span>
                              {([
                                { f: 'bonus1_valor' as const, bg: '#eff6ff', border: '#bfdbfe' },
                                { f: 'bonus2_valor' as const, bg: '#f0fdf4', border: '#bbf7d0' },
                                { f: 'bonus3_valor' as const, bg: '#fffbeb', border: '#fde68a' },
                                { f: 'bonusdesafio_valor' as const, bg: '#fdf4ff', border: '#e9d5ff' },
                              ]).map(({ f, bg, border }) => (
                                <div key={f} className="flex items-center gap-1 mx-2 px-2 py-1.5 rounded-lg"
                                  style={{ background: bg, border: `1px solid ${border}` }}>
                                  <span className="text-xs shrink-0" style={{ color: '#64748b' }}>R$</span>
                                  <ValorInput value={b[f]}
                                    onChange={(val) => updateFerrBonus(v, f, val)}
                                    className="flex-1 min-w-0 rounded px-1 py-1 text-xs text-right outline-none bg-white font-medium"
                                    style={{ border: '1px solid #e2e8f0', color: '#0a1628' }}
                                    placeholder="0" />
                                </div>
                              ))}
                            </div>
                          );
                        })}
                        {ferrVendedores.length === 0 && (
                          <div className="text-center py-10 text-sm" style={{ color: '#94a3b8' }}>
                            Nenhuma vendedora Ferragens encontrada
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── META GRUPO (SETOR) ── */}
                {ferrAba === 'grupo' && (
                  <div className="space-y-4">
                    <div className="rounded-xl p-4 flex items-start gap-3"
                      style={{ background: '#0a1628', border: '1px solid #1a3a6e' }}>
                      <AlertCircle size={18} style={{ color: '#FFD700' }} className="shrink-0 mt-0.5" />
                      <p className="text-xs leading-relaxed" style={{ color: '#94a3b8' }}>
                        <strong className="text-white">Meta do Setor (Grupo) — Ferragens.</strong>{' '}
                        Define o total de vendas que o setor precisa atingir para liberar o bônus grupo.
                        O bônus grupo só é adicionado para vendedoras que atingiram ao menos a Meta 1 individual.
                      </p>
                    </div>

                    <div className="rounded-xl shadow-sm overflow-hidden"
                      style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
                      <div className="flex items-center justify-between px-5 py-4"
                        style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                        <p className="text-sm font-bold" style={{ color: '#00205C' }}>
                          4 faixas de meta do setor — valor total vendido pelo setor
                        </p>
                        <button onClick={salvarFerrGrupo} disabled={savingFerrGrupo}
                          className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all"
                          style={{ background: savingFerrGrupo ? '#e2e8f0' : savedFerrGrupo ? '#16a34a' : '#FFD700', color: savingFerrGrupo ? '#64748b' : savedFerrGrupo ? '#ffffff' : '#00205C' }}>
                          {savingFerrGrupo ? <><Loader2 size={15} className="animate-spin" /> Salvando...</> : savedFerrGrupo ? <><CheckCircle size={15} /> Salvo!</> : <><Save size={15} /> Salvar Meta Grupo</>}
                        </button>
                      </div>

                      <div className="p-6">
                        <div className="grid grid-cols-4 gap-4">
                          {([
                            { label: 'Meta 1', vf: 'meta1_valor' as const, bf: 'meta1_bonus' as const, bg: '#eff6ff', border: '#bfdbfe', text: '#1e40af' },
                            { label: 'Meta 2', vf: 'meta2_valor' as const, bf: 'meta2_bonus' as const, bg: '#f0fdf4', border: '#bbf7d0', text: '#065f46' },
                            { label: 'Meta 3', vf: 'meta3_valor' as const, bf: 'meta3_bonus' as const, bg: '#fffbeb', border: '#fde68a', text: '#92400e' },
                            { label: 'Meta Desafio', vf: 'metadesafio_valor' as const, bf: 'metadesafio_bonus' as const, bg: '#fdf4ff', border: '#e9d5ff', text: '#6b21a8' },
                          ]).map(({ label, vf, bf, bg, border, text }) => (
                            <div key={label} className="rounded-xl p-4 flex flex-col gap-3"
                              style={{ background: bg, border: `1px solid ${border}` }}>
                              <p className="text-xs font-bold uppercase tracking-wide text-center" style={{ color: text }}>{label}</p>
                              <div className="flex flex-col gap-1">
                                <label className="text-xs" style={{ color: '#64748b' }}>Total do setor mínimo</label>
                                <div className="flex items-center gap-1 rounded-lg px-2 py-1.5 bg-white"
                                  style={{ border: '1px solid #e2e8f0' }}>
                                  <span className="text-xs shrink-0" style={{ color: '#94a3b8' }}>R$</span>
                                  <ValorInput value={ferrMetaGrupoEdit[vf]}
                                    onChange={(val) => updateFerrGrupo(vf, val)}
                                    className="flex-1 min-w-0 text-xs text-right outline-none font-medium bg-transparent"
                                    style={{ color: '#0a1628' }} placeholder="0" />
                                </div>
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-xs" style={{ color: '#64748b' }}>Bônus grupo (R$)</label>
                                <div className="flex items-center gap-1 rounded-lg px-2 py-1.5 bg-white"
                                  style={{ border: '1px solid #e2e8f0' }}>
                                  <span className="text-xs shrink-0" style={{ color: '#94a3b8' }}>R$</span>
                                  <ValorInput value={ferrMetaGrupoEdit[bf]}
                                    onChange={(val) => updateFerrGrupo(bf, val)}
                                    className="flex-1 min-w-0 text-xs text-right outline-none font-medium bg-transparent"
                                    style={{ color: '#0a1628' }} placeholder="0" />
                                </div>
                              </div>
                              {ferrMetaGrupoEdit[vf] > 0 && (
                                <p className="text-xs text-center rounded-lg py-1"
                                  style={{ background: border, color: text }}>
                                  A partir de {formatBRL(ferrMetaGrupoEdit[vf])} → +{formatBRL(ferrMetaGrupoEdit[bf])}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ══════════════════════════════
            ABA: DISTRIBUIDORES
        ══════════════════════════════ */}
        {aba === 'distribuidores' && (
          <div className="space-y-5">
            {/* Sub-abas Distribuidores */}
            <div className="flex items-center gap-1 rounded-xl p-1 w-fit" style={{ background: '#f1f5f9' }}>
              {([
                { key: 'metas', label: 'Metas' },
                { key: 'bonus', label: 'Bônus' },
                { key: 'vinculos', label: 'Vínculos' },
              ] as const).map((sub) => (
                <button key={sub.key} onClick={() => setDistAba(sub.key)}
                  className="px-4 py-1.5 rounded-lg text-sm font-semibold transition-all"
                  style={{ background: distAba === sub.key ? '#00205C' : 'transparent', color: distAba === sub.key ? '#FFD700' : '#64748b' }}>
                  {sub.label}
                </button>
              ))}
            </div>

            {/* Período (compartilhado entre Metas e Bônus) */}
            {distAba !== 'vinculos' && (
              <div className="rounded-xl p-4 flex items-center gap-5 flex-wrap"
                style={{ background: '#ffffff', border: '2px solid #00205C' }}>
                <div className="flex items-center gap-2 shrink-0">
                  <Calendar size={18} style={{ color: '#00205C' }} />
                  <span className="text-sm font-semibold" style={{ color: '#00205C' }}>Período de referência:</span>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex flex-col gap-0.5">
                    <label className="text-xs font-medium uppercase tracking-wide" style={{ color: '#64748b' }}>Mês</label>
                    <select value={distMesConf} onChange={(e) => setDistMesConf(parseInt(e.target.value))}
                      className="rounded-lg px-3 py-2 text-sm font-semibold outline-none cursor-pointer"
                      style={{ border: '1px solid #cbd5e1', color: '#00205C', minWidth: 140 }}>
                      {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <label className="text-xs font-medium uppercase tracking-wide" style={{ color: '#64748b' }}>Ano</label>
                    <select value={distAnoConf} onChange={(e) => setDistAnoConf(parseInt(e.target.value))}
                      className="rounded-lg px-3 py-2 text-sm font-semibold outline-none cursor-pointer"
                      style={{ border: '1px solid #cbd5e1', color: '#00205C', minWidth: 100 }}>
                      {ANOS_META.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  <div className="px-3 py-1.5 rounded-lg text-sm font-bold mt-4"
                    style={{ background: '#00205C', color: '#FFD700' }}>
                    {MESES[distMesConf - 1]} {distAnoConf}
                  </div>
                </div>
              </div>
            )}

            {distAba === 'metas' && (<>
            {loadingDist ? (
              <div className="text-center py-12" style={{ color: '#94a3b8' }}>Carregando...</div>
            ) : (
              <div className="relative rounded-xl shadow-sm overflow-hidden"
                style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
                <div className="flex items-center justify-between px-5 py-4 gap-3 flex-wrap"
                  style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                  <div className="rounded-lg p-3 flex items-start gap-2 flex-1"
                    style={{ background: '#0a1628', border: '1px solid #1a3a6e' }}>
                    <AlertCircle size={15} style={{ color: '#FFD700' }} className="shrink-0 mt-0.5" />
                    <p className="text-xs" style={{ color: '#94a3b8' }}>
                      <strong className="text-white">Distribuidores:</strong> comissão calculada sobre o <strong className="text-white">total vendido</strong>.
                      Se não bater nenhuma meta, aplica-se o <strong className="text-white">% Sem Meta</strong> sobre recebimentos.
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <input
                      type="text"
                      value={distBuscaVend}
                      onChange={(e) => setDistBuscaVend(e.target.value)}
                      placeholder="Buscar vendedor..."
                      className="rounded-lg px-3 py-1.5 text-sm outline-none"
                      style={{ border: '1px solid #e2e8f0', color: '#0a1628', width: 200 }}
                    />
                    <button onClick={salvarDistMetas} disabled={savingDistMetas}
                      className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all"
                      style={{ background: savingDistMetas ? '#e2e8f0' : savedDistMetas ? '#16a34a' : '#FFD700', color: savingDistMetas ? '#64748b' : savedDistMetas ? '#ffffff' : '#00205C' }}>
                      {savingDistMetas ? <><Loader2 size={15} className="animate-spin" /> Salvando...</> : savedDistMetas ? <><CheckCircle size={15} /> Salvo!</> : <><Save size={15} /> Salvar Metas</>}
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <div className="grid px-5 py-2 text-xs font-semibold uppercase tracking-wider"
                    style={{ gridTemplateColumns: '220px repeat(4, 200px) 120px', minWidth: 1200, borderBottom: '1px solid #f1f5f9', background: '#f8fafc', color: '#64748b' }}>
                    <span>Vendedor</span>
                    {['Meta 1', 'Meta 2', 'Meta 3', 'Meta Desafio'].map((l, i) => (
                      <span key={i} className="text-center px-3 py-1 rounded-full mx-2"
                        style={{ background: ['#dbeafe','#d1fae5','#fef3c7','#e9d5ff'][i], color: ['#1e40af','#065f46','#92400e','#6b21a8'][i] }}>{l}</span>
                    ))}
                    <span className="text-center px-2 py-1 rounded-full" style={{ background: '#fee2e2', color: '#991b1b' }}>% Sem Meta</span>
                  </div>
                  <div className="divide-y" style={{ borderColor: '#f1f5f9', minWidth: 1200 }}>
                    {distVendedores.filter(v => !distBuscaVend || v.toLowerCase().includes(distBuscaVend.toLowerCase())).map((v) => {
                      const m = getDistMeta(v);
                      const temConf = !!distMetasEdit[v];
                      return (
                        <div key={v} className="grid items-center px-5 py-3"
                          style={{ gridTemplateColumns: '220px repeat(4, 200px) 120px' }}
                          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#f8fafc')}
                          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '')}>
                          <div className="flex items-center gap-2 pr-3">
                            <span className="text-sm font-medium" style={{ color: '#0a1628' }}>{v}</span>
                            {temConf && <span className="text-xs px-1.5 py-0.5 rounded-full shrink-0" style={{ background: '#d1fae5', color: '#065f46' }}>✓</span>}
                          </div>
                          {([
                            { vf: 'meta1_valor' as const, pf: 'meta1_percentual' as const, bg: '#eff6ff', border: '#bfdbfe' },
                            { vf: 'meta2_valor' as const, pf: 'meta2_percentual' as const, bg: '#f0fdf4', border: '#bbf7d0' },
                            { vf: 'meta3_valor' as const, pf: 'meta3_percentual' as const, bg: '#fffbeb', border: '#fde68a' },
                            { vf: 'metadesafio_valor' as const, pf: 'metadesafio_percentual' as const, bg: '#fdf4ff', border: '#e9d5ff' },
                          ]).map(({ vf, pf, bg, border }) => (
                            <div key={vf} className="flex items-center gap-1 mx-2 px-2 py-1.5 rounded-lg"
                              style={{ background: bg, border: `1px solid ${border}` }}>
                              <span className="text-xs shrink-0" style={{ color: '#64748b' }}>R$</span>
                              <ValorInput value={m[vf]}
                                onChange={(val) => updateDistMeta(v, vf, val)}
                                className="flex-1 min-w-0 rounded px-1 py-1 text-xs text-right outline-none bg-white font-medium"
                                style={{ border: '1px solid #e2e8f0', color: '#0a1628' }}
                                placeholder="0" />
                              <input type="number" min={0} max={100} step={0.5} value={m[pf]}
                                onChange={(e) => updateDistMeta(v, pf, parseFloat(e.target.value) || 0)}
                                className="w-12 rounded px-1 py-1 text-xs text-center outline-none font-bold"
                                style={{ border: '1px solid #e2e8f0', color: '#00205C', background: '#ffffff' }}
                                placeholder="0" onFocus={(e) => e.target.select()} />
                              <span className="text-xs shrink-0" style={{ color: '#64748b' }}>%</span>
                            </div>
                          ))}
                          <div className="flex items-center gap-1 mx-2 px-2 py-1.5 rounded-lg"
                            style={{ background: '#fff1f2', border: '1px solid #fecdd3' }}>
                            <PctInput value={m.percentual_sem_meta}
                              onChange={(val) => updateDistMeta(v, 'percentual_sem_meta', val)}
                              className="flex-1 min-w-0 rounded px-1.5 py-1 text-xs text-center outline-none font-bold"
                              style={{ border: '1px solid #e2e8f0', color: '#991b1b', background: '#ffffff' }}
                              placeholder="0" />
                            <span className="text-xs shrink-0" style={{ color: '#64748b' }}>%</span>
                          </div>
                        </div>
                      );
                    })}
                    {distVendedores.length === 0 && (
                      <div className="text-center py-10 text-sm" style={{ color: '#94a3b8' }}>
                        Nenhum vendedor Distribuidores encontrado
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            </>)}

            {distAba === 'bonus' && (
              loadingDist ? (
                <div className="text-center py-12" style={{ color: '#94a3b8' }}>Carregando...</div>
              ) : (
                <div className="relative rounded-xl shadow-sm overflow-hidden"
                  style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
                  <div className="flex items-center justify-between px-5 py-4 gap-3 flex-wrap"
                    style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                    <p className="text-sm font-bold" style={{ color: '#00205C' }}>
                      Bônus individual por faixa de meta — valor fixo em R$
                    </p>
                    <div className="flex items-center gap-3 shrink-0">
                      <input
                        type="text"
                        value={distBuscaVend}
                        onChange={(e) => setDistBuscaVend(e.target.value)}
                        placeholder="Buscar vendedor..."
                        className="rounded-lg px-3 py-1.5 text-sm outline-none"
                        style={{ border: '1px solid #e2e8f0', color: '#0a1628', width: 200 }}
                      />
                      <button onClick={salvarDistBonus} disabled={savingDistBonus}
                        className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all"
                        style={{ background: savingDistBonus ? '#e2e8f0' : savedDistBonus ? '#16a34a' : '#FFD700', color: savingDistBonus ? '#64748b' : savedDistBonus ? '#ffffff' : '#00205C' }}>
                        {savingDistBonus ? <><Loader2 size={15} className="animate-spin" /> Salvando...</> : savedDistBonus ? <><CheckCircle size={15} /> Salvo!</> : <><Save size={15} /> Salvar Bônus</>}
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <div className="grid px-5 py-2 text-xs font-semibold uppercase tracking-wider"
                      style={{ gridTemplateColumns: '220px repeat(4, 160px)', minWidth: 860, borderBottom: '1px solid #f1f5f9', background: '#f8fafc', color: '#64748b' }}>
                      <span>Vendedor</span>
                      {['Bônus 1', 'Bônus 2', 'Bônus 3', 'Bônus Desafio'].map((l, i) => (
                        <span key={i} className="text-center px-3 py-1 rounded-full mx-2"
                          style={{ background: ['#dbeafe','#d1fae5','#fef3c7','#e9d5ff'][i], color: ['#1e40af','#065f46','#92400e','#6b21a8'][i] }}>{l}</span>
                      ))}
                    </div>
                    <div className="divide-y" style={{ borderColor: '#f1f5f9', minWidth: 860 }}>
                      {distVendedores.filter(v => !distBuscaVend || v.toLowerCase().includes(distBuscaVend.toLowerCase())).map((v) => {
                        const b = getDistBonus(v);
                        return (
                          <div key={v} className="grid items-center px-5 py-3"
                            style={{ gridTemplateColumns: '220px repeat(4, 160px)' }}
                            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#f8fafc')}
                            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '')}>
                            <span className="text-sm font-medium pr-3" style={{ color: '#0a1628' }}>{v}</span>
                            {([
                              { f: 'bonus1_valor' as const, bg: '#eff6ff', border: '#bfdbfe' },
                              { f: 'bonus2_valor' as const, bg: '#f0fdf4', border: '#bbf7d0' },
                              { f: 'bonus3_valor' as const, bg: '#fffbeb', border: '#fde68a' },
                              { f: 'bonusdesafio_valor' as const, bg: '#fdf4ff', border: '#e9d5ff' },
                            ]).map(({ f, bg, border }) => (
                              <div key={f} className="flex items-center gap-1 mx-2 px-2 py-1.5 rounded-lg"
                                style={{ background: bg, border: `1px solid ${border}` }}>
                                <span className="text-xs shrink-0" style={{ color: '#64748b' }}>R$</span>
                                <ValorInput value={b[f]}
                                  onChange={(val) => updateDistBonus(v, f, val)}
                                  className="flex-1 min-w-0 rounded px-1 py-1 text-xs text-right outline-none bg-white font-medium"
                                  style={{ border: '1px solid #e2e8f0', color: '#0a1628' }}
                                  placeholder="0" />
                              </div>
                            ))}
                          </div>
                        );
                      })}
                      {distVendedores.length === 0 && (
                        <div className="text-center py-10 text-sm" style={{ color: '#94a3b8' }}>
                          Nenhum vendedor Distribuidores encontrado
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            )}

            {distAba === 'vinculos' && (
              <div className="space-y-5">
                <div className="rounded-xl p-4 flex items-start gap-3"
                  style={{ background: '#0a1628', border: '1px solid #1a3a6e' }}>
                  <AlertCircle size={18} style={{ color: '#FFD700' }} className="shrink-0 mt-0.5" />
                  <p className="text-xs leading-relaxed" style={{ color: '#94a3b8' }}>
                    <strong className="text-white">Vínculos entre representantes (todos os setores).</strong>{' '}
                    Um mesmo vendedor às vezes aparece com nomes diferentes ou em lojas/bases diferentes
                    (ex: &quot;DISTRIBUIDOR AFRANIO&quot;), mas deve contar como venda de um único vendedor principal
                    (ex: &quot;DISTRIBUIDOR PRISCILA&quot;). Escolha aqui o vendedor vinculado e para qual principal
                    as vendas e recebimentos dele devem ir — vale para TELEVENDAS, Distribuidores, Ferragens etc.,
                    e é esse nome principal que o cargo &quot;Vendedor&quot; enxerga somado.
                  </p>
                </div>

                {loadingDistVinculos ? (
                  <div className="text-center py-12" style={{ color: '#94a3b8' }}>Carregando...</div>
                ) : (
                  <div className="relative rounded-xl shadow-sm overflow-hidden"
                    style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
                    <div className="flex items-center justify-between px-5 py-4 gap-3 flex-wrap"
                      style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                      <p className="text-sm font-bold" style={{ color: '#00205C' }}>
                        {Object.keys(distVinculos).length} vínculo(s) configurado(s)
                      </p>
                      <button onClick={salvarDistVinculos} disabled={savingDistVinculos}
                        className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all"
                        style={{ background: savingDistVinculos ? '#e2e8f0' : savedDistVinculos ? '#16a34a' : '#FFD700', color: savingDistVinculos ? '#64748b' : savedDistVinculos ? '#ffffff' : '#00205C' }}>
                        {savingDistVinculos ? <><Loader2 size={15} className="animate-spin" /> Salvando...</> : savedDistVinculos ? <><CheckCircle size={15} /> Salvo!</> : <><Save size={15} /> Salvar Vínculos</>}
                      </button>
                    </div>

                    {/* Adicionar novo vínculo */}
                    <div className="flex items-center gap-3 px-5 py-4 flex-wrap" style={{ borderBottom: '1px solid #f1f5f9', background: '#fafbfc' }}>
                      <BuscaSelect
                        value={novoVinculado}
                        onChange={setNovoVinculado}
                        options={distNomesRaw.filter(n => !distVinculos[n])}
                        placeholder="Buscar vendedor vinculado..."
                      />
                      <span className="text-sm font-medium shrink-0" style={{ color: '#64748b' }}>vira vendas de</span>
                      <BuscaSelect
                        value={novoPrincipal}
                        onChange={setNovoPrincipal}
                        options={distNomesRaw.filter(n => n !== novoVinculado)}
                        placeholder="Buscar vendedor principal..."
                      />
                      <button onClick={adicionarVinculo} disabled={!novoVinculado || !novoPrincipal}
                        className="px-4 py-2 rounded-lg text-sm font-semibold shrink-0"
                        style={{ background: !novoVinculado || !novoPrincipal ? '#e2e8f0' : '#00205C', color: !novoVinculado || !novoPrincipal ? '#94a3b8' : '#FFD700' }}>
                        + Adicionar
                      </button>
                    </div>

                    <div className="divide-y" style={{ borderColor: '#f1f5f9' }}>
                      {Object.entries(distVinculos)
                        .sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]))
                        .map(([vinculado, principal]) => (
                          <div key={vinculado} className="flex items-center justify-between px-5 py-3"
                            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#f8fafc')}
                            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '')}>
                            <div className="flex items-center gap-2 text-sm">
                              <span className="font-medium" style={{ color: '#0a1628' }}>{vinculado}</span>
                              <span style={{ color: '#94a3b8' }}>vira vendas de</span>
                              <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: '#d1fae5', color: '#065f46' }}>
                                {principal}
                              </span>
                            </div>
                            <button onClick={() => removerVinculo(vinculado)}
                              className="text-xs font-semibold px-2 py-1 rounded-lg"
                              style={{ color: '#991b1b' }}>
                              Remover
                            </button>
                          </div>
                        ))}
                      {Object.keys(distVinculos).length === 0 && (
                        <div className="text-center py-10 text-sm" style={{ color: '#94a3b8' }}>
                          Nenhum vínculo configurado
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════
            ABA: VENDEDORES
        ══════════════════════════════ */}
        {aba === 'vendedores' && (
          <div className="rounded-xl shadow-sm overflow-hidden"
            style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>

            {/* Toolbar */}
            <div className="flex items-center justify-between px-5 py-4 gap-3 flex-wrap"
              style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
              <div className="flex items-center gap-2">
                <Users size={16} style={{ color: '#00205C' }} />
                <span className="text-sm font-semibold" style={{ color: '#00205C' }}>
                  Visibilidade dos vendedores no painel
                </span>
                {vendedoresComStatus.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: '#d1fae5', color: '#065f46' }}>
                    {vendedoresComStatus.filter((v) => v.ativo).length} ativos de {vendedoresComStatus.length}
                  </span>
                )}
              </div>
              <input
                type="text"
                value={buscaAtivo}
                onChange={(e) => setBuscaAtivo(e.target.value)}
                placeholder="Buscar vendedor..."
                className="rounded-lg px-3 py-1.5 text-sm outline-none"
                style={{ border: '1px solid #e2e8f0', color: '#0a1628', width: 200 }}
              />
            </div>

            {loadingVendAtivo ? (
              <div className="text-center py-12" style={{ color: '#94a3b8' }}>Carregando...</div>
            ) : (
              <div className="divide-y" style={{ borderColor: '#f1f5f9' }}>
                {vendedoresComStatus
                  .filter((v) => !buscaAtivo || v.nome.toLowerCase().includes(buscaAtivo.toLowerCase()))
                  .map((v) => (
                    <div key={v.nome}
                      className="flex items-center justify-between px-5 py-3"
                      style={{ opacity: togglingVend[v.nome] ? 0.5 : 1 }}
                      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#f8fafc')}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '')}>

                      <div className="flex items-center gap-2.5">
                        <span className="text-sm font-medium" style={{ color: v.ativo ? '#0a1628' : '#94a3b8' }}>
                          {v.nome}
                        </span>
                        {!v.ativo && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full"
                            style={{ background: '#fee2e2', color: '#991b1b' }}>
                            inativo
                          </span>
                        )}
                      </div>

                      {/* Toggle switch */}
                      <button
                        onClick={() => toggleVendedorAtivo(v.nome, !v.ativo)}
                        disabled={!!togglingVend[v.nome]}
                        title={v.ativo ? 'Clique para inativar' : 'Clique para ativar'}
                        className="relative inline-flex items-center rounded-full transition-colors duration-200 cursor-pointer focus:outline-none"
                        style={{
                          width: 40,
                          height: 22,
                          background: v.ativo ? '#16a34a' : '#cbd5e1',
                          flexShrink: 0,
                        }}
                      >
                        <span
                          className="inline-block rounded-full bg-white shadow transition-transform duration-200"
                          style={{
                            width: 16,
                            height: 16,
                            transform: v.ativo ? 'translateX(20px)' : 'translateX(3px)',
                          }}
                        />
                      </button>
                    </div>
                  ))}

                {vendedoresComStatus.filter((v) => !buscaAtivo || v.nome.toLowerCase().includes(buscaAtivo.toLowerCase())).length === 0 && (
                  <div className="text-center py-10 text-sm" style={{ color: '#94a3b8' }}>
                    Nenhum vendedor encontrado
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
