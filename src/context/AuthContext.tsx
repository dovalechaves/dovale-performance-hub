import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { Role, Permission, hasPermission, resolveRole, ROLE_LABELS } from "@/lib/rbac";

interface AuthUser {
  usuario: string;
  displayName: string;
  role: Role;
  roleLabel: string;
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
  };
}

interface AuthContextValue {
  user: AuthUser | null;
  can: (permission: Permission) => boolean;
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
    }
  ) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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
  }
): AuthUser {
  const dashboardRole = resolveRole(usuario, apiApps?.dashboard?.role ?? apiRole);
  const dashboardLoja = apiApps?.dashboard?.loja ?? loja ?? null;
  const dashboardAccess = apiApps?.dashboard?.can_access ?? canAccessDashboard;
  const calculadoraRole = resolveRole(usuario, apiApps?.calculadora?.role ?? apiRole);
  const calculadoraAccess = apiApps?.calculadora?.can_access ?? (dashboardRole !== "viewer");
  const disparoRole = resolveRole(usuario, apiApps?.disparo?.role ?? apiRole);
  const disparoAccess = apiApps?.disparo?.can_access ?? false;
  const fechamentoRole = resolveRole(usuario, apiApps?.fechamento?.role ?? apiRole);
  const fechamentoAccess = apiApps?.fechamento?.can_access ?? false;
  const fechamentoLoja = apiApps?.fechamento?.loja ?? (fechamentoRole === "manager" ? (loja ?? null) : null);
  const assistenteRole = resolveRole(usuario, apiApps?.assistente?.role ?? apiRole);
  const assistenteAccess = apiApps?.assistente?.can_access ?? false;

  return {
    usuario,
    displayName: displayName?.trim() ? displayName : usuario,
    role: dashboardRole,
    roleLabel: ROLE_LABELS[dashboardRole],
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
    const dashboardAccess = parsed.apps?.dashboard?.canAccess ?? parsed.canAccessDashboard ?? true;
    const dashboardLoja = parsed.apps?.dashboard?.loja ?? parsed.loja ?? null;
    const calculadoraRole = parsed.apps?.calculadora?.role ?? parsed.role;
    const calculadoraAccess = parsed.apps?.calculadora?.canAccess ?? (dashboardRole !== "viewer");
    const disparoRole = parsed.apps?.disparo?.role ?? parsed.role;
    const disparoAccess = parsed.apps?.disparo?.canAccess ?? false;
    const fechamentoRole = (parsed.apps as any)?.fechamento?.role ?? parsed.role;
    const fechamentoAccess = (parsed.apps as any)?.fechamento?.canAccess ?? false;
    const fechamentoLoja = (parsed.apps as any)?.fechamento?.loja ?? null;
    const assistenteRole = (parsed.apps as any)?.assistente?.role ?? parsed.role;
    const assistenteAccess = (parsed.apps as any)?.assistente?.canAccess ?? false;

    return {
      usuario: parsed.usuario,
      displayName: parsed.displayName?.trim() ? parsed.displayName : parsed.usuario,
      token: parsed.token,
      role: dashboardRole,
      roleLabel: ROLE_LABELS[dashboardRole],
      loja: dashboardLoja,
      canAccessHub: parsed.canAccessHub ?? true,
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
      },
    };
  } catch {
    return null;
  }
}

const API_BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:3001/api").replace(/\/$/, "");

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(loadFromStorage);

  // Silently refresh permissions from DB on every page load
  useEffect(() => {
    const stored = loadFromStorage();
    if (!stored?.usuario || !stored?.token) return;
    fetch(`${API_BASE}/auth/me?usuario=${encodeURIComponent(stored.usuario)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.apps) return;
        const refreshed = buildUser(
          stored.usuario,
          stored.displayName,
          stored.token,
          data.role,
          data.loja,
          data.can_access_dashboard,
          data.can_access_hub,
          data.apps
        );
        localStorage.setItem("dovale_auth", JSON.stringify(refreshed));
        setUser(refreshed);
      })
      .catch(() => { /* silent fail — keep cached data */ });
  }, []);

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
    }
  ) => {
    const authUser = buildUser(usuario, displayName, token, apiRole, loja, canAccessDashboard, canAccessHub, apps);
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
    <AuthContext.Provider value={{ user, can, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
