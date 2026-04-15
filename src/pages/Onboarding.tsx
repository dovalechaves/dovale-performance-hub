import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Sun, Moon, UserPlus, Loader2, CheckCircle2, AlertCircle,
  ChevronDown, Copy, History, ChevronLeft, RefreshCw,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";

const BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:3001/api").replace(/\/$/, "");

interface Local {
  nome: string;
  dn: string;
}

interface Setor {
  nome: string;
  dn: string;
}

interface ADUser {
  username: string;
  displayName: string;
  dn: string;
  groups: string[];
}

interface HistEntry {
  id: number;
  username: string;
  nome_completo: string;
  cargo: string;
  setor_dn: string;
  copiar_de_dn: string | null;
  criado_por: string;
  log: string;
  created_at: string;
}

type View = "form" | "historico" | "resultado";

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");
  const [view, setView] = useState<View>("form");

  // Form state
  const [nomeCompleto, setNomeCompleto] = useState("");
  const [cargo, setCargo] = useState("");
  const [locais, setLocais] = useState<Local[]>([]);
  const [selectedLocal, setSelectedLocal] = useState<Local | null>(null);
  const [setores, setSetores] = useState<Setor[]>([]);
  const [selectedSetor, setSelectedSetor] = useState<Setor | null>(null);
  const [adUsers, setAdUsers] = useState<ADUser[]>([]);
  const [copiarDe, setCopiarDe] = useState<ADUser | null>(null);
  const [loadingLocais, setLoadingLocais] = useState(false);
  const [loadingSetores, setLoadingSetores] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Result state
  const [result, setResult] = useState<any>(null);

  // History state
  const [historico, setHistorico] = useState<HistEntry[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  // Load locations on mount
  useEffect(() => {
    (async () => {
      setLoadingLocais(true);
      try {
        const res = await fetch(`${BASE}/onboarding/locais`);
        const data = await res.json();
        if (Array.isArray(data)) setLocais(data);
      } catch { /* ignore */ }
      finally { setLoadingLocais(false); }
    })();
  }, []);

  // Load departments when location changes
  useEffect(() => {
    if (!selectedLocal) { setSetores([]); setSelectedSetor(null); setAdUsers([]); setCopiarDe(null); return; }
    (async () => {
      setLoadingSetores(true);
      setSelectedSetor(null);
      setAdUsers([]);
      setCopiarDe(null);
      try {
        const res = await fetch(`${BASE}/onboarding/setores?local=${encodeURIComponent(selectedLocal.dn)}`);
        const data = await res.json();
        if (Array.isArray(data)) setSetores(data);
      } catch { /* ignore */ }
      finally { setLoadingSetores(false); }
    })();
  }, [selectedLocal]);

  // Load users when department changes
  useEffect(() => {
    if (!selectedSetor) { setAdUsers([]); setCopiarDe(null); return; }
    (async () => {
      setLoadingUsers(true);
      setCopiarDe(null);
      try {
        const res = await fetch(`${BASE}/onboarding/usuarios?setor_dn=${encodeURIComponent(selectedSetor.dn)}`);
        const data = await res.json();
        if (Array.isArray(data)) setAdUsers(data);
      } catch { /* ignore */ }
      finally { setLoadingUsers(false); }
    })();
  }, [selectedSetor]);

  const fetchHistorico = useCallback(async () => {
    setLoadingHist(true);
    try {
      const res = await fetch(`${BASE}/onboarding/historico`);
      const data = await res.json();
      if (Array.isArray(data)) setHistorico(data);
    } catch { /* ignore */ }
    finally { setLoadingHist(false); }
  }, []);

  useEffect(() => {
    if (view === "historico") fetchHistorico();
  }, [view, fetchHistorico]);

  const generatedUsername = (() => {
    const parts = nomeCompleto
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return parts[0] || "";
    return `${parts[0]}.${parts[parts.length - 1]}`;
  })();

  const handleSubmit = async () => {
    if (!nomeCompleto.trim() || !selectedSetor) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/onboarding/criar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome_completo: nomeCompleto.trim(),
          cargo: cargo.trim() || null,
          setor_dn: selectedSetor.dn,
          copiar_de_dn: copiarDe?.dn || null,
          criado_por: user?.usuario || "sistema",
        }),
      });
      const data = await res.json();
      setResult(data);
      setView("resultado");
    } catch (err: any) {
      setResult({ error: err.message, log: [] });
      setView("resultado");
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setNomeCompleto("");
    setCargo("");
    setSelectedLocal(null);
    setSelectedSetor(null);
    setCopiarDe(null);
    setResult(null);
    setView("form");
  };

  const logo = dark ? logoWhite : logoBlue;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b border-border">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/hub")} className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <img src={logo} alt="Dovale" className="h-7" />
            <span className="text-sm font-semibold text-foreground">Onboarding</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setView(view === "historico" ? "form" : "historico")} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${view === "historico" ? "bg-cyan-500 text-white" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
              <History className="w-3.5 h-3.5" /> Histórico
            </button>
            <button onClick={() => setDark(!dark)} className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto max-w-2xl px-4 py-8">
        {/* ─── FORM VIEW ─── */}
        {view === "form" && (
          <div className="space-y-6">
            <div>
              <h1 className="text-xl font-bold text-foreground">Criar Usuário no AD</h1>
              <p className="text-sm text-muted-foreground mt-1">Preencha os dados do novo funcionário para criação automática no Active Directory.</p>
            </div>

            <div className="rounded-xl border border-border bg-gradient-to-br from-muted/30 to-muted/10 p-6 space-y-5">
              {/* Nome completo */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nome Completo *</label>
                <input
                  type="text"
                  value={nomeCompleto}
                  onChange={(e) => setNomeCompleto(e.target.value)}
                  placeholder="Ex: João Carlos da Silva"
                  className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
                {generatedUsername && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Username: <span className="font-mono text-cyan-500">{generatedUsername}</span>
                  </p>
                )}
              </div>

              {/* Cargo */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cargo</label>
                <input
                  type="text"
                  value={cargo}
                  onChange={(e) => setCargo(e.target.value)}
                  placeholder="Ex: Analista de TI"
                  className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>

              {/* Local */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Local *</label>
                {loadingLocais ? (
                  <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando locais...</div>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {locais.map((l) => (
                      <button
                        key={l.dn}
                        onClick={() => setSelectedLocal(selectedLocal?.dn === l.dn ? null : l)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${selectedLocal?.dn === l.dn ? "bg-cyan-500 text-white border-cyan-500" : "bg-muted text-foreground border-border hover:border-cyan-500/40"}`}
                      >
                        {l.nome}
                      </button>
                    ))}
                    {locais.length === 0 && <p className="text-xs text-red-500">Nenhum local encontrado. Verifique a conexão com o AD.</p>}
                  </div>
                )}
              </div>

              {/* Setor */}
              {selectedLocal && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Setor *</label>
                  {loadingSetores ? (
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando setores...</div>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {setores.map((s) => (
                        <button
                          key={s.dn}
                          onClick={() => setSelectedSetor(selectedSetor?.dn === s.dn ? null : s)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${selectedSetor?.dn === s.dn ? "bg-cyan-500 text-white border-cyan-500" : "bg-muted text-foreground border-border hover:border-cyan-500/40"}`}
                        >
                          {s.nome}
                        </button>
                      ))}
                      {setores.length === 0 && <p className="text-xs text-muted-foreground">Nenhum setor encontrado neste local.</p>}
                    </div>
                  )}
                </div>
              )}

              {/* Copiar permissões */}
              {selectedSetor && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Copiar Permissões De (opcional)</label>
                  {loadingUsers ? (
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando usuários...</div>
                  ) : (
                    <select
                      value={copiarDe?.dn || ""}
                      onChange={(e) => setCopiarDe(adUsers.find((u) => u.dn === e.target.value) || null)}
                      className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                    >
                      <option value="">Nenhum (sem cópia de grupos)</option>
                      {adUsers.map((u) => (
                        <option key={u.dn} value={u.dn}>
                          {u.displayName} ({u.username}) — {u.groups.length} grupo(s)
                        </option>
                      ))}
                    </select>
                  )}
                  {copiarDe && copiarDe.groups.length > 0 && (
                    <div className="mt-2 rounded-lg border border-border bg-muted/50 p-3">
                      <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">Grupos que serão copiados:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {copiarDe.groups.map((g, i) => (
                          <span key={i} className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-500 text-[10px] font-medium border border-cyan-500/20">
                            {g.split(",")[0]?.replace("CN=", "")}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Summary */}
              {nomeCompleto.trim() && selectedSetor && (
                <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4 space-y-1.5">
                  <p className="text-xs font-semibold text-cyan-500">Resumo</p>
                  <div className="text-xs text-foreground space-y-0.5">
                    <p><span className="text-muted-foreground">Nome:</span> {nomeCompleto.trim()}</p>
                    <p><span className="text-muted-foreground">Username:</span> <span className="font-mono">{generatedUsername}</span></p>
                    {cargo && <p><span className="text-muted-foreground">Cargo:</span> {cargo}</p>}
                    <p><span className="text-muted-foreground">Local:</span> {selectedLocal?.nome}</p>
                    <p><span className="text-muted-foreground">Setor:</span> {selectedSetor.nome}</p>
                    <p><span className="text-muted-foreground">Senha:</span> <span className="font-mono">@Dovale123</span> (troca obrigatória)</p>
                    {copiarDe && <p><span className="text-muted-foreground">Copiar de:</span> {copiarDe.displayName} ({copiarDe.groups.length} grupos)</p>}
                  </div>
                </div>
              )}

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={!nomeCompleto.trim() || !selectedSetor || submitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-600 transition-colors disabled:opacity-40"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                {submitting ? "Criando usuário..." : "Criar Usuário no AD"}
              </button>
            </div>
          </div>
        )}

        {/* ─── RESULTADO VIEW ─── */}
        {view === "resultado" && result && (
          <div className="space-y-6">
            <button onClick={resetForm} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="w-4 h-4" /> Criar outro usuário
            </button>

            <div className={`rounded-xl border p-6 space-y-4 ${result.ok ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"}`}>
              <div className="flex items-center gap-3">
                {result.ok ? <CheckCircle2 className="w-6 h-6 text-green-500" /> : <AlertCircle className="w-6 h-6 text-red-500" />}
                <h2 className="text-lg font-bold text-foreground">{result.ok ? "Usuário Criado com Sucesso!" : "Erro ao Criar Usuário"}</h2>
              </div>

              {result.ok && (
                <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-muted-foreground">Username:</span> <span className="font-mono font-semibold text-foreground">{result.username}</span></div>
                    <div><span className="text-muted-foreground">UPN:</span> <span className="font-mono text-foreground">{result.upn}</span></div>
                    <div><span className="text-muted-foreground">Senha:</span> <span className="font-mono text-foreground">{result.senha_inicial}</span></div>
                    <div><span className="text-muted-foreground">Trocar senha:</span> <span className="text-orange-500 font-semibold">Sim (1º login)</span></div>
                  </div>
                </div>
              )}

              {result.error && !result.ok && (
                <p className="text-sm text-red-500">{result.error}</p>
              )}

              {result.log && result.log.length > 0 && (
                <div className="rounded-lg border border-border bg-muted/50 p-4">
                  <p className="text-[11px] font-semibold text-muted-foreground mb-2">Log de Execução</p>
                  <div className="space-y-1">
                    {(Array.isArray(result.log) ? result.log : result.log.split("\n")).map((line: string, i: number) => (
                      <p key={i} className="text-xs font-mono text-foreground">{line}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── HISTORICO VIEW ─── */}
        {view === "historico" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold text-foreground">Histórico de Onboarding</h1>
                <p className="text-sm text-muted-foreground mt-1">Todos os usuários criados pelo sistema.</p>
              </div>
              <button onClick={fetchHistorico} className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
                <RefreshCw className={`w-4 h-4 ${loadingHist ? "animate-spin" : ""}`} />
              </button>
            </div>

            {loadingHist ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando...
              </div>
            ) : historico.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">Nenhum registro encontrado.</div>
            ) : (
              <div className="space-y-3">
                {historico.map((h) => (
                  <div key={h.id} className="rounded-xl border border-border bg-gradient-to-br from-muted/30 to-muted/10 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">{h.nome_completo}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          <span className="font-mono text-cyan-500">{h.username}</span>
                          {h.cargo && <> · {h.cargo}</>}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Criado por {h.criado_por} em {new Date(h.created_at).toLocaleString("pt-BR")}
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 text-[10px] font-semibold border border-green-500/20">
                        <CheckCircle2 className="w-3 h-3" /> Criado
                      </span>
                    </div>
                    {h.log && (
                      <details className="mt-3">
                        <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">Ver log</summary>
                        <div className="mt-2 rounded-lg bg-muted/50 p-2 space-y-0.5">
                          {h.log.split("\n").map((line, i) => (
                            <p key={i} className="text-[10px] font-mono text-foreground">{line}</p>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
