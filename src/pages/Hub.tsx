import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { LogOut, Sun, Moon, Settings2 } from "lucide-react";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";
import { API_BASE } from "@/services/api";
import { APPS, APP_BY_ROUTE, type AppCard } from "./hub/appsConfig";
import UserManagement from "./hub/UserManagement";

export default function Hub() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");
  const [managementOpen, setManagementOpen] = useState(false);
  const [openingPainel, setOpeningPainel] = useState(false);
  const [estoqueMinimoCount, setEstoqueMinimoCount] = useState(0);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    if (!user?.apps.estoqueminimo?.canAccess) return;
    fetch(`${API_BASE}/estoque-minimo/status`)
      .then((r) => r.json())
      .then((data: { count?: number }) => setEstoqueMinimoCount(data.count ?? 0))
      .catch(() => {});
  }, [user?.apps.estoqueminimo?.canAccess]);

  const isAdmin = user?.hubRole === "admin";
  const firstFromUser = user?.usuario.split(".")[0] ?? "";
  const firstFromDisplay = user?.displayName?.trim() ? user.displayName.trim().split(/\s+/)[0] : "";
  const displayLooksLikeLogin = !!user && firstFromDisplay.toLowerCase() === user.usuario.toLowerCase();
  const greetingBase = firstFromDisplay && !displayLooksLikeLogin ? firstFromDisplay : firstFromUser;
  const greetingName = greetingBase ? greetingBase.charAt(0).toUpperCase() + greetingBase.slice(1) : "usuário";

  const visibleApps = APPS.filter((app) => {
    if (!user) return false;
    const appKey = APP_BY_ROUTE[app.route];
    if (!appKey) return false;
    return user.apps[appKey].canAccess;
  });

  // Abre um app: interno via router; externo (Painel de Comissões) via SSO em nova aba
  const openApp = async (app: AppCard) => {
    if (!app.external) { navigate(app.route); return; }
    if (!user || openingPainel) return;
    setOpeningPainel(true);
    try {
      const r = await fetch(`${API_BASE}/auth/painel-comissao/sso?usuario=${encodeURIComponent(user.usuario)}`);
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      } else {
        alert(data.error || "Não foi possível abrir o Painel de Comissões.");
      }
    } catch {
      alert("Erro ao conectar ao Painel de Comissões.");
    } finally {
      setOpeningPainel(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-gradient-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/hub")}
              className="relative h-9 w-36 overflow-hidden"
              title="Ir para o Hub"
            >
              <img src={logoBlue} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ease-in-out ${dark ? 'opacity-0 scale-90 blur-sm rotate-3' : 'opacity-100 scale-100 blur-0 rotate-0'}`} />
              <img src={logoWhite} alt="Dovale" className={`absolute inset-0 h-full w-auto object-contain transition-all duration-700 ease-in-out ${dark ? 'opacity-100 scale-100 blur-0 rotate-0' : 'opacity-0 scale-90 blur-sm -rotate-3'}`} />
            </button>
            <div className="h-5 w-px bg-border" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-medium">
              Hub
            </span>
          </div>

          <div className="flex items-center gap-3">
            {user && (
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs font-semibold text-foreground leading-tight">{greetingName}</span>
                <span className="text-[10px] uppercase tracking-widest text-primary">Hub: {user.hubRoleLabel}</span>
              </div>
            )}
            {isAdmin && (
              <button
                onClick={() => setManagementOpen((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${managementOpen ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-primary/10"}`}
                title="Gerenciar usuários e acessos"
              >
                <Settings2 className="w-3.5 h-3.5" />
                Gerenciamento
              </button>
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
            Olá, {greetingName}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Selecione uma ferramenta para começar.</p>
        </div>

        {visibleApps.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {visibleApps.map((app) => (
              <button
                key={app.route}
                onClick={() => openApp(app)}
                className={`relative text-left p-6 rounded-2xl border bg-gradient-to-br ${app.color} transition-all duration-200 hover:scale-[1.02] hover:shadow-lg group`}
              >
                {app.route === "/estoque-minimo" && estoqueMinimoCount > 0 && (
                  <span className="absolute top-3 right-3 inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded-full bg-destructive text-destructive-foreground text-xs font-semibold">
                    {estoqueMinimoCount}
                  </span>
                )}
                <div className="text-primary mb-4 group-hover:scale-110 transition-transform duration-200">
                  {app.icon}
                </div>
                <h2 className="font-semibold text-foreground text-base mb-1">{app.title}</h2>
                <p className="text-muted-foreground text-sm leading-relaxed">{app.description}</p>
              </button>
            ))}
          </div>
        ) : (
          <div className="max-w-2xl rounded-2xl border border-border bg-muted/30 px-6 py-8">
            <h2 className="text-base font-semibold text-foreground mb-2">Nenhum app liberado para seu usuário</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Solicite ao administrador a liberação de acesso a pelo menos um app no gerenciamento do Hub.
            </p>
          </div>
        )}

        {isAdmin && managementOpen && <UserManagement />}
      </main>
    </div>
  );
}
