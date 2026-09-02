import { Router } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import Firebird from "node-firebird";
import sql from "mssql";
import { getPool } from "../db/sqlserver";

const execFileAsync = promisify(execFile);
const router = Router();

// ── AD config ──
const AD_SERVER = process.env.AD_SERVER || "192.168.10.9";
const AD_BASE_DN = process.env.AD_BASE_DN || "DC=dovalechaves,DC=local";
const AD_USERS_OU = `OU=Usuarios,${AD_BASE_DN}`;
const AD_DEFAULT_PASSWORD = "@Dovale123";

// ── Microsys Firebird config ──
const fbConfig: Firebird.Options = {
  host: process.env.DB_FIREBIRD_INV_HOST || "localhost",
  port: Number(process.env.DB_FIREBIRD_INV_PORT) || 3050,
  database: process.env.DB_FIREBIRD_INV_PATH || "C:\\Backup\\MICROSYS\\MSYSDADOS_FORTALEZA.FDB",
  user: process.env.DB_FIREBIRD_INV_USER || "SYSDBA",
  password: process.env.DB_FIREBIRD_INV_PASSWORD || "masterkey",
};

function queryFbOnb<T = Record<string, unknown>>(sqlStr: string, params: unknown[] = [], timeout = 30000): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Firebird timeout")), timeout);
    Firebird.attach(fbConfig, (err, db) => {
      if (err) { clearTimeout(timer); return reject(err); }
      db.query(sqlStr, params, (err2, result) => {
        clearTimeout(timer);
        db.detach();
        if (err2) return reject(err2);
        resolve((result ?? []) as T[]);
      });
    });
  });
}

function executeFbOnb(sqlStr: string, params: unknown[] = [], timeout = 60000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Firebird timeout")), timeout);
    Firebird.attach(fbConfig, (err, db) => {
      if (err) { clearTimeout(timer); return reject(err); }
      db.query(sqlStr, params, (err2) => {
        clearTimeout(timer);
        db.detach();
        if (err2) return reject(err2);
        resolve();
      });
    });
  });
}

function md5(s: string): string {
  return createHash("md5").update(s).digest("hex").toUpperCase();
}

// ── Microsys field cipher ──
// Formula: cipher[i] = (plain[i] + key[i%keyLen] - 75) & 0xFF; padding = 0x0D
// Key: USU_NOME for USU_SENHA; USU_NOME + FIELD_NAME for other fields
function msysCipherKey(nome: string, field: string): string {
  return field === 'USU_SENHA' ? nome : nome + field;
}

function msysEncryptBytes(plain: string, fullKey: string, len = 50): number[] {
  const result: number[] = [];
  for (let i = 0; i < len; i++) {
    const p = i < plain.length ? plain.charCodeAt(i) : 13;
    const k = fullKey.charCodeAt(i % fullKey.length);
    result.push((p + k - 75 + 256) % 256);
  }
  return result;
}

function msysDecrypt(cipherStr: string, fullKey: string): string {
  const chars: number[] = [];
  for (let i = 0; i < cipherStr.length; i++) {
    const c = cipherStr.charCodeAt(i);
    const k = fullKey.charCodeAt(i % fullKey.length);
    const p = (c - k + 75 + 256) % 256;
    if (p === 13) break;
    chars.push(p);
  }
  return String.fromCharCode(...chars);
}

function msysEncryptSQL(plain: string, nome: string, field: string, len = 50): string {
  const bytes = msysEncryptBytes(plain, msysCipherKey(nome, field), len);
  return bytes.map(b => `ASCII_CHAR(${b})`).join('||');
}

function msysBytesToSQL(bytes: number[]): string {
  return bytes.map(b => `ASCII_CHAR(${b})`).join('||');
}

function msysRawToSQL(str: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i));
  return bytes.map(b => `ASCII_CHAR(${b})`).join('||');
}

function msysIsToggleValue(value: string): boolean {
  const v = (value || '').trim().toUpperCase();
  return v === 'LIGADO' || v === 'DESLIGADO';
}

/**
 * Re-encrypt USUARIOS_MENUS fields after bulk INSERT...SELECT.
 * USUMENU_MENU: key = nome
 * Permission fields: key = nome + decrypted(USUMENU_MENU)
 */
async function reencryptMenus(
  srcCodigo: number, tgtCodigo: number,
  srcNome: string, tgtNome: string
): Promise<number> {
  const src = srcNome.trim();
  const tgt = tgtNome.trim();

  const srcMenus = await queryFbOnb<any>(
    `SELECT USUMENU_MENU, USUMENU_ATIVO, USUMENU_INCLUIR,
       USUMENU_ALTERAR, USUMENU_EXCLUIR, USUMENU_IMPRIMIR, USUMENU_FILTRAR
     FROM USUARIOS_MENUS WHERE USUMENU_USU_CODIGO = ?`,
    [srcCodigo]
  );

  const PERM_FIELDS = ['USUMENU_ATIVO','USUMENU_INCLUIR','USUMENU_ALTERAR','USUMENU_EXCLUIR','USUMENU_IMPRIMIR','USUMENU_FILTRAR'] as const;
  const BATCH = 40;
  let updated = 0;

  for (let i = 0; i < srcMenus.length; i += BATCH) {
    const batch = srcMenus.slice(i, i + BATCH);
    let sql = 'EXECUTE BLOCK AS\nBEGIN\n';

    for (const m of batch) {
      if (!m.USUMENU_MENU) continue;
      const menuPlain = msysDecrypt(m.USUMENU_MENU, src);
      const newMenuBytes = msysEncryptBytes(menuPlain, tgt, m.USUMENU_MENU.length);
      const oldMenuSQL = msysRawToSQL(m.USUMENU_MENU);

      const srcPermKey = src + menuPlain;
      const tgtPermKey = tgt + menuPlain;

      const setClauses: string[] = [`USUMENU_MENU = ${msysBytesToSQL(newMenuBytes)}`];
      for (const f of PERM_FIELDS) {
        if (m[f]) {
          const plain = msysDecrypt(m[f], srcPermKey);
          const bytes = msysEncryptBytes(plain, tgtPermKey, m[f].length);
          setClauses.push(`${f} = ${msysBytesToSQL(bytes)}`);
        }
      }

      sql += `  UPDATE USUARIOS_MENUS SET ${setClauses.join(', ')}\n`;
      sql += `    WHERE USUMENU_USU_CODIGO = ${tgtCodigo} AND USUMENU_MENU = ${oldMenuSQL};\n`;
      updated++;
    }

    sql += 'END';
    await executeFbOnb(sql, [], 120000);
  }

  return updated;
}

const PS_ENCODING = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8;";

/** Run a PowerShell command and return parsed JSON */
async function psJson<T = any>(script: string): Promise<T> {
  const { stdout, stderr } = await execFileAsync("powershell", [
    "-NoProfile", "-NonInteractive", "-Command",
    `${PS_ENCODING} Import-Module ActiveDirectory -ErrorAction Stop; ${script}`,
  ], { timeout: 30000, encoding: "utf8" });
  if (stderr?.trim()) console.warn("[onboarding] PS stderr:", stderr.trim());
  const trimmed = stdout.trim();
  if (!trimmed) return [] as unknown as T;
  return JSON.parse(trimmed);
}

/** Run a PowerShell command (no JSON output expected) */
async function psExec(script: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync("powershell", [
    "-NoProfile", "-NonInteractive", "-Command",
    `${PS_ENCODING} Import-Module ActiveDirectory -ErrorAction Stop; ${script}`,
  ], { timeout: 30000, encoding: "utf8" });
  if (stderr?.trim()) console.warn("[onboarding] PS stderr:", stderr.trim());
  return stdout.trim();
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

/** Escape single quotes for PowerShell strings */
function psEsc(s: string): string {
  return s.replace(/'/g, "''");
}

/** GET /locais — list locations (OUs) under OU=Usuarios */
router.get("/locais", async (_req, res) => {
  try {
    console.log("[onboarding] Buscando locais em:", AD_USERS_OU, "server:", AD_SERVER);
    const locais = await psJson(`
      Get-ADOrganizationalUnit -SearchBase '${psEsc(AD_USERS_OU)}' -SearchScope OneLevel -Filter * -Server '${AD_SERVER}' |
        Select-Object Name, DistinguishedName |
        ConvertTo-Json -Compress
    `);
    const arr = Array.isArray(locais) ? locais : (locais ? [locais] : []);
    console.log("[onboarding] Locais encontrados:", arr.length, arr.map((l: any) => l.Name));
    res.json(arr.map((l: any) => ({ nome: l.Name, dn: l.DistinguishedName })));
  } catch (err: any) {
    console.error("[onboarding] Erro ao listar locais:", err.message);
    console.error("[onboarding] stderr:", err.stderr);
    res.status(500).json({ error: "Erro ao listar locais do AD." });
  }
});

/** GET /setores?local=OU=SJC,OU=Usuarios,DC=dovalechaves,DC=local — list departments under a location */
router.get("/setores", async (req, res) => {
  const localDN = req.query.local as string;
  if (!localDN) return res.status(400).json({ error: "Parâmetro 'local' obrigatório." });

  try {
    console.log("[onboarding] Buscando setores para:", localDN);
    const setores = await psJson(`
      Get-ADOrganizationalUnit -SearchBase '${psEsc(localDN)}' -SearchScope OneLevel -Filter * -Server '${AD_SERVER}' |
        Select-Object Name, DistinguishedName |
        ConvertTo-Json -Compress
    `);
    const arr = Array.isArray(setores) ? setores : (setores ? [setores] : []);
    console.log("[onboarding] Setores encontrados:", arr.length);
    res.json(arr.map((s: any) => ({ nome: s.Name, dn: s.DistinguishedName })));
  } catch (err: any) {
    console.error("[onboarding] Erro ao listar setores:", err.message);
    res.status(500).json({ error: "Erro ao listar setores do AD." });
  }
});

/** GET /usuarios?setor_dn=... — list users in a department OU */
router.get("/usuarios", async (req, res) => {
  const setorDN = req.query.setor_dn as string;
  if (!setorDN) return res.status(400).json({ error: "Parâmetro 'setor_dn' obrigatório." });

  try {
    const raw = await psJson(`
      Get-ADUser -SearchBase '${psEsc(setorDN)}' -SearchScope OneLevel -Filter * -Properties DisplayName, MemberOf -Server '${AD_SERVER}' |
        Select-Object SamAccountName, DisplayName, DistinguishedName, MemberOf |
        ConvertTo-Json -Compress
    `);
    const arr = Array.isArray(raw) ? raw : [raw];
    const usuarios = arr.map((u: any) => ({
      username: u.SamAccountName,
      displayName: u.DisplayName || u.SamAccountName,
      dn: u.DistinguishedName,
      groups: Array.isArray(u.MemberOf) ? u.MemberOf : (u.MemberOf ? [u.MemberOf] : []),
    }));
    res.json(usuarios);
  } catch (err: any) {
    console.error("[onboarding] Erro ao listar usuarios:", err.message);
    res.status(500).json({ error: "Erro ao listar usuários do AD." });
  }
});

/** GET /microsys/usuarios — list Microsys users for copy permissions */
router.get("/microsys/usuarios", async (_req, res) => {
  try {
    const rows = await queryFbOnb<any>(
      `SELECT USU_NOME, USU_CODIGO, USU_NOME_COMPLETO, USU_GRUPO FROM USUARIOS WHERE USU_SITUACAO = 1 ORDER BY USU_NOME`
    );
    const usuarios = rows.map((u: any) => ({
      nome: (u.USU_NOME || "").trim(),
      codigo: u.USU_CODIGO,
      nomeCompleto: (u.USU_NOME_COMPLETO || u.USU_NOME || "").trim(),
      grupo: u.USU_GRUPO,
    }));
    res.json(usuarios);
  } catch (err: any) {
    console.error("[onboarding] Erro ao listar usuários Microsys:", err.message);
    res.status(500).json({ error: "Erro ao listar usuários do Microsys." });
  }
});

/** GET /microsys/diagnostico?source=KEVIN SILVA&target=KEVIN TESTE — compare user permissions */
router.get("/microsys/diagnostico", async (req, res) => {
  const source = req.query.source as string;
  const target = req.query.target as string;
  if (!source || !target) return res.status(400).json({ error: "Parâmetros source e target obrigatórios." });

  try {
    // 1) Compare coded fields on USUARIOS
    const srcUser = await queryFbOnb<any>(
      `SELECT FIRST 1 USU_CODIGO, USU_SENHA, USU_MESTRE, USU_TROCAR, USU_DATAINI, USU_DATAFIM, USU_SENHA_HASH, USU_GRUPO, USU_SITUACAO FROM USUARIOS WHERE USU_NOME = ?`,
      [source]
    );
    const tgtUser = await queryFbOnb<any>(
      `SELECT FIRST 1 USU_CODIGO, USU_SENHA, USU_MESTRE, USU_TROCAR, USU_DATAINI, USU_DATAFIM, USU_SENHA_HASH, USU_GRUPO, USU_SITUACAO FROM USUARIOS WHERE USU_NOME = ?`,
      [target]
    );

    // 2) Find all tables with USU or USUARIO in name
    const allTables = await queryFbOnb<any>(
      `SELECT RDB$RELATION_NAME AS TNAME FROM RDB$RELATIONS WHERE RDB$VIEW_BLR IS NULL AND (RDB$RELATION_NAME CONTAINING 'USU' OR RDB$RELATION_NAME CONTAINING 'SEG' OR RDB$RELATION_NAME CONTAINING 'PAPEL') ORDER BY RDB$RELATION_NAME`
    );

    // 3) For each relevant table, get columns and row counts for source vs target
    const tableDetails: any[] = [];
    const relevantTables = allTables.map((t: any) => (t.TNAME || "").trim()).filter((n: string) => n && !n.startsWith("RDB$"));
    const srcCodigo = srcUser[0]?.USU_CODIGO;
    const tgtCodigo = tgtUser[0]?.USU_CODIGO;

    for (const tbl of relevantTables) {
      try {
        const cols = await queryFbOnb<any>(
          `SELECT RDB$FIELD_NAME AS COLNAME FROM RDB$RELATION_FIELDS WHERE RDB$RELATION_NAME = ? ORDER BY RDB$FIELD_POSITION`,
          [tbl]
        );
        const colNames = cols.map((c: any) => (c.COLNAME || "").trim());

        // Find columns that reference user code or name
        const usuCodeCol = colNames.find((c: string) => c.endsWith("USU_CODIGO") || c === "USU_CODIGO");
        const usuNameCol = colNames.find((c: string) => c.endsWith("USU_NOME") || c === "USU_NOME");
        const usuCol = colNames.find((c: string) => c === "USUARIO" || c.endsWith("_USUARIO"));

        let srcCount = 0;
        let tgtCount = 0;
        let srcRows: any[] = [];
        let tgtRows: any[] = [];

        if (usuCodeCol && srcCodigo && tgtCodigo) {
          srcRows = await queryFbOnb<any>(`SELECT * FROM ${tbl} WHERE ${usuCodeCol} = ?`, [srcCodigo]);
          tgtRows = await queryFbOnb<any>(`SELECT * FROM ${tbl} WHERE ${usuCodeCol} = ?`, [tgtCodigo]);
          srcCount = srcRows.length;
          tgtCount = tgtRows.length;
        } else if (usuNameCol) {
          srcRows = await queryFbOnb<any>(`SELECT * FROM ${tbl} WHERE ${usuNameCol} = ?`, [source]);
          tgtRows = await queryFbOnb<any>(`SELECT * FROM ${tbl} WHERE ${usuNameCol} = ?`, [target]);
          srcCount = srcRows.length;
          tgtCount = tgtRows.length;
        } else if (usuCol) {
          srcRows = await queryFbOnb<any>(`SELECT * FROM ${tbl} WHERE ${usuCol} = ?`, [srcCodigo || source]);
          tgtRows = await queryFbOnb<any>(`SELECT * FROM ${tbl} WHERE ${usuCol} = ?`, [tgtCodigo || target]);
          srcCount = srcRows.length;
          tgtCount = tgtRows.length;
        }

        if (srcCount > 0 || tgtCount > 0) {
          tableDetails.push({
            tabela: tbl,
            colunas: colNames,
            linkCol: usuCodeCol || usuNameCol || usuCol || null,
            sourceCount: srcCount,
            targetCount: tgtCount,
            diff: tgtCount - srcCount,
            sourceSample: srcRows.slice(0, 3),
            targetSample: tgtRows.slice(0, 3),
          });
        }
      } catch { /* skip inaccessible table */ }
    }

    // 4) Compare coded fields
    const fieldCompare: any = {};
    if (srcUser.length > 0 && tgtUser.length > 0) {
      const normalize = (v: any) => (v instanceof Date ? v.toISOString() : (v == null ? null : String(v).trim()));
      for (const key of ["USU_SENHA", "USU_MESTRE", "USU_TROCAR", "USU_DATAINI", "USU_DATAFIM", "USU_SENHA_HASH", "USU_GRUPO", "USU_SITUACAO"]) {
        const sv = normalize(srcUser[0][key]);
        const tv = normalize(tgtUser[0][key]);
        fieldCompare[key] = { source: sv, target: tv, match: sv === tv };
      }
    }

    res.json({
      source: { nome: source, codigo: srcCodigo, fields: srcUser[0] || null },
      target: { nome: target, codigo: tgtCodigo, fields: tgtUser[0] || null },
      fieldCompare,
      tablesWithDifferences: tableDetails.filter((t: any) => t.diff !== 0),
      allPermissionTables: tableDetails,
    });
  } catch (err: any) {
    console.error("[onboarding] Erro no diagnóstico:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/** POST /criar — create AD user */
router.post("/criar", async (req, res) => {
  const { nome_completo, cargo, setor_dn, copiar_de_dn, copiar_de_microsys, sistemas } = req.body ?? {};
  const criarAD = sistemas?.ad !== false;
  const criarMicrosys = sistemas?.microsys !== false;
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
  const email = `${username}@dovale.com.br`;

  // Extract office from DN: OU=TIC,OU=SJC,OU=Usuários,DC=... → SJC
  const ouParts = setor_dn.split(",").filter((p: string) => p.trim().startsWith("OU=")).map((p: string) => p.trim().replace("OU=", ""));
  const office = ouParts.length >= 2 ? ouParts[ouParts.length - 2] : ouParts[0] || "";

  const log: string[] = [];

  try {
    // ── AD Creation ──
    if (criarAD) {
      // Check if username already exists
      try {
        await psExec(`Get-ADUser -Identity '${psEsc(username)}' -Server '${AD_SERVER}' | Out-Null`);
        return res.status(409).json({ error: `Usuário '${username}' já existe no AD.`, log });
      } catch {
        // User not found = good, continue
      }
      log.push(`✅ Username '${username}' disponível`);

      // Create user with New-ADUser
      const titleParam = cargo ? `-Title '${psEsc(cargo)}'` : "";
      const officeParam = office ? `-Office '${psEsc(office)}'` : "";
      await psExec(`
        New-ADUser \`
          -Name '${psEsc(cn)}' \`
          -SamAccountName '${psEsc(username)}' \`
          -UserPrincipalName '${psEsc(upn)}' \`
          -GivenName '${psEsc(firstName)}' \`
          -Surname '${psEsc(lastName)}' \`
          -DisplayName '${psEsc(cn)}' \`
          -Path '${psEsc(setor_dn)}' \`
          -Company 'Dovale Chaves' \`
          -EmailAddress '${psEsc(email)}' \`
          ${officeParam} \`
          -AccountPassword (ConvertTo-SecureString '${psEsc(AD_DEFAULT_PASSWORD)}' -AsPlainText -Force) \`
          -Enabled $true \`
          -ChangePasswordAtLogon $true \`
          ${titleParam} \`
          -Server '${AD_SERVER}'
      `);
      log.push(`✅ AD: Usuário criado: ${userDN}`);
      log.push(`✅ AD: Senha definida: ${AD_DEFAULT_PASSWORD}`);
      log.push(`✅ AD: E-mail: ${email}`);
      log.push(`✅ AD: Escritório: ${office}`);
      log.push(`✅ AD: Company: Dovale Chaves`);
      log.push("✅ AD: Conta habilitada + troca de senha obrigatória");
    } else {
      log.push("⏭️ AD: Pulado (não selecionado)");
    }

    // Copy group memberships + scriptPath from existing user (AD)
    let microsysGrupo = 0;
    if (copiar_de_dn && criarAD) {
      try {
        // Get groups and scriptPath from source user
        const sourceData = await psJson(`
          Get-ADUser -Identity '${psEsc(copiar_de_dn)}' -Properties MemberOf, ScriptPath -Server '${AD_SERVER}' |
            Select-Object MemberOf, ScriptPath |
            ConvertTo-Json -Compress
        `);
        const source = Array.isArray(sourceData) ? sourceData[0] : sourceData;
        const groups: string[] = source?.MemberOf
          ? (Array.isArray(source.MemberOf) ? source.MemberOf : [source.MemberOf])
          : [];

        // Copy scriptPath (login script / bat do Microsys)
        if (source?.ScriptPath) {
          try {
            await psExec(`Set-ADUser -Identity '${psEsc(username)}' -ScriptPath '${psEsc(source.ScriptPath)}' -Server '${AD_SERVER}'`);
            log.push(`✅ ScriptPath copiado: ${source.ScriptPath}`);
          } catch (spErr: any) {
            log.push(`⚠️ Erro ao copiar scriptPath: ${spErr.message}`);
          }
        }

        // Copy groups
        let copied = 0;
        for (const groupDN of groups) {
          try {
            await psExec(`Add-ADGroupMember -Identity '${psEsc(groupDN)}' -Members '${psEsc(username)}' -Server '${AD_SERVER}'`);
            copied++;
          } catch (grpErr: any) {
            log.push(`⚠️ Erro ao adicionar ao grupo ${groupDN.split(",")[0]}: ${grpErr.message}`);
          }
        }
        log.push(`✅ ${copied}/${groups.length} grupos copiados de ${copiar_de_dn.split(",")[0]}`);

      } catch (copyErr: any) {
        log.push("⚠️ Erro ao copiar grupos AD: " + copyErr.message);
      }
    }

    // ── Create Microsys user + copy ALL permissions ──
    if (criarMicrosys) try {
      const msysName = cn
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .substring(0, 15);
      const MSYS_DEFAULT_PASSWORD = "123";
      const senhaHash = md5(MSYS_DEFAULT_PASSWORD);

      // Get next USU_CODIGO
      const maxRow = await queryFbOnb<any>(`SELECT MAX(USU_CODIGO) as MAX_COD FROM USUARIOS`);
      const nextCodigo = (maxRow[0]?.MAX_COD || 0) + 1;

      // Check if USU_NOME already exists
      const existing = await queryFbOnb<any>(`SELECT USU_NOME FROM USUARIOS WHERE USU_NOME = ?`, [msysName]);
      if (existing.length > 0) {
        log.push(`⚠️ Microsys: usuário '${msysName}' já existe, pulando criação`);
      } else {
        const CONFIG_COLS = [
          "USU_GRUPO", "USU_LIMITEMP", "USU_LIMITEOUTROS", "USU_MENSAGEM",
          "USU_FILTRO_PDVS", "USU_FUN_CODIGO", "USU_VEN_CODIGO", "USU_IND_AST_TIPO",
          "USU_PERIODO_FERIAS", "USU_EDITA_QTDE_LIDA_CARGTO", "USU_DUPLICA_PROCTRIB_DUP_PROD",
          "USU_DUPLICA_FICHA_DUP_PROD", "USU_DESCONTO_ADICIONAL", "USU_PDC_LIBERACAO",
          "USU_PDC_PRAZO_ENTREGA", "USU_ORV_PRAZO_ENTREGA", "USU_PROUTO_CUSTO_FISCAL",
          "USU_PROUTO_FICHA_TECNICA", "USU_EDITA_PRO_ABA_FISCAL", "USU_ORI_APROVACAO",
          "USU_ORC_LIBERACAO", "USU_PDC_VER_LIBERACAO", "USU_PDV_LIB_COMERCIAL",
          "USU_PDV_LIB_FINANCEIRO", "USU_FILTRO_PDC", "USU_ABRIR_REQUISICAO_ANTIGA",
          "USU_ESTOQUE_NEGATIVO", "USU_ESTOQUE_MINIMO", "USU_MOSTRAR_COMPARATIVO",
          "USU_OSL_VER_LIBERACAO", "USU_ALTERA_JUROS_BAIXAS", "USU_FILTRO_TELEVENDA",
          "USU_MENUS_MAIS_ACESSADO", "USU_FILTRO_TAREFAS", "USU_EXIBE_PROGRAMACAO_SEMANAL",
          "USU_STATUS_IMP_PDV_BLOQUEADOS", "USU_DESCONTO_FINANCEIRO",
          "USU_PERM_REQU_ENTRADA", "USU_VER_ISENCAO_VALIDADE", "USU_DESABILITA_PRINTSCREEN",
          "USU_VER_PROJ_ALTERACAO", "USU_FILTRO_SETOR_PCM", "USU_EXIBE_ROTEIRO_PRODUTO",
          "USU_FILTRO_ASSISTENCIA", "USU_PDC_FILTRO_REGIME", "USU_PDV_LIB_FISCAL",
          "USU_EXCLUIR_IMAGEM_PRODUTO", "USU_GERA_PDV_SALDO_SEP_VOL",
          "USU_ORC_ADITIVO_APROVAR", "USU_VIS_TAB_PRECO_CAD_PRO",
        ];

        let sourceCodigo: number | null = null;
        let sourceRow: Record<string, any> | null = null;
        let sourceNome: string | null = null;
        let senhaTemplate: {
          USU_SENHA: any;
          USU_MESTRE: any;
          USU_TROCAR: any;
          USU_DATAINI: any;
          USU_DATAFIM: any;
        } | null = null;

        // 1) Fetch config columns from source user if copying
        log.push(`📋 Microsys: copiar_de_microsys='${copiar_de_microsys || ""}' criarMicrosys=${criarMicrosys}`);
        if (copiar_de_microsys) {
          try {
            const rows = await queryFbOnb<any>(
              `SELECT FIRST 1
                 USU_CODIGO,
                 USU_SENHA,
                 USU_MESTRE,
                 USU_TROCAR,
                 USU_DATAINI,
                 USU_DATAFIM,
                 ${CONFIG_COLS.join(", ")}
               FROM USUARIOS
               WHERE USU_NOME = ?`,
              [copiar_de_microsys]
            );
            if (rows.length > 0) {
              sourceRow = rows[0];
              sourceCodigo = rows[0].USU_CODIGO;
              sourceNome = (copiar_de_microsys || '').trim();
              microsysGrupo = rows[0].USU_GRUPO ?? 0;
              if (
                rows[0].USU_SENHA != null &&
                rows[0].USU_MESTRE != null &&
                rows[0].USU_TROCAR != null &&
                rows[0].USU_DATAINI != null &&
                rows[0].USU_DATAFIM != null
              ) {
                senhaTemplate = {
                  USU_SENHA: rows[0].USU_SENHA,
                  USU_MESTRE: rows[0].USU_MESTRE,
                  USU_TROCAR: rows[0].USU_TROCAR,
                  USU_DATAINI: rows[0].USU_DATAINI,
                  USU_DATAFIM: rows[0].USU_DATAFIM,
                };
                log.push(`✅ Microsys: credenciais/datas codificadas copiadas de '${copiar_de_microsys}'`);
              }
              log.push(`✅ Microsys: fonte '${copiar_de_microsys}' (código ${sourceCodigo}, grupo ${microsysGrupo})`);
            }
          } catch (srcErr: any) {
            log.push(`⚠️ Erro ao buscar fonte Microsys: ${srcErr.message}`);
          }
        }

        if (!senhaTemplate) {
          try {
            const templateRows = await queryFbOnb<any>(
              `SELECT FIRST 1 USU_NOME, USU_SENHA, USU_MESTRE, USU_TROCAR, USU_DATAINI, USU_DATAFIM
               FROM USUARIOS
               WHERE USU_SENHA_HASH = ?
                 AND USU_SENHA IS NOT NULL
                 AND USU_MESTRE IS NOT NULL
                 AND USU_TROCAR IS NOT NULL
                 AND USU_DATAINI IS NOT NULL
                 AND USU_DATAFIM IS NOT NULL
               ORDER BY USU_CODIGO DESC`,
              [senhaHash]
            );
            if (templateRows.length > 0) {
              sourceNome = (templateRows[0].USU_NOME || '').trim();
              senhaTemplate = templateRows[0];
              log.push(`✅ Microsys: credenciais/datas codificadas copiadas de template '${sourceNome}'`);
            }
          } catch {
            // segue para validação obrigatória abaixo
          }
        }

        if (!senhaTemplate) {
          throw new Error("Microsys: não foi possível obter campos codificados (USU_SENHA/USU_MESTRE/USU_TROCAR/USU_DATAINI/USU_DATAFIM). Configure um usuário-base válido para copiar.");
        }

        const baseCols = [
          "USU_NOME", "USU_CODIGO", "USU_NOME_COMPLETO", "USU_SENHA_HASH",
          "USU_SITUACAO"
        ];
        const baseVals: any[] = [
          msysName,
          nextCodigo,
          cn.substring(0, 60),
          senhaHash,
          1,
        ];

        if (sourceRow) {
          const copyCols = CONFIG_COLS.filter(c => sourceRow![c] !== undefined);
          const allCols = [...baseCols, ...copyCols];
          const paramPlaceholders = allCols.map(() => "?").join(", ");
          const values = [...baseVals, ...copyCols.map(c => sourceRow![c])];
          await executeFbOnb(
            `INSERT INTO USUARIOS (${allCols.join(", ")}) VALUES (${paramPlaceholders})`,
            values
          );
          log.push(`✅ Microsys: usuário '${msysName}' criado com ${copyCols.length} configurações copiadas (código ${nextCodigo}, grupo ${microsysGrupo})`);
        } else {
          await executeFbOnb(
            `INSERT INTO USUARIOS (${baseCols.join(", ")}, USU_GRUPO) VALUES (${baseCols.map(() => "?").join(", ")}, ?)`,
            [...baseVals, microsysGrupo]
          );
          log.push(`✅ Microsys: usuário '${msysName}' criado (código ${nextCodigo}, grupo ${microsysGrupo})`);
        }

        // Re-encrypt fields for target user using Microsys cipher
        const targetNome = msysName.trim();
        if (!sourceNome) {
          throw new Error("Microsys: nome do usuário fonte não disponível para decodificação.");
        }
        const plainMestre = msysDecrypt(senhaTemplate.USU_MESTRE, msysCipherKey(sourceNome, 'USU_MESTRE'));
        const plainTrocar = msysDecrypt(senhaTemplate.USU_TROCAR, msysCipherKey(sourceNome, 'USU_TROCAR'));
        const plainDataIni = msysDecrypt(senhaTemplate.USU_DATAINI, msysCipherKey(sourceNome, 'USU_DATAINI'));
        const plainDataFim = msysDecrypt(senhaTemplate.USU_DATAFIM, msysCipherKey(sourceNome, 'USU_DATAFIM'));
        const plainSenha = AD_DEFAULT_PASSWORD;

        log.push(`📋 Microsys cipher: source='${sourceNome}' → target='${targetNome}' MESTRE=${plainMestre} TROCAR=${plainTrocar} DATAINI=${plainDataIni} DATAFIM=${plainDataFim}`);

        await executeFbOnb(
          `UPDATE USUARIOS SET
            USU_SENHA = ${msysEncryptSQL(plainSenha, targetNome, 'USU_SENHA')},
            USU_MESTRE = ${msysEncryptSQL(plainMestre, targetNome, 'USU_MESTRE')},
            USU_TROCAR = ${msysEncryptSQL(plainTrocar, targetNome, 'USU_TROCAR')},
            USU_DATAINI = ${msysEncryptSQL(plainDataIni, targetNome, 'USU_DATAINI')},
            USU_DATAFIM = ${msysEncryptSQL(plainDataFim, targetNome, 'USU_DATAFIM')}
          WHERE USU_CODIGO = ?`,
          [nextCodigo]
        );
        log.push(`✅ Microsys: campos codificados re-criptografados para '${targetNome}'`);

        // Validate by decrypting stored values
        const createdRows = await queryFbOnb<any>(
          `SELECT FIRST 1 USU_SENHA, USU_MESTRE, USU_TROCAR, USU_DATAINI, USU_DATAFIM
           FROM USUARIOS WHERE USU_CODIGO = ?`,
          [nextCodigo]
        );
        if (createdRows.length === 0) {
          throw new Error(`Microsys: usuário criado não encontrado para validação (código ${nextCodigo}).`);
        }
        const cr = createdRows[0];
        const checkFields: [string, string, string][] = [
          ['USU_SENHA', msysDecrypt(cr.USU_SENHA, msysCipherKey(targetNome, 'USU_SENHA')), plainSenha],
          ['USU_MESTRE', msysDecrypt(cr.USU_MESTRE, msysCipherKey(targetNome, 'USU_MESTRE')), plainMestre],
          ['USU_TROCAR', msysDecrypt(cr.USU_TROCAR, msysCipherKey(targetNome, 'USU_TROCAR')), plainTrocar],
          ['USU_DATAINI', msysDecrypt(cr.USU_DATAINI, msysCipherKey(targetNome, 'USU_DATAINI')), plainDataIni],
          ['USU_DATAFIM', msysDecrypt(cr.USU_DATAFIM, msysCipherKey(targetNome, 'USU_DATAFIM')), plainDataFim],
        ];
        const diffs = checkFields.filter(([, got, expected]) => got !== expected);
        if (diffs.length > 0) {
          const detail = diffs.map(([f, got, exp]) => `${f}(expected='${exp}',got='${got}')`).join(', ');
          throw new Error(`Microsys: campos codificados divergentes após UPDATE: ${detail}`);
        }
        log.push("✅ Microsys: validação dos campos codificados OK (senha/mestre/troca/dataini/datafim)");
        
        if (copiar_de_microsys) {
          if (sourceCodigo != null) {
            try {
              const filiais = await queryFbOnb<any>(
                `SELECT UFL_FIL_CODIGO, UFL_PADRAO, UFL_IND_RELATORIOS, UFL_ESTOQUE
                 FROM USUARIOS_FILIAIS WHERE UFL_USU_CODIGO = ?`,
                [sourceCodigo]
              );
              let filCopied = 0;
              for (const f of filiais) {
                try {
                  await executeFbOnb(
                    `INSERT INTO USUARIOS_FILIAIS (UFL_USU_CODIGO, UFL_FIL_CODIGO, UFL_PADRAO, UFL_IND_RELATORIOS, UFL_USU_OPERADOR, UFL_USU_DATA, UFL_ESTOQUE)
                     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
                    [nextCodigo, f.UFL_FIL_CODIGO, f.UFL_PADRAO, f.UFL_IND_RELATORIOS, nextCodigo, f.UFL_ESTOQUE]
                  );
                  filCopied++;
                } catch { /* skip */ }
              }
              log.push(`✅ Microsys: ${filCopied}/${filiais.length} filiais copiadas`);
            } catch (filErr: any) {
              log.push(`⚠️ Microsys filiais: ${filErr.message}`);
            }
          }
          log.push(`📋 Microsys menus: sourceCodigo=${sourceCodigo} nextCodigo=${nextCodigo} msysName='${msysName}'`);
          if (sourceCodigo != null) {
            try {
              const srcMenuCnt = await queryFbOnb<any>(`SELECT COUNT(*) as CNT FROM USUARIOS_MENUS WHERE USUMENU_USU_CODIGO = ?`, [sourceCodigo]);
              const totalMenus = srcMenuCnt[0]?.CNT || 0;
              await executeFbOnb(
                `INSERT INTO USUARIOS_MENUS (USUMENU_NOME, USUMENU_MENU, USUMENU_ATIVO, USUMENU_INCLUIR,
                  USUMENU_ALTERAR, USUMENU_EXCLUIR, USUMENU_IMPRIMIR, USUMENU_FILTRAR,
                  USUMENU_CODIGO, USUMENU_USU_CODIGO, USUMENU_USU_DATA, USUMENU_DESCRICAO, USUMENU_MNU_MENU)
                 SELECT ?, USUMENU_MENU, USUMENU_ATIVO, USUMENU_INCLUIR,
                  USUMENU_ALTERAR, USUMENU_EXCLUIR, USUMENU_IMPRIMIR, USUMENU_FILTRAR,
                  USUMENU_CODIGO, ?, CURRENT_TIMESTAMP, USUMENU_DESCRICAO, USUMENU_MNU_MENU
                 FROM USUARIOS_MENUS WHERE USUMENU_USU_CODIGO = ?`,
                [msysName, nextCodigo, sourceCodigo]
              );
              // Re-encrypt menu fields for target user
              const reencrypted = await reencryptMenus(sourceCodigo!, nextCodigo, sourceNome!, msysName);
              log.push(`✅ Microsys: ${totalMenus} menus copiados, ${reencrypted} re-criptografados`);
            } catch (menuErr: any) {
              log.push(`⚠️ Microsys menus: ${menuErr.message}`);
            }
          }

          if (sourceCodigo != null) {
            try {
              const srcCntRow = await queryFbOnb<any>(
                `SELECT COUNT(DISTINCT RSU_RELATORIO_ID) as CNT
                 FROM RELATORIOS_SISTEMA_USUARIOS
                 WHERE RSU_USUARIO = ?`,
                [sourceCodigo]
              );
              const totalRelats = srcCntRow[0]?.CNT || 0;

              await executeFbOnb(`DELETE FROM RELATORIOS_SISTEMA_USUARIOS WHERE RSU_USUARIO = ?`, [nextCodigo]);

              try {
                await executeFbOnb(
                  `INSERT INTO RELATORIOS_SISTEMA_USUARIOS (RSU_ID, RSU_RELATORIO_ID, RSU_USUARIO)
                   SELECT GEN_ID(GEN_RELATORIOS_SISTEMA_USUARIOS, 1), RSU_RELATORIO_ID, ?
                   FROM RELATORIOS_SISTEMA_USUARIOS
                   WHERE RSU_USUARIO = ?
                   GROUP BY RSU_RELATORIO_ID`,
                  [nextCodigo, sourceCodigo]
                );
              } catch {
              }

              const tgtCntRow = await queryFbOnb<any>(
                `SELECT COUNT(*) as CNT FROM RELATORIOS_SISTEMA_USUARIOS WHERE RSU_USUARIO = ?`,
                [nextCodigo]
              );
              const copied = tgtCntRow[0]?.CNT || 0;

              if (copied === totalRelats) {
                log.push(`✅ Microsys: ${copied}/${totalRelats} relatórios copiados`);
              } else if (copied > 0) {
                const missing = await queryFbOnb<any>(
                  `SELECT DISTINCT src.RSU_RELATORIO_ID
                   FROM RELATORIOS_SISTEMA_USUARIOS src
                   WHERE src.RSU_USUARIO = ?
                     AND NOT EXISTS (
                       SELECT 1 FROM RELATORIOS_SISTEMA_USUARIOS tgt
                       WHERE tgt.RSU_USUARIO = ? AND tgt.RSU_RELATORIO_ID = src.RSU_RELATORIO_ID
                     )`,
                  [sourceCodigo, nextCodigo]
                );
                let extraCopied = 0;
                for (const m of missing) {
                  try {
                    await executeFbOnb(
                      `INSERT INTO RELATORIOS_SISTEMA_USUARIOS (RSU_ID, RSU_RELATORIO_ID, RSU_USUARIO)
                       VALUES (GEN_ID(GEN_RELATORIOS_SISTEMA_USUARIOS, 1), ?, ?)`,
                      [m.RSU_RELATORIO_ID, nextCodigo]
                    );
                    extraCopied++;
                  } catch { /* skip */ }
                }
                const total = copied + extraCopied;
                log.push(`✅ Microsys: ${total}/${totalRelats} relatórios copiados (${extraCopied} via fallback)`);
              } else {
                log.push(`⚠️ Microsys: 0/${totalRelats} relatórios copiados`);
              }
            } catch (relErr: any) {
              log.push(`⚠️ Microsys relatórios: ${relErr.message}`);
            }
          }

          try {
            const dinams = await queryFbOnb<any>(
              `SELECT RDU_RDI_ID FROM RELATORIO_DINAMICO_USUARIOS WHERE RDU_USU_NOME = ?`,
              [copiar_de_microsys]
            );
            if (dinams.length > 0) {
              let dinCopied = 0;
              for (const d of dinams) {
                try {
                  await executeFbOnb(
                    `INSERT INTO RELATORIO_DINAMICO_USUARIOS (RDU_RDI_ID, RDU_USU_NOME) VALUES (?, ?)`,
                    [d.RDU_RDI_ID, msysName]
                  );
                  dinCopied++;
                } catch { /* skip */ }
              }
              log.push(`✅ Microsys: ${dinCopied}/${dinams.length} relatórios dinâmicos copiados`);
            }
          } catch { /* empty table ok */ }

          if (sourceCodigo != null) {
            try {
              const roles = await queryFbOnb<any>(
                `SELECT UPA_PAP_ID FROM SEG_USUARIO_PAPEL WHERE UPA_USU_CODIGO = ?`,
                [sourceCodigo]
              );
              let rolesCopied = 0;
              for (const r of roles) {
                try {
                  const maxUpa = await queryFbOnb<any>(`SELECT MAX(UPA_ID) as MX FROM SEG_USUARIO_PAPEL`);
                  const nextUpa = (maxUpa[0]?.MX || 0) + 1;
                  await executeFbOnb(
                    `INSERT INTO SEG_USUARIO_PAPEL (UPA_ID, UPA_PAP_ID, UPA_USU_CODIGO, UPA_USU_DATA)
                     VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
                    [nextUpa, r.UPA_PAP_ID, nextCodigo]
                  );
                  rolesCopied++;
                } catch { /* skip */ }
              }
              log.push(`✅ Microsys: ${rolesCopied}/${roles.length} papéis copiados`);
            } catch (roleErr: any) {
              log.push(`⚠️ Microsys papéis: ${roleErr.message}`);
            }
          }
        }
      }
    } catch (msysErr: any) {
      log.push("⚠️ Erro ao criar usuário no Microsys: " + msysErr.message);
    } else if (!criarMicrosys) {
      log.push("⏭️ Microsys: Pulado (não selecionado)");
    }

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
  }
});

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

/** PATCH /microsys/resync-menus — delete target menus and bulk re-copy from source by USU_CODIGO */
router.patch("/microsys/resync-menus", async (req, res) => {
  const { source_nome, target_nome } = req.body ?? {};
  if (!source_nome || !target_nome) return res.status(400).json({ error: "source_nome e target_nome obrigatórios." });

  try {
    const srcRow = await queryFbOnb<any>(`SELECT FIRST 1 USU_CODIGO FROM USUARIOS WHERE USU_NOME = ?`, [source_nome]);
    const tgtRow = await queryFbOnb<any>(`SELECT FIRST 1 USU_CODIGO FROM USUARIOS WHERE USU_NOME = ?`, [target_nome]);
    if (!srcRow.length) return res.status(404).json({ error: `Usuário fonte '${source_nome}' não encontrado.` });
    if (!tgtRow.length) return res.status(404).json({ error: `Usuário alvo '${target_nome}' não encontrado.` });
    const srcCodigo = srcRow[0].USU_CODIGO;
    const tgtCodigo = tgtRow[0].USU_CODIGO;

    // Count source menus
    const cntRow = await queryFbOnb<any>(`SELECT COUNT(*) as CNT FROM USUARIOS_MENUS WHERE USUMENU_USU_CODIGO = ?`, [srcCodigo]);
    const sourceCount = cntRow[0]?.CNT || 0;

    // Delete existing target menus
    await executeFbOnb(`DELETE FROM USUARIOS_MENUS WHERE USUMENU_USU_CODIGO = ?`, [tgtCodigo]);

    const sourceMenus = await queryFbOnb<any>(
      `SELECT TRIM(USUMENU_NOME) AS SRC_MENU_NOME,
              USUMENU_MENU, USUMENU_ATIVO, USUMENU_INCLUIR, USUMENU_ALTERAR,
              USUMENU_EXCLUIR, USUMENU_IMPRIMIR, USUMENU_FILTRAR,
              USUMENU_CODIGO, USUMENU_DESCRICAO, USUMENU_MNU_MENU
       FROM USUARIOS_MENUS
       WHERE USUMENU_USU_CODIGO = ?`,
      [srcCodigo]
    );

    const srcNomeFallback = (source_nome || '').trim();
    const tgtNomeTrimmed = (target_nome || '').trim();
    const seenMenus = new Set<string>();

    let inserted = 0;
    let skippedInvalid = 0;
    let skippedDuplicate = 0;

    for (const row of sourceMenus) {
      const srcMenuNome = ((row.SRC_MENU_NOME || '') as string).trim() || srcNomeFallback;
      if (!srcMenuNome || !row.USUMENU_MENU) {
        skippedInvalid++;
        continue;
      }

      const menuPlain = msysDecrypt(row.USUMENU_MENU, srcMenuNome);
      if (!menuPlain) {
        skippedInvalid++;
        continue;
      }

      if (seenMenus.has(menuPlain)) {
        skippedDuplicate++;
        continue;
      }
      seenMenus.add(menuPlain);

      const menuBytes = msysEncryptBytes(menuPlain, tgtNomeTrimmed, row.USUMENU_MENU.length || 50);
      const srcPermKey = srcMenuNome + menuPlain;
      const tgtPermKey = tgtNomeTrimmed + menuPlain;

      const permFields = ['USUMENU_ATIVO','USUMENU_INCLUIR','USUMENU_ALTERAR','USUMENU_EXCLUIR','USUMENU_IMPRIMIR','USUMENU_FILTRAR'] as const;
      const permSQL: Record<(typeof permFields)[number], string> = {
        USUMENU_ATIVO: msysBytesToSQL(msysEncryptBytes('LIGADO', tgtPermKey, 50)),
        USUMENU_INCLUIR: msysBytesToSQL(msysEncryptBytes('LIGADO', tgtPermKey, 50)),
        USUMENU_ALTERAR: msysBytesToSQL(msysEncryptBytes('LIGADO', tgtPermKey, 50)),
        USUMENU_EXCLUIR: msysBytesToSQL(msysEncryptBytes('LIGADO', tgtPermKey, 50)),
        USUMENU_IMPRIMIR: msysBytesToSQL(msysEncryptBytes('LIGADO', tgtPermKey, 50)),
        USUMENU_FILTRAR: msysBytesToSQL(msysEncryptBytes('LIGADO', tgtPermKey, 50)),
      };

      for (const f of permFields) {
        const rawVal = row[f];
        if (!rawVal) continue;
        const plainPerm = msysDecrypt(rawVal, srcPermKey);
        const finalPerm = msysIsToggleValue(plainPerm) ? plainPerm : 'LIGADO';
        permSQL[f] = msysBytesToSQL(msysEncryptBytes(finalPerm, tgtPermKey, rawVal.length || 50));
      }

      let descSQL = 'NULL';
      if (row.USUMENU_DESCRICAO) {
        const descPlain = msysDecrypt(row.USUMENU_DESCRICAO, srcMenuNome);
        if (descPlain) {
          descSQL = msysBytesToSQL(msysEncryptBytes(descPlain, tgtNomeTrimmed, row.USUMENU_DESCRICAO.length || 50));
        }
      }

      try {
        await executeFbOnb(
          `INSERT INTO USUARIOS_MENUS (
             USUMENU_NOME, USUMENU_MENU,
             USUMENU_ATIVO, USUMENU_INCLUIR, USUMENU_ALTERAR,
             USUMENU_EXCLUIR, USUMENU_IMPRIMIR, USUMENU_FILTRAR,
             USUMENU_CODIGO, USUMENU_USU_CODIGO, USUMENU_USU_DATA,
             USUMENU_DESCRICAO, USUMENU_MNU_MENU
           ) VALUES (
             ?, ${msysBytesToSQL(menuBytes)},
             ${permSQL.USUMENU_ATIVO}, ${permSQL.USUMENU_INCLUIR}, ${permSQL.USUMENU_ALTERAR},
             ${permSQL.USUMENU_EXCLUIR}, ${permSQL.USUMENU_IMPRIMIR}, ${permSQL.USUMENU_FILTRAR},
             ?, ?, CURRENT_TIMESTAMP,
             ${descSQL}, ?
           )`,
          [tgtNomeTrimmed, row.USUMENU_CODIGO ?? null, tgtCodigo, row.USUMENU_MNU_MENU ?? null]
        );
        inserted++;
      } catch {
        skippedDuplicate++;
      }
    }

    const srcFields = await queryFbOnb<any>(
      `SELECT FIRST 1 USU_SENHA, USU_MESTRE, USU_TROCAR, USU_DATAINI, USU_DATAFIM
       FROM USUARIOS WHERE USU_CODIGO = ?`,
      [srcCodigo]
    );
    if (srcFields.length > 0) {
      const srcNomeTrimmed = (source_nome || '').trim();
      const tgtNomeTrimmed = (target_nome || '').trim();
      const plainMestre = msysDecrypt(srcFields[0].USU_MESTRE, msysCipherKey(srcNomeTrimmed, 'USU_MESTRE'));
      const plainTrocar = msysDecrypt(srcFields[0].USU_TROCAR, msysCipherKey(srcNomeTrimmed, 'USU_TROCAR'));
      const plainDataIni = msysDecrypt(srcFields[0].USU_DATAINI, msysCipherKey(srcNomeTrimmed, 'USU_DATAINI'));
      const plainDataFim = msysDecrypt(srcFields[0].USU_DATAFIM, msysCipherKey(srcNomeTrimmed, 'USU_DATAFIM'));
      const plainSenha = msysDecrypt(srcFields[0].USU_SENHA, msysCipherKey(srcNomeTrimmed, 'USU_SENHA'));
      await executeFbOnb(
        `UPDATE USUARIOS SET
          USU_SENHA = ${msysEncryptSQL(plainSenha, tgtNomeTrimmed, 'USU_SENHA')},
          USU_MESTRE = ${msysEncryptSQL(plainMestre, tgtNomeTrimmed, 'USU_MESTRE')},
          USU_TROCAR = ${msysEncryptSQL(plainTrocar, tgtNomeTrimmed, 'USU_TROCAR')},
          USU_DATAINI = ${msysEncryptSQL(plainDataIni, tgtNomeTrimmed, 'USU_DATAINI')},
          USU_DATAFIM = ${msysEncryptSQL(plainDataFim, tgtNomeTrimmed, 'USU_DATAFIM')}
        WHERE USU_CODIGO = ?`,
        [tgtCodigo]
      );
    }
  
    const tgtCntRow = await queryFbOnb<any>(`SELECT COUNT(*) as CNT FROM USUARIOS_MENUS WHERE USUMENU_USU_CODIGO = ?`, [tgtCodigo]);
    const targetCount = tgtCntRow[0]?.CNT || 0;

    res.json({
      ok: true,
      source: source_nome,
      target: target_nome,
      sourceMenus: sourceCount,
      copied: targetCount,
      inserted,
      skippedInvalid,
      skippedDuplicate,
    });
  } catch (err: any) {
    console.error("[onboarding] Erro ao resync menus:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
