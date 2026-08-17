import cron from "node-cron";
import mssql from "mssql";
import { queryFirebird } from "../db/firebird";
import { getPool } from "../db/sqlserver";

const TIMEZONE = process.env.APP_TIMEZONE?.trim() || "America/Sao_Paulo";
const LOJA_KEY = "sjc" as const;
const FILIAL_ID = 1;

const PRODUTOS_TABLE = "DOVALE.dbo.ESTOQUE_MINIMO_PRODUTOS";
const STATUS_TABLE = "DOVALE.dbo.ESTOQUE_MINIMO_STATUS";

export interface ProdutoAbaixoMinimo {
  codigo: string;
  descricao: string;
  categoria: string;
  estoqueAtual: number;
  estoqueMinimo: number;
  diferenca: number;
}

export async function buscarProdutosAbaixoMinimo(): Promise<ProdutoAbaixoMinimo[]> {
  const firebirdSql = `
    SELECT * FROM (
      SELECT p.pro_codigo, p.pro_resumo,
             a.nome AS grupo,
             p.pro_estoqueminimo AS estoque_minimo,
             (SELECT disponivel FROM CONSULTA_ESTOQUE(p.pro_codigo, ${FILIAL_ID}, 1, 0, CAST('NOW' AS DATE))) AS saldo
      FROM produtos p
      INNER JOIN produtos_nivel1 a ON a.codigo = p.pro_nivel1
      WHERE p.pro_situacao = 'A'
        AND p.pro_estoqueminimo > 0
    ) base
    WHERE base.saldo < base.estoque_minimo
    ORDER BY (base.estoque_minimo - base.saldo) DESC
  `;

  const rows = await queryFirebird<Record<string, any>>(LOJA_KEY, firebirdSql);

  return rows.map((row) => {
    const estoqueAtual = Number(row.SALDO) || 0;
    const estoqueMinimo = Number(row.ESTOQUE_MINIMO) || 0;
    return {
      codigo: row.PRO_CODIGO?.toString().trim() || "",
      descricao: row.PRO_RESUMO?.toString().trim() || "",
      categoria: row.GRUPO?.toString().trim() || "Geral",
      estoqueAtual,
      estoqueMinimo,
      diferenca: estoqueMinimo - estoqueAtual,
    };
  });
}

// ── Persistência (MSSQL) + cache em memória ────────────────────────────────
interface EstoqueMinimoStatus {
  count: number;
  lastCheckedAt: string | null;
  lastError: string | null;
}

let cachedProdutos: ProdutoAbaixoMinimo[] = [];
let cachedStatus: EstoqueMinimoStatus = { count: 0, lastCheckedAt: null, lastError: null };

export function getEstoqueMinimoStatus(): EstoqueMinimoStatus {
  return cachedStatus;
}

export function getEstoqueMinimoProdutos(): ProdutoAbaixoMinimo[] {
  return cachedProdutos;
}

async function ensureTables(): Promise<void> {
  const pool = await getPool();
  await pool.request().query(`
    IF OBJECT_ID('dbo.ESTOQUE_MINIMO_PRODUTOS', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.ESTOQUE_MINIMO_PRODUTOS (
        pro_codigo VARCHAR(50) NOT NULL PRIMARY KEY,
        descricao NVARCHAR(255) NULL,
        categoria NVARCHAR(100) NULL,
        estoque_atual FLOAT NOT NULL,
        estoque_minimo FLOAT NOT NULL,
        diferenca FLOAT NOT NULL,
        atualizado_em DATETIME2 NOT NULL
      );
    END

    IF OBJECT_ID('dbo.ESTOQUE_MINIMO_STATUS', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.ESTOQUE_MINIMO_STATUS (
        id INT NOT NULL DEFAULT 1 PRIMARY KEY,
        last_checked_at DATETIME2 NULL,
        count INT NULL,
        last_error NVARCHAR(1000) NULL
      );
      INSERT INTO dbo.ESTOQUE_MINIMO_STATUS (id) VALUES (1);
    END
  `);
}

/** Carrega o último resultado salvo no MSSQL pra memória — usado no boot, pra já responder algo sem esperar o Firebird. */
async function loadFromDb(): Promise<void> {
  try {
    const pool = await getPool();
    const [produtosResult, statusResult] = await Promise.all([
      pool.request().query(`SELECT pro_codigo, descricao, categoria, estoque_atual, estoque_minimo, diferenca FROM ${PRODUTOS_TABLE} ORDER BY diferenca DESC`),
      pool.request().query(`SELECT TOP 1 last_checked_at, count, last_error FROM ${STATUS_TABLE}`),
    ]);

    cachedProdutos = produtosResult.recordset.map((r: any) => ({
      codigo: r.pro_codigo,
      descricao: r.descricao ?? "",
      categoria: r.categoria ?? "Geral",
      estoqueAtual: r.estoque_atual,
      estoqueMinimo: r.estoque_minimo,
      diferenca: r.diferenca,
    }));

    const statusRow = statusResult.recordset[0];
    if (statusRow) {
      cachedStatus = {
        count: statusRow.count ?? cachedProdutos.length,
        lastCheckedAt: statusRow.last_checked_at ? new Date(statusRow.last_checked_at).toISOString() : null,
        lastError: statusRow.last_error || null,
      };
    }

    console.log(`[estoque-minimo] Carregado do banco: ${cachedProdutos.length} produto(s), última checagem: ${cachedStatus.lastCheckedAt ?? "nunca"}.`);
  } catch (err) {
    console.warn("[estoque-minimo] Não foi possível carregar cache do banco:", err);
  }
}

async function persistirProdutos(produtos: ProdutoAbaixoMinimo[]): Promise<void> {
  const pool = await getPool();

  await pool.request().query(`TRUNCATE TABLE ${PRODUTOS_TABLE}`);

  const chunkSize = 1000;
  for (let i = 0; i < produtos.length; i += chunkSize) {
    const chunk = produtos.slice(i, i + chunkSize);
    const tbl = new mssql.Table("ESTOQUE_MINIMO_PRODUTOS");
    tbl.create = false;
    tbl.columns.add("pro_codigo", mssql.VarChar(50), { nullable: false, primary: true });
    tbl.columns.add("descricao", mssql.NVarChar(255), { nullable: true });
    tbl.columns.add("categoria", mssql.NVarChar(100), { nullable: true });
    tbl.columns.add("estoque_atual", mssql.Float, { nullable: false });
    tbl.columns.add("estoque_minimo", mssql.Float, { nullable: false });
    tbl.columns.add("diferenca", mssql.Float, { nullable: false });
    tbl.columns.add("atualizado_em", mssql.DateTime2, { nullable: false });
    const agora = new Date();
    for (const p of chunk) {
      tbl.rows.add(p.codigo, p.descricao, p.categoria, p.estoqueAtual, p.estoqueMinimo, p.diferenca, agora);
    }
    await pool.request().bulk(tbl);
  }
}

async function persistirStatus(status: EstoqueMinimoStatus): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input("lastCheckedAt", status.lastCheckedAt ? new Date(status.lastCheckedAt) : null)
    .input("count", status.count)
    .input("lastError", status.lastError)
    .query(`
      UPDATE ${STATUS_TABLE}
      SET last_checked_at = @lastCheckedAt, count = @count, last_error = @lastError
      WHERE id = 1
    `);
}

async function checarEstoqueMinimo(): Promise<void> {
  try {
    const produtos = await buscarProdutosAbaixoMinimo();
    cachedProdutos = produtos;
    cachedStatus = { count: produtos.length, lastCheckedAt: new Date().toISOString(), lastError: null };
    console.log(`[estoque-minimo] Verificação concluída: ${produtos.length} produto(s) abaixo do mínimo (SJC).`);

    await persistirProdutos(produtos);
    await persistirStatus(cachedStatus);
  } catch (err: any) {
    cachedStatus = { ...cachedStatus, lastCheckedAt: new Date().toISOString(), lastError: err.message || String(err) };
    console.error("[estoque-minimo] Falha ao verificar estoque mínimo:", err);
    await persistirStatus(cachedStatus).catch(() => {});
  }
}

/** Força uma nova checagem imediata (ex.: botão "Atualizar" na tela) e retorna a lista fresca. */
export async function forcarChecagemEstoqueMinimo(): Promise<ProdutoAbaixoMinimo[]> {
  await checarEstoqueMinimo();
  return cachedProdutos;
}

export async function startEstoqueMinimoJob() {
  await ensureTables();
  await loadFromDb();

  // Não espera a primeira checagem no Firebird — a tela já serve o último resultado salvo.
  checarEstoqueMinimo().catch((err) => console.error("[estoque-minimo] Falha na checagem inicial:", err));

  cron.schedule("0 7,12 * * 1-5", checarEstoqueMinimo, { timezone: TIMEZONE });

  console.log(`[estoque-minimo] Cron ativo — seg a sex às 7h e 12h (${TIMEZONE}).`);
}
