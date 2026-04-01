import { Router, Request } from "express";
import { getPool } from "../db/sqlserver";
import Firebird from "node-firebird";

const router = Router();
const ML_API = "https://api.mercadolibre.com";

// ── Firebird ecommerce connection ────────────────────────────────────────────
function queryEcommerceFirebird<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const config: Firebird.Options = {
    host:     process.env.DB_FIREBIRD_ECOMMERCE_HOST!,
    port:     Number(process.env.DB_FIREBIRD_ECOMMERCE_PORT) || 3050,
    database: process.env.DB_FIREBIRD_ECOMMERCE_PATH!,
    user:     process.env.DB_FIREBIRD_ECOMMERCE_USER || "SYSDBA",
    password: process.env.DB_FIREBIRD_ECOMMERCE_PASSWORD || "masterkey",
  };
  return new Promise((resolve, reject) => {
    Firebird.attach(config, (err, db) => {
      if (err) return reject(err);
      db.transaction(Firebird.ISOLATION_READ_COMMITTED, (err2, tx) => {
        if (err2) { db.detach(); return reject(err2); }
        tx.query(sql, params, (err3, result) => {
          tx.commit(() => db.detach());
          if (err3) return reject(err3);
          resolve(result as T[]);
        });
      });
    });
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const t = auth.slice(7);
    if (t && t !== "null" && t !== "undefined") return t;
  }
  return null;
}

function mlHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function getFallbackRate(listingType?: string): number {
  const rates: Record<string, number> = { gold_pro: 0.165, gold_special: 0.14, free: 0.0 };
  return rates[listingType ?? ""] ?? 0.14;
}

const SHIPPING_TABLE = [
  { maxWeight: 0.3,  costs: [5.65, 6.55, 7.75, 12.35, 14.35, 16.45, 18.45, 20.95] },
  { maxWeight: 0.5,  costs: [5.95, 6.65, 7.85, 13.25, 15.45, 17.65, 19.85, 22.55] },
  { maxWeight: 1.0,  costs: [6.05, 6.75, 7.95, 13.85, 16.15, 18.45, 20.75, 23.65] },
  { maxWeight: 1.5,  costs: [6.15, 6.85, 8.05, 14.15, 16.45, 18.85, 21.15, 24.65] },
  { maxWeight: 2.0,  costs: [6.25, 6.95, 8.15, 14.45, 16.85, 19.25, 21.65, 24.65] },
  { maxWeight: 3.0,  costs: [6.35, 7.15, 8.35, 15.75, 18.35, 21.05, 23.65, 26.25] },
  { maxWeight: 4.0,  costs: [6.45, 7.35, 8.55, 17.05, 19.85, 22.75, 25.65, 28.35] },
  { maxWeight: 5.0,  costs: [6.55, 7.55, 8.75, 18.45, 21.55, 24.65, 27.75, 30.75] },
  { maxWeight: 9.0,  costs: [6.85, 7.95, 9.15, 25.45, 28.55, 32.65, 35.75, 39.75] },
  { maxWeight: 13.0, costs: [8.35, 9.65, 11.25, 41.25, 46.25, 52.95, 57.95, 64.35] },
  { maxWeight: 17.0, costs: [8.35, 9.65, 11.25, 45.95, 51.55, 58.95, 64.55, 71.65] },
  { maxWeight: 30.0, costs: [8.35, 9.65, 11.25, 49.45, 55.45, 63.45, 69.45, 77.15] },
];

function estimateShipping(price: number, weightGrams: number): number {
  const kg = weightGrams / 1000;
  const row = SHIPPING_TABLE.find(r => kg <= r.maxWeight) ?? SHIPPING_TABLE[SHIPPING_TABLE.length - 1];
  if (price < 19)  return row.costs[0];
  if (price < 49)  return row.costs[1];
  if (price < 79)  return row.costs[2];
  if (price < 100) return row.costs[3];
  if (price < 120) return row.costs[4];
  if (price < 150) return row.costs[5];
  if (price < 200) return row.costs[6];
  return row.costs[7];
}

// ── Cache custo operacional (30 min) ─────────────────────────────────────────
let custoCache: { base: Record<number, { venda_total: number; qtd_total: number; grand_total: number }> | null; ts: number } = { base: null, ts: 0 };
const CUSTO_TTL = 30 * 60 * 1000;

// ── Routes ───────────────────────────────────────────────────────────────────

/** GET /api/ecommerce/produto/:codigo */
router.get("/produto/:codigo", async (req, res) => {
  try {
    const rows = await queryEcommerceFirebird<any>(
      `SELECT pro.pro_codigo, pro.pro_resumo AS resumo, tp.tbp_custo AS custo, pt.ptr_peso_embalagem AS peso
       FROM produtos pro
       INNER JOIN tabelas_produtos tp ON tp.tbp_pro_codigo = pro.pro_codigo
       INNER JOIN produtos_tray pt ON pt.ptr_pro_codigo = pro.pro_codigo
       WHERE tp.tbp_tab_codigo = 1 AND pro.pro_codigo = ?`,
      [Number(req.params.codigo)]
    );
    if (!rows.length) return res.status(404).json({ error: "Produto não encontrado" });
    const r = rows[0];
    res.json({
      pro_codigo: r.PRO_CODIGO ?? r.pro_codigo,
      resumo:     r.RESUMO     ?? r.resumo,
      custo:      r.CUSTO      ?? r.custo,
      peso:       r.PESO       ?? r.peso,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/ecommerce/produtos */
router.get("/produtos", async (_req, res) => {
  try {
    const rows = await queryEcommerceFirebird<any>(
      `SELECT pro.pro_codigo, pro.pro_resumo AS resumo,
              t1.tbp_custo AS custo, t4.tbp_custo AS preco, pt.ptr_peso_embalagem AS peso
       FROM produtos pro
       LEFT JOIN tabelas_produtos t1 ON t1.tbp_pro_codigo = pro.pro_codigo AND t1.tbp_tab_codigo = 1
       LEFT JOIN tabelas_produtos t4 ON t4.tbp_pro_codigo = pro.pro_codigo AND t4.tbp_tab_codigo = 4
       INNER JOIN produtos_tray pt ON pt.ptr_pro_codigo = pro.pro_codigo
       WHERE t1.tbp_pro_codigo IS NOT NULL`
    );
    res.json(rows.map(r => ({
      pro_codigo: r.PRO_CODIGO ?? r.pro_codigo,
      resumo:     r.RESUMO     ?? r.resumo,
      custo:      r.CUSTO      ?? r.custo,
      preco:      r.PRECO      ?? r.preco,
      peso:       r.PESO       ?? r.peso,
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/ecommerce/custo-operacional */
router.get("/custo-operacional", async (req, res) => {
  const valorParticipacao = parseFloat(String(req.query.valor_participacao ?? 2000000));
  try {
    if (!custoCache.base || Date.now() - custoCache.ts > CUSTO_TTL) {
      const pool = await getPool();
      const result = await pool.request().query(`
        DECLARE @D0 DATE = DATEADD(MONTH, DATEDIFF(MONTH,0,GETDATE())-3, 0);
        DECLARE @D1 DATE = EOMONTH(GETDATE(),-1);
        WITH
        comercial  AS (SELECT CODIGO AS PRO_CODIGO, SUM(VALORTOTAL) AS VALOR, SUM(QTD) AS QTD FROM [TI-COMERCIAL_62-ControleEP] WHERE DATA BETWEEN @D0 AND @D1 GROUP BY CODIGO),
        desconto   AS (SELECT PRO_CODIGO, SUM(PRECO_DESCONTO) AS VALOR, SUM(QTDE) AS QTD FROM [TI-VENDAS_25-Desconto] WHERE PDV_DATA BETWEEN @D0 AND @D1 GROUP BY PRO_CODIGO),
        ecommerce  AS (SELECT TRY_CAST(PRO_CODIGO AS INT) AS PRO_CODIGO, SUM(VALORTOTALITEM) AS VALOR, SUM(PVI_QUANTIDADE) AS QTD FROM [TI-MARKETING_95-VendaEcommerce] WHERE EMP='FULL' AND PDV_DATA BETWEEN @D0 AND @D1 GROUP BY TRY_CAST(PRO_CODIGO AS INT)),
        todos      AS (SELECT CODIGO AS PRO_CODIGO FROM [TI-COMERCIAL_62-ControleEP] WHERE DATA BETWEEN @D0 AND @D1 UNION SELECT PRO_CODIGO FROM [TI-VENDAS_25-Desconto] WHERE PDV_DATA BETWEEN @D0 AND @D1 UNION SELECT TRY_CAST(PRO_CODIGO AS INT) FROM [TI-MARKETING_95-VendaEcommerce] WHERE EMP='FULL' AND PDV_DATA BETWEEN @D0 AND @D1 AND TRY_CAST(PRO_CODIGO AS INT) IS NOT NULL),
        consolidado AS (SELECT t.PRO_CODIGO, COALESCE(c.VALOR,0)+COALESCE(d.VALOR,0)+COALESCE(e.VALOR,0) AS VENDA_TOTAL, COALESCE(c.QTD,0)+COALESCE(d.QTD,0)+COALESCE(e.QTD,0) AS QTD_TOTAL FROM todos t LEFT JOIN comercial c ON t.PRO_CODIGO=c.PRO_CODIGO LEFT JOIN desconto d ON t.PRO_CODIGO=d.PRO_CODIGO LEFT JOIN ecommerce e ON t.PRO_CODIGO=e.PRO_CODIGO),
        grand      AS (SELECT SUM(VENDA_TOTAL) AS TOTAL FROM consolidado WHERE VENDA_TOTAL>0)
        SELECT c.PRO_CODIGO, c.VENDA_TOTAL, c.QTD_TOTAL, g.TOTAL AS GRAND_TOTAL
        FROM consolidado c CROSS JOIN grand g WHERE c.VENDA_TOTAL > 0
      `);
      const base: typeof custoCache.base = {};
      for (const row of result.recordset) {
        if (row.PRO_CODIGO == null) continue;
        base[row.PRO_CODIGO] = {
          venda_total: Number(row.VENDA_TOTAL) || 0,
          qtd_total:   Number(row.QTD_TOTAL)   || 0,
          grand_total: Number(row.GRAND_TOTAL)  || 0,
        };
      }
      custoCache = { base, ts: Date.now() };
    }

    const result: Record<number, object> = {};
    for (const [codigo, item] of Object.entries(custoCache.base!)) {
      const grand = item.grand_total;
      if (grand <= 0) continue;
      const perc = item.venda_total / grand;
      const valorRateado = perc * valorParticipacao;
      const qtdMedia = item.qtd_total / 3;
      result[Number(codigo)] = {
        perc_participacao:          Math.round(perc * 10000) / 100,
        valor_participacao_rateado: Math.round(valorRateado * 100) / 100,
        qtd_media_mensal:           Math.round(qtdMedia * 100) / 100,
        custo_operacional_unit:     qtdMedia > 0 ? Math.round((valorRateado / qtdMedia) * 10000) / 10000 : null,
      };
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/ecommerce/token-salvo */
router.get("/token-salvo", async (_req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query("SELECT TOP 1 TOKEN FROM TOKEN_FULL ORDER BY id DESC");
    const row = result.recordset[0];
    if (!row?.TOKEN) return res.status(404).json({ error: "Token não encontrado" });
    res.json({ token: row.TOKEN });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/ecommerce/auth/token */
router.post("/auth/token", async (req, res) => {
  const token = getToken(req) ?? req.body?.access_token;
  if (!token) return res.status(400).json({ error: "Token obrigatório" });
  try {
    const r = await fetch(`${ML_API}/users/me`, { headers: mlHeaders(token) as any });
    if (!r.ok) return res.status(401).json({ error: "Token inválido" });
    const data: any = await r.json();
    res.json({ message: "Autenticado", seller_id: data.id, nickname: data.nickname });
  } catch {
    res.status(401).json({ error: "Token inválido" });
  }
});

/** GET /api/ecommerce/my-items */
router.get("/my-items", async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: "Token obrigatório" });
  const sellerId = req.query.seller_id as string;
  if (!sellerId) return res.status(400).json({ error: "seller_id obrigatório" });
  try {
    const search = await fetch(`${ML_API}/users/${sellerId}/items/search?status=active`, { headers: mlHeaders(token) as any });
    search.ok || (() => { throw new Error("Erro ML") })();
    const ids: string[] = (await search.json() as any).results ?? [];
    if (!ids.length) return res.json({ items: [] });
    const top = ids.slice(0, 20).join(",");
    const items = await fetch(`${ML_API}/items?ids=${top}&attributes=id,title,price,category_id,listing_type_id,thumbnail`, { headers: mlHeaders(token) as any });
    const data: any[] = await items.json();
    res.json({ items: data.map((i: any) => i.body) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/ecommerce/simulate */
router.post("/simulate", async (req, res) => {
  const body = req.body ?? {};
  const price = parseFloat(body.price);
  if (!price) return res.status(400).json({ error: "price obrigatório" });

  const quantity    = parseInt(body.quantity ?? 1);
  const cost        = parseFloat(body.cost ?? 0);
  const weight      = parseInt(body.weight ?? 500);
  const freeShip    = body.free_shipping !== false;
  const listingType = body.listing_type_id as string | undefined;
  const itemId      = body.item_id as string | undefined;
  const sellerId    = body.seller_id as string | undefined;
  const categoryId  = body.category_id as string | undefined;
  const taxRate     = body.tax_rate != null ? parseFloat(body.tax_rate) / 100 : 0.21;

  const grossRevenue = price * quantity;
  let mlFeePercent   = getFallbackRate(listingType);
  let mlFeeAmount    = grossRevenue * mlFeePercent;
  let shippingCost   = 0;
  const token        = getToken(req);

  // Real ML fees
  if (token && itemId) {
    try {
      const r = await fetch(`${ML_API}/items/${itemId}/fees?price=${price}&quantity=${quantity}`, { headers: mlHeaders(token) as any });
      if (r.ok) {
        const d: any = await r.json();
        const sfd = d.sale_fee_details;
        if (sfd?.percentage != null) { mlFeePercent = sfd.percentage / 100; mlFeeAmount = sfd.amount ?? grossRevenue * mlFeePercent; }
        else if (d.sale_fee != null) { mlFeeAmount = d.sale_fee; mlFeePercent = mlFeeAmount / grossRevenue; }
      }
    } catch {}
  } else if (token && categoryId && listingType) {
    try {
      const r = await fetch(`${ML_API}/sites/MLB/listing_prices?price=${price}&listing_type_id=${listingType}&category_id=${categoryId}`, { headers: mlHeaders(token) as any });
      if (r.ok) {
        const d: any = await r.json();
        if (d.sale_fee_amount != null) { mlFeeAmount = d.sale_fee_amount * quantity; mlFeePercent = mlFeeAmount / grossRevenue; }
      }
    } catch {}
  }

  // Shipping
  if (price >= 79 || freeShip) {
    let gotShipping = false;
    if (token && sellerId) {
      try {
        const dim = `15x15x15,${weight}`;
        const lt  = listingType ?? "gold_pro";
        const r   = await fetch(`${ML_API}/users/${sellerId}/shipping_options/free?item_price=${price}&dimensions=${dim}&listing_type_id=${lt}&condition=new`, { headers: mlHeaders(token) as any });
        if (r.ok) {
          const coverage = (await r.json() as any).coverage?.all_country ?? {};
          if (coverage.promotional_cost != null || coverage.list_cost != null) {
            shippingCost = coverage.promotional_cost ?? coverage.list_cost;
            gotShipping  = true;
          }
        }
      } catch {}
    }
    if (!gotShipping) shippingCost = estimateShipping(price, weight);
  }

  shippingCost    *= quantity;
  const productCost = cost * quantity;
  const taxAmount   = grossRevenue * taxRate;
  const netProfit   = grossRevenue - mlFeeAmount - shippingCost - taxAmount - productCost;
  const margin      = grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0;

  res.json({
    results: {
      gross_revenue:   grossRevenue,
      ml_fee_percent:  mlFeePercent * 100,
      ml_fee_amount:   mlFeeAmount,
      shipping_cost:   shippingCost,
      tax_rate_percent: taxRate * 100,
      tax_amount:      taxAmount,
      product_cost:    productCost,
      net_profit:      netProfit,
      margin_percent:  margin,
    },
  });
});

export default router;
