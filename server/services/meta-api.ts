import fs from "fs";
import path from "path";
import mime from "mime-types";

const API_VERSION = "v21.0";

function getAccessToken(): string {
  return process.env.wpp_access_token ?? "";
}

function getPhoneNumberId(): string {
  return (
    process.env.wpp_phone_number_id ??
    process.env.wpp_numero_id ??
    process.env.wpp_phone_id ??
    process.env.wpp_conta_id ??
    ""
  );
}

function getWabaId(): string {
  return process.env.wpp_waba_id ?? process.env.wpp_conta_id ?? "";
}

function getContaId(): string {
  return process.env.wpp_conta_id ?? "";
}

function baseUrl(): string {
  return `https://graph.facebook.com/${API_VERSION}/${getPhoneNumberId()}`;
}

// ── Media upload ─────────────────────────────────────────────────────────────

async function enviarBytesParaMeta(
  mediaType: string,
  nomeArquivo: string,
  conteudo: Buffer,
  contentType: string,
): Promise<{ mediaId: string | null; error: string }> {
  const formData = new FormData();
  formData.append("messaging_product", "whatsapp");
  formData.append("type", mediaType);
  formData.append(
    "file",
    new Blob([new Uint8Array(conteudo)], { type: contentType || "application/octet-stream" }),
    nomeArquivo,
  );

  const r = await fetch(`${baseUrl()}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getAccessToken()}` },
    body: formData,
  });
  if (r.ok) {
    const json = await r.json();
    if (json.id) return { mediaId: json.id, error: "" };
  }
  return { mediaId: null, error: `Falha upload mídia Meta ${r.status}: ${await r.text()}` };
}

export async function uploadMediaFromFile(
  mediaType: string,
  filepath: string,
): Promise<{ mediaId: string | null; error: string }> {
  try {
    const contentType = mime.lookup(filepath) || "application/octet-stream";
    const nome = path.basename(filepath);
    const conteudo = fs.readFileSync(filepath);
    return enviarBytesParaMeta(mediaType, nome, conteudo, contentType);
  } catch (e: any) {
    return { mediaId: null, error: `Exceção upload mídia (arquivo): ${e.message}` };
  }
}

export async function uploadMediaFromUrl(
  mediaType: string,
  link: string,
): Promise<{ mediaId: string | null; error: string }> {
  try {
    const r = await fetch(link, {
      headers: { "ngrok-skip-browser-warning": "1", "User-Agent": "curl/8.4.0" },
    });
    if (!r.ok) return { mediaId: null, error: `Falha ao baixar mídia (status ${r.status})` };
    const contentType = (r.headers.get("content-type") ?? "").split(";")[0].trim();
    const ext = mime.extension(contentType) || "bin";
    const nome = `upload.${ext}`;
    const buf = Buffer.from(await r.arrayBuffer());
    return enviarBytesParaMeta(mediaType, nome, buf, contentType);
  } catch (e: any) {
    return { mediaId: null, error: `Exceção upload mídia Meta: ${e.message}` };
  }
}

export function resolverComponentesComMediaId(
  components: any[] | null,
  mediaId: string,
): any[] | null {
  if (!components || !mediaId) return components;
  const resolved = JSON.parse(JSON.stringify(components));
  for (const comp of resolved) {
    if (String(comp.type ?? "").toLowerCase() !== "header") continue;
    const params = comp.parameters ?? [];
    if (!params.length) continue;
    const p = params[0];
    const mt = String(p.type ?? "").toLowerCase();
    if (!["image", "video", "document"].includes(mt)) continue;
    p[mt] = { id: mediaId };
  }
  return resolved;
}

// ── Enviar template ──────────────────────────────────────────────────────────

export async function enviarTemplate(
  telefone: string,
  templateNome: string,
  languageCode = "pt_BR",
  components?: any[] | null,
  maxRetries = 3,
): Promise<{ data: any | null; error: string }> {
  const endpoint = `${baseUrl()}/messages`;
  const payload: any = {
    messaging_product: "whatsapp",
    to: telefone,
    type: "template",
    template: { name: templateNome, language: { code: languageCode } },
  };
  if (components) payload.template.components = components;

  let lastError = "";
  for (let tentativa = 0; tentativa < maxRetries; tentativa++) {
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getAccessToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (r.ok) return { data: await r.json(), error: "" };
      if (r.status === 429) {
        await sleep(2 ** tentativa * 1000);
        continue;
      }
      if (r.status >= 500 && tentativa < maxRetries - 1) {
        await sleep(1000);
        continue;
      }
      lastError = `Meta API ${r.status}: ${await r.text()}`;
      if (r.status === 400 && !process.env.wpp_phone_number_id) {
        lastError = "Falha Meta: configure wpp_phone_number_id com o Phone Number ID da conta WhatsApp Cloud.";
      }
      return { data: null, error: lastError };
    } catch (e: any) {
      lastError = `Exceção Meta API: ${e.message}`;
      if (tentativa < maxRetries - 1) await sleep(1000);
    }
  }
  return { data: null, error: lastError };
}

// ── Templates CRUD ───────────────────────────────────────────────────────────

export async function obterTemplates(
  nome?: string,
  lingua?: string,
): Promise<{ data: any | null; error: string }> {
  const params = new URLSearchParams({
    access_token: getAccessToken(),
    fields: "id,name,language,status,category,components",
    format: "json",
    limit: "1000",
  });
  if (nome) params.set("name", nome);
  if (lingua) params.set("language", lingua);
  let url: string | null = `https://graph.facebook.com/${API_VERSION}/${getWabaId()}/message_templates?${params}`;
  const allItems: any[] = [];
  while (url) {
    const r = await fetch(url);
    if (!r.ok) {
      const errText = await r.text();
      console.error(`[meta-api] obterTemplates erro ${r.status}: ${errText}`);
      return { data: null, error: `Meta API ${r.status}: ${errText}` };
    }
    const json = await r.json();
    allItems.push(...(json.data ?? []));
    url = json.paging?.next ?? null;
  }
  return { data: { data: allItems }, error: "" };
}

export async function criarTemplate(payload: any): Promise<{ data: any | null; error: string }> {
  const url = `https://graph.facebook.com/${API_VERSION}/${getWabaId()}/message_templates`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getAccessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (r.ok) return { data: await r.json(), error: "" };
  return { data: null, error: `Meta API ${r.status}: ${await r.text()}` };
}

// ── Upload Sessions (para header_handle de template) ─────────────────────────

async function uploadBytesParaHandle(
  conteudo: Buffer,
  nomeBase: string,
  contentType: string,
  wabaId?: string,
): Promise<{ handle: string | null; error: string }> {
  const token = getAccessToken();
  const appId = process.env.wpp_app_id;
  const waba = wabaId || getWabaId();
  const uploadOwnerId = appId || waba;

  // Etapa 1: criar sessão
  const r1 = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${uploadOwnerId}/uploads?` +
      new URLSearchParams({
        file_name: nomeBase,
        file_length: String(conteudo.length),
        file_type: contentType,
        access_token: token,
      }),
    { method: "POST" },
  );
  if (!r1.ok) return { handle: null, error: `Upload sessão falhou (${r1.status}): ${(await r1.text()).slice(0, 300)}` };
  const sessionId = (await r1.json()).id;
  if (!sessionId) return { handle: null, error: "Upload sessão não retornou ID" };

  // Etapa 2: enviar bytes
  const r2 = await fetch(`https://graph.facebook.com/${API_VERSION}/${sessionId}`, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${token}`,
      file_offset: "0",
      "Content-Type": contentType,
    },
    body: new Uint8Array(conteudo),
  });
  if (!r2.ok) return { handle: null, error: `Upload bytes falhou (${r2.status}): ${(await r2.text()).slice(0, 300)}` };
  const handle = (await r2.json()).h;
  if (!handle) return { handle: null, error: "Upload não retornou handle" };
  return { handle, error: "" };
}

export async function gerarHandlePorUrl(
  url: string,
  wabaId?: string,
): Promise<{ handle: string | null; error: string }> {
  try {
    const r = await fetch(url, {
      headers: { "ngrok-skip-browser-warning": "1", "User-Agent": "curl/8.4.0" },
    });
    if (!r.ok) return { handle: null, error: `Falha ao baixar mídia de exemplo (status ${r.status})` };
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return { handle: null, error: "Mídia de exemplo vazia" };
    const contentType = (r.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
    const parsed = new URL(url);
    let nomeBase = path.basename(parsed.pathname) || "exemplo";
    if (!nomeBase.includes(".")) {
      const ext = mime.extension(contentType) || "bin";
      nomeBase = `${nomeBase}.${ext}`;
    }
    return uploadBytesParaHandle(buf, nomeBase, contentType, wabaId);
  } catch (e: any) {
    return { handle: null, error: `Exceção ao gerar handle de mídia: ${e.message}` };
  }
}

export async function gerarHandleDeArquivoLocal(
  caminhoLocal: string,
  wabaId?: string,
): Promise<{ handle: string | null; error: string }> {
  try {
    const contentType = mime.lookup(caminhoLocal) || "application/octet-stream";
    const nomeBase = path.basename(caminhoLocal);
    const conteudo = fs.readFileSync(caminhoLocal);
    return uploadBytesParaHandle(conteudo, nomeBase, contentType, wabaId);
  } catch (e: any) {
    return { handle: null, error: `Exceção ao ler arquivo local: ${e.message}` };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
