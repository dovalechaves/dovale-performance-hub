import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { BarChart3, Calculator, LogOut, Sun, Moon } from "lucide-react";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";

interface AppCard {
  title: string;
  description: string;
  icon: React.ReactNode;
  route: string;
  roles: string[];
  color: string;
}

const APPS: AppCard[] = [
  {
    title: "Painel de Vendas",
    description: "Acompanhe o desempenho dos vendedores e gerencie metas em tempo real.",
    icon: <BarChart3 className="w-8 h-8" />,
    route: "/dashboard",
    roles: ["admin", "manager", "viewer"],
    color: "from-blue-500/20 to-blue-600/10 border-blue-500/30 hover:border-blue-500/60",
  },
  {
    title: "Calculadora de Marketplace",
    description: "Simule preços, taxas e margem de lucro para Mercado Livre, Shopee e mais.",
    icon: <Calculator className="w-8 h-8" />,
    route: "/calculadora",
    roles: ["admin", "manager"],
    color: "from-green-500/20 to-green-600/10 border-green-500/30 hover:border-green-500/60",
  },
];

export default function Hub() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  const visibleApps = APPS.filter((app) => user && app.roles.includes(user.role));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-gradient-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative h-9 w-36 overflow-hidden">
              <img src={logoBlue} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ease-in-out ${dark ? 'opacity-0 scale-90 blur-sm rotate-3' : 'opacity-100 scale-100 blur-0 rotate-0'}`} />
              <img src={logoWhite} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ease-in-out ${dark ? 'opacity-100 scale-100 blur-0 rotate-0' : 'opacity-0 scale-90 blur-sm -rotate-3'}`} />
            </div>
            <div className="h-5 w-px bg-border" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-medium">
              Hub
            </span>
          </div>

          <div className="flex items-center gap-3">
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
            <button
              onClick={() => { logout(); navigate("/login"); }}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
              title="Sair"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-12">
        <div className="mb-10">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            Olá, {user?.usuario.split(".")[0]}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Selecione uma ferramenta para começar.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
          {visibleApps.map((app) => (
            <button
              key={app.route}
              onClick={() => navigate(app.route)}
              className={`text-left p-6 rounded-2xl border bg-gradient-to-br ${app.color} transition-all duration-200 hover:scale-[1.02] hover:shadow-lg group`}
            >
              <div className="text-primary mb-4 group-hover:scale-110 transition-transform duration-200">
                {app.icon}
              </div>
              <h2 className="font-semibold text-foreground text-base mb-1">{app.title}</h2>
              <p className="text-muted-foreground text-sm leading-relaxed">{app.description}</p>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
