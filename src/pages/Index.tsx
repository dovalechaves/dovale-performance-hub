import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { SellerCard } from "@/components/SellerCard";
import { SellerDetailModal } from "@/components/SellerDetailModal";
import { StatsBar } from "@/components/StatsBar";
import { useCelebration } from "@/hooks/useCelebration";
import { Seller } from "@/data/sellers";
import { Zap, Moon, Sun, LogOut, Settings, RefreshCw, ChevronDown, Monitor, EyeOff, ArrowLeft } from "lucide-react";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";
import { useAuth } from "@/context/AuthContext";
import { getRepresentantes, getVendas, getVendasHoje, getMetas, LOJAS } from "@/services/api";

const REFRESH_INTERVAL = 60 * 1000; // 1 minuto

function initials(name: string) {
  return name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

function normalizeRepCode(code: string | number | null | undefined) {
  const raw = String(code ?? "").trim();
  if (!raw) return "";
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? String(numeric) : raw.toLowerCase();
}

function normalizeName(name: string | null | undefined) {
  return String(name ?? "").trim().toUpperCase();
}

function cleanRepName(name: string | null | undefined) {
  return String(name ?? "")
    .replace(/\bLOJA\s+RIO\s+PRETO\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function playGoalReachedChime() {
  if (typeof window === "undefined") return;

  const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;

  const ctx = new AudioContextClass();
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99];

  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;

    const start = now + i * 0.09;
    const end = start + 0.22;

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(end);
  });

  setTimeout(() => {
    void ctx.close().catch(() => {});
  }, 800);
}

const Index = () => {
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");
  const [loja, setLoja] = useState(() => user?.loja ?? "bh");
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [showCelebrationMascot, setShowCelebrationMascot] = useState(false);
  const [selectedSeller, setSelectedSeller] = useState<Seller | null>(null);
  const [tvMode, setTvMode] = useState(true); // gerente: padrão oculto (modo TV)
  const [modoVista, setModoVista] = useState<"mensal" | "diario">("diario");
  const [mesSelecionado, setMesSelecionado] = useState(() => new Date().getMonth() + 1);
  const { celebrate } = useCelebration();
  const prevGoalsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const handleLogout = () => { logout(); navigate("/login"); };

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const now = new Date();
      const mes = loja === "riopreto" ? mesSelecionado : now.getMonth() + 1;
      const ano = loja === "riopreto" ? 2026 : now.getFullYear();

      const [vendas, metas, representantes] = await Promise.all([
        modoVista === "diario" ? getVendasHoje(loja) : getVendas(loja, mes, ano),
        getMetas(loja, mes, ano),
        getRepresentantes(loja),
      ]);

      const metasMap = new Map(metas.map((m) => [normalizeRepCode(m.rep_codigo), m.meta_valor]));
      const diasUteisMap = new Map(metas.map((m) => [normalizeRepCode(m.rep_codigo), m.dias_uteis ?? null]));
      const vendasMap = new Map(vendas.map((v) => [normalizeRepCode(v.rep_codigo), v]));
      const vendasByName = new Map(vendas.map((v) => [normalizeName(v.rep_nome), v]));

      const data: Seller[] = representantes.map((rep) => {
        const repCode = normalizeRepCode(rep.rep_codigo);
        const venda = vendasMap.get(repCode) ?? vendasByName.get(normalizeName(rep.rep_nome));
        const sales = venda?.total_vendas ?? 0;
        const metaMensal = metasMap.get(repCode) ?? 0;
        const diasUteis = diasUteisMap.get(repCode);
        const goal = modoVista === "diario" && diasUteis && diasUteis > 0
          ? metaMensal / diasUteis
          : metaMensal;

        return {
          id: repCode,
          name: cleanRepName(rep.rep_nome),
          category: LOJAS.find(l => l.value === loja)?.label ?? loja.toUpperCase(),
          origem: venda?.origem ?? rep.origem,
          detalhes: venda?.detalhes,
          sales,
          goal,
          goalReached: goal > 0 && sales >= goal,
          avatar: initials(cleanRepName(rep.rep_nome) || rep.rep_nome),
        };
      });

      setSellers(data);
      setLastUpdate(new Date());
    } catch (err) {
      console.error("[dashboard] erro ao carregar dados:", err);
    } finally {
      setLoading(false);
    }
  }, [loja, modoVista, mesSelecionado]);

  // Reseta referência ao trocar modo ou loja — evita celebração falsa na troca
  useEffect(() => {
    initializedRef.current = false;
    prevGoalsRef.current = new Set();
  }, [modoVista, loja, mesSelecionado]);

  // Carrega ao montar e quando muda a loja ou modo
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh a cada 5 minutos
  useEffect(() => {
    const interval = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Detecta novas metas batidas — só anima quando um vendedor cruza 100% entre dois fetches
  useEffect(() => {
    if (sellers.length === 0) return;
    const current = new Set(sellers.filter(s => s.sales >= s.goal && s.goal > 0).map(s => s.id));

    if (!initializedRef.current) {
      // Primeira carga: apenas registra quem já está em 100%, sem animar
      initializedRef.current = true;
      prevGoalsRef.current = current;
      return;
    }

    const newGoals = [...current].filter(id => !prevGoalsRef.current.has(id));
    if (newGoals.length > 0) {
      celebrate();
      setShowCelebrationMascot(true);
      setTimeout(() => setShowCelebrationMascot(false), 3000);
      playGoalReachedChime();
    }
    prevGoalsRef.current = current;
  }, [sellers, celebrate]);

  const sorted = [...sellers].sort((a, b) => {
    if (a.goal === 0 && b.goal === 0) return b.sales - a.sales;
    if (a.goal === 0) return 1;
    if (b.goal === 0) return -1;
    return (b.sales / b.goal) - (a.sales / a.goal);
  });

  return (
    <div className="min-h-screen bg-background scanline">
      {/* Header */}
      <header className="border-b border-border bg-gradient-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/hub")}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
              title="Voltar ao Hub"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="h-6 w-px bg-border" />
            <button
              onClick={() => navigate("/hub")}
              className="relative h-9 w-36 overflow-hidden"
              title="Ir para o Hub"
            >
              <img src={logoBlue} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ease-in-out ${dark ? 'opacity-0 scale-90 blur-sm rotate-3' : 'opacity-100 scale-100 blur-0 rotate-0'}`} />
              <img src={logoWhite} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ease-in-out ${dark ? 'opacity-100 scale-100 blur-0 rotate-0' : 'opacity-0 scale-90 blur-sm -rotate-3'}`} />
            </button>
            <div className="h-6 w-px bg-border" />
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground dark:text-slate-300 font-medium">Painel de Vendas</p>

            {/* Seletor de loja — só admin/manager */}
            {user?.role === "admin" && (
              <div className="relative ml-2">
                <select
                  value={loja}
                  onChange={e => setLoja(e.target.value)}
                  className="appearance-none rounded-lg border border-border bg-muted pl-3 pr-7 py-1.5 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {LOJAS.map(l => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
              </div>
            )}

            {/* Seletor de mês — só riopreto */}
            {loja === "riopreto" && (
              <div className="relative ml-2">
                <select
                  value={mesSelecionado}
                  onChange={e => setMesSelecionado(Number(e.target.value))}
                  className="appearance-none rounded-lg border border-border bg-muted pl-3 pr-7 py-1.5 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                    <option key={m} value={m}>
                      {new Date(2026, m - 1).toLocaleString("pt-BR", { month: "long" }).replace(/^\w/, c => c.toUpperCase())} 2026
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Última atualização */}
            {lastUpdate && (
              <span className="hidden sm:block text-[10px] text-muted-foreground font-mono">
                {lastUpdate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}

            {user && (
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs font-semibold text-foreground leading-tight">{user.usuario}</span>
                <span className="text-[10px] uppercase tracking-widest text-primary">{user.roleLabel}</span>
              </div>
            )}

            <button
              onClick={fetchData}
              disabled={loading}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors disabled:opacity-40"
              title="Atualizar"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>

            {user?.role === "manager" && (
              <button
                onClick={() => setTvMode(v => !v)}
                title={tvMode ? "Revelar valores (visão gerente)" : "Ocultar valores (modo TV)"}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors
                  ${tvMode
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:bg-primary/10 hover:text-primary"
                  }`}
              >
                {tvMode ? <EyeOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
              </button>
            )}

            {(can("manage:metas") || can("manage:roles")) && (
              <button
                onClick={() => navigate("/gestao")}
                className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary hover:text-primary-foreground transition-colors"
                title="Gerenciamento"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={() => setDark(!dark)}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-foreground hover:bg-primary hover:text-primary-foreground transition-colors"
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Zap className="w-3 h-3 text-primary animate-pulse" />
              <span className="font-mono">LIVE</span>
            </div>

            <button
              onClick={handleLogout}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:bg-destructive hover:text-white transition-colors"
              title="Sair"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="container mx-auto px-4 py-6 space-y-6">
        {can("view:stats") && <StatsBar sellers={sellers} canViewTotalSales={user?.role === "manager" ? !tvMode : can("view:totalSales")} />}

        {can("view:classification") && (
          <>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">
                Classificação por Meta
              </h2>
              <div className="flex-1 h-px bg-border" />
              {loading && <span className="text-[10px] text-muted-foreground animate-pulse">carregando...</span>}
              {/* Toggle Mensal / Hoje */}
              <div className="flex rounded-lg border border-border overflow-hidden text-[11px] font-semibold">
                <button
                  onClick={() => setModoVista("mensal")}
                  className={`px-3 py-1 transition-colors ${modoVista === "mensal" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                >
                  Mensal
                </button>
                <button
                  onClick={() => setModoVista("diario")}
                  className={`px-3 py-1 transition-colors ${modoVista === "diario" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                >
                  Hoje
                </button>
              </div>
            </div>

            {sellers.length === 0 && !loading ? (
              <div className="text-center py-16 text-muted-foreground text-sm">
                Nenhum dado encontrado para esta loja.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <AnimatePresence mode="popLayout">
                  {sorted.map((seller, i) => (
                    <SellerCard
                      key={seller.id}
                      seller={seller}
                      rank={i + 1}
                      showValues={user?.role === "manager" ? !tvMode : can("view:salesValues")}
                      loja={loja}
                      onClick={() => setSelectedSeller(seller)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </>
        )}
      </main>

      {/* Celebration mascot overlay */}
      <AnimatePresence>
        {showCelebrationMascot && (
          <motion.div
            initial={{ opacity: 0, scale: 0, y: 100 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0, y: 100 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
          >
            <img src="/image-removebg-preview%20%283%29.png" alt="mascot celebration" className="w-40 h-auto drop-shadow-2xl" />
          </motion.div>
        )}
      </AnimatePresence>

      <SellerDetailModal seller={selectedSeller} onClose={() => setSelectedSeller(null)} />

      <footer className="border-t border-border mt-12">
        <div className="container mx-auto px-4 py-4 text-center">
          <p className="text-xs text-muted-foreground">
            Dovale — Tradição que abraça a modernidade · +30 anos no mercado de chaves e ferragens
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
