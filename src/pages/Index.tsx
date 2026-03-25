import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { SellerCard } from "@/components/SellerCard";
import { StatsBar } from "@/components/StatsBar";
import { useCelebration } from "@/hooks/useCelebration";
import { Seller } from "@/data/sellers";
import { Zap, Moon, Sun, LogOut, Settings, RefreshCw, ChevronDown } from "lucide-react";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";
import { useAuth } from "@/context/AuthContext";
import { getVendas, getMetas, LOJAS } from "@/services/api";

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutos

function initials(name: string) {
  return name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

const Index = () => {
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [dark, setDark] = useState(true);
  const [loja, setLoja] = useState("bh");
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [showCelebrationMascot, setShowCelebrationMascot] = useState(false);
  const { celebrate } = useCelebration();
  const prevGoalsRef = useRef<Set<string>>(new Set());
  const celebrationAudioRef = useRef<HTMLAudioElement | null>(null);

  const handleLogout = () => { logout(); navigate("/login"); };

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const now = new Date();
      const mes = now.getMonth() + 1;
      const ano = now.getFullYear();

      const [vendas, metas] = await Promise.all([
        getVendas(loja, mes, ano),
        getMetas(loja, mes, ano),
      ]);

      const metasMap = Object.fromEntries(metas.map(m => [m.rep_codigo, m.meta_valor]));

      const data: Seller[] = vendas.map(v => ({
        id: String(v.rep_codigo),
        name: v.rep_nome,
        category: LOJAS.find(l => l.value === loja)?.label ?? loja.toUpperCase(),
        sales: v.total_vendas,
        goal: metasMap[v.rep_codigo] ?? 0,
        goalReached: v.total_vendas >= (metasMap[v.rep_codigo] ?? 1),
        avatar: initials(v.rep_nome),
      }));

      setSellers(data);
      setLastUpdate(new Date());
    } catch (err) {
      console.error("[dashboard] erro ao carregar dados:", err);
    } finally {
      setLoading(false);
    }
  }, [loja]);

  // Carrega ao montar e quando muda a loja
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh a cada 5 minutos
  useEffect(() => {
    const interval = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Detecta novas metas batidas
  useEffect(() => {
    if (sellers.length === 0) return;
    const current = new Set(sellers.filter(s => s.sales >= s.goal && s.goal > 0).map(s => s.id));
    const newGoals = [...current].filter(id => !prevGoalsRef.current.has(id));
    if (newGoals.length > 0 && prevGoalsRef.current.size > 0) {
      celebrate();
      setShowCelebrationMascot(true);
      setTimeout(() => setShowCelebrationMascot(false), 3000);
      const audio = new Audio("/aiaiaiaiai.mp3");
      celebrationAudioRef.current = audio;
      audio.play().catch(() => {});
      setTimeout(() => { audio.pause(); audio.currentTime = 0; }, 3000);
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
            <div className="relative h-9 w-36 overflow-hidden">
              <img src={logoBlue} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ease-in-out ${dark ? 'opacity-0 scale-90 blur-sm rotate-3' : 'opacity-100 scale-100 blur-0 rotate-0'}`} />
              <img src={logoWhite} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ease-in-out ${dark ? 'opacity-100 scale-100 blur-0 rotate-0' : 'opacity-0 scale-90 blur-sm -rotate-3'}`} />
            </div>
            <div className="h-6 w-px bg-border" />
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-medium">Painel de Vendas</p>

            {/* Seletor de loja — só admin/manager */}
            {can("read:all") && (
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
        {can("view:stats") && <StatsBar sellers={sellers} canViewTotalSales={can("view:totalSales")} />}

        {can("view:classification") && (
          <>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">
                Classificação por Meta
              </h2>
              <div className="flex-1 h-px bg-border" />
              {loading && <span className="text-[10px] text-muted-foreground animate-pulse">carregando...</span>}
            </div>

            {sellers.length === 0 && !loading ? (
              <div className="text-center py-16 text-muted-foreground text-sm">
                Nenhum dado encontrado para esta loja.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <AnimatePresence mode="popLayout">
                  {sorted.map((seller, i) => (
                    <SellerCard key={seller.id} seller={seller} rank={i + 1} />
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
