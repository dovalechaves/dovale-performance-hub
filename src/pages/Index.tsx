import { useState, useEffect, useRef } from "react";
import { AnimatePresence } from "framer-motion";
import { SellerCard } from "@/components/SellerCard";
import { StatsBar } from "@/components/StatsBar";
import { useCelebration } from "@/hooks/useCelebration";
import { MOCK_SELLERS, Seller } from "@/data/sellers";
import { Key, Zap, Moon, Sun } from "lucide-react";

const Index = () => {
  const [sellers, setSellers] = useState<Seller[]>(MOCK_SELLERS);
  const [dark, setDark] = useState(true);
  const { celebrate } = useCelebration();
  const prevGoalsRef = useRef<Set<string>>(new Set(MOCK_SELLERS.filter(s => s.sales >= s.goal).map(s => s.id)));

  // Apply dark class
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const sorted = [...sellers].sort((a, b) => (b.sales / b.goal) - (a.sales / a.goal));

  // Simulate live data
  useEffect(() => {
    const interval = setInterval(() => {
      setSellers((prev) =>
        prev.map((s) => ({
          ...s,
          sales: Math.max(0, s.sales + Math.floor(Math.random() * 3000 - 500)),
        }))
      );
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Detect new goals reached
  useEffect(() => {
    const currentGoals = new Set(sellers.filter(s => s.sales >= s.goal).map(s => s.id));
    const newGoals = [...currentGoals].filter(id => !prevGoalsRef.current.has(id));
    if (newGoals.length > 0) celebrate();
    prevGoalsRef.current = currentGoals;
  }, [sellers, celebrate]);

  return (
    <div className="min-h-screen bg-background scanline">
      {/* Header */}
      <header className="border-b border-border bg-gradient-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center">
              <Key className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">DOVALE</h1>
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Painel de Vendas</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
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
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="container mx-auto px-4 py-6 space-y-6">
        <StatsBar sellers={sellers} />

        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">Classificação por Meta</h2>
          <div className="flex-1 h-px bg-border" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          <AnimatePresence mode="popLayout">
            {sorted.map((seller, i) => (
              <SellerCard key={seller.id} seller={seller} rank={i + 1} />
            ))}
          </AnimatePresence>
        </div>
      </main>

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
