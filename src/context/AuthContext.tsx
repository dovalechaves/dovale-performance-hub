import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { Role, Permission, hasPermission, resolveRole, ROLE_LABELS, HubRole, HUB_ROLE_LABELS } from "@/lib/rbac";

interface AuthUser {
  usuario: string;
  displayName: string;
  role: Role;
  roleLabel: string;
  hubRole: HubRole;
  hubRoleLabel: string;
  token: string;
  loja?: string | null;
  canAccessHub: boolean;
  canAccessDashboard: boolean;
  apps: {
    dashboard: {
      canAccess: boolean;
      role: Role;
      loja: string | null;
    };
    calculadora: {
      canAccess: boolean;
      role: Role;
      loja: string | null;
    };
    disparo: {
      canAccess: boolean;
      role: Role;
      loja: string | null;
    };
    fechamento: {
      canAccess: boolean;
      role: Role;
      loja: string | null;
    };
    assistente: {
      canAccess: boolean;
      role: Role;
      loja: string | null;
    };
    multipreco: {
      canAccess: boolean;
      role: Role;
      loja: string | null;
    };
    inventario: {
      canAccess: boolean;
      role: Role;
      loja: string | null;
    };
    onboarding: {
      canAccess: boolean;
      role: Role;
      loja: string | null;
    };
    score: {
      canAccess: boolean;
      role: Role;
      loja: string | null;
    };
    cobranca: {
      canAccess: boolean;
      role: Role;
      loja: string | null;
    };
    ecommercedisparo: {
      canAccess: boolean;
      role: Role;
      loja: string | null;
    };
    sugestaocompras: {
      canAccess: boolean;
      role: Role;
      loja: string | null;
    };
    salescompass: {
      canAccess: boolean;
      role: Role;
      loja: string | null;
      usu_codigo_sistema?: number | null; // rep_codigo do vendedor
    };
    painelcomissao: {
      canAccess: boolean;
      role: Role;
      loja: string | null;
      config?: { setores: string[]; nome_vendedor: string | null } | null;
    };
  };
}

interface AuthContextValue {
  user: AuthUser | null;
  can: (permission: Permission) => boolean;
  refreshUser: () => Promise<void>;
  login: (
    usuario: string,
    displayName: string | undefined,
    token: string,
    apiRole?: string,
    loja?: string | null,
    canAccessDashboard?: boolean,
    canAccessHub?: boolean,
    apps?: {
      dashboard?: { role?: string; loja?: string | null; can_access?: boolean };
      calculadora?: { role?: string; loja?: string | null; can_access?: boolean };
      disparo?: { role?: string; loja?: string | null; can_access?: boolean };
      fechamento?: { role?: string; loja?: string | null; can_access?: boolean };
      assistente?: { role?: string; loja?: string | null; can_access?: boolean };
      multipreco?: { role?: string; loja?: string | null; can_access?: boolean };
      inventario?: { role?: string; loja?: string | null; can_access?: boolean };
      onboarding?: { role?: string; loja?: string | null; can_access?: boolean };
      score?: { role?: string; loja?: string | null; can_access?: boolean };
      cobranca?: { role?: string; loja?: string | null; can_access?: boolean };
      ecommercedisparo?: { role?: string; loja?: string | null; can_access?: boolean };
      sugestaocompras?: { role?: string; loja?: string | null; can_access?: boolean };
      salescompass?: { role?: string; loja?: string | null; can_access?: boolean; usu_codigo_sistema?: number | null };
      painelcomissao?: { role?: string; loja?: string | null; can_access?: boolean; config?: { setores: string[]; nome_vendedor: string | null } | null };
    },
    hubRole?: string
  ) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function resolveHubRole(raw?: string): HubRole {
  if (raw === "admin" || raw === "viewer") return raw;
  return "viewer";
}

function buildUser(
  usuario: string,
  displayName: string | undefined,
  token: string,
  apiRole?: string,
  loja?: string | null,
  canAccessDashboard = true,
  canAccessHub = true,
  apiApps?: {
    dashboard?: { role?: string; loja?: string | null; can_access?: boolean };
    calculadora?: { role?: string; loja?: string | null; can_access?: boolean };
    disparo?: { role?: string; loja?: string | null; can_access?: boolean };
    fechamento?: { role?: string; loja?: string | null; can_access?: boolean };
    assistente?: { role?: string; loja?: string | null; can_access?: boolean };
    multipreco?: { role?: string; loja?: string | null; can_access?: boolean };
    inventario?: { role?: string; loja?: string | null; can_access?: boolean };
    onboarding?: { role?: string; loja?: string | null; can_access?: boolean };
    score?: { role?: string; loja?: string | null; can_access?: boolean };
    cobranca?: { role?: string; loja?: string | null; can_access?: boolean };
    ecommercedisparo?: { role?: string; loja?: string | null; can_access?: boolean };
    sugestaocompras?: { role?: string; loja?: string | null; can_access?: boolean };
    salescompass?: { role?: string; loja?: string | null; can_access?: boolean; usu_codigo_sistema?: number | null };
    painelcomissao?: { role?: string; loja?: string | null; can_access?: boolean; config?: { setores: string[]; nome_vendedor: string | null } | null };
  },
  apiHubRole?: string
): AuthUser {
  const hubRole = resolveHubRole(apiHubRole);
  const dashboardRole = resolveRole(usuario, apiApps?.dashboard?.role ?? apiRole);
  const dashboardLoja = apiApps?.dashboard?.loja ?? loja ?? null;
  const dashboardAccess = apiApps?.dashboard?.can_access ?? canAccessDashboard;
  const calculadoraRole = resolveRole(usuario, apiApps?.calculadora?.role ?? apiRole);
  const calculadoraAccess = apiApps?.calculadora?.can_access ?? (dashboardRole !== "viewer");
  const calculadoraLoja = apiApps?.calculadora?.loja ?? (calculadoraRole === "manager" ? "fast" : null);
  const disparoRole = resolveRole(usuario, apiApps?.disparo?.role ?? apiRole);
  const disparoAccess = apiApps?.disparo?.can_access ?? false;
  const fechamentoRole = resolveRole(usuario, apiApps?.fechamento?.role ?? apiRole);
  const fechamentoAccess = apiApps?.fechamento?.can_access ?? false;
  const fechamentoLoja = apiApps?.fechamento?.loja ?? (fechamentoRole === "manager" ? (loja ?? null) : null);
  const assistenteRole = resolveRole(usuario, apiApps?.assistente?.role ?? apiRole);
  const assistenteAccess = apiApps?.assistente?.can_access ?? false;
  const multiprecoRole = resolveRole(usuario, apiApps?.multipreco?.role ?? apiRole);
  const multiprecoAccess = apiApps?.multipreco?.can_access ?? false;
  const inventarioRole = resolveRole(usuario, apiApps?.inventario?.role ?? apiRole);
  const inventarioAccess = apiApps?.inventario?.can_access ?? false;
  const inventarioLoja = apiApps?.inventario?.loja ?? null;
  const onboardingRole = resolveRole(usuario, apiApps?.onboarding?.role ?? apiRole);
  const onboardingAccess = apiApps?.onboarding?.can_access ?? false;
  const scoreRole = resolveRole(usuario, apiApps?.score?.role ?? apiRole);
  const scoreAccess = apiApps?.score?.can_access ?? false;
  const cobrancaRole = resolveRole(usuario, apiApps?.cobranca?.role ?? apiRole);
  const cobrancaAccess = apiApps?.cobranca?.can_access ?? false;
  const ecommerceDisparoRole = resolveRole(usuario, apiApps?.ecommercedisparo?.role ?? apiRole);
  const ecommerceDisparoAccess = apiApps?.ecommercedisparo?.can_access ?? false;
  const sugestaoComprasRole = resolveRole(usuario, apiApps?.sugestaocompras?.role ?? apiRole);
  const sugestaoComprasAccess = apiApps?.sugestaocompras?.can_access ?? false;
  const salescompassRole = resolveRole(usuario, apiApps?.salescompass?.role ?? apiRole);
  const salescompassAccess = apiApps?.salescompass?.can_access ?? false;
  const salescompassLoja = apiApps?.salescompass?.loja ?? null;
  const salescompassRepCodigo = apiApps?.salescompass?.usu_codigo_sistema ?? null;
  const painelcomissaoRole = resolveRole(usuario, apiApps?.painelcomissao?.role ?? apiRole);
  const painelcomissaoAccess = apiApps?.painelcomissao?.can_access ?? false;
  const painelcomissaoConfig = apiApps?.painelcomissao?.config ?? null;

  return {
    usuario,
    displayName: displayName?.trim() ? displayName : usuario,
    role: dashboardRole,
    roleLabel: ROLE_LABELS[dashboardRole],
    hubRole,
    hubRoleLabel: HUB_ROLE_LABELS[hubRole],
    token,
    loja: dashboardLoja,
    canAccessHub,
    canAccessDashboard: dashboardAccess,
    apps: {
      dashboard: {
        canAccess: dashboardAccess,
        role: dashboardRole,
        loja: dashboardLoja,
      },
      calculadora: {
        canAccess: calculadoraAccess,
        role: calculadoraRole,
        loja: calculadoraLoja,
      },
      disparo: {
        canAccess: disparoAccess,
        role: disparoRole,
        loja: null,
      },
      fechamento: {
        canAccess: fechamentoAccess,
        role: fechamentoRole,
        loja: fechamentoLoja,
      },
      assistente: {
        canAccess: assistenteAccess,
        role: assistenteRole,
        loja: null,
      },
      multipreco: {
        canAccess: multiprecoAccess,
        role: multiprecoRole,
        loja: null,
      },
      inventario: {
        canAccess: inventarioAccess,
        role: inventarioRole,
        loja: inventarioLoja,
      },
      onboarding: {
        canAccess: onboardingAccess,
        role: onboardingRole,
        loja: null,
      },
      score: {
        canAccess: scoreAccess,
        role: scoreRole,
        loja: null,
      },
      cobranca: {
        canAccess: cobrancaAccess,
        role: cobrancaRole,
        loja: null,
      },
      ecommercedisparo: {
        canAccess: ecommerceDisparoAccess,
        role: ecommerceDisparoRole,
        loja: null,
      },
      sugestaocompras: {
        canAccess: sugestaoComprasAccess,
        role: sugestaoComprasRole,
        loja: null,
      },
      salescompass: {
        canAccess: salescompassAccess,
        role: salescompassRole,
        loja: salescompassLoja,
        usu_codigo_sistema: salescompassRepCodigo,
      },
      painelcomissao: {
        canAccess: painelcomissaoAccess,
        role: painelcomissaoRole,
        loja: null,
        config: painelcomissaoConfig,
      },
    },
  };
}

function loadFromStorage(): AuthUser | null {
  const raw = localStorage.getItem("dovale_auth");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AuthUser>;
    if (!parsed.usuario || !parsed.token || !parsed.role) return null;
    const dashboardRole = parsed.apps?.dashboard?.role ?? parsed.role;
    const canAccessHub = parsed.canAccessHub ?? true;
    const canAccessDashboard = parsed.apps?.dashboard?.canAccess ?? parsed.canAccessDashboard ?? true;
    const dashboardLoja = parsed.apps?.dashboard?.loja ?? parsed.loja ?? null;
    const hubRole = resolveHubRole((parsed as any).hubRole);
    const calculadoraRole = parsed.apps?.calculadora?.role ?? parsed.role;
    const calculadoraAccess = parsed.apps?.calculadora?.canAccess ?? (dashboardRole !== "viewer");
    const disparoRole = parsed.apps?.disparo?.role ?? parsed.role;
    const disparoAccess = parsed.apps?.disparo?.canAccess ?? false;
    const fechamentoRole = (parsed.apps as any)?.fechamento?.role ?? parsed.role;
    const fechamentoAccess = (parsed.apps as any)?.fechamento?.canAccess ?? false;
    const fechamentoLoja = (parsed.apps as any)?.fechamento?.loja ?? null;
    const assistenteRole = (parsed.apps as any)?.assistente?.role ?? parsed.role;
    const assistenteAccess = (parsed.apps as any)?.assistente?.canAccess ?? false;
    const multiprecoRole = (parsed.apps as any)?.multipreco?.role ?? parsed.role;
    const multiprecoAccess = (parsed.apps as any)?.multipreco?.canAccess ?? false;
    const inventarioRole = (parsed.apps as any)?.inventario?.role ?? parsed.role;
    const inventarioAccess = (parsed.apps as any)?.inventario?.canAccess ?? false;
    const inventarioLoja = (parsed.apps as any)?.inventario?.loja ?? null;
    const onboardingRole = (parsed.apps as any)?.onboarding?.role ?? parsed.role;
    const onboardingAccess = (parsed.apps as any)?.onboarding?.canAccess ?? false;
    const scoreRole = (parsed.apps as any)?.score?.role ?? parsed.role;
    const scoreAccess = (parsed.apps as any)?.score?.canAccess ?? false;
    const cobrancaRole = (parsed.apps as any)?.cobranca?.role ?? parsed.role;
    const cobrancaAccess = (parsed.apps as any)?.cobranca?.canAccess ?? false;
    const ecommerceDisparoRole = (parsed.apps as any)?.ecommercedisparo?.role ?? parsed.role;
    const ecommerceDisparoAccess = (parsed.apps as any)?.ecommercedisparo?.canAccess ?? false;
    const sugestaoComprasRole = (parsed.apps as any)?.sugestaocompras?.role ?? parsed.role;
    const sugestaoComprasAccess = (parsed.apps as any)?.sugestaocompras?.canAccess ?? false;
    const salescompassRole = (parsed.apps as any)?.salescompass?.role ?? parsed.role;
    const salescompassAccess = (parsed.apps as any)?.salescompass?.canAccess ?? false;
    const salescompassLoja = (parsed.apps as any)?.salescompass?.loja ?? null;
    const salescompassRepCodigo = (parsed.apps as any)?.salescompass?.usu_codigo_sistema ?? null;
    const painelcomissaoRole = (parsed.apps as any)?.painelcomissao?.role ?? parsed.role;
    const painelcomissaoAccess = (parsed.apps as any)?.painelcomissao?.canAccess ?? false;
    const painelcomissaoConfig = (parsed.apps as any)?.painelcomissao?.config ?? null;

    return {
      usuario: parsed.usuario,
      displayName: parsed.displayName?.trim() ? parsed.displayName : parsed.usuario,
      token: parsed.token,
      role: dashboardRole,
      roleLabel: ROLE_LABELS[dashboardRole],
      hubRole,
      hubRoleLabel: HUB_ROLE_LABELS[hubRole],
      loja: dashboardLoja,
      canAccessHub: parsed.canAccessHub ?? true,
      canAccessDashboard: canAccessDashboard,
      apps: {
        dashboard: {
          canAccess: canAccessDashboard,
          role: dashboardRole,
          loja: dashboardLoja,
        },
        calculadora: {
          canAccess: calculadoraAccess,
          role: calculadoraRole,
          loja: null,
        },
        disparo: {
          canAccess: disparoAccess,
          role: disparoRole,
          loja: null,
        },
        fechamento: {
          canAccess: fechamentoAccess,
          role: fechamentoRole,
          loja: fechamentoLoja,
        },
        assistente: {
          canAccess: assistenteAccess,
          role: assistenteRole,
          loja: null,
        },
        multipreco: {
          canAccess: multiprecoAccess,
          role: multiprecoRole,
          loja: null,
        },
        inventario: {
          canAccess: inventarioAccess,
          role: inventarioRole,
          loja: inventarioLoja,
        },
        onboarding: {
          canAccess: onboardingAccess,
          role: onboardingRole,
          loja: null,
        },
        score: {
          canAccess: scoreAccess,
          role: scoreRole,
          loja: null,
        },
        cobranca: {
          canAccess: cobrancaAccess,
          role: cobrancaRole,
          loja: null,
        },
        ecommercedisparo: {
          canAccess: ecommerceDisparoAccess,
          role: ecommerceDisparoRole,
          loja: null,
        },
        sugestaocompras: {
          canAccess: sugestaoComprasAccess,
          role: sugestaoComprasRole,
          loja: null,
        },
        salescompass: {
          canAccess: salescompassAccess,
          role: salescompassRole,
          loja: salescompassLoja,
          usu_codigo_sistema: salescompassRepCodigo,
        },
        painelcomissao: {
          canAccess: painelcomissaoAccess,
          role: painelcomissaoRole,
          loja: null,
          config: painelcomissaoConfig,
        },
      },
    };
  } catch {
    return null;
  }
}

const API_BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:3001/api").replace(/\/$/, "");

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(loadFromStorage);

  const refreshUser = useCallback(async () => {
    const stored = loadFromStorage();
    if (!stored?.usuario || !stored?.token) return;
    try {
      const r = await fetch(`${API_BASE}/auth/me?usuario=${encodeURIComponent(stored.usuario)}`);
      const data = r.ok ? await r.json() : null;
      if (!data?.apps) return;
      const refreshed = buildUser(
        stored.usuario,
        stored.displayName,
        stored.token,
        data.role,
        data.loja,
        data.can_access_dashboard,
        data.can_access_hub,
        data.apps,
        data.hub_role
      );
      localStorage.setItem("dovale_auth", JSON.stringify(refreshed));
      setUser(refreshed);
    } catch { /* silent fail — keep cached data */ }
  }, []);

  // Silently refresh permissions from DB on every page load
  useEffect(() => { refreshUser(); }, []);

  const login = useCallback((
    usuario: string,
    displayName: string | undefined,
    token: string,
    apiRole?: string,
    loja?: string | null,
    canAccessDashboard = true,
    canAccessHub = true,
    apps?: {
      dashboard?: { role?: string; loja?: string | null; can_access?: boolean };
      calculadora?: { role?: string; loja?: string | null; can_access?: boolean };
      disparo?: { role?: string; loja?: string | null; can_access?: boolean };
      fechamento?: { role?: string; loja?: string | null; can_access?: boolean };
      assistente?: { role?: string; loja?: string | null; can_access?: boolean };
      multipreco?: { role?: string; loja?: string | null; can_access?: boolean };
      inventario?: { role?: string; loja?: string | null; can_access?: boolean };
      onboarding?: { role?: string; loja?: string | null; can_access?: boolean };
      score?: { role?: string; loja?: string | null; can_access?: boolean };
      cobranca?: { role?: string; loja?: string | null; can_access?: boolean };
      ecommercedisparo?: { role?: string; loja?: string | null; can_access?: boolean };
      sugestaocompras?: { role?: string; loja?: string | null; can_access?: boolean };
      salescompass?: { role?: string; loja?: string | null; can_access?: boolean; usu_codigo_sistema?: number | null };
      painelcomissao?: { role?: string; loja?: string | null; can_access?: boolean; config?: { setores: string[]; nome_vendedor: string | null } | null };
    },
    hubRole?: string
  ) => {
    const authUser = buildUser(usuario, displayName, token, apiRole, loja, canAccessDashboard, canAccessHub, apps, hubRole);
    localStorage.setItem("dovale_auth", JSON.stringify(authUser));
    setUser(authUser);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("dovale_auth");
    localStorage.removeItem("dovale_token");
    localStorage.removeItem("disparo_token");
    localStorage.removeItem("disparo_usuario");
    setUser(null);
  }, []);

  const can = useCallback(
    (permission: Permission) => (user ? hasPermission(user.role, permission) : false),
    [user]
  );

  return (
    <AuthContext.Provider value={{ user, can, refreshUser, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
