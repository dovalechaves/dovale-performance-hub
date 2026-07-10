import Firebird from "node-firebird";
import sql from "mssql";
import { getPool } from "../db/sqlserver";

export interface ProductFirstMovementItem {
  codigo: string;
  nome: string;
  tipo: string;
  primeiraMovimentacao: string;
  quantidade: number;
}

export interface ProductFirstMovementRunResult {
  mes: number;
  ano: number;
  totalMes: number;
  novosProdutos: number;
  enviadoChatwoot: boolean;
  produtos: ProductFirstMovementItem[];
  mensagem: string;
}

interface ProductFirstMovementStatus {
  lastRunAt: string | null;
  lastRunResult: {
    mes: number;
    ano: number;
    totalMes: number;
    novosProdutos: number;
    enviadoChatwoot: boolean;
  } | null;
  lastRunError: string | null;
}

type FbRow = {
  PRO_CODIGO?: string;
  PRO_RESUMO?: string;
  PRO_TIPO?: string;
  PRIMEIRA_MOVIMENTACAO?: Date | string;
  QUANTIDADE?: number | string;
};

const TIMEZONE = process.env.APP_TIMEZONE?.trim() || "America/Sao_Paulo";
const STATUS_TABLE = "DOVALE.dbo.PRODUTOS_PRIMEIRA_MOV_STATUS";
const NOTIFIED_TABLE = "DOVALE.dbo.PRODUTOS_NOTIFICADOS_SALDO";

const fbConfig: Firebird.Options = {
  host: process.env.PROD_FIRST_MOV_FB_HOST || process.env.DATABASE_HOST || process.env.DB_FIREBIRD_FAST_HOST || process.env.DB_FIREBIRD_INV_HOST || "localhost",
  port: Number(process.env.PROD_FIRST_MOV_FB_PORT || process.env.DATABASE_PORT || process.env.DB_FIREBIRD_FAST_PORT || process.env.DB_FIREBIRD_INV_PORT || 3050),
  database: process.env.PROD_FIRST_MOV_FB_PATH || process.env.DATABASE_NAME || process.env.DB_FIREBIRD_FAST_PATH || process.env.DB_FIREBIRD_INV_PATH || "",
  user: process.env.PROD_FIRST_MOV_FB_USER || process.env.DATABASE_USER || process.env.DB_FIREBIRD_FAST_USER || process.env.DB_FIREBIRD_INV_USER || "SYSDBA",
  password: process.env.PROD_FIRST_MOV_FB_PASSWORD || process.env.DATABASE_PASSWORD || process.env.DB_FIREBIRD_FAST_PASSWORD || process.env.DB_FIREBIRD_INV_PASSWORD || "masterkey",
};

const CHATWOOT_BASE = process.env.PROD_FIRST_MOV_CHATWOOT_URL || process.env.CW_TI_BASE || "http://192.168.10.181:3000";
const CHATWOOT_TOKEN = process.env.PROD_FIRST_MOV_CHATWOOT_TOKEN || process.env.CW_TI_TOKEN || "o4Y7pWQePkSsSw5uKczFRqZ9";
const CHATWOOT_ACCOUNT_ID = Number(process.env.PROD_FIRST_MOV_CHATWOOT_ACCOUNT_ID || process.env.CW_TI_ACCOUNT || 1);
const CHATWOOT_CONVERSATION_ID = Number(process.env.PROD_FIRST_MOV_CHATWOOT_CONVERSATION_ID || 106);
const PRODUCT_MIN_DATE = process.env.PROD_FIRST_MOV_PRODUCT_MIN_DATE || "2025-01-01";
const MOVEMENT_MIN_DATE = process.env.PROD_FIRST_MOV_MOVEMENT_MIN_DATE || "2026-04-02";

let cachedStatus: ProductFirstMovementStatus = {
  lastRunAt: null,
  lastRunResult: null,
  lastRunError: null,
};

function ensureFirebirdConfigured() {
  if (!fbConfig.database) {
    throw new Error("Banco Firebird da automação de primeira movimentação não configurado.");
  }
}

function getCurrentMonthYear() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === "year")?.value || new Date().getFullYear());
  const month = Number(parts.find((p) => p.type === "month")?.value || new Date().getMonth() + 1);
  return { month, year };
}

function queryFirebirdOnDemand<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  ensureFirebirdConfigured();
  return new Promise((resolve, reject) => {
    Firebird.attach(fbConfig, (err, db) => {
      if (err) return reject(err);
      db.query(query, params, (err2, result) => {
        db.detach();
        if (err2) return reject(err2);
        resolve((result ?? []) as T[]);
      });
    });
  });
}

function normalizeItem(row: FbRow): ProductFirstMovementItem {
  const rawDate = row.PRIMEIRA_MOVIMENTACAO;
  const date = rawDate instanceof Date ? rawDate : new Date(String(rawDate));
  return {
    codigo: String(row.PRO_CODIGO || "").trim(),
    nome: String(row.PRO_RESUMO || "").trim(),
    tipo: String(row.PRO_TIPO || "").trim(),
    primeiraMovimentacao: Number.isNaN(date.getTime()) ? String(rawDate || "") : date.toISOString(),
    quantidade: Number(row.QUANTIDADE || 0),
  };
}

export async function getMonthlyFirstMovementProducts(month?: number, year?: number): Promise<ProductFirstMovementItem[]> {
  const { month: currentMonth, year: currentYear } = getCurrentMonthYear();
  const mes = month ?? currentMonth;
  const ano = year ?? currentYear;

  const rows = await queryFirebirdOnDemand<FbRow>(
    `SELECT
       TRIM(p.pro_codigo) AS PRO_CODIGO,
       p.pro_resumo AS PRO_RESUMO,
       p.pro_tipo AS PRO_TIPO,
       m.mov_data AS PRIMEIRA_MOVIMENTACAO,
       MIN(m.mov_quantidade) AS QUANTIDADE
     FROM produtos p
     INNER JOIN produtos_movimentos m ON m.mov_pro_codigo = p.pro_codigo
     WHERE p.pro_tipo IN ('PA', 'PR')
       AND p.pro_datacadastro >= CAST(? AS DATE)
       AND m.mov_data = (
         SELECT MIN(m2.mov_data)
         FROM produtos_movimentos m2
         WHERE m2.mov_pro_codigo = p.pro_codigo
       )
       AND EXTRACT(YEAR FROM m.mov_data) = ?
       AND EXTRACT(MONTH FROM m.mov_data) = ?
     GROUP BY p.pro_codigo, p.pro_resumo, p.pro_tipo, m.mov_data
     ORDER BY m.mov_data DESC, p.pro_codigo`,
    [PRODUCT_MIN_DATE, ano, mes]
  );

  // ── DIAG: find entry tables ──
  try {
    const tables = await queryFirebirdOnDemand<Record<string, unknown>>(
      `SELECT TRIM(rdb$relation_name) AS TBL
       FROM rdb$relations
       WHERE rdb$system_flag = 0
         AND (rdb$relation_name LIKE '%NOTA%' OR rdb$relation_name LIKE '%ENTRADA%' OR rdb$relation_name LIKE '%ESTOQUE%')
       ORDER BY rdb$relation_name`, []
    );
    console.log("[DIAG] Tables matching NOTA/ENTRADA/ESTOQUE:", JSON.stringify(tables.map((t: any) => t.TBL)));
  } catch (e: any) { console.log("[DIAG] erro tables:", e.message); }
  try {
    const diag2 = await queryFirebirdOnDemand<Record<string, unknown>>(
      `SELECT FIRST 5 nfi.nfi_pro_codigo, nf.nof_data, nfi.nfi_quantidade, nf.nof_numero
       FROM notas_fiscais_itens nfi
       INNER JOIN notas_fiscais nf ON nf.nof_numero = nfi.nfi_nof_numero
       WHERE nfi.nfi_pro_codigo = '51127'
       ORDER BY nf.nof_data`, []
    );
    console.log("[DIAG-51127] notas_fiscais:", JSON.stringify(diag2, null, 2));
  } catch (e: any) { console.log("[DIAG-51127] erro notas_fiscais:", e.message); }
  // ── END DIAG ──

  return rows.map(normalizeItem);
}

async function ensureNotifiedTable(): Promise<void> {
  const pool = await getPool();
  await pool.request().query(`
    IF OBJECT_ID('dbo.PRODUTOS_NOTIFICADOS_SALDO', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.PRODUTOS_NOTIFICADOS_SALDO (
        PRO_CODIGO VARCHAR(30) NOT NULL PRIMARY KEY,
        PRO_RESUMO VARCHAR(255) NULL,
        PRO_TIPO VARCHAR(10) NULL,
        PRIMEIRA_ENTRADA DATE NULL,
        QUANTIDADE DECIMAL(15,4) NULL,
        NOTIFICADO_EM DATETIME DEFAULT GETDATE()
      );
    END
  `);
}

async function getAlreadyNotifiedCodes(): Promise<Set<string>> {
  await ensureNotifiedTable();
  const pool = await getPool();
  const result = await pool.request().query(`SELECT PRO_CODIGO FROM ${NOTIFIED_TABLE}`);
  return new Set(result.recordset.map((r: { PRO_CODIGO: string }) => String(r.PRO_CODIGO).trim()));
}

async function registerNotifiedProducts(products: ProductFirstMovementItem[]): Promise<void> {
  if (products.length === 0) return;
  await ensureNotifiedTable();
  const pool = await getPool();
  for (const product of products) {
    await pool.request()
      .input("codigo", sql.VarChar(30), product.codigo)
      .input("nome", sql.VarChar(255), product.nome || null)
      .input("tipo", sql.VarChar(10), product.tipo || null)
      .input("data", sql.Date, product.primeiraMovimentacao ? new Date(product.primeiraMovimentacao) : null)
      .input("quantidade", sql.Decimal(15, 4), product.quantidade)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM ${NOTIFIED_TABLE} WHERE PRO_CODIGO = @codigo)
        BEGIN
          INSERT INTO ${NOTIFIED_TABLE} (PRO_CODIGO, PRO_RESUMO, PRO_TIPO, PRIMEIRA_ENTRADA, QUANTIDADE)
          VALUES (@codigo, @nome, @tipo, @data, @quantidade)
        END
      `);
  }
}

function formatChatwootMessage(products: ProductFirstMovementItem[], month: number, year: number): string {
  const header = `📦 *Produtos com primeira movimentação em ${String(month).padStart(2, "0")}/${year}:*`;
  const lines = products.map((product) => {
    const data = product.primeiraMovimentacao
      ? new Date(product.primeiraMovimentacao).toLocaleDateString("pt-BR", { timeZone: TIMEZONE })
      : "—";
    const qtd = Number.isFinite(product.quantidade) ? product.quantidade.toLocaleString("pt-BR") : "0";
    return `- *${product.codigo}* - ${product.nome} (${product.tipo})\n  Data: ${data} | Qtd: ${qtd}`;
  });
  return [header, "", ...lines].join("\n");
}

async function sendChatwootMessage(message: string): Promise<boolean> {
  const response = await fetch(`${CHATWOOT_BASE}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${CHATWOOT_CONVERSATION_ID}/messages`, {
    method: "POST",
    headers: {
      api_access_token: CHATWOOT_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: message,
      message_type: "outgoing",
      private: false,
    }),
  });
  return response.ok;
}

async function ensureStatusTable(): Promise<void> {
  const pool = await getPool();
  await pool.request().query(`
    IF OBJECT_ID('dbo.PRODUTOS_PRIMEIRA_MOV_STATUS', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.PRODUTOS_PRIMEIRA_MOV_STATUS (
        id INT NOT NULL DEFAULT 1 PRIMARY KEY,
        last_run_at DATETIME2 NULL,
        mes INT NULL,
        ano INT NULL,
        total_mes INT NULL,
        novos_produtos INT NULL,
        enviado_chatwoot BIT NULL,
        last_error NVARCHAR(1000) NULL
      );
      INSERT INTO dbo.PRODUTOS_PRIMEIRA_MOV_STATUS (id) VALUES (1);
    END
  `);
}

async function loadStatus(): Promise<void> {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`SELECT TOP 1 * FROM ${STATUS_TABLE}`);
    const row = result.recordset[0];
    if (!row) return;
    cachedStatus = {
      lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
      lastRunResult: row.mes != null ? {
        mes: row.mes,
        ano: row.ano,
        totalMes: row.total_mes ?? 0,
        novosProdutos: row.novos_produtos ?? 0,
        enviadoChatwoot: Boolean(row.enviado_chatwoot),
      } : null,
      lastRunError: row.last_error || null,
    };
  } catch (err) {
    console.warn("[product-first-movement] Não foi possível carregar status:", err);
  }
}

async function saveStatus(result: ProductFirstMovementRunResult | null, error: string | null): Promise<void> {
  const now = new Date().toISOString();
  cachedStatus = {
    lastRunAt: now,
    lastRunResult: result ? {
      mes: result.mes,
      ano: result.ano,
      totalMes: result.totalMes,
      novosProdutos: result.novosProdutos,
      enviadoChatwoot: result.enviadoChatwoot,
    } : null,
    lastRunError: error,
  };

  try {
    const pool = await getPool();
    await pool.request()
      .input("lastRunAt", sql.DateTime2, new Date(now))
      .input("mes", sql.Int, result?.mes ?? null)
      .input("ano", sql.Int, result?.ano ?? null)
      .input("totalMes", sql.Int, result?.totalMes ?? null)
      .input("novosProdutos", sql.Int, result?.novosProdutos ?? null)
      .input("enviadoChatwoot", sql.Bit, result ? (result.enviadoChatwoot ? 1 : 0) : null)
      .input("lastError", sql.NVarChar(1000), error)
      .query(`
        UPDATE ${STATUS_TABLE}
        SET last_run_at = @lastRunAt,
            mes = @mes,
            ano = @ano,
            total_mes = @totalMes,
            novos_produtos = @novosProdutos,
            enviado_chatwoot = @enviadoChatwoot,
            last_error = @lastError
        WHERE id = 1
      `);
  } catch (err) {
    console.warn("[product-first-movement] Não foi possível salvar status:", err);
  }
}

export function getProductFirstMovementStatus(): ProductFirstMovementStatus {
  return cachedStatus;
}

export async function initializeProductFirstMovementStatus(): Promise<void> {
  await ensureStatusTable();
  await loadStatus();
}

export async function runProductFirstMovementCheck(month?: number, year?: number): Promise<ProductFirstMovementRunResult> {
  const { month: currentMonth, year: currentYear } = getCurrentMonthYear();
  const mes = month ?? currentMonth;
  const ano = year ?? currentYear;
  const produtos = await getMonthlyFirstMovementProducts(mes, ano);
  const notifiedCodes = await getAlreadyNotifiedCodes();
  const novos = produtos.filter((product) => !notifiedCodes.has(product.codigo));

  let enviadoChatwoot = false;
  let mensagem = "Nenhum produto novo para notificar.";

  if (novos.length > 0) {
    mensagem = formatChatwootMessage(novos, mes, ano);
    enviadoChatwoot = await sendChatwootMessage(mensagem);
    if (!enviadoChatwoot) {
      throw new Error("Falha ao enviar mensagem para o Chatwoot.");
    }
    await registerNotifiedProducts(novos);
    mensagem = `${novos.length} produto(s) novo(s) notificado(s) no Chatwoot.`;
  }

  return {
    mes,
    ano,
    totalMes: produtos.length,
    novosProdutos: novos.length,
    enviadoChatwoot,
    produtos,
    mensagem,
  };
}

export async function runProductFirstMovementCheckAndPersist(month?: number, year?: number): Promise<ProductFirstMovementRunResult> {
  try {
    const result = await runProductFirstMovementCheck(month, year);
    await saveStatus(result, null);
    return result;
  } catch (err: any) {
    await saveStatus(null, err.message || String(err));
    throw err;
  }
}
