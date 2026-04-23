import { Router, Request, Response } from "express";
import sql from "mssql";
import { getPool } from "../db/sqlserver";

// @ts-ignore — node-firebird has no TS types
import Firebird from "node-firebird";
import mysql from "mysql2/promise";

const router = Router();

// ── Ensure audit table ──────────────────────────────────────────────────────

async function ensureMultiPrecoTable(): Promise<void> {
  const pool = await getPool();
  const tableName = (process.env.MULTI_PRECO_TABLE || "PROGRAMA_MULTI-PRECO").replace(/[\[\]]/g, "");
  await pool.request().query(`
    IF OBJECT_ID('dbo.[${tableName}]', 'U') IS NULL
    CREATE TABLE dbo.[${tableName}] (
      ID INT IDENTITY(1,1) PRIMARY KEY,
      CODIGO_PRODUTO VARCHAR(50),
      LOJA VARCHAR(100),
      DATA VARCHAR(50),
      PRECO DECIMAL(18,2),
      USUARIO VARCHAR(100),
      STATUS VARCHAR(50),
      TABELA VARCHAR(50)
    )
  `);
}

ensureMultiPrecoTable().catch((err) =>
  console.error("[multi-preco] DB table setup error:", err?.message)
);

// ── Firebird helpers ────────────────────────────────────────────────────────

function parseFbDsn(dsn: string): { host: string; port: number; database: string } {
  // host/port:path
  let m = dsn.match(/^([\d.]+)\/(\d+):(.+)$/);
  if (m) return { host: m[1], port: +m[2], database: m[3] };
  // host:C:\... (Windows absolute path)
  m = dsn.match(/^([\d.]+):([A-Za-z]:\\.+)$/);
  if (m) return { host: m[1], port: 3050, database: m[2] };
  // host:/unix/path
  m = dsn.match(/^([\d.]+):(\/.+)$/);
  if (m) return { host: m[1], port: 3050, database: m[2] };
  // local path
  return { host: "127.0.0.1", port: 3050, database: dsn };
}

function fbConnect(dsn: string): Promise<any> {
  const { host, port, database } = parseFbDsn(dsn);
  return new Promise((resolve, reject) => {
    Firebird.attach(
      {
        host,
        port,
        database,
        user: process.env.FB_USER || "SYSDBA",
        password: process.env.FB_PASSWORD || "masterkey",
      },
      (err: any, db: any) => (err ? reject(err) : resolve(db))
    );
  });
}

function fbQuery(dbOrTx: any, q: string, params: any[] = []): Promise<any[]> {
  return new Promise((resolve, reject) => {
    dbOrTx.query(q, params, (err: any, result: any) =>
      err ? reject(err) : resolve(result || [])
    );
  });
}

function fbExecute(tx: any, q: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.execute(q, params, (err: any) => (err ? reject(err) : resolve()));
  });
}

function fbTransaction(db: any): Promise<any> {
  return new Promise((resolve, reject) => {
    db.transaction(Firebird.ISOLATION_READ_COMMITTED, (err: any, tx: any) =>
      err ? reject(err) : resolve(tx)
    );
  });
}

function fbCommit(tx: any): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.commit((err: any) => (err ? reject(err) : resolve()));
  });
}

function fbDetach(db: any): Promise<void> {
  return new Promise((resolve) => {
    try { db.detach(() => resolve()); } catch { resolve(); }
  });
}

// ── Price formatting helper ─────────────────────────────────────────────────

function fmtBRL(v: number): string {
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}
function nowStr(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// ── Sync endpoint (NDJSON streaming) ────────────────────────────────────────

interface SyncEvent {
  status: string;
  message: string;
  storeName?: string;
  productCode?: string;
  oldPrice?: number;
  newPrice?: number;
  tableName?: string;
}

type AuditRow = [string, string, string, number, string, string, string];

router.post("/sync", async (req: Request, res: Response) => {
  // Setup streaming
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const usuario = String(req.query.usuario || "Sistema");
  const send = (evt: SyncEvent) => {
    res.write(JSON.stringify(evt) + "\n");
  };

  const sjcPath = process.env.SJC_DB_PATH;
  const targetsStr = process.env.TARGET_DBS || "";
  const targetEntries = targetsStr
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (!sjcPath || targetEntries.length === 0) {
    send({ status: "error", message: "Configuração de banco de dados ausente (SJC_DB_PATH / TARGET_DBS).", storeName: "API" });
    return res.end();
  }

  try {
    // ── 1. Read source (SJC Firebird) ──
    const dbSjc = await fbConnect(sjcPath);

    const produtosSjc: any[] = await fbQuery(
      dbSjc,
      `SELECT tp.TBP_PRO_CODIGO, tp.TBP_PRECO, tp.TBP_TAB_CODIGO,
              CASE WHEN p.PRO_NIVEL2 = '1' THEN 'CHAVES' ELSE 'MERCADORIA' END AS GRUPO
       FROM TABELAS_PRODUTOS tp
       INNER JOIN PRODUTOS p ON p.PRO_CODIGO = tp.TBP_PRO_CODIGO
       WHERE tp.TBP_TAB_CODIGO = 1`
    );

    const produtosSjcDdf: any[] = await fbQuery(
      dbSjc,
      `SELECT tp.TBP_PRO_CODIGO, tp.TBP_PRECO, tp.TBP_TAB_CODIGO,
              CASE WHEN p.PRO_NIVEL2 = '1' THEN 'CHAVES' ELSE 'MERCADORIA' END AS GRUPO
       FROM TABELAS_PRODUTOS tp
       INNER JOIN PRODUTOS p ON p.PRO_CODIGO = tp.TBP_PRO_CODIGO
       WHERE tp.TBP_TAB_CODIGO = 4`
    );

    await fbDetach(dbSjc);

    // Debug: log actual keys returned by node-firebird
    if (produtosSjc.length > 0) {
      console.log("[multi-preco] Firebird row keys:", Object.keys(produtosSjc[0]));
      console.log("[multi-preco] First row sample:", JSON.stringify(produtosSjc[0]));
    }

    const totalProdutos = produtosSjc.length + produtosSjcDdf.length;

    // Helper: extract grupo from Firebird row (handles different key casing)
    function getGrupo(row: any): string {
      return String(row.GRUPO || row.grupo || row.Grupo || "").trim();
    }

    // Build unified map
    const unificados = new Map<
      number,
      { atacado: number | null; ddf: number | null; grupo: string; rowcount: number; old_atacado: number; old_ddf: number }
    >();
    for (const p of produtosSjc) {
      unificados.set(p.TBP_PRO_CODIGO, { atacado: p.TBP_PRECO, ddf: null, grupo: getGrupo(p), rowcount: 0, old_atacado: 0, old_ddf: 0 });
    }
    for (const p of produtosSjcDdf) {
      const ex = unificados.get(p.TBP_PRO_CODIGO);
      if (ex) {
        ex.ddf = p.TBP_PRECO;
      } else {
        unificados.set(p.TBP_PRO_CODIGO, { atacado: null, ddf: p.TBP_PRECO, grupo: getGrupo(p), rowcount: 0, old_atacado: 0, old_ddf: 0 });
      }
    }

    send({
      status: "info",
      message: `Encontrados ${totalProdutos} produtos na loja SJC (Tab 1: ${produtosSjc.length} | Tab 4: ${produtosSjcDdf.length}).`,
    });
    send({ status: "pending", message: "Produto --- → SJC...", productCode: "---", storeName: "SJC" });

    for (const targetEntry of targetEntries) {
      const parts = targetEntry.split("|");
      let cleanName: string;
      let targetPath: string;
      let tabDdfDestino: number;

      if (parts.length >= 2 && parts[1].trim().toLowerCase() === "mysql") {
        cleanName = parts[0].trim();
        targetPath = "mysql";
        tabDdfDestino = 0;
      } else if (parts.length === 3) {
        cleanName = parts[0].trim();
        targetPath = parts[1].trim();
        tabDdfDestino = parseInt(parts[2].trim());
      } else {
        targetPath = parts[0].trim();
        tabDdfDestino = parts.length > 1 ? parseInt(parts[1].trim()) : 4;
        cleanName =
          targetPath.replace(/\\/g, "/").split("/").pop()?.split(".")[0] || targetPath;
        cleanName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
      }

      send({ status: "clear", message: "clear", storeName: "API" });
      send({
        status: "info",
        message: `Iniciando a conexão com a próxima loja: ${cleanName}...`,
        storeName: "API",
      });

      const sqlInserts: AuditRow[] = [];

      try {
        const isMysql = targetPath.toLowerCase() === "mysql";

        if (isMysql) {
          // ── MySQL target ──
          const prefix = cleanName.toUpperCase().replace(/ /g, "_");
          const mHost =
            process.env[`${prefix}_DB_MYSQL_HOST`] ||
            process.env[`${prefix}_MYSQL_HOST`] ||
            process.env.DB_MYSQL_HOST ||
            "127.0.0.1";
          const mUser =
            process.env[`${prefix}_DB_MYSQL_USER`] ||
            process.env[`${prefix}_MYSQL_USER`] ||
            process.env.DB_MYSQL_USER ||
            "root";
          const mPwd =
            process.env[`${prefix}_DB_MYSQL_PASSWORD`] ||
            process.env[`${prefix}_MYSQL_PASSWORD`] ||
            process.env.DB_MYSQL_PASSWORD ||
            "";
          const mDb =
            process.env[`${prefix}_DB_MYSQL_NAME`] ||
            process.env[`${prefix}_MYSQL_NAME`] ||
            process.env.DB_MYSQL_NAME ||
            "";
          const mPort = parseInt(
            process.env[`${prefix}_DB_MYSQL_PORT`] ||
              process.env[`${prefix}_MYSQL_PORT`] ||
              process.env.DB_MYSQL_PORT ||
              "3306"
          );

          const conn = await mysql.createConnection({
            host: mHost === "localhost" ? "127.0.0.1" : mHost,
            user: mUser,
            password: mPwd,
            database: mDb,
            port: mPort,
          });

          send({
            status: "info",
            message: `Conexão estabelecida! Aplicando updates no banco da loja ${cleanName}...`,
            storeName: cleanName,
          });

          // Execute all updates (ATACADO + DDF in one query per product)
          for (const [idProduto, precos] of unificados) {
            let pAtac = precos.atacado !== null ? Number(precos.atacado) : 0;
            let pDdf = precos.ddf !== null ? Number(precos.ddf) : 0;
            if (cleanName.toUpperCase() === "RS" && precos.grupo === "MERCADORIA") {
              pAtac *= 1.1;
              pDdf *= 1.1;
            }
            // Fetch old prices before update
            const [oldRows] = (await conn.execute(
              "SELECT Preco, Preco3 FROM pacad WHERE codigopro = ?",
              [String(idProduto).trim()]
            )) as any;
            const oldRow = oldRows?.[0];
            precos.old_atacado = oldRow?.Preco != null ? Number(oldRow.Preco) : 0;
            precos.old_ddf = oldRow?.Preco3 != null ? Number(oldRow.Preco3) : 0;

            const [result] = (await conn.execute(
              "UPDATE pacad SET Preco = ?, Preco3 = ? WHERE codigopro = ?",
              [pAtac, pDdf, String(idProduto).trim()]
            )) as any;
            precos.rowcount = result.affectedRows;
          }

          // ATACADO logs
          for (const p of produtosSjc) {
            const id = p.TBP_PRO_CODIGO;
            let preco = Number(p.TBP_PRECO) || 0;
            const grupoAtac = unificados.get(id)?.grupo || getGrupo(p);
            if (cleanName.toUpperCase() === "RS" && grupoAtac === "MERCADORIA") preco *= 1.1;
            const rc = unificados.get(id)?.rowcount || 0;
            const oldPrice = unificados.get(id)?.old_atacado ?? 0;
            const dt = nowStr();
            const pDb = Math.round(preco * 100) / 100;
            if (rc === 0) {
              send({ status: "error", message: `Produto ${id} → ${cleanName} Tabela ATACADO: Não encontrado/alterado`, productCode: String(id), storeName: cleanName, oldPrice, newPrice: preco, tableName: "ATACADO" });
              sqlInserts.push([String(id), cleanName, dt, pDb, usuario, "ERRO", "ATACADO"]);
            } else {
              send({ status: "success", message: `Produto ${id} → ${cleanName} Tabela ATACADO: ${fmtBRL(preco)}`, productCode: String(id), storeName: cleanName, oldPrice, newPrice: preco, tableName: "ATACADO" });
              sqlInserts.push([String(id), cleanName, dt, pDb, usuario, "SUCESSO", "ATACADO"]);
            }
          }

          // DDF logs
          for (const p of produtosSjcDdf) {
            const id = p.TBP_PRO_CODIGO;
            let preco = Number(p.TBP_PRECO) || 0;
            const grupoDdf = unificados.get(id)?.grupo || getGrupo(p);
            if (cleanName.toUpperCase() === "RS" && grupoDdf === "MERCADORIA") preco *= 1.1;
            const rc = unificados.get(id)?.rowcount || 0;
            const oldPrice = unificados.get(id)?.old_ddf ?? 0;
            const dt = nowStr();
            const pDb = Math.round(preco * 100) / 100;
            if (rc === 0) {
              send({ status: "error", message: `Produto ${id} → ${cleanName} Tabela DDF: Não encontrado/alterado`, productCode: String(id), storeName: cleanName, oldPrice, newPrice: preco, tableName: "DDF" });
              sqlInserts.push([String(id), cleanName, dt, pDb, usuario, "ERRO", "DDF"]);
            } else {
              send({ status: "success", message: `Produto ${id} → ${cleanName} Tabela DDF: ${fmtBRL(preco)}`, productCode: String(id), storeName: cleanName, oldPrice, newPrice: preco, tableName: "DDF" });
              sqlInserts.push([String(id), cleanName, dt, pDb, usuario, "SUCESSO", "DDF"]);
            }
          }

          await conn.end();
        } else {
          // ── Firebird target ──
          const dbTarget = await fbConnect(targetPath);
          const tx = await fbTransaction(dbTarget);

          send({
            status: "info",
            message: `Conexão estabelecida! Aplicando updates no banco da loja ${cleanName}...`,
            storeName: cleanName,
          });

          // Pre-fetch existing product codes and their current prices
          const existingTab1 = new Map<number, number>();
          const existingTabDdf = new Map<number, number>();
          const rows1 = await fbQuery(tx, "SELECT TBP_PRO_CODIGO, TBP_PRECO FROM TABELAS_PRODUTOS WHERE TBP_TAB_CODIGO = 1");
          for (const r of rows1) existingTab1.set(r.TBP_PRO_CODIGO, Number(r.TBP_PRECO) || 0);
          if (tabDdfDestino) {
            const rowsD = await fbQuery(tx, "SELECT TBP_PRO_CODIGO, TBP_PRECO FROM TABELAS_PRODUTOS WHERE TBP_TAB_CODIGO = ?", [tabDdfDestino]);
            for (const r of rowsD) existingTabDdf.set(r.TBP_PRO_CODIGO, Number(r.TBP_PRECO) || 0);
          }

          // ATACADO updates
          for (const p of produtosSjc) {
            const id = p.TBP_PRO_CODIGO;
            let preco = Number(p.TBP_PRECO) || 0;
            if (cleanName.toUpperCase() === "RS" && getGrupo(p) === "MERCADORIA") preco *= 1.1;

            const exists = existingTab1.has(id);
            const oldPrice = existingTab1.get(id) ?? 0;
            if (exists) {
              await fbExecute(tx, "UPDATE TABELAS_PRODUTOS SET TBP_PRECO = ? WHERE TBP_PRO_CODIGO = ? AND TBP_TAB_CODIGO = ?", [preco, id, 1]);
            }

            const dt = nowStr();
            const pDb = Math.round(preco * 100) / 100;
            if (!exists) {
              send({ status: "error", message: `Produto ${id} → ${cleanName} Tabela ATACADO: Não encontrado/alterado`, productCode: String(id), storeName: cleanName, oldPrice, newPrice: preco, tableName: "ATACADO" });
              sqlInserts.push([String(id), cleanName, dt, pDb, usuario, "ERRO", "ATACADO"]);
            } else {
              send({ status: "success", message: `Produto ${id} → ${cleanName} Tabela ATACADO: ${fmtBRL(preco)}`, productCode: String(id), storeName: cleanName, oldPrice, newPrice: preco, tableName: "ATACADO" });
              sqlInserts.push([String(id), cleanName, dt, pDb, usuario, "SUCESSO", "ATACADO"]);
            }
          }

          // DDF updates
          for (const p of produtosSjcDdf) {
            const id = p.TBP_PRO_CODIGO;
            let preco = Number(p.TBP_PRECO) || 0;
            if (cleanName.toUpperCase() === "RS" && getGrupo(p) === "MERCADORIA") preco *= 1.1;

            const exists = existingTabDdf.has(id);
            const oldPrice = existingTabDdf.get(id) ?? 0;
            if (exists) {
              await fbExecute(tx, "UPDATE TABELAS_PRODUTOS SET TBP_PRECO = ? WHERE TBP_PRO_CODIGO = ? AND TBP_TAB_CODIGO = ?", [preco, id, tabDdfDestino]);
            }

            const dt = nowStr();
            const pDb = Math.round(preco * 100) / 100;
            if (!exists) {
              send({ status: "error", message: `Produto ${id} → ${cleanName} Tabela DDF: Não encontrado/alterado`, productCode: String(id), storeName: cleanName, oldPrice, newPrice: preco, tableName: "DDF" });
              sqlInserts.push([String(id), cleanName, dt, pDb, usuario, "ERRO", "DDF"]);
            } else {
              send({ status: "success", message: `Produto ${id} → ${cleanName} Tabela DDF: ${fmtBRL(preco)}`, productCode: String(id), storeName: cleanName, oldPrice, newPrice: preco, tableName: "DDF" });
              sqlInserts.push([String(id), cleanName, dt, pDb, usuario, "SUCESSO", "DDF"]);
            }
          }

          await fbCommit(tx);
          await fbDetach(dbTarget);
        }

        // ── 3. Save audit to SQL Server ──
        send({
          status: "saving_log",
          message: `Salvando ${sqlInserts.length} logs no SQL Server...`,
          storeName: cleanName,
          productCode: "---",
          newPrice: 0,
        });

        if (sqlInserts.length > 0) {
          try {
            const pool = await getPool();
            const tableName = (process.env.MULTI_PRECO_TABLE || "PROGRAMA_MULTI-PRECO").replace(/[\[\]]/g, "");
            const chunkSize = 1000;
            const total = sqlInserts.length;

            for (let i = 0; i < total; i += chunkSize) {
              const chunk = sqlInserts.slice(i, i + chunkSize);
              const tbl = new sql.Table(tableName);
              tbl.create = false;
              tbl.columns.add("CODIGO_PRODUTO", sql.VarChar(50));
              tbl.columns.add("LOJA", sql.VarChar(100));
              tbl.columns.add("DATA", sql.VarChar(50));
              tbl.columns.add("PRECO", sql.Decimal(18, 2));
              tbl.columns.add("USUARIO", sql.VarChar(100));
              tbl.columns.add("STATUS", sql.VarChar(50));
              tbl.columns.add("TABELA", sql.VarChar(50));
              for (const row of chunk) tbl.rows.add(...row);
              await pool.request().bulk(tbl);

              const pct = Math.round(((i + chunk.length) / total) * 100);
              send({
                status: "saving_progress",
                message: String(pct),
                storeName: cleanName,
                productCode: "---",
                newPrice: 0,
              });
            }

            send({
              status: "saved_log",
              message: "Auditoria salva com sucesso.",
              storeName: cleanName,
              productCode: "---",
              newPrice: 0,
            });
          } catch (eSql: any) {
            send({
              status: "error",
              message: `Falha SQL Server (${cleanName}): ${eSql.message}`,
              storeName: cleanName,
              productCode: "---",
              newPrice: 0,
            });
            send({
              status: "saved_log",
              message: "Falha na auditoria.",
              storeName: cleanName,
              productCode: "---",
              newPrice: 0,
            });
          }
        } else {
          send({
            status: "saved_log",
            message: "Nenhum log para salvar nesta loja.",
            storeName: cleanName,
            productCode: "---",
            newPrice: 0,
          });
        }
      } catch (e: any) {
        console.error(`[multi-preco] Falha loja ${cleanName} (path=${targetPath}):`, e.message);
        send({
          status: "error",
          message: `Falha ao conectar/atualizar loja ${cleanName}: ${e.message} (path: ${targetPath})`,
          storeName: cleanName,
          productCode: "---",
        });
      }
    }

    send({
      status: "complete",
      message: "O processo de sincronização Multi-Preço foi totalmente concluído!",
      storeName: "API",
    });
  } catch (e: any) {
    send({ status: "error", message: `Erro crítico: ${e.message}`, storeName: "API" });
  }
  res.end();
});

router.get("/history", async (_req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const tableName = (process.env.MULTI_PRECO_TABLE || "PROGRAMA_MULTI-PRECO").replace(/[\[\]]/g, "");
    const result = await pool.request().query(`
      SELECT TOP 500 * FROM dbo.[${tableName}] ORDER BY DATA DESC
    `);
    res.json(result.recordset);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
