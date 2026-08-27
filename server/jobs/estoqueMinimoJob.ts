import cron from "node-cron";
import mssql from "mssql";
import { queryFirebird } from "../db/firebird";
import { getPool } from "../db/sqlserver";

const TIMEZONE = process.env.APP_TIMEZONE?.trim() || "America/Sao_Paulo";
const LOJA_KEY = "sjc" as const;
const FILIAL_ID = 1;

const PRODUTOS_TABLE = "DOVALE.dbo.ESTOQUE_MINIMO_PRODUTOS";
const STATUS_TABLE = "DOVALE.dbo.ESTOQUE_MINIMO_STATUS";
const NOTIFICADOS_TABLE = "DOVALE.dbo.ESTOQUE_MINIMO_NOTIFICADOS";

const CW_TI_BASE = process.env.CW_TI_BASE || "https://chatwoot.dovale.online";
const CW_TI_TOKEN = process.env.CW_TI_TOKEN || "V1WDyvj1WTWeytVyWwKy31GL";
const CW_TI_INBOX = Number(process.env.CW_TI_INBOX || 1);
const CW_TI_ACCOUNT = Number(process.env.CW_TI_ACCOUNT || 1);
const HUB_URL = process.env.HUB_URL || "https://hub.dovale.online";

const DESTINATARIOS_WHATSAPP = (process.env.ESTOQUE_MINIMO_DESTINATARIOS || [
  "5512981898755",
  "5512935005923",
  "551232121024",
  "551232121029",
  "551232121033",
].join(",")).split(",").map((n) => n.trim()).filter(Boolean);

// Filtros customizados por telefone — se não constar, recebe todos os produtos
const FILTROS_POR_TELEFONE: Record<string, (p: ProdutoAbaixoMinimo) => boolean> = {
  "551232121033": (p) => p.proNivel1 === 1 && p.proNivel2 !== 1,
};

export interface ProdutoAbaixoMinimo {
  codigo: string;
  descricao: string;
  categoria: string;
  estoqueAtual: number;
  estoqueMinimo: number;
  diferenca: number;
  proNivel1: number;
  proNivel2: number;
}

export async function buscarProdutosAbaixoMinimo(): Promise<ProdutoAbaixoMinimo[]> {
  const firebirdSql = `
    SELECT * FROM (
      SELECT p.pro_codigo, p.pro_resumo,
             a.nome AS grupo,
             p.pro_nivel1, p.pro_nivel2,
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
      proNivel1: Number(row.PRO_NIVEL1) || 0,
      proNivel2: Number(row.PRO_NIVEL2) || 0,
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

// ── Notificação WhatsApp (só produtos novos abaixo do mínimo) ──────────────
async function ensureNotificadosTable(): Promise<void> {
  const pool = await getPool();
  await pool.request().query(`
    IF OBJECT_ID('dbo.ESTOQUE_MINIMO_NOTIFICADOS', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.ESTOQUE_MINIMO_NOTIFICADOS (
        pro_codigo VARCHAR(50) NOT NULL PRIMARY KEY,
        notificado_em DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
      -- Semeia com o backlog já existente na primeira vez, pra não disparar
      -- WhatsApp para os produtos que já estavam abaixo do mínimo antes desse recurso existir.
      INSERT INTO dbo.ESTOQUE_MINIMO_NOTIFICADOS (pro_codigo)
      SELECT pro_codigo FROM ${PRODUTOS_TABLE};
    END
  `);
}

async function getCodigosJaNotificados(): Promise<Set<string>> {
  await ensureNotificadosTable();
  const pool = await getPool();
  const result = await pool.request().query(`SELECT pro_codigo FROM ${NOTIFICADOS_TABLE}`);
  return new Set(result.recordset.map((r: { pro_codigo: string }) => String(r.pro_codigo).trim()));
}

async function registrarNotificados(codigos: string[]): Promise<void> {
  if (codigos.length === 0) return;
  const pool = await getPool();
  for (const codigo of codigos) {
    await pool.request()
      .input("codigo", mssql.VarChar(50), codigo)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM ${NOTIFICADOS_TABLE} WHERE pro_codigo = @codigo)
        BEGIN
          INSERT INTO ${NOTIFICADOS_TABLE} (pro_codigo) VALUES (@codigo)
        END
      `);
  }
}

async function limparRecuperados(codigos: string[]): Promise<void> {
  if (codigos.length === 0) return;
  const pool = await getPool();
  const placeholders = codigos.map((_, i) => `@codigo${i}`).join(", ");
  const request = pool.request();
  codigos.forEach((codigo, i) => request.input(`codigo${i}`, mssql.VarChar(50), codigo));
  await request.query(`DELETE FROM ${NOTIFICADOS_TABLE} WHERE pro_codigo IN (${placeholders})`);
}

function formatarMensagemWhatsapp(produtos: ProdutoAbaixoMinimo[]): string {
  const header = `⚠️ *${produtos.length} produto(s) NOVO(S) abaixo do estoque mínimo (SJC):*`;
  const lines = produtos.slice(0, 30).map((p) =>
    `- *${p.codigo}* - ${p.descricao}\n  Atual: ${p.estoqueAtual} | Mínimo: ${p.estoqueMinimo} | Faltam: ${p.diferenca}`
  );
  const rodape = produtos.length > 30 ? [`\n... e mais ${produtos.length - 30} produto(s).`] : [];
  const link = `\n📎 Acompanhe completo em: ${HUB_URL}/estoque-minimo`;
  return [header, "", ...lines, ...rodape, link].join("\n");
}

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

async function cwEnviarMensagem(conversaId: number, mensagem: string): Promise<boolean> {
  const r = await fetch(`${CW_TI_BASE}/api/v1/accounts/${CW_TI_ACCOUNT}/conversations/${conversaId}/messages`, {
    method: "POST", headers: cwHeaders(),
    body: JSON.stringify({ content: mensagem, message_type: "outgoing", private: false }),
  });
  return r.ok;
}

async function enviarWhatsappParaTelefone(telefone: string, mensagem: string): Promise<boolean> {
  try {
    const contatoId = (await cwBuscarContato(telefone)) ?? (await cwCriarContato(telefone));
    if (!contatoId) { console.error(`[estoque-minimo] Não foi possível localizar/criar contato para ${telefone}.`); return false; }

    const conversaId = (await cwBuscarConversaAberta(contatoId)) ?? (await cwCriarConversa(contatoId));
    if (!conversaId) { console.error(`[estoque-minimo] Não foi possível abrir conversa para ${telefone}.`); return false; }

    return await cwEnviarMensagem(conversaId, mensagem);
  } catch (err) {
    console.error(`[estoque-minimo] Erro ao enviar WhatsApp para ${telefone}:`, err);
    return false;
  }
}

async function enviarMensagemWhatsapp(produtos: ProdutoAbaixoMinimo[]): Promise<boolean> {
  const resultados = await Promise.all(
    DESTINATARIOS_WHATSAPP.map(async (telefone) => {
      const filtro = FILTROS_POR_TELEFONE[telefone];
      const produtosFiltrados = filtro ? produtos.filter(filtro) : produtos;
      if (produtosFiltrados.length === 0) {
        console.log(`[estoque-minimo] Nenhum produto para ${telefone} após filtro.`);
        return false;
      }
      const mensagem = formatarMensagemWhatsapp(produtosFiltrados);
      return enviarWhatsappParaTelefone(telefone, mensagem);
    })
  );
  return resultados.some(Boolean);
}

/** Notifica no WhatsApp só os produtos que entraram abaixo do mínimo desde a última checagem, e limpa quem se recuperou. */
async function notificarNovosAbaixoDoMinimo(produtosAtuais: ProdutoAbaixoMinimo[]): Promise<void> {
  const codigosAtuais = new Set(produtosAtuais.map((p) => p.codigo));
  const jaNotificados = await getCodigosJaNotificados();

  const novos = produtosAtuais.filter((p) => !jaNotificados.has(p.codigo));
  const recuperados = [...jaNotificados].filter((codigo) => !codigosAtuais.has(codigo));

  if (novos.length > 0) {
    const enviado = await enviarMensagemWhatsapp(novos);
    if (enviado) {
      await registrarNotificados(novos.map((p) => p.codigo));
      console.log(`[estoque-minimo] ${novos.length} produto(s) novo(s) notificado(s) no WhatsApp.`);
    } else {
      console.error("[estoque-minimo] Falha ao enviar notificação no WhatsApp.");
    }
  }

  await limparRecuperados(recuperados);
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
    await notificarNovosAbaixoDoMinimo(produtos).catch((err) =>
      console.error("[estoque-minimo] Falha ao processar notificação WhatsApp:", err)
    );
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

/** Dispara uma notificação de teste no WhatsApp com um produto simulado, sem tocar no Firebird nem no controle de já-notificados. */
export async function enviarNotificacaoTeste(): Promise<boolean> {
  const produtoTeste: ProdutoAbaixoMinimo = {
    codigo: "TESTE-999",
    descricao: "PRODUTO DE TESTE (simulado)",
    categoria: "TESTE",
    estoqueAtual: 5,
    estoqueMinimo: 100,
    diferenca: 95,
    proNivel1: 1,
    proNivel2: 0,
  };
  return enviarMensagemWhatsapp([produtoTeste]);
}

export async function startEstoqueMinimoJob() {
  await ensureTables();
  await loadFromDb();

  // Não espera a primeira checagem no Firebird — a tela já serve o último resultado salvo.
  checarEstoqueMinimo().catch((err) => console.error("[estoque-minimo] Falha na checagem inicial:", err));

  cron.schedule("0 7,12 * * 1-5", checarEstoqueMinimo, { timezone: TIMEZONE });

  console.log(`[estoque-minimo] Cron ativo — seg a sex às 7h e 12h (${TIMEZONE}).`);
}
