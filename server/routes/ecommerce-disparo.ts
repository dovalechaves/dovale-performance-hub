import { NextFunction, Request, Response, Router } from "express";
import { getPool } from "../db/sqlserver";
import { exchangeShopeeCode, generateShopeeAuthUrl, getShopeeAdsData, getShopeeAdsRaw, refreshShopeeToken } from "../services/shopee-ads.service";
import { getMlAdsData, getMlAdsRaw } from "../services/ml-ads.service";
import { getCanaisDiario, getCanaisMensal, getCanaisRaw, CanalResumo } from "../services/ecommerce-canais.service";

const router = Router();

type Periodo = "diario" | "mensal";

const CW_TI_BASE = process.env.CW_TI_BASE || "https://chatwoot.dovale.online";
const CW_TI_TOKEN = process.env.CW_TI_TOKEN || "V1WDyvj1WTWeytVyWwKy31GL";
const CW_TI_INBOX = Number(process.env.CW_TI_INBOX) || 1;
const CW_TI_ACCOUNT = Number(process.env.CW_TI_ACCOUNT) || 1;

interface AnaliseBot {
  texto: string;
  gerado_em: string;
  data_referencia: string;
  modelo: string;
}

const analisesMemoria: Partial<Record<Periodo, AnaliseBot>> = {};

function cwHeaders() {
  return { api_access_token: CW_TI_TOKEN, "Content-Type": "application/json" };
}

function normalizarTelefone(telefone: string): string {
  const digitos = telefone.replace(/\D/g, "");
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  return digitos;
}

function getDestinatariosEcommerce() {
  const numeros = (process.env.ECOMMERCE_DISPARO_NUMEROS ?? "12981898755,551232121073,5512981505116")
    .split(",")
    .map((n) => normalizarTelefone(n))
    .filter(Boolean);

  return numeros.map((telefone, index) => ({
    nome: index === 0 ? "Disparo Ecommerce" : `Disparo Ecommerce ${index + 1}`,
    telefone: `+${telefone}`,
    telefone_normalizado: telefone,
  }));
}

async function cwBuscarContato(telefone: string): Promise<number | null> {
  const termo = telefone.replace(/\D/g, "").slice(-9);
  const r = await fetch(`${CW_TI_BASE}/api/v1/accounts/${CW_TI_ACCOUNT}/contacts/search?q=${termo}&page=1&per_page=10&include_contacts=true`, { headers: cwHeaders() });
  if (!r.ok) return null;
  const j: any = await r.json();
  return j.payload?.[0]?.id ?? null;
}

async function cwCriarContato(telefone: string, nome: string): Promise<number | null> {
  const r = await fetch(`${CW_TI_BASE}/api/v1/accounts/${CW_TI_ACCOUNT}/contacts`, {
    method: "POST",
    headers: cwHeaders(),
    body: JSON.stringify({ inbox_id: CW_TI_INBOX, phone_number: `+${telefone}`, name: nome }),
  });
  if (!r.ok) {
    console.error(`[Ecommerce->WPP] Criar contato falhou: ${r.status} ${await r.text()}`);
    return null;
  }
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
    method: "POST",
    headers: cwHeaders(),
    body: JSON.stringify({ contact_id: contatoId, inbox_id: CW_TI_INBOX, status: "open" }),
  });
  if (!r.ok) {
    console.error(`[Ecommerce->WPP] Criar conversa falhou: ${r.status} ${await r.text()}`);
    return null;
  }
  const j: any = await r.json();
  return j.id ?? null;
}

async function cwEnviarMensagem(conversaId: number, msg: string): Promise<number | null> {
  const r = await fetch(`${CW_TI_BASE}/api/v1/accounts/${CW_TI_ACCOUNT}/conversations/${conversaId}/messages`, {
    method: "POST",
    headers: cwHeaders(),
    body: JSON.stringify({ content: msg, message_type: "outgoing", private: false }),
  });
  if (!r.ok) {
    console.error(`[Ecommerce->WPP] Mensagem falhou: ${r.status} ${await r.text()}`);
    return null;
  }
  const j: any = await r.json();
  return j.id ?? null;
}

async function enviarWhatsApp(telefone: string, nome: string, mensagem: string) {
  const contatoId = await cwBuscarContato(telefone) ?? await cwCriarContato(telefone, nome);
  if (!contatoId) throw new Error(`Contato nao encontrado/criado para ${telefone}`);

  const conversaId = await cwBuscarConversaAberta(contatoId) ?? await cwCriarConversa(contatoId);
  if (!conversaId) throw new Error(`Conversa nao encontrada/criada para ${telefone}`);

  const mensagemId = await cwEnviarMensagem(conversaId, mensagem);
  if (!mensagemId) throw new Error(`Mensagem nao enviada para ${telefone}`);

  return { contatoId, conversaId, mensagemId };
}

async function isHubAdmin(usuario: string): Promise<boolean> {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("usuario", usuario.toLowerCase())
      .query(`SELECT TOP 1 hub_role FROM dbo.USUARIOS_LOJAS WHERE LOWER(usuario) = @usuario AND ativo = 1`);
    return result.recordset[0]?.hub_role === "admin";
  } catch {
    return false;
  }
}

async function canAccessEcommerceDisparo(usuario: string): Promise<boolean> {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("usuario", usuario.toLowerCase())
      .query(`
        SELECT TOP 1 ua.ativo
        FROM dbo.USUARIOS_APPS ua
        INNER JOIN dbo.USUARIOS_LOJAS ul ON LOWER(ul.usuario) = LOWER(ua.usuario)
        WHERE LOWER(ua.usuario) = @usuario
          AND ua.app_key = 'ecommercedisparo'
          AND ua.ativo = 1
          AND ul.ativo = 1
      `);
    return Boolean(result.recordset[0]);
  } catch {
    return false;
  }
}

async function requireAccess(req: Request, res: Response, next: NextFunction) {
  const usuario = String(req.headers["x-dovale-usuario"] ?? req.query.usuario ?? "").trim();
  if (!usuario) return res.status(401).json({ erro: "Usuario nao informado." });
  if (await isHubAdmin(usuario)) return next();
  if (await canAccessEcommerceDisparo(usuario)) return next();
  return res.status(403).json({ erro: "Sem permissao para acessar Relatorios Ecommerce." });
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

async function getMetas() {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      "SELECT TOP 1 meta_diario, meta_mensal FROM dbo.ECOMMERCE_METAS WHERE id = 1"
    );
    return {
      meta_diario: Number(result.recordset[0]?.meta_diario ?? 165000),
      meta_mensal: Number(result.recordset[0]?.meta_mensal ?? 3200000),
    };
  } catch {
    return { meta_diario: 165000, meta_mensal: 3200000 };
  }
}

const canaisDiario: CanalResumo[] = [
  { canal: "Mercado Livre", faturamento: 68450.9, pedidos: 312, ticket_medio: 219.39, conversao: 3.8, variacao: 8.7 },
  { canal: "Shopee", faturamento: 24890.2, pedidos: 184, ticket_medio: 135.27, conversao: 2.9, variacao: -3.1 },
  { canal: "Amazon", faturamento: 18320.5, pedidos: 76, ticket_medio: 241.06, conversao: 2.4, variacao: 5.4 },
  { canal: "Site", faturamento: 42870.4, pedidos: 138, ticket_medio: 310.66, conversao: 4.6, variacao: 12.2 },
];

const canaisMensal: CanalResumo[] = [
  { canal: "Mercado Livre", faturamento: 1298400.8, pedidos: 5940, ticket_medio: 218.59, conversao: 3.6, variacao: 9.4 },
  { canal: "Shopee", faturamento: 486300.2, pedidos: 3680, ticket_medio: 132.15, conversao: 2.8, variacao: 1.8 },
  { canal: "Amazon", faturamento: 358900.7, pedidos: 1492, ticket_medio: 240.55, conversao: 2.3, variacao: 6.3 },
  { canal: "Site", faturamento: 821760.4, pedidos: 2655, ticket_medio: 309.51, conversao: 4.8, variacao: 14.1 },
];

const historico = [
  { id: 1, periodo: "diario", data_envio: "2026-05-12T08:05:00.000Z", destinatario: "Henrique Berbert", status: "SIMULADO" },
  { id: 2, periodo: "diario", data_envio: "2026-05-12T08:05:00.000Z", destinatario: "Andreza", status: "SIMULADO" },
  { id: 3, periodo: "mensal", data_envio: "2026-05-01T08:30:00.000Z", destinatario: "Henrique Berbert", status: "SIMULADO" },
  { id: 4, periodo: "mensal", data_envio: "2026-05-01T08:30:00.000Z", destinatario: "Andreza", status: "SIMULADO" },
];

async function getReport(periodo: Periodo, data?: string) {
  const metas = await getMetas();
  const canaisDb = periodo === "mensal" ? await getCanaisMensal() : await getCanaisDiario(data);
  const canais = canaisDb ?? (periodo === "mensal" ? canaisMensal : canaisDiario);
  const faturamento = canais.reduce((acc, c) => acc + c.faturamento, 0);
  const pedidos = canais.reduce((acc, c) => acc + c.pedidos, 0);
  const conversaoMedia = canais.reduce((acc, c) => acc + c.conversao, 0) / canais.length;
  const ticketMedio = faturamento / pedidos;
  const meta = periodo === "mensal" ? metas.meta_mensal : metas.meta_diario;

  const [shopeeAds, mlAds] = await Promise.all([
    getShopeeAdsData(periodo, data),
    getMlAdsData(periodo, data),
  ]);

  const shopeeInvestimento = shopeeAds.expense > 0 ? shopeeAds.expense : 0;
  const shopeeReceita     = shopeeAds.gmv > 0     ? shopeeAds.gmv     : 0;
  const shopeeRoas        = shopeeAds.roas > 0    ? shopeeAds.roas    : 0;
  const shopeeConversao   = shopeeAds.orders > 0 && shopeeAds.clicks > 0
    ? parseFloat(((shopeeAds.orders / shopeeAds.clicks) * 100).toFixed(2))
    : 0;

  const mlInvestimento = mlAds.expense > 0 ? mlAds.expense : 0;
  const mlReceita      = mlAds.gmv > 0     ? mlAds.gmv     : 0;
  const mlRoas         = mlAds.roas > 0    ? mlAds.roas    : 0;
  const mlConversao    = mlAds.orders > 0 && mlAds.clicks > 0
    ? parseFloat(((mlAds.orders / mlAds.clicks) * 100).toFixed(2))
    : 0;

  const investimentoTotal = shopeeInvestimento + mlInvestimento;
  const receitaTotal      = shopeeReceita + mlReceita;
  const roasGeral         = investimentoTotal > 0 ? parseFloat((receitaTotal / investimentoTotal).toFixed(2)) : 0;

  return {
    periodo,
    gerado_em: new Date().toISOString(),
    fonte: shopeeAds.fonte === "api" || mlAds.fonte === "api" ? "ads_api" : "sem_dados_trafego",
    integracoes: {
      tray: "mockado",
      whatsapp: "chatwoot",
      shopee_ads: shopeeAds.fonte,
      ml_ads: mlAds.fonte,
    },
    destinatarios: getDestinatariosEcommerce().map(({ nome, telefone }) => ({ nome, telefone })),
    agenda: {
      diario: "08:00 em dias úteis",
      mensal: "08:30 no primeiro dia útil",
    },
    kpis: {
      faturamento,
      pedidos,
      ticket_medio: ticketMedio,
      conversao: conversaoMedia,
      roas: roasGeral,
      investimento: investimentoTotal,
      receita_paga: receitaTotal,
      meta,
      realizado_meta: (faturamento / meta) * 100,
      projecao_fechamento: periodo === "mensal" ? 3265400 : 174800,
    },
    comparativos: {
      dia_anterior: periodo === "diario" ? 7.6 : null,
      semana_anterior: periodo === "diario" ? 11.9 : null,
      mes_anterior: periodo === "mensal" ? 8.7 : null,
    },
    canais,
    trafego_pago: [
      { origem: "Shopee Ads",      investimento: shopeeInvestimento, receita: shopeeReceita, roas: shopeeRoas, conversao: shopeeConversao, fonte: shopeeAds.fonte },
      { origem: "Mercado Livre Ads", investimento: mlInvestimento, receita: mlReceita, roas: mlRoas, conversao: mlConversao, fonte: mlAds.fonte },
    ],
    analise: analisesMemoria[periodo] ?? null,
    pontos_criticos: [
      "Shopee abaixo do ritmo esperado, com ticket menor.",
      "Site próprio lidera conversão e deve receber reforço em campanhas de remarketing.",
      "Mercado Livre mantém volume alto, mas exige atenção ao custo de frete por pedido.",
    ],
    direcionamentos: [
      "Redistribuir verba de campanhas com ROAS abaixo de 4,5 para Google Ads e Site.",
      "Revisar kits de maior giro na Shopee para recuperar ticket sem reduzir volume.",
      "Priorizar estoque dos SKUs que puxam Site e Mercado Livre nas próximas 48h.",
    ],
  };
}

async function montarMensagem(periodo: Periodo, data?: string): Promise<string> {
  const report = await getReport(periodo, data);
  const label = periodo === "mensal" ? "MENSAL" : "DIARIO";
  const topCanal = [...report.canais].sort((a, b) => b.faturamento - a.faturamento)[0];
  const canais = report.canais
    .map((c) => `- ${c.canal}: ${formatCurrency(c.faturamento)} | ${c.pedidos} pedidos | ticket ${formatCurrency(c.ticket_medio)}`)
    .join("\n");

  return [
    `Relatorio ${label} Ecommerce - Dovale`,
    "",
    `Faturamento: ${formatCurrency(report.kpis.faturamento)}`,
    `Pedidos: ${report.kpis.pedidos}`,
    `Ticket medio: ${formatCurrency(report.kpis.ticket_medio)}`,
    `Conversao: ${report.kpis.conversao.toFixed(1)}%`,
    `ROAS: ${report.kpis.roas.toFixed(2)}x`,
    `Projecao: ${formatCurrency(report.kpis.projecao_fechamento)}`,
    "",
    `Canal destaque: ${topCanal.canal} (${formatCurrency(topCanal.faturamento)})`,
    "",
    "Canais:",
    canais,
    "",
    "Pontos criticos:",
    ...report.pontos_criticos.map((item: string) => `- ${item}`),
    "",
    "Direcionamentos:",
    ...report.direcionamentos.map((item: string) => `- ${item}`),
  ].join("\n");
}

// Callback do OAuth da Shopee — fica ANTES do requireAccess porque a Shopee
// redireciona direto para esta URL sem cabeçalho de autenticação do hub.
router.get("/shopee/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!code) return res.status(400).json({ erro: "Parâmetro 'code' não encontrado na URL." });

  const result = await exchangeShopeeCode(code);
  if (!result) return res.status(500).json({ erro: "Falha ao trocar o code pelos tokens. Verifique os logs." });

  res.json({
    ok: true,
    mensagem: "Tokens renovados! Copie os valores abaixo no Coolify (SHOPEE_ACCESS_TOKEN e SHOPEE_REFRESH_TOKEN).",
    access_token:  result.access_token,
    refresh_token: result.refresh_token,
  });
});

// Redireciona o navegador para a página de autorização da Shopee
router.get("/shopee/auth", (_req, res) => {
  const baseUrl = process.env.SHOPEE_REDIRECT_BASE_URL ?? "https://backend.dovale.online";
  const redirectUrl = `${baseUrl}/api/ecommerce-disparo/shopee/callback`;
  res.redirect(generateShopeeAuthUrl(redirectUrl));
});

router.use(requireAccess);

router.get("/metas", async (_req, res) => {
  res.json(await getMetas());
});

router.put("/metas", async (req, res) => {
  const { meta_diario, meta_mensal } = req.body ?? {};
  if (!meta_diario || !meta_mensal) return res.status(400).json({ erro: "meta_diario e meta_mensal são obrigatórios." });
  const usuario = String(req.headers["x-dovale-usuario"] ?? "");
  try {
    const pool = await getPool();
    await pool.request()
      .input("meta_diario",  Number(meta_diario))
      .input("meta_mensal",  Number(meta_mensal))
      .input("usuario",      usuario)
      .query(`
        IF EXISTS (SELECT 1 FROM dbo.ECOMMERCE_METAS WHERE id = 1)
          UPDATE dbo.ECOMMERCE_METAS
             SET meta_diario = @meta_diario, meta_mensal = @meta_mensal,
                 atualizado_em = GETDATE(), atualizado_por = @usuario
           WHERE id = 1
        ELSE
          INSERT INTO dbo.ECOMMERCE_METAS (id, meta_diario, meta_mensal, atualizado_por)
          VALUES (1, @meta_diario, @meta_mensal, @usuario)
      `);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ erro: e.message });
  }
});

router.get("/overview", async (req, res) => {
  const periodo = req.query.periodo === "mensal" ? "mensal" : "diario";
  const data = typeof req.query.data === "string" ? req.query.data : undefined;
  res.json(await getReport(periodo, data));
});

router.get("/historico", (_req, res) => {
  res.json({ total: historico.length, items: historico });
});

router.get("/teste-ml", async (_req, res) => {
  res.json(await getMlAdsRaw());
});

router.get("/teste-shopee", async (_req, res) => {
  res.json(await getShopeeAdsRaw());
});

router.post("/teste-shopee/refresh", async (_req, res) => {
  const result = await refreshShopeeToken();
  if (!result) return res.status(500).json({ erro: "Falha ao renovar token. Verifique SHOPEE_REFRESH_TOKEN no ambiente." });
  res.json({
    ok: true,
    mensagem: "Token renovado. Atualize SHOPEE_ACCESS_TOKEN e SHOPEE_REFRESH_TOKEN no Coolify com os valores abaixo.",
    access_token: result.access_token,
    refresh_token: result.refresh_token,
  });
});

router.get("/teste-canais", async (_req, res) => {
  res.json(await getCanaisRaw());
});

router.post("/analise/gerar", async (req, res) => {
  try {
    const periodo = req.query.periodo === "mensal" ? "mensal" : "diario";
    const data = typeof req.query.data === "string" ? req.query.data : undefined;
    const report = await getReport(periodo, data);
    const topCanal = [...report.canais].sort((a, b) => b.faturamento - a.faturamento)[0];
    const piorVariacao = [...report.canais].sort((a, b) => a.variacao - b.variacao)[0];
    const melhorVariacao = [...report.canais].sort((a, b) => b.variacao - a.variacao)[0];
    const realizado = report.kpis.meta > 0 ? (report.kpis.faturamento / report.kpis.meta) * 100 : 0;

    const texto = [
      `- Faturamento em ${formatCurrency(report.kpis.faturamento)}, equivalente a ${realizado.toFixed(1)}% da meta de ${formatCurrency(report.kpis.meta)}.`,
      `- Canal destaque: ${topCanal?.canal ?? "sem canal"} com ${formatCurrency(topCanal?.faturamento ?? 0)} e ${topCanal?.pedidos ?? 0} pedido(s).`,
      `- Melhor variação: ${melhorVariacao?.canal ?? "sem canal"} (${(melhorVariacao?.variacao ?? 0).toFixed(1)}%).`,
      `- Ponto de atenção: ${piorVariacao?.canal ?? "sem canal"} (${(piorVariacao?.variacao ?? 0).toFixed(1)}%).`,
      `- Tráfego pago: investimento de ${formatCurrency(report.kpis.investimento)} para receita atribuída de ${formatCurrency(report.kpis.receita_paga)} e ROAS ${report.kpis.roas.toFixed(2)}x.`,
    ].join("\n");

    const analise: AnaliseBot = {
      texto,
      gerado_em: new Date().toISOString(),
      data_referencia: data ?? new Date().toISOString().slice(0, 10),
      modelo: "heuristico",
    };

    analisesMemoria[periodo] = analise;
    res.json(analise);
  } catch (e: any) {
    res.status(500).json({ erro: e.message });
  }
});

router.post("/preview", async (req, res) => {
  const periodo = req.body?.periodo === "mensal" ? "mensal" : "diario";
  const data = typeof req.body?.data === "string" ? req.body.data : undefined;
  res.json({ periodo, mensagem: await montarMensagem(periodo, data), modo_simulacao: true });
});

router.post("/enviar", async (req, res) => {
  try {
    const periodo = req.body?.periodo === "mensal" ? "mensal" : "diario";
    const data = typeof req.body?.data === "string" ? req.body.data : undefined;
    const mensagem = await montarMensagem(periodo, data);
    const destinatarios = getDestinatariosEcommerce();
    const resultados = await Promise.allSettled(
      destinatarios.map((dest) => enviarWhatsApp(dest.telefone_normalizado, dest.nome, mensagem))
    );
    const enviados = resultados.filter((r) => r.status === "fulfilled").length;
    const falhas = resultados
      .map((r, index) => r.status === "rejected" ? `${destinatarios[index].telefone}: ${r.reason?.message ?? "falha desconhecida"}` : null)
      .filter(Boolean);

    res.status(enviados > 0 ? 200 : 502).json({
      ok: enviados > 0,
      periodo,
      modo_simulacao: false,
      enviados,
      falhas,
      destinatarios: destinatarios.map(({ nome, telefone }) => ({ nome, telefone })),
      mensagem: enviados > 0 ? "Relatorio enviado pelo Chatwoot." : "Nenhum relatorio foi enviado pelo Chatwoot.",
    });
  } catch (e: any) {
    res.status(500).json({ erro: e.message });
  }
});

router.post("/enviar-simulado-legado", async (req, res) => {
  const periodo = req.body?.periodo === "mensal" ? "mensal" : "diario";
  const data = typeof req.body?.data === "string" ? req.body.data : undefined;
  const report = await getReport(periodo, data);
  res.json({
    ok: true,
    periodo,
    modo_simulacao: true,
    enviados: report.destinatarios.length,
    destinatarios: report.destinatarios,
    mensagem: "Envio simulado com sucesso. Integração real com WhatsApp será conectada quando os templates e credenciais forem definidos.",
  });
});

export default router;
