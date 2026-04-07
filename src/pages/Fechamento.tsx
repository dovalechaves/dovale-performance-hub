import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Sun, Moon, RefreshCw, Play, Loader2, CheckCircle2, XCircle, Clock, ChevronDown, Settings } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { API_BASE, getAuthUsers, updateAuthUserRole, type AuthManagedUser } from "@/services/api";
import { ROLE_LABELS, type Role } from "@/lib/rbac";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";

interface HistoryRow {
  EMP: string;
  VALORESTOQUE: number | null;
  VENDASRECEBIDAS: number | null;
  VENDASLOJASINDUSTRIA: number | null;
  CAR: number | null;
  LUCROBRUTO: number | null;
  LUCROREAL: number | null;
  LUCROREALINDUSTRIA: number | null;
  LUCROFINAL: number | null;
  DESPESAS: number | null;
  CAP: number | null;
  MESREFERENCIA: number;
  ANOREFERENCIA: number;
}

interface JobStatus {
  lastRunAt: string | null;
  lastRunResult: { inserted: number; stores: number; referenceMonth: number; referenceYear: number } | null;
  lastRunError: string | null;
}

const FECHAMENTO_LOJAS = [
  { value: "CAMPINAS", label: "Campinas" },
  { value: "FORTALEZA", label: "Fortaleza" },
  { value: "BELO HORIZONTE", label: "Belo Horizonte" },
  { value: "RIO DE JANEIRO", label: "Rio de Janeiro" },
  { value: "SANTANA", label: "Santana" },
  { value: "UBERLANDIA", label: "Uberlândia" },
];

const fmt = (v: number | null) =>
  v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

const MONTH_NAMES = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export default function Fechamento() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<string>("all");
  const [showGerenciamento, setShowGerenciamento] = useState(false);
  const [managedUsers, setManagedUsers] = useState<AuthManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [savingUser, setSavingUser] = useState<string | null>(null);
  const [savedUser, setSavedUser] = useState<string | null>(null);

  const isAdmin = user?.apps.fechamento.role === "admin";
  const isManager = user?.apps.fechamento.role === "manager";
  const managerLoja = user?.apps.fechamento.loja ?? null;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [histRes, statusRes] = await Promise.all([
        fetch(`${API_BASE}/stock-snapshot/history`),
        fetch(`${API_BASE}/stock-snapshot/status`),
      ]);
      if (histRes.ok) setHistory(await histRes.json());
      if (statusRes.ok) setStatus(await statusRes.json());
    } catch (err) {
      console.error("Erro ao carregar dados:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const runManual = async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await fetch(`${API_BASE}/stock-snapshot/run`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setRunResult(`${data.inserted} registro(s) inserido(s) — Ref ${String(data.referenceMonth).padStart(2, "0")}/${data.referenceYear}`);
        fetchData();
      } else {
        setRunResult(`Erro: ${data.erro}`);
      }
    } catch (err: any) {
      setRunResult(`Erro: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  // Filter by loja for manager role
  const lojaFilteredHistory = useMemo(() => {
    if (isAdmin) return history;
    if (isManager && managerLoja) {
      return history.filter((r) => r.EMP.toUpperCase() === managerLoja.toUpperCase());
    }
    return history;
  }, [history, isAdmin, isManager, managerLoja]);

  const periods = useMemo(() => {
    const set = new Set<string>();
    lojaFilteredHistory.forEach((r) => set.add(`${r.ANOREFERENCIA}-${String(r.MESREFERENCIA).padStart(2, "0")}`));
    return Array.from(set).sort().reverse();
  }, [lojaFilteredHistory]);

  const filteredHistory = useMemo(() => {
    if (selectedPeriod === "all") return lojaFilteredHistory;
    const [year, month] = selectedPeriod.split("-").map(Number);
    return lojaFilteredHistory.filter((r) => r.ANOREFERENCIA === year && r.MESREFERENCIA === month);
  }, [lojaFilteredHistory, selectedPeriod]);

  const groupedHistory = useMemo(() => {
    const map = new Map<string, HistoryRow[]>();
    filteredHistory.forEach((r) => {
      const key = `${MONTH_NAMES[r.MESREFERENCIA]} ${r.ANOREFERENCIA}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    });
    return Array.from(map.entries());
  }, [filteredHistory]);

  const periodSummary = (rows: HistoryRow[]) => {
    const totalEstoque = rows.reduce((s, r) => s + (r.VALORESTOQUE ?? 0), 0);
    const totalVendas = rows.reduce((s, r) => s + (r.VENDASLOJASINDUSTRIA ?? 0), 0);
    const totalReceb = rows.reduce((s, r) => s + (r.VENDASRECEBIDAS ?? 0), 0);
    return { totalEstoque, totalVendas, totalReceb, lojas: rows.length };
  };

  // Gerenciamento
  const loadManagedUsers = async () => {
    if (!user || !isAdmin) return;
    setUsersLoading(true);
    try {
      const data = await getAuthUsers(user.usuario);
      setManagedUsers(data);
    } catch { /* ignore */ } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    if (showGerenciamento && isAdmin) loadManagedUsers();
  }, [showGerenciamento]);

  const persistUser = async (next: AuthManagedUser) => {
    if (!user) return;
    setSavingUser(next.usuario);
    try {
      await updateAuthUserRole({
        actor_usuario: user.usuario,
        usuario: next.usuario,
        can_access_hub: next.can_access_hub,
        apps: next.apps,
      });
      setSavedUser(next.usuario);
      setTimeout(() => setSavedUser(null), 2000);
    } catch { /* ignore */ } finally {
      setSavingUser(null);
    }
  };

  const updateManagedUser = (usuario: string, updater: (u: AuthManagedUser) => AuthManagedUser) => {
    setManagedUsers((prev) => prev.map((u) => (u.usuario === usuario ? updater(u) : u)));
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header — same layout as Calculadora */}
      <header className="border-b border-border bg-gradient-card">
        <div className="container mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate("/hub")}
            className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="h-5 w-px bg-border" />
          <button
            onClick={() => navigate("/hub")}
            className="relative h-9 w-36 overflow-hidden"
            title="Ir para o Hub"
          >
            <img src={logoBlue} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ease-in-out ${dark ? 'opacity-0 scale-90 blur-sm rotate-3' : 'opacity-100 scale-100 blur-0 rotate-0'}`} />
            <img src={logoWhite} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ease-in-out ${dark ? 'opacity-100 scale-100 blur-0 rotate-0' : 'opacity-0 scale-90 blur-sm -rotate-3'}`} />
          </button>
          <div className="h-5 w-px bg-border" />
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Fechamento Estoque
          </span>

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={fetchData}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </button>
            {isAdmin && (
              <button
                onClick={runManual}
                disabled={running}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Executar Agora
              </button>
            )}
            {user && (
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs font-semibold text-foreground leading-tight">{user.usuario}</span>
                <span className="text-[10px] uppercase tracking-widest text-primary">{user.roleLabel}</span>
              </div>
            )}
            <button
              onClick={() => setDark(d => !d)}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
              title="Alternar tema"
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            {isAdmin && (
              <button
                onClick={() => setShowGerenciamento(v => !v)}
                className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary hover:text-primary-foreground transition-colors"
                title="Gerenciamento"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-8">
        {/* Status Cards — only for admin */}
        {isAdmin && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-primary" />
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Cron</h3>
              </div>
              <p className="text-sm text-foreground font-medium">Todo dia 01 à meia-noite</p>
              <p className="text-xs text-muted-foreground mt-1">Timezone: America/Sao_Paulo</p>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 mb-3">
                {status?.lastRunError ? (
                  <XCircle className="w-4 h-4 text-destructive" />
                ) : status?.lastRunResult ? (
                  <CheckCircle2 className="w-4 h-4 text-[#00A650]" />
                ) : (
                  <Clock className="w-4 h-4 text-muted-foreground" />
                )}
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Última Execução</h3>
              </div>
              {status?.lastRunAt ? (
                <>
                  <p className="text-sm text-foreground font-medium">
                    {new Date(status.lastRunAt).toLocaleString("pt-BR")}
                  </p>
                  {status.lastRunError ? (
                    <p className="text-xs text-destructive mt-1 truncate" title={status.lastRunError}>{status.lastRunError}</p>
                  ) : status.lastRunResult ? (
                    <p className="text-xs text-muted-foreground mt-1">
                      {status.lastRunResult.inserted} inserido(s) — {status.lastRunResult.stores} loja(s)
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma execução ainda</p>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Registros</h3>
              </div>
              <p className="text-2xl font-bold text-foreground tabular-nums">{lojaFilteredHistory.length}</p>
              <p className="text-xs text-muted-foreground mt-1">{periods.length} período(s) registrado(s)</p>
            </div>
          </div>
        )}

        {/* Manager loja info banner */}
        {isManager && managerLoja && (
          <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 px-4 py-3 text-sm text-foreground">
            Exibindo dados de: <strong>{managerLoja}</strong>
          </div>
        )}

        {/* Run Result */}
        {runResult && (
          <div className={`rounded-lg px-4 py-3 text-sm font-medium ${runResult.startsWith("Erro") ? "bg-destructive/10 text-destructive border border-destructive/30" : "bg-[#00A650]/10 text-[#00A650] border border-[#00A650]/30"}`}>
            {runResult}
          </div>
        )}

        {/* Period Filter */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Período</label>
          <div className="relative inline-block">
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="appearance-none rounded-lg border border-border bg-secondary px-4 py-2 pr-8 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="all">Todos os períodos</option>
              {periods.map((p) => {
                const [y, m] = p.split("-").map(Number);
                return <option key={p} value={p}>{MONTH_NAMES[m]} {y}</option>;
              })}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {/* Data Table */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : groupedHistory.length === 0 ? (
          <div className="rounded-xl border border-border bg-muted/30 px-6 py-8 text-center">
            <p className="text-sm text-muted-foreground">Nenhum registro de fechamento encontrado.</p>
          </div>
        ) : (
          groupedHistory.map(([period, rows]) => {
            const summary = periodSummary(rows);
            return (
              <div key={period} className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="text-base font-bold text-foreground">{period}</h3>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{summary.lojas} loja(s)</span>
                    <span>Estoque: <strong className="text-foreground">{fmt(summary.totalEstoque)}</strong></span>
                    <span>Vendas: <strong className="text-foreground">{fmt(summary.totalVendas)}</strong></span>
                    <span>Recebimentos: <strong className="text-foreground">{fmt(summary.totalReceb)}</strong></span>
                  </div>
                </div>
                <div className="rounded-xl border border-border overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground uppercase tracking-wider">Loja</th>
                        <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground uppercase tracking-wider">Estoque</th>
                        <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground uppercase tracking-wider">Vendas Loja</th>
                        <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground uppercase tracking-wider">Recebimentos</th>
                        <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground uppercase tracking-wider">CAR</th>
                        <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground uppercase tracking-wider">Lucro Bruto</th>
                        <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground uppercase tracking-wider">Lucro Real</th>
                        <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground uppercase tracking-wider">Lucro Ind.</th>
                        <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground uppercase tracking-wider">Lucro Final</th>
                        <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground uppercase tracking-wider">Despesas</th>
                        <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground uppercase tracking-wider">CAP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={`${r.EMP}-${i}`} className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors">
                          <td className="px-3 py-2.5 font-medium text-foreground whitespace-nowrap">{r.EMP}</td>
                          <td className="px-3 py-2.5 text-right text-foreground tabular-nums">{fmt(r.VALORESTOQUE)}</td>
                          <td className="px-3 py-2.5 text-right text-foreground tabular-nums">{fmt(r.VENDASLOJASINDUSTRIA)}</td>
                          <td className="px-3 py-2.5 text-right text-foreground tabular-nums">{fmt(r.VENDASRECEBIDAS)}</td>
                          <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums">{fmt(r.CAR)}</td>
                          <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums">{fmt(r.LUCROBRUTO)}</td>
                          <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums">{fmt(r.LUCROREAL)}</td>
                          <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums">{fmt(r.LUCROREALINDUSTRIA)}</td>
                          <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums">{fmt(r.LUCROFINAL)}</td>
                          <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums">{fmt(r.DESPESAS)}</td>
                          <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums">{fmt(r.CAP)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })
        )}

        {/* Gerenciamento Panel — admin only */}
        {isAdmin && showGerenciamento && (
          <section className="mt-8 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground">
                Permissões — Fechamento Estoque
              </h2>
              <button
                onClick={loadManagedUsers}
                disabled={usersLoading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors disabled:opacity-40"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${usersLoading ? "animate-spin" : ""}`} />
                Atualizar
              </button>
            </div>

            <div className="rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Usuário</th>
                    <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Nome</th>
                    <th className="px-4 py-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground">Acesso</th>
                    <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Role</th>
                    <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Loja</th>
                    <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {usersLoading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                      </td>
                    </tr>
                  ) : (
                    managedUsers
                      .filter((u) => u.apps.fechamento.can_access)
                      .map((u) => (
                        <tr key={u.usuario} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs text-foreground">{u.usuario}</td>
                          <td className="px-4 py-3 text-foreground">{u.displayname || "—"}</td>
                          <td className="px-4 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={u.apps.fechamento.can_access}
                              onChange={async (e) => {
                                const next: AuthManagedUser = {
                                  ...u,
                                  apps: {
                                    ...u.apps,
                                    fechamento: { ...u.apps.fechamento, can_access: e.target.checked },
                                  },
                                };
                                updateManagedUser(u.usuario, () => next);
                                await persistUser(next);
                              }}
                              disabled={savingUser === u.usuario}
                              className="h-4 w-4 rounded border-border bg-muted text-primary focus:ring-primary/50 disabled:opacity-40"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="relative inline-block">
                              <select
                                value={u.apps.fechamento.role}
                                onChange={async (e) => {
                                  const nextRole = e.target.value as Role;
                                  const next: AuthManagedUser = {
                                    ...u,
                                    apps: {
                                      ...u.apps,
                                      fechamento: {
                                        ...u.apps.fechamento,
                                        role: nextRole,
                                        loja: nextRole === "manager" ? (u.apps.fechamento.loja ?? "CAMPINAS") : null,
                                      },
                                    },
                                  };
                                  updateManagedUser(u.usuario, () => next);
                                  await persistUser(next);
                                }}
                                disabled={savingUser === u.usuario}
                                className="appearance-none rounded-lg border border-border bg-muted px-3 py-1.5 pr-7 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-40"
                              >
                                {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                                ))}
                              </select>
                              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {u.apps.fechamento.role === "manager" ? (
                              <div className="relative inline-block">
                                <select
                                  value={u.apps.fechamento.loja ?? "CAMPINAS"}
                                  onChange={async (e) => {
                                    const next: AuthManagedUser = {
                                      ...u,
                                      apps: {
                                        ...u.apps,
                                        fechamento: { ...u.apps.fechamento, loja: e.target.value },
                                      },
                                    };
                                    updateManagedUser(u.usuario, () => next);
                                    await persistUser(next);
                                  }}
                                  disabled={savingUser === u.usuario}
                                  className="appearance-none rounded-lg border border-border bg-muted px-3 py-1.5 pr-7 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-40"
                                >
                                  {FECHAMENTO_LOJAS.map((l) => (
                                    <option key={l.value} value={l.value}>{l.label}</option>
                                  ))}
                                </select>
                                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                              </div>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {savingUser === u.usuario && <span className="text-muted-foreground">Salvando...</span>}
                            {savedUser === u.usuario && <span className="text-primary font-semibold">Salvo</span>}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
