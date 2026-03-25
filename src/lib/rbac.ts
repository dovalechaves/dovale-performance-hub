export type Permission =
  | "read:all"
  | "write:all"
  | "write:own"
  | "delete"
  | "manage:users"
  | "manage:roles"
  | "manage:metas"
  | "view:totalSales"
  | "view:stats"
  | "view:classification";

export type Role = "admin" | "manager" | "editor" | "viewer";

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    "read:all",
    "write:all",
    "delete",
    "manage:users",
    "manage:roles",
    "manage:metas",
    "view:totalSales",
    "view:stats",
    "view:classification",
  ],
  manager: [
    "read:all",
    "write:own",
    "manage:users",
    "manage:metas",
    "view:totalSales",
    "view:stats",
    "view:classification",
  ],
  editor: [
    "read:all",
    "write:own",
    "view:totalSales",
    "view:stats",
    "view:classification",
  ],
  viewer: [
    "view:stats",
    "view:classification",
  ],
};

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  manager: "Gerente",
  editor: "Editor",
  viewer: "Visualizador",
};

/** Usuários com roles fixas (independente do que a API retorna) */
const STATIC_USER_ROLES: Record<string, Role> = {
  "kevin.silva": "admin",
};

export function resolveRole(usuario: string, apiRole?: string): Role {
  if (STATIC_USER_ROLES[usuario]) return STATIC_USER_ROLES[usuario];
  const valid: Role[] = ["admin", "manager", "editor", "viewer"];
  if (apiRole && valid.includes(apiRole as Role)) return apiRole as Role;
  return "viewer";
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
