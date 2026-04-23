import { useState, useEffect } from "react";
import { ArrowLeft, Search, ShieldCheck, DollarSign, Sun, Moon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { API_BASE } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import GaugeChart from "@/components/score/GaugeChart";
import ClientCards from "@/components/score/ClientCards";
import PurchaseHistory from "@/components/score/PurchaseHistory";
import ScoreAdjustments from "@/components/score/ScoreAdjustments";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";

type Purchase = {
  id: string;
  date: string;
  description: string;
  orderId: string | null;
  value: number;
  dueDate: string;
  paymentDate: string | null;
  paymentCode: string | null;
  paymentMethod: string;
  delayDays: number;
  status: "paid" | "pending" | "overdue";
};

type Client = {
  codigo: string;
  razaoSocial: string;
  cnpj: string;
  endereco: string;
  bairro: string;
  cep: string;
  limiteCredito: number;
  purchases: Purchase[];
};

type Adjustment = {
  reason: string;
  points: number;
  limiteChange: number;
};

type ScoreResponse = {
  client: Client;
  scoreResult: {
    score: number;
    limiteCredito: number;
    atrasoMedio: number;
    adjustments: Adjustment[];
  };
};

export default function Score() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");
  const [clientCode, setClientCode] = useState("");
  const [client, setClient] = useState<Client | null>(null);
  const [scoreResult, setScoreResult] = useState<ScoreResponse["scoreResult"] | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  const handleSearch = async () => {
    if (!clientCode.trim()) return;

    try {
      const response = await fetch(`${API_BASE}/score/clientes/${encodeURIComponent(clientCode.trim())}/score`);
      if (!response.ok) {
        toast.error("Cliente não encontrado no banco de dados.");
        setClient(null);
        setScoreResult(null);
        return;
      }

      const data: ScoreResponse = await response.json();
      setClient(data.client);
      setScoreResult(data.scoreResult);
    } catch {
      toast.error("Erro ao conectar com a API.");
    }
  };

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
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            <div>
              <h1 className="text-sm font-mono font-bold text-foreground tracking-tight">SCORE DE CRÉDITO</h1>
              <p className="text-[10px] font-mono text-muted-foreground">Gestão de Crédito & Análise de Score</p>
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
        <div className="container mx-auto max-w-7xl px-4 py-8 space-y-8">
        {/* Search Panel */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-xl p-6"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Código do Cliente
              </label>
              <Input
                placeholder="Ex: 1001, 2002, 3003"
                value={clientCode}
                onChange={(e) => setClientCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="bg-muted/50 border-border/50 font-mono text-foreground placeholder:text-muted-foreground/50 focus:ring-primary"
              />
            </div>
            <button onClick={handleSearch} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-600 transition-colors font-mono">
              <Search className="w-3.5 h-3.5" />
              Consultar
            </button>
          </div>
        </motion.div>

        <AnimatePresence mode="wait">
          {client && scoreResult && (
            <motion.div
              key={client.codigo}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-8"
            >
              {/* Client Info Cards */}
              <ClientCards client={client} />

              {/* Score & Credit Section */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                {/* Gauge */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.3 }}
                  className="glass-card rounded-xl p-6 flex flex-col items-center justify-center"
                >
                  <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Score de Crédito
                  </h3>
                  <GaugeChart score={scoreResult.score} />
                </motion.div>

                {/* Credit Summary */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.4 }}
                  className="glass-card rounded-xl p-6 space-y-6 lg:col-span-2"
                >
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Resumo de Crédito
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div className="rounded-lg bg-muted/40 p-4 space-y-1">
                      <span className="text-xs text-muted-foreground">Limite Original</span>
                      <p className="font-mono text-xl font-bold text-foreground">
                        R$ {client.limiteCredito.toLocaleString("pt-BR")}
                      </p>
                    </div>
                    <div className={`rounded-lg p-4 space-y-1 ${scoreResult.limiteCredito <= 0 || scoreResult.limiteCredito < client.limiteCredito ? "bg-destructive/10 border border-destructive/30 glow-risk" : "bg-success/10 border border-success/30 glow-success"}`}>
                      <span className="text-xs text-muted-foreground">Limite Ajustado</span>
                      <p className={`font-mono text-xl font-bold ${scoreResult.limiteCredito <= 0 || scoreResult.limiteCredito < client.limiteCredito ? "text-destructive" : "text-emerald-500"}`}>
                        R$ {scoreResult.limiteCredito.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-4 space-y-1">
                      <span className="text-xs text-muted-foreground">Total de Compras</span>
                      <p className="font-mono text-xl font-bold text-foreground">
                        {client.purchases.length}
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-4 space-y-1">
                      <span className="text-xs text-muted-foreground">Atraso Médio</span>
                      <p className="font-mono text-xl font-bold text-foreground">
                        {scoreResult.atrasoMedio} dias
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-4 space-y-1">
                      <span className="text-xs text-muted-foreground">Volume Total</span>
                      <p className="font-mono text-xl font-bold text-foreground flex items-center gap-1">
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                        {client.purchases
                          .reduce((s, p) => s + p.value, 0)
                          .toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>

                  {/* Adjustments inline */}
                  <ScoreAdjustments adjustments={scoreResult.adjustments} />
                </motion.div>
              </div>

              {/* Purchase History Table */}
              <PurchaseHistory purchases={client.purchases} />
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
