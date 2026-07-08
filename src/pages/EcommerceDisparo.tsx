import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  CalendarClock,
  Loader2,
  MessageSquareText,
  Moon,
  RefreshCw,
  Send,
  Settings,
  ShoppingCart,
  Sparkles,
  Sun,
  TrendingUp,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";
import {
  enviarRelatorioEcommerce,
  fetchEcommerceReport,
  fetchEcommerceMetas,
  fetchHistoricoEcommerce,
  gerarAnaliseEcommerce,
  previewRelatorioEcommerce,
  salvarEcommerceMetas,
  type EcommerceReport,
  type HistoricoEnvio,
  type PeriodoRelatorio,
} from "@/lib/ecommerce-disparo-api";

type Tab = "painel" | "preview" | "historico";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR");
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function EcommerceDisparo() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");
  const [tab, setTab] = useState<Tab>("painel");
  const [periodo, setPeriodo] = useState<PeriodoRelatorio>("diario");
  const [dataSelecionada, setDataSelecionada] = useState<string>(
    () => new Date().toISOString().split("T")[0]
  );
  const [report, setReport] = useState<EcommerceReport | null>(null);
  const [historico, setHistorico] = useState<HistoricoEnvio[]>([]);
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [gerandoAnalise, setGerandoAnalise] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [metaDiario, setMetaDiario] = useState(165000);
  const [metaMensal, setMetaMensal] = useState(3200000);
  const [metaDiarioInput, setMetaDiarioInput] = useState(165000);
  const [metaMensalInput, setMetaMensalInput] = useState(3200000);
  const [metasLoading, setMetasLoading] = useState(false);

  const usuario = user?.usuario ?? "";

  useEffect(() => {
    if (!usuario) return;
    fetchEcommerceMetas(usuario)
      .then((m) => { setMetaDiario(m.meta_diario); setMetaMensal(m.meta_mensal); })
      .catch(() => {});
  }, [usuario]);

  async function salvarMetas() {
    if (!usuario) return;
    setMetasLoading(true);
    try {
      await salvarEcommerceMetas(usuario, { meta_diario: metaDiarioInput, meta_mensal: metaMensalInput });
      setMetaDiario(metaDiarioInput);
      setMetaMensal(metaMensalInput);
      setConfigOpen(false);
      toast.success("Metas atualizadas");
    } catch {
      toast.error("Falha ao salvar metas");
    } finally {
      setMetasLoading(false);
    }
  }

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  const loadReport = useCallback(async () => {
    if (!usuario) return;
    setLoading(true);
    try {
      const data = await fetchEcommerceReport(usuario, periodo, periodo === "diario" ? dataSelecionada : undefined);
      setReport(data);
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Falha ao carregar relatório"));
    } finally {
      setLoading(false);
    }
  }, [usuario, periodo, dataSelecionada]);

  const loadHistorico = useCallback(async () => {
    if (!usuario) return;
    try {
      const data = await fetchHistoricoEcommerce(usuario);
      setHistorico(data.items);
    } catch {
      setHistorico([]);
    }
  }, [usuario]);

  const loadPreview = useCallback(async () => {
    if (!usuario) return;
    setPreviewLoading(true);
    try {
      if (periodo === "diario") {
        await gerarAnaliseEcommerce(usuario, periodo, dataSelecionada);
        await loadReport();
      }
      const data = await previewRelatorioEcommerce(usuario, periodo, periodo === "diario" ? dataSelecionada : undefined);
      setPreview(data.mensagem);
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Falha ao gerar preview"));
    } finally {
      setPreviewLoading(false);
    }
  }, [usuario, periodo, dataSelecionada, loadReport]);

  useEffect(() => { loadReport(); }, [loadReport]);
  useEffect(() => { if (tab === "historico") loadHistorico(); }, [tab, loadHistorico]);
  useEffect(() => { if (tab === "preview") loadPreview(); }, [tab, loadPreview]);

  const kpiCards = useMemo(() => {
    if (!report) return [];
    return [
      { label: "Faturamento", value: formatCurrency(report.kpis.faturamento), icon: <TrendingUp className="w-4 h-4" />, tone: "text-sky-400" },
      { label: "Pedidos", value: String(report.kpis.pedidos), icon: <ShoppingCart className="w-4 h-4" />, tone: "text-emerald-400" },
      { label: "Ticket", value: formatCurrency(report.kpis.ticket_medio), icon: <BarChart3 className="w-4 h-4" />, tone: "text-violet-400" },
      { label: "ROAS", value: `${report.kpis.roas.toFixed(2)}x`, icon: <RefreshCw className="w-4 h-4" />, tone: "text-green-400" },
    ];
  }, [report]);

  const gerarAnalise = async () => {
    if (!usuario) return;
    setGerandoAnalise(true);
    try {
      await gerarAnaliseEcommerce(usuario, periodo, periodo === "diario" ? dataSelecionada : undefined);
      await loadReport();
      toast.success("Análise gerada");
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Falha ao gerar análise"));
    } finally {
      setGerandoAnalise(false);
    }
  };

  const handleEnviar = async () => {
    if (!usuario) return;
    setSending(true);
    try {
      if (periodo === "diario") {
        await gerarAnaliseEcommerce(usuario, periodo, dataSelecionada);
      }
      const data = await enviarRelatorioEcommerce(usuario, periodo, periodo === "diario" ? dataSelecionada : undefined);
      toast.success(data.falhas?.length ? `${data.enviados} envio(s), ${data.falhas.length} falha(s)` : `${data.enviados} envio(s) realizado(s)`);
      await loadHistorico();
      setTab("historico");
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Falha ao enviar relatório"));
    } finally {
      setSending(false);
    }
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
            <ShoppingCart className="w-5 h-5 text-sky-500" />
            <div>
              <h1 className="text-sm font-mono font-bold text-foreground tracking-tight">RELATÓRIOS ECOMMERCE</h1>
              <p className="text-[10px] font-mono text-muted-foreground">KPIs e disparos WhatsApp para Marketing</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {user && <span className="text-xs text-muted-foreground hidden sm:inline">{user.displayName}</span>}
            <button onClick={() => { setMetaDiarioInput(metaDiario); setMetaMensalInput(metaMensal); setConfigOpen(true); }} className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors" title="Configurar metas">
              <Settings className="w-4 h-4" />
            </button>
            <button onClick={() => setDark((d) => !d)} className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors">
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto px-6 py-8 space-y-6">
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <p className="text-xs text-amber-400 font-medium">
              Dados de canais dependem da base ecommerce e tráfego pago depende das APIs configuradas. O envio WhatsApp usa o Chatwoot do inventário.
            </p>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex gap-1 border-b border-border">
              {([
                { key: "painel", label: "Painel", icon: <BarChart3 className="w-3.5 h-3.5" /> },
                { key: "preview", label: "Preview WhatsApp", icon: <MessageSquareText className="w-3.5 h-3.5" /> },
                { key: "historico", label: "Histórico", icon: <CalendarClock className="w-3.5 h-3.5" /> },
              ] as { key: Tab; label: string; icon: JSX.Element }[]).map((item) => (
                <button
                  key={item.key}
                  onClick={() => setTab(item.key)}
                  className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    tab === item.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={periodo}
                onChange={(e) => setPeriodo(e.target.value as PeriodoRelatorio)}
                className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="diario">Relatório diário</option>
                <option value="mensal">Relatório mensal</option>
              </select>
              {periodo === "diario" && (
                <input
                  type="date"
                  value={dataSelecionada}
                  max={new Date().toISOString().split("T")[0]}
                  onChange={(e) => setDataSelecionada(e.target.value)}
                  className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              )}
              <button onClick={loadReport} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground hover:bg-primary/10 hover:text-foreground transition-colors disabled:opacity-40">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                Atualizar
              </button>
            </div>
          </div>

          {tab === "painel" && (
            <div className="space-y-6">
              {loading && !report ? (
                <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
              ) : report && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {kpiCards.map((card) => (
                      <div key={card.label} className="rounded-xl border border-border bg-card p-4">
                        <div className={`mb-2 ${card.tone}`}>{card.icon}</div>
                        <p className="text-xs text-muted-foreground">{card.label}</p>
                        <p className="text-xl font-bold text-foreground mt-1">{card.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4">
                    <div className="rounded-xl border border-border overflow-x-auto">
                      <table className="w-full text-xs min-w-[680px]">
                        <thead>
                          <tr className="border-b border-border bg-muted/40">
                            {["Canal", "Faturamento", "Pedidos", "Ticket", "Variação"].map((h) => (
                              <th key={h} className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {report.canais.map((canal) => (
                            <tr key={canal.canal} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                              <td className="px-4 py-3 font-medium text-foreground">{canal.canal}</td>
                              <td className="px-4 py-3 text-foreground">{formatCurrency(canal.faturamento)}</td>
                              <td className="px-4 py-3 text-muted-foreground">{canal.pedidos}</td>
                              <td className="px-4 py-3 text-muted-foreground">{formatCurrency(canal.ticket_medio)}</td>
                              <td className={`px-4 py-3 font-semibold ${canal.variacao >= 0 ? "text-green-400" : "text-red-400"}`}>
                                {canal.variacao >= 0 ? "+" : ""}{formatPercent(canal.variacao)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                      <div>
                        <p className="text-xs uppercase tracking-widest text-muted-foreground">Meta e projeção</p>
                        {(() => {
                          const metaAtual = periodo === "mensal" ? metaMensal : metaDiario;
                          const realizado = (report.kpis.faturamento / metaAtual) * 100;
                          return (
                            <>
                              <p className="text-2xl font-bold text-foreground mt-1">{formatPercent(realizado)}</p>
                              <p className="text-xs text-muted-foreground">Realizado de {formatCurrency(metaAtual)}</p>
                              <div className="h-2 rounded-full bg-muted overflow-hidden mt-3">
                                <div className="h-full bg-primary" style={{ width: `${Math.min(100, realizado)}%` }} />
                              </div>
                            </>
                          );
                        })()}
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <p className="text-muted-foreground">Projeção</p>
                          <p className="font-semibold text-foreground">{formatCurrency(report.kpis.projecao_fechamento)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Receita paga</p>
                          <p className="font-semibold text-foreground">{formatCurrency(report.kpis.receita_paga)}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
                      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">Tráfego pago</p>
                      <div className="grid gap-3">
                        {report.trafego_pago.map((item) => (
                          <div key={item.origem} className="grid grid-cols-2 md:grid-cols-5 gap-3 rounded-lg border border-border bg-muted/20 p-3 text-xs">
                            <p className="font-semibold text-foreground md:col-span-1">{item.origem}</p>
                            {item.status ? (
                              <p className="md:col-span-4 text-yellow-500 font-medium">{item.status}</p>
                            ) : (
                              <>
                                <p><span className="text-muted-foreground">Inv.</span> {formatCurrency(item.investimento ?? 0)}</p>
                                <p><span className="text-muted-foreground">Receita</span> {formatCurrency(item.receita ?? 0)}</p>
                                <p><span className="text-muted-foreground">ROAS</span> {(item.roas ?? 0).toFixed(2)}x</p>
                                <p><span className="text-muted-foreground">Conv.</span> {formatPercent(item.conversao ?? 0)}</p>
                                {item.fonte === "fallback" && (
                                  <p className="md:col-span-5 text-yellow-500 font-medium">Dados de Ads indisponíveis na API.</p>
                                )}
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Agenda</p>
                        <p className="text-xs text-foreground">Diário: {report.agenda.diario}</p>
                        <p className="text-xs text-foreground mt-1">Mensal: {report.agenda.mensal}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Destinatários</p>
                        {report.destinatarios.map((dest) => (
                          <p key={dest.nome} className="text-xs text-foreground">{dest.nome}</p>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-violet-400" />
                        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Análise do Bot</p>
                        {report.analise?.gerado_em && (
                          <span className="text-[10px] text-muted-foreground">
                            · {formatDateTime(report.analise.gerado_em)}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={gerarAnalise}
                        disabled={gerandoAnalise}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs text-muted-foreground hover:bg-primary/10 hover:text-foreground transition-colors disabled:opacity-40"
                      >
                        {gerandoAnalise ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        Gerar agora
                      </button>
                    </div>
                    {report.analise?.texto ? (
                      <div className="space-y-1.5 text-sm leading-relaxed">
                        {report.analise.texto.split("\n").filter((l) => l.trim()).map((linha, i) => {
                          const t = linha.trim();
                          return t.startsWith("-") || t.startsWith("•") ? (
                            <p key={i} className="flex gap-2 text-foreground">
                              <span className="text-violet-400">•</span>
                              <span>{t.replace(/^[-•]\s*/, "")}</span>
                            </p>
                          ) : (
                            <p key={i} className="text-foreground">{t}</p>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Nenhuma análise gerada ainda. O bot gera automaticamente à meia-noite (mensal no dia 1), ou clique em "Gerar agora".
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "preview" && (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Mensagem WhatsApp</p>
                  <button onClick={loadPreview} disabled={previewLoading} className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs text-muted-foreground hover:bg-primary/10 hover:text-foreground transition-colors disabled:opacity-40">
                    {previewLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Gerar
                  </button>
                </div>
                <pre className="min-h-[420px] whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-4 text-xs leading-relaxed text-foreground font-mono">
                  {previewLoading ? "Gerando preview..." : preview || "Clique em gerar para visualizar o relatório."}
                </pre>
              </div>

              <div className="rounded-xl border border-border bg-card p-5 space-y-4 h-fit">
                <div>
                  <p className="text-sm font-semibold text-foreground">Envio WhatsApp</p>
                  <p className="text-xs text-muted-foreground mt-1">Dispara o relatório pelo Chatwoot configurado.</p>
                </div>
                <button onClick={handleEnviar} disabled={sending} className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40">
                  {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Enviar relatório
                </button>
              </div>
            </div>
          )}

          {tab === "historico" && (
            <div className="rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-xs min-w-[620px]">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    {["Data/Hora", "Período", "Destinatário", "Status"].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {historico.map((item) => (
                    <tr key={item.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground">{formatDateTime(item.data_envio)}</td>
                      <td className="px-4 py-3 text-foreground capitalize">{item.periodo}</td>
                      <td className="px-4 py-3 text-foreground">{item.destinatario}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400">
                          <AlertCircle className="w-3 h-3" />
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {historico.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">Nenhum envio registrado.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {configOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl mx-4">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Configurar Metas</h2>
              </div>
              <button onClick={() => setConfigOpen(false)} className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground uppercase tracking-widest block mb-1.5">Meta Diária (R$)</label>
                <input
                  type="number"
                  value={metaDiarioInput}
                  onChange={(e) => setMetaDiarioInput(Number(e.target.value))}
                  className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Atual: {formatCurrency(metaDiario)}</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground uppercase tracking-widest block mb-1.5">Meta Mensal (R$)</label>
                <input
                  type="number"
                  value={metaMensalInput}
                  onChange={(e) => setMetaMensalInput(Number(e.target.value))}
                  className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Atual: {formatCurrency(metaMensal)}</p>
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button onClick={() => setConfigOpen(false)} className="flex-1 rounded-lg border border-border px-4 py-2 text-xs text-muted-foreground hover:bg-secondary transition-colors">
                Cancelar
              </button>
              <button onClick={salvarMetas} disabled={metasLoading} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40">
                {metasLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
