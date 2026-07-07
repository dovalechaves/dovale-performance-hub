import { getPool } from '../../db/sqlserver';
import sql from 'mssql';

export type Cargo = 'ADM' | 'GESTOR' | 'VENDEDOR';

export interface ComissaoUsuario {
  usuario: string;
  nome: string;
  cargo: Cargo;
  setores: string[];
  nome_vendedor: string | null;
}

const APP_KEY = 'painelcomissao';

function titleCase(usuario: string): string {
  return usuario
    .replace(/[._]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function parseConfig(raw: unknown): { setores: string[]; nome_vendedor: string | null } {
  let obj: Record<string, unknown> = {};
  if (typeof raw === 'string' && raw.trim()) {
    try { obj = JSON.parse(raw) as Record<string, unknown>; } catch { obj = {}; }
  } else if (raw && typeof raw === 'object') {
    obj = raw as Record<string, unknown>;
  }
  const setores = Array.isArray(obj.setores)
    ? obj.setores.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const nome_vendedor = obj.nome_vendedor != null && String(obj.nome_vendedor).trim()
    ? String(obj.nome_vendedor).trim()
    : null;
  return { setores, nome_vendedor };
}

function isEnabled(v: unknown): boolean {
  return v === true || v === 1 || v === '1';
}

// Cache de usuário por 60 segundos
const _cache = new Map<string, { usuario: ComissaoUsuario | null; exp: number }>();

// Resolve o usuário do Painel de Comissões a partir das tabelas do Hub
// (USUARIOS_LOJAS + USUARIOS_APPS). Aceita "kevin.silva" ou "kevin.silva@dovale.com.br".
export async function getComissaoUsuario(usuarioOrEmail: string): Promise<ComissaoUsuario | null> {
  const usuario = String(usuarioOrEmail || '').split('@')[0].trim().toLowerCase();
  if (!usuario) return null;

  const cached = _cache.get(usuario);
  if (cached && cached.exp > Date.now()) return cached.usuario;

  const pool = await getPool();

  const lojaRes = await pool.request()
    .input('usuario', sql.VarChar, usuario)
    .query('SELECT ativo, hub_role FROM USUARIOS_LOJAS WHERE LOWER(usuario) = @usuario');
  const loja = lojaRes.recordset[0];
  const canAccessHub = isEnabled(loja?.ativo);

  const appRes = await pool.request()
    .input('usuario', sql.VarChar, usuario)
    .input('app_key', sql.VarChar, APP_KEY)
    .query('SELECT role, ativo, config FROM USUARIOS_APPS WHERE LOWER(usuario) = @usuario AND app_key = @app_key');
  const app = appRes.recordset[0];

  const appRole = String(app?.role ?? '').toLowerCase();

  if (!canAccessHub || !isEnabled(app?.ativo)) {
    _cache.set(usuario, { usuario: null, exp: Date.now() + 10_000 });
    return null;
  }

  const cargo: Cargo =
    appRole === 'admin' ? 'ADM'
    : appRole === 'manager' ? 'GESTOR'
    : 'VENDEDOR';

  const { setores, nome_vendedor } = parseConfig(app?.config);

  const result: ComissaoUsuario = {
    usuario,
    nome: titleCase(usuario),
    cargo,
    setores,
    nome_vendedor,
  };

  _cache.set(usuario, { usuario: result, exp: Date.now() + 60_000 });
  return result;
}

export function podeVerTudo(cargo: Cargo): boolean {
  return cargo === 'ADM';
}

export function isADM(cargo: Cargo): boolean {
  return cargo === 'ADM';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildSetorFilter(request: any, setores: string[], where: string): string {
  if (!setores.length) return where;
  const placeholders = setores
    .map((s, i) => {
      request.input(`setor_perm_${i}`, sql.VarChar, s);
      return `@setor_perm_${i}`;
    })
    .join(', ');
  return `${where} AND RVS_NOME IN (${placeholders})`;
}
