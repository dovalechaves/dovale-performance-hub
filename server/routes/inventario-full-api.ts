import { Router, Request, Response } from "express";
import sql from "mssql";
import Firebird from "node-firebird";
import { getPool } from "../db/sqlserver";
import type { Server as SocketServer } from "socket.io";
import * as XLSX from "xlsx";
import os from "os";
import path from "path";
import fs from "fs";
// fetch is native in Node 18+

// ── Chatwoot TI ──
const CW_TI_BASE = process.env.CW_TI_BASE || "http://192.168.10.181:3000";
const CW_TI_TOKEN = process.env.CW_TI_TOKEN || "";
const CW_TI_INBOX = Number(process.env.CW_TI_INBOX) || 5;
const CW_TI_ACCOUNT = Number(process.env.CW_TI_ACCOUNT) || 1;

function cwHeaders() {
  return { api_access_token: CW_TI_TOKEN, "Content-Type": "application/json" };
}

async function cwBuscarContato(telefone: string): Promise<number | null> {
  const digitos = telefone.replace(/\D/g, "");
  const termo = digitos.slice(-9);
  const r = await fetch(`${CW_TI_BASE}/api/v1/accounts/${CW_TI_ACCOUNT}/contacts/search?q=${termo}&page=1&per_page=10&include_contacts=true`, { headers: cwHeaders() });
  if (!r.ok) return null;
  const j: any = await r.json();
  return j.payload?.[0]?.id ?? null;
}

async function cwCriarContato(telefone: string): Promise<number | null> {
  const r = await fetch(`${CW_TI_BASE}/api/v1/accounts/${CW_TI_ACCOUNT}/contacts`, {
    method: "POST", headers: cwHeaders(),
    body: JSON.stringify({ inbox_id: CW_TI_INBOX, phone_number: `+${telefone}`, name: telefone }),
  });
  if (!r.ok) return null;
  const j: any = await r.json();
  return j.payload?.contact?.id ?? j.id ?? null;
}

async function cwBuscarConversaAberta(contatoId: number): Promise<number | null> {
  const r = await fetch(`${CW_TI_BASE}/api/v1/accounts/${CW_TI_ACCOUNT}/contacts/${contatoId}/conversations`, { headers: cwHeaders() });
  if (!r.ok) return null;
  const j: any = await r.json();
  const convs = j.payload || [];
  const aberta = convs.find((c: any) => c.status === "open" && c.inbox_id === CW_TI_INBOX);
  return aberta?.id ?? null;
}

async function cwCriarConversa(contatoId: number): Promise<number | null> {
  const r = await fetch(`${CW_TI_BASE}/api/v1/accounts/${CW_TI_ACCOUNT}/conversations`, {
    method: "POST", headers: cwHeaders(),
    body: JSON.stringify({ contact_id: contatoId, inbox_id: CW_TI_INBOX, status: "open" }),
  });
  if (!r.ok) return null;
  const j: any = await r.json();
  return j.id ?? null;
}

async function cwEnviarMensagem(conversaId: number, msg: string): Promise<number | null> {
  const r = await fetch(`${CW_TI_BASE}/api/v1/accounts/${CW_TI_ACCOUNT}/conversations/${conversaId}/messages`, {
    method: "POST", headers: cwHeaders(),
    body: JSON.stringify({ content: msg, message_type: "outgoing", private: false }),
  });
  if (!r.ok) return null;
  const j: any = await r.json();
  return j.id ?? null;
}

async function cwEnviarArquivo(conversaId: number, filePath: string, caption?: string): Promise<number | null> {
  const form = new FormData();
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  form.append("attachments[]", new Blob([fileBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileName);
  if (caption) form.append("content", caption);
  form.append("message_type", "outgoing");
  form.append("private", "false");
  const r = await fetch(`${CW_TI_BASE}/api/v1/accounts/${CW_TI_ACCOUNT}/conversations/${conversaId}/messages`, {
    method: "POST",
    headers: { api_access_token: CW_TI_TOKEN },
    body: form,
  });
  if (!r.ok) { console.error(`[InvFullAPI→WPP] Arquivo falhou: ${r.status} ${await r.text()}`); return null; }
  const j: any = await r.json();
  return j.id ?? null;
}

const router = Router();

let io: SocketServer | null = null;
export function setInventarioFullIO(socketIO: SocketServer) { io = socketIO; }

// ── Firebird Configs ──────────────────────────────────────────────────────────

const fbConfigReplica: Firebird.Options = {
  host: process.env.DB_FIREBIRD_REPLICA_HOST || "localhost",
  port: Number(process.env.DB_FIREBIRD_REPLICA_PORT) || 3050,
  database: process.env.DB_FIREBIRD_REPLICA_PATH || "C:\\MSYSDADOS_REPLICA\\MSYSDADOS_REPLICA.FDB",
  user: process.env.DB_FIREBIRD_REPLICA_USER || "SYSDBA",
  password: process.env.DB_FIREBIRD_REPLICA_PASSWORD || "masterkey",
};

const fbConfigFortaleza: Firebird.Options = {
  host: process.env.DB_FIREBIRD_INV_HOST || "localhost",
  port: Number(process.env.DB_FIREBIRD_INV_PORT) || 3050,
  database: process.env.DB_FIREBIRD_INV_PATH || "C:\\Backup\\MICROSYS\\MSYSDADOS_FORTALEZA.FDB",
  user: process.env.DB_FIREBIRD_INV_USER || "SYSDBA",
  password: process.env.DB_FIREBIRD_INV_PASSWORD || "masterkey",
};

const FB_TIMEOUT_MS = 5000;

function queryFb<T = Record<string, unknown>>(config: Firebird.Options, sqlStr: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Firebird connection timeout")), FB_TIMEOUT_MS);
    Firebird.attach(config, (err, db) => {
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

function executeFb(config: Firebird.Options, sqlStr: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Firebird connection timeout")), FB_TIMEOUT_MS);
    Firebird.attach(config, (err, db) => {
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

interface FbProduto {
  PRO_CODIGO: number;
  PRO_RESUMO: string | null;
}

async function buscarProdutoPorCodigo(codigo: string, config = fbConfigFortaleza): Promise<FbProduto | null> {
  try {
    const rows = await queryFb<FbProduto>(
      config,
      `SELECT p.PRO_CODIGO, p.PRO_RESUMO FROM PRODUTOS p WHERE p.PRO_CODIGO = ?`,
      [Number(codigo)]
    );
    return rows[0] || null;
  } catch (err) {
    console.error("[inv-full-api] Erro buscar produto:", err);
    return null;
  }
}

async function buscarProdutosPorDescricao(termo: string, limit = 10, config = fbConfigFortaleza): Promise<FbProduto[]> {
  try {
    const rows = await queryFb<FbProduto>(
      config,
      `SELECT FIRST ${limit} p.PRO_CODIGO, p.PRO_RESUMO 
       FROM PRODUTOS p 
       WHERE UPPER(p.PRO_RESUMO) LIKE UPPER(?) 
       ORDER BY p.PRO_RESUMO`,
      [`%${termo}%`]
    );
    return rows;
  } catch (err) {
    console.error("[inv-full-api] Erro buscar produtos:", err);
    return [];
  }
}

// ── Ensure tables ───────────────────────────────────────────────────────────

async function ensureTables() {
  const pool = await getPool();
  
  // Sessões
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'INV_FULL_SESSOES')
    CREATE TABLE dbo.INV_FULL_SESSOES (
      id            INT IDENTITY(1,1) PRIMARY KEY,
      nome          VARCHAR(200) NOT NULL,
      status        VARCHAR(30) NOT NULL DEFAULT 'RASCUNHO',
      criado_por    VARCHAR(100) NOT NULL,
      criado_em     DATETIME NOT NULL DEFAULT GETDATE(),
      verificado_em DATETIME NULL,
      enviado_em    DATETIME NULL,
      aprovado_por  VARCHAR(100) NULL,
      aprovado_em   DATETIME NULL,
      feedback      NVARCHAR(MAX) NULL,
      total_itens   INT NOT NULL DEFAULT 0,
      total_mapeados INT NOT NULL DEFAULT 0,
      total_pendentes INT NOT NULL DEFAULT 0
    );
  `);

  // Marketplaces (locais)
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'INV_FULL_MARKETPLACES')
    CREATE TABLE dbo.INV_FULL_MARKETPLACES (
      id          INT IDENTITY(1,1) PRIMARY KEY,
      sessao_id   INT NOT NULL,
      codigo      VARCHAR(50) NOT NULL, -- ML, SHOPEE, AMAZON
      nome        VARCHAR(100) NOT NULL,
      ordem       INT NOT NULL DEFAULT 1
    );
  `);

  // Itens retornados das APIs
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'INV_FULL_ITENS')
    CREATE TABLE dbo.INV_FULL_ITENS (
      id            INT IDENTITY(1,1) PRIMARY KEY,
      sessao_id     INT NOT NULL,
      sku_marketplace VARCHAR(100) NOT NULL, -- SKU do anuncio
      titulo        NVARCHAR(500) NULL,
      pro_codigo    VARCHAR(50) NULL, -- mapeado para codigo interno
      descricao_interna VARCHAR(300) NULL,
      mapeado       BIT NOT NULL DEFAULT 0,
      mapeado_por   VARCHAR(100) NULL,
      mapeado_em    DATETIME NULL
    );
  `);

  // Estoques por marketplace (contagens)
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'INV_FULL_ESTOQUES')
    CREATE TABLE dbo.INV_FULL_ESTOQUES (
      id          INT IDENTITY(1,1) PRIMARY KEY,
      item_id     INT NOT NULL,
      marketplace_id INT NOT NULL,
      qtd_api     DECIMAL(18,4) NULL,
      buscado_em  DATETIME NULL,
      erro        NVARCHAR(500) NULL
    );
  `);

  // Tabela de mapeamento SKU -> PRO_CODIGO (persistente entre sessoes)
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'INV_FULL_SKU_MAP')
    CREATE TABLE dbo.INV_FULL_SKU_MAP (
      id            INT IDENTITY(1,1) PRIMARY KEY,
      sku_marketplace VARCHAR(100) NOT NULL,
      marketplace   VARCHAR(50) NOT NULL, -- ML, SHOPEE, AMAZON
      pro_codigo    VARCHAR(50) NOT NULL,
      titulo_original NVARCHAR(500) NULL,
      criado_por    VARCHAR(100) NULL,
      criado_em     DATETIME NOT NULL DEFAULT GETDATE()
    );
  `);

  // Inventario gerado no Firebird (quando aprovar)
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'INV_FULL_GERADO')
    CREATE TABLE dbo.INV_FULL_GERADO (
      id            INT IDENTITY(1,1) PRIMARY KEY,
      sessao_id     INT NOT NULL,
      pro_codigo    VARCHAR(50) NOT NULL,
      qtd_total     DECIMAL(18,4) NOT NULL,
      gerado_em     DATETIME NOT NULL DEFAULT GETDATE()
    );
  `);
}

// ── Marketplace API Functions ──────────────────────────────────────────────

interface ApiProduto {
  sku: string;
  titulo: string;
  qtd: number;
}

// Mercado Livre: buscar estoque de anuncios do seller
async function buscarEstoqueML(token: string, sellerId: string): Promise<ApiProduto[]> {
  const resultados: ApiProduto[] = [];
  let offset = 0;
  const limit = 50;
  
  while (true) {
    const url = `https://api.mercadolibre.com/users/${sellerId}/items/search?limit=${limit}&offset=${offset}&status=active`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 } as any);
    
    if (!resp.ok) {
      console.error(`[ML] Erro buscar itens: ${resp.status}`);
      break;
    }
    
    const data: any = await resp.json();
    const ids = data.results || [];
    if (!ids.length) break;
    
    // Buscar detalhes em batch (ML suporta multi-get)
    const idsBatch = ids.slice(0, 20).join(",");
    const itemsUrl = `https://api.mercadolibre.com/items?ids=${idsBatch}`;
    const itemsResp = await fetch(itemsUrl, { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 } as any);
    
    if (itemsResp.ok) {
      const itemsData: any = await itemsResp.json();
      for (const item of itemsData) {
        if (item.body) {
          resultados.push({
            sku: item.body.seller_sku || item.body.id,
            titulo: item.body.title || "Sem título",
            qtd: item.body.available_quantity || 0
          });
        }
      }
    }
    
    offset += limit;
    if (offset >= (data.paging?.total || 0)) break;
  }
  
  return resultados;
}

// Mercado Livre: buscar token do banco SQL Server
async function getMLAccessToken(): Promise<string> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP 1 TOKEN FROM TOKEN_FULL ORDER BY id DESC
  `);
  if (result.recordset.length === 0) {
    throw new Error("Nenhum token encontrado na tabela TOKEN_FULL");
  }
  return result.recordset[0].TOKEN;
}

// Amazon: trocar refresh token por access token
async function getAmazonAccessToken(): Promise<string> {
  const clientId = process.env.CLIENTE_ID || "";
  const clientSecret = process.env.CLIENTE_SECRET || "";
  const refreshToken = process.env.TOKEN || "";  // refresh token do .env
  
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Amazon: CLIENTE_ID, CLIENTE_SECRET ou TOKEN não configurados");
  }
  
  const payload = new URLSearchParams();
  payload.append("grant_type", "refresh_token");
  payload.append("refresh_token", refreshToken);
  payload.append("client_id", clientId);
  payload.append("client_secret", clientSecret);
  
  const resp = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload.toString(),
  });
  
  if (!resp.ok) {
    throw new Error(`Amazon token error: ${resp.status} ${await resp.text()}`);
  }
  
  const data: any = await resp.json();
  return data.access_token;
}

// Shopee: buscar estoque
async function buscarEstoqueShopee(shopId: string, accessToken: string, partnerId: string, partnerKey: string): Promise<ApiProduto[]> {
  const resultados: ApiProduto[] = [];
  let page = 1;
  const pageSize = 50;
  
  while (true) {
    const timestamp = Math.floor(Date.now() / 1000);
    const baseString = `${partnerId}/api/v2/product/get_item_list${timestamp}${accessToken}${shopId}`;
    const crypto = await import("crypto");
    const sign = crypto.createHmac("sha256", partnerKey).update(baseString).digest("hex");
    
    const url = `https://partner.shopeemobile.com/api/v2/product/get_item_list?partner_id=${partnerId}&timestamp=${timestamp}&access_token=${accessToken}&shop_id=${shopId}&sign=${sign}&offset=${(page-1)*pageSize}&page_size=${pageSize}&item_status=NORMAL`;
    
    const resp = await fetch(url, { timeout: 30000 } as any);
    if (!resp.ok) {
      console.error(`[Shopee] Erro: ${resp.status}`);
      break;
    }
    
    const data: any = await resp.json();
    const items = data.response?.item || [];
    if (!items.length) break;
    
    // Buscar detalhes de cada item para pegar SKU e estoque
    for (const item of items) {
      const itemId = item.item_id;
      const detailUrl = `https://partner.shopeemobile.com/api/v2/product/get_item_base_info?partner_id=${partnerId}&timestamp=${timestamp}&access_token=${accessToken}&shop_id=${shopId}&sign=${sign}&item_id_list=${itemId}`;
      const detailResp = await fetch(detailUrl, { timeout: 30000 } as any);
      
      if (detailResp.ok) {
        const detail: any = await detailResp.json();
        const itemDetail = detail.response?.item_list?.[0];
        if (itemDetail) {
          resultados.push({
            sku: itemDetail.item_sku || String(itemId),
            titulo: itemDetail.item_name || "Sem título",
            qtd: itemDetail.stock_info?.[0]?.current_stock || 0
          });
        }
      }
    }
    
    if (items.length < pageSize) break;
    page++;
  }
  
  return resultados;
}

// Amazon: buscar estoque FBA
async function buscarEstoqueAmazon(accessToken: string): Promise<ApiProduto[]> {
  const resultados: ApiProduto[] = [];
  
  // FBA Inventory API
  let nextToken: string | null = null;
  
  while (true) {
    const params = new URLSearchParams();
    params.append("details", "true");
    params.append("granularityType", "Marketplace");
    params.append("granularityId", "A2Q3Y263D00KWC"); // Brasil
    if (nextToken) params.append("nextToken", nextToken);
    
    const url = `https://sellingpartnerapi-na.amazon.com/fba/inventory/v1/getInventorySummaries?${params.toString()}`;
    const resp = await fetch(url, {
      headers: {
        "x-amz-access-token": accessToken,
        "Content-Type": "application/json"
      },
      timeout: 30000
    } as any);
    
    if (!resp.ok) {
      console.error(`[Amazon] Erro: ${resp.status}`);
      break;
    }
    
    const data: any = await resp.json();
    const summaries = data.payload?.inventorySummaries || [];
    
    for (const summary of summaries) {
      resultados.push({
        sku: summary.sellerSku || "N/A",
        titulo: summary.productName || "Sem título",
        qtd: summary.totalQuantity || 0
      });
    }
    
    nextToken = data.pagination?.nextToken;
    if (!nextToken) break;
  }
  
  return resultados;
}

// ── Rotas ───────────────────────────────────────────────────────────────────

// GET /sessoes - listar sessoes
router.get("/sessoes", async (req, res) => {
  try {
    await ensureTables();
    const pool = await getPool();
    const { status } = req.query;
    
    let where = "";
    if (status) where = `WHERE status = '${status}'`;
    
    const result = await pool.request().query(`
      SELECT s.*,
        (SELECT COUNT(*) FROM INV_FULL_ITENS WHERE sessao_id = s.id) as itens_count,
        (SELECT COUNT(*) FROM INV_FULL_ITENS WHERE sessao_id = s.id AND mapeado = 1) as mapeados_count
      FROM INV_FULL_SESSOES s
      ${where}
      ORDER BY s.criado_em DESC
    `);
    
    res.json(result.recordset);
  } catch (err: any) {
    console.error("[inv-full-api] GET /sessoes error:", err?.message);
    res.status(500).json({ error: "Erro ao listar sessões." });
  }
});

// POST /sessoes - criar nova sessao e disparar busca
router.post("/sessoes", async (req, res) => {
  try {
    await ensureTables();
    const { nome, criado_por } = req.body;
    if (!nome || !criado_por) return res.status(400).json({ error: "nome e criado_por obrigatórios" });
    
    const pool = await getPool();
    
    // Criar sessao
    const insert = await pool.request()
      .input("nome", sql.VarChar(200), nome)
      .input("criado_por", sql.VarChar(100), criado_por)
      .query(`INSERT INTO INV_FULL_SESSOES (nome, criado_por) OUTPUT INSERTED.id VALUES (@nome, @criado_por)`);
    
    const sessaoId = insert.recordset[0].id;
    
    // Criar marketplaces (locais)
    await pool.request()
      .input("sessao_id", sql.Int, sessaoId)
      .query(`
        INSERT INTO INV_FULL_MARKETPLACES (sessao_id, codigo, nome, ordem) VALUES
        (@sessao_id, 'ML', 'Mercado Livre', 1),
        (@sessao_id, 'SHOPEE', 'Shopee', 2),
        (@sessao_id, 'AMAZON', 'Amazon', 3)
      `);
    
    res.json({ id: sessaoId, status: "RASCUNHO", message: "Sessão criada. Inicie a verificação." });
  } catch (err: any) {
    console.error("[inv-full-api] POST /sessoes error:", err?.message);
    res.status(500).json({ error: err?.message || "Erro ao criar sessão." });
  }
});

// POST /sessoes/:id/verificar - iniciar busca nas APIs (async com Socket.IO)
router.post("/sessoes/:id/verificar", async (req, res) => {
  const sessaoId = parseInt(req.params.id);
  const socketId = req.body.socket_id;
  
  try {
    const pool = await getPool();
    
    // Buscar mapeamentos existentes
    const mapResult = await pool.request().query(`SELECT * FROM INV_FULL_SKU_MAP`);
    const skuMap = new Map<string, { pro_codigo: string; titulo: string }>();
    for (const row of mapResult.recordset) {
      skuMap.set(`${row.marketplace}:${row.sku_marketplace}`, { pro_codigo: row.pro_codigo, titulo: row.titulo_original || "" });
    }
    
    // Emitir progresso
    const emitProgress = (step: string, message: string, pct?: number) => {
      if (io && socketId) {
        io.to(socketId).emit("inv_full_progress", { step, message, pct, sessao_id: sessaoId });
      }
    };
    
    // Buscar tokens das env vars (mesmos nomes do Python api-ecomerce)
    // ML: token vem do banco SQL Server (TOKEN_FULL)
    // Shopee: PARTNER_ID, PARTNER_KEY, SHOP_ID, ACCESS_TOKEN
    // Amazon: CLIENTE_ID, CLIENTE_SECRET, TOKEN (refresh) → troca por access token
    
    const ML_SELLER_ID = "159732894";  // Hardcoded como no Python
    const shopeeShopId = process.env.SHOP_ID || "";
    const shopeeAccessToken = process.env.ACCESS_TOKEN || "";
    const shopeePartnerId = process.env.PARTNER_ID || "";
    const shopeePartnerKey = process.env.PARTNER_KEY || "";
    
    emitProgress("inicio", "Obtendo tokens das APIs...", 0);
    
    // Buscar tokens
    let mlToken: string;
    let amazonAccessToken: string;
    
    try {
      mlToken = await getMLAccessToken();
      emitProgress("tokens", "Token ML obtido do banco", 5);
    } catch (e: any) {
      console.error("[inv-full-api] Erro ao buscar token ML:", e?.message);
      mlToken = "";
    }
    
    try {
      amazonAccessToken = await getAmazonAccessToken();
      emitProgress("tokens", "Token Amazon obtido", 10);
    } catch (e: any) {
      console.error("[inv-full-api] Erro ao buscar token Amazon:", e?.message);
      amazonAccessToken = "";
    }
    
    emitProgress("inicio", "Iniciando verificação nas APIs...", 15);
    
    const marketplaces = [
      { codigo: "ML", nome: "Mercado Livre", buscar: () => buscarEstoqueML(mlToken, ML_SELLER_ID) },
      { codigo: "SHOPEE", nome: "Shopee", buscar: () => buscarEstoqueShopee(shopeeShopId, shopeeAccessToken, shopeePartnerId, shopeePartnerKey) },
      { codigo: "AMAZON", nome: "Amazon", buscar: () => buscarEstoqueAmazon(amazonAccessToken) }
    ];
    
    // Buscar IDs dos marketplaces
    const mpResult = await pool.request()
      .input("sessao_id", sql.Int, sessaoId)
      .query(`SELECT id, codigo FROM INV_FULL_MARKETPLACES WHERE sessao_id = @sessao_id`);
    const mpIds = new Map<string, number>();
    for (const row of mpResult.recordset) mpIds.set(row.codigo, row.id);
    
    let totalItens = 0;
    const todosSkus = new Set<string>();
    const estoquesPorSku = new Map<string, Map<string, { qtd: number; mpId: number }>>();
    
    // Buscar em cada marketplace
    for (let i = 0; i < marketplaces.length; i++) {
      const mp = marketplaces[i];
      emitProgress("api", `Buscando ${mp.nome}...`, Math.round((i / marketplaces.length) * 50));
      
      try {
        const produtos = await mp.buscar();
        emitProgress("api", `${mp.nome}: ${produtos.length} produtos encontrados`, Math.round((i / marketplaces.length) * 50));
        
        for (const prod of produtos) {
          const skuKey = prod.sku;
          todosSkus.add(skuKey);
          
          if (!estoquesPorSku.has(skuKey)) {
            estoquesPorSku.set(skuKey, new Map());
          }
          
          estoquesPorSku.get(skuKey)!.set(mp.codigo, { qtd: prod.qtd, mpId: mpIds.get(mp.codigo)! });
        }
        
        totalItens += produtos.length;
      } catch (e: any) {
        console.error(`[inv-full-api] Erro ${mp.codigo}:`, e?.message);
        emitProgress("erro", `Erro ${mp.nome}: ${e?.message}`);
      }
    }
    
    emitProgress("processamento", `Processando ${todosSkus.size} SKUs únicos...`, 60);
    
    // Inserir/atualizar itens
    let mapeados = 0;
    let pendentes = 0;
    
    for (const sku of todosSkus) {
      const estoques = estoquesPorSku.get(sku)!;
      const mpCodigos = Array.from(estoques.keys());
      const primeiroMp = mpCodigos[0];
      const primeiroEstoque = estoques.get(primeiroMp)!;
      
      // Buscar título (do primeiro que tem)
      let titulo = "";
      for (const [mpCod, est] of estoques.entries()) {
        // Recuperar título da API (precisaria armazenar, simplificando)
        titulo = `SKU ${sku}`;
        break;
      }
      
      // Verificar se já existe mapeamento
      let proCodigo: string | null = null;
      let descricaoInterna: string | null = null;
      let mapeado = false;
      
      for (const mpCod of mpCodigos) {
        const mapKey = `${mpCod}:${sku}`;
        const mapData = skuMap.get(mapKey);
        if (mapData) {
          proCodigo = mapData.pro_codigo;
          descricaoInterna = mapData.titulo;
          mapeado = true;
          break;
        }
      }
      
      // Tentar match por código exato (se SKU for numérico e existir no Microsys)
      if (!mapeado && /^\d+$/.test(sku)) {
        const prod = await buscarProdutoPorCodigo(sku);
        if (prod) {
          proCodigo = String(prod.PRO_CODIGO);
          descricaoInterna = prod.PRO_RESUMO;
          mapeado = true;
        }
      }
      
      if (mapeado) mapeados++;
      else pendentes++;
      
      // Inserir item
      const itemInsert = await pool.request()
        .input("sessao_id", sql.Int, sessaoId)
        .input("sku", sql.VarChar(100), sku)
        .input("titulo", sql.NVarChar(500), titulo)
        .input("pro_codigo", sql.VarChar(50), proCodigo)
        .input("descricao", sql.VarChar(300), descricaoInterna)
        .input("mapeado", sql.Bit, mapeado)
        .query(`
          INSERT INTO INV_FULL_ITENS (sessao_id, sku_marketplace, titulo, pro_codigo, descricao_interna, mapeado)
          OUTPUT INSERTED.id
          VALUES (@sessao_id, @sku, @titulo, @pro_codigo, @descricao, @mapeado)
        `);
      
      const itemId = itemInsert.recordset[0].id;
      
      // Inserir estoques por marketplace
      for (const [mpCod, est] of estoques.entries()) {
        await pool.request()
          .input("item_id", sql.Int, itemId)
          .input("mp_id", sql.Int, est.mpId)
          .input("qtd", sql.Decimal(18, 4), est.qtd)
          .query(`INSERT INTO INV_FULL_ESTOQUES (item_id, marketplace_id, qtd_api, buscado_em) VALUES (@item_id, @mp_id, @qtd, GETDATE())`);
      }
    }
    
    // Atualizar sessao
    await pool.request()
      .input("id", sql.Int, sessaoId)
      .input("total", sql.Int, todosSkus.size)
      .input("mapeados", sql.Int, mapeados)
      .input("pendentes", sql.Int, pendentes)
      .query(`
        UPDATE INV_FULL_SESSOES 
        SET status = 'VERIFICADO', verificado_em = GETDATE(), total_itens = @total, total_mapeados = @mapeados, total_pendentes = @pendentes
        WHERE id = @id
      `);
    
    emitProgress("fim", `Verificação concluída! ${todosSkus.size} itens, ${mapeados} mapeados, ${pendentes} pendentes.`, 100);
    
    res.json({ 
      ok: true, 
      total_itens: todosSkus.size, 
      mapeados, 
      pendentes,
      message: "Verificação concluída. Mapeie os itens pendentes antes de aprovar."
    });
    
  } catch (err: any) {
    console.error("[inv-full-api] POST /verificar error:", err?.message);
    res.status(500).json({ error: "Erro ao verificar estoques." });
  }
});

// GET /sessoes/:id - detalhes
router.get("/sessoes/:id", async (req, res) => {
  try {
    const sessaoId = parseInt(req.params.id);
    const pool = await getPool();
    
    // Sessão
    const sessao = await pool.request()
      .input("id", sql.Int, sessaoId)
      .query(`SELECT * FROM INV_FULL_SESSOES WHERE id = @id`);
    
    if (!sessao.recordset.length) return res.status(404).json({ error: "Sessão não encontrada" });
    
    // Marketplaces
    const mps = await pool.request()
      .input("sessao_id", sql.Int, sessaoId)
      .query(`SELECT * FROM INV_FULL_MARKETPLACES WHERE sessao_id = @sessao_id ORDER BY ordem`);
    
    // Itens com estoques
    const itens = await pool.request()
      .input("sessao_id", sql.Int, sessaoId)
      .query(`
        SELECT i.*,
          (SELECT m.codigo, e.qtd_api 
           FROM INV_FULL_ESTOQUES e 
           JOIN INV_FULL_MARKETPLACES m ON m.id = e.marketplace_id 
           WHERE e.item_id = i.id 
           FOR JSON PATH) as estoques_json
        FROM INV_FULL_ITENS i 
        WHERE i.sessao_id = @sessao_id 
        ORDER BY i.mapeado ASC, i.id DESC
      `);
    
    // Parse estoques
    const itensParsed = itens.recordset.map((row: any) => ({
      ...row,
      estoques: row.estoques_json ? JSON.parse(row.estoques_json) : []
    }));
    
    res.json({
      sessao: sessao.recordset[0],
      marketplaces: mps.recordset,
      itens: itensParsed
    });
  } catch (err: any) {
    console.error("[inv-full-api] GET /sessoes/:id error:", err?.message);
    res.status(500).json({ error: "Erro ao buscar detalhes." });
  }
});

// PATCH /itens/:id/mapear - vincular SKU a PRO_CODIGO
router.patch("/itens/:id/mapear", async (req, res) => {
  try {
    const itemId = parseInt(req.params.id);
    const { pro_codigo, mapeado_por } = req.body;
    
    if (!pro_codigo || !mapeado_por) {
      return res.status(400).json({ error: "pro_codigo e mapeado_por obrigatórios" });
    }
    
    const pool = await getPool();
    
    // Buscar item
    const item = await pool.request()
      .input("id", sql.Int, itemId)
      .query(`SELECT * FROM INV_FULL_ITENS WHERE id = @id`);
    
    if (!item.recordset.length) return res.status(404).json({ error: "Item não encontrado" });
    
    const itemData = item.recordset[0];
    
    // Verificar se produto existe no Firebird
    const produto = await buscarProdutoPorCodigo(pro_codigo);
    if (!produto) {
      return res.status(400).json({ error: "Código de produto não encontrado no sistema" });
    }
    
    // Atualizar item
    await pool.request()
      .input("id", sql.Int, itemId)
      .input("pro_codigo", sql.VarChar(50), pro_codigo)
      .input("descricao", sql.VarChar(300), produto.PRO_RESUMO)
      .input("mapeado_por", sql.VarChar(100), mapeado_por)
      .query(`
        UPDATE INV_FULL_ITENS 
        SET pro_codigo = @pro_codigo, descricao_interna = @descricao, mapeado = 1, mapeado_por = @mapeado_por, mapeado_em = GETDATE()
        WHERE id = @id
      `);
    
    // Salvar no mapa global
    // Buscar de qual marketplace veio
    const mpResult = await pool.request()
      .input("item_id", sql.Int, itemId)
      .query(`
        SELECT TOP 1 m.codigo 
        FROM INV_FULL_ESTOQUES e 
        JOIN INV_FULL_MARKETPLACES m ON m.id = e.marketplace_id 
        WHERE e.item_id = @item_id
      `);
    
    const marketplace = mpResult.recordset[0]?.codigo || "UNKNOWN";
    
    // Inserir/atualizar SKU_MAP
    await pool.request()
      .input("sku", sql.VarChar(100), itemData.sku_marketplace)
      .input("mp", sql.VarChar(50), marketplace)
      .input("pro_codigo", sql.VarChar(50), pro_codigo)
      .input("titulo", sql.NVarChar(500), itemData.titulo)
      .input("criado_por", sql.VarChar(100), mapeado_por)
      .query(`
        MERGE INV_FULL_SKU_MAP AS target
        USING (VALUES (@sku, @mp, @pro_codigo)) AS source (sku, mp, codigo)
        ON target.sku_marketplace = source.sku AND target.marketplace = source.mp
        WHEN MATCHED THEN
          UPDATE SET pro_codigo = source.codigo, titulo_original = @titulo
        WHEN NOT MATCHED THEN
          INSERT (sku_marketplace, marketplace, pro_codigo, titulo_original, criado_por)
          VALUES (source.sku, source.mp, source.codigo, @titulo, @criado_por);
      `);
    
    // Recalcular totais da sessao
    await pool.request()
      .input("sessao_id", sql.Int, itemData.sessao_id)
      .query(`
        UPDATE INV_FULL_SESSOES 
        SET total_mapeados = (SELECT COUNT(*) FROM INV_FULL_ITENS WHERE sessao_id = @sessao_id AND mapeado = 1),
            total_pendentes = (SELECT COUNT(*) FROM INV_FULL_ITENS WHERE sessao_id = @sessao_id AND mapeado = 0)
        WHERE id = @sessao_id
      `);
    
    res.json({ ok: true, pro_codigo, descricao: produto.PRO_RESUMO });
  } catch (err: any) {
    console.error("[inv-full-api] PATCH /itens/:id/mapear error:", err?.message);
    res.status(500).json({ error: "Erro ao mapear item." });
  }
});

// POST /sessoes/:id/aprovar - gerar inventario no Firebird
router.post("/sessoes/:id/aprovar", async (req, res) => {
  try {
    const sessaoId = parseInt(req.params.id);
    const { aprovado_por, telefone_destino } = req.body;
    
    if (!aprovado_por) return res.status(400).json({ error: "aprovado_por obrigatório" });
    
    const pool = await getPool();
    
    // Verificar sessão
    const sessao = await pool.request()
      .input("id", sql.Int, sessaoId)
      .query(`SELECT * FROM INV_FULL_SESSOES WHERE id = @id`);
    
    if (!sessao.recordset.length) return res.status(404).json({ error: "Sessão não encontrada" });
    if (sessao.recordset[0].status === "APROVADO") return res.status(400).json({ error: "Sessão já aprovada" });
    
    // Buscar itens mapeados com estoques
    const itens = await pool.request()
      .input("sessao_id", sql.Int, sessaoId)
      .query(`
        SELECT i.pro_codigo, SUM(e.qtd_api) as qtd_total
        FROM INV_FULL_ITENS i
        JOIN INV_FULL_ESTOQUES e ON e.item_id = i.id
        WHERE i.sessao_id = @sessao_id AND i.mapeado = 1 AND i.pro_codigo IS NOT NULL
        GROUP BY i.pro_codigo
      `);
    
    if (!itens.recordset.length) {
      return res.status(400).json({ error: "Nenhum item mapeado para gerar inventário" });
    }
    
    // Inserir no Firebird réplica (tabela INVENTARIO_API_FULL ou similar)
    // Aqui você precisa definir a tabela destino no Firebird réplica
    const dataAtual = new Date().toISOString().split("T")[0];
    
    for (const item of itens.recordset) {
      try {
        // Tenta inserir/atualizar no Firebird réplica
        // Tabela: INVENTARIO_API_FULL (precisa ser criada no Firebird)
        await executeFb(fbConfigReplica, `
          UPDATE OR INSERT INTO INVENTARIO_API_FULL (PRO_CODIGO, QTD_FULL, DATA_ATUALIZACAO, SESSAO_ORIGEM)
          VALUES (?, ?, ?, ?)
          MATCHING (PRO_CODIGO)
        `, [item.pro_codigo, item.qtd_total, dataAtual, `INV_FULL_${sessaoId}`]);
        
        // Registrar no SQL Server
        await pool.request()
          .input("sessao_id", sql.Int, sessaoId)
          .input("pro_codigo", sql.VarChar(50), item.pro_codigo)
          .input("qtd", sql.Decimal(18, 4), item.qtd_total)
          .query(`INSERT INTO INV_FULL_GERADO (sessao_id, pro_codigo, qtd_total) VALUES (@sessao_id, @pro_codigo, @qtd)`);
          
      } catch (fbErr: any) {
        console.error(`[inv-full-api] Erro Firebird ${item.pro_codigo}:`, fbErr?.message);
      }
    }
    
    // Atualizar sessão
    await pool.request()
      .input("id", sql.Int, sessaoId)
      .input("aprovado_por", sql.VarChar(100), aprovado_por)
      .query(`
        UPDATE INV_FULL_SESSOES 
        SET status = 'APROVADO', aprovado_por = @aprovado_por, aprovado_em = GETDATE(), enviado_em = GETDATE()
        WHERE id = @id
      `);
    
    // Gerar Excel para divergencias
    const divergencias = [];
    for (const item of itens.recordset) {
      const prod = await buscarProdutoPorCodigo(item.pro_codigo);
      // Buscar saldo atual no Microsys
      const saldoRows = await queryFb<{ SALDO: number }>(fbConfigFortaleza,
        `SELECT (SELECT disponivel FROM CONSULTA_ESTOQUE(?, 1, 0, 0, CAST('NOW' AS DATE))) as SALDO`,
        [Number(item.pro_codigo)]
      );
      const saldoMicrosys = Number(saldoRows[0]?.SALDO || 0);
      
      if (Math.abs(Number(item.qtd_total) - saldoMicrosys) > 0.01) {
        divergencias.push({
          codigo: item.pro_codigo,
          descricao: prod?.PRO_RESUMO || "",
          qtd_api: item.qtd_total,
          qtd_microsys: saldoMicrosys,
          diferenca: Number(item.qtd_total) - saldoMicrosys
        });
      }
    }
    
    // Criar Excel
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(divergencias);
    XLSX.utils.book_append_sheet(wb, ws, "Divergencias");
    
    const fileName = `INV_FULL_${sessaoId}_${new Date().toISOString().slice(0,10)}.xlsx`;
    const filePath = path.join(os.tmpdir(), fileName);
    XLSX.writeFile(wb, filePath);
    
    // Enviar WhatsApp se tiver telefone
    if (telefone_destino && CW_TI_TOKEN) {
      try {
        const contatoId = await cwBuscarContato(telefone_destino) || await cwCriarContato(telefone_destino);
        if (contatoId) {
          const convId = await cwBuscarConversaAberta(contatoId) || await cwCriarConversa(contatoId);
          if (convId) {
            await cwEnviarMensagem(convId, `✅ Inventário FULL API aprovado!\n\nSessão: ${sessaoId}\nItens: ${itens.recordset.length}\nDivergências: ${divergencias.length}\nAprovado por: ${aprovado_por}`);
            await cwEnviarArquivo(convId, filePath, "Planilha de divergências");
          }
        }
      } catch (wppErr: any) {
        console.error("[inv-full-api] Erro WhatsApp:", wppErr?.message);
      }
    }
    
    // Limpar arquivo temporario
    try { fs.unlinkSync(filePath); } catch {}
    
    res.json({ 
      ok: true, 
      itens_gerados: itens.recordset.length,
      divergencias: divergencias.length,
      file_name: fileName
    });
    
  } catch (err: any) {
    console.error("[inv-full-api] POST /aprovar error:", err?.message);
    res.status(500).json({ error: "Erro ao aprovar inventário." });
  }
});

// GET /produtos/buscar - buscar produtos no Firebird por descrição (para autocomplete)
router.get("/produtos/buscar", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== "string") return res.status(400).json({ error: "q obrigatório" });
    
    const produtos = await buscarProdutosPorDescricao(q, 20);
    res.json(produtos);
  } catch (err: any) {
    console.error("[inv-full-api] GET /produtos/buscar error:", err?.message);
    res.status(500).json({ error: "Erro ao buscar produtos." });
  }
});

export default router;
