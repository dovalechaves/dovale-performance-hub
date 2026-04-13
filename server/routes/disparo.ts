import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import jwt from "jsonwebtoken";
import { getSupa, supaGetAll, supaInsertBatch, resetSupa } from "../services/supabase";
import { getPool } from "../db/sqlserver";
import * as meta from "../services/meta-api";
import * as cw from "../services/chatwoot";
import { validarArquivo } from "../services/importer";
import {
  parseConfiguracao, montarComponentesTemplate, detalharTemplate,
  processarDisparo, setSocketIO,
} from "../services/disparo-engine";
import type { Server as SocketServer } from "socket.io";

const router = Router();
export default router;
export { setSocketIO };

// ── Config ───────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET ?? "dovale-disparo-jwt-secret-2024";
const JWT_EXPIRY_HOURS = Number(process.env.JWT_EXPIRY_HOURS) || 8;
const AD_API_URL = process.env.AD_API_URL ?? "https://api.dovale.com.br/LoginUsuario1";
const NUMERO_APROVADOR = process.env.NUMERO_APROVADOR ?? "19981818434";
const APROVACAO_TIMEOUT_MIN = Number(process.env.APROVACAO_TIMEOUT_MIN) || 10;
const UPLOAD_DIR = path.resolve("uploads");
const MEDIA_DIR = path.resolve("uploads_media");
const MEDIA_MAX_BYTES = 16 * 1024 * 1024; // Meta limita vídeos a 16 MB

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const uploadContatos = multer({ dest: UPLOAD_DIR });
const uploadMidia = multer({
  dest: MEDIA_DIR,
  limits: { fileSize: MEDIA_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".webp", ".mp4", ".3gp"].includes(ext)) cb(null, true);
    else cb(new Error("Formato de mídia inválido. Use jpg, jpeg, png, webp, mp4 ou 3gp"));
  },
});

const ROTAS_PUBLICAS = new Set(["/auth/login", "/auth/hub-exchange"]);

// ── Auth middleware ──────────────────────────────────────────────────────────

router.use((req: Request, res: Response, next) => {
  if (req.method === "OPTIONS") return next();
  const rPath = req.path.replace(/^\/+/, "/");
  if (ROTAS_PUBLICAS.has(rPath)) return next();
  if (rPath.startsWith("/media/")) return next();

  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Bearer ")) return res.status(401).json({ erro: "Não autenticado" });
  const token = auth.split(" ")[1];
  try {
    (req as any).usuarioLogado = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e: any) {
    if (e.name === "TokenExpiredError") return res.status(401).json({ erro: "Sessão expirada" });
    return res.status(401).json({ erro: "Token inválido" });
  }
});

// ── Auth ─────────────────────────────────────────────────────────────────────

router.post("/auth/login", async (req: Request, res: Response) => {
  const { usuario, senha } = req.body ?? {};
  if (!usuario?.trim() || !senha?.trim()) return res.status(400).json({ erro: "Usuário e senha são obrigatórios" });
  try {
    const adResp = await fetch(AD_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, senha }),
    });
    if (adResp.status !== 200) {
      const msg = await adResp.json().then((j) => j.message).catch(() => "Usuário ou senha incorretos");
      return res.status(401).json({ erro: msg });
    }
    const adData = await adResp.json();
    const info = (adData.informacoesUsuario ?? [{}])[0];
    const payload = {
      usuario, nome: info.displayname ?? usuario,
      email: info.emailaddress ?? "", departamento: info.department ?? "",
      escritorio: info.escritorio ?? "", nivel: String(info.nivelusuario ?? "0"),
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: `${JWT_EXPIRY_HOURS}h` });
    res.json({ token, usuario: { nome: payload.nome, email: payload.email, departamento: payload.departamento, escritorio: payload.escritorio } });
  } catch (e: any) {
    res.status(503).json({ erro: `Falha ao conectar com servidor de autenticação: ${e.message}` });
  }
});

// ── Hub token exchange (skip disparo login when already authenticated in Hub) ─

router.post("/auth/hub-exchange", async (req: Request, res: Response) => {
  const { usuario, displayName } = req.body ?? {};
  if (!usuario?.trim()) return res.status(400).json({ erro: "usuario é obrigatório" });
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("usuario", usuario.trim())
      .query(`
        SELECT ua.ativo, ua.role AS disparo_role
        FROM dbo.USUARIOS_APPS ua
        INNER JOIN dbo.USUARIOS_LOJAS ul ON LOWER(ul.usuario) = LOWER(ua.usuario)
        WHERE LOWER(ua.usuario) = LOWER(@usuario)
          AND ua.app_key = 'disparo'
          AND ua.ativo = 1
          AND ul.ativo = 1
      `);
    if (!result.recordset.length) {
      return res.status(403).json({ erro: "Usuário sem acesso ao Disparo" });
    }
    const disparoRole = result.recordset[0].disparo_role ?? "user";
    const payload = {
      usuario: usuario.trim(),
      nome: displayName || usuario,
      email: "",
      departamento: "",
      escritorio: "",
      nivel: "0",
      role: disparoRole,
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: `${JWT_EXPIRY_HOURS}h` });
    res.json({ token, usuario: { nome: payload.nome, email: payload.email, departamento: payload.departamento, escritorio: payload.escritorio, role: disparoRole } });
  } catch (e: any) {
    res.status(500).json({ erro: `Falha ao gerar token: ${e.message}` });
  }
});

// ── Upload contatos ──────────────────────────────────────────────────────────

router.post("/upload", uploadContatos.single("file"), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ erro: "Nenhum arquivo enviado" });
  const filepath = req.file.path;
  const originalName = req.file.originalname;
  const ext = path.extname(originalName).toLowerCase();
  const destPath = `${filepath}${ext}`;
  fs.renameSync(filepath, destPath);

  try {
    const contatos = validarArquivo(destPath);
    let novaListaId: number;
    for (let t = 0; t < 3; t++) {
      try {
        const supa = getSupa();
        const { data, error } = await supa.from("listas_contatos").insert({ nome_arquivo: originalName, total_contatos: contatos.length }).select("id").single();
        if (error) throw error;
        novaListaId = data.id;
        break;
      } catch (e: any) {
        resetSupa();
        if (t === 2) return res.status(503).json({ erro: `Falha BD: ${e.message}` });
      }
    }
    const rows = contatos.map((c) => ({
      lista_id: novaListaId!, nome: c.Nome, numero: c.Numero, dados_extras: JSON.stringify(c.dadosExtras),
    }));
    await supaInsertBatch("contatos_lista", rows);
    res.status(201).json({ mensagem: "Lista importada com sucesso", lista_id: novaListaId!, total: contatos.length });
  } catch (e: any) {
    res.status(400).json({ erro: e.message });
  }
});

// ── Templates ────────────────────────────────────────────────────────────────

function normalizeTemplateMeta(item: any) {
  const comps: any[] = item.components ?? [];
  const header = comps.find((c: any) => c.type?.toUpperCase() === "HEADER");
  const body = comps.find((c: any) => c.type?.toUpperCase() === "BODY");
  const hf = (header?.format ?? "").toUpperCase();
  const headerText = header?.text ?? "";
  const bodyText = body?.text ?? "";
  return {
    id: item.id, name: item.name, language_code: item.language,
    header_format: hf,
    requires_media: ["IMAGE", "VIDEO", "DOCUMENT"].includes(hf),
    header_text_params_count: (headerText.match(/\{\{\d+\}\}/g) ?? []).length,
    body_params_count: (bodyText.match(/\{\{\d+\}\}/g) ?? []).length,
  };
}

router.get("/templates", async (_req: Request, res: Response) => {
  const { data, error } = await meta.obterTemplates();
  if (!data) {
    console.error("[disparo] GET /templates erro:", error);
    return res.status(502).json({ erro: error || "Falha ao buscar templates na Meta" });
  }
  const items = (data.data ?? []).map(normalizeTemplateMeta);
  console.log(`[disparo] GET /templates: ${items.length} templates retornados`);
  res.json(items);
});

router.post("/templates", async (req: Request, res: Response) => {
  try {
    console.log("[disparo] POST /templates body:", JSON.stringify(req.body));
    const { payload, erro } = montarPayloadCriacaoTemplate(req.body ?? {});
    if (erro) return res.status(400).json({ erro });

    const wabaId = process.env.wpp_waba_id ?? process.env.wpp_conta_id;
    for (const comp of payload!.components ?? []) {
      if (comp.type?.toUpperCase() !== "HEADER") continue;
      if (!["IMAGE", "VIDEO", "DOCUMENT"].includes(comp.format?.toUpperCase())) continue;
      const handles = comp.example?.header_handle ?? [];
      if (!handles.length) continue;
      const url = String(handles[0] ?? "").trim();
      if (!url.startsWith("http")) continue;
      if (!wabaId) return res.status(400).json({ erro: "Configure wpp_waba_id ou wpp_conta_id no ambiente." });
      // Se a URL aponta para nosso próprio endpoint de mídia, lê direto do disco
      const mediaMatch = url.match(/\/api\/disparo\/media\/([^/?#]+)/);
      let handle: string | null;
      let handleError: string;
      if (mediaMatch) {
        const localPath = path.resolve(MEDIA_DIR, mediaMatch[1]);
        console.log("[disparo] Lendo mídia local:", localPath);
        ({ handle, error: handleError } = await meta.gerarHandleDeArquivoLocal(localPath, wabaId));
      } else {
        console.log("[disparo] Baixando mídia de:", url);
        ({ handle, error: handleError } = await meta.gerarHandlePorUrl(url, wabaId));
      }
      if (!handle) return res.status(502).json({ erro: handleError || "Falha upload mídia exemplo" });
      console.log("[disparo] Handle obtido:", handle);
      comp.example = { header_handle: [handle] };
    }

    const { data, error: createError } = await meta.criarTemplate(payload!);
    if (!data) return res.status(502).json({ erro: createError || "Falha ao criar template" });

    // Salvar etiqueta/setor automaticamente
    const etiqueta = String(req.body.etiqueta ?? "").trim();
    if (etiqueta) {
      const supa = getSupa();
      await supa.from("template_configs").upsert(
        { template_nome: payload!.name, etiqueta, atualizado_em: new Date().toISOString() },
        { onConflict: "template_nome" },
      );
    }

    res.status(201).json({ mensagem: "Template enviado para aprovação na Meta", resultado: data });
  } catch (err: any) {
    console.error("[disparo] POST /templates erro:", err);
    if (!res.headersSent) res.status(500).json({ erro: err.message || "Erro interno ao criar template" });
  }
});

router.get("/templates/gerenciar", async (_req: Request, res: Response) => {
  const { data, error } = await meta.obterTemplates();
  if (!data) return res.status(502).json({ erro: error || "Falha ao buscar templates na Meta" });
  const items = (data.data ?? []).map((item: any) => {
    const comps: any[] = item.components ?? [];
    const header = comps.find((c: any) => c.type?.toUpperCase() === "HEADER");
    const body = comps.find((c: any) => c.type?.toUpperCase() === "BODY");
    return {
      id: item.id, name: item.name, status: item.status, category: item.category,
      language: item.language,
      header_format: header?.format ?? (header?.text ? "TEXT" : ""),
      body_preview: (body?.text ?? "").slice(0, 120),
    };
  });
  res.json(items);
});

router.get("/templates/detalhe", async (req: Request, res: Response) => {
  const nome = String(req.query.name ?? "").trim();
  const lang = String(req.query.language_code ?? "").trim();
  if (!nome) return res.status(400).json({ erro: "name é obrigatório" });
  if (!lang) return res.status(400).json({ erro: "language_code é obrigatório" });
  const det = await detalharTemplate(nome, lang);
  if (!det) return res.status(404).json({ erro: "Template não encontrado" });
  res.json(det);
});

// ── Etiquetas ────────────────────────────────────────────────────────────────

router.get("/chatwoot/etiquetas", async (_req: Request, res: Response) => {
  const labels = await cw.listarEtiquetasChatwoot();
  res.json(labels);
});

router.get("/chatwoot/times", async (_req: Request, res: Response) => {
  const times = await cw.listarTimes();
  res.json(times);
});

router.get("/template-etiquetas", async (_req: Request, res: Response) => {
  const supa = getSupa();
  const { data } = await supa.from("template_configs").select("*");
  const mapa: Record<string, string> = {};
  for (const r of data ?? []) { if (r.etiqueta) mapa[r.template_nome] = r.etiqueta; }
  res.json(mapa);
});

router.post("/template-etiquetas", async (req: Request, res: Response) => {
  const updates: Record<string, string> = req.body ?? {};
  const supa = getSupa();
  for (const [nome, etiqueta] of Object.entries(updates)) {
    await supa.from("template_configs").upsert(
      { template_nome: nome.toLowerCase(), etiqueta: etiqueta || null, atualizado_em: new Date().toISOString() },
      { onConflict: "template_nome" },
    );
  }
  res.json({ ok: true });
});

// ── Upload mídia ─────────────────────────────────────────────────────────────

router.post("/upload-midia", uploadMidia.single("file"), (req: Request, res: Response) => {
  console.log("[disparo] POST /upload-midia req.file:", !!req.file, "originalname:", req.file?.originalname);
  if (!req.file) return res.status(400).json({ erro: "Nenhum arquivo de mídia enviado" });
  const ext = path.extname(req.file.originalname).toLowerCase();
  const novoNome = `${crypto.randomUUID().replace(/-/g, "")}${ext}`;
  const destino = path.join(MEDIA_DIR, novoNome);
  fs.renameSync(req.file.path, destino);
  const basePublica = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "") || `http://localhost:${process.env.SERVER_PORT ?? 3001}`;
  res.status(201).json({ mensagem: "Mídia enviada com sucesso", media_url: `${basePublica}/api/disparo/media/${novoNome}` });
});

router.get("/media/:filename", (req: Request, res: Response) => {
  const filepath = path.join(MEDIA_DIR, String(req.params.filename));
  if (!fs.existsSync(filepath)) return res.status(404).json({ erro: "Arquivo não encontrado" });
  res.sendFile(filepath);
});

// ── Disparar ─────────────────────────────────────────────────────────────────

router.post("/disparar", async (req: Request, res: Response) => {
  const { lista_id, template_nome, inbox_id = 1, configuracao: cfgRaw } = req.body ?? {};
  if (!lista_id || !template_nome) return res.status(400).json({ erro: "lista_id e template_nome são obrigatórios" });

  const cfg = parseConfiguracao(cfgRaw);
  cfg.inbox_id = inbox_id;

  // Valida template
  const { data: tData } = await meta.obterTemplates();
  if (!tData) return res.status(502).json({ erro: "Não foi possível validar os templates da Meta" });
  const templates: any[] = (tData.data ?? []).map(normalizeTemplateMeta);
  let tmpl = templates.find((t) => t.name === template_nome && (!cfg.language_code || t.language_code === cfg.language_code));
  if (!tmpl) tmpl = templates.find((t) => t.name === template_nome);
  if (tmpl) {
    if (tmpl.requires_media && !String(cfg.media_url ?? "").trim()) {
      return res.status(400).json({ erro: "Esse template exige mídia." });
    }
    if (!cfg.language_code) cfg.language_code = tmpl.language_code;
    if (!cfg.header_format) cfg.header_format = tmpl.header_format;
  }

  const supa = getSupa();
  const usuarioAtual = (req as any).usuarioLogado ?? {};

  // Bloqueia se já existe disparo ativo
  const { data: ativos } = await supa.from("disparos").select("id, status, configuracao")
    .in("status", ["AWAITING_APPROVAL", "PROCESSING", "PAUSING", "PAUSED"])
    .limit(1);
  if (ativos?.length) {
    const lblMap: Record<string, string> = { AWAITING_APPROVAL: "aguardando aprovação", PROCESSING: "em andamento", PAUSING: "pausando", PAUSED: "pausado" };
    let solicitante = "";
    try { solicitante = JSON.parse(ativos[0].configuracao ?? "{}").solicitante ?? ""; } catch {}
    const porQuem = solicitante ? ` de "${solicitante}"` : "";
    return res.status(409).json({ erro: `Já existe um disparo ${lblMap[ativos[0].status] ?? ativos[0].status}${porQuem} (#${ativos[0].id}). Aguarde a conclusão ou cancele-o antes de iniciar outro.` });
  }

  // Salva o nome do solicitante na configuração
  cfg.solicitante = usuarioAtual.nome ?? usuarioAtual.usuario ?? "";

  const { count } = await supa.from("contatos_lista").select("id", { count: "exact", head: true }).eq("lista_id", lista_id);
  const totalContatos = count ?? 0;

  const { data: dispData, error: dispErr } = await supa.from("disparos").insert({
    lista_id, template_nome, status: "AWAITING_APPROVAL",
    configuracao: JSON.stringify(cfg),
  }).select("*").single();
  if (dispErr) return res.status(500).json({ erro: dispErr.message });
  const disparoId = dispData.id;

  // Envia pedido de aprovação via Meta
  const usuario = (req as any).usuarioLogado ?? {};
  const nomeSolicitante = usuario.nome ?? "Um usuário";
  try {
    await meta.enviarTemplate(NUMERO_APROVADOR, "permissao_disparo", "pt_BR", [
      { type: "body", parameters: [
        { type: "text", text: nomeSolicitante },
        { type: "text", text: template_nome },
        { type: "text", text: String(totalContatos) },
      ]},
    ]);
    const cwContatoId = await cw.criarContato(NUMERO_APROVADOR, "Aprovador Disparos", inbox_id);
    if (cwContatoId) {
      const cwConversaId = await cw.criarConversa(cwContatoId, inbox_id);
      if (cwConversaId) {
        await supa.from("disparos").update({
          aprovacao_conversa_id: cwConversaId, aprovacao_msg_id: 0,
          aprovacao_ts: new Date().toISOString(),
        }).eq("id", disparoId);
      }
    }
  } catch (e: any) {
    console.error(`[Aprovação] Erro: ${e.message}`);
  }

  res.status(202).json({
    mensagem: "Aguardando aprovação", disparo_id: disparoId,
    aguardando_aprovacao: true, total_contatos: totalContatos, template_nome,
  });
});

// ── Status / Logs ────────────────────────────────────────────────────────────

router.get("/disparos/:id/logs", async (req: Request, res: Response) => {
  const supa = getSupa();
  const { data: d } = await supa.from("disparos").select("*").eq("id", req.params.id).single();
  if (!d) return res.status(404).json({ erro: "Disparo não encontrado" });
  const logs = await supaGetAll("logs_disparo", { column: "disparo_id", value: d.id });
  res.json({
    disparo_id: d.id, template: d.template_nome, status: d.status,
    logs: logs.map((l: any) => ({
      numero: l.contato_numero, status: l.status, wamid: l.meta_wamid ?? "",
      erro: l.mensagem_erro ?? "", timestamp: l.timestamp ?? "",
    })),
  });
});

router.get("/disparos/ativo", async (_req: Request, res: Response) => {
  const supa = getSupa();
  const { data } = await supa.from("disparos").select("*")
    .in("status", ["AWAITING_APPROVAL", "PROCESSING", "PAUSING", "PAUSED"])
    .order("data_inicio", { ascending: false }).limit(1);
  if (!data?.length) return res.json({ ativo: false });

  const d = data[0];
  const { count } = await supa.from("contatos_lista").select("id", { count: "exact", head: true }).eq("lista_id", d.lista_id);
  const total = count ?? 0;
  const logs = await supaGetAll("logs_disparo", { column: "disparo_id", value: d.id });
  const enviados = logs.filter((l: any) => l.status === "SENT").length;
  const falhas = logs.filter((l: any) => l.status === "FAILED").length;
  const feitos = enviados + falhas;

  res.json({
    ativo: true, disparo_id: d.id, template_nome: d.template_nome, status: d.status,
    total, enviados, falhas, progresso: total > 0 ? Math.round((feitos / total) * 1000) / 10 : 0,
  });
});

// ── Aprovação ────────────────────────────────────────────────────────────────

router.get("/disparos/:id/aprovacao", async (req: Request, res: Response) => {
  const supa = getSupa();
  const { data: d } = await supa.from("disparos").select("*").eq("id", req.params.id).single();
  if (!d) return res.status(404).json({ erro: "Disparo não encontrado" });

  if (d.status !== "AWAITING_APPROVAL") {
    if (["PROCESSING", "COMPLETED"].includes(d.status)) return res.json({ status: "aprovado" });
    if (d.status === "REJECTED") return res.json({ status: "negado", motivo: "Disparo negado pelo aprovador" });
    return res.json({ status: d.status.toLowerCase() });
  }

  // Verifica timeout
  if (d.aprovacao_ts) {
    const elapsed = Date.now() - new Date(d.aprovacao_ts).getTime();
    if (elapsed > APROVACAO_TIMEOUT_MIN * 60 * 1000) {
      await supa.from("disparos").update({ status: "REJECTED" }).eq("id", d.id);
      return res.json({ status: "expirado" });
    }
  }

  // Busca mensagens de resposta do aprovador
  const contatoId = await cw.buscarContato(NUMERO_APROVADOR);
  let todasMsgs: any[] = [];
  if (contatoId) {
    const conversas = await cw.buscarConversasContato(contatoId);
    for (const c of conversas) todasMsgs.push(...(c.messages ?? []));
  } else if (d.aprovacao_conversa_id) {
    todasMsgs = await cw.buscarMensagensRecentes(d.aprovacao_conversa_id);
  }

  const aprovacaoTs = d.aprovacao_ts ? new Date(d.aprovacao_ts) : null;
  const respostas = todasMsgs.filter((m: any) => {
    const isIncoming = m.message_type === 0 || m.message_type === "incoming";
    if (!isIncoming) return false;
    if (aprovacaoTs && m.created_at) {
      try { if (new Date(Number(m.created_at) * 1000) <= aprovacaoTs) return false; } catch {}
    }
    return true;
  });

  for (const resp of respostas) {
    const conteudo = (resp.content ?? "").trim().toUpperCase();
    const botao = ((resp.content_attributes ?? {}).submitted_values ?? [{}]);
    const btnPayload = String((botao[0] ?? {}).value ?? "").trim().toUpperCase();
    const textoFinal = conteudo || btnPayload;

    if (textoFinal.includes("AUTORIZADO")) {
      const cfg = parseConfiguracao(d.configuracao);
      await supa.from("disparos").update({ status: "PROCESSING" }).eq("id", d.id);
      processarDisparo(d.id, cfg.inbox_id ?? 1);
      return res.json({ status: "aprovado" });
    }
    if (textoFinal.includes("NEGADO") || textoFinal.includes("NÃO") || textoFinal.includes("NAO")) {
      await supa.from("disparos").update({ status: "REJECTED" }).eq("id", d.id);
      return res.json({ status: "negado", motivo: resp.content ?? "Negado pelo aprovador" });
    }
  }

  res.json({ status: "aguardando" });
});

// ── Aprovação manual ─────────────────────────────────────────────────────────

router.post("/disparos/:id/aprovar", async (req: Request, res: Response) => {
  const supa = getSupa();
  const { data: d } = await supa.from("disparos").select("*").eq("id", req.params.id).single();
  if (!d) return res.status(404).json({ erro: "Disparo não encontrado" });
  if (d.status !== "AWAITING_APPROVAL") return res.status(400).json({ erro: `Disparo não está aguardando aprovação (status: ${d.status})` });
  const { acao } = req.body ?? {};
  if (acao === "negar") {
    await supa.from("disparos").update({ status: "REJECTED" }).eq("id", d.id);
    return res.json({ status: "negado", mensagem: "Disparo negado manualmente" });
  }
  const cfg = parseConfiguracao(d.configuracao);
  await supa.from("disparos").update({ status: "PROCESSING" }).eq("id", d.id);
  processarDisparo(d.id, cfg.inbox_id ?? 1);
  res.json({ status: "aprovado", mensagem: "Disparo aprovado e iniciado" });
});

// ── Controle (pausar/retomar/cancelar) ───────────────────────────────────────

router.post("/disparos/:id/cancelar", async (req: Request, res: Response) => {
  const supa = getSupa();
  const { data: d } = await supa.from("disparos").select("*").eq("id", req.params.id).single();
  if (!d) return res.status(404).json({ erro: "Disparo não encontrado" });
  const cancelable = ["AWAITING_APPROVAL", "PAUSING", "PAUSED"];
  if (!cancelable.includes(d.status)) return res.status(400).json({ erro: `Não é possível cancelar disparo com status: ${d.status}` });
  await supa.from("disparos").update({ status: "REJECTED" }).eq("id", d.id);
  res.json({ mensagem: "Disparo cancelado", disparo_id: d.id });
});

router.post("/disparos/:id/pausar", async (req: Request, res: Response) => {
  const supa = getSupa();
  const { data: d } = await supa.from("disparos").select("*").eq("id", req.params.id).single();
  if (!d) return res.status(404).json({ erro: "Disparo não encontrado" });
  if (d.status !== "PROCESSING") return res.status(400).json({ erro: `Disparo não está em andamento (status: ${d.status})` });
  await supa.from("disparos").update({ status: "PAUSING" }).eq("id", d.id);
  res.json({ mensagem: "Pausa solicitada", disparo_id: d.id });
});

router.post("/disparos/:id/retomar", async (req: Request, res: Response) => {
  const supa = getSupa();
  const { data: d } = await supa.from("disparos").select("*").eq("id", req.params.id).single();
  if (!d) return res.status(404).json({ erro: "Disparo não encontrado" });
  if (d.status !== "PAUSED") return res.status(400).json({ erro: `Disparo não está pausado (status: ${d.status})` });
  const cfg = parseConfiguracao(d.configuracao);
  await supa.from("disparos").update({ status: "PROCESSING" }).eq("id", d.id);
  processarDisparo(d.id, cfg.inbox_id ?? 1);
  res.json({ mensagem: "Disparo retomado", disparo_id: d.id });
});

// ── Diagnóstico Meta ─────────────────────────────────────────────────────────

router.post("/meta/diagnostico", async (req: Request, res: Response) => {
  const { numero, template_nome, language_code = "pt_BR" } = req.body ?? {};
  if (!numero || !template_nome) return res.status(400).json({ erro: "numero e template_nome são obrigatórios" });
  const { data, error } = await meta.enviarTemplate(numero, template_nome, language_code);
  res.json({ resposta_meta: data, erro: error || undefined });
});

// ── Helpers internos ─────────────────────────────────────────────────────────

function montarPayloadCriacaoTemplate(data: any): { payload: any | null; erro: string | null } {
  const nome = String(data.name ?? "").trim().toLowerCase();
  const categoria = String(data.category ?? "MARKETING").trim().toUpperCase();
  const lang = String(data.language_code ?? "pt_BR").trim();
  const bodyText = String(data.body_text ?? "").trim();
  const headerType = String(data.header_type ?? "NONE").trim().toUpperCase();
  const headerText = String(data.header_text ?? "").trim();
  const footerText = String(data.footer_text ?? "").trim();
  const exemploUrl = String(data.header_media_example_url ?? "").trim();

  if (!nome) return { payload: null, erro: "name é obrigatório" };
  if (!/^[a-z0-9_]+$/.test(nome)) return { payload: null, erro: "name inválido. Use apenas minúsculas, números e underscore." };
  if (!bodyText) return { payload: null, erro: "body_text é obrigatório" };
  if (!["MARKETING", "UTILITY", "AUTHENTICATION"].includes(categoria)) return { payload: null, erro: "category inválida" };
  if (!["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"].includes(headerType)) return { payload: null, erro: "header_type inválido" };
  if (headerType === "TEXT" && !headerText) return { payload: null, erro: "header_text é obrigatório para header_type TEXT" };
  if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerType) && !exemploUrl) return { payload: null, erro: "header_media_example_url é obrigatório para header de mídia" };

  const comps: any[] = [];
  if (headerType === "TEXT") {
    comps.push({ type: "HEADER", format: "TEXT", text: headerText });
  } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerType)) {
    comps.push({ type: "HEADER", format: headerType, example: { header_handle: [exemploUrl] } });
  }
  const bodyComp: any = { type: "BODY", text: bodyText };
  const totalParams = (bodyText.match(/\{\{\d+\}\}/g) ?? []).length;
  if (totalParams > 0) bodyComp.example = { body_text: [Array.from({ length: totalParams }, (_, i) => `valor_${i + 1}`)] };
  comps.push(bodyComp);
  if (footerText) comps.push({ type: "FOOTER", text: footerText });

  return { payload: { name: nome, category: categoria, language: lang, components: comps }, erro: null };
}
