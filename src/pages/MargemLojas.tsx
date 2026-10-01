import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Percent, RefreshCw, AlertTriangle, Save, Settings, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import logoWhite from "@/assets/logo-white.png";
import {
  fetchLojasMargem,
  fetchMargem,
  fetchCustosFamilia,
  salvarCustoFamilia,
  type LojaMargem,
  type LinhaMargem,
  type StatusLoja,
  type CustoFamilia,
} from "@/lib/margem-lojas-api";

type Tab = "painel" | "admin";

const NAVY = "#00205C";
const YELLOW = "#FFD700";
const MUTED = "#64748b";
const MUTED_LIGHT = "#94a3b8";
const BORDER = "#e2e8f0";
const PAGE_BG = "#f0f4f8";

const brl = (v: number | null) => (v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v));
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)}%`);
const erro = (e: unknown, f: string) => (e instanceof Error ? e.message : f);

function primeiroDiaDoMes(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}
function fimExclusivo(fim: string): string {
  const d = new Date(`${fim}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function Select({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-lg px-3 py-2 pr-8 text-sm font-medium cursor-pointer"
        style={{ background: "#ffffff", border: `1px solid ${BORDER}`, color: NAVY }}
      >
        {children}
      </select>
      <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: MUTED }} />
    </div>
  );
}

export default function MargemLojas() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("painel");

  const [lojas, setLojas] = useState<LojaMargem[]>([]);
  const [lojaFiltro, setLojaFiltro] = useState("");
  const [produtoFiltro, setProdutoFiltro] = useState("");
  const [inicio, setInicio] = useState(primeiroDiaDoMes());
  const [fim, setFim] = useState(hoje());

  const [linhas, setLinhas] = useState<LinhaMargem[]>([]);
  const [status, setStatus] = useState<StatusLoja[]>([]);
  const [loading, setLoading] = useState(false);
  const [erroMsg, setErroMsg] = useState("");

  const [custosFamilia, setCustosFamilia] = useState<CustoFamilia[]>([]);
  const [custosFamiliaLoading, setCustosFamiliaLoading] = useState(false);
  const [salvando, setSalvando] = useState<number | null>(null);
  const [rascunho, setRascunho] = useState<Record<number, string>>({});
  const [buscaFamilia, setBuscaFamilia] = useState("");

  useEffect(() => {
    fetchLojasMargem().then(setLojas).catch(() => setLojas([]));
  }, []);

  // Guarda a ordem das requisições: se o usuário trocar o filtro rápido (ex:
  // mudar o período logo em seguida), uma resposta mais antiga pode chegar
  // DEPOIS de uma mais nova e sobrescrever a tela com dado desatualizado —
  // os números pareciam "mudar sozinhos". Cada chamada carrega um número de
  // sequência; só aplica o resultado se ainda for a chamada mais recente.
  const margemRequestId = useRef(0);
  const custosRequestId = useRef(0);

  const carregar = useCallback(async () => {
    const minhaRequisicao = ++margemRequestId.current;
    setLoading(true);
    setErroMsg("");
    try {
      const data = await fetchMargem({
        loja: lojaFiltro || undefined,
        produto: produtoFiltro || undefined,
        inicio,
        fim: fimExclusivo(fim),
      });
      if (margemRequestId.current !== minhaRequisicao) return;
      setLinhas(data.linhas);
      setStatus(data.status);
    } catch (e: unknown) {
      if (margemRequestId.current !== minhaRequisicao) return;
      setLinhas([]);
      setErroMsg(erro(e, "Falha ao carregar margem"));
    } finally {
      if (margemRequestId.current === minhaRequisicao) setLoading(false);
    }
  }, [lojaFiltro, produtoFiltro, inicio, fim]);

  const carregarCustosFamilia = useCallback(async () => {
    const minhaRequisicao = ++custosRequestId.current;
    setCustosFamiliaLoading(true);
    try {
      const data = await fetchCustosFamilia();
      if (custosRequestId.current !== minhaRequisicao) return;
      setCustosFamilia(data);
      setRascunho(Object.fromEntries(data.map((f) => [f.familia_codigo, f.custo != null ? String(f.custo) : ""])));
    } catch (e: unknown) {
      if (custosRequestId.current !== minhaRequisicao) return;
      toast.error(erro(e, "Falha ao carregar custos por família"));
    } finally {
      if (custosRequestId.current === minhaRequisicao) setCustosFamiliaLoading(false);
    }
  }, []);

  // Debounce: trocar filtro rápido (digitar no código do produto, ajustar
  // datas em sequência) não dispara uma consulta por tecla — espera 400ms de
  // silêncio antes de ir no banco. Reduz carga no Firebird compartilhado e
  // corta a maior parte das requisições que o guard de sequência acima
  // precisaria descartar.
  useEffect(() => {
    if (tab !== "painel") return;
    const t = setTimeout(() => carregar(), 400);
    return () => clearTimeout(t);
  }, [tab, carregar]);
  useEffect(() => { if (tab === "admin") carregarCustosFamilia(); }, [tab, carregarCustosFamilia]);

  const onSalvarCusto = async (familia_codigo: number) => {
    const valor = Number((rascunho[familia_codigo] ?? "").replace(",", "."));
    if (!Number.isFinite(valor) || valor < 0) {
      toast.error("Custo inválido");
      return;
    }
    setSalvando(familia_codigo);
    try {
      await salvarCustoFamilia(familia_codigo, valor);
      setCustosFamilia((prev) => prev.map((f) => (f.familia_codigo === familia_codigo ? { ...f, custo: valor } : f)));
      toast.success("Custo da família salvo");
    } catch (e: unknown) {
      toast.error(erro(e, "Falha ao salvar custo"));
    } finally {
      setSalvando(null);
    }
  };

  const lojasComErro = status.filter((s) => s.status !== "OK");
  const totalVenda = linhas.reduce((s, l) => s + l.valor_venda, 0);
  const qtdeChaves = linhas.reduce((s, l) => s + (l.eh_chave ? l.qtde_vendida : 0), 0);
  const lucroTotal = linhas.reduce((s, l) => s + (l.lucro ?? 0), 0);
  const rentabilidadePercentual = totalVenda > 0 ? (lucroTotal / totalVenda) * 100 : null;
  const custosFamiliaExibidos = buscaFamilia
    ? custosFamilia.filter((f) => f.familia_nome.toLowerCase().includes(buscaFamilia.toLowerCase()))
    : custosFamilia;

  return (
    <div className="min-h-screen" style={{ background: PAGE_BG, color: NAVY }}>
      {/* Header */}
      <header className="shrink-0" style={{ background: NAVY }}>
        <div className="container mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate("/hub")}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{ background: "rgba(255,255,255,0.1)", color: "#ffffff" }}
          >
            <ArrowLeft size={16} />
          </button>
          <div className="h-5 w-px" style={{ background: "rgba(255,255,255,0.2)" }} />
          <img src={logoWhite} alt="Dovale" className="h-8 w-auto object-contain" />
          <div className="h-5 w-px" style={{ background: "rgba(255,255,255,0.2)" }} />
          <div className="flex items-center gap-2">
            <Percent size={18} style={{ color: YELLOW }} />
            <h1 className="text-sm font-bold tracking-tight text-white">MARGEM DE VENDA DAS LOJAS</h1>
          </div>
          {user && <span className="ml-auto text-xs hidden sm:inline" style={{ color: MUTED_LIGHT }}>{user.displayName}</span>}
        </div>
      </header>

      <main className="container mx-auto px-6 py-6 space-y-6">
        {/* Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setTab("painel")}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors"
            style={tab === "painel" ? { background: NAVY, color: "#ffffff" } : { background: "#ffffff", color: MUTED, border: `1px solid ${BORDER}` }}
          >
            <Percent size={14} />Painel
          </button>
          <button
            onClick={() => setTab("admin")}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors"
            style={tab === "admin" ? { background: NAVY, color: "#ffffff" } : { background: "#ffffff", color: MUTED, border: `1px solid ${BORDER}` }}
          >
            <Settings size={14} />Custo de Chaves
          </button>
        </div>

        {tab === "painel" ? (
          <>
            {/* Filtros */}
            <div className="rounded-xl p-4 shadow-sm flex flex-wrap items-end gap-3" style={{ background: "#ffffff", border: `1px solid ${BORDER}` }}>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: MUTED }}>Loja</label>
                <Select value={lojaFiltro} onChange={setLojaFiltro}>
                  <option value="">Todas as lojas</option>
                  {lojas.map((l) => <option key={l.key} value={l.key}>{l.nome}</option>)}
                </Select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: MUTED }}>Código do Produto</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={produtoFiltro}
                  onChange={(e) => setProdutoFiltro(e.target.value.replace(/\D/g, ""))}
                  placeholder="Todos"
                  className="w-32 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none"
                  style={{ background: "#ffffff", border: `1px solid ${BORDER}`, color: NAVY }}
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: MUTED }}>De</label>
                <input
                  type="date"
                  value={inicio}
                  onChange={(e) => setInicio(e.target.value)}
                  className="rounded-lg px-3 py-2 text-sm font-medium focus:outline-none"
                  style={{ background: "#ffffff", border: `1px solid ${BORDER}`, color: NAVY }}
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: MUTED }}>Até</label>
                <input
                  type="date"
                  value={fim}
                  onChange={(e) => setFim(e.target.value)}
                  className="rounded-lg px-3 py-2 text-sm font-medium focus:outline-none"
                  style={{ background: "#ffffff", border: `1px solid ${BORDER}`, color: NAVY }}
                />
              </div>
              <button
                onClick={carregar}
                disabled={loading}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
                style={{ background: YELLOW, color: NAVY }}
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                Atualizar
              </button>
            </div>

            {erroMsg && (
              <div className="rounded-xl p-4 flex items-center gap-2" style={{ background: "#fef2f2", border: "1px solid #fecaca" }}>
                <AlertTriangle size={16} style={{ color: "#dc2626" }} className="shrink-0" />
                <p className="text-xs" style={{ color: "#991b1b" }}>{erroMsg}</p>
              </div>
            )}

            {lojasComErro.length > 0 && (
              <div className="rounded-xl p-4 flex items-start gap-2" style={{ background: "#fffbeb", border: "1px solid #fde68a" }}>
                <AlertTriangle size={16} style={{ color: "#d97706" }} className="shrink-0 mt-0.5" />
                <div className="text-xs" style={{ color: "#92400e" }}>
                  <p className="font-semibold">Não foi possível consultar algumas lojas (dados abaixo estão incompletos):</p>
                  <p>{lojasComErro.map((s) => s.loja).join(", ")}</p>
                </div>
              </div>
            )}

            {loading ? (
              <div className="py-16 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: NAVY }} /></div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="rounded-xl p-5 shadow-sm" style={{ background: NAVY }}>
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED_LIGHT }}>Venda total (indústria → loja)</p>
                    <p className="text-2xl font-bold mt-2 text-white">{brl(totalVenda)}</p>
                  </div>
                  <div className="rounded-xl p-5 shadow-sm" style={{ background: YELLOW }}>
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: NAVY }}>Quantidade de chaves</p>
                    <p className="text-2xl font-bold mt-2" style={{ color: NAVY }}>{qtdeChaves.toLocaleString("pt-BR")}</p>
                  </div>
                  <div className="rounded-xl p-5 shadow-sm" style={{ background: "#ffffff", border: `1px solid ${BORDER}` }}>
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Lucro total</p>
                    <p className="text-2xl font-bold mt-2" style={{ color: NAVY }}>{brl(lucroTotal)}</p>
                  </div>
                  <div className="rounded-xl p-5 shadow-sm" style={{ background: "#ffffff", border: `1px solid ${BORDER}` }}>
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Rentabilidade</p>
                    <p className="text-2xl font-bold mt-2" style={{ color: NAVY }}>{pct(rentabilidadePercentual)}</p>
                  </div>
                </div>

                <div className="rounded-xl shadow-sm overflow-x-auto" style={{ background: "#ffffff", border: `1px solid ${BORDER}` }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${BORDER}`, background: "#f8fafc" }}>
                        <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest" style={{ color: MUTED }}>Loja</th>
                        <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest" style={{ color: MUTED }}>Código</th>
                        <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest" style={{ color: MUTED }}>Resumo</th>
                        <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest" style={{ color: MUTED }}>Origem</th>
                        <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-widest" style={{ color: MUTED }}>Preço Indústria</th>
                        <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-widest" style={{ color: MUTED }}>Preço EP</th>
                        <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-widest" style={{ color: MUTED }}>Preço Médio</th>
                        <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-widest" style={{ color: MUTED }}>Qtde Vendida</th>
                        <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-widest" style={{ color: MUTED }}>Valor Vendido</th>
                        <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-widest" style={{ color: MUTED }}>Custo Unitário</th>
                        <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-widest" style={{ color: MUTED }}>Custo Total</th>
                        <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-widest" style={{ color: MUTED }}>Lucro</th>
                        <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-widest" style={{ color: MUTED }}>Margem %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linhas.length === 0 ? (
                        <tr><td colSpan={13} className="px-4 py-8 text-center text-xs" style={{ color: MUTED }}>Nenhuma venda encontrada no período/filtro selecionado.</td></tr>
                      ) : (
                        linhas
                          .slice()
                          .sort((a, b) => b.valor_venda - a.valor_venda)
                          .map((l, i) => (
                            <tr key={`${l.loja}-${l.pro_codigo}-${i}`} style={{ borderBottom: `1px solid #f1f5f9` }}>
                              <td className="px-4 py-2.5 font-medium" style={{ color: NAVY }}>{l.loja}</td>
                              <td className="px-4 py-2.5 font-mono text-xs" style={{ color: NAVY }}>{l.pro_codigo}</td>
                              <td className="px-4 py-2.5 text-xs" style={{ color: MUTED }}>{l.pro_resumo || "—"}</td>
                              <td className="px-4 py-2.5">
                                <span
                                  className="rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap"
                                  style={
                                    l.fonte === "EP+INDÚSTRIA"
                                      ? { background: "#ede9fe", color: "#5b21b6" }
                                      : l.fonte === "EP"
                                      ? { background: "#fef3c7", color: "#92400e" }
                                      : { background: "#e0e7ff", color: "#3730a3" }
                                  }
                                >
                                  {l.fonte}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-right" style={{ color: MUTED }}>{l.preco_industria != null ? brl(l.preco_industria) : "—"}</td>
                              <td className="px-4 py-2.5 text-right" style={{ color: MUTED }}>{l.preco_ep != null ? brl(l.preco_ep) : "—"}</td>
                              <td className="px-4 py-2.5 text-right font-medium" style={{ color: NAVY }}>{brl(l.preco_unitario)}</td>
                              <td className="px-4 py-2.5 text-right" style={{ color: NAVY }}>{l.qtde_vendida.toLocaleString("pt-BR")}</td>
                              <td className="px-4 py-2.5 text-right font-medium" style={{ color: NAVY }}>{brl(l.valor_venda)}</td>
                              <td className="px-4 py-2.5 text-right" style={{ color: MUTED }}>{brl(l.custo_unitario)}</td>
                              <td className="px-4 py-2.5 text-right" style={{ color: MUTED }}>{brl(l.custo_total)}</td>
                              <td className="px-4 py-2.5 text-right font-medium" style={{ color: l.lucro != null && l.lucro < 0 ? "#dc2626" : NAVY }}>{brl(l.lucro)}</td>
                              <td className="px-4 py-2.5 text-right font-medium" style={{ color: l.margem_percentual != null && l.margem_percentual < 0 ? "#dc2626" : NAVY }}>{pct(l.margem_percentual)}</td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px]" style={{ color: MUTED }}>
                  Valor vendido = quantidade × preço médio. Preço Indústria e Preço EP vêm sempre da tabela (TABELAS_PRODUTOS.TBP_PRECO da tabela
                  de preço de cada loja, pra produto normal ou chave — não é o valor gravado no pedido); Preço EP é sempre R$ 1,51 fixo, só pra
                  chaves vindas da EP. Preço Médio = valor vendido total / quantidade total, quando o mesmo produto vendeu pelos dois lados
                  (EP+INDÚSTRIA). Custo Unitário = pra chaves, o cadastrado na aba "Custo de Chaves" por FAMÍLIA do produto (vale pra indústria
                  e EP); sem custo cadastrado pra família, cai pro TBP_CUSTO da tabela Atacado — mesma fonte de custo usada nos produtos
                  normais. Lucro = valor vendido − custo total; Margem % = lucro / valor vendido.
                </p>
              </>
            )}
          </>
        ) : (
          <>
            <div className="rounded-xl p-4 shadow-sm flex flex-wrap items-end gap-3" style={{ background: "#ffffff", border: `1px solid ${BORDER}` }}>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: MUTED }}>Buscar por família</label>
                <input
                  type="text"
                  value={buscaFamilia}
                  onChange={(e) => setBuscaFamilia(e.target.value)}
                  placeholder="Ex: Yale"
                  className="w-48 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none"
                  style={{ background: "#ffffff", border: `1px solid ${BORDER}`, color: NAVY }}
                />
              </div>
              <button
                onClick={carregarCustosFamilia}
                disabled={custosFamiliaLoading}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
                style={{ background: YELLOW, color: NAVY }}
              >
                <RefreshCw size={14} className={custosFamiliaLoading ? "animate-spin" : ""} />
                Atualizar
              </button>
            </div>

            <p className="text-[11px]" style={{ color: MUTED }}>
              O custo é cadastrado por FAMÍLIA de chave (ex: Yale, Tetra, Gorje) — um custo só vale pra todas as chaves daquela família,
              simplificando o cadastro. Não é por período — vale sempre, pra todos os meses, até você trocar, e vale tanto pras vendas
              pela indústria quanto pela EP (é o mesmo custo nos dois canais). Lista todas as famílias que têm chave cadastrada em SJC
              e/ou MG. Sem custo cadastrado aqui, o painel usa o TBP_CUSTO da tabela Atacado como padrão, por produto — a mesma fonte de
              custo dos produtos normais.
            </p>

            {custosFamiliaLoading ? (
              <div className="py-16 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: NAVY }} /></div>
            ) : (
              <div className="rounded-xl shadow-sm overflow-x-auto" style={{ background: "#ffffff", border: `1px solid ${BORDER}` }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${BORDER}`, background: "#f8fafc" }}>
                      <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest" style={{ color: MUTED }}>Família</th>
                      <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest" style={{ color: MUTED }}>Custo (R$)</th>
                      <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest" style={{ color: MUTED }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {custosFamiliaExibidos.length === 0 ? (
                      <tr><td colSpan={3} className="px-4 py-8 text-center text-xs" style={{ color: MUTED }}>{buscaFamilia ? "Nenhuma família encontrada com esse nome." : "Nenhuma família encontrada."}</td></tr>
                    ) : (
                      custosFamiliaExibidos.map((f) => (
                        <tr key={f.familia_codigo} style={{ borderBottom: `1px solid #f1f5f9` }}>
                          <td className="px-4 py-2.5 text-sm font-medium" style={{ color: NAVY }}>{f.familia_nome}</td>
                          <td className="px-4 py-2.5">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={rascunho[f.familia_codigo] ?? ""}
                              onChange={(e) => setRascunho((prev) => ({ ...prev, [f.familia_codigo]: e.target.value }))}
                              placeholder="0,00"
                              className="w-28 rounded-lg px-3 py-1.5 text-xs font-medium focus:outline-none"
                              style={{ background: "#ffffff", border: `1px solid ${!f.custo ? "#f59e0b" : BORDER}`, color: NAVY }}
                            />
                          </td>
                          <td className="px-4 py-2.5">
                            <button
                              onClick={() => onSalvarCusto(f.familia_codigo)}
                              disabled={salvando === f.familia_codigo}
                              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                              style={{ background: `${NAVY}1A`, color: NAVY }}
                            >
                              {salvando === f.familia_codigo ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                              Salvar
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
