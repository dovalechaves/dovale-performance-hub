import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Sun, Moon, Settings } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { getCalcRole, type CalcRole } from "@/lib/calc-roles";
import MarketplaceCalculator from "@/components/MarketplaceCalculator";
import ProductsTable from "@/components/ProductsTable";
import GerenciamentoCalc from "@/components/GerenciamentoCalc";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";

type Tab = "calculadora" | "produtos";
type CalcTab = "loja" | "industria";

export default function Calculadora() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("calculadora");
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");
  const [showGerenciamento, setShowGerenciamento] = useState(false);

  const isAdmin = user?.role === "admin";
  const userCalcRole: CalcRole = isAdmin ? "industria" : getCalcRole(user?.usuario ?? "");
  const [calcTab, setCalcTab] = useState<CalcTab>(userCalcRole);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <div className="min-h-screen bg-background">
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
          <nav className="flex gap-1 flex-1">
            <button
              onClick={() => setTab("calculadora")}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-widest transition-colors ${
                tab === "calculadora"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              Calculadora
            </button>
            <button
              onClick={() => setTab("produtos")}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-widest transition-colors ${
                tab === "produtos"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              Produtos
            </button>
          </nav>

          <div className="flex items-center gap-2 ml-auto">
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
                onClick={() => setShowGerenciamento(true)}
                className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary hover:text-primary-foreground transition-colors"
                title="Gerenciamento"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-10">
        {tab === "calculadora" ? (
          <>
            {/* Tabs Loja / Indústria — admin vê ambas */}
            {isAdmin && (
              <div className="flex gap-1 mb-8">
                <button
                  onClick={() => setCalcTab("loja")}
                  className={`px-5 py-2 rounded-lg text-xs font-semibold uppercase tracking-widest transition-colors ${
                    calcTab === "loja"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                >
                  Loja
                </button>
                <button
                  onClick={() => setCalcTab("industria")}
                  className={`px-5 py-2 rounded-lg text-xs font-semibold uppercase tracking-widest transition-colors ${
                    calcTab === "industria"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                >
                  Indústria
                </button>
              </div>
            )}

            {/* Renderiza calculadora conforme calcRole */}
            {(() => {
              const activeCalc = isAdmin ? calcTab : userCalcRole;
              if (activeCalc === "loja") {
                return (
                  <div className="flex items-center justify-center min-h-[40vh]">
                    <div className="text-center space-y-3">
                      <p className="text-4xl">🏪</p>
                      <p className="text-base font-semibold text-foreground">Calculadora Loja</p>
                      <p className="text-sm text-muted-foreground">Em desenvolvimento. Em breve disponível.</p>
                    </div>
                  </div>
                );
              }
              return <MarketplaceCalculator />;
            })()}
          </>
        ) : (
          <ProductsTable />
        )}
      </main>

      {showGerenciamento && (
        <GerenciamentoCalc onClose={() => setShowGerenciamento(false)} />
      )}
    </div>
  );
}
