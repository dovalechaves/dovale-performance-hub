import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { getPool } from "../db/sqlserver";

const router = Router();
const VALID_ROLES = ["admin", "manager", "viewer"] as const;
const VALID_HUB_ROLES = ["admin", "viewer"] as const;
const MANAGED_APPS = ["dashboard", "calculadora", "disparo", "fechamento", "assistente", "multipreco", "inventario", "onboarding", "score", "cobranca", "ecommercedisparo", "sugestaocompras", "salescompass", "painelcomissao"] as const;
const ECOMMERCE_DISPARO_ALLOWED = (process.env.ECOMMERCE_DISPARO_ALLOWED_USERS ?? "henrique.berbert,andreza")
  .split(",")
  .map((u) => u.trim().toLowerCase())
  .filter(Boolean);

function canAccessEcommerceDisparo(usuario: string, hubRole?: string): boolean {
  if (hubRole === "admin") return true;
  const normalized = String(usuario || "").trim().toLowerCase();
  if (!normalized) return false;
  return ECOMMERCE_DISPARO_ALLOWED.some((allowed) => normalized === allowed || normalized.includes(allowed));
}

type Role = typeof VALID_ROLES[number];
type HubRole = typeof VALID_HUB_ROLES[number];
type AppKey = typeof MANAGED_APPS[number];

function isRole(value: unknown): value is Role {
  return typeof value === "string" && VALID_ROLES.includes(value as Role);
}

function isHubRole(value: unknown): value is HubRole {
  return typeof value === "string" && VALID_HUB_ROLES.includes(value as HubRole);
}

function isAppKey(value: unknown): value is AppKey {
  return typeof value === "string" && MANAGED_APPS.includes(value as AppKey);
}

function isEnabledFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function toUsuario(adUser: any): string {
  return String(adUser?.samAccountName || adUser?.name || "").trim();
}

interface ManagedUser {
  usuario: string;
  displayname: string;
  department: string;
  can_access_hub: boolean;
  hub_role: HubRole;
  can_access_dashboard: boolean;
  role: Role;
  loja: string | null;
  apps: Record<AppKey, {
    app_key: AppKey;
    role: Role;
    loja: string | null;
    can_access: boolean;
    usu_codigo_sistema?: number | null;
    config?: PainelComissaoConfig | null;
  }>;
}

// Config específica do Painel de Comissões (armazenada em USUARIOS_APPS.config como JSON)
interface PainelComissaoConfig {
  setores: string[];         // setores do GESTOR (RVS_NOME). [] = todos (só faz sentido p/ admin)
  nome_vendedor: string | null; // nome canônico do VENDEDOR como aparece nas vendas
}

function parsePainelConfig(raw: unknown): PainelComissaoConfig {
  let obj: Record<string, unknown> = {};
  if (typeof raw === "string" && raw.trim()) {
    try { obj = JSON.parse(raw) as Record<string, unknown>; } catch { obj = {}; }
  } else if (raw && typeof raw === "object") {
    obj = raw as Record<string, unknown>;
  }
  const setores = Array.isArray(obj.setores)
    ? obj.setores.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const nomeVend = obj.nome_vendedor != null && String(obj.nome_vendedor).trim()
    ? String(obj.nome_vendedor).trim()
    : null;
  return { setores, nome_vendedor: nomeVend };
}

async function ensureAppsTable(pool: any): Promise<void> {
  await pool.request().query(`
    IF OBJECT_ID('dbo.USUARIOS_APPS', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.USUARIOS_APPS (
        id INT IDENTITY(1,1) PRIMARY KEY,
        usuario NVARCHAR(150) NOT NULL,
        app_key NVARCHAR(50) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'viewer',
        loja VARCHAR(20) NULL,
        ativo BIT NOT NULL DEFAULT 0,
        usu_codigo_sistema INT NULL,
        CONSTRAINT UQ_USUARIOS_APPS UNIQUE (usuario, app_key)
      );
    END

    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.USUARIOS_APPS') AND name = 'usu_codigo_sistema'
    )
    BEGIN
      ALTER TABLE dbo.USUARIOS_APPS ADD usu_codigo_sistema INT NULL;
    END

    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.USUARIOS_APPS') AND name = 'config'
    )
    BEGIN
      ALTER TABLE dbo.USUARIOS_APPS ADD config NVARCHAR(MAX) NULL;
    END

    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.USUARIOS_LOJAS') AND name = 'hub_role'
    )
    BEGIN
      ALTER TABLE dbo.USUARIOS_LOJAS ADD hub_role VARCHAR(20) NOT NULL DEFAULT 'viewer';
    END
  `);
}

function normalizeRoleForUser(usuario: string, candidate: unknown): Role {
  return isRole(candidate) ? candidate : "viewer";
}

function buildDefaultApps(usuario: string, localRole: unknown, localLoja: unknown, canAccessHub: boolean, hubRole?: string) {
  const baseRole = normalizeRoleForUser(usuario, localRole);
  const dashboardRole = baseRole;
  const dashboardLoja = dashboardRole === "manager" ? (localLoja ? String(localLoja) : "bh") : null;
  const calculadoraRole = baseRole;
  const calculadoraDefaultAccess = canAccessHub && baseRole !== "viewer";

  return {
    dashboard: {
      app_key: "dashboard" as AppKey,
      role: dashboardRole,
      loja: dashboardLoja,
      can_access: canAccessHub,
    },
    calculadora: {
      app_key: "calculadora" as AppKey,
      role: calculadoraRole,
      loja: null,
      can_access: calculadoraDefaultAccess,
    },
    disparo: {
      app_key: "disparo" as AppKey,
      role: baseRole,
      loja: null,
      can_access: false,
    },
    fechamento: {
      app_key: "fechamento" as AppKey,
      role: baseRole,
      loja: dashboardRole === "manager" ? dashboardLoja : null,
      can_access: false,
    },
    assistente: {
      app_key: "assistente" as AppKey,
      role: baseRole,
      loja: null,
      can_access: false,
    },
    multipreco: {
      app_key: "multipreco" as AppKey,
      role: baseRole,
      loja: null,
      can_access: false,
    },
    inventario: {
      app_key: "inventario" as AppKey,
      role: baseRole,
      loja: null,
      can_access: false,
    },
    onboarding: {
      app_key: "onboarding" as AppKey,
      role: baseRole,
      loja: null,
      can_access: false,
    },
    score: {
      app_key: "score" as AppKey,
      role: baseRole,
      loja: null,
      can_access: false,
    },
    cobranca: {
      app_key: "cobranca" as AppKey,
      role: baseRole,
      loja: null,
      can_access: false,
    },
    ecommercedisparo: {
      app_key: "ecommercedisparo" as AppKey,
      role: baseRole,
      loja: null,
      can_access: canAccessHub && canAccessEcommerceDisparo(usuario, hubRole),
    },
    sugestaocompras: {
      app_key: "sugestaocompras" as AppKey,
      role: baseRole,
      loja: null,
      can_access: false,
    },
    salescompass: {
      app_key: "salescompass" as AppKey,
      role: baseRole,
      loja: null,
      can_access: false,
    },
    painelcomissao: {
      app_key: "painelcomissao" as AppKey,
      role: baseRole,
      loja: null,
      can_access: false,
      config: { setores: [], nome_vendedor: null } as PainelComissaoConfig,
    },
  };
}

function mergeApps(
  usuario: string,
  localRole: unknown,
  localLoja: unknown,
  canAccessHub: boolean,
  appRows: any[],
  hubRole?: string
): ManagedUser["apps"] {
  const defaults = buildDefaultApps(usuario, localRole, localLoja, canAccessHub, hubRole);
  const merged: ManagedUser["apps"] = {
    dashboard: { ...defaults.dashboard },
    calculadora: { ...defaults.calculadora },
    disparo: { ...defaults.disparo },
    fechamento: { ...defaults.fechamento },
    assistente: { ...defaults.assistente },
    multipreco: { ...defaults.multipreco },
    inventario: { ...defaults.inventario },
    onboarding: { ...defaults.onboarding },
    score: { ...defaults.score },
    cobranca: { ...defaults.cobranca },
    ecommercedisparo: { ...defaults.ecommercedisparo },
    sugestaocompras: { ...defaults.sugestaocompras },
    salescompass: { ...defaults.salescompass },
    painelcomissao: { ...defaults.painelcomissao },
  };

  for (const row of appRows) {
    if (!isAppKey(row?.app_key)) continue;
    const appKey: AppKey = row.app_key;
    const role = isRole(row?.role) ? row.role : merged[appKey].role;
    merged[appKey] = {
      app_key: appKey,
      role,
      loja: (appKey === "dashboard" || appKey === "calculadora" || appKey === "fechamento" || appKey === "salescompass") && role === "manager" ? (row?.loja ? String(row.loja) : null) :
            appKey === "salescompass" && role !== "admin" ? (row?.loja ? String(row.loja) : null) : null,
      can_access: appKey === "ecommercedisparo"
        ? isEnabledFlag(row?.ativo) && canAccessEcommerceDisparo(usuario, hubRole)
        : isEnabledFlag(row?.ativo),
      ...((appKey === "inventario" || appKey === "salescompass") && row?.usu_codigo_sistema != null ? { usu_codigo_sistema: Number(row.usu_codigo_sistema) } : {}),
      ...(appKey === "painelcomissao" ? { config: parsePainelConfig(row?.config) } : {}),
    };
  }

  if (!canAccessHub) {
    for (const appKey of MANAGED_APPS) {
      merged[appKey].can_access = false;
    }
  }

  return merged;
}

function normalizeAppsPayload(
  usuario: string,
  payload: unknown,
  legacyRole: unknown,
  legacyLoja: unknown,
  canAccessHub: boolean,
  legacyCanAccessDashboard: unknown,
  hubRole?: string
): ManagedUser["apps"] {
  const defaults = buildDefaultApps(usuario, legacyRole, legacyLoja, canAccessHub, hubRole);
  const merged: ManagedUser["apps"] = {
    dashboard: {
      ...defaults.dashboard,
      can_access: legacyCanAccessDashboard === false ? false : defaults.dashboard.can_access,
    },
    calculadora: { ...defaults.calculadora },
    disparo: { ...defaults.disparo },
    fechamento: { ...defaults.fechamento },
    assistente: { ...defaults.assistente },
    multipreco: { ...defaults.multipreco },
    inventario: { ...defaults.inventario },
    onboarding: { ...defaults.onboarding },
    score: { ...defaults.score },
    cobranca: { ...defaults.cobranca },
    ecommercedisparo: { ...defaults.ecommercedisparo },
    sugestaocompras: { ...defaults.sugestaocompras },
    salescompass: { ...defaults.salescompass },
    painelcomissao: { ...defaults.painelcomissao },
  };

  if (payload && typeof payload === "object") {
    const rawApps = payload as Record<string, any>;
    for (const appKey of MANAGED_APPS) {
      const raw = rawApps[appKey];
      if (!raw || typeof raw !== "object") continue;
      const role = isRole(raw.role) ? raw.role : merged[appKey].role;
      const lojaValue = (appKey === "dashboard" || appKey === "calculadora" || appKey === "fechamento" || appKey === "salescompass")
        ? (raw.loja ? String(raw.loja) : null)
        : null;
      merged[appKey] = {
        app_key: appKey,
        role,
        loja: lojaValue,
        can_access: appKey === "ecommercedisparo"
          ? (typeof raw.can_access === "boolean" ? raw.can_access : merged[appKey].can_access) && canAccessEcommerceDisparo(usuario, hubRole)
          : typeof raw.can_access === "boolean" ? raw.can_access : merged[appKey].can_access,
        ...(appKey === "salescompass" && raw.usu_codigo_sistema != null ? { usu_codigo_sistema: Number(raw.usu_codigo_sistema) } : {}),
        ...(appKey === "painelcomissao" ? { config: parsePainelConfig(raw.config) } : {}),
      };
    }
  }

  if (!canAccessHub) {
    for (const appKey of MANAGED_APPS) {
      merged[appKey].can_access = false;
    }
  }

  return merged;
}

async function isAdminActor(pool: any, actorUsuario: string): Promise<boolean> {
  const normalized = String(actorUsuario || "").trim().toLowerCase();
  if (!normalized) return false;

  const result = await pool.request()
    .input("actor", normalized)
    .query(`
      SELECT TOP 1 hub_role
      FROM dbo.USUARIOS_LOJAS
      WHERE LOWER(usuario) = @actor AND ativo = 1
    `);

  return result.recordset[0]?.hub_role === "admin";
}

/** POST /api/auth/login */
router.post("/login", async (req, res) => {
  const { usuario, senha } = req.body;

  if (!usuario || !senha) {
    return res.status(400).json({ error: "Usuário e senha obrigatórios." });
  }

  try {
    const pool = await getPool();

    await ensureAppsTable(pool);

    // Usuários de teste (*.teste): autentica pelo banco local (sem AD)
    if (usuario.endsWith(".teste")) {
      const testResult = await pool.request()
        .input("usuario", usuario)
        .query(`SELECT senha_hash, role, loja, ativo, hub_role FROM dbo.USUARIOS_LOJAS WHERE usuario = @usuario`);
      const testUser = testResult.recordset[0];
      if (!testUser) return res.status(401).json({ error: "Usuário ou senha inválidos." });
      const senhaOk = await bcrypt.compare(senha, testUser.senha_hash);
      if (!senhaOk) return res.status(401).json({ error: "Usuário ou senha inválidos." });

      const canAccessHub = isEnabledFlag(testUser.ativo);
      if (!canAccessHub) {
        return res.status(403).json({ error: "Acesso ao Hub não liberado. Solicite liberação ao administrador." });
      }

      const testAppsResult = await pool.request()
        .input("usuario", usuario)
        .query(`
          SELECT app_key, role, loja, ativo, usu_codigo_sistema, config
          FROM dbo.USUARIOS_APPS
          WHERE usuario = @usuario
        `);
      const hubRole: HubRole = isHubRole(testUser.hub_role) ? testUser.hub_role : "viewer";
      const apps = mergeApps(usuario, testUser.role, testUser.loja, canAccessHub, testAppsResult.recordset, hubRole);
      const dashboardRole = apps.dashboard.role;

      return res.json({
        token: `local_${Date.now()}`,
        usuario,
        displayname: usuario,
        hub_role: hubRole,
        role: dashboardRole,
        loja: apps.dashboard.loja,
        can_access_hub: canAccessHub,
        can_access_dashboard: apps.dashboard.can_access,
        apps,
      });
    }

    // Demais usuários: autentica via AD
    const adRes = await fetch("https://api.dovale.com.br/LoginUsuario1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, senha }),
    });

    if (!adRes.ok) {
      return res.status(401).json({ error: "Usuário ou senha inválidos." });
    }

    const adData = await adRes.json().catch(() => ({}));

    const localResult = await pool.request()
      .input("usuario", usuario)
      .query(`SELECT role, loja, ativo, hub_role FROM dbo.USUARIOS_LOJAS WHERE usuario = @usuario`);

    const localUser = localResult.recordset[0];
    const canAccessHub = isEnabledFlag(localUser?.ativo);
    if (!canAccessHub) {
      return res.status(403).json({ error: "Acesso ao Hub não liberado. Solicite liberação ao administrador." });
    }

    const appsResult = await pool.request()
      .input("usuario", usuario)
      .query(`
        SELECT app_key, role, loja, ativo, usu_codigo_sistema, config
        FROM dbo.USUARIOS_APPS
        WHERE usuario = @usuario
      `);

    const hubRole: HubRole = isHubRole(localUser?.hub_role) ? localUser.hub_role : "viewer";
    const apps = mergeApps(usuario, localUser?.role, localUser?.loja, canAccessHub, appsResult.recordset, hubRole);
    const dashboardRole = apps.dashboard.role;
    const displayname = String(
      adData?.displayname ||
      adData?.nome ||
      adData?.name ||
      adData?.usuario_nome ||
      usuario
    );

    res.json({
      token: adData?.token || adData?.access_token || `ad_${Date.now()}`,
      usuario,
      displayname,
      hub_role: hubRole,
      role: dashboardRole,
      loja: apps.dashboard.loja,
      can_access_hub: canAccessHub,
      can_access_dashboard: apps.dashboard.can_access,
      apps,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/** GET /api/auth/me?usuario=xxx — retorna permissões atualizadas do DB */
router.get("/me", async (req, res) => {
  try {
    const usuario = String(req.query.usuario || "").trim();
    if (!usuario) return res.status(400).json({ error: "usuario é obrigatório." });

    const pool = await getPool();
    await ensureAppsTable(pool);

    const localResult = await pool.request()
      .input("usuario", usuario)
      .query(`SELECT role, loja, ativo, hub_role FROM dbo.USUARIOS_LOJAS WHERE usuario = @usuario`);
    const localUser = localResult.recordset[0];
    if (!localUser) return res.status(404).json({ error: "Usuário não encontrado." });

    const canAccessHub = isEnabledFlag(localUser.ativo);
    const hubRole: HubRole = isHubRole(localUser.hub_role) ? localUser.hub_role : "viewer";

    const appsResult = await pool.request()
      .input("usuario", usuario)
      .query(`SELECT app_key, role, loja, ativo, usu_codigo_sistema, config FROM dbo.USUARIOS_APPS WHERE usuario = @usuario`);

    const apps = mergeApps(usuario, localUser.role, localUser.loja, canAccessHub, appsResult.recordset, hubRole);

    res.json({
      usuario,
      hub_role: hubRole,
      role: apps.dashboard.role,
      loja: apps.dashboard.loja,
      can_access_hub: canAccessHub,
      can_access_dashboard: apps.dashboard.can_access,
      apps,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/** GET /api/auth/users — lista usuários AD com acessos do Hub e dos apps */
router.get("/users", async (req, res) => {
  try {
    const actorUsuario = String(req.query.actor_usuario || "").trim();
    if (!actorUsuario) return res.status(400).json({ error: "actor_usuario é obrigatório." });

    const pool = await getPool();
    const actorIsAdmin = await isAdminActor(pool, actorUsuario);
    if (!actorIsAdmin) return res.status(403).json({ error: "Apenas administradores podem listar usuários." });
    await ensureAppsTable(pool);

    const adRes = await fetch("https://api.dovale.com.br/AD/InformacoesDosUsuariosAtivos", {
      method: "GET",
      headers: { accept: "*/*" },
    });

    if (!adRes.ok) {
      return res.status(502).json({ error: "Não foi possível consultar usuários no AD." });
    }

    const adUsers = await adRes.json().catch(() => []);
    const [localResult, appResult] = await Promise.all([
      pool.request().query(`SELECT usuario, role, loja, ativo, hub_role FROM dbo.USUARIOS_LOJAS`),
      pool.request().query(`
        SELECT usuario, app_key, role, loja, ativo, usu_codigo_sistema, config
        FROM dbo.USUARIOS_APPS
        WHERE app_key IN ('dashboard', 'calculadora', 'disparo', 'fechamento', 'assistente', 'multipreco', 'inventario', 'onboarding', 'score', 'cobranca', 'ecommercedisparo', 'sugestaocompras', 'salescompass', 'painelcomissao')
      `),
    ]);

    const localMap = new Map(
      localResult.recordset.map((r: any) => [String(r.usuario).toLowerCase(), r])
    );
    const appRowsByUser = new Map<string, any[]>();
    for (const row of appResult.recordset as any[]) {
      const key = String(row?.usuario || "").trim().toLowerCase();
      if (!key) continue;
      if (!appRowsByUser.has(key)) appRowsByUser.set(key, []);
      appRowsByUser.get(key)!.push(row);
    }
    const seen = new Set<string>();

    const merged: ManagedUser[] = [];

    if (Array.isArray(adUsers)) {
      for (const ad of adUsers as any[]) {
        const usuario = toUsuario(ad);
        if (!usuario) continue;
        const key = usuario.toLowerCase();
        seen.add(key);
        const local = localMap.get(key);
        const canAccessHub = isEnabledFlag(local?.ativo);
        const hubRole: HubRole = isHubRole(local?.hub_role) ? local.hub_role : "viewer";
        const apps = mergeApps(usuario, local?.role, local?.loja, canAccessHub, appRowsByUser.get(key) ?? [], hubRole);
        merged.push({
          usuario,
          displayname: String(ad?.displayname || ad?.name || usuario),
          department: String(ad?.department || ""),
          hub_role: hubRole,
          role: apps.dashboard.role,
          loja: apps.dashboard.loja,
          can_access_hub: canAccessHub,
          can_access_dashboard: apps.dashboard.can_access,
          apps,
        });
      }
    }

    for (const r of localResult.recordset as any[]) {
      const usuario = String(r.usuario || "").trim();
      if (!usuario) continue;
      const key = usuario.toLowerCase();
      if (seen.has(key)) continue;
      const canAccessHub = isEnabledFlag(r.ativo);
      const hubRole: HubRole = isHubRole(r.hub_role) ? r.hub_role : "viewer";
      const apps = mergeApps(usuario, r.role, r.loja, canAccessHub, appRowsByUser.get(key) ?? [], hubRole);

      merged.push({
        usuario,
        displayname: usuario,
        department: "",
        hub_role: hubRole,
        role: apps.dashboard.role,
        loja: apps.dashboard.loja,
        can_access_hub: canAccessHub,
        can_access_dashboard: apps.dashboard.can_access,
        apps,
      });
    }

    merged.sort((a, b) => a.usuario.localeCompare(b.usuario, "pt-BR"));
    res.json(merged);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/** POST /api/auth/seed — cria usuários de teste (remover em produção) */
router.post("/seed", async (req, res) => {
  const usuarios = [
    { usuario: "kevin.silva",   senha: "admin123",   role: "admin"   },
    { usuario: "gerente.teste", senha: "gerente123", role: "manager" },
    { usuario: "editor.teste",  senha: "editor123",  role: "editor"  },
    { usuario: "viewer.teste",  senha: "viewer123",  role: "viewer"  },
  ];

  try {
    const pool = await getPool();
    for (const u of usuarios) {
      const hash = await bcrypt.hash(u.senha, 10);
      await pool.request()
        .input("usuario", u.usuario)
        .input("hash",    hash)
        .input("role",    u.role)
        .query(`
          MERGE dbo.USUARIOS_LOJAS AS target
          USING (SELECT @usuario AS usuario) AS source
            ON target.usuario = source.usuario
          WHEN MATCHED THEN
            UPDATE SET senha_hash = @hash, role = @role
          WHEN NOT MATCHED THEN
            INSERT (usuario, senha_hash, role)
            VALUES (@usuario, @hash, @role);
        `);
    }
    res.json({ ok: true, criados: usuarios.map(u => u.usuario) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/** PUT /api/auth/role — atualiza acesso ao Hub e configurações por app */
router.put("/role", async (req, res) => {
  const {
    usuario,
    role,
    loja,
    can_access_dashboard,
    can_access_hub,
    hub_role,
    apps,
    actor_usuario,
  } = req.body;

  if (!usuario) {
    return res.status(400).json({ error: "Dados inválidos." });
  }
  if (!actor_usuario) {
    return res.status(400).json({ error: "actor_usuario é obrigatório." });
  }

  try {
    const pool = await getPool();
    const actorIsAdmin = await isAdminActor(pool, String(actor_usuario));
    if (!actorIsAdmin) {
      return res.status(403).json({ error: "Apenas administradores podem alterar usuários." });
    }

    await ensureAppsTable(pool);

    const canAccessHub = can_access_hub !== false;
    const resolvedHubRole: HubRole = isHubRole(hub_role) ? hub_role : "viewer";
    const normalizedApps = normalizeAppsPayload(
      String(usuario),
      apps,
      role,
      loja,
      canAccessHub,
      can_access_dashboard,
      resolvedHubRole
    );
    const dashboardApp = normalizedApps.dashboard;
    const hubAtivo = canAccessHub ? 1 : 0;

    await pool.request()
      .input("usuario", usuario)
      .input("role", dashboardApp.role)
      .input("loja", dashboardApp.loja ?? null)
      .input("ativo", hubAtivo)
      .input("hub_role", resolvedHubRole)
      .query(`
        MERGE dbo.USUARIOS_LOJAS AS target
        USING (SELECT @usuario AS usuario) AS source
          ON target.usuario = source.usuario
        WHEN MATCHED THEN
          UPDATE SET role = @role, loja = @loja, ativo = @ativo, hub_role = @hub_role
        WHEN NOT MATCHED THEN
          INSERT (usuario, senha_hash, role, loja, ativo, hub_role) VALUES (@usuario, '', @role, @loja, @ativo, @hub_role);
      `);

    // Extract usu_codigo_sistema from inventario and salescompass app payloads
    const rawApps = (apps && typeof apps === "object") ? apps as Record<string, any> : {};
    const invUsuCodigoSistema = rawApps?.inventario?.usu_codigo_sistema ?? null;
    const scRepCodigo = rawApps?.salescompass?.usu_codigo_sistema ?? null;
    const painelConfigJson = JSON.stringify(normalizedApps.painelcomissao.config ?? { setores: [], nome_vendedor: null });

    for (const appKey of MANAGED_APPS) {
      const app = normalizedApps[appKey];
      const r = pool.request()
        .input("usuario", usuario)
        .input("app_key", app.app_key)
        .input("role", app.role)
        .input("loja", app.loja ?? null)
        .input("ativo", app.can_access ? 1 : 0);

      if (appKey === "inventario") {
        r.input("usu_codigo_sistema", invUsuCodigoSistema);
        await r.query(`
          MERGE dbo.USUARIOS_APPS AS target
          USING (SELECT @usuario AS usuario, @app_key AS app_key) AS source
            ON target.usuario = source.usuario AND target.app_key = source.app_key
          WHEN MATCHED THEN
            UPDATE SET role = @role, loja = @loja, ativo = @ativo, usu_codigo_sistema = @usu_codigo_sistema
          WHEN NOT MATCHED THEN
            INSERT (usuario, app_key, role, loja, ativo, usu_codigo_sistema)
            VALUES (@usuario, @app_key, @role, @loja, @ativo, @usu_codigo_sistema);
        `);
      } else if (appKey === "salescompass") {
        r.input("usu_codigo_sistema", scRepCodigo);
        await r.query(`
          MERGE dbo.USUARIOS_APPS AS target
          USING (SELECT @usuario AS usuario, @app_key AS app_key) AS source
            ON target.usuario = source.usuario AND target.app_key = source.app_key
          WHEN MATCHED THEN
            UPDATE SET role = @role, loja = @loja, ativo = @ativo, usu_codigo_sistema = @usu_codigo_sistema
          WHEN NOT MATCHED THEN
            INSERT (usuario, app_key, role, loja, ativo, usu_codigo_sistema)
            VALUES (@usuario, @app_key, @role, @loja, @ativo, @usu_codigo_sistema);
        `);
      } else if (appKey === "painelcomissao") {
        r.input("config", painelConfigJson);
        await r.query(`
          MERGE dbo.USUARIOS_APPS AS target
          USING (SELECT @usuario AS usuario, @app_key AS app_key) AS source
            ON target.usuario = source.usuario AND target.app_key = source.app_key
          WHEN MATCHED THEN
            UPDATE SET role = @role, loja = @loja, ativo = @ativo, config = @config
          WHEN NOT MATCHED THEN
            INSERT (usuario, app_key, role, loja, ativo, config)
            VALUES (@usuario, @app_key, @role, @loja, @ativo, @config);
        `);
      } else {
        await r.query(`
          MERGE dbo.USUARIOS_APPS AS target
          USING (SELECT @usuario AS usuario, @app_key AS app_key) AS source
            ON target.usuario = source.usuario AND target.app_key = source.app_key
          WHEN MATCHED THEN
            UPDATE SET role = @role, loja = @loja, ativo = @ativo
          WHEN NOT MATCHED THEN
            INSERT (usuario, app_key, role, loja, ativo)
            VALUES (@usuario, @app_key, @role, @loja, @ativo);
        `);
      }
    }

    res.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/** GET /api/auth/painel-comissao/sso?usuario=xxx
 *  Emite um JWT curto (assinado com SESSION_SECRET, compartilhado com o painel-comissao)
 *  e devolve a URL de acesso ao painel já com o token. O painel valida o JWT no seu middleware. */
router.get("/painel-comissao/sso", async (req, res) => {
  try {
    const usuario = String(req.query.usuario || "").trim();
    if (!usuario) return res.status(400).json({ error: "usuario é obrigatório." });

    const secret = process.env.SESSION_SECRET;
    const painelUrl = process.env.PAINEL_COMISSAO_URL;
    if (!secret) return res.status(500).json({ error: "SESSION_SECRET não configurado no Hub." });
    if (!painelUrl) return res.status(500).json({ error: "PAINEL_COMISSAO_URL não configurado no Hub." });

    const pool = await getPool();
    await ensureAppsTable(pool);

    const localResult = await pool.request()
      .input("usuario", usuario)
      .query(`SELECT role, loja, ativo, hub_role FROM dbo.USUARIOS_LOJAS WHERE usuario = @usuario`);
    const localUser = localResult.recordset[0];
    if (!localUser) return res.status(404).json({ error: "Usuário não encontrado." });

    const canAccessHub = isEnabledFlag(localUser.ativo);
    const hubRole: HubRole = isHubRole(localUser.hub_role) ? localUser.hub_role : "viewer";

    const appsResult = await pool.request()
      .input("usuario", usuario)
      .query(`SELECT app_key, role, loja, ativo, usu_codigo_sistema, config FROM dbo.USUARIOS_APPS WHERE usuario = @usuario`);
    const apps = mergeApps(usuario, localUser.role, localUser.loja, canAccessHub, appsResult.recordset, hubRole);

    if (!canAccessHub || !apps.painelcomissao.can_access) {
      return res.status(403).json({ error: "Usuário sem acesso ao Painel de Comissões." });
    }

    // O painel identifica o usuário pelo e-mail (samAccountName@dovale.com.br)
    const email = usuario.includes("@") ? usuario : `${usuario}@dovale.com.br`;
    const token = jwt.sign({ email, usuario }, secret, { algorithm: "HS256", expiresIn: "8h" });

    const url = `${painelUrl.replace(/\/$/, "")}/api/sso?token=${encodeURIComponent(token)}`;
    res.json({ url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
