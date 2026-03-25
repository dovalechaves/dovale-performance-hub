import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { Role, Permission, hasPermission, resolveRole, ROLE_LABELS } from "@/lib/rbac";

interface AuthUser {
  usuario: string;
  role: Role;
  roleLabel: string;
  token: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  can: (permission: Permission) => boolean;
  login: (usuario: string, token: string, apiRole?: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function buildUser(usuario: string, token: string, apiRole?: string): AuthUser {
  const role = resolveRole(usuario, apiRole);
  return { usuario, role, roleLabel: ROLE_LABELS[role], token };
}

function loadFromStorage(): AuthUser | null {
  const raw = localStorage.getItem("dovale_auth");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(loadFromStorage);

  const login = useCallback((usuario: string, token: string, apiRole?: string) => {
    const authUser = buildUser(usuario, token, apiRole);
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
