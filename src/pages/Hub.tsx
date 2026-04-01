import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { BarChart3, Calculator, LogOut, Sun, Moon, Users, RefreshCw, Loader2, ChevronDown, Settings2 } from "lucide-react";
import logoBlue from "@/assets/logo-blue.png";
import logoWhite from "@/assets/logo-white.png";
import { LOJAS, getAuthUsers, updateAuthUserRole, type AuthManagedUser } from "@/services/api";
import { ROLE_LABELS, type Role } from "@/lib/rbac";

interface AppCard {
  title: string;
  description: string;
  icon: React.ReactNode;
  route: string;
  color: string;
}

const APPS: AppCard[] = [
  {
    title: "Painel de Vendas",
    description: "Acompanhe o desempenho dos vendedores e gerencie metas em tempo real.",
    icon: <BarChart3 className="w-8 h-8" />,
    route: "/dashboard",
    color: "from-blue-500/20 to-blue-600/10 border-blue-500/30 hover:border-blue-500/60",
  },
  {
    title: "Calculadora de Marketplace",
    description: "Simule preços, taxas e margem de lucro para Mercado Livre, Shopee e mais.",
    icon: <Calculator className="w-8 h-8" />,
    route: "/calculadora",
    color: "from-green-500/20 to-green-600/10 border-green-500/30 hover:border-green-500/60",
  },
];

const APP_BY_ROUTE: Record<string, keyof AuthManagedUser["apps"]> = {
  "/dashboard": "dashboard",
  "/calculadora": "calculadora",
};

export default function Hub() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [dark, setDark] = useState(() => localStorage.getItem("dovale_theme") !== "light");
  const [managedUsers, setManagedUsers] = useState<AuthManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [savingUser, setSavingUser] = useState<string | null>(null);
  const [savedUser, setSavedUser] = useState<string | null>(null);
  const [managementOpen, setManagementOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dovale_theme", dark ? "dark" : "light");
  }, [dark]);

  const isAdmin = user?.apps.dashboard.role === "admin";

  const visibleApps = APPS.filter((app) => {
    if (!user) return false;
    const appKey = APP_BY_ROUTE[app.route];
    if (!appKey) return false;
    return user.apps[appKey].canAccess;
  });

  const loadManagedUsers = useCallback(async () => {
    if (!user || user.apps.dashboard.role !== "admin") return;
    setUsersLoading(true);
    setUsersError("");
    try {
      const data = await getAuthUsers(user.usuario);
      setManagedUsers(data);
    } catch (e: unknown) {
      setUsersError(e instanceof Error ? e.message : "Erro ao carregar usuários");
    } finally {
      setUsersLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (managementOpen && user?.apps.dashboard.role === "admin") {
      loadManagedUsers();
    }
  }, [managementOpen, user?.apps.dashboard.role, loadManagedUsers]);

  const persistUser = async (next: AuthManagedUser) => {
    if (!user) return;
    setSavingUser(next.usuario);
    setUsersError("");
    try {
      await updateAuthUserRole({
        actor_usuario: user.usuario,
        usuario: next.usuario,
        can_access_hub: next.can_access_hub,
        apps: next.apps,
      });
      setSavedUser(next.usuario);
      setTimeout(() => setSavedUser(null), 2000);
    } catch (e: unknown) {
      setUsersError(e instanceof Error ? e.message : "Erro ao salvar usuário");
    } finally {
      setSavingUser(null);
    }
  };

  const updateManagedUser = (usuario: string, updater: (u: AuthManagedUser) => AuthManagedUser) => {
    setManagedUsers((prev) => prev.map((u) => (u.usuario === usuario ? updater(u) : u)));
  };

  const filteredManagedUsers = managedUsers.filter((u) => {
    const term = userSearch.trim().toLowerCase();
    if (!term) return true;
    return (
      u.usuario.toLowerCase().includes(term) ||
      u.displayname.toLowerCase().includes(term) ||
      u.department.toLowerCase().includes(term)
    );
  });

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
            Olá, {user?.usuario.split(".")[0]}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Selecione uma ferramenta para começar.</p>
        </div>

        {visibleApps.length > 0 ? (
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
        ) : (
          <div className="max-w-2xl rounded-2xl border border-border bg-muted/30 px-6 py-8">
            <h2 className="text-base font-semibold text-foreground mb-2">Nenhum app liberado para seu usuário</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Solicite ao administrador a liberação de acesso a pelo menos um app no gerenciamento do Hub.
            </p>
          </div>
        )}

        {isAdmin && managementOpen && (
          <section className="mt-12 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground">
                  Gerenciamento de Usuários e Apps
                </h2>
              </div>
              <button
                onClick={loadManagedUsers}
                disabled={usersLoading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors disabled:opacity-40"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${usersLoading ? "animate-spin" : ""}`} />
                Atualizar
              </button>
            </div>

            {usersError && <p className="text-xs text-destructive">{usersError}</p>}

            <div className="max-w-sm">
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Pesquisar por usuário, nome ou departamento"
                className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-sm min-w-[1200px]">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Usuário</th>
                    <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Nome</th>
                    <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Departamento</th>
                    <th className="px-4 py-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground">Acesso Hub</th>
                    <th className="px-4 py-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground">Painel</th>
                    <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Role Painel</th>
                    <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Loja Painel</th>
                    <th className="px-4 py-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground">Calculadora</th>
                    <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Role Calculadora</th>
                    <th className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {usersLoading ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                        <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                      </td>
                    </tr>
                  ) : filteredManagedUsers.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground text-xs">
                        Nenhum usuário encontrado para a busca informada.
                      </td>
                    </tr>
                  ) : (
                    filteredManagedUsers.map((u) => (
                      <tr key={u.usuario} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-foreground">{u.usuario}</td>
                        <td className="px-4 py-3 text-foreground">{u.displayname || "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{u.department || "—"}</td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={u.can_access_hub}
                            onChange={async (e) => {
                              const enabled = e.target.checked;
                              const next: AuthManagedUser = {
                                ...u,
                                can_access_hub: enabled,
                                apps: {
                                  dashboard: {
                                    ...u.apps.dashboard,
                                    can_access: enabled ? u.apps.dashboard.can_access : false,
                                  },
                                  calculadora: {
                                    ...u.apps.calculadora,
                                    can_access: enabled ? u.apps.calculadora.can_access : false,
                                  },
                                },
                                can_access_dashboard: enabled ? u.apps.dashboard.can_access : false,
                              };
                              updateManagedUser(u.usuario, () => next);
                              await persistUser(next);
                            }}
                            disabled={savingUser === u.usuario}
                            className="h-4 w-4 rounded border-border bg-muted text-primary focus:ring-primary/50 disabled:opacity-40"
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={u.apps.dashboard.can_access}
                            onChange={async (e) => {
                              const next: AuthManagedUser = {
                                ...u,
                                apps: {
                                  ...u.apps,
                                  dashboard: {
                                    ...u.apps.dashboard,
                                    can_access: e.target.checked,
                                  },
                                },
                                can_access_dashboard: e.target.checked,
                              };
                              updateManagedUser(u.usuario, () => next);
                              await persistUser(next);
                            }}
                            disabled={savingUser === u.usuario || !u.can_access_hub}
                            className="h-4 w-4 rounded border-border bg-muted text-primary focus:ring-primary/50 disabled:opacity-40"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="relative inline-block">
                            <select
                              value={u.apps.dashboard.role}
                              onChange={async (e) => {
                                const nextRole = e.target.value as Role;
                                const next: AuthManagedUser = {
                                  ...u,
                                  role: nextRole,
                                  loja: nextRole === "manager" ? (u.loja ?? "bh") : null,
                                  apps: {
                                    ...u.apps,
                                    dashboard: {
                                      ...u.apps.dashboard,
                                      role: nextRole,
                                      loja: nextRole === "manager" ? (u.apps.dashboard.loja ?? u.loja ?? "bh") : null,
                                    },
                                  },
                                };
                                updateManagedUser(u.usuario, () => next);
                                await persistUser(next);
                              }}
                              disabled={savingUser === u.usuario || !u.can_access_hub}
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
                          {u.apps.dashboard.role === "manager" ? (
                            <div className="relative inline-block">
                              <select
                                value={u.apps.dashboard.loja ?? "bh"}
                                onChange={async (e) => {
                                  const next: AuthManagedUser = {
                                    ...u,
                                    loja: e.target.value,
                                    apps: {
                                      ...u.apps,
                                      dashboard: {
                                        ...u.apps.dashboard,
                                        loja: e.target.value,
                                      },
                                    },
                                  };
                                  updateManagedUser(u.usuario, () => next);
                                  await persistUser(next);
                                }}
                                disabled={savingUser === u.usuario || !u.can_access_hub}
                                className="appearance-none rounded-lg border border-border bg-muted px-3 py-1.5 pr-7 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-40"
                              >
                                {LOJAS.map((l) => (
                                  <option key={l.value} value={l.value}>{l.label}</option>
                                ))}
                              </select>
                              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={u.apps.calculadora.can_access}
                            onChange={async (e) => {
                              const next: AuthManagedUser = {
                                ...u,
                                apps: {
                                  ...u.apps,
                                  calculadora: {
                                    ...u.apps.calculadora,
                                    can_access: e.target.checked,
                                  },
                                },
                              };
                              updateManagedUser(u.usuario, () => next);
                              await persistUser(next);
                            }}
                            disabled={savingUser === u.usuario || !u.can_access_hub}
                            className="h-4 w-4 rounded border-border bg-muted text-primary focus:ring-primary/50 disabled:opacity-40"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="relative inline-block">
                            <select
                              value={u.apps.calculadora.role}
                              onChange={async (e) => {
                                const nextRole = e.target.value as Role;
                                const next: AuthManagedUser = {
                                  ...u,
                                  apps: {
                                    ...u.apps,
                                    calculadora: {
                                      ...u.apps.calculadora,
                                      role: nextRole,
                                    },
                                  },
                                };
                                updateManagedUser(u.usuario, () => next);
                                await persistUser(next);
                              }}
                              disabled={savingUser === u.usuario || !u.can_access_hub}
                              className="appearance-none rounded-lg border border-border bg-muted px-3 py-1.5 pr-7 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-40"
                            >
                              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                              ))}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                          </div>
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
