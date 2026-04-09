import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Sun, Moon, Play, Square, Download, Database, Loader2, CheckCircle2,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";

const BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:3001/api").replace(/\/$/, "");

interface PriceLog {
  id: string;
  timestamp: Date;
  status: string;
  storeName: string;
  productCode: string;
  newPrice: number;
  message?: string;
  tableName?: string;
}

const STORES_DEFAULT = [
  { id: "sjc", name: "SJC" },
  { id: "lockeysp", name: "LockeySP" },
  { id: "lockeymg", name: "LockeyMG" },
  { id: "rs", name: "RS" },
  { id: "niteroi", name: "Niteroi" },
];

const fmtTime = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// ── CSV Export ──
function exportCsv(logs: PriceLog[], userName: string) {
  if (!logs.length) return;
  const header = "Código Produto;Loja;Valor Novo;Data/Hora;Status;Usuário;Tabela\n";
  const rows = logs.map((l) =>
    [l.productCode, l.storeName, l.newPrice.toFixed(2).replace(".", ","), l.timestamp.toLocaleString("pt-BR"), l.status === "success" ? "SUCESSO" : "ERRO", userName, l.tableName || ""].join(";")
  );
  const blob = new Blob(["\uFEFF" + header + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `sync_precos_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function MultiPreco() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  // ── Sync state ──
  const [logs, setLogs] = useState<PriceLog[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [savingStore, setSavingStore] = useState<string | null>(null);
  const [sqlProgress, setSqlProgress] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight, behavior: "smooth" });
  }, [logs]);

  const exportable = useMemo(() => logs.filter((l) => l.status === "success" || l.status === "error"), [logs]);

  // ── Dynamic store cards ──
  const dynamicTargets = useMemo(() => {
    const names = new Set<string>();
    logs.forEach((l) => {
      if (l.storeName && l.storeName !== "SJC" && l.storeName !== "---" && l.storeName !== "API") names.add(l.storeName);
    });
    return Array.from(names).map((n, i) => ({ id: `dyn-${i}`, name: n }));
  }, [logs]);
  const displayTargets = dynamicTargets.length > 0 ? dynamicTargets : STORES_DEFAULT.slice(1);

  // ── Start sync ──
  const startSync = useCallback(async () => {
    if (isRunning) return;
    setIsRunning(true);
    setProgress(10);
    setSavingStore(null);
    setSqlProgress(0);
    setIsCompleted(false);
    setLogs([{ id: "start", timestamp: new Date(), status: "pending", storeName: "SJC", productCode: "---", newPrice: 0, message: "Aguarde... Lendo a base e atualizando os destinos..." }]);

    abortRef.current = new AbortController();

    try {
      const resp = await fetch(`${BASE}/multi-preco/sync?usuario=${encodeURIComponent(user?.displayName || "Desconhecido")}`, {
        method: "POST",
        signal: abortRef.current.signal,
      });
      if (!resp.ok) throw new Error("Erro na resposta da API");
      if (!resp.body) throw new Error("Streaming não suportado");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        const batch: PriceLog[] = [];
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const l = JSON.parse(line);
            batch.push({
              id: `log-${Date.now()}-${Math.random()}`,
              timestamp: new Date(),
              status: l.status || "info",
              storeName: l.storeName || "SJC",
              productCode: String(l.productCode || "---"),
              newPrice: Number(l.newPrice || 0),
              message: l.message,
              tableName: l.tableName,
            });
            if (l.status === "saving_log") { setSavingStore(l.storeName || "Loja"); setSqlProgress(0); }
            else if (l.status === "saving_progress") { setSqlProgress(Number(l.message) || 0); }
            else if (l.status === "saved_log") { setSavingStore(null); setSqlProgress(0); }
            else if (l.status === "complete") { setIsCompleted(true); setSavingStore(null); }
          } catch { /* skip */ }
        }
        if (batch.length) setLogs((prev) => [...prev, ...batch]);
      }
      setProgress(100);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setLogs((prev) => [...prev, { id: `err-${Date.now()}`, timestamp: new Date(), status: "error", storeName: "API", productCode: "---", newPrice: 0, message: `Falha na API: ${err.message}` }]);
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
      setSavingStore(null);
    }
  }, [isRunning, user]);

  const stopSync = () => { abortRef.current?.abort(); setIsRunning(false); };

  // Terminal visible logs (clear on each store)
  const lastClear = logs.map((l) => l.status).lastIndexOf("clear");
  const visible = (lastClear !== -1 ? logs.slice(lastClear + 1) : logs).slice(-150);

  // Source card count
  const sourceCount = useMemo(() => {
    const m = logs.find((l) => l.message?.includes("Encontrados"))?.message?.match(/Encontrados (\d+)/);
    return m ? parseInt(m[1]) : 0;
  }, [logs]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
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
            <Database className="w-5 h-5 text-cyan-500" />
            <div>
              <h1 className="text-sm font-mono font-bold text-foreground tracking-tight">MULTI-PREÇO</h1>
              <p className="text-[10px] font-mono text-muted-foreground">BASE - SJC → {displayTargets.length} lojas</p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {user && <span className="text-xs text-muted-foreground hidden sm:inline">{user.displayName}</span>}

            {!isRunning ? (
              <button onClick={startSync} className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-600 transition-colors font-mono">
                <Play className="w-3.5 h-3.5" /> Iniciar
              </button>
            ) : (
              <button onClick={stopSync} className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-xs font-semibold text-white hover:bg-red-600 transition-colors font-mono">
                <Square className="w-3.5 h-3.5" /> Parar
              </button>
            )}

            <button onClick={() => exportCsv(exportable, user?.displayName || "Usuário")} disabled={!exportable.length} className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 font-mono">
              <Download className="w-3.5 h-3.5" /> CSV ({exportable.length})
            </button>

            <button onClick={() => setDark((d) => !d)} className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors">
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto max-w-5xl px-4 py-6 space-y-6">
          {/* Progress */}
          {isRunning && (
            <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-cyan-500 transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          )}

          {/* Store Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {/* Source */}
            <div className="rounded-xl border border-border bg-gradient-card p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-sm font-bold text-foreground">SJC</h3>
                <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-500 border border-cyan-500/30">ORIGEM</span>
              </div>
              <span className="text-xs font-mono text-green-500">{sourceCount} encontrados</span>
            </div>
            {/* Targets */}
            {displayTargets.map((s) => {
              const sLogs = logs.filter((l) => norm(l.storeName) === norm(s.name));
              const ok = sLogs.filter((l) => l.status === "success").length;
              const er = sLogs.filter((l) => l.status === "error").length;
              return (
                <div key={s.id} className="rounded-xl border border-border bg-gradient-card p-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-mono text-sm font-bold text-foreground">{s.name}</h3>
                    <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border">DESTINO</span>
                  </div>
                  <div className="flex gap-3 text-xs font-mono">
                    <span className="text-cyan-500">{ok} alterados</span>
                    {er > 0 && <span className="text-red-500">{er} erros</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Terminal */}
          <div className="rounded-xl border border-border bg-background overflow-hidden flex flex-col" style={{ height: 420 }}>
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/50">
              <div className="flex gap-1.5">
                <span className="w-3 h-3 rounded-full bg-red-500/70" />
                <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
                <span className="w-3 h-3 rounded-full bg-green-500/70" />
              </div>
              <span className="text-xs font-mono text-muted-foreground ml-2">terminal — sincronização de preços</span>
              {isRunning && <span className="ml-auto text-xs font-mono text-cyan-500 animate-pulse">● RUNNING</span>}
            </div>
            <div ref={terminalRef} className="flex-1 overflow-y-auto p-4 font-mono text-sm space-y-1">
              {logs.length === 0 && <p className="text-muted-foreground">{">"} Aguardando início da sincronização...</p>}
              {visible.map((log) => (
                <div key={log.id} className="flex gap-2 leading-relaxed">
                  <span className="text-muted-foreground shrink-0">[{fmtTime(log.timestamp)}]</span>
                  {log.status === "success" && <span className="text-green-500">✓ {log.message}</span>}
                  {log.status === "error" && <span className="text-red-500">✗ {log.message}</span>}
                  {log.status === "pending" && <span className="text-muted-foreground"><span className="text-yellow-500">⟳</span> {log.message}</span>}
                  {log.status === "saving_log" && <span className="text-blue-400"><span className="animate-pulse">⟳</span> {log.message}</span>}
                  {log.status === "saved_log" && <span className="text-green-500">✓ {log.message}</span>}
                  {log.status === "info" && <span className="text-blue-400">ℹ {log.message}</span>}
                  {log.status === "complete" && <span className="text-green-400 font-bold">★ {log.message}</span>}
                </div>
              ))}
            </div>
          </div>

          <p className="text-[10px] font-mono text-muted-foreground text-center">DOVALE CHAVES — Preços consultados em SJC.</p>
        </div>
      </main>

      {/* Modals */}
      {(savingStore || isCompleted) && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
          {savingStore && !isCompleted && (
            <div className="bg-card border border-border shadow-lg rounded-xl p-8 max-w-sm w-full mx-4 flex flex-col items-center text-center space-y-4">
              <Loader2 className="w-12 h-12 text-cyan-500 animate-spin" />
              <h3 className="text-lg font-bold font-mono text-card-foreground">Aguarde...</h3>
              <p className="text-sm font-mono text-muted-foreground">Adicionando Dados no LOG de sistema.<br /><span className="text-cyan-500 font-bold text-base mt-2 block">{savingStore}</span></p>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-cyan-500 transition-all duration-200 rounded-full" style={{ width: `${sqlProgress}%` }} />
              </div>
              <p className="text-xs font-mono text-cyan-500">{sqlProgress}% concluído</p>
            </div>
          )}
          {isCompleted && (
            <div className="bg-card border border-border shadow-lg rounded-xl p-8 max-w-sm w-full mx-4 flex flex-col items-center text-center space-y-6">
              <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
              </div>
              <h3 className="text-xl font-bold font-mono text-card-foreground">Concluído!</h3>
              <p className="text-sm font-mono text-muted-foreground">O processo de sincronização Multi-Preço foi totalmente concluído em todas as lojas!</p>
              <button onClick={() => setIsCompleted(false)} className="w-full rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-600 transition-colors font-mono">OK</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
