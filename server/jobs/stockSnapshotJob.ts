import cron from "node-cron";
import sql from "mssql";
import { getPool } from "../db/sqlserver";

const TIMEZONE = process.env.APP_TIMEZONE?.trim() || "America/Sao_Paulo";

const DEFAULT_STORES = [
  "CAMPINAS",
  "FORTALEZA",
  "BELO HORIZONTE",
  "RIO DE JANEIRO",
  "SANTANA",
  "UBERLANDIA",
];

function getStoreFilter(): string[] {
  const raw = process.env.STORE_FILTER?.trim();
  if (!raw) return DEFAULT_STORES;
  const stores = raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  return stores.length > 0 ? stores : DEFAULT_STORES;
}

const historyTable = "DOVALE.dbo.[TI-FINANCEIRO_131-FechamentoLojas_Historico]";
const stockTable = "DOVALE.dbo.[TI-FINANCEIRO_131-FechamentoLojas_Estoque]";
const salesTable = "DOVALE.dbo.[TI-FINANCEIRO_131-FechamentoLojas]";
const receivablesTable = "DOVALE.dbo.[TI-FINANCEIRO_55-Recebimento]";

type ZonedDateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(date);
  const v = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: v("year"), month: v("month"), day: v("day"), hour: v("hour"), minute: v("minute"), second: v("second") };
}

function getPreviousMonthReference(z: ZonedDateParts) {
  return z.month === 1
    ? { referenceMonth: 12, referenceYear: z.year - 1 }
    : { referenceMonth: z.month - 1, referenceYear: z.year };
}

async function ensureHistoryReferenceColumns(): Promise<void> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT COLUMN_NAME
    FROM DOVALE.INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = 'TI-FINANCEIRO_131-FechamentoLojas_Historico'
      AND COLUMN_NAME IN ('MESREFERENCIA', 'ANOREFERENCIA')
  `);
  const cols = new Set(result.recordset.map((r: { COLUMN_NAME: string }) => r.COLUMN_NAME.toUpperCase()));
  if (!cols.has("MESREFERENCIA") || !cols.has("ANOREFERENCIA")) {
    throw new Error("Tabela histórica precisa das colunas MESREFERENCIA e ANOREFERENCIA. Execute o script SQL 001_add_reference_columns.sql.");
  }
}

type StockRow = { EMP: string; VALORESTOQUE: number; VENDASLOJASINDUSTRIA: number; VENDASRECEBIDAS: number };

export async function runStockSnapshot(referenceMonth: number, referenceYear: number): Promise<{ inserted: number; rows: StockRow[] }> {
  await ensureHistoryReferenceColumns();

  const pool = await getPool();
  const request = pool.request();
  const stores = getStoreFilter();

  const storePlaceholders = stores.map((store, i) => {
    request.input(`store${i}`, sql.VarChar(100), store);
    return `@store${i}`;
  }).join(", ");

  request.input("referenceMonth", sql.Int, referenceMonth);
  request.input("referenceYear", sql.Int, referenceYear);

  const result = await request.query(`
    DECLARE @InicioMes DATE = DATEFROMPARTS(@referenceYear, @referenceMonth, 1);
    DECLARE @FimMes DATE = EOMONTH(@InicioMes);

    DECLARE @DadosLojas TABLE (
      EMP VARCHAR(100),
      VALORESTOQUE FLOAT,
      VENDASLOJASINDUSTRIA FLOAT,
      VENDASRECEBIDAS FLOAT
    );

    INSERT INTO @DadosLojas (EMP, VALORESTOQUE, VENDASLOJASINDUSTRIA, VENDASRECEBIDAS)
    SELECT
      UPPER(LTRIM(RTRIM(est.EMP))) AS EMP,
      CAST(ROUND(SUM(est.VALORTOTAL), 2) AS FLOAT) AS VALORESTOQUE,
      ISNULL(venda.VENDALOJA, 0) AS VENDASLOJASINDUSTRIA,
      ISNULL(receb.RECEBIMENTO, 0) AS VENDASRECEBIDAS
    FROM ${stockTable} est
    LEFT JOIN (
      SELECT
        UPPER(LTRIM(RTRIM(f.EMP))) AS EMP,
        CAST(ROUND(SUM(f.VENDALOJA), 2) AS FLOAT) AS VENDALOJA
      FROM ${salesTable} f
      WHERE f.PDV_DATA >= @InicioMes AND f.PDV_DATA <= @FimMes
      GROUP BY UPPER(LTRIM(RTRIM(f.EMP)))
    ) venda ON UPPER(LTRIM(RTRIM(est.EMP))) = venda.EMP
    LEFT JOIN (
      SELECT
        UPPER(LTRIM(RTRIM(r.EMP))) AS EMP,
        CAST(ROUND(SUM(r.TOTAL), 2) AS FLOAT) AS RECEBIMENTO
      FROM ${receivablesTable} r
      WHERE r.REC_DATA >= @InicioMes AND r.REC_DATA <= @FimMes
      GROUP BY UPPER(LTRIM(RTRIM(r.EMP)))
    ) receb ON UPPER(LTRIM(RTRIM(est.EMP))) = receb.EMP
    WHERE UPPER(LTRIM(RTRIM(est.EMP))) IN (${storePlaceholders})
    GROUP BY UPPER(LTRIM(RTRIM(est.EMP))), venda.VENDALOJA, receb.RECEBIMENTO;

    INSERT INTO ${historyTable} (
      EMP, VALORESTOQUE, VENDASRECEBIDAS, VENDASLOJASINDUSTRIA,
      CAR, LUCROBRUTO, LUCROREAL, LUCROREALINDUSTRIA, LUCROFINAL, DESPESAS, CAP,
      MESREFERENCIA, ANOREFERENCIA
    )
    SELECT
      dados.EMP, dados.VALORESTOQUE, dados.VENDASRECEBIDAS, dados.VENDASLOJASINDUSTRIA,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      @referenceMonth, @referenceYear
    FROM @DadosLojas dados
    WHERE NOT EXISTS (
      SELECT 1
      FROM ${historyTable} historico
      WHERE UPPER(LTRIM(RTRIM(historico.EMP))) = dados.EMP
        AND historico.MESREFERENCIA = @referenceMonth
        AND historico.ANOREFERENCIA = @referenceYear
    );

    SELECT @@ROWCOUNT AS InsertedCount;

    SELECT EMP, VALORESTOQUE, VENDASLOJASINDUSTRIA, VENDASRECEBIDAS
    FROM @DadosLojas
    ORDER BY EMP;
  `);

  const sets = result.recordsets as any[];
  const inserted = (sets[0]?.[0] as { InsertedCount: number } | undefined)?.InsertedCount ?? 0;
  const rows = (sets[1] as StockRow[] | undefined) ?? [];

  return { inserted, rows };
}

// ── Persisted status (MSSQL) ────────────────────────────────────────────────
const STATUS_TABLE = "DOVALE.dbo.STOCK_SNAPSHOT_STATUS";

interface SnapshotStatus {
  lastRunAt: string | null;
  lastRunResult: { inserted: number; stores: number; referenceMonth: number; referenceYear: number } | null;
  lastRunError: string | null;
}

let cachedStatus: SnapshotStatus = { lastRunAt: null, lastRunResult: null, lastRunError: null };

async function ensureStatusTable(): Promise<void> {
  const pool = await getPool();
  await pool.request().query(`
    IF OBJECT_ID('dbo.STOCK_SNAPSHOT_STATUS', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.STOCK_SNAPSHOT_STATUS (
        id INT NOT NULL DEFAULT 1 PRIMARY KEY,
        last_run_at DATETIME2 NULL,
        inserted INT NULL,
        stores INT NULL,
        reference_month INT NULL,
        reference_year INT NULL,
        last_error NVARCHAR(1000) NULL
      );
      INSERT INTO dbo.STOCK_SNAPSHOT_STATUS (id) VALUES (1);
    END
  `);
}

async function loadStatus(): Promise<void> {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`SELECT TOP 1 * FROM ${STATUS_TABLE}`);
    const row = r.recordset[0];
    if (!row) return;
    cachedStatus = {
      lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
      lastRunResult: row.reference_month != null ? {
        inserted: row.inserted ?? 0,
        stores: row.stores ?? 0,
        referenceMonth: row.reference_month,
        referenceYear: row.reference_year,
      } : null,
      lastRunError: row.last_error || null,
    };
  } catch (err) {
    console.warn("[stock-snapshot] Não foi possível carregar status do banco:", err);
  }
}

async function saveStatus(result: SnapshotStatus["lastRunResult"], error: string | null): Promise<void> {
  const now = new Date().toISOString();
  cachedStatus = { lastRunAt: now, lastRunResult: result, lastRunError: error };
  try {
    const pool = await getPool();
    await pool.request()
      .input("lastRunAt", sql.DateTime2, new Date(now))
      .input("inserted", sql.Int, result?.inserted ?? null)
      .input("stores", sql.Int, result?.stores ?? null)
      .input("refMonth", sql.Int, result?.referenceMonth ?? null)
      .input("refYear", sql.Int, result?.referenceYear ?? null)
      .input("lastError", sql.NVarChar(1000), error)
      .query(`
        UPDATE ${STATUS_TABLE}
        SET last_run_at = @lastRunAt,
            inserted = @inserted,
            stores = @stores,
            reference_month = @refMonth,
            reference_year = @refYear,
            last_error = @lastError
        WHERE id = 1
      `);
  } catch (err) {
    console.warn("[stock-snapshot] Não foi possível salvar status no banco:", err);
  }
}

export function getStockSnapshotStatus(): SnapshotStatus {
  return cachedStatus;
}

// ── Scheduled execution logic ───────────────────────────────────────────────
async function executeDailyCheck(force: boolean): Promise<{ inserted: number; stores: number; referenceMonth: number; referenceYear: number }> {
  const now = new Date();
  const z = getZonedDateParts(now, TIMEZONE);
  const ts = `${String(z.day).padStart(2, "0")}/${String(z.month).padStart(2, "0")}/${z.year} ${String(z.hour).padStart(2, "0")}:${String(z.minute).padStart(2, "0")}`;

  console.log(`[stock-snapshot] Verificação em ${ts} (${TIMEZONE})`);

  if (!force && z.day !== 1) {
    console.log(`[stock-snapshot] Hoje não é dia 01. Pulando.`);
    return { inserted: 0, stores: 0, referenceMonth: 0, referenceYear: 0 };
  }

  const { referenceMonth, referenceYear } = getPreviousMonthReference(z);
  const { inserted, rows } = await runStockSnapshot(referenceMonth, referenceYear);

  console.log(`[stock-snapshot] Ref ${String(referenceMonth).padStart(2, "0")}/${referenceYear} — ${rows.length} loja(s) encontrada(s), ${inserted} registro(s) inserido(s).`);
  for (const row of rows) {
    console.log(`  - ${row.EMP}: Estoque=${row.VALORESTOQUE} | VendasLoja=${row.VENDASLOJASINDUSTRIA} | Recebimentos=${row.VENDASRECEBIDAS}`);
  }

  return { inserted, stores: rows.length, referenceMonth, referenceYear };
}

export async function runStockSnapshotManual(force: boolean = true) {
  try {
    const result = await executeDailyCheck(force);
    await saveStatus(result, null);
    return result;
  } catch (err: any) {
    await saveStatus(null, err.message || String(err));
    throw err;
  }
}

export async function startStockSnapshotJob() {
  await ensureStatusTable();
  await loadStatus();
  if (cachedStatus.lastRunAt) {
    console.log(`[stock-snapshot] Última execução: ${new Date(cachedStatus.lastRunAt).toLocaleString("pt-BR")}`);
  }

  cron.schedule(
    "0 0 * * *",
    async () => {
      try {
        const result = await executeDailyCheck(false);
        await saveStatus(result, null);
      } catch (err: any) {
        console.error(`[stock-snapshot] Falha no agendamento:`, err);
        await saveStatus(null, err.message || String(err));
      }
    },
    { timezone: TIMEZONE },
  );

  console.log(`[stock-snapshot] Cron ativo — todo dia à meia-noite (${TIMEZONE}). Lojas: ${getStoreFilter().join(", ")}`);
}
