import { Router } from "express";
import { queryFirebird } from "../db/firebird";
import { getPool } from "../db/sqlserver";
import mssql from "mssql";

const router = Router();

// ── Mapeamentos de loja ────────────────────────────────────────────────────
type FbKey = "l3" | "l2" | "bh" | "campinas" | "riopreto" | "fortaleza";

const LOJA_TO_FB: Record<string, FbKey> = {
  l3: "l3",       rj: "l3",
  l2: "l2",       santana: "l2",
  bh: "bh",
  campinas: "campinas",
  riopreto: "riopreto",
  fortaleza: "fortaleza",
};

// METAS_VENDEDORES usa códigos internos diferentes
const LOJA_TO_META: Record<string, string> = {
  l3: "l3",       rj: "l3",
  l2: "l2",       santana: "l2",
  bh: "bh",
  campinas: "l1",
  riopreto: "riopreto",
  fortaleza: "fortaleza",
};

const LOJA_DISPLAY: Record<string, string> = {
  l3: "Rio de Janeiro",
  l2: "Santana",
  bh: "Belo Horizonte",
  campinas: "Campinas",
  riopreto: "Rio Preto",
  fortaleza: "Fortaleza",
};

// ── Helper: garante tabela CRM_LOGS ─────────────────────────────────────────
async function ensureCrmTable(pool: any) {
  await pool.request().query(`
    IF OBJECT_ID('dbo.CRM_LOGS', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.CRM_LOGS (
        ID            INT IDENTITY(1,1) PRIMARY KEY,
        DATA_REGISTRO DATETIME DEFAULT GETDATE(),
        LOJA          VARCHAR(50)   NULL,
        CLIENTE_ID    INT           NULL,
        CLIENTE_NOME  VARCHAR(200)  NULL,
        CLIENTE_TELEFONE VARCHAR(20) NULL,
        STATUS_CONTATO   VARCHAR(50) NULL,
        DATA_RETORNO  DATETIME      NULL,
        OBS           NVARCHAR(MAX) NULL,
        REP_CODIGO    INT           NULL,
        REP_LOGIN     VARCHAR(100)  NULL
      );
    END
  `);
}

// ── Título-case para nomes ───────────────────────────────────────────────────
function toTitleCase(str: string): string {
  const excecoes = ["de", "da", "do", "das", "dos", "e"];
  return str
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (excecoes.includes(w) && i > 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

// ────────────────────────────────────────────────────────────────────────────
// GET /api/sales-compass/clientes?loja=l3&rep_codigo=571  (SSE stream)
// Resolve o Cloudflare 524 mantendo a conexão viva com pings enquanto o
// Firebird processa. Os dados chegam em chunks progressivos para o frontend.
// ────────────────────────────────────────────────────────────────────────────
router.get("/clientes", async (req, res) => {
  const lojaKey = String(req.query.loja || "").toLowerCase().trim();
  const repCodigoStr = req.query.rep_codigo;

  if (repCodigoStr === undefined || repCodigoStr === "") {
    return res.status(400).json({ error: "rep_codigo é obrigatório." });
  }
  if (!lojaKey) {
    return res.status(400).json({ error: "loja é obrigatória." });
  }

  const repCodigo = Number(repCodigoStr);
  const fbKey = LOJA_TO_FB[lojaKey];
  if (!fbKey) {
    return res.status(404).json({ error: `Loja "${lojaKey}" não configurada no Sales Compass.` });
  }

  // ── Abre SSE imediatamente — evita 524 do Cloudflare ────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const pingInterval = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => clearInterval(pingInterval));

  try {
    send("progress", { status: "querying", message: "Consultando base de dados..." });

    const whereRep = repCodigo !== 0
      ? "(c.cli_rep_codigo = ? OR CAST(c.cli_rep_codigo AS INTEGER) = ?)"
      : "1=1";

    const fbSql = `
      SELECT
        c.cli_codigo  AS ID,
        c.cli_nome    AS NOME,
        COALESCE(c.cli_whatsapp, c.cli_fone, c.cli_celular, '0') AS TELEFONE,
        pv.pdv_numero   AS ID_PEDIDO,
        pv.pdv_data     AS DATA_COMPRA,
        p.pro_resumo    AS PRODUTO,
        pvi.pvi_quantidade AS QUANTIDADE,
        c.cli_rep_codigo   AS REP_ID,
        SUM(pvi.pvi_totalitem) AS VALOR_PEDIDO
      FROM clientes c
      LEFT JOIN pedidos_vendas pv
             ON c.cli_codigo = pv.pdv_cli_codigo
            AND pv.pdv_psi_codigo NOT IN ('CC')
      LEFT JOIN pedidos_vendas_itens pvi ON pvi.pvi_numero = pv.pdv_numero
      LEFT JOIN produtos p ON p.pro_codigo = pvi.pvi_pro_codigo
      WHERE ${whereRep}
        AND (pv.pdv_tve_codigo IS NULL OR pv.pdv_tve_codigo NOT IN ('6','7','26','34'))
      GROUP BY 1,2,3,4,5,6,7,8
    `;

    const params = repCodigo !== 0 ? [String(repCodigo), repCodigo] : [];
    const rows = await queryFirebird<any>(fbKey, fbSql, params);

    send("progress", { status: "processing", message: `Processando ${rows.length} registros...` });

    const clientesMap: Record<string, {
      id: string; nome: string; telefone: string; cidade: string; repId: any;
      pedidos: Map<any, { data: any; valor: number }>;
      produtos: Record<string, number>;
    }> = {};

    for (const row of rows) {
      const id = String(row.ID).trim();
      if (!clientesMap[id]) {
        clientesMap[id] = {
          id,
          nome: row.NOME ? String(row.NOME).trim() : "Sem Nome",
          telefone: row.TELEFONE ? String(row.TELEFONE).trim() : "Não informado",
          cidade: LOJA_DISPLAY[lojaKey] ?? lojaKey.toUpperCase(),
          repId: row.REP_ID,
          pedidos: new Map(),
          produtos: {},
        };
      }
      const c = clientesMap[id];
      if (row.ID_PEDIDO && !c.pedidos.has(row.ID_PEDIDO)) {
        c.pedidos.set(row.ID_PEDIDO, { data: row.DATA_COMPRA, valor: Number(row.VALOR_PEDIDO) || 0 });
      }
      if (row.PRODUTO) {
        const nome = String(row.PRODUTO).trim();
        c.produtos[nome] = (c.produtos[nome] || 0) + (Number(row.QUANTIDADE) || 0);
      }
    }

    const allEntries = Object.values(clientesMap);
    const BATCH_SIZE = 150;

    for (let i = 0; i < allEntries.length; i += BATCH_SIZE) {
      const batch = allEntries.slice(i, i + BATCH_SIZE).map((c) => {
        const pedidos = Array.from(c.pedidos.values()).sort(
          (a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()
        );
        const ultima = pedidos[0] ?? null;
        const valorTotal = pedidos.reduce((acc, p) => acc + p.valor, 0);
        const ticketMedio = pedidos.length > 0 ? valorTotal / pedidos.length : 0;
        const diasSemComprar = ultima?.data
          ? Math.floor((Date.now() - new Date(ultima.data).getTime()) / 86400000)
          : 9999;

        const topProdutos = Object.entries(c.produtos)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([n]) => n);

        return {
          id: c.id,
          nome: c.nome,
          telefone: c.telefone,
          cidade: c.cidade,
          categoria: ticketMedio > 800 ? "A" : ticketMedio > 500 ? "B" : ticketMedio > 300 ? "C" : "D",
          produtoFavorito: topProdutos.length > 0 ? topProdutos.join(", ") : "Diversos",
          ultimaCompra: ultima?.data ? new Date(ultima.data).toISOString() : new Date().toISOString(),
          valorUltimaCompra: ultima?.valor ?? 0,
          ticketMedio,
          frequenciaMensal: pedidos.length >= 3 && diasSemComprar <= 30,
          repId: c.repId,
        };
      });
      send("chunk", batch);
    }

    send("done", { total: allEntries.length });
  } catch (err: any) {
    console.error("[sales-compass] /clientes:", err.message);
    send("error", { message: err.message || "Erro ao buscar clientes." });
  } finally {
    clearInterval(pingInterval);
    res.end();
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/sales-compass/crm
// ────────────────────────────────────────────────────────────────────────────
router.post("/crm", async (req, res) => {
  try {
    const { loja, clienteId, nome, telefone, status, dataHora, obs, repCodigo, repLogin } = req.body;

    const pool = await getPool();
    await ensureCrmTable(pool);

    const safeInt = (v: any) => {
      if (v === 0 || v === "0") return 0;
      const n = Number(v);
      return v && v !== "undefined" && v !== "" && !isNaN(n) ? n : null;
    };
    const safeStr = (v: any) => (v && v !== "undefined" ? String(v) : null);

    await pool.request()
      .input("LOJA",             mssql.VarChar,  loja)
      .input("CLIENTE_ID",       mssql.Int,       safeInt(clienteId))
      .input("CLIENTE_NOME",     mssql.VarChar,   nome)
      .input("CLIENTE_TELEFONE", mssql.VarChar,   telefone)
      .input("STATUS_CONTATO",   mssql.VarChar,   status)
      .input("DATA_RETORNO",     mssql.DateTime,  dataHora ? new Date(dataHora) : null)
      .input("OBS",              mssql.NVarChar(mssql.MAX), obs)
      .input("REP_CODIGO",       mssql.Int,       safeInt(repCodigo))
      .input("REP_LOGIN",        mssql.VarChar,   safeStr(repLogin))
      .query(`
        INSERT INTO CRM_LOGS
          (DATA_REGISTRO, LOJA, CLIENTE_ID, CLIENTE_NOME, CLIENTE_TELEFONE,
           STATUS_CONTATO, DATA_RETORNO, OBS, REP_CODIGO, REP_LOGIN)
        VALUES
          (GETDATE(), @LOJA, @CLIENTE_ID, @CLIENTE_NOME, @CLIENTE_TELEFONE,
           @STATUS_CONTATO, @DATA_RETORNO, @OBS, @REP_CODIGO, @REP_LOGIN)
      `);

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[sales-compass] /crm:", err.message);
    res.status(500).json({ error: err.message || "Erro ao salvar CRM." });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/sales-compass/crm-logs?loja=l3
// ────────────────────────────────────────────────────────────────────────────
router.get("/crm-logs", async (req, res) => {
  const lojaKey = String(req.query.loja || "").toLowerCase().trim();
  if (!lojaKey) return res.status(400).json({ error: "loja é obrigatória." });

  try {
    const pool = await getPool();
    await ensureCrmTable(pool);

    const result = await pool.request()
      .input("loja", mssql.VarChar, lojaKey)
      .query(`
        SELECT
          DATA_REGISTRO    AS dataFull,
          LOJA             AS loja,
          CLIENTE_ID       AS clienteId,
          CLIENTE_NOME     AS nomeCliente,
          CLIENTE_TELEFONE AS telefone,
          STATUS_CONTATO   AS status,
          OBS              AS obs,
          REP_CODIGO       AS rep_codigo,
          REP_LOGIN        AS repLogin
        FROM CRM_LOGS
        WHERE LOWER(LOJA) = LOWER(@loja)
        ORDER BY DATA_REGISTRO DESC
      `);
    console.log(`[sales-compass] /crm-logs loja="${lojaKey}" → ${result.recordset.length} registros`);
    res.json(result.recordset);
  } catch (err: any) {
    console.error("[sales-compass] /crm-logs:", err.message);
    res.status(500).json({ error: err.message || "Erro ao buscar logs." });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/sales-compass/vendedor?loja=l3&rep_codigo=571&mes=5
// ────────────────────────────────────────────────────────────────────────────
router.get("/vendedor", async (req, res) => {
  try {
    const lojaKey = String(req.query.loja || "").toLowerCase().trim();
    const repCodigoStr = req.query.rep_codigo;
    if (repCodigoStr === undefined || repCodigoStr === "")
      return res.status(400).json({ error: "rep_codigo é obrigatório." });

    const repCodigo = Number(repCodigoStr);
    const mes = Number(req.query.mes) || new Date().getMonth() + 1;
    const ano = new Date().getFullYear();

    const metaCode = LOJA_TO_META[lojaKey] || lojaKey;
    const fbKey = LOJA_TO_FB[lojaKey];

    let meta = 0;
    let repNome = "Vendedor";

    try {
      const pool = await getPool();
      const query = repCodigo === 0
        ? `SELECT 0 AS rep_codigo, 'Gestão de Loja' AS rep_nome, @loja AS loja,
                  SUM(CAST(meta_valor AS DECIMAL(18,2))) AS meta_valor
           FROM METAS_VENDEDORES
           WHERE loja = @loja AND CAST(mes AS INT) = @mes AND CAST(rep_codigo AS INT) > 0`
        : `SELECT rep_codigo, rep_nome, loja, meta_valor
           FROM METAS_VENDEDORES
           WHERE rep_codigo = @rep_codigo AND CAST(mes AS INT) = @mes AND loja = @loja`;

      const r = await pool.request()
        .input("rep_codigo", mssql.VarChar, String(repCodigo))
        .input("mes",        mssql.Int,     mes)
        .input("loja",       mssql.VarChar, metaCode)
        .query(query);

      if (r.recordset.length > 0) {
        meta = Number(r.recordset[0].meta_valor) || 0;
        repNome = toTitleCase(String(r.recordset[0].rep_nome || "Vendedor"));
      }
    } catch (metaErr: any) {
      console.warn("[sales-compass] METAS_VENDEDORES error:", metaErr.message);
    }

    let realizado = 0;
    if (fbKey) {
      try {
        const dataInicio = `${ano}-${String(mes).padStart(2, "0")}-01`;
        const ultimoDia = new Date(ano, mes, 0).getDate();
        const dataFim   = `${ano}-${String(mes).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;

        const fbSql = repCodigo === 0
          ? `SELECT SUM(CAST(pdv_valorliquido AS DECIMAL(18,2))) AS TOTAL
             FROM pedidos_vendas
             WHERE pdv_psi_codigo NOT IN ('CC') AND pdv_data >= ? AND pdv_data <= ?`
          : `SELECT SUM(CAST(pdv_valorliquido AS DECIMAL(18,2))) AS TOTAL
             FROM pedidos_vendas
             WHERE pdv_rep_codigo = ? AND pdv_psi_codigo NOT IN ('CC')
               AND pdv_data >= ? AND pdv_data <= ?`;

        const fbParams = repCodigo === 0
          ? [dataInicio, dataFim]
          : [repCodigo, dataInicio, dataFim];

        const fbResult = await queryFirebird<any>(fbKey, fbSql, fbParams);
        realizado = Number(fbResult[0]?.TOTAL) || 0;
      } catch (fbErr: any) {
        console.warn("[sales-compass] Firebird vendas error:", fbErr.message);
      }
    }

    res.json({ nome: repNome, loja: lojaKey, meta, realizado });
  } catch (err: any) {
    console.error("[sales-compass] /vendedor:", err.message);
    res.status(500).json({ error: err.message || "Erro ao buscar vendedor." });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/sales-compass/vendedores?loja=l3
// ────────────────────────────────────────────────────────────────────────────
router.get("/vendedores", async (req, res) => {
  const lojaKey = String(req.query.loja || "").toLowerCase().trim();
  if (!lojaKey) return res.status(400).json({ error: "loja é obrigatória." });

  try {
    const pool = await getPool();
    const metaCode = LOJA_TO_META[lojaKey] || lojaKey;

    const result = await pool.request()
      .input("loja", mssql.VarChar, metaCode)
      .query(`
        SELECT DISTINCT rep_codigo, rep_nome
        FROM METAS_VENDEDORES
        WHERE loja = @loja AND CAST(rep_codigo AS INT) > 0
        ORDER BY rep_nome
      `);

    res.json(result.recordset.map((r: any) => ({
      rep_codigo: Number(r.rep_codigo),
      rep_nome: toTitleCase(String(r.rep_nome || "")),
    })));
  } catch (err: any) {
    console.error("[sales-compass] /vendedores:", err.message);
    res.status(500).json({ error: err.message || "Erro ao buscar vendedores." });
  }
});

export default router;
