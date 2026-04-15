import { Router } from "express";
import * as ldap from "ldapjs";
import sql from "mssql";
import { getPool } from "../db/sqlserver";

const router = Router();

// ── LDAP config ──
const AD_URL = process.env.AD_LDAP_URL || "ldap://192.168.10.2";
const AD_BIND_DN = process.env.AD_BIND_DN || "";
const AD_BIND_PASSWORD = process.env.AD_BIND_PASSWORD || "";
const AD_BASE_DN = process.env.AD_BASE_DN || "DC=dovalechaves,DC=local";
const AD_USERS_OU = `OU=Usuarios,${AD_BASE_DN}`;
const AD_DEFAULT_PASSWORD = "@Dovale123";

function createClient(): ldap.Client {
  return ldap.createClient({ url: AD_URL, tlsOptions: { rejectUnauthorized: false } });
}

function bindClient(client: ldap.Client): Promise<void> {
  return new Promise((resolve, reject) => {
    client.bind(AD_BIND_DN, AD_BIND_PASSWORD, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function ldapSearch(client: ldap.Client, base: string, opts: ldap.SearchOptions): Promise<any[]> {
  return new Promise((resolve, reject) => {
    client.search(base, opts, (err, res) => {
      if (err) return reject(err);
      const entries: any[] = [];
      res.on("searchEntry", (entry) => entries.push(entry.ppiObject ?? entry.object ?? entry));
      res.on("error", (err) => reject(err));
      res.on("end", () => resolve(entries));
    });
  });
}

function ldapAdd(client: ldap.Client, dn: string, entry: Record<string, any>): Promise<void> {
  return new Promise((resolve, reject) => {
    client.add(dn, entry, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function ldapModify(client: ldap.Client, dn: string, changes: ldap.Change[]): Promise<void> {
  return new Promise((resolve, reject) => {
    client.modify(dn, changes, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function encodePassword(password: string): Buffer {
  return Buffer.from(`"${password}"`, "utf16le");
}

function generateUsername(nomeCompleto: string): string {
  const parts = nomeCompleto
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 2) return parts[0] || "usuario";
  return `${parts[0]}.${parts[parts.length - 1]}`;
}

/** GET /locais — list locations under OU=Usuarios */
router.get("/locais", async (_req, res) => {
  const client = createClient();
  try {
    await bindClient(client);
    const entries = await ldapSearch(client, AD_USERS_OU, {
      scope: "one",
      filter: "(objectClass=organizationalUnit)",
      attributes: ["ou", "distinguishedName"],
    });
    const locais = entries.map((e: any) => ({
      nome: e.ou || e.dn?.split(",")?.[0]?.replace("OU=", "") || "?",
      dn: e.distinguishedName || e.dn,
    }));
    res.json(locais);
  } catch (err: any) {
    console.error("[onboarding] Erro ao listar locais:", err.message);
    res.status(500).json({ error: "Erro ao listar locais do AD." });
  } finally {
    client.unbind(() => {});
  }
});

/** GET /setores?local=OU=SJC,OU=Usuarios,DC=dovalechaves,DC=local — list departments under a location */
router.get("/setores", async (req, res) => {
  const localDN = req.query.local as string;
  if (!localDN) return res.status(400).json({ error: "Parâmetro 'local' obrigatório." });

  const client = createClient();
  try {
    await bindClient(client);
    const entries = await ldapSearch(client, localDN, {
      scope: "one",
      filter: "(objectClass=organizationalUnit)",
      attributes: ["ou", "distinguishedName"],
    });
    const setores = entries.map((e: any) => ({
      nome: e.ou || e.dn?.split(",")?.[0]?.replace("OU=", "") || "?",
      dn: e.distinguishedName || e.dn,
    }));
    res.json(setores);
  } catch (err: any) {
    console.error("[onboarding] Erro ao listar setores:", err.message);
    res.status(500).json({ error: "Erro ao listar setores do AD." });
  } finally {
    client.unbind(() => {});
  }
});

/** GET /usuarios?setor_dn=... — list users in a department OU (for copy permissions) */
router.get("/usuarios", async (req, res) => {
  const setorDN = req.query.setor_dn as string;
  if (!setorDN) return res.status(400).json({ error: "Parâmetro 'setor_dn' obrigatório." });

  const client = createClient();
  try {
    await bindClient(client);
    const entries = await ldapSearch(client, setorDN, {
      scope: "one",
      filter: "(&(objectClass=user)(objectCategory=person))",
      attributes: ["sAMAccountName", "displayName", "cn", "distinguishedName", "memberOf"],
    });
    const usuarios = entries.map((e: any) => ({
      username: e.sAMAccountName,
      displayName: e.displayName || e.cn,
      dn: e.distinguishedName || e.dn,
      groups: Array.isArray(e.memberOf) ? e.memberOf : (e.memberOf ? [e.memberOf] : []),
    }));
    res.json(usuarios);
  } catch (err: any) {
    console.error("[onboarding] Erro ao listar usuarios:", err.message);
    res.status(500).json({ error: "Erro ao listar usuários do AD." });
  } finally {
    client.unbind(() => {});
  }
});

/** POST /criar — create AD user */
router.post("/criar", async (req, res) => {
  const { nome_completo, cargo, setor_dn, copiar_de_dn } = req.body ?? {};
  if (!nome_completo || !setor_dn) {
    return res.status(400).json({ error: "nome_completo e setor_dn são obrigatórios." });
  }

  const username = generateUsername(nome_completo);
  const parts = nome_completo.trim().split(/\s+/);
  const firstName = parts[0];
  const lastName = parts.slice(1).join(" ") || parts[0];
  const cn = nome_completo.trim();
  const userDN = `CN=${cn},${setor_dn}`;
  const upn = `${username}@dovalechaves.local`;

  const client = createClient();
  const log: string[] = [];

  try {
    await bindClient(client);
    log.push("✅ Conectado ao AD");

    // Check if username already exists
    const existing = await ldapSearch(client, AD_BASE_DN, {
      scope: "sub",
      filter: `(sAMAccountName=${username})`,
      attributes: ["sAMAccountName"],
    });
    if (existing.length > 0) {
      return res.status(409).json({ error: `Usuário '${username}' já existe no AD.`, log });
    }
    log.push(`✅ Username '${username}' disponível`);

    // Create user
    const entry: Record<string, any> = {
      objectClass: ["top", "person", "organizationalPerson", "user"],
      cn,
      sAMAccountName: username,
      userPrincipalName: upn,
      givenName: firstName,
      sn: lastName,
      displayName: cn,
      userAccountControl: "544", // NORMAL_ACCOUNT + PASSWD_NOTREQD (temporary)
    };
    if (cargo) entry.title = cargo;

    await ldapAdd(client, userDN, entry);
    log.push(`✅ Usuário criado: ${userDN}`);

    // Set password
    try {
      await ldapModify(client, userDN, [
        new ldap.Change({
          operation: "replace",
          modification: new ldap.Attribute({
            type: "unicodePwd",
            values: [encodePassword(AD_DEFAULT_PASSWORD)],
          }),
        }),
      ]);
      log.push("✅ Senha definida: " + AD_DEFAULT_PASSWORD);
    } catch (pwdErr: any) {
      log.push("⚠️ Erro ao definir senha (pode requerer LDAPS): " + pwdErr.message);
    }

    // Enable account + force password change
    try {
      await ldapModify(client, userDN, [
        new ldap.Change({
          operation: "replace",
          modification: new ldap.Attribute({
            type: "userAccountControl",
            values: ["512"], // NORMAL_ACCOUNT enabled
          }),
        }),
        new ldap.Change({
          operation: "replace",
          modification: new ldap.Attribute({
            type: "pwdLastSet",
            values: ["0"], // force change on next login
          }),
        }),
      ]);
      log.push("✅ Conta habilitada + troca de senha obrigatória");
    } catch (enableErr: any) {
      log.push("⚠️ Erro ao habilitar conta: " + enableErr.message);
    }

    // Copy group memberships from existing user
    if (copiar_de_dn) {
      try {
        const sourceUser = await ldapSearch(client, copiar_de_dn, {
          scope: "base",
          filter: "(objectClass=user)",
          attributes: ["memberOf"],
        });
        const groups: string[] = sourceUser[0]?.memberOf
          ? (Array.isArray(sourceUser[0].memberOf) ? sourceUser[0].memberOf : [sourceUser[0].memberOf])
          : [];

        let copied = 0;
        for (const groupDN of groups) {
          try {
            await ldapModify(client, groupDN, [
              new ldap.Change({
                operation: "add",
                modification: new ldap.Attribute({
                  type: "member",
                  values: [userDN],
                }),
              }),
            ]);
            copied++;
          } catch (grpErr: any) {
            log.push(`⚠️ Erro ao adicionar ao grupo ${groupDN.split(",")[0]}: ${grpErr.message}`);
          }
        }
        log.push(`✅ ${copied}/${groups.length} grupos copiados de ${copiar_de_dn.split(",")[0]}`);
      } catch (copyErr: any) {
        log.push("⚠️ Erro ao copiar grupos: " + copyErr.message);
      }
    }

    // Save to SQL Server log
    try {
      const pool = await getPool();
      await pool.request()
        .input("username", sql.VarChar(100), username)
        .input("nome_completo", sql.NVarChar(200), nome_completo)
        .input("cargo", sql.NVarChar(100), cargo || null)
        .input("setor_dn", sql.NVarChar(500), setor_dn)
        .input("copiar_de_dn", sql.NVarChar(500), copiar_de_dn || null)
        .input("criado_por", sql.VarChar(100), req.body.criado_por || "sistema")
        .input("log", sql.NVarChar(sql.MAX), log.join("\n"))
        .query(`
          IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ONBOARDING_LOG')
          BEGIN
            CREATE TABLE dbo.ONBOARDING_LOG (
              id INT IDENTITY(1,1) PRIMARY KEY,
              username VARCHAR(100) NOT NULL,
              nome_completo NVARCHAR(200) NOT NULL,
              cargo NVARCHAR(100),
              setor_dn NVARCHAR(500),
              copiar_de_dn NVARCHAR(500),
              criado_por VARCHAR(100),
              log NVARCHAR(MAX),
              created_at DATETIME DEFAULT GETDATE()
            )
          END;
          INSERT INTO dbo.ONBOARDING_LOG (username, nome_completo, cargo, setor_dn, copiar_de_dn, criado_por, log)
          VALUES (@username, @nome_completo, @cargo, @setor_dn, @copiar_de_dn, @criado_por, @log)
        `);
      log.push("✅ Log salvo no banco");
    } catch (dbErr: any) {
      log.push("⚠️ Erro ao salvar log: " + dbErr.message);
    }

    res.json({
      ok: true,
      username,
      upn,
      dn: userDN,
      senha_inicial: AD_DEFAULT_PASSWORD,
      trocar_senha: true,
      log,
    });
  } catch (err: any) {
    log.push("❌ Erro: " + err.message);
    console.error("[onboarding] Erro ao criar usuário:", err.message);
    res.status(500).json({ error: err.message, log });
  } finally {
    client.unbind(() => {});
  }
});

/** GET /historico — list onboarding history */
router.get("/historico", async (_req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ONBOARDING_LOG')
        SELECT id, username, nome_completo, cargo, setor_dn, copiar_de_dn, criado_por, log, created_at
        FROM dbo.ONBOARDING_LOG ORDER BY created_at DESC
      ELSE
        SELECT 1 WHERE 1=0
    `);
    res.json(result.recordset);
  } catch (err: any) {
    console.error("[onboarding] Erro ao listar historico:", err.message);
    res.status(500).json({ error: "Erro ao buscar histórico." });
  }
});

export default router;
