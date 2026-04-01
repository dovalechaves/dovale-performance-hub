import { Router } from "express";
import bcrypt from "bcrypt";
import { getPool } from "../db/sqlserver";

const router = Router();
const VALID_ROLES = ["admin", "manager", "viewer"] as const;
const MANAGED_APPS = ["dashboard", "calculadora"] as const;

type Role = typeof VALID_ROLES[number];
type AppKey = typeof MANAGED_APPS[number];

function isRole(value: unknown): value is Role {
  return typeof value === "string" && VALID_ROLES.includes(value as Role);
}

function isAppKey(value: unknown): value is AppKey {
  return typeof value === "string" && MANAGED_APPS.includes(value as AppKey);
}

function toUsuario(adUser: any): string {
  return String(adUser?.samAccountName || adUser?.name || "").trim();
}

interface ManagedUser {
  usuario: string;
  displayname: string;
  department: string;
  can_access_hub: boolean;
  can_access_dashboard: boolean;
  role: Role;
  loja: string | null;
  apps: Record<AppKey, {
    app_key: AppKey;
    role: Role;
    loja: string | null;
    can_access: boolean;
  }>;
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
        CONSTRAINT UQ_USUARIOS_APPS UNIQUE (usuario, app_key)
      );
    END
  `);
}

function normalizeRoleForUser(usuario: string, candidate: unknown): Role {
  return isRole(candidate) ? candidate : "viewer";
}

function buildDefaultApps(usuario: string, localRole: unknown, localLoja: unknown, canAccessHub: boolean) {
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
  };
}

function mergeApps(
  usuario: string,
  localRole: unknown,
  localLoja: unknown,
  canAccessHub: boolean,
  appRows: any[]
): ManagedUser["apps"] {
  const defaults = buildDefaultApps(usuario, localRole, localLoja, canAccessHub);
  const merged: ManagedUser["apps"] = {
    dashboard: { ...defaults.dashboard },
    calculadora: { ...defaults.calculadora },
  };

  for (const row of appRows) {
    if (!isAppKey(row?.app_key)) continue;
    const appKey: AppKey = row.app_key;
    const role = isRole(row?.role) ? row.role : merged[appKey].role;
    merged[appKey] = {
      app_key: appKey,
      role,
      loja: appKey === "dashboard" && role === "manager" ? (row?.loja ? String(row.loja) : "bh") : null,
      can_access: row?.ativo !== 0,
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
  legacyCanAccessDashboard: unknown
): ManagedUser["apps"] {
  const defaults = buildDefaultApps(usuario, legacyRole, legacyLoja, canAccessHub);
  const merged: ManagedUser["apps"] = {
    dashboard: {
      ...defaults.dashboard,
      can_access: legacyCanAccessDashboard === false ? false : defaults.dashboard.can_access,
    },
    calculadora: { ...defaults.calculadora },
  };

  if (payload && typeof payload === "object") {
    const rawApps = payload as Record<string, any>;
    for (const appKey of MANAGED_APPS) {
      const raw = rawApps[appKey];
      if (!raw || typeof raw !== "object") continue;
      const role = isRole(raw.role) ? raw.role : merged[appKey].role;
      merged[appKey] = {
        app_key: appKey,
        role,
        loja: appKey === "dashboard" && role === "manager" ? (raw.loja ? String(raw.loja) : "bh") : null,
        can_access: typeof raw.can_access === "boolean" ? raw.can_access : merged[appKey].can_access,
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
      SELECT TOP 1 role
      FROM dbo.USUARIOS_LOJAS
      WHERE LOWER(usuario) = @actor AND ativo = 1
    `);

  return isRole(result.recordset[0]?.role) && result.recordset[0].role === "admin";
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
        .query(`SELECT senha_hash, role, loja, ativo FROM dbo.USUARIOS_LOJAS WHERE usuario = @usuario`);
      const testUser = testResult.recordset[0];
      if (!testUser) return res.status(401).json({ error: "Usuário ou senha inválidos." });
      const senhaOk = await bcrypt.compare(senha, testUser.senha_hash);
      if (!senhaOk) return res.status(401).json({ error: "Usuário ou senha inválidos." });

      const canAccessHub = testUser.ativo === 1;
      if (!canAccessHub) {
        return res.status(403).json({ error: "Acesso ao Hub não liberado. Solicite liberação ao administrador." });
      }

      const testAppsResult = await pool.request()
        .input("usuario", usuario)
        .query(`
          SELECT app_key, role, loja, ativo
          FROM dbo.USUARIOS_APPS
          WHERE usuario = @usuario
        `);
      const apps = mergeApps(usuario, testUser.role, testUser.loja, canAccessHub, testAppsResult.recordset);
      const dashboardRole = apps.dashboard.role;

      return res.json({
        token: `local_${Date.now()}`,
        usuario,
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
      .query(`SELECT role, loja, ativo FROM dbo.USUARIOS_LOJAS WHERE usuario = @usuario`);

    const localUser = localResult.recordset[0];
    const canAccessHub = localUser?.ativo === 1;
    if (!canAccessHub) {
      return res.status(403).json({ error: "Acesso ao Hub não liberado. Solicite liberação ao administrador." });
    }

    const appsResult = await pool.request()
      .input("usuario", usuario)
      .query(`
        SELECT app_key, role, loja, ativo
        FROM dbo.USUARIOS_APPS
        WHERE usuario = @usuario
      `);

    const apps = mergeApps(usuario, localUser?.role, localUser?.loja, canAccessHub, appsResult.recordset);
    const dashboardRole = apps.dashboard.role;

    res.json({
      token: adData?.token || adData?.access_token || `ad_${Date.now()}`,
      usuario,
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
      pool.request().query(`SELECT usuario, role, loja, ativo FROM dbo.USUARIOS_LOJAS`),
      pool.request().query(`
        SELECT usuario, app_key, role, loja, ativo
        FROM dbo.USUARIOS_APPS
        WHERE app_key IN ('dashboard', 'calculadora')
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
        const canAccessHub = local?.ativo === 1;
        const apps = mergeApps(usuario, local?.role, local?.loja, canAccessHub, appRowsByUser.get(key) ?? []);

        merged.push({
          usuario,
          displayname: String(ad?.displayname || ad?.name || usuario),
          department: String(ad?.department || ""),
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
      const canAccessHub = r.ativo === 1;
      const apps = mergeApps(usuario, r.role, r.loja, canAccessHub, appRowsByUser.get(key) ?? []);

      merged.push({
        usuario,
        displayname: usuario,
        department: "",
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
    const normalizedApps = normalizeAppsPayload(
      String(usuario),
      apps,
      role,
      loja,
      canAccessHub,
      can_access_dashboard
    );
    const dashboardApp = normalizedApps.dashboard;
    const hubAtivo = canAccessHub ? 1 : 0;

    await pool.request()
      .input("usuario", usuario)
      .input("role", dashboardApp.role)
      .input("loja", dashboardApp.loja ?? null)
      .input("ativo", hubAtivo)
      .query(`
        MERGE dbo.USUARIOS_LOJAS AS target
        USING (SELECT @usuario AS usuario) AS source
          ON target.usuario = source.usuario
        WHEN MATCHED THEN
          UPDATE SET role = @role, loja = @loja, ativo = @ativo
        WHEN NOT MATCHED THEN
          INSERT (usuario, senha_hash, role, loja, ativo) VALUES (@usuario, '', @role, @loja, @ativo);
      `);

    for (const appKey of MANAGED_APPS) {
      const app = normalizedApps[appKey];
      await pool.request()
        .input("usuario", usuario)
        .input("app_key", app.app_key)
        .input("role", app.role)
        .input("loja", app.loja ?? null)
        .input("ativo", app.can_access ? 1 : 0)
        .query(`
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

    res.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
