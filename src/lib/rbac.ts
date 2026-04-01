export type Permission =
  | "read:all"
  | "write:all"
  | "write:own"
  | "delete"
  | "manage:users"
  | "manage:roles"
  | "manage:metas"
  | "view:totalSales"
  | "view:salesValues"
  | "view:stats"
  | "view:classification";

export type Role = "admin" | "manager" | "viewer";

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    "read:all",
    "write:all",
    "delete",
    "manage:users",
    "manage:roles",
    "manage:metas",
    "view:totalSales",
    "view:salesValues",
    "view:stats",
    "view:classification",
  ],
  manager: [
    "read:all",
    "write:own",
    "manage:metas",
    "view:stats",
    "view:classification",
  ],
  viewer: [
    "view:stats",
    "view:classification",
  ],
};

export const ROLE_LABELS: Record<Role, string> = {
  admin:   "Administrador",
  manager: "Gerente",
  viewer:  "Visualizador",
};

/** Usuários com roles fixas */
export const STATIC_USER_ROLES: Record<string, Role> = {
  "gerente.teste":    "manager",
};

export function resolveRole(usuario: string, apiRole?: string): Role {
  const valid: Role[] = ["admin", "manager", "viewer"];
  if (apiRole && valid.includes(apiRole as Role)) return apiRole as Role;
  if (STATIC_USER_ROLES[usuario]) return STATIC_USER_ROLES[usuario];
  return "viewer";
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
