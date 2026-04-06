import path from "path";
import { Server as SocketServer } from "socket.io";
import { getSupa, supaGetAll, supaInsertBatch } from "./supabase";
import * as meta from "./meta-api";
import * as cw from "./chatwoot";

const LOTE = 50;
const MAX_WORKERS = Number(process.env.DISPARO_MAX_WORKERS) || 20;

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
  let compsTemplate = montarComponentesTemplate(cfg);

  // Corpo do template para nota CW
  let corpoTemplate = "";
  try {
    const det = await detalharTemplate(dData.template_nome, lang);
    if (det) {
      const partes: string[] = [];
      if (det.header_text) partes.push(`*${det.header_text}*`);
      if (det.body_text) partes.push(det.body_text);
      if (det.footer_text) partes.push(`_${det.footer_text}_`);
      corpoTemplate = partes.join("\n\n");
    }
  } catch {}

  // Pre-upload mídia
  const mediaUrl = cfg.media_url;
  if (mediaUrl && compsTemplate) {
    const mtMap: Record<string, string> = { IMAGE: "image", VIDEO: "video", DOCUMENT: "document" };
    const mt = mtMap[String(cfg.header_format ?? "IMAGE").toUpperCase()] ?? "image";
    // Se a URL aponta para nosso próprio endpoint de mídia, lê direto do disco
    const mediaMatch = String(mediaUrl).match(/\/api\/disparo\/media\/([^/?#]+)/);
    let result: { mediaId: string | null; error: string };
    if (mediaMatch) {
      const localPath = path.resolve("uploads_media", mediaMatch[1]);
      result = await meta.uploadMediaFromFile(mt, localPath);
    } else {
      result = await meta.uploadMediaFromUrl(mt, mediaUrl);
    }
    if (result.mediaId) {
      compsTemplate = meta.resolverComponentesComMediaId(compsTemplate, result.mediaId);
      console.log(`[Disparo ${disparoId}] Mídia pré-upada: ${result.mediaId}`);
    } else {
      console.log(`[Disparo ${disparoId}] Aviso mídia: ${result.error}`);
    }
  }

  // Busca etiquetas do Supabase
  const etiquetaMap: Record<string, string> = {};
  const timesMap: Record<string, number> = {};
  try {
    const { data: cfgs } = await supa.from("template_configs").select("*");
    for (const r of cfgs ?? []) { if (r.etiqueta) etiquetaMap[r.template_nome] = r.etiqueta; }
  } catch {}

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

    // Processar em paralelo (limitado a MAX_WORKERS)
    const chunks: any[][] = [];
    for (let j = 0; j < lote.length; j += MAX_WORKERS) chunks.push(lote.slice(j, j + MAX_WORKERS));

    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map(async (contato: any) => {
          const { data: resp, error } = await meta.enviarTemplate(
            contato.numero, dData.template_nome, lang, compsTemplate,
          );
          if (resp) {
            const wamid = (resp.messages ?? [{}])[0]?.id ?? "";
            return { contato, status: "SENT", erro: "", wamid };
          }
          return { contato, status: "FAILED", erro: error, wamid: "" };
        }),
      );

      for (const r of results) {
        const val = r.status === "fulfilled" ? r.value : { contato: null, status: "FAILED", erro: "Thread error", wamid: "" };
        if (val.status === "SENT") {
          sucessos++;
          // Fire-and-forget CW integration
          if (val.contato) {
            integrarChatwoot(val.contato.numero, val.contato.nome, dData.template_nome, inboxId, corpoTemplate, etiquetaMap, timesMap);
          }
        } else {
          falhas++;
          console.log(`[Disparo ${disparoId}] FALHA ${val.contato?.numero}: ${val.erro}`);
        }
        logsLote.push({
          disparo_id: disparoId,
          contato_numero: val.contato?.numero ?? "?",
          status: val.status,
          mensagem_erro: val.erro,
          meta_wamid: val.wamid,
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
