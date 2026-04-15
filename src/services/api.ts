export const API_BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:3001/api").replace(/\/$/, "");

const BASE = API_BASE;

export interface Representante {
  rep_codigo: string;
  rep_nome: string;
}

export interface Meta {
  id?: number;
  rep_codigo: string;
  rep_nome: string;
  loja: string;
  meta_valor: number;
  dias_uteis?: number | null;
  mes: number;
  ano: number;
}

export const LOJAS = [
  { value: "bh", label: "Belo Horizonte" },
  { value: "l2", label: "Santana" },
  { value: "l3", label: "Rio de Janeiro" },
  { value: "campinas", label: "Campinas" },
];

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Erro ${res.status}`);
  }
  return res.json();
}

export interface VendaConsolidada {
  rep_codigo: string;
  rep_nome: string;
  total_vendas: number;
}

export interface AuthManagedUser {
  usuario: string;
  displayname: string;
  department: string;
  can_access_hub: boolean;
  role: "admin" | "manager" | "viewer";
  loja: string | null;
  can_access_dashboard: boolean;
  apps: {
    dashboard: {
      app_key: "dashboard";
      role: "admin" | "manager" | "viewer";
      loja: string | null;
      can_access: boolean;
    };
    calculadora: {
      app_key: "calculadora";
      role: "admin" | "manager" | "viewer";
      loja: string | null;
      can_access: boolean;
    };
    disparo: {
      app_key: "disparo";
      role: "admin" | "manager" | "viewer";
      loja: string | null;
      can_access: boolean;
    };
    fechamento: {
      app_key: "fechamento";
      role: "admin" | "manager" | "viewer";
      loja: string | null;
      can_access: boolean;
    };
    assistente: {
      app_key: "assistente";
      role: "admin" | "manager" | "viewer";
      loja: string | null;
      can_access: boolean;
    };
    multipreco: {
      app_key: "multipreco";
      role: "admin" | "manager" | "viewer";
      loja: string | null;
      can_access: boolean;
    };
    inventario: {
      app_key: "inventario";
      role: "admin" | "manager" | "viewer";
      loja: string | null;
      can_access: boolean;
      usu_codigo_sistema?: number | null;
    };
    onboarding: {
      app_key: "onboarding";
      role: "admin" | "manager" | "viewer";
      loja: string | null;
      can_access: boolean;
    };
  };
}

export async function getRepresentantes(loja: string): Promise<Representante[]> {
  const res = await fetch(`${BASE}/representantes?loja=${loja}`);
  return handleResponse<Representante[]>(res);
}

export async function getVendas(loja: string, mes: number, ano: number): Promise<VendaConsolidada[]> {
  const res = await fetch(`${BASE}/sync/vendas?loja=${loja}&mes=${mes}&ano=${ano}`);
  return handleResponse<VendaConsolidada[]>(res);
}

export async function getVendasHoje(loja: string): Promise<VendaConsolidada[]> {
  const res = await fetch(`${BASE}/sync/vendas-hoje?loja=${loja}`);
  return handleResponse<VendaConsolidada[]>(res);
}

export async function getMetas(loja: string, mes: number, ano: number): Promise<Meta[]> {
  const res = await fetch(`${BASE}/metas?loja=${loja}&mes=${mes}&ano=${ano}`);
  return handleResponse<Meta[]>(res);
}

export async function saveMeta(meta: Omit<Meta, "id">): Promise<void> {
  const res = await fetch(`${BASE}/metas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(meta),
  });
  return handleResponse<void>(res);
}

export async function saveDiasUteis(loja: string, mes: number, ano: number, dias_uteis: number): Promise<void> {
  const res = await fetch(`${BASE}/metas/dias-uteis`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loja, mes, ano, dias_uteis }),
  });
  return handleResponse<void>(res);
}

export async function deleteMeta(id: number): Promise<void> {
  const res = await fetch(`${BASE}/metas/${id}`, { method: "DELETE" });
  return handleResponse<void>(res);
}

export async function getAuthUsers(actorUsuario: string): Promise<AuthManagedUser[]> {
  const res = await fetch(`${BASE}/auth/users?actor_usuario=${encodeURIComponent(actorUsuario)}`);
  return handleResponse<AuthManagedUser[]>(res);
}

export async function updateAuthUserRole(params: {
  actor_usuario: string;
  usuario: string;
  can_access_hub: boolean;
  apps: AuthManagedUser["apps"];
}): Promise<void> {
  const res = await fetch(`${BASE}/auth/role`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return handleResponse<void>(res);
}
