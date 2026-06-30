import { Server as SocketServer } from "socket.io";
import { getSupa, supaGetAll, supaInsertBatch } from "./supabase";
import * as meta from "./meta-api";
import * as cw from "./chatwoot";

const LOTE = 50;
// Disparo via API do Chatwoot faz ~5 chamadas por contato (contato+conversa+etiqueta+time+template).
// Concorrência baixa + retry em 429 (no cw.enviarTemplate) evitam rate-limit do Chatwoot em volume.
const MAX_WORKERS = Number(process.env.DISPARO_MAX_WORKERS) || 6;

let io: SocketServer | null = null;
export function setSocketIO(s: SocketServer) { io = s; }

function emit(event: string, data: any) { io?.emit(event, data); }

// ── Helpers ──────────────────────────────────────────────────────────────────

export function parseConfiguracao(valor: any): Record<string, any> {
  if (!valor) return {};
  if (typeof valor === "object") return valor;
  if (typeof valor === "string") { try { return JSON.parse(valor); } catch { return {}; } }
  return {};
}

export function montarComponentesTemplate(cfg: Record<string, any>): any[] | null {
  const comps: any[] = [];
  const mediaUrl = cfg.media_url;
  const hf = String(cfg.header_format ?? "").toUpperCase();

  if (mediaUrl && ["IMAGE", "VIDEO", "DOCUMENT"].includes(hf)) {
    const t = hf.toLowerCase();
    comps.push({ type: "header", parameters: [{ type: t, [t]: { link: mediaUrl } }] });
  }
  if (Array.isArray(cfg.header_text_params) && cfg.header_text_params.length && hf === "TEXT") {
    comps.push({ type: "header", parameters: cfg.header_text_params.map((v: any) => ({ type: "text", text: String(v) })) });
  }
  if (Array.isArray(cfg.body_params) && cfg.body_params.length) {
    comps.push({ type: "body", parameters: cfg.body_params.map((v: any) => ({ type: "text", text: String(v) })) });
  }
  return comps.length ? comps : null;
}

// ── Integração Chatwoot (fire-and-forget) ────────────────────────────────────

export async function integrarChatwoot(
  numero: string, nome: string, templateNome: string,
  inboxId: number, corpoMensagem: string,
  etiquetaMap: Record<string, string>, timesMap: Record<string, number>,
) {
  try {
    const contatoId = await cw.criarContato(numero, nome, inboxId);
    if (!contatoId) return;
    const conversaId = await cw.criarConversa(contatoId, inboxId);
    if (!conversaId) return;
    const etiqueta = etiquetaMap[templateNome.toLowerCase()];
    if (etiqueta) {
      await cw.adicionarEtiqueta(conversaId, etiqueta);
      const timeId = timesMap[etiqueta];
      if (timeId) await cw.atribuirTime(conversaId, timeId);
    }
    const texto = corpoMensagem
      ? `📤 *Disparo automático enviado via WhatsApp*\n━━━━━━━━━━━━━━━━━━━━\n${corpoMensagem}\n━━━━━━━━━━━━━━━━━━━━\nTemplate: \`${templateNome}\``
      : `📤 *Disparo automático enviado via WhatsApp*\nTemplate: \`${templateNome}\``;
    await cw.enviarMensagemPrivada(conversaId, texto);
  } catch (e: any) {
    console.error(`Erro integração Chatwoot (${numero}): ${e.message}`);
  }
}

// ── Detalhar template (para corpo da nota CW) ───────────────────────────────

export async function detalharTemplate(nome: string, lang: string) {
  const { data } = await meta.obterTemplates(nome, lang);
  if (!data) return null;
  const items: any[] = data.data ?? [];
  const item = items.find((t: any) => t.name === nome) ?? items[0];
  if (!item) return null;
  const comps: any[] = item.components ?? [];
  const header = comps.find((c: any) => c.type?.toUpperCase() === "HEADER");
  const body = comps.find((c: any) => c.type?.toUpperCase() === "BODY");
  const footer = comps.find((c: any) => c.type?.toUpperCase() === "FOOTER");
  const ht = (header?.format ?? "NONE").toUpperCase();
  return {
    id: item.id, name: item.name,
    category: item.category ?? "MARKETING",
    language_code: item.language ?? lang,
    header_type: ["TEXT","IMAGE","VIDEO","DOCUMENT"].includes(ht) ? ht : "NONE",
    header_text: ht === "TEXT" ? (header?.text ?? "") : "",
    header_media_example_url: ["IMAGE","VIDEO","DOCUMENT"].includes(ht) ? (header?.example?.header_handle?.[0] ?? "") : "",
    body_text: body?.text ?? "",
    footer_text: footer?.text ?? "",
  };
}

// ── Processar Disparo (background) ───────────────────────────────────────────

/** Monta o processed_params do Chatwoot a partir da configuração do disparo. */
export function montarProcessedParams(cfg: Record<string, any>): cw.ProcessedParams {
  const pp: cw.ProcessedParams = {};
  if (Array.isArray(cfg.body_params) && cfg.body_params.length) {
    pp.body = {};
    cfg.body_params.forEach((v: any, i: number) => { pp.body![String(i + 1)] = String(v); });
  }
  const mediaUrl = String(cfg.media_url ?? "").trim();
  const hf = String(cfg.header_format ?? "").toUpperCase();
  if (mediaUrl && ["IMAGE", "VIDEO", "DOCUMENT"].includes(hf)) {
    pp.header = { media_url: mediaUrl, media_type: hf.toLowerCase() };
  }
  return pp;
}

/** Envia o template para um contato via API do Chatwoot (acha/cria contato → conversa → time → template). */
async function enviarParaContato(
  contato: any, templateNome: string, inboxId: number, lang: string, category: string,
  processedParams: cw.ProcessedParams, corpoPreview: string, etiqueta: string, timeId: number | null,
): Promise<{ contato: any; status: string; erro: string; msgId: string }> {
  try {
    const contatoId = await cw.criarContato(contato.numero, contato.nome, inboxId);
    if (!contatoId) return { contato, status: "FAILED", erro: "Falha ao achar/criar contato no Chatwoot", msgId: "" };
    const conversaId = await cw.criarConversa(contatoId, inboxId);
    if (!conversaId) return { contato, status: "FAILED", erro: "Falha ao criar conversa no Chatwoot", msgId: "" };
    if (etiqueta) await cw.adicionarEtiqueta(conversaId, etiqueta);
    if (timeId) await cw.atribuirTime(conversaId, timeId);
    const { id, error } = await cw.enviarTemplate(conversaId, templateNome, category, lang, processedParams, corpoPreview);
    if (id) return { contato, status: "SENT", erro: "", msgId: String(id) };
    return { contato, status: "FAILED", erro: error, msgId: "" };
  } catch (e: any) {
    return { contato, status: "FAILED", erro: e.message, msgId: "" };
  }
}

export async function processarDisparo(disparoId: number, inboxId: number) {
  const supa = getSupa();
  const { data: dData } = await supa.from("disparos").select("*").eq("id", disparoId).single();
  if (!dData) return;

  await supa.from("disparos").update({ status: "PROCESSING" }).eq("id", disparoId);
  emit("status_disparo", { id: disparoId, status: "PROCESSING" });

  const todosContatos = await supaGetAll("contatos_lista", { column: "lista_id", value: dData.lista_id });
  const totalGeral = todosContatos.length;

  const logsExistentes = await supaGetAll("logs_disparo", { column: "disparo_id", value: disparoId });
  const processados = new Set(
    logsExistentes.filter((l: any) => l.status === "SENT" || l.status === "FAILED").map((l: any) => l.contato_numero),
  );
  const pendentes = todosContatos.filter((c: any) => !processados.has(c.numero));

  const cfg = parseConfiguracao(dData.configuracao);
  const lang = cfg.language_code ?? "pt_BR";
  const processedParams = montarProcessedParams(cfg);

  // Detalhe do template: categoria (obrigatória no template_params) + corpo (preview na conversa do Chatwoot)
  let category = "MARKETING";
  let corpoTemplate = "";
  try {
    const det = await detalharTemplate(dData.template_nome, lang);
    if (det) {
      category = det.category ?? "MARKETING";
      const partes: string[] = [];
      if (det.header_text) partes.push(`*${det.header_text}*`);
      if (det.body_text) partes.push(det.body_text);
      if (det.footer_text) partes.push(`_${det.footer_text}_`);
      corpoTemplate = partes.join("\n\n");
    }
  } catch {}

  // Etiqueta (do disparo ou do template_configs) e time (do disparo ou mapeado pela etiqueta)
  let etiqueta = String(cfg.etiqueta ?? "").trim();
  if (!etiqueta) {
    try {
      const { data: cfgs } = await supa.from("template_configs").select("*");
      const nome = String(dData.template_nome).toLowerCase();
      const row = (cfgs ?? []).find((r: any) => String(r.template_nome).toLowerCase() === nome);
      if (row?.etiqueta) etiqueta = row.etiqueta;
    } catch {}
  }
  let timeId: number | null = cfg.time_id ? Number(cfg.time_id) : null;
  if (!timeId && etiqueta) {
    try {
      const times = await cw.listarTimes();
      const t = times.find((t) => t.name.toLowerCase() === etiqueta.toLowerCase());
      if (t) timeId = t.id;
    } catch {}
  }

  // Garante que o template está sincronizado no Chatwoot. Templates recém-criados/aprovados
  // não entram na lista do Chatwoot automaticamente (sync a cada ~3h); sem isso o Chatwoot
  // monta o payload errado e a Meta devolve #132012.
  let sincronizado = await cw.templateSincronizado(dData.template_nome, inboxId);
  if (!sincronizado) {
    console.log(`[Disparo ${disparoId}] Template '${dData.template_nome}' não sincronizado — disparando sync no Chatwoot...`);
    await cw.sincronizarTemplates(inboxId);
    for (let tentativa = 0; tentativa < 6 && !sincronizado; tentativa++) {
      await new Promise((r) => setTimeout(r, 5000));
      sincronizado = await cw.templateSincronizado(dData.template_nome, inboxId);
    }
  }
  if (!sincronizado) {
    const erroMsg = `Template '${dData.template_nome}' não sincronizado no Chatwoot. Verifique se está APROVADO na Meta e sincronize os templates no inbox.`;
    console.error(`[Disparo ${disparoId}] ${erroMsg}`);
    await supa.from("disparos").update({ status: "FAILED", resultado: erroMsg }).eq("id", disparoId);
    emit("status_disparo", { id: disparoId, status: "FAILED", erro: erroMsg });
    return;
  }

  let sucessos = logsExistentes.filter((l: any) => l.status === "SENT").length;
  let falhas = logsExistentes.filter((l: any) => l.status === "FAILED").length;

  for (let i = 0; i < pendentes.length; i += LOTE) {
    // Verifica pausa
    const { data: check } = await supa.from("disparos").select("status").eq("id", disparoId).single();
    if (check?.status === "PAUSING") {
      await supa.from("disparos").update({ status: "PAUSED" }).eq("id", disparoId);
      emit("status_disparo", { id: disparoId, status: "PAUSED" });
      console.log(`[Disparo ${disparoId}] Pausado após ${sucessos + falhas}/${totalGeral}`);
      return;
    }

    const lote = pendentes.slice(i, i + LOTE);
    const logsLote: any[] = [];

    // Processar em paralelo (limitado a MAX_WORKERS — evita rate-limit do Chatwoot)
    const chunks: any[][] = [];
    for (let j = 0; j < lote.length; j += MAX_WORKERS) chunks.push(lote.slice(j, j + MAX_WORKERS));

    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map((contato: any) =>
          enviarParaContato(contato, dData.template_nome, inboxId, lang, category, processedParams, corpoTemplate, etiqueta, timeId),
        ),
      );

      for (const r of results) {
        const val = r.status === "fulfilled" ? r.value : { contato: null, status: "FAILED", erro: "Thread error", msgId: "" };
        if (val.status === "SENT") sucessos++;
        else { falhas++; console.log(`[Disparo ${disparoId}] FALHA ${val.contato?.numero}: ${val.erro}`); }
        logsLote.push({
          disparo_id: disparoId,
          contato_numero: val.contato?.numero ?? "?",
          status: val.status,
          mensagem_erro: val.erro,
          meta_wamid: val.msgId,
        });
      }
    }

    if (logsLote.length) await supaInsertBatch("logs_disparo", logsLote);

    const feitos = sucessos + falhas;
    emit("progresso_disparo", {
      disparo_id: disparoId,
      progresso: totalGeral > 0 ? Math.round((feitos / totalGeral) * 1000) / 10 : 0,
      enviados: sucessos,
      falhas,
    });
  }

  await supa.from("disparos").update({ status: "COMPLETED" }).eq("id", disparoId);
  emit("status_disparo", { id: disparoId, status: "COMPLETED" });
  console.log(`[Disparo ${disparoId}] Concluído — ${sucessos} enviados, ${falhas} falhas`);
}
