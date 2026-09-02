import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { ArrowLeft, Sun, Moon, PackageSearch, RefreshCw, Loader2 } from "lucide-react";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";
import {
  API_BASE,
  getProductFirstMovementMonthly,
  getProductFirstMovementStatus,
  runProductFirstMovementCheck,
  type ProductFirstMovementItem,
  type ProductFirstMovementStatus,
} from "@/services/api";

export default function PrimeiraMovimentacao() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");

  const [products, setProducts] = useState<ProductFirstMovementItem[]>([]);
  const [status, setStatus] = useState<ProductFirstMovementStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [items, st] = await Promise.all([
        getProductFirstMovementMonthly(),
        getProductFirstMovementStatus(),
      ]);
      setProducts(items);
      setStatus(st);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRun = async () => {
    setRunning(true);
    setError("");
    setMessage("");
    try {
      const result = await runProductFirstMovementCheck();
      setMessage(result.mensagem);
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao executar verificação manual");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-gradient-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/hub")}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
              title="Voltar ao Hub"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => navigate("/hub")}
              className="relative h-9 w-36 overflow-hidden"
              title="Ir para o Hub"
            >
              <img src={logoBlue} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ease-in-out ${dark ? "opacity-0 scale-90 blur-sm rotate-3" : "opacity-100 scale-100 blur-0 rotate-0"}`} />
              <img src={logoWhite} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ease-in-out ${dark ? "opacity-100 scale-100 blur-0 rotate-0" : "opacity-0 scale-90 blur-sm -rotate-3"}`} />
            </button>
            <div className="h-5 w-px bg-border" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-medium">
              Primeira Movimentação
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setDark((d) => !d)}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
              title="Alternar tema"
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="container mx-auto px-6 py-10">
        {/* Title + action */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between mb-8">
          <div>
            <div className="flex items-center gap-2">
              <PackageSearch className="w-6 h-6 text-primary" />
              <h1 className="text-xl font-bold text-foreground tracking-tight">
                Produtos com primeira movimentação no mês
              </h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Painel mensal com verificação manual e rotina automática diária às 16h para notificar novos itens no Chatwoot.
            </p>
          </div>

          <div className="flex flex-col items-start gap-2 lg:items-end">
            <button
              onClick={handleRun}
              disabled={running}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Verificar agora
            </button>
            {status?.lastRunAt && (
              <span className="text-xs text-muted-foreground">
                Última execução: {new Date(status.lastRunAt).toLocaleString("pt-BR")}
              </span>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-3 md:grid-cols-3 mb-6">
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Produtos no mês</div>
            <div className="mt-2 text-2xl font-bold text-foreground">{products.length}</div>
          </div>
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Novos na última verificação</div>
            <div className="mt-2 text-2xl font-bold text-foreground">{status?.lastRunResult?.novosProdutos ?? 0}</div>
          </div>
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Chatwoot</div>
            <div className="mt-2 text-sm font-semibold text-foreground">
              {status?.lastRunResult?.enviadoChatwoot ? "Notificação enviada" : "Sem envio recente"}
            </div>
          </div>
        </div>

        {/* Messages */}
        {message && <p className="mb-4 text-sm text-emerald-600 dark:text-emerald-400">{message}</p>}
        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
        {status?.lastRunError && !error && (
          <p className="mb-4 text-sm text-destructive">Último erro: {status.lastRunError}</p>
        )}

        {/* Table */}
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Código</th>
                  <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Produto</th>
                  <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Tipo</th>
                  <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Primeira movimentação</th>
                  <th className="px-4 py-3 text-right text-[10px] uppercase tracking-widest text-muted-foreground">Quantidade</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                    </td>
                  </tr>
                ) : products.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      Nenhum produto com primeira movimentação encontrado no mês atual.
                    </td>
                  </tr>
                ) : (
                  products.map((item) => (
                    <tr key={`${item.codigo}-${item.primeiraMovimentacao}`} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-3 font-mono text-xs text-foreground">{item.codigo}</td>
                      <td className="px-4 py-3 text-foreground">{item.nome}</td>
                      <td className="px-4 py-3 text-muted-foreground">{item.tipo}</td>
                      <td className="px-4 py-3 text-muted-foreground">{new Date(item.primeiraMovimentacao).toLocaleDateString("pt-BR")}</td>
                      <td className="px-4 py-3 text-right text-foreground">{item.quantidade.toLocaleString("pt-BR")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
