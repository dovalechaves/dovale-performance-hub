import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Loader2,
  Moon,
  RefreshCw,
  Sun,
  Tags,
  TrendingDown,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";
import {
  fetchCustos,
  fetchDePara,
  salvarDePara,
  type RelatorioCustos as Relatorio,
  type TemplateDePara,
} from "@/lib/relatorio-custos-api";

type Tab = "relatorio" | "depara";

const usd = (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
const erro = (e: unknown, f: string) => (e instanceof Error ? e.message : f);

export default function RelatorioCustos() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");
  const [tab, setTab] = useState<Tab>("relatorio");

  // mês corrente (YYYY-MM)
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null);
  const [loading, setLoading] = useState(false);
  const [erroMsg, setErroMsg] = useState("");
  const [expandido, setExpandido] = useState<Set<string>>(new Set());

  // de-para
  const [templates, setTemplates] = useState<TemplateDePara[]>([]);
  const [etiquetas, setEtiquetas] = useState<string[]>([]);
  const [deParaLoading, setDeParaLoading] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  const carregarCustos = useCallback(async () => {
    setLoading(true);
    setErroMsg("");
    try {
      const data = await fetchCustos(mes);
      setRelatorio(data);
    } catch (e: unknown) {
      setRelatorio(null);
      setErroMsg(erro(e, "Falha ao carregar custos"));
    } finally {
      setLoading(false);
    }
  }, [mes]);

  const carregarDePara = useCallback(async () => {
    setDeParaLoading(true);
    try {
      const data = await fetchDePara();
      setTemplates(data.templates);
      setEtiquetas(data.etiquetas);
    } catch (e: unknown) {
      toast.error(erro(e, "Falha ao carregar mapeamento"));
    } finally {
      setDeParaLoading(false);
    }
  }, []);

  useEffect(() => { if (tab === "relatorio") carregarCustos(); }, [tab, carregarCustos]);
  useEffect(() => { if (tab === "depara" && templates.length === 0) carregarDePara(); }, [tab, carregarDePara, templates.length]);

  const toggle = (setor: string) =>
    setExpandido((prev) => {
      const n = new Set(prev);
      n.has(setor) ? n.delete(setor) : n.add(setor);
      return n;
    });

  const onSalvarMapeamento = async (t: TemplateDePara, novaEtiqueta: string) => {
    setSalvando(t.name);
    try {
      await salvarDePara(t.name, novaEtiqueta);
      setTemplates((prev) =>
        prev.map((x) =>
          x.name === t.name
            ? { ...x, etiqueta: novaEtiqueta, etiquetaValida: novaEtiqueta ? etiquetas.some((e) => e.toLowerCase() === novaEtiqueta.toLowerCase()) : false }
            : x,
        ),
      );
      toast.success(`"${t.name}" → ${novaEtiqueta || "sem setor"}`);
    } catch (e: unknown) {
      toast.error(erro(e, "Falha ao salvar"));
    } finally {
      setSalvando(null);
    }
  };

  const naoMapeados = templates.filter((t) => !t.etiqueta).length;
  const foraDoPadrao = templates.filter((t) => t.etiqueta && !t.etiquetaValida).length;

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
            <TrendingDown className="w-5 h-5 text-red-500" />
            <div>
              <h1 className="text-sm font-mono font-bold text-foreground tracking-tight">RELATÓRIO DE CUSTOS</h1>
              <p className="text-[10px] font-mono text-muted-foreground">Custo de templates WhatsApp por setor</p>
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
            <button
              onClick={() => setTab("relatorio")}
              className={`px-4 py-2 text-xs font-mono uppercase tracking-widest border-b-2 -mb-px transition-colors ${tab === "relatorio" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              <DollarSign className="w-3.5 h-3.5 inline mr-1.5" />Relatório
            </button>
            <button
              onClick={() => setTab("depara")}
              className={`px-4 py-2 text-xs font-mono uppercase tracking-widest border-b-2 -mb-px transition-colors ${tab === "depara" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              <Tags className="w-3.5 h-3.5 inline mr-1.5" />De-Para
            </button>
          </div>

          {tab === "relatorio" ? (
            <>
              {/* Filtro */}
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Mês</label>
                  <input
                    type="month"
                    value={mes}
                    onChange={(e) => setMes(e.target.value)}
                    className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <button
                  onClick={carregarCustos}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-xs text-primary hover:bg-primary/25 transition-colors disabled:opacity-40"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                  Atualizar
                </button>
              </div>

              {erroMsg && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
                  <p className="text-xs text-destructive">{erroMsg}</p>
                </div>
              )}

              {loading ? (
                <div className="py-16 text-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
              ) : relatorio ? (
                <>
                  {/* Cards de total */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <CardTotal label="Custo total" value={brl(relatorio.totalBrl)} sub={`${usd(relatorio.totalUsd)} cobrado pela Meta`} tone="text-emerald-400" />
                    <CardTotal label="Mensagens enviadas" value={relatorio.totalVolume.toLocaleString("pt-BR")} tone="text-violet-400" />
                    <CardTotal label="Câmbio USD→BRL" value={`R$ ${relatorio.cambio.rate.toFixed(4)}`} sub={relatorio.cambio.fonte === "fallback" ? "cotação indisponível (fallback)" : "cotação do dia"} tone="text-amber-400" />
                    <CardTotal label="Setores com custo" value={String(relatorio.setores.length)} tone="text-sky-400" />
                  </div>

                  {/* Tabela por setor */}
                  <div className="rounded-xl border border-border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/50">
                          <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Setor</th>
                          <th className="px-4 py-3 text-right text-[10px] uppercase tracking-widest text-muted-foreground">Mensagens</th>
                          <th className="px-4 py-3 text-right text-[10px] uppercase tracking-widest text-muted-foreground">Custo (R$)</th>
                          <th className="px-4 py-3 text-right text-[10px] uppercase tracking-widest text-muted-foreground">Custo (US$)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {relatorio.setores.length === 0 ? (
                          <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-xs">Nenhum custo de template mapeado neste mês.</td></tr>
                        ) : (
                          relatorio.setores.map((s) => (
                            <FragmentSetor
                              key={s.setor}
                              setor={s}
                              aberto={expandido.has(s.setor)}
                              onToggle={() => toggle(s.setor)}
                            />
                          ))
                        )}
                      </tbody>
                      {relatorio.setores.length > 0 && (
                        <tfoot>
                          <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                            <td className="px-4 py-3 text-foreground">Total</td>
                            <td className="px-4 py-3 text-right text-foreground">{relatorio.totalVolume.toLocaleString("pt-BR")}</td>
                            <td className="px-4 py-3 text-right text-emerald-400">{brl(relatorio.totalBrl)}</td>
                            <td className="px-4 py-3 text-right text-muted-foreground">{usd(relatorio.totalUsd)}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Custo real cobrado pela Meta (amount_spent) por template, agrupado pelo setor do de-para. Templates sem setor não aparecem — mapeie-os na aba De-Para.
                  </p>
                </>
              ) : null}
            </>
          ) : (
            /* ─── De-Para ─── */
            <>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={carregarDePara}
                  disabled={deParaLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-xs text-primary hover:bg-primary/25 transition-colors disabled:opacity-40"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${deParaLoading ? "animate-spin" : ""}`} />
                  Atualizar
                </button>
                {!deParaLoading && templates.length > 0 && (
                  <div className="flex gap-2 text-[11px]">
                    {naoMapeados > 0 && <span className="rounded-full bg-amber-500/15 text-amber-400 px-2.5 py-1">{naoMapeados} sem setor</span>}
                    {foraDoPadrao > 0 && <span className="rounded-full bg-orange-500/15 text-orange-400 px-2.5 py-1">{foraDoPadrao} fora do padrão Chatwoot</span>}
                  </div>
                )}
              </div>

              {deParaLoading ? (
                <div className="py-16 text-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
              ) : (
                <div className="rounded-xl border border-border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Template</th>
                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Categoria</th>
                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Status</th>
                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Setor (etiqueta Chatwoot)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {templates.map((t) => (
                        <tr key={t.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs text-foreground">{t.name}</td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">{t.category || "—"}</td>
                          <td className="px-4 py-3 text-xs">
                            <span className={t.status === "APPROVED" ? "text-emerald-400" : "text-muted-foreground"}>{t.status || "—"}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="relative inline-block">
                                <select
                                  value={t.etiqueta}
                                  onChange={(e) => onSalvarMapeamento(t, e.target.value)}
                                  disabled={salvando === t.name}
                                  className={`appearance-none rounded-lg border bg-muted px-3 py-1.5 pr-7 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-40 ${t.etiqueta && !t.etiquetaValida ? "border-orange-500/60" : "border-border"}`}
                                >
                                  <option value="">— sem setor —</option>
                                  {/* valor atual fora do padrão (preserva pra não perder) */}
                                  {t.etiqueta && !etiquetas.some((e) => e.toLowerCase() === t.etiqueta.toLowerCase()) && (
                                    <option value={t.etiqueta}>{t.etiqueta} (fora do padrão)</option>
                                  )}
                                  {etiquetas.map((e) => (
                                    <option key={e} value={e}>{e}</option>
                                  ))}
                                </select>
                                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                              </div>
                              {salvando === t.name && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                              {t.etiqueta && !t.etiquetaValida && salvando !== t.name && (
                                <span title="Não corresponde a uma etiqueta do Chatwoot"><AlertTriangle className="w-3.5 h-3.5 text-orange-400" /></span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                Defina o setor de cada template (etiqueta do Chatwoot). É esse mapeamento que o relatório usa para somar o custo por setor. Itens "fora do padrão" foram digitados manualmente e devem ser normalizados.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function CardTotal({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold mt-1 ${tone}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function FragmentSetor({
  setor,
  aberto,
  onToggle,
}: {
  setor: RelatorioFromList;
  aberto: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer" onClick={onToggle}>
        <td className="px-4 py-3 text-foreground font-medium">
          <span className="inline-flex items-center gap-1.5">
            {aberto ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
            {setor.setor}
            <span className="text-[10px] text-muted-foreground">({setor.templates.length} templates)</span>
          </span>
        </td>
        <td className="px-4 py-3 text-right text-foreground">{setor.volume.toLocaleString("pt-BR")}</td>
        <td className="px-4 py-3 text-right text-emerald-400 font-medium">{brl(setor.custoBrl)}</td>
        <td className="px-4 py-3 text-right text-muted-foreground">{usd(setor.custoUsd)}</td>
      </tr>
      {aberto &&
        setor.templates.map((t) => (
          <tr key={t.template} className="border-b border-border/30 bg-muted/20 text-xs">
            <td className="px-4 py-2 pl-10 font-mono text-muted-foreground">{t.template}</td>
            <td className="px-4 py-2 text-right text-muted-foreground">{t.volume.toLocaleString("pt-BR")}</td>
            <td className="px-4 py-2 text-right text-emerald-400/80">{brl(t.custoBrl)}</td>
            <td className="px-4 py-2 text-right text-muted-foreground/70">{usd(t.custoUsd)}</td>
          </tr>
        ))}
    </>
  );
}

type RelatorioFromList = Relatorio["setores"][number];
