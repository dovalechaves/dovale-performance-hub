const BASE_URL = () => (process.env.base_chatwoot ?? "").replace(/\/+$/, "");
const API_KEY = () => process.env.api_chatwoot ?? "";
const INBOX_ID = () => Number(process.env.inbox_id_chatwoot) || 1;
const ACCOUNT_ID = () => Number(process.env.account_id_chatwoot) || 1;
// Base da conta. Header usa hífen ("api-access-token") porque proxies (nginx/Cloudflare)
// descartam headers HTTP com underscore por padrão.
const ACC = () => `${BASE_URL()}/api/v1/accounts/${ACCOUNT_ID()}`;

function headers(): Record<string, string> {
  return {
    "api-access-token": API_KEY(),
    "Content-Type": "application/json",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type ResultadoFetch = { ok: true; res: Response } | { ok: false; status: number; error: string };

/**
 * fetch com retry/backoff em 429 (rate limit) e 5xx. Sem isso, em disparos de volume o
 * Chatwoot rate-limita a criação de contato/conversa e o contato falha de forma permanente
 * (era o caso antes: só enviarTemplate tinha retry, criarContato/criarConversa/etc não).
 */
async function fetchComRetry(url: string, init: RequestInit, maxRetries = 4): Promise<ResultadoFetch> {
  let lastError = "";
  for (let tentativa = 0; tentativa < maxRetries; tentativa++) {
    try {
      const r = await fetch(url, init);
      if (r.ok) return { ok: true, res: r };
      if ((r.status === 429 || r.status >= 500) && tentativa < maxRetries - 1) {
        lastError = `Chatwoot ${r.status}`;
        await sleep(2 ** tentativa * 1000);
        continue;
      }
      const txt = await r.text().catch(() => "");
      return { ok: false, status: r.status, error: `Chatwoot ${r.status}: ${txt.slice(0, 300)}` };
    } catch (e: any) {
      lastError = `Exceção Chatwoot: ${e.message}`;
      if (tentativa < maxRetries - 1) await sleep(1000);
    }
  }
  return { ok: false, status: 0, error: lastError };
}

// ── Contatos ─────────────────────────────────────────────────────────────────

export async function buscarContato(telefone: string): Promise<number | null> {
  const digitos = telefone.replace(/\D/g, "");
  if (!digitos) return null;
  const termo = digitos.slice(-9);
  try {
    let page = 1;
    while (page <= 3) {
      const url = `${ACC()}/contacts/search?${new URLSearchParams({
        q: termo,
        page: String(page),
        per_page: "50",
        include_contacts: "true",
      })}`;
      const r = await fetch(url, { headers: headers() });
      if (!r.ok) break;
      const json = await r.json();
      const contatos: any[] = json.payload ?? [];
      for (const c of contatos) {
        const numC = (c.phone_number ?? "").replace(/\D/g, "");
        if (numC && numC.slice(-9) === digitos.slice(-9)) return c.id;
      }
      const totalPages = json.meta?.total_pages ?? 1;
      if (!contatos.length || page >= totalPages) break;
      page++;
    }
  } catch (e: any) {
    console.error(`[Chatwoot] Erro na busca de contato (${telefone}): ${e.message}`);
  }
  return null;
}

export async function criarContato(
  telefone: string,
  nome?: string,
  inboxId?: number,
): Promise<number | null> {
  const digitos = telefone.replace(/\D/g, "");
  if (!digitos) return null;
  const num = digitos.length <= 11 ? `55${digitos}` : digitos;
  const telefoneE164 = `+${num}`;

  const data = {
    phone_number: telefoneE164,
    name: nome ?? undefined,
    inbox_id: inboxId ?? INBOX_ID(),
  };
  const result = await fetchComRetry(`${ACC()}/contacts`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });
  if (!result.ok) {
    if (result.status === 422 && result.error.toLowerCase().includes("already been taken")) {
      return buscarContato(telefoneE164);
    }
    console.error(`[Chatwoot] criar_contato (${telefone}) falhou: ${result.error}`);
    return null;
  }
  const payload = (await result.res.json()).payload ?? {};
  return payload.contact?.id ?? payload.id ?? null;
}

// ── Conversas ────────────────────────────────────────────────────────────────

export async function criarConversa(
  contatoId: number,
  inboxId?: number,
): Promise<number | null> {
  const data = { contact_id: contatoId, inbox_id: inboxId ?? INBOX_ID(), status: "open" };
  const result = await fetchComRetry(`${ACC()}/conversations`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });
  if (!result.ok) {
    console.error(`[Chatwoot] criar_conversa falhou: ${result.error}`);
    return null;
  }
  return (await result.res.json()).id ?? null;
}

// ── Etiquetas ────────────────────────────────────────────────────────────────

export async function adicionarEtiqueta(
  conversationId: number,
  etiqueta: string,
): Promise<boolean> {
  const result = await fetchComRetry(
    `${ACC()}/conversations/${conversationId}/labels`,
    { method: "POST", headers: headers(), body: JSON.stringify({ labels: [etiqueta] }) },
  );
  if (!result.ok) {
    console.error(`[Chatwoot] adicionar_etiqueta '${etiqueta}' falhou: ${result.error}`);
    return false;
  }
  return true;
}

// ── Times ────────────────────────────────────────────────────────────────────

export async function atribuirTime(
  conversationId: number,
  teamId: number,
): Promise<boolean> {
  const result = await fetchComRetry(
    `${ACC()}/conversations/${conversationId}/assignments`,
    { method: "POST", headers: headers(), body: JSON.stringify({ team_id: teamId }) },
  );
  if (!result.ok) {
    console.error(`[Chatwoot] atribuir_time ID=${teamId} falhou: ${result.error}`);
    return false;
  }
  return true;
}

// ── Mensagens ────────────────────────────────────────────────────────────────

export async function enviarMensagemPrivada(
  conversationId: number,
  texto: string,
): Promise<boolean> {
  try {
    const r = await fetch(
      `${ACC()}/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ content: texto, message_type: "outgoing", private: true }),
      },
    );
    if (r.ok) return true;
    console.error(`[Chatwoot] enviar_mensagem_privada falhou: ${r.status}`);
    return false;
  } catch (e: any) {
    console.error(`[Chatwoot] Exceção ao enviar mensagem privada: ${e.message}`);
    return false;
  }
}

export async function enviarMensagemPublica(
  conversationId: number,
  texto: string,
): Promise<number | null> {
  try {
    const r = await fetch(
      `${ACC()}/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ content: texto, message_type: "outgoing", private: false }),
      },
    );
    if (r.ok) return (await r.json()).id ?? null;
    console.error(`[Chatwoot] enviar_mensagem_publica falhou: ${r.status}`);
    return null;
  } catch (e: any) {
    console.error(`[Chatwoot] Exceção ao enviar mensagem pública: ${e.message}`);
    return null;
  }
}

// ── Enviar template (WhatsApp Cloud via Chatwoot) ────────────────────────────

export interface ProcessedParams {
  body?: Record<string, string>;
  header?: { media_url?: string; media_type?: string; media_name?: string };
  buttons?: Array<{ type: string; parameter: string }>;
}

/**
 * Dispara um template aprovado pela API do Chatwoot. O Chatwoot repassa para a
 * Meta usando o número conectado no inbox. Faz retry com backoff em 429/5xx
 * (rate-limit do Chatwoot em disparos de volume).
 */
export async function enviarTemplate(
  conversationId: number,
  name: string,
  category: string,
  language: string,
  processedParams: ProcessedParams,
  contentPreview = "",
  maxRetries = 4,
): Promise<{ id: number | null; error: string }> {
  const url = `${ACC()}/conversations/${conversationId}/messages`;
  const body = JSON.stringify({
    content: contentPreview || name,
    template_params: { name, category, language, processed_params: processedParams },
  });
  const result = await fetchComRetry(url, { method: "POST", headers: headers(), body }, maxRetries);
  if (!result.ok) return { id: null, error: result.error };
  let id: number | null = null;
  try { id = (await result.res.json()).id ?? null; } catch {}
  return { id, error: "" };
}

// ── Sincronização de templates ───────────────────────────────────────────────

/** Dispara a sincronização dos templates do WhatsApp no Chatwoot (assíncrona no Chatwoot). */
export async function sincronizarTemplates(inboxId?: number): Promise<boolean> {
  const id = inboxId ?? INBOX_ID();
  try {
    const r = await fetch(`${ACC()}/inboxes/${id}/sync_templates`, {
      method: "POST", headers: headers(), body: "{}",
    });
    if (r.ok) return true;
    console.error(`[Chatwoot] sync_templates falhou: ${r.status}`);
    return false;
  } catch (e: any) {
    console.error(`[Chatwoot] Exceção sync_templates: ${e.message}`);
    return false;
  }
}

/**
 * Garante que o template está na lista do inbox. Se não estiver, dispara o sync e
 * faz polling — o sync do Chatwoot é assíncrono, a lista não atualiza na hora.
 * Só templates APROVADOS na Meta entram nessa lista; para pendentes isso nunca
 * retorna true (por isso o status na Meta deve ser checado antes).
 */
export async function garantirTemplateSincronizado(
  nome: string,
  inboxId?: number,
  tentativas = 3,
  intervaloMs = 3000,
): Promise<boolean> {
  if (await templateSincronizado(nome, inboxId)) return true;
  console.log(`[Chatwoot] Template '${nome}' fora da lista do inbox — disparando sync...`);
  await sincronizarTemplates(inboxId);
  for (let t = 0; t < tentativas; t++) {
    await sleep(intervaloMs);
    if (await templateSincronizado(nome, inboxId)) return true;
  }
  console.error(`[Chatwoot] Template '${nome}' não apareceu na lista após o sync.`);
  return false;
}

/** Verifica se um template (por nome) já está na lista sincronizada do inbox. */
export async function templateSincronizado(nome: string, inboxId?: number): Promise<boolean> {
  const id = inboxId ?? INBOX_ID();
  try {
    const r = await fetch(`${ACC()}/inboxes/${id}`, { headers: headers() });
    if (!r.ok) return false;
    const ib = await r.json();
    const tpls: any[] = ib.message_templates ?? [];
    const alvo = nome.toLowerCase();
    return tpls.some((t: any) => String(t.name).toLowerCase() === alvo);
  } catch {
    return false;
  }
}

// ── Consultas ────────────────────────────────────────────────────────────────

export async function buscarMensagensRecentes(conversationId: number): Promise<any[]> {
  try {
    const r = await fetch(
      `${ACC()}/conversations/${conversationId}/messages`,
      { headers: headers() },
    );
    if (r.ok) return (await r.json()).payload ?? [];
    return [];
  } catch {
    return [];
  }
}

export async function buscarConversasContato(contatoId: number): Promise<any[]> {
  try {
    const r = await fetch(
      `${ACC()}/contacts/${contatoId}/conversations`,
      { headers: headers() },
    );
    if (r.ok) return (await r.json()).payload ?? [];
    return [];
  } catch {
    return [];
  }
}

export async function listarTimes(): Promise<{ id: number; name: string }[]> {
  try {
    const r = await fetch(`${ACC()}/teams`, { headers: headers() });
    if (!r.ok) return [];
    const payload: any[] = (await r.json()) ?? [];
    return payload.map((t) => ({ id: t.id, name: t.name })).filter((t) => t.name);
  } catch {
    return [];
  }
}

export async function listarEtiquetasChatwoot(): Promise<string[]> {
  try {
    const r = await fetch(`${ACC()}/labels`, { headers: headers() });
    if (!r.ok) return [];
    const payload: any[] = (await r.json()).payload ?? [];
    return payload.map((e) => e.title).filter(Boolean);
  } catch {
    return [];
  }
}
