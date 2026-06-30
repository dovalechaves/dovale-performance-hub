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
  try {
    const r = await fetch(`${ACC()}/contacts`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(data),
    });
    if (r.status === 422) {
      const msg = ((await r.json()).message ?? "").toLowerCase();
      if (msg.includes("already been taken")) return buscarContato(telefoneE164);
    }
    if (r.status !== 200 && r.status !== 201) return null;
    const payload = (await r.json()).payload ?? {};
    return payload.contact?.id ?? payload.id ?? null;
  } catch (e: any) {
    console.error(`[Chatwoot] Erro ao criar contato (${telefone}): ${e.message}`);
    return null;
  }
}

// ── Conversas ────────────────────────────────────────────────────────────────

export async function criarConversa(
  contatoId: number,
  inboxId?: number,
): Promise<number | null> {
  const data = { contact_id: contatoId, inbox_id: inboxId ?? INBOX_ID(), status: "open" };
  try {
    const r = await fetch(`${ACC()}/conversations`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(data),
    });
    if (r.ok) return (await r.json()).id ?? null;
    console.error(`[Chatwoot] criar_conversa falhou: ${r.status}`);
    return null;
  } catch (e: any) {
    console.error(`[Chatwoot] Exceção ao criar conversa: ${e.message}`);
    return null;
  }
}

// ── Etiquetas ────────────────────────────────────────────────────────────────

export async function adicionarEtiqueta(
  conversationId: number,
  etiqueta: string,
): Promise<boolean> {
  try {
    const r = await fetch(
      `${ACC()}/conversations/${conversationId}/labels`,
      { method: "POST", headers: headers(), body: JSON.stringify({ labels: [etiqueta] }) },
    );
    if (r.ok) return true;
    console.error(`[Chatwoot] adicionar_etiqueta '${etiqueta}' falhou: ${r.status}`);
    return false;
  } catch (e: any) {
    console.error(`[Chatwoot] Exceção ao adicionar etiqueta: ${e.message}`);
    return false;
  }
}

// ── Times ────────────────────────────────────────────────────────────────────

export async function atribuirTime(
  conversationId: number,
  teamId: number,
): Promise<boolean> {
  try {
    const r = await fetch(
      `${ACC()}/conversations/${conversationId}/assignments`,
      { method: "POST", headers: headers(), body: JSON.stringify({ team_id: teamId }) },
    );
    if (r.ok) return true;
    console.error(`[Chatwoot] atribuir_time ID=${teamId} falhou: ${r.status}`);
    return false;
  } catch (e: any) {
    console.error(`[Chatwoot] Exceção ao atribuir time: ${e.message}`);
    return false;
  }
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
  let lastError = "";
  for (let tentativa = 0; tentativa < maxRetries; tentativa++) {
    try {
      const r = await fetch(url, { method: "POST", headers: headers(), body });
      if (r.ok) {
        let id: number | null = null;
        try { id = (await r.json()).id ?? null; } catch {}
        return { id, error: "" };
      }
      const txt = await r.text();
      if ((r.status === 429 || r.status >= 500) && tentativa < maxRetries - 1) {
        await sleep(2 ** tentativa * 1000);
        lastError = `Chatwoot ${r.status}`;
        continue;
      }
      return { id: null, error: `Chatwoot ${r.status}: ${txt.slice(0, 300)}` };
    } catch (e: any) {
      lastError = `Exceção Chatwoot template: ${e.message}`;
      if (tentativa < maxRetries - 1) await sleep(1000);
    }
  }
  return { id: null, error: lastError };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
