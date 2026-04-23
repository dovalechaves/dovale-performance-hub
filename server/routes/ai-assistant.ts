import { Router } from "express";
import crypto from "crypto";
import OpenAI from "openai";
import sql from "mssql";
import { getPool } from "../db/sqlserver";

const router = Router();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Chatwoot TI (notificação de demandas) ──
const CW_TI_BASE = "http://192.168.10.181:3000";
const CW_TI_TOKEN = "o4Y7pWQePkSsSw5uKczFRqZ9";
const CW_TI_INBOX = 5;
const CW_TI_ACCOUNT = 1;
const CW_TI_NUMEROS = ["5512981898755", "5512988467809"];

function cwHeaders() {
  return { api_access_token: CW_TI_TOKEN, "Content-Type": "application/json" };
}

async function cwBuscarContato(telefone: string): Promise<number | null> {
  const digitos = telefone.replace(/\D/g, "");
  const termo = digitos.slice(-9);
  try {
    const r = await fetch(`${CW_TI_BASE}/api/v1/accounts/${CW_TI_ACCOUNT}/contacts/search?q=${termo}&page=1&per_page=10&include_contacts=true`, { headers: cwHeaders() });
    if (!r.ok) return null;
    const j: any = await r.json();
    return j.payload?.[0]?.id ?? null;
  } catch { return null; }
}

async function cwCriarContato(telefone: string): Promise<number | null> {
  try {
    const r = await fetch(`${CW_TI_BASE}/api/v1/accounts/${CW_TI_ACCOUNT}/contacts`, {
      method: "POST", headers: cwHeaders(),
      body: JSON.stringify({ inbox_id: CW_TI_INBOX, phone_number: `+${telefone}`, name: telefone }),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    return j.payload?.contact?.id ?? j.id ?? null;
  } catch { return null; }
}

async function cwBuscarConversaAberta(contatoId: number): Promise<number | null> {
  try {
    const r = await fetch(`${CW_TI_BASE}/api/v1/accounts/${CW_TI_ACCOUNT}/contacts/${contatoId}/conversations`, { headers: cwHeaders() });
    if (!r.ok) return null;
    const j: any = await r.json();
    const convs = j.payload || [];
    const aberta = convs.find((c: any) => c.status === "open" && c.inbox_id === CW_TI_INBOX);
    return aberta?.id ?? null;
  } catch { return null; }
}

async function cwCriarConversa(contatoId: number): Promise<number | null> {
  try {
    const r = await fetch(`${CW_TI_BASE}/api/v1/accounts/${CW_TI_ACCOUNT}/conversations`, {
      method: "POST", headers: cwHeaders(),
      body: JSON.stringify({ contact_id: contatoId, inbox_id: CW_TI_INBOX, status: "open" }),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    return j.id ?? null;
  } catch { return null; }
}

async function cwEnviarMensagem(conversaId: number, msg: string): Promise<number | null> {
  try {
    const r = await fetch(`${CW_TI_BASE}/api/v1/accounts/${CW_TI_ACCOUNT}/conversations/${conversaId}/messages`, {
      method: "POST", headers: cwHeaders(),
      body: JSON.stringify({ content: msg, message_type: "outgoing", private: false }),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    return j.id ?? null;
  } catch { return null; }
}

async function notificarDemandaChatwoot(projectId: number, titulo: string, usuario: string, displayName: string) {
  const link = `https://hub.dovale.online/ai-assistant?projeto=${projectId}`;
  const msg = [
    `🆕 *NOVA DEMANDA*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📋 *Título:* ${titulo}`,
    `👤 *Solicitante:* ${displayName || usuario}`,
    `🔢 *ID:* #${projectId}`,
    ``,
    `🔗 *Acessar:* ${link}`,
    `━━━━━━━━━━━━━━━━━━━━`,
  ].join("\n");

  for (const num of CW_TI_NUMEROS) {
    try {
      let contatoId = await cwBuscarContato(num);
      if (!contatoId) contatoId = await cwCriarContato(num);
      if (!contatoId) { console.error(`[Demanda→WPP] Contato não encontrado: ${num}`); continue; }

      let conversaId = await cwBuscarConversaAberta(contatoId);
      if (!conversaId) conversaId = await cwCriarConversa(contatoId);
      if (!conversaId) { console.error(`[Demanda→WPP] Conversa falhou: ${num}`); continue; }

      await cwEnviarMensagem(conversaId, msg);
      console.log(`[Demanda→WPP] Notificação enviada: ${num}`);
    } catch (e: any) {
      console.error(`[Demanda→WPP] Exceção ${num}: ${e.message}`);
    }
  }
}
const TOTAL_STAGES = 8;
const PRD_MARKER = "<<<PRD_START>>>";
const PRD_MARKER_END = "<<<PRD_END>>>";

const SYSTEM_PROMPT = `Você é o Assistente de Requisitos da Dovale, um chatbot interno que ajuda funcionários a montar documentos de requisitos (PRD).

REGRAS:
- Fale em português do Brasil, tom profissional mas amigável
- Faça UMA pergunta por vez
- Seja conversacional e adapte-se às respostas
- Peça mais detalhes quando a resposta for vaga ou curta
- NÃO pule etapas, colete informação suficiente antes de avançar

FLUXO DE COLETA (8 etapas):
1. Objetivo: O que quer melhorar, automatizar ou criar?
2. Contexto: Área, departamento, sistema, usuários envolvidos
3. Problema atual: Dificuldades, gargalos, dores
4. Processo atual: Passo a passo de como funciona hoje
5. Solução desejada: Como deveria funcionar
6. Regras de negócio: Validações, permissões, exceções
7. Integrações: WhatsApp, APIs, banco de dados, ERP, etc
8. Impacto e urgência: Pessoas afetadas, prejuízo, prazo

Após cada resposta do usuário, avalie internamente em qual etapa está (1-8) e inclua no início da sua resposta a tag: [STAGE:N] onde N é a etapa atual (1-8).

Quando tiver coletado TODAS as informações, gere o PRD completo entre os marcadores ${PRD_MARKER} e ${PRD_MARKER_END}.

O PRD deve seguir EXATAMENTE este formato:
${PRD_MARKER}
# Documento de Requisitos

## 📌 Problema
(descrição)

## 🎯 Objetivo
(descrição)

## 📍 Contexto
(descrição)

## 🔄 Processo Atual
(passo a passo)

## 💡 Solução Proposta
(descrição detalhada)

## 📋 Requisitos
### Funcionais
- (lista)
### Não Funcionais
- (lista)

## 📏 Regras de Negócio
(lista)

## 🔌 Integrações
(lista)

## ✅ Critérios de Aceitação
- [ ] (lista)

## 🚀 Prioridade & Impacto
(descrição)
${PRD_MARKER_END}

Comece se apresentando e fazendo a primeira pergunta.`;

// ── Conversation types ────────────────────────────────────────────────────
interface Message {
  role: "user" | "bot";
  content: string;
  timestamp: string;
}

interface Conversation {
  id: string;
  usuario: string;
  display_name: string;
  stage: number;
  openaiHistory: { role: "system" | "user" | "assistant"; content: string }[];
  messages: Message[];
  completed: boolean;
  prd: string | null;
  createdAt: string;
}

// ── Conversation persistence helpers ──────────────────────────────────────
async function saveConversation(conv: Conversation): Promise<void> {
  const pool = await getPool();
  const status = conv.completed ? "concluida" : "ativa";
  const historyJson = JSON.stringify(conv.openaiHistory);
  await pool.request()
    .input("id", sql.VarChar(100), conv.id)
    .input("usuario", sql.VarChar(100), conv.usuario)
    .input("display_name", sql.NVarChar(200), conv.display_name)
    .input("status", sql.VarChar(30), status)
    .input("stage", sql.Int, conv.stage)
    .input("prd", sql.NVarChar(sql.MAX), conv.prd)
    .input("openai_history", sql.NVarChar(sql.MAX), historyJson)
    .input("updated_at", sql.DateTime, new Date())
    .query(`
      IF EXISTS (SELECT 1 FROM dbo.AI_CONVERSATIONS WHERE id = @id)
        UPDATE dbo.AI_CONVERSATIONS
        SET status = @status, stage = @stage, prd = @prd,
            openai_history = @openai_history, updated_at = @updated_at
        WHERE id = @id
      ELSE
        INSERT INTO dbo.AI_CONVERSATIONS (id, usuario, display_name, status, stage, prd, openai_history)
        VALUES (@id, @usuario, @display_name, @status, @stage, @prd, @openai_history)
    `);
}

async function saveMessage(convId: string, msg: Message): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input("conversation_id", sql.VarChar(100), convId)
    .input("role", sql.VarChar(10), msg.role)
    .input("content", sql.NVarChar(sql.MAX), msg.content)
    .input("timestamp", sql.DateTime, new Date(msg.timestamp))
    .query(`
      INSERT INTO dbo.AI_CONVERSATION_MESSAGES (conversation_id, role, content, timestamp)
      VALUES (@conversation_id, @role, @content, @timestamp)
    `);
}

async function loadConversation(id: string): Promise<Conversation | null> {
  const pool = await getPool();
  const convRes = await pool.request().input("id", sql.VarChar(100), id)
    .query(`SELECT * FROM dbo.AI_CONVERSATIONS WHERE id = @id`);
  if (!convRes.recordset.length) return null;
  const row = convRes.recordset[0];
  const msgRes = await pool.request().input("cid", sql.VarChar(100), id)
    .query(`SELECT role, content, timestamp FROM dbo.AI_CONVERSATION_MESSAGES WHERE conversation_id = @cid ORDER BY timestamp ASC`);
  return {
    id: row.id,
    usuario: row.usuario,
    display_name: row.display_name || row.usuario,
    stage: row.stage || 0,
    openaiHistory: row.openai_history ? JSON.parse(row.openai_history) : [],
    messages: msgRes.recordset.map((m: any) => ({
      role: m.role,
      content: m.content,
      timestamp: new Date(m.timestamp).toISOString(),
    })),
    completed: row.status === "concluida",
    prd: row.prd || null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function now(): string {
  return new Date().toISOString();
}

function parseStage(text: string): { stage: number; clean: string } {
  const match = text.match(/\[STAGE:(\d+)\]\s*/);
  if (match) {
    return { stage: parseInt(match[1], 10), clean: text.replace(match[0], "").trim() };
  }
  return { stage: 0, clean: text };
}

function extractPRD(text: string): { prd: string | null; displayText: string } {
  const startIdx = text.indexOf(PRD_MARKER);
  const endIdx = text.indexOf(PRD_MARKER_END);
  if (startIdx !== -1 && endIdx !== -1) {
    const prd = text.substring(startIdx + PRD_MARKER.length, endIdx).trim();
    const before = text.substring(0, startIdx).trim();
    const after = text.substring(endIdx + PRD_MARKER_END.length).trim();
    const display = [before, prd, after].filter(Boolean).join("\n\n");
    return { prd, displayText: display };
  }
  return { prd: null, displayText: text };
}

async function callOpenAI(history: Conversation["openaiHistory"]): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: history,
    temperature: 0.7,
    max_tokens: 4096,
  });
  return response.choices[0]?.message?.content ?? "Desculpe, não consegui processar. Tente novamente.";
}

// ── Routes ──────────────────────────────────────────────────────────────────

router.post("/chat", async (req, res) => {
  try {
    const { conversation_id, message, usuario, display_name } = req.body ?? {};

    if (!conversation_id) {
      const id = crypto.randomUUID();
      const history: Conversation["openaiHistory"] = [
        { role: "system", content: SYSTEM_PROMPT },
      ];
      const aiReply = await callOpenAI(history);
      const { stage, clean } = parseStage(aiReply);

      history.push({ role: "assistant", content: aiReply });

      const botMsg: Message = { role: "bot", content: clean, timestamp: now() };
      const conv: Conversation = {
        id,
        usuario: usuario || "anonymous",
        display_name: display_name || usuario || "anonymous",
        stage: Math.max(stage, 1),
        openaiHistory: history,
        messages: [botMsg],
        completed: false,
        prd: null,
        createdAt: now(),
      };
      await saveConversation(conv);
      await saveMessage(id, botMsg);
      return res.json({
        conversation_id: id,
        messages: conv.messages,
        completed: false,
        prd: null,
        stage: conv.stage,
        totalStages: TOTAL_STAGES,
      });
    }

    const conv = await loadConversation(conversation_id);
    if (!conv) {
      return res.status(404).json({ error: "Conversa não encontrada. Inicie uma nova." });
    }
    if (conv.completed) {
      return res.json({
        conversation_id: conv.id,
        messages: conv.messages,
        completed: true,
        prd: conv.prd,
        stage: conv.stage,
        totalStages: TOTAL_STAGES,
      });
    }

    const userMsg = String(message || "").trim();
    if (!userMsg) {
      return res.status(400).json({ error: "Mensagem não pode ser vazia." });
    }

    const userMsgObj: Message = { role: "user", content: userMsg, timestamp: now() };
    conv.messages.push(userMsgObj);
    conv.openaiHistory.push({ role: "user", content: userMsg });
    await saveMessage(conv.id, userMsgObj);

    const aiReply = await callOpenAI(conv.openaiHistory);
    conv.openaiHistory.push({ role: "assistant", content: aiReply });

    const { stage, clean } = parseStage(aiReply);
    const { prd, displayText } = extractPRD(clean);

    if (stage > 0) conv.stage = stage;

    if (prd) {
      conv.completed = true;
      conv.prd = prd;
      conv.stage = TOTAL_STAGES;
    }

    const botMsgObj: Message = { role: "bot", content: displayText, timestamp: now() };
    conv.messages.push(botMsgObj);
    await saveMessage(conv.id, botMsgObj);
    await saveConversation(conv);

    return res.json({
      conversation_id: conv.id,
      messages: conv.messages,
      completed: conv.completed,
      prd: conv.prd,
      stage: conv.stage,
      totalStages: TOTAL_STAGES,
    });
  } catch (err: any) {
    console.error("[ai-assistant] OpenAI error:", err?.message || err);
    return res.status(500).json({ error: "Erro ao processar com IA. Tente novamente." });
  }
});

router.post("/restart", async (req, res) => {
  try {
    const { conversation_id, usuario, display_name } = req.body ?? {};
    // Mark old conversation as excluida if exists
    if (conversation_id) {
      const pool = await getPool();
      await pool.request().input("id", sql.VarChar(100), conversation_id)
        .query(`UPDATE dbo.AI_CONVERSATIONS SET status = 'excluida', updated_at = GETDATE() WHERE id = @id`);
    }

    const id = crypto.randomUUID();
    const history: Conversation["openaiHistory"] = [
      { role: "system", content: SYSTEM_PROMPT },
    ];
    const aiReply = await callOpenAI(history);
    const { stage, clean } = parseStage(aiReply);
    history.push({ role: "assistant", content: aiReply });

    const botMsg: Message = { role: "bot", content: clean, timestamp: now() };
    const conv: Conversation = {
      id,
      usuario: usuario || "anonymous",
      display_name: display_name || usuario || "anonymous",
      stage: Math.max(stage, 1),
      openaiHistory: history,
      messages: [botMsg],
      completed: false,
      prd: null,
      createdAt: now(),
    };
    await saveConversation(conv);
    await saveMessage(id, botMsg);

    res.json({
      conversation_id: id,
      messages: conv.messages,
      completed: false,
      prd: null,
      stage: conv.stage,
      totalStages: TOTAL_STAGES,
    });
  } catch (err: any) {
    console.error("[ai-assistant] OpenAI error:", err?.message || err);
    res.status(500).json({ error: "Erro ao iniciar conversa." });
  }
});

router.get("/conversation/:id", async (req, res) => {
  try {
    const conv = await loadConversation(req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversa não encontrada." });
    res.json({
      conversation_id: conv.id,
      messages: conv.messages,
      completed: conv.completed,
      prd: conv.prd,
      stage: conv.stage,
      totalStages: TOTAL_STAGES,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Erro ao carregar conversa." });
  }
});

router.get("/export/:id", async (req, res) => {
  try {
    const conv = await loadConversation(req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversa não encontrada." });
    if (!conv.completed) return res.status(400).json({ error: "Conversa ainda não foi concluída." });
    res.json({
      conversation_id: conv.id,
      usuario: conv.usuario,
      created_at: conv.createdAt,
      prd: conv.prd,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Erro ao exportar conversa." });
  }
});

// ── Project Workflow ────────────────────────────────────────────────────────

const STATUS_TRANSITIONS: Record<string, string[]> = {
  em_analise_ti: ["feedback_ti", "aprovado"],
  feedback_ti: ["em_analise_ti"],
};

async function ensureProjectTables(): Promise<void> {
  const pool = await getPool();
  await pool.request().query(`
    IF OBJECT_ID('dbo.AI_REQUESTS', 'U') IS NULL
    CREATE TABLE dbo.AI_REQUESTS (
      id INT IDENTITY(1,1) PRIMARY KEY,
      conversation_id VARCHAR(100),
      usuario VARCHAR(100) NOT NULL,
      display_name NVARCHAR(200),
      titulo NVARCHAR(500),
      status VARCHAR(50) DEFAULT 'em_analise_ti',
      prd_content NVARCHAR(MAX),
      prazo_entrega DATE NULL,
      aprovado_por VARCHAR(100) NULL,
      aprovado_em DATETIME NULL,
      created_at DATETIME DEFAULT GETDATE(),
      updated_at DATETIME DEFAULT GETDATE(),
      trello_card_id VARCHAR(100) NULL,
      trello_url VARCHAR(500) NULL
    )
  `);
  // Add columns if table already exists
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.AI_REQUESTS') AND name = 'trello_card_id')
    ALTER TABLE dbo.AI_REQUESTS ADD trello_card_id VARCHAR(100) NULL, trello_url VARCHAR(500) NULL
  `);
  await pool.request().query(`
    IF OBJECT_ID('dbo.AI_REQUEST_COMMENTS', 'U') IS NULL
    CREATE TABLE dbo.AI_REQUEST_COMMENTS (
      id INT IDENTITY(1,1) PRIMARY KEY,
      request_id INT NOT NULL,
      usuario VARCHAR(100) NOT NULL,
      display_name NVARCHAR(200),
      content NVARCHAR(MAX),
      tipo VARCHAR(50) DEFAULT 'comentario',
      created_at DATETIME DEFAULT GETDATE(),
      FOREIGN KEY (request_id) REFERENCES dbo.AI_REQUESTS(id)
    )
  `);
  // ── Conversation persistence tables ──
  await pool.request().query(`
    IF OBJECT_ID('dbo.AI_CONVERSATIONS', 'U') IS NULL
    CREATE TABLE dbo.AI_CONVERSATIONS (
      id VARCHAR(100) PRIMARY KEY,
      usuario VARCHAR(100) NOT NULL,
      display_name NVARCHAR(200),
      status VARCHAR(30) DEFAULT 'ativa',
      stage INT DEFAULT 0,
      prd NVARCHAR(MAX) NULL,
      openai_history NVARCHAR(MAX) NULL,
      created_at DATETIME DEFAULT GETDATE(),
      updated_at DATETIME DEFAULT GETDATE()
    )
  `);
  await pool.request().query(`
    IF OBJECT_ID('dbo.AI_CONVERSATION_MESSAGES', 'U') IS NULL
    CREATE TABLE dbo.AI_CONVERSATION_MESSAGES (
      id INT IDENTITY(1,1) PRIMARY KEY,
      conversation_id VARCHAR(100) NOT NULL,
      role VARCHAR(10) NOT NULL,
      content NVARCHAR(MAX),
      timestamp DATETIME DEFAULT GETDATE()
    )
  `);
}

ensureProjectTables().catch((err) =>
  console.error("[ai-assistant] DB table setup error:", err?.message)
);

// ── Trello Integration ──────────────────────────────────────────────────────

function parsePrdChecklists(prd: string): { name: string; items: string[] }[] {
  const lines = prd.split("\n");
  const checklists: { name: string; items: string[] }[] = [];
  let currentSection = "";
  let currentItems: string[] = [];

  const flushSection = () => {
    if (currentSection && currentItems.length > 0) {
      checklists.push({ name: currentSection, items: [...currentItems] });
    }
    currentItems = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ") || trimmed.startsWith("### ")) {
      flushSection();
      currentSection = trimmed.replace(/^#{2,3}\s*/, "").replace(/[📌🎯📍🔄💡📋📏🔌✅🚀]/g, "").trim();
    } else if (trimmed.startsWith("- [ ] ") || trimmed.startsWith("- [x] ")) {
      currentItems.push(trimmed.slice(6).trim());
    } else if (trimmed.startsWith("- ") && currentSection) {
      currentItems.push(trimmed.slice(2).trim());
    }
  }
  flushSection();
  return checklists;
}

async function trelloPost(path: string, params: Record<string, string>): Promise<any> {
  const key = process.env.TRELLO_API_KEY!;
  const token = process.env.TRELLO_TOKEN!;
  const qs = new URLSearchParams({ key, token, ...params }).toString();
  const resp = await fetch(`https://api.trello.com/1${path}?${qs}`, { method: "POST" });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`[ai-assistant] Trello POST ${path} error:`, resp.status, errText);
    return null;
  }
  return resp.json();
}

async function createTrelloCard(proj: {
  titulo: string;
  display_name: string;
  prd_content: string;
  prazo_entrega?: string | null;
}): Promise<{ id: string; url: string } | null> {
  const key = process.env.TRELLO_API_KEY;
  const token = process.env.TRELLO_TOKEN;
  const listId = process.env.TRELLO_LIST_ID;
  if (!key || !token || !listId) {
    console.warn("[ai-assistant] Trello env vars not set, skipping card creation.");
    return null;
  }

  const desc = `**Solicitante:** ${proj.display_name}\n\n---\n\n${proj.prd_content?.substring(0, 16000) || ""}`;
  const params: Record<string, string> = {
    key,
    token,
    idList: listId,
    name: proj.titulo,
    desc,
    pos: "top",
  };
  if (proj.prazo_entrega) {
    params.due = new Date(proj.prazo_entrega + "T12:00:00").toISOString();
  }

  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`https://api.trello.com/1/cards?${qs}`, { method: "POST" });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error("[ai-assistant] Trello create card error:", resp.status, errText);
    return null;
  }
  const card = await resp.json() as { id: string; shortUrl: string };
  console.log("[ai-assistant] Trello card created:", card.shortUrl);

  // Create checklists from PRD sections
  const checklists = parsePrdChecklists(proj.prd_content || "");
  for (const cl of checklists) {
    const checklist = await trelloPost("/checklists", { idCard: card.id, name: cl.name });
    if (checklist?.id) {
      for (const item of cl.items) {
        await trelloPost(`/checklists/${checklist.id}/checkItems`, { name: item });
      }
    }
  }

  return { id: card.id, url: card.shortUrl };
}

async function getTrelloCardStatus(cardId: string): Promise<{ list: string; board: string } | null> {
  const key = process.env.TRELLO_API_KEY;
  const token = process.env.TRELLO_TOKEN;
  if (!key || !token || !cardId) return null;
  try {
    const qs = new URLSearchParams({ key, token, fields: "idList,name", list: "true", list_fields: "name" }).toString();
    const resp = await fetch(`https://api.trello.com/1/cards/${cardId}?${qs}`);
    if (!resp.ok) return null;
    const data = await resp.json() as { list?: { name: string }; name?: string };
    return { list: data.list?.name || "Desconhecida", board: "TI Dovale SJC-MG" };
  } catch { return null; }
}

/** POST /projects — create project from approved conversation */
router.post("/projects", async (req, res) => {
  try {
    const { conversation_id, usuario, display_name, titulo, prd_content } = req.body ?? {};
    if (!usuario || !prd_content) {
      return res.status(400).json({ error: "usuario e prd_content são obrigatórios." });
    }
    const pool = await getPool();
    const result = await pool
      .request()
      .input("conversation_id", sql.VarChar(100), conversation_id || null)
      .input("usuario", sql.VarChar(100), usuario)
      .input("display_name", sql.NVarChar(200), display_name || usuario)
      .input("titulo", sql.NVarChar(500), titulo || "Novo Requisito")
      .input("prd_content", sql.NVarChar(sql.MAX), prd_content)
      .query(`
        INSERT INTO dbo.AI_REQUESTS (conversation_id, usuario, display_name, titulo, status, prd_content)
        OUTPUT INSERTED.id
        VALUES (@conversation_id, @usuario, @display_name, @titulo, 'em_analise_ti', @prd_content)
      `);
    const id = result.recordset[0]?.id;

    await pool
      .request()
      .input("request_id", sql.Int, id)
      .input("usuario", sql.VarChar(100), usuario)
      .input("display_name", sql.NVarChar(200), display_name || usuario)
      .input("content", sql.NVarChar(sql.MAX), "Projeto criado e enviado para análise do TI.")
      .input("tipo", sql.VarChar(50), "sistema")
      .query(`
        INSERT INTO dbo.AI_REQUEST_COMMENTS (request_id, usuario, display_name, content, tipo)
        VALUES (@request_id, @usuario, @display_name, @content, @tipo)
      `);

    res.json({ id, status: "em_analise_ti" });

    // Notifica TI via Chatwoot (fire-and-forget)
    notificarDemandaChatwoot(id, titulo || "Novo Requisito", usuario, display_name || usuario)
      .catch((e: any) => console.error("[Demanda→WPP] Erro:", e.message));
  } catch (err: any) {
    console.error("[ai-assistant] Create project error:", err?.message);
    res.status(500).json({ error: "Erro ao criar projeto." });
  }
});

/** GET /projects — list projects (role=viewer → only own, admin/manager → all) */
router.get("/projects", async (req, res) => {
  try {
    const { usuario, role } = req.query;
    const pool = await getPool();
    const request = pool.request();
    let query = `
      SELECT id, conversation_id, usuario, display_name, titulo, status,
             prazo_entrega, aprovado_por, aprovado_em, created_at, updated_at
      FROM dbo.AI_REQUESTS
    `;
    if (role === "viewer" && usuario) {
      request.input("usuario", sql.VarChar(100), String(usuario));
      query += ` WHERE usuario = @usuario`;
    }
    query += ` ORDER BY updated_at DESC`;
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err: any) {
    console.error("[ai-assistant] List projects error:", err?.message);
    res.status(500).json({ error: "Erro ao listar projetos." });
  }
});

/** GET /projects/:id — single project with comments */
router.get("/projects/:id", async (req, res) => {
  try {
    const pool = await getPool();
    const projectId = parseInt(req.params.id);
    const [projRes, commRes] = await Promise.all([
      pool.request().input("id", sql.Int, projectId)
        .query(`SELECT * FROM dbo.AI_REQUESTS WHERE id = @id`),
      pool.request().input("rid", sql.Int, projectId)
        .query(`SELECT * FROM dbo.AI_REQUEST_COMMENTS WHERE request_id = @rid ORDER BY created_at ASC`),
    ]);
    if (projRes.recordset.length === 0) {
      return res.status(404).json({ error: "Projeto não encontrado." });
    }
    const proj = projRes.recordset[0];
    let trello_status: { list: string; board: string } | null = null;
    if (proj.trello_card_id) {
      trello_status = await getTrelloCardStatus(proj.trello_card_id);
    }
    res.json({ ...proj, trello_status, comments: commRes.recordset });
  } catch (err: any) {
    console.error("[ai-assistant] Get project error:", err?.message);
    res.status(500).json({ error: "Erro ao buscar projeto." });
  }
});

/** PATCH /projects/:id/status — change status with transition validation */
router.patch("/projects/:id/status", async (req, res) => {
  try {
    const { status, usuario, display_name, comment, prazo_entrega } = req.body ?? {};
    if (!status || !usuario) {
      return res.status(400).json({ error: "status e usuario são obrigatórios." });
    }
    const pool = await getPool();
    const projectId = parseInt(req.params.id);
    const current = await pool.request().input("id", sql.Int, projectId)
      .query(`SELECT status FROM dbo.AI_REQUESTS WHERE id = @id`);
    if (current.recordset.length === 0) {
      return res.status(404).json({ error: "Projeto não encontrado." });
    }

    const curStatus = current.recordset[0].status;
    const allowed = STATUS_TRANSITIONS[curStatus];
    if (!allowed || !allowed.includes(status)) {
      return res.status(400).json({ error: `Transição de '${curStatus}' para '${status}' não permitida.` });
    }

    const upd = pool.request()
      .input("id", sql.Int, projectId)
      .input("status", sql.VarChar(50), status)
      .input("updated_at", sql.DateTime, new Date());
    let updQ = `UPDATE dbo.AI_REQUESTS SET status = @status, updated_at = @updated_at`;

    if (status === "aprovado") {
      upd.input("aprovado_por", sql.VarChar(100), usuario);
      upd.input("aprovado_em", sql.DateTime, new Date());
      updQ += `, aprovado_por = @aprovado_por, aprovado_em = @aprovado_em`;
      if (prazo_entrega) {
        upd.input("prazo_entrega", sql.Date, new Date(prazo_entrega + "T12:00:00"));
        updQ += `, prazo_entrega = @prazo_entrega`;
      }
    }
    updQ += ` WHERE id = @id`;
    await upd.query(updQ);

    const statusLabels: Record<string, string> = {
      em_analise_ti: "Enviado para análise do TI",
      feedback_ti: "TI enviou feedback",
      aprovado: "Projeto aprovado" + (prazo_entrega ? ` — Prazo: ${prazo_entrega}` : ""),
    };
    const commentContent = comment
      ? `**${statusLabels[status] || status}**\n\n${comment}`
      : statusLabels[status] || `Status: ${status}`;

    await pool.request()
      .input("rid", sql.Int, projectId)
      .input("usuario", sql.VarChar(100), usuario)
      .input("display_name", sql.NVarChar(200), display_name || usuario)
      .input("content", sql.NVarChar(sql.MAX), commentContent)
      .input("tipo", sql.VarChar(50), status === "aprovado" ? "aprovacao" : status === "feedback_ti" ? "feedback" : "status")
      .query(`
        INSERT INTO dbo.AI_REQUEST_COMMENTS (request_id, usuario, display_name, content, tipo)
        VALUES (@rid, @usuario, @display_name, @content, @tipo)
      `);

    // Trello integration: create card on approval
    let trelloUrl: string | null = null;
    if (status === "aprovado") {
      const projData = await pool.request().input("pid", sql.Int, projectId)
        .query(`SELECT titulo, display_name, prd_content, prazo_entrega FROM dbo.AI_REQUESTS WHERE id = @pid`);
      if (projData.recordset.length > 0) {
        const p = projData.recordset[0];
        const trelloResult = await createTrelloCard({
          titulo: p.titulo,
          display_name: p.display_name || display_name || usuario,
          prd_content: p.prd_content,
          prazo_entrega: prazo_entrega || p.prazo_entrega,
        });
        if (trelloResult) {
          trelloUrl = trelloResult.url;
          await pool.request()
            .input("tid", sql.Int, projectId)
            .input("trello_card_id", sql.VarChar(100), trelloResult.id)
            .input("trello_url", sql.VarChar(500), trelloResult.url)
            .query(`UPDATE dbo.AI_REQUESTS SET trello_card_id = @trello_card_id, trello_url = @trello_url WHERE id = @tid`);
        }
      }
    }

    // Notifica TI via Chatwoot quando demanda volta para análise
    if (status === "em_analise_ti") {
      const projRow = await pool.request().input("pid", sql.Int, projectId)
        .query(`SELECT titulo, display_name, usuario FROM dbo.AI_REQUESTS WHERE id = @pid`);
      if (projRow.recordset.length > 0) {
        const p = projRow.recordset[0];
        notificarDemandaChatwoot(projectId, p.titulo || "Sem título", p.usuario, p.display_name || p.usuario)
          .catch((e: any) => console.error("[Demanda→WPP] Erro:", e.message));
      }
    }

    res.json({ id: projectId, status, trelloUrl });
  } catch (err: any) {
    console.error("[ai-assistant] Status change error:", err?.message);
    res.status(500).json({ error: "Erro ao alterar status." });
  }
});

/** POST /projects/:id/comments — add comment to a project */
router.post("/projects/:id/comments", async (req, res) => {
  try {
    const { usuario, display_name, content } = req.body ?? {};
    if (!usuario || !content) {
      return res.status(400).json({ error: "usuario e content são obrigatórios." });
    }
    const pool = await getPool();
    const projectId = parseInt(req.params.id);

    const check = await pool.request().input("id", sql.Int, projectId)
      .query(`SELECT id FROM dbo.AI_REQUESTS WHERE id = @id`);
    if (check.recordset.length === 0) {
      return res.status(404).json({ error: "Projeto não encontrado." });
    }

    const result = await pool.request()
      .input("rid", sql.Int, projectId)
      .input("usuario", sql.VarChar(100), usuario)
      .input("display_name", sql.NVarChar(200), display_name || usuario)
      .input("content", sql.NVarChar(sql.MAX), content)
      .input("tipo", sql.VarChar(50), "comentario")
      .query(`
        INSERT INTO dbo.AI_REQUEST_COMMENTS (request_id, usuario, display_name, content, tipo)
        OUTPUT INSERTED.id
        VALUES (@rid, @usuario, @display_name, @content, @tipo)
      `);

    await pool.request()
      .input("id", sql.Int, projectId)
      .input("updated_at", sql.DateTime, new Date())
      .query(`UPDATE dbo.AI_REQUESTS SET updated_at = @updated_at WHERE id = @id`);

    res.json({ id: result.recordset[0]?.id });
  } catch (err: any) {
    console.error("[ai-assistant] Add comment error:", err?.message);
    res.status(500).json({ error: "Erro ao adicionar comentário." });
  }
});

/** PATCH /projects/:id/titulo — rename a project */
router.patch("/projects/:id/titulo", async (req, res) => {
  try {
    const { titulo, usuario } = req.body ?? {};
    if (!titulo || !usuario) {
      return res.status(400).json({ error: "titulo e usuario são obrigatórios." });
    }
    const pool = await getPool();
    const projectId = parseInt(req.params.id);
    const check = await pool.request().input("id", sql.Int, projectId)
      .query(`SELECT id, usuario FROM dbo.AI_REQUESTS WHERE id = @id`);
    if (check.recordset.length === 0) {
      return res.status(404).json({ error: "Projeto não encontrado." });
    }
    await pool.request()
      .input("id", sql.Int, projectId)
      .input("titulo", sql.NVarChar(500), titulo.trim())
      .input("updated_at", sql.DateTime, new Date())
      .query(`UPDATE dbo.AI_REQUESTS SET titulo = @titulo, updated_at = @updated_at WHERE id = @id`);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[ai-assistant] Rename error:", err?.message);
    res.status(500).json({ error: "Erro ao renomear projeto." });
  }
});

router.delete("/projects/:id", async (req, res) => {
  try {
    const { usuario, role } = req.query;
    if (role !== "admin") {
      return res.status(403).json({ error: "Apenas administradores podem excluir demandas." });
    }
    const pool = await getPool();
    const projectId = parseInt(req.params.id);
    const check = await pool.request().input("id", sql.Int, projectId)
      .query(`SELECT id FROM dbo.AI_REQUESTS WHERE id = @id`);
    if (check.recordset.length === 0) {
      return res.status(404).json({ error: "Projeto não encontrado." });
    }
    await pool.request().input("rid", sql.Int, projectId)
      .query(`DELETE FROM dbo.AI_REQUEST_COMMENTS WHERE request_id = @rid`);
    await pool.request().input("id", sql.Int, projectId)
      .query(`DELETE FROM dbo.AI_REQUESTS WHERE id = @id`);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[ai-assistant] Delete error:", err?.message);
    res.status(500).json({ error: "Erro ao excluir projeto." });
  }
});

// ── Conversation management routes ─────────────────────────────────────────

/** GET /conversations — list conversations for a user (ativas + pausadas) */
router.get("/conversations", async (req, res) => {
  try {
    const { usuario, role } = req.query;
    if (!usuario) return res.status(400).json({ error: "usuario é obrigatório." });
    const pool = await getPool();
    const request = pool.request().input("usuario", sql.VarChar(100), String(usuario));
    let query = `
      SELECT id, usuario, display_name, status, stage, prd, created_at, updated_at
      FROM dbo.AI_CONVERSATIONS
      WHERE status NOT IN ('excluida', 'concluida')
    `;
    if (role !== "admin") {
      query += ` AND usuario = @usuario`;
    }
    query += ` ORDER BY updated_at DESC`;
    const result = await request.query(query);
    res.json(result.recordset.map((r: any) => ({
      id: r.id,
      usuario: r.usuario,
      display_name: r.display_name || r.usuario,
      status: r.status,
      stage: r.stage || 0,
      has_prd: !!r.prd,
      created_at: new Date(r.created_at).toISOString(),
      updated_at: new Date(r.updated_at).toISOString(),
    })));
  } catch (err: any) {
    console.error("[ai-assistant] List conversations error:", err?.message);
    res.status(500).json({ error: "Erro ao listar conversas." });
  }
});

/** PATCH /conversations/:id/pause — pause a conversation */
router.patch("/conversations/:id/pause", async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input("id", sql.VarChar(100), req.params.id)
      .input("updated_at", sql.DateTime, new Date())
      .query(`UPDATE dbo.AI_CONVERSATIONS SET status = 'pausada', updated_at = @updated_at WHERE id = @id AND status = 'ativa'`);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Erro ao pausar conversa." });
  }
});

/** DELETE /conversations/:id — soft delete a conversation */
router.delete("/conversations/:id", async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input("id", sql.VarChar(100), req.params.id)
      .input("updated_at", sql.DateTime, new Date())
      .query(`UPDATE dbo.AI_CONVERSATIONS SET status = 'excluida', updated_at = @updated_at WHERE id = @id`);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Erro ao excluir conversa." });
  }
});

export default router;
