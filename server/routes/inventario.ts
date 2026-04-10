import { Router, Request, Response } from "express";
import sql from "mssql";
import Firebird from "node-firebird";
import { getPool } from "../db/sqlserver";

const router = Router();

// ── Firebird config for inventory product lookup ────────────────────────────

const fbConfig: Firebird.Options = {
  host: process.env.DB_FIREBIRD_INV_HOST || "localhost",
  port: Number(process.env.DB_FIREBIRD_INV_PORT) || 3050,
  database: process.env.DB_FIREBIRD_INV_PATH || "C:\\Backup\\MICROSYS\\MSYSDADOS_FORTALEZA.FDB",
  user: process.env.DB_FIREBIRD_INV_USER || "SYSDBA",
  password: process.env.DB_FIREBIRD_INV_PASSWORD || "masterkey",
};

function queryFb<T = Record<string, unknown>>(sqlStr: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    Firebird.attach(fbConfig, (err, db) => {
      if (err) return reject(err);
      db.query(sqlStr, params, (err2, result) => {
        db.detach();
        if (err2) return reject(err2);
        resolve((result ?? []) as T[]);
      });
    });
  });
}

function executeFb(sqlStr: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    Firebird.attach(fbConfig, (err, db) => {
      if (err) return reject(err);
      db.query(sqlStr, params, (err2) => {
        db.detach();
        if (err2) return reject(err2);
        resolve();
      });
    });
  });
}

interface FbProduto {
  PRO_CODIGO: number;
  PRO_RESUMO: string | null;
  PCF_CUSTO_FISCAL: number | null;
  SALDO_ATUAL: number | null;
}

async function checkPedidosAbertos(): Promise<number> {
  try {
    const rows = await queryFb<{ TOTAL: number }>(
      `SELECT COUNT(*) AS TOTAL FROM PEDIDOS_VENDAS WHERE PDV_PSI_CODIGO IN ('RA', 'AA')`
    );
    return Number(rows[0]?.TOTAL ?? 0);
  } catch (err) {
    console.error("[inventario] Erro ao verificar pedidos abertos:", err);
    return 0;
  }
}

async function lookupProduto(codigo: string): Promise<{ descricao: string | null; qtd_sistema: number; custo_fiscal: number | null } | null> {
  try {
    const rows = await queryFb<FbProduto>(
      `SELECT p.PRO_CODIGO, p.PRO_RESUMO,
              c.PCF_CUSTO_FISCAL,
              (SELECT disponivel FROM CONSULTA_ESTOQUE(p.PRO_CODIGO, 1, 0, 0, CAST('NOW' AS DATE))) AS SALDO_ATUAL
       FROM PRODUTOS p
       LEFT JOIN PRODUTOS_CFG_FILIAL c ON c.PCF_PRO_CODIGO = p.PRO_CODIGO AND c.PCF_FIL_CODIGO = '1'
       WHERE p.PRO_CODIGO = ?`,
      [Number(codigo)]
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      descricao: r.PRO_RESUMO ?? null,
      qtd_sistema: Number(r.SALDO_ATUAL ?? 0),
      custo_fiscal: r.PCF_CUSTO_FISCAL != null && Number(r.PCF_CUSTO_FISCAL) !== 0 ? Number(r.PCF_CUSTO_FISCAL) : 0.01,
    };
  } catch (err) {
    console.error("[inventario] Firebird lookup error:", err);
    return null;
  }
}

interface FbProdutoBulk {
  PRO_CODIGO: number;
  PRO_RESUMO: string | null;
  PCF_CUSTO_FISCAL: number | null;
  SALDO_ATUAL: number | null;
}

async function fetchProdutosComSaldo(): Promise<FbProdutoBulk[]> {
  try {
    const rows = await queryFb<FbProdutoBulk>(
      `SELECT p.PRO_CODIGO, p.PRO_RESUMO,
              c.PCF_CUSTO_FISCAL,
              (SELECT disponivel FROM CONSULTA_ESTOQUE(p.PRO_CODIGO, 1, 0, 0, CAST('NOW' AS DATE))) AS SALDO_ATUAL
       FROM PRODUTOS p
       LEFT JOIN PRODUTOS_CFG_FILIAL c ON c.PCF_PRO_CODIGO = p.PRO_CODIGO AND c.PCF_FIL_CODIGO = '1'
       WHERE (SELECT disponivel FROM CONSULTA_ESTOQUE(p.PRO_CODIGO, 1, 0, 0, CAST('NOW' AS DATE))) > 0`
    );
    return rows;
  } catch (err) {
    console.error("[inventario] Firebird bulk lookup error:", err);
    return [];
  }
}

// ── Ensure tables exist ─────────────────────────────────────────────────────

async function ensureTables() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'INVENTARIO_SESSOES')
    CREATE TABLE dbo.INVENTARIO_SESSOES (
      id            INT IDENTITY(1,1) PRIMARY KEY,
      loja          VARCHAR(100) NOT NULL,
      nome          VARCHAR(200) NOT NULL,
      status        VARCHAR(30) NOT NULL DEFAULT 'RASCUNHO',
      num_locais    INT NOT NULL DEFAULT 1,
      criado_por    VARCHAR(100) NOT NULL,
      criado_em     DATETIME NOT NULL DEFAULT GETDATE(),
      enviado_em    DATETIME NULL,
      aprovado_por  VARCHAR(100) NULL,
      aprovado_em   DATETIME NULL,
      feedback      NVARCHAR(MAX) NULL,
      total_itens   INT NOT NULL DEFAULT 0,
      total_contados INT NOT NULL DEFAULT 0
    );

    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'INVENTARIO_SESSOES' AND COLUMN_NAME = 'num_locais')
      ALTER TABLE dbo.INVENTARIO_SESSOES ADD num_locais INT NOT NULL DEFAULT 1;

    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'INVENTARIO_LOCAIS')
    CREATE TABLE dbo.INVENTARIO_LOCAIS (
      id          INT IDENTITY(1,1) PRIMARY KEY,
      sessao_id   INT NOT NULL REFERENCES dbo.INVENTARIO_SESSOES(id),
      ordem       INT NOT NULL DEFAULT 1,
      nome        VARCHAR(200) NOT NULL
    );

    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'INVENTARIO_ITENS')
    CREATE TABLE dbo.INVENTARIO_ITENS (
      id            INT IDENTITY(1,1) PRIMARY KEY,
      sessao_id     INT NOT NULL REFERENCES dbo.INVENTARIO_SESSOES(id),
      pro_codigo    VARCHAR(50) NOT NULL,
      descricao     VARCHAR(300) NULL,
      qtd_sistema   DECIMAL(18,4) NOT NULL DEFAULT 0,
      custo_fiscal  DECIMAL(18,4) NULL,
      editado_por   VARCHAR(100) NULL,
      editado_em    DATETIME NULL
    );

    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'INVENTARIO_CONTAGENS')
    CREATE TABLE dbo.INVENTARIO_CONTAGENS (
      id          INT IDENTITY(1,1) PRIMARY KEY,
      item_id     INT NOT NULL REFERENCES dbo.INVENTARIO_ITENS(id),
      local_id    INT NOT NULL REFERENCES dbo.INVENTARIO_LOCAIS(id),
      qtd_contada DECIMAL(18,4) NULL,
      contado_por VARCHAR(100) NULL,
      contado_em  DATETIME NULL,
      CONSTRAINT UQ_CONTAGEM_ITEM_LOCAL UNIQUE (item_id, local_id)
    );

    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'INVENTARIO_LOGS')
    CREATE TABLE dbo.INVENTARIO_LOGS (
      id          INT IDENTITY(1,1) PRIMARY KEY,
      sessao_id   INT NOT NULL REFERENCES dbo.INVENTARIO_SESSOES(id),
      usuario     VARCHAR(100) NOT NULL,
      acao        VARCHAR(100) NOT NULL,
      detalhes    NVARCHAR(MAX) NULL,
      criado_em   DATETIME NOT NULL DEFAULT GETDATE()
    );
  `);
}

let tablesReady = false;
async function init() {
  if (tablesReady) return;
  await ensureTables();
  tablesReady = true;
}

// Helper: add log
async function addLog(sessaoId: number, usuario: string, acao: string, detalhes?: string) {
  const pool = await getPool();
  await pool.request()
    .input("sessao_id", sql.Int, sessaoId)
    .input("usuario", sql.VarChar(100), usuario)
    .input("acao", sql.VarChar(100), acao)
    .input("detalhes", sql.NVarChar(sql.MAX), detalhes ?? null)
    .query(`INSERT INTO dbo.INVENTARIO_LOGS (sessao_id, usuario, acao, detalhes) VALUES (@sessao_id, @usuario, @acao, @detalhes)`);
}

// Helper: update session counts
// An item is "contado" when it has at least one non-null contagem
async function refreshCounts(sessaoId: number) {
  const pool = await getPool();
  await pool.request()
    .input("id", sql.Int, sessaoId)
    .query(`
      UPDATE dbo.INVENTARIO_SESSOES SET
        total_itens = (SELECT COUNT(*) FROM dbo.INVENTARIO_ITENS WHERE sessao_id = @id),
        total_contados = (
          SELECT COUNT(*) FROM dbo.INVENTARIO_ITENS i
          WHERE i.sessao_id = @id
            AND EXISTS (
              SELECT 1 FROM dbo.INVENTARIO_CONTAGENS c
              WHERE c.item_id = i.id AND c.qtd_contada IS NOT NULL
            )
        )
      WHERE id = @id
    `);
}

// ── Firebird users (for linking Hub ↔ Sistema) ─────────────────────────────

router.get("/usuarios-sistema", async (_req: Request, res: Response) => {
  try {
    const rows = await queryFb<{ USU_CODIGO: number; USU_NOME: string }>(
      `SELECT USU_CODIGO, USU_NOME FROM USUARIOS ORDER BY USU_CODIGO`
    );
    res.json(rows.map((r) => ({ codigo: r.USU_CODIGO, nome: r.USU_NOME })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sessions CRUD ───────────────────────────────────────────────────────────

// List sessions (optional ?loja=)
router.get("/sessoes", async (req: Request, res: Response) => {
  try {
    await init();
    const pool = await getPool();
    const loja = req.query.loja as string | undefined;
    const r = pool.request();
    let where = "";
    if (loja) {
      r.input("loja", sql.VarChar(100), loja);
      where = "WHERE loja = @loja";
    }
    const result = await r.query(`SELECT * FROM dbo.INVENTARIO_SESSOES ${where} ORDER BY criado_em DESC`);
    res.json(result.recordset);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create session (with num_locais → auto-create named locations)
router.post("/sessoes", async (req: Request, res: Response) => {
  try {
    await init();
    const { loja, nome, usuario, num_locais, nomes_locais } = req.body;
    if (!loja || !nome || !usuario) return res.status(400).json({ error: "loja, nome e usuario são obrigatórios" });

    // Block if there are open/draft orders
    const pedidosAbertos = await checkPedidosAbertos();
    if (pedidosAbertos > 0) {
      return res.status(409).json({
        error: `Não é possível criar sessão de inventário: há ${pedidosAbertos} pedido(s) em aberto ou rascunho. Finalize-os antes de iniciar o inventário.`,
        pedidos_abertos: pedidosAbertos,
      });
    }

    const n = Math.max(1, Math.min(50, Number(num_locais) || 1));

    const pool = await getPool();
    const result = await pool.request()
      .input("loja", sql.VarChar(100), loja)
      .input("nome", sql.VarChar(200), nome)
      .input("usuario", sql.VarChar(100), usuario)
      .input("num_locais", sql.Int, n)
      .query(`INSERT INTO dbo.INVENTARIO_SESSOES (loja, nome, criado_por, num_locais) OUTPUT INSERTED.* VALUES (@loja, @nome, @usuario, @num_locais)`);
    const sessao = result.recordset[0];

    // Create location rows
    const names: string[] = Array.isArray(nomes_locais) && nomes_locais.length === n
      ? nomes_locais.map((s: any) => String(s).trim() || `Local ${n}`)
      : Array.from({ length: n }, (_, i) => `Local ${i + 1}`);

    for (let i = 0; i < n; i++) {
      await pool.request()
        .input("sessao_id", sql.Int, sessao.id)
        .input("ordem", sql.Int, i + 1)
        .input("nome", sql.VarChar(200), names[i])
        .query(`INSERT INTO dbo.INVENTARIO_LOCAIS (sessao_id, ordem, nome) VALUES (@sessao_id, @ordem, @nome)`);
    }

    const locaisStr = names.join(", ");
    await addLog(sessao.id, usuario, "SESSAO_CRIADA", `Sessão "${nome}" — loja ${loja} — ${n} local(is): ${locaisStr}`);

    // Auto-import all products with saldo > 0 from Firebird
    const produtos = await fetchProdutosComSaldo();
    let importados = 0;
    if (produtos.length > 0) {
      const locaisRes = await pool.request()
        .input("sid", sql.Int, sessao.id)
        .query(`SELECT id FROM dbo.INVENTARIO_LOCAIS WHERE sessao_id = @sid ORDER BY ordem`);

      for (const prod of produtos) {
        const codigo = String(prod.PRO_CODIGO);
        const descricao = prod.PRO_RESUMO ?? null;
        const qtdSistema = Number(prod.SALDO_ATUAL ?? 0);
        const custoFiscal = prod.PCF_CUSTO_FISCAL != null && Number(prod.PCF_CUSTO_FISCAL) !== 0 ? Number(prod.PCF_CUSTO_FISCAL) : 0.01;

        const ins = await pool.request()
          .input("sessao_id", sql.Int, sessao.id)
          .input("pro_codigo", sql.VarChar(50), codigo)
          .input("descricao", sql.VarChar(300), descricao)
          .input("qtd_sistema", sql.Decimal(18, 4), qtdSistema)
          .input("custo_fiscal", sql.Decimal(18, 4), custoFiscal)
          .query(`INSERT INTO dbo.INVENTARIO_ITENS (sessao_id, pro_codigo, descricao, qtd_sistema, custo_fiscal)
                  OUTPUT INSERTED.id VALUES (@sessao_id, @pro_codigo, @descricao, @qtd_sistema, @custo_fiscal)`);
        const itemId = ins.recordset[0].id;

        for (const loc of locaisRes.recordset) {
          await pool.request()
            .input("item_id", sql.Int, itemId)
            .input("local_id", sql.Int, loc.id)
            .query(`INSERT INTO dbo.INVENTARIO_CONTAGENS (item_id, local_id) VALUES (@item_id, @local_id)`);
        }
        importados++;
      }
      await refreshCounts(sessao.id);
    }
    await addLog(sessao.id, usuario, "IMPORTACAO_AUTOMATICA", `${importados} produtos com saldo importados do Firebird`);

    res.status(201).json({ ...sessao, itens_importados: importados });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get session detail + locais + items with contagens
router.get("/sessoes/:id", async (req: Request, res: Response) => {
  try {
    await init();
    const pool = await getPool();
    const sid = Number(req.params.id);
    const sessao = await pool.request()
      .input("id", sql.Int, sid)
      .query(`SELECT * FROM dbo.INVENTARIO_SESSOES WHERE id = @id`);
    if (!sessao.recordset.length) return res.status(404).json({ error: "Sessão não encontrada" });

    const locais = await pool.request()
      .input("sid", sql.Int, sid)
      .query(`SELECT * FROM dbo.INVENTARIO_LOCAIS WHERE sessao_id = @sid ORDER BY ordem`);

    const itens = await pool.request()
      .input("sid", sql.Int, sid)
      .query(`SELECT * FROM dbo.INVENTARIO_ITENS WHERE sessao_id = @sid ORDER BY id`);

    const contagens = await pool.request()
      .input("sid", sql.Int, sid)
      .query(`
        SELECT c.* FROM dbo.INVENTARIO_CONTAGENS c
        JOIN dbo.INVENTARIO_ITENS i ON i.id = c.item_id
        WHERE i.sessao_id = @sid
      `);

    // Group contagens by item_id
    const contagensMap: Record<number, any[]> = {};
    for (const c of contagens.recordset) {
      if (!contagensMap[c.item_id]) contagensMap[c.item_id] = [];
      contagensMap[c.item_id].push(c);
    }

    // Attach contagens to each item + compute qtd_contada (sum of filled counts)
    const itensEnriched = itens.recordset.map((item: any) => {
      const cs = contagensMap[item.id] || [];
      const filled = cs.filter((c: any) => c.qtd_contada !== null);
      const qtd_contada = filled.length > 0
        ? filled.reduce((sum: number, c: any) => sum + Number(c.qtd_contada), 0)
        : null;
      return { ...item, qtd_contada, contagens: cs };
    });

    res.json({ ...sessao.recordset[0], locais: locais.recordset, itens: itensEnriched });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update session status (RASCUNHO → EM_ANDAMENTO → CONCLUIDO → ENVIADO → APROVADO | REJEITADO)
router.patch("/sessoes/:id/status", async (req: Request, res: Response) => {
  try {
    await init();
    const { status, usuario, feedback } = req.body;
    if (!status || !usuario) return res.status(400).json({ error: "status e usuario obrigatórios" });

    const pool = await getPool();
    const sessaoRes = await pool.request()
      .input("id", sql.Int, Number(req.params.id))
      .query(`SELECT * FROM dbo.INVENTARIO_SESSOES WHERE id = @id`);
    if (!sessaoRes.recordset.length) return res.status(404).json({ error: "Sessão não encontrada" });
    const sessao = sessaoRes.recordset[0];

    const transitions: Record<string, string[]> = {
      RASCUNHO: ["EM_ANDAMENTO"],
      EM_ANDAMENTO: ["CONCLUIDO"],
      CONCLUIDO: ["ENVIADO"],
      ENVIADO: ["APROVADO", "REJEITADO"],
      REJEITADO: ["EM_ANDAMENTO"],
    };
    const allowed = transitions[sessao.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Transição ${sessao.status} → ${status} não permitida` });
    }

    // Block EM_ANDAMENTO if there are open/draft orders in Firebird
    if (status === "EM_ANDAMENTO" && sessao.status === "RASCUNHO") {
      const pedidosAbertos = await checkPedidosAbertos();
      if (pedidosAbertos > 0) {
        return res.status(409).json({
          error: `Não é possível iniciar o inventário: há ${pedidosAbertos} pedido(s) em aberto ou rascunho. Finalize-os antes de iniciar a contagem.`,
          pedidos_abertos: pedidosAbertos,
        });
      }
    }

    const r = pool.request()
      .input("id", sql.Int, sessao.id)
      .input("status", sql.VarChar(30), status);

    let extra = "";
    if (status === "ENVIADO") {
      r.input("enviado_em", sql.DateTime, new Date());
      extra = ", enviado_em = @enviado_em";
    }
    if (status === "APROVADO" || status === "REJEITADO") {
      r.input("aprovado_por", sql.VarChar(100), usuario);
      r.input("aprovado_em", sql.DateTime, new Date());
      r.input("feedback", sql.NVarChar(sql.MAX), feedback ?? null);
      extra = ", aprovado_por = @aprovado_por, aprovado_em = @aprovado_em, feedback = @feedback";
    }
    if (status === "EM_ANDAMENTO" && sessao.status === "REJEITADO") {
      r.input("feedback_clear", sql.NVarChar(sql.MAX), null);
      extra = ", aprovado_por = NULL, aprovado_em = NULL, feedback = NULL";
    }

    await r.query(`UPDATE dbo.INVENTARIO_SESSOES SET status = @status${extra} WHERE id = @id`);
    await addLog(sessao.id, usuario, `STATUS_${status}`, feedback ? `Feedback: ${feedback}` : undefined);

    // ── Sync to Firebird on APROVADO — create 2 inventories (contados + não contados) ──
    if (status === "APROVADO") {
      try {
        // Get usu_codigo_sistema for the approving user
        const usuApp = await pool.request()
          .input("usuario", sql.VarChar(150), usuario)
          .query(`SELECT usu_codigo_sistema FROM dbo.USUARIOS_APPS WHERE usuario = @usuario AND app_key = 'inventario'`);
        const usuCodigoSistema = usuApp.recordset[0]?.usu_codigo_sistema ?? 12;

        const now = new Date();
        const baseNome = sessao.nome ? String(sessao.nome).substring(0, 40) : `HUB #${sessao.id}`;

        // Load all items with their counted quantities
        const allItens = await pool.request()
          .input("sid", sql.Int, sessao.id)
          .query(`SELECT * FROM dbo.INVENTARIO_ITENS WHERE sessao_id = @sid`);
        const allContagens = await pool.request()
          .input("sid", sql.Int, sessao.id)
          .query(`
            SELECT c.* FROM dbo.INVENTARIO_CONTAGENS c
            JOIN dbo.INVENTARIO_ITENS i ON i.id = c.item_id
            WHERE i.sessao_id = @sid
          `);
        const cMap: Record<number, any[]> = {};
        for (const c of allContagens.recordset) {
          if (!cMap[c.item_id]) cMap[c.item_id] = [];
          cMap[c.item_id].push(c);
        }

        // Split items into counted vs uncounted
        const itensContados: any[] = [];
        const itensNaoContados: any[] = [];
        for (const item of allItens.recordset) {
          const cs = cMap[item.id] || [];
          const filled = cs.filter((c: any) => c.qtd_contada !== null);
          if (filled.length > 0) {
            const qtdContada = filled.reduce((sum: number, c: any) => sum + Number(c.qtd_contada), 0);
            itensContados.push({ ...item, qtdContada });
          } else {
            itensNaoContados.push({ ...item, qtdContada: 0 });
          }
        }

        // Helper to create one Firebird inventory
        async function criarInventarioFb(obs: string, itens: any[]): Promise<number> {
          const maxIdRows = await queryFb<{ MX: number }>(`SELECT MAX(PRI_ID) AS MX FROM PRODUTOS_INVENTARIO WHERE EMP_FIL_CODIGO = 1`);
          const priId = (maxIdRows[0]?.MX ?? 0) + 1;

          await executeFb(
            `INSERT INTO PRODUTOS_INVENTARIO (EMP_FIL_CODIGO, PRI_ID, PRI_DATA, PRI_OBS1, PRI_STS_CODIGO, PRI_USU_CODIGO, PRI_DATASISTEMA, PRI_PLE_ORIGEM, PRI_IND_AGRUPADO, PRI_VLR_TOTAL, PRI_ALTERA_CUSTO_FISCAL)
             VALUES (1, ?, ?, ?, 'AA', ?, ?, 1, 1, 0, 0)`,
            [priId, now, obs, usuCodigoSistema, now]
          );

          let vlrTotal = 0;
          for (const item of itens) {
            const saldoAnterior = Number(item.qtd_sistema ?? 0);
            const custoUnit = Number(item.custo_fiscal ?? 0.01);
            const vlrItem = item.qtdContada * custoUnit;
            vlrTotal += vlrItem;

            await executeFb(
              `INSERT INTO PRODUTOS_INVENTARIO_ITENS (EMP_FIL_CODIGO, PRI_ID, PII_PRO_CODIGO, PII_SALDOANTERIOR, PII_INVENTARIO, PII_SALDOATUAL, PII_ID, PII_USU_CODIGO, PII_DATASISTEMA, PII_PLE_ORIGEM, PII_VLR_UNITARIO, PII_VLR_TOTAL)
               VALUES (1, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?, ?)`,
              [priId, Number(item.pro_codigo), saldoAnterior, item.qtdContada, item.qtdContada, usuCodigoSistema, now, custoUnit, vlrItem]
            );
          }

          await executeFb(
            `UPDATE PRODUTOS_INVENTARIO SET PRI_VLR_TOTAL = ? WHERE EMP_FIL_CODIGO = 1 AND PRI_ID = ?`,
            [vlrTotal, priId]
          );

          return priId;
        }

        // Create inventory for COUNTED items
        const priContados = await criarInventarioFb(`${baseNome} - CONTADOS`, itensContados);
        // Create inventory for UNCOUNTED items
        const priNaoContados = await criarInventarioFb(`${baseNome} - NAO CONTADOS`, itensNaoContados);

        await addLog(
          sessao.id, usuario, "FIREBIRD_SYNC",
          `Inventário CONTADOS #${priContados} (${itensContados.length} itens) e NAO CONTADOS #${priNaoContados} (${itensNaoContados.length} itens) criados no Firebird (status AA)`
        );
      } catch (fbErr: any) {
        console.error("[inventario] Firebird sync error:", fbErr);
        await addLog(sessao.id, usuario, "FIREBIRD_SYNC_ERRO", fbErr.message);
      }
    }

    res.json({ mensagem: `Status atualizado para ${status}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete session (only RASCUNHO)
router.delete("/sessoes/:id", async (req: Request, res: Response) => {
  try {
    await init();
    const pool = await getPool();
    const sid = Number(req.params.id);
    const sessaoRes = await pool.request()
      .input("id", sql.Int, sid)
      .query(`SELECT * FROM dbo.INVENTARIO_SESSOES WHERE id = @id`);
    if (!sessaoRes.recordset.length) return res.status(404).json({ error: "Sessão não encontrada" });
    if (sessaoRes.recordset[0].status !== "RASCUNHO") return res.status(400).json({ error: "Só é possível excluir sessões em rascunho" });

    await pool.request().input("id", sql.Int, sid).query(`
      DELETE c FROM dbo.INVENTARIO_CONTAGENS c
      JOIN dbo.INVENTARIO_ITENS i ON i.id = c.item_id
      WHERE i.sessao_id = @id
    `);
    await pool.request().input("id", sql.Int, sid).query(`DELETE FROM dbo.INVENTARIO_LOGS WHERE sessao_id = @id`);
    await pool.request().input("id", sql.Int, sid).query(`DELETE FROM dbo.INVENTARIO_ITENS WHERE sessao_id = @id`);
    await pool.request().input("id", sql.Int, sid).query(`DELETE FROM dbo.INVENTARIO_LOCAIS WHERE sessao_id = @id`);
    await pool.request().input("id", sql.Int, sid).query(`DELETE FROM dbo.INVENTARIO_SESSOES WHERE id = @id`);
    res.json({ mensagem: "Sessão excluída" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Locations ────────────────────────────────────────────────────────────────

// Add new location to existing session
router.post("/sessoes/:id/locais", async (req: Request, res: Response) => {
  try {
    await init();
    const { nome, usuario } = req.body;
    if (!nome || !String(nome).trim() || !usuario) return res.status(400).json({ error: "nome e usuario obrigatórios" });

    const pool = await getPool();
    const sid = Number(req.params.id);

    const sessaoRes = await pool.request()
      .input("id", sql.Int, sid)
      .query(`SELECT * FROM dbo.INVENTARIO_SESSOES WHERE id = @id`);
    if (!sessaoRes.recordset.length) return res.status(404).json({ error: "Sessão não encontrada" });
    const sessao = sessaoRes.recordset[0];

    if (!["RASCUNHO", "EM_ANDAMENTO"].includes(sessao.status)) {
      return res.status(400).json({ error: "Não é possível adicionar locais neste status de sessão" });
    }

    // Get next ordem
    const maxOrdem = await pool.request()
      .input("sid", sql.Int, sid)
      .query(`SELECT ISNULL(MAX(ordem), 0) AS mx FROM dbo.INVENTARIO_LOCAIS WHERE sessao_id = @sid`);
    const nextOrdem = maxOrdem.recordset[0].mx + 1;

    // Insert local
    const localRes = await pool.request()
      .input("sessao_id", sql.Int, sid)
      .input("ordem", sql.Int, nextOrdem)
      .input("nome", sql.VarChar(200), String(nome).trim())
      .query(`INSERT INTO dbo.INVENTARIO_LOCAIS (sessao_id, ordem, nome) OUTPUT INSERTED.* VALUES (@sessao_id, @ordem, @nome)`);
    const newLocal = localRes.recordset[0];

    // Update num_locais
    await pool.request()
      .input("id", sql.Int, sid)
      .input("n", sql.Int, nextOrdem)
      .query(`UPDATE dbo.INVENTARIO_SESSOES SET num_locais = @n WHERE id = @id`);

    // Create empty contagem rows for all existing items
    const itensRes = await pool.request()
      .input("sid", sql.Int, sid)
      .query(`SELECT id FROM dbo.INVENTARIO_ITENS WHERE sessao_id = @sid`);
    for (const item of itensRes.recordset) {
      await pool.request()
        .input("item_id", sql.Int, item.id)
        .input("local_id", sql.Int, newLocal.id)
        .query(`INSERT INTO dbo.INVENTARIO_CONTAGENS (item_id, local_id) VALUES (@item_id, @local_id)`);
    }

    await addLog(sid, usuario, "LOCAL_ADICIONADO", `Local "${String(nome).trim()}" adicionado (ordem ${nextOrdem})`);
    res.status(201).json(newLocal);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Rename location

router.patch("/locais/:id", async (req: Request, res: Response) => {
  try {
    await init();
    const { nome } = req.body;
    if (!nome || !String(nome).trim()) return res.status(400).json({ error: "nome obrigatório" });
    const pool = await getPool();
    await pool.request()
      .input("id", sql.Int, Number(req.params.id))
      .input("nome", sql.VarChar(200), String(nome).trim())
      .query(`UPDATE dbo.INVENTARIO_LOCAIS SET nome = @nome WHERE id = @id`);
    res.json({ mensagem: "Local renomeado" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Items ───────────────────────────────────────────────────────────────────

// Add item to session (auto-creates empty contagem rows for each local)
router.post("/sessoes/:id/itens", async (req: Request, res: Response) => {
  try {
    await init();
    const { pro_codigo, usuario } = req.body;
    if (!pro_codigo || !usuario) return res.status(400).json({ error: "pro_codigo e usuario obrigatórios" });

    const pool = await getPool();
    const sid = Number(req.params.id);
    const sessaoRes = await pool.request()
      .input("id", sql.Int, sid)
      .query(`SELECT * FROM dbo.INVENTARIO_SESSOES WHERE id = @id`);
    if (!sessaoRes.recordset.length) return res.status(404).json({ error: "Sessão não encontrada" });
    const sessao = sessaoRes.recordset[0];
    if (!["RASCUNHO", "EM_ANDAMENTO"].includes(sessao.status)) {
      return res.status(400).json({ error: `Não é possível adicionar itens em sessão com status ${sessao.status}` });
    }

    // Check duplicate
    const dup = await pool.request()
      .input("sid", sql.Int, sessao.id)
      .input("codigo", sql.VarChar(50), String(pro_codigo).trim())
      .query(`SELECT id FROM dbo.INVENTARIO_ITENS WHERE sessao_id = @sid AND pro_codigo = @codigo`);
    if (dup.recordset.length) {
      return res.status(409).json({ error: "Produto já inserido nesta sessão", item_id: dup.recordset[0].id });
    }

    // Lookup product in Firebird to get descricao, qtd_sistema, custo_fiscal
    const fbData = await lookupProduto(String(pro_codigo).trim());
    const descricao = fbData?.descricao ?? req.body.descricao ?? null;
    const qtd_sistema = fbData?.qtd_sistema ?? req.body.qtd_sistema ?? 0;
    const rawCusto = fbData?.custo_fiscal ?? req.body.custo_fiscal ?? null;
    const custo_fiscal = rawCusto != null && Number(rawCusto) !== 0 ? Number(rawCusto) : 0.01;

    const result = await pool.request()
      .input("sessao_id", sql.Int, sessao.id)
      .input("pro_codigo", sql.VarChar(50), String(pro_codigo).trim())
      .input("descricao", sql.VarChar(300), descricao)
      .input("qtd_sistema", sql.Decimal(18, 4), qtd_sistema)
      .input("custo_fiscal", sql.Decimal(18, 4), custo_fiscal)
      .query(`
        INSERT INTO dbo.INVENTARIO_ITENS (sessao_id, pro_codigo, descricao, qtd_sistema, custo_fiscal)
        OUTPUT INSERTED.*
        VALUES (@sessao_id, @pro_codigo, @descricao, @qtd_sistema, @custo_fiscal)
      `);
    const item = result.recordset[0];

    // Auto-create one contagem row per location
    const locais = await pool.request()
      .input("sid", sql.Int, sessao.id)
      .query(`SELECT id FROM dbo.INVENTARIO_LOCAIS WHERE sessao_id = @sid ORDER BY ordem`);

    for (const loc of locais.recordset) {
      await pool.request()
        .input("item_id", sql.Int, item.id)
        .input("local_id", sql.Int, loc.id)
        .query(`INSERT INTO dbo.INVENTARIO_CONTAGENS (item_id, local_id) VALUES (@item_id, @local_id)`);
    }

    await refreshCounts(sessao.id);
    await addLog(sessao.id, usuario, "ITEM_ADICIONADO", `Produto ${pro_codigo}`);
    res.status(201).json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update a specific contagem (count for one item at one location)
router.patch("/contagens/:id", async (req: Request, res: Response) => {
  try {
    await init();
    const { qtd_contada, usuario } = req.body;
    if (usuario === undefined || qtd_contada === undefined) return res.status(400).json({ error: "qtd_contada e usuario obrigatórios" });
    if (Number(qtd_contada) < 0) return res.status(400).json({ error: "Quantidade deve ser positiva" });

    const pool = await getPool();
    const cRes = await pool.request()
      .input("id", sql.Int, Number(req.params.id))
      .query(`
        SELECT c.*, i.pro_codigo, i.sessao_id, s.status AS sessao_status
        FROM dbo.INVENTARIO_CONTAGENS c
        JOIN dbo.INVENTARIO_ITENS i ON i.id = c.item_id
        JOIN dbo.INVENTARIO_SESSOES s ON s.id = i.sessao_id
        WHERE c.id = @id
      `);
    if (!cRes.recordset.length) return res.status(404).json({ error: "Contagem não encontrada" });
    const contagem = cRes.recordset[0];

    if (!["RASCUNHO", "EM_ANDAMENTO"].includes(contagem.sessao_status)) {
      return res.status(400).json({ error: "Não é possível editar contagens neste status de sessão" });
    }

    // Block if open/draft orders exist
    const pedidosAbertos = await checkPedidosAbertos();
    if (pedidosAbertos > 0) {
      return res.status(409).json({
        error: `Não é possível inserir contagem: há ${pedidosAbertos} pedido(s) em aberto ou rascunho. Resolva as pendências no sistema antes de continuar.`,
        pedidos_abertos: pedidosAbertos,
      });
    }

    const oldQtd = contagem.qtd_contada;
    await pool.request()
      .input("id", sql.Int, contagem.id)
      .input("qtd", sql.Decimal(18, 4), Number(qtd_contada))
      .input("usuario", sql.VarChar(100), usuario)
      .input("now", sql.DateTime, new Date())
      .query(`UPDATE dbo.INVENTARIO_CONTAGENS SET qtd_contada = @qtd, contado_por = @usuario, contado_em = @now WHERE id = @id`);

    await refreshCounts(contagem.sessao_id);

    // Get local name for log
    const localRes = await pool.request()
      .input("lid", sql.Int, contagem.local_id)
      .query(`SELECT nome FROM dbo.INVENTARIO_LOCAIS WHERE id = @lid`);
    const localNome = localRes.recordset[0]?.nome ?? `Local ${contagem.local_id}`;
    await addLog(contagem.sessao_id, usuario, "CONTAGEM_EDITADA", `${contagem.pro_codigo} @ ${localNome}: ${oldQtd ?? "—"} → ${qtd_contada}`);
    res.json({ mensagem: "Contagem atualizada" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Edit item metadata (managers only — e.g. qtd_sistema override)
router.patch("/itens/:id", async (req: Request, res: Response) => {
  try {
    await init();
    const { usuario } = req.body;
    if (!usuario) return res.status(400).json({ error: "usuario obrigatório" });

    const pool = await getPool();
    const itemRes = await pool.request()
      .input("id", sql.Int, Number(req.params.id))
      .query(`SELECT i.*, s.status AS sessao_status FROM dbo.INVENTARIO_ITENS i JOIN dbo.INVENTARIO_SESSOES s ON s.id = i.sessao_id WHERE i.id = @id`);
    if (!itemRes.recordset.length) return res.status(404).json({ error: "Item não encontrado" });
    const item = itemRes.recordset[0];

    if (!["RASCUNHO", "EM_ANDAMENTO"].includes(item.sessao_status)) {
      return res.status(400).json({ error: "Não é possível editar itens neste status de sessão" });
    }

    // Allow updating descricao, qtd_sistema, custo_fiscal
    const sets: string[] = [];
    const r = pool.request().input("id", sql.Int, item.id);
    if (req.body.descricao !== undefined) {
      r.input("descricao", sql.VarChar(300), req.body.descricao);
      sets.push("descricao = @descricao");
    }
    if (req.body.qtd_sistema !== undefined) {
      r.input("qtd_sistema", sql.Decimal(18, 4), Number(req.body.qtd_sistema));
      sets.push("qtd_sistema = @qtd_sistema");
    }
    if (req.body.custo_fiscal !== undefined) {
      r.input("custo_fiscal", sql.Decimal(18, 4), req.body.custo_fiscal);
      sets.push("custo_fiscal = @custo_fiscal");
    }
    if (sets.length === 0) return res.status(400).json({ error: "Nenhum campo para atualizar" });

    r.input("editado_por", sql.VarChar(100), usuario);
    r.input("editado_em", sql.DateTime, new Date());
    sets.push("editado_por = @editado_por", "editado_em = @editado_em");

    await r.query(`UPDATE dbo.INVENTARIO_ITENS SET ${sets.join(", ")} WHERE id = @id`);
    await addLog(item.sessao_id, usuario, "ITEM_EDITADO", `Produto ${item.pro_codigo} — campos: ${sets.filter(s => !s.startsWith("editado")).join(", ")}`);
    res.json({ mensagem: "Item atualizado" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete item (+ its contagens)
router.delete("/itens/:id", async (req: Request, res: Response) => {
  try {
    await init();
    const pool = await getPool();
    const itemRes = await pool.request()
      .input("id", sql.Int, Number(req.params.id))
      .query(`SELECT i.*, s.status AS sessao_status FROM dbo.INVENTARIO_ITENS i JOIN dbo.INVENTARIO_SESSOES s ON s.id = i.sessao_id WHERE i.id = @id`);
    if (!itemRes.recordset.length) return res.status(404).json({ error: "Item não encontrado" });
    const item = itemRes.recordset[0];
    if (!["RASCUNHO", "EM_ANDAMENTO"].includes(item.sessao_status)) {
      return res.status(400).json({ error: "Não é possível remover itens neste status" });
    }

    await pool.request().input("id", sql.Int, item.id).query(`DELETE FROM dbo.INVENTARIO_CONTAGENS WHERE item_id = @id`);
    await pool.request().input("id", sql.Int, item.id).query(`DELETE FROM dbo.INVENTARIO_ITENS WHERE id = @id`);
    await refreshCounts(item.sessao_id);
    await addLog(item.sessao_id, req.body.usuario || "Sistema", "ITEM_REMOVIDO", `Produto ${item.pro_codigo}`);
    res.json({ mensagem: "Item removido" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Logs ─────────────────────────────────────────────────────────────────────

router.get("/sessoes/:id/logs", async (req: Request, res: Response) => {
  try {
    await init();
    const pool = await getPool();
    const result = await pool.request()
      .input("id", sql.Int, Number(req.params.id))
      .query(`SELECT * FROM dbo.INVENTARIO_LOGS WHERE sessao_id = @id ORDER BY criado_em DESC`);
    res.json(result.recordset);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Product lookup (placeholder — needs store DB connection) ─────────────────

router.get("/produto/:codigo", async (req: Request, res: Response) => {
  try {
    const codigo = String(req.params.codigo);
    const data = await lookupProduto(codigo);
    if (!data) {
      return res.status(404).json({ error: "Produto não encontrado no Firebird" });
    }
    res.json({ pro_codigo: codigo, ...data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
