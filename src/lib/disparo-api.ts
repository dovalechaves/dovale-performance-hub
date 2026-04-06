const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

function getToken(): string | null {
  return localStorage.getItem("disparo_token");
}

async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export interface DisparoUsuario {
  nome: string;
  email: string;
  departamento: string;
  escritorio: string;
}

export async function login(usuario: string, senha: string): Promise<{ token: string; usuario: DisparoUsuario }> {
  const r = await fetch(`${API_BASE}/api/disparo/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario, senha }),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.erro ?? "Falha no login");
  localStorage.setItem("disparo_token", json.token);
  localStorage.setItem("disparo_usuario", JSON.stringify(json.usuario));
  return json;
}

export function logout() {
  localStorage.removeItem("disparo_token");
  localStorage.removeItem("disparo_usuario");
}

export function getUsuarioSalvo(): DisparoUsuario | null {
  const s = localStorage.getItem("disparo_usuario");
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

export async function exchangeHubToken(usuario: string, displayName: string): Promise<{ token: string; usuario: DisparoUsuario }> {
  const r = await fetch(`${API_BASE}/api/disparo/auth/hub-exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario, displayName }),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.erro ?? "Falha ao obter token do disparo");
  localStorage.setItem("disparo_token", json.token);
  localStorage.setItem("disparo_usuario", JSON.stringify(json.usuario));
  return json;
}

// ── Upload ───────────────────────────────────────────────────────────────────

export async function uploadContatos(file: File): Promise<{ lista_id: number; total: number }> {
  const form = new FormData();
  form.append("file", file);
  const r = await authFetch(`${API_BASE}/api/disparo/upload`, { method: "POST", body: form });
  const json = await r.json();
  if (!r.ok) throw new Error(json.erro ?? "Falha no upload");
  return json;
}

export async function uploadMidia(file: File): Promise<{ media_url: string }> {
  const form = new FormData();
  form.append("file", file);
  const r = await authFetch(`${API_BASE}/api/disparo/upload-midia`, { method: "POST", body: form });
  const json = await r.json();
  if (!r.ok) throw new Error(json.erro ?? "Falha no upload de mídia");
  return json;
}

// ── Templates ────────────────────────────────────────────────────────────────

export interface TemplateMeta {
  id: string;
  name: string;
  language_code: string;
  header_format: string;
  requires_media: boolean;
  header_text_params_count: number;
  body_params_count: number;
}

export async function fetchTemplates(): Promise<TemplateMeta[]> {
  const r = await authFetch(`${API_BASE}/api/disparo/templates`);
  const json = await r.json();
  if (!r.ok) throw new Error(json.erro ?? "Falha ao buscar templates");
  return json;
}

export interface TemplateGerenciar {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  header_format: string;
  body_preview: string;
}

export async function fetchTemplatesGerenciar(): Promise<TemplateGerenciar[]> {
  const r = await authFetch(`${API_BASE}/api/disparo/templates/gerenciar`);
  const json = await r.json();
  if (!r.ok) throw new Error(json.erro ?? "Falha ao buscar templates");
  return json;
}

export async function fetchTemplateDetalhe(name: string, language_code: string) {
  const params = new URLSearchParams({ name, language_code });
  const r = await authFetch(`${API_BASE}/api/disparo/templates/detalhe?${params}`);
  const json = await r.json();
  if (!r.ok) throw new Error(json.erro ?? "Falha ao buscar detalhe do template");
  return json;
}

export async function criarTemplate(payload: Record<string, unknown>) {
  const r = await authFetch(`${API_BASE}/api/disparo/templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.erro ?? "Falha ao criar template");
  return json;
}

// ── Etiquetas ────────────────────────────────────────────────────────────────

export async function fetchEtiquetasChatwoot(): Promise<string[]> {
  const r = await authFetch(`${API_BASE}/api/disparo/chatwoot/etiquetas`);
  return r.ok ? r.json() : [];
}

export async function fetchTemplateEtiquetas(): Promise<Record<string, string>> {
  const r = await authFetch(`${API_BASE}/api/disparo/template-etiquetas`);
  return r.ok ? r.json() : {};
}

export async function salvarTemplateEtiquetas(map: Record<string, string>) {
  await authFetch(`${API_BASE}/api/disparo/template-etiquetas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(map),
  });
}

// ── Disparo ──────────────────────────────────────────────────────────────────

export interface DisparoConfig {
  lista_id: number;
  template_nome: string;
  inbox_id?: number;
  configuracao?: Record<string, unknown>;
}

export async function iniciarDisparo(cfg: DisparoConfig) {
  const r = await authFetch(`${API_BASE}/api/disparo/disparar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfg),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.erro ?? "Falha ao iniciar disparo");
  return json;
}

export async function fetchDisparoAtivo() {
  const r = await authFetch(`${API_BASE}/api/disparo/disparos/ativo`);
  return r.json();
}

export async function fetchAprovacao(disparoId: number) {
  const r = await authFetch(`${API_BASE}/api/disparo/disparos/${disparoId}/aprovacao`);
  return r.json();
}

export async function fetchLogs(disparoId: number) {
  const r = await authFetch(`${API_BASE}/api/disparo/disparos/${disparoId}/logs`);
  return r.json();
}

export async function aprovarDisparo(disparoId: number, acao: "aprovar" | "negar" = "aprovar") {
  const r = await authFetch(`${API_BASE}/api/disparo/disparos/${disparoId}/aprovar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acao }),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.erro ?? "Falha na aprovação");
  return json;
}

export async function cancelarDisparo(disparoId: number) {
  const r = await authFetch(`${API_BASE}/api/disparo/disparos/${disparoId}/cancelar`, { method: "POST" });
  return r.json();
}

export async function pausarDisparo(disparoId: number) {
  const r = await authFetch(`${API_BASE}/api/disparo/disparos/${disparoId}/pausar`, { method: "POST" });
  return r.json();
}

export async function retomarDisparo(disparoId: number) {
  const r = await authFetch(`${API_BASE}/api/disparo/disparos/${disparoId}/retomar`, { method: "POST" });
  return r.json();
}

// ── Socket URL ───────────────────────────────────────────────────────────────

export function getSocketUrl(): string {
  return API_BASE;
}
