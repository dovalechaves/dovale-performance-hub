import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import {
  ArrowLeft, Send, History, Gift, RefreshCw, Loader2, CheckCircle2,
  XCircle, AlertCircle, Download, MessageSquare, ChevronLeft, ChevronRight,
  BellRing, Sun, Moon,
} from "lucide-react";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";

const API_BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:3001/api").replace(/\/$/, "");

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

type Tab = "painel" | "historico" | "bonus";

interface Disparo {
  id: number;
  fonte: string;
  emp_fil_codigo: string;
  rec_id: number;
  rec_numero: string;
  rec_vencimento: string;
  rec_valor: number;
  cli_codigo: string;
  cli_nome: string;
  telefone: string;
  situacao: string;
  template_nome: string;
  data_disparo: string;
  status: "ENVIADO" | "FALHOU";
  erro: string | null;
  wamid: string | null;
  manual: boolean;
  pago_apos_disparo: boolean;
  data_verificacao_pagamento?: string;
}

interface PainelData {
  total: number;
  enviados: number;
  falhos: number;
  pagos: number;
  disparos: Disparo[];
}

interface HistoricoData {
  total: number;
  page: number;
  limit: number;
  pages: number;
  disparos: Disparo[];
}

interface BonusResumo {
  mes_ano: string;
  total_bonus: number;
  total_valor: number;
  exportados: number;
  primeiro_registro: string;
  ultimo_registro: string;
}

interface BonusDetalhe {
  id: number;
  disparo_id: number;
  mes_ano: string;
  valor: number;
  exportado: boolean;
  cli_nome: string;
  cli_codigo: string;
  rec_numero: string;
  rec_vencimento: string;
  rec_valor: number;
  situacao: string;
  data_disparo: string;
  fonte: string;
  telefone: string;
}

interface TemplateStatus {
  situacao: string;
  template_nome: string;
  status: string;
  id: string | null;
  language: string | null;
}

const SITUACAO_COLOR: Record<string, string> = {
  "VENCE EM 2 DIAS": "bg-blue-500/10 text-blue-400 border-blue-500/30",
  "VENCIDO HÁ 5 DIAS": "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  "VENCIDO HÁ 15 DIAS": "bg-orange-500/10 text-orange-400 border-orange-500/30",
  "VENCIDO HÁ 30 DIAS": "bg-red-500/10 text-red-400 border-red-500/30",
  "VENCIDO HÁ 60 DIAS": "bg-rose-900/20 text-rose-400 border-rose-500/30",
};

function formatDate(s: string): string {
  if (!s) return "—";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

function formatDateTime(s: string): string {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString("pt-BR");
}

function formatCurrency(v: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

export default function Cobranca() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("painel");
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  // Painel
  const [painel, setPainel] = useState<PainelData | null>(null);
  const [painelLoading, setPainelLoading] = useState(false);
  const [painelError, setPainelError] = useState("");
  const [historico, setHistorico] = useState<HistoricoData | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const [histPage, setHistPage] = useState(1);
  const [filtroSituacao, setFiltroSituacao] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("");
  const [filtroFonte, setFiltroFonte] = useState("");
  const [filtroDataInicio, setFiltroDataInicio] = useState("");
  const [filtroDataFim, setFiltroDataFim] = useState("");
  const [filtroBusca, setFiltroBusca] = useState("");
  const [bonusResumo, setBonusResumo] = useState<BonusResumo[]>([]);
  const [bonusDetalhes, setBonusDetalhes] = useState<BonusDetalhe[]>([]);
  const [bonusLoading, setBonusLoading] = useState(false);
  const [bonusMes, setBonusMes] = useState("");
  const [exportando, setExportando] = useState(false);
  const [exportandoHist, setExportandoHist] = useState(false);
  const [templates, setTemplates] = useState<TemplateStatus[]>([]);
  const [painelPage, setPainelPage] = useState(1);
  const PAINEL_PAGE_SIZE = 25;
  const [disparando, setDisparando] = useState(false);
  const [disparoMsg, setDisparoMsg] = useState("");
  const [modoSimulacao, setModoSimulacao] = useState(false);
  const canSeeBonus = user?.apps.cobranca.role === "admin" || user?.apps.cobranca.role === "manager";
  const token = user?.token ?? "";
  const loadPainel = useCallback(async () => {
    setPainelLoading(true);
    setPainelError("");
    setPainelPage(1);
    try {
      const r = await fetch(`${API_BASE}/cobranca/painel`, { headers: authHeader(token) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setPainel(await r.json());
    } catch (e: any) {
      setPainelError(e.message);
    } finally {
      setPainelLoading(false);
    }
  }, [token]);

  const loadTemplates = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/cobranca/templates`, { headers: authHeader(token) });
      if (r.ok) setTemplates(await r.json());
    } catch {}
  }, [token]);

  const loadHistorico = useCallback(async () => {
    setHistLoading(true);
    try {
      const params = new URLSearchParams({ page: String(histPage), limit: "50" });
      if (filtroSituacao) params.set("situacao", filtroSituacao);
      if (filtroStatus) params.set("status", filtroStatus);
      if (filtroFonte) params.set("fonte", filtroFonte);
      if (filtroDataInicio) params.set("dataInicio", filtroDataInicio);
      if (filtroDataFim) params.set("dataFim", filtroDataFim);
      if (filtroBusca) params.set("busca", filtroBusca);
      const r = await fetch(`${API_BASE}/cobranca/historico?${params}`, { headers: authHeader(token) });
      if (r.ok) setHistorico(await r.json());
    } catch {}
    setHistLoading(false);
  }, [token, histPage, filtroSituacao, filtroStatus, filtroFonte, filtroDataInicio, filtroDataFim, filtroBusca]);

  const loadBonus = useCallback(async () => {
    setBonusLoading(true);
    try {
      const params = new URLSearchParams();
      if (bonusMes) params.set("mes", bonusMes);
      const r = await fetch(`${API_BASE}/cobranca/bonus?${params}`, { headers: authHeader(token) });
      if (r.ok) {
        const data = await r.json();
        setBonusResumo(data.resumo ?? []);
        setBonusDetalhes(data.detalhes ?? []);
      }
    } catch {}
    setBonusLoading(false);
  }, [token, bonusMes]);

  useEffect(() => { loadPainel(); loadTemplates(); }, [loadPainel, loadTemplates]);
  useEffect(() => { if (tab === "historico") loadHistorico(); }, [tab, loadHistorico]);
  useEffect(() => { if (tab === "bonus" && canSeeBonus) loadBonus(); }, [tab, loadBonus, canSeeBonus]);

  const handleDisparoManual = async () => {
    setDisparando(true);
    setDisparoMsg("");
    try {
      const r = await fetch(`${API_BASE}/cobranca/disparar-manual`, {
        method: "POST",
        headers: authHeader(token),
      });
      const data = await r.json();
      if (data.ok) {
        setModoSimulacao(!!data.simulacao);
        setDisparoMsg(`Concluído — ${data.enviados} enviados, ${data.falhos} falhos, ${data.ignorados} ignorados.`);
        loadPainel();
      } else {
        setDisparoMsg(`Erro: ${data.erro}`);
      }
    } catch (e: any) {
      setDisparoMsg(`Erro: ${e.message}`);
    }
    setDisparando(false);
  };

  const handleExportarHistorico = async () => {
    setExportandoHist(true);
    try {
      const params = new URLSearchParams();
      if (filtroSituacao) params.set("situacao", filtroSituacao);
      if (filtroStatus) params.set("status", filtroStatus);
      if (filtroFonte) params.set("fonte", filtroFonte);
      if (filtroDataInicio) params.set("dataInicio", filtroDataInicio);
      if (filtroDataFim) params.set("dataFim", filtroDataFim);
      if (filtroBusca) params.set("busca", filtroBusca);
      const r = await fetch(`${API_BASE}/cobranca/historico/exportar?${params}`, { headers: authHeader(token) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const hoje = new Date().toISOString().slice(0, 10);
      a.download = `historico_cobranca_${hoje}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
    setExportandoHist(false);
  };

  const handleExportarBonus = async () => {
    if (!bonusMes) return;
    setExportando(true);
    try {
      const r = await fetch(`${API_BASE}/cobranca/bonus/exportar?mes=${bonusMes}`, { headers: authHeader(token) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bonus_cobranca_${bonusMes}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      loadBonus();
    } catch {}
    setExportando(false);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-gradient-card shrink-0">
        <div className="container mx-auto px-6 py-4 flex items-center gap-4">
          <button onClick={() => navigate("/hub")} className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="h-5 w-px bg-border" />
          <button onClick={() => navigate("/hub")} className="relative h-9 w-36 overflow-hidden" title="Ir para o Hub">
            <img src={logoBlue} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ${dark ? "opacity-0 scale-90 blur-sm" : "opacity-100 scale-100"}`} />
            <img src={logoWhite} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ${dark ? "opacity-100 scale-100" : "opacity-0 scale-90 blur-sm"}`} />
          </button>
          <div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-2">
            <BellRing className="w-5 h-5 text-emerald-500" />
            <div>
              <h1 className="text-sm font-mono font-bold text-foreground tracking-tight">COBRANÇA AUTOMATIZADA</h1>
              <p className="text-[10px] font-mono text-muted-foreground">Disparo automático de mensagens WhatsApp</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {user && <span className="text-xs text-muted-foreground hidden sm:inline">{user.displayName}</span>}
            <button onClick={() => setDark((d) => !d)} className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors">
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto px-6 py-8 space-y-6">
        {/* Tabs */}
        <div className="flex gap-1 border-b border-border">
          {([
            { key: "painel", label: "Painel", icon: <Send className="w-3.5 h-3.5" /> },
            { key: "historico", label: "Histórico", icon: <History className="w-3.5 h-3.5" /> },
            ...(canSeeBonus ? [{ key: "bonus", label: "Bonificação TI", icon: <Gift className="w-3.5 h-3.5" /> }] : []),
          ] as { key: Tab; label: string; icon: React.ReactNode }[]).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* ── PAINEL ── */}
        {tab === "painel" && (
          <div className="space-y-6">
            {/* Banner simulação */}
            {modoSimulacao && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <p className="text-xs text-amber-400 font-medium">
                  Modo simulação ativo — nenhuma mensagem foi enviada de verdade. Os registros no histórico são fictícios.
                </p>
              </div>
            )}

            {/* Status templates */}
            {templates.length > 0 && (
              <div className="rounded-xl border border-border bg-muted/20 p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Status dos Templates</p>
                <div className="flex flex-wrap gap-2">
                  {templates.map((t) => (
                    <div key={t.situacao} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs ${
                      t.status === "APPROVED"
                        ? "bg-green-500/10 text-green-400 border-green-500/30"
                        : t.status === "NAO_CRIADO"
                        ? "bg-muted text-muted-foreground border-border"
                        : "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
                    }`}>
                      {t.status === "APPROVED"
                        ? <CheckCircle2 className="w-3 h-3" />
                        : <AlertCircle className="w-3 h-3" />}
                      <span>{t.situacao}</span>
                      <span className="opacity-60">({t.status === "NAO_CRIADO" ? "não criado" : t.status})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Estatísticas hoje */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Total Hoje", value: painel?.total ?? "—", color: "text-foreground" },
                { label: "Enviados", value: painel?.enviados ?? "—", color: "text-green-400" },
                { label: "Falhos", value: painel?.falhos ?? "—", color: "text-red-400" },
                { label: "Pagos após disparo", value: painel?.pagos ?? "—", color: "text-blue-400" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-border bg-card p-4">
                  <p className="text-xs text-muted-foreground mb-1">{stat.label}</p>
                  <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Disparo manual */}
            <div className="rounded-xl border border-border bg-card p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">Disparo Manual</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Executa as mesmas regras do automático agora. Use caso o cron das 8h tenha falhado.
                </p>
                {disparoMsg && (
                  <p className={`text-xs mt-2 ${disparoMsg.startsWith("Erro") ? "text-destructive" : "text-green-400"}`}>
                    {disparoMsg}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={loadPainel}
                  disabled={painelLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-secondary text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors disabled:opacity-40"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${painelLoading ? "animate-spin" : ""}`} />
                  Atualizar
                </button>
                <button
                  onClick={handleDisparoManual}
                  disabled={disparando}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
                >
                  {disparando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Disparar agora
                </button>
              </div>
            </div>

            {/* Lista de disparos de hoje */}
            {painelError && <p className="text-xs text-destructive">{painelError}</p>}
            {painelLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : painel && painel.disparos.length > 0 ? (() => {
              const totalPages = Math.ceil(painel.disparos.length / PAINEL_PAGE_SIZE);
              const pageDisparos = painel.disparos.slice((painelPage - 1) * PAINEL_PAGE_SIZE, painelPage * PAINEL_PAGE_SIZE);
              return (
                <>
                  <div className="rounded-xl border border-border overflow-x-auto">
                    <table className="w-full text-xs min-w-[700px]">
                      <thead>
                        <tr className="border-b border-border bg-muted/40">
                          {["Cliente", "Telefone", "Situação", "Vencimento", "Valor", "Template", "Status", "Pago", "Hora"].map((h) => (
                            <th key={h} className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pageDisparos.map((d) => (
                          <tr key={d.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-3">
                              <p className="font-medium text-foreground">{d.cli_nome || d.cli_codigo}</p>
                              <p className="text-muted-foreground">Nº {d.rec_numero}</p>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{d.telefone || "—"}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] ${SITUACAO_COLOR[d.situacao] ?? "bg-muted text-muted-foreground border-border"}`}>
                                {d.situacao}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatDate(d.rec_vencimento)}</td>
                            <td className="px-4 py-3 text-foreground">{formatCurrency(d.rec_valor)}</td>
                            <td className="px-4 py-3 font-mono text-muted-foreground">{d.template_nome || "—"}</td>
                            <td className="px-4 py-3">
                              {d.status === "ENVIADO"
                                ? <span className="inline-flex items-center gap-1 text-green-400"><CheckCircle2 className="w-3 h-3" />Enviado</span>
                                : <span className="inline-flex items-center gap-1 text-red-400" title={d.erro ?? ""}><XCircle className="w-3 h-3" />Falhou</span>
                              }
                            </td>
                            <td className="px-4 py-3">
                              {d.pago_apos_disparo
                                ? <span className="text-green-400">Sim</span>
                                : <span className="text-muted-foreground">Não</span>}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatDateTime(d.data_disparo)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs text-muted-foreground">
                        Página {painelPage} de {totalPages} · {painel.disparos.length} registros
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setPainelPage((p) => Math.max(1, p - 1))}
                          disabled={painelPage === 1}
                          className="p-1.5 rounded-lg bg-secondary text-muted-foreground disabled:opacity-40 hover:text-foreground"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setPainelPage((p) => Math.min(totalPages, p + 1))}
                          disabled={painelPage >= totalPages}
                          className="p-1.5 rounded-lg bg-secondary text-muted-foreground disabled:opacity-40 hover:text-foreground"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              );
            })() : (
              <div className="rounded-xl border border-border bg-muted/20 px-6 py-10 text-center">
                <MessageSquare className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Nenhum disparo realizado hoje.</p>
              </div>
            )}
          </div>
        )}

        {/* ── HISTÓRICO ── */}
        {tab === "historico" && (
          <div className="space-y-4">
            {/* Filtros */}
            <div className="flex flex-wrap gap-3">
              <input
                type="text"
                placeholder="Buscar cliente, código, boleto..."
                value={filtroBusca}
                onChange={(e) => { setFiltroBusca(e.target.value); setHistPage(1); }}
                className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 w-52"
              />
              <select
                value={filtroSituacao}
                onChange={(e) => { setFiltroSituacao(e.target.value); setHistPage(1); }}
                className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">Todas as situações</option>
                {["VENCE EM 2 DIAS", "VENCIDO HÁ 5 DIAS", "VENCIDO HÁ 15 DIAS", "VENCIDO HÁ 30 DIAS", "VENCIDO HÁ 60 DIAS"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select
                value={filtroStatus}
                onChange={(e) => { setFiltroStatus(e.target.value); setHistPage(1); }}
                className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">Todos os status</option>
                <option value="ENVIADO">Enviado</option>
                <option value="FALHOU">Falhou</option>
              </select>
              <select
                value={filtroFonte}
                onChange={(e) => { setFiltroFonte(e.target.value); setHistPage(1); }}
                className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">SJC + MG</option>
                <option value="sjc">SJC</option>
                <option value="mg">MG</option>
              </select>
              <input
                type="date"
                value={filtroDataInicio}
                onChange={(e) => { setFiltroDataInicio(e.target.value); setHistPage(1); }}
                className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <input
                type="date"
                value={filtroDataFim}
                onChange={(e) => { setFiltroDataFim(e.target.value); setHistPage(1); }}
                className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                onClick={() => { setHistPage(1); loadHistorico(); }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-secondary text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${histLoading ? "animate-spin" : ""}`} />
                Filtrar
              </button>
              <button
                onClick={handleExportarHistorico}
                disabled={exportandoHist}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
              >
                {exportandoHist ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                Exportar CSV
              </button>
            </div>

            {histLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : historico && historico.disparos.length > 0 ? (
              <>
                <p className="text-xs text-muted-foreground">{historico.total} registros encontrados</p>
                <div className="rounded-xl border border-border overflow-x-auto">
                  <table className="w-full text-xs min-w-[800px]">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        {["Data/Hora", "Origem", "Cliente", "Telefone", "Situação", "Vencimento", "Valor", "Status", "Pago", "Tipo"].map((h) => (
                          <th key={h} className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {historico.disparos.map((d) => (
                        <tr key={d.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatDateTime(d.data_disparo)}</td>
                          <td className="px-4 py-3 uppercase font-mono text-muted-foreground">{d.fonte}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-foreground">{d.cli_nome || d.cli_codigo}</p>
                            <p className="text-muted-foreground">Nº {d.rec_numero}</p>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{d.telefone || "—"}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] ${SITUACAO_COLOR[d.situacao] ?? "bg-muted text-muted-foreground border-border"}`}>
                              {d.situacao}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatDate(d.rec_vencimento)}</td>
                          <td className="px-4 py-3 text-foreground">{formatCurrency(d.rec_valor)}</td>
                          <td className="px-4 py-3">
                            {d.status === "ENVIADO"
                              ? <span className="inline-flex items-center gap-1 text-green-400"><CheckCircle2 className="w-3 h-3" />Enviado</span>
                              : <span className="inline-flex items-center gap-1 text-red-400" title={d.erro ?? ""}><XCircle className="w-3 h-3" />Falhou</span>}
                          </td>
                          <td className="px-4 py-3">
                            {d.pago_apos_disparo
                              ? <span className="text-green-400">Sim</span>
                              : <span className="text-muted-foreground">Não</span>}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] ${d.manual ? "text-amber-400" : "text-muted-foreground"}`}>
                              {d.manual ? "Manual" : "Auto"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Paginação */}
                <div className="flex items-center justify-between mt-2">
                  <p className="text-xs text-muted-foreground">
                    Página {historico.page} de {historico.pages}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setHistPage((p) => Math.max(1, p - 1))}
                      disabled={histPage === 1}
                      className="p-1.5 rounded-lg bg-secondary text-muted-foreground disabled:opacity-40 hover:text-foreground"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setHistPage((p) => Math.min(historico.pages, p + 1))}
                      disabled={histPage >= historico.pages}
                      className="p-1.5 rounded-lg bg-secondary text-muted-foreground disabled:opacity-40 hover:text-foreground"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-border bg-muted/20 px-6 py-10 text-center">
                <History className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Nenhum disparo encontrado com os filtros aplicados.</p>
              </div>
            )}
          </div>
        )}

        {/* ── BONIFICAÇÃO ── */}
        {tab === "bonus" && canSeeBonus && (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-3 items-center">
              <input
                type="month"
                value={bonusMes}
                onChange={(e) => setBonusMes(e.target.value)}
                className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                onClick={loadBonus}
                disabled={bonusLoading}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-secondary text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${bonusLoading ? "animate-spin" : ""}`} />
                Filtrar
              </button>
              {bonusMes && (
                <button
                  onClick={handleExportarBonus}
                  disabled={exportando}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
                >
                  {exportando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  Exportar CSV
                </button>
              )}
            </div>

            {bonusLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <>
                {/* Cards de resumo por mês */}
                {bonusResumo.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {bonusResumo.map((r) => (
                      <div key={r.mes_ano} className="rounded-xl border border-border bg-card p-5">
                        <p className="text-xs text-muted-foreground uppercase tracking-widest">{r.mes_ano}</p>
                        <p className="text-2xl font-bold text-green-400 mt-2">{formatCurrency(r.total_valor)}</p>
                        <p className="text-xs text-muted-foreground mt-1">{r.total_bonus} boleto{r.total_bonus !== 1 ? "s" : ""} pago{r.total_bonus !== 1 ? "s" : ""} após disparo</p>
                        {r.exportados > 0 && (
                          <p className="text-xs text-blue-400 mt-1">{r.exportados} exportado{r.exportados !== 1 ? "s" : ""}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Detalhe */}
                {bonusDetalhes.length > 0 && (
                  <div className="rounded-xl border border-border overflow-x-auto">
                    <table className="w-full text-xs min-w-[700px]">
                      <thead>
                        <tr className="border-b border-border bg-muted/40">
                          {["Mês", "Cliente", "Boleto", "Vencimento", "Valor Boleto", "Situação", "Data Disparo", "Bônus"].map((h) => (
                            <th key={h} className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {bonusDetalhes.map((b) => (
                          <tr key={b.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-3 font-mono text-muted-foreground">{b.mes_ano}</td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-foreground">{b.cli_nome || b.cli_codigo}</p>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{b.rec_numero || "—"}</td>
                            <td className="px-4 py-3 text-muted-foreground">{formatDate(b.rec_vencimento)}</td>
                            <td className="px-4 py-3 text-foreground">{formatCurrency(b.rec_valor)}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] ${SITUACAO_COLOR[b.situacao] ?? "bg-muted text-muted-foreground border-border"}`}>
                                {b.situacao}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatDateTime(b.data_disparo)}</td>
                            <td className="px-4 py-3 font-semibold text-green-400">{formatCurrency(b.valor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {bonusResumo.length === 0 && bonusDetalhes.length === 0 && (
                  <div className="rounded-xl border border-border bg-muted/20 px-6 py-10 text-center">
                    <Gift className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">
                      {bonusMes ? `Nenhum bônus registrado em ${bonusMes}.` : "Selecione um mês para ver a bonificação."}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        </div>
      </main>
    </div>
  );
}
