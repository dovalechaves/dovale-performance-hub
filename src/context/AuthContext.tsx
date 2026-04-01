import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { Role, Permission, hasPermission, resolveRole, ROLE_LABELS } from "@/lib/rbac";

interface AuthUser {
  usuario: string;
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
  };
}

interface AuthContextValue {
  user: AuthUser | null;
  can: (permission: Permission) => boolean;
  login: (
    usuario: string,
    token: string,
    apiRole?: string,
    loja?: string | null,
    canAccessDashboard?: boolean,
    canAccessHub?: boolean,
    apps?: {
      dashboard?: { role?: string; loja?: string | null; can_access?: boolean };
      calculadora?: { role?: string; loja?: string | null; can_access?: boolean };
    }
  ) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function buildUser(
  usuario: string,
  token: string,
  apiRole?: string,
  loja?: string | null,
  canAccessDashboard = true,
  canAccessHub = true,
  apiApps?: {
    dashboard?: { role?: string; loja?: string | null; can_access?: boolean };
    calculadora?: { role?: string; loja?: string | null; can_access?: boolean };
  }
): AuthUser {
  const dashboardRole = resolveRole(usuario, apiApps?.dashboard?.role ?? apiRole);
  const dashboardLoja = apiApps?.dashboard?.loja ?? loja ?? null;
  const dashboardAccess = apiApps?.dashboard?.can_access ?? canAccessDashboard;
  const calculadoraRole = resolveRole(usuario, apiApps?.calculadora?.role ?? apiRole);
  const calculadoraAccess = apiApps?.calculadora?.can_access ?? (dashboardRole !== "viewer");

  return {
    usuario,
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

    return {
      usuario: parsed.usuario,
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
      },
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(loadFromStorage);

  const login = useCallback((
    usuario: string,
    token: string,
    apiRole?: string,
    loja?: string | null,
    canAccessDashboard = true,
    canAccessHub = true,
    apps?: {
      dashboard?: { role?: string; loja?: string | null; can_access?: boolean };
      calculadora?: { role?: string; loja?: string | null; can_access?: boolean };
    }
  ) => {
    const authUser = buildUser(usuario, token, apiRole, loja, canAccessDashboard, canAccessHub, apps);
    localStorage.setItem("dovale_auth", JSON.stringify(authUser));
    setUser(authUser);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("dovale_auth");
    localStorage.removeItem("dovale_token");
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
