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

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function isoDateOffset(days: number): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function pctChange(atual: number, anterior: number): number {
  if (!anterior && !atual) return 0;
  if (!anterior) return 100;
  return ((atual - anterior) / anterior) * 100;
}

function diffText(atual: number, anterior: number, currency = false): string {
  const diff = atual - anterior;
  const formatted = currency ? formatCurrency(Math.abs(diff)) : Math.abs(diff).toFixed(0);
  const sinal = diff >= 0 ? "alta" : "queda";
  return `${sinal} de ${formatted} (${formatPercent(pctChange(atual, anterior))})`;
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
      { origem: "Shopee Ads", investimento: shopeeInvestimento, receita: shopeeReceita, roas: shopeeRoas, conversao: shopeeConversao, clicks: shopeeAds.clicks, impressoes: shopeeAds.impressions, pedidos: shopeeAds.orders, fonte: shopeeAds.fonte },
      { origem: "Mercado Livre Ads", investimento: mlInvestimento, receita: mlReceita, roas: mlRoas, conversao: mlConversao, clicks: mlAds.clicks, impressoes: mlAds.impressions, pedidos: mlAds.orders, fonte: mlAds.fonte },
    ],
    analise: analisesMemoria[periodo] ?? null,
  };
}

async function montarMensagem(periodo: Periodo, data?: string): Promise<string> {
  const report = await getReport(periodo, data);
  const label = periodo === "mensal" ? "MENSAL" : "DIARIO";
  const topCanal = [...report.canais].sort((a, b) => b.faturamento - a.faturamento)[0];
  const canais = report.canais
    .map((c) => `- ${c.canal}: ${formatCurrency(c.faturamento)} | ${c.pedidos} pedidos | ticket ${formatCurrency(c.ticket_medio)}`)
    .join("\n");
  const analiseTexto = report.analise?.texto
    ? report.analise.texto.split("\n").map((linha: string) => linha.trim()).filter(Boolean).join("\n")
    : "- Analise do bot ainda nao gerada para este periodo.";

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
    "Analise do bot:",
    analiseTexto,
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
    const ontem = isoDateOffset(-1);
    const anteontem = isoDateOffset(-2);
    const [report, anterior] = await Promise.all([
      getReport("diario", ontem),
      getReport("diario", anteontem),
    ]);

    const canaisAtuais = new Map(report.canais.map((c) => [c.canal, c]));
    const canaisAnteriores = new Map(anterior.canais.map((c) => [c.canal, c]));
    const nomesCanais = Array.from(new Set([...canaisAtuais.keys(), ...canaisAnteriores.keys()]));
    const comparativoCanais = nomesCanais.map((canal) => {
      const atual = canaisAtuais.get(canal);
      const prev = canaisAnteriores.get(canal);
      const faturamentoAtual = atual?.faturamento ?? 0;
      const faturamentoAnterior = prev?.faturamento ?? 0;
      const pedidosAtual = atual?.pedidos ?? 0;
      const pedidosAnterior = prev?.pedidos ?? 0;
      return {
        canal,
        diff: faturamentoAtual - faturamentoAnterior,
        variacao: pctChange(faturamentoAtual, faturamentoAnterior),
        pedidosDiff: pedidosAtual - pedidosAnterior,
      };
    }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    const maiorGanho = [...comparativoCanais].sort((a, b) => b.diff - a.diff)[0];
    const maiorPerda = [...comparativoCanais].sort((a, b) => a.diff - b.diff)[0];
    const canaisQueda = comparativoCanais.filter((c) => c.diff < 0).slice(0, 3);
    const canaisAlta = comparativoCanais.filter((c) => c.diff > 0).slice(0, 3);

    const adsAtual = report.trafego_pago.reduce((acc, item: any) => ({
      investimento: acc.investimento + Number(item.investimento ?? 0),
      receita: acc.receita + Number(item.receita ?? 0),
      clicks: acc.clicks + Number(item.clicks ?? 0),
      impressoes: acc.impressoes + Number(item.impressoes ?? 0),
      pedidos: acc.pedidos + Number(item.pedidos ?? 0),
    }), { investimento: 0, receita: 0, clicks: 0, impressoes: 0, pedidos: 0 });
    const adsAnterior = anterior.trafego_pago.reduce((acc, item: any) => ({
      investimento: acc.investimento + Number(item.investimento ?? 0),
      receita: acc.receita + Number(item.receita ?? 0),
      clicks: acc.clicks + Number(item.clicks ?? 0),
      impressoes: acc.impressoes + Number(item.impressoes ?? 0),
      pedidos: acc.pedidos + Number(item.pedidos ?? 0),
    }), { investimento: 0, receita: 0, clicks: 0, impressoes: 0, pedidos: 0 });

    const roasAtual = adsAtual.investimento > 0 ? adsAtual.receita / adsAtual.investimento : 0;
    const roasAnterior = adsAnterior.investimento > 0 ? adsAnterior.receita / adsAnterior.investimento : 0;
    const participacaoAds = report.kpis.faturamento > 0 ? (adsAtual.receita / report.kpis.faturamento) * 100 : 0;
    const conversaoAdsAtual = adsAtual.clicks > 0 ? (adsAtual.pedidos / adsAtual.clicks) * 100 : 0;
    const conversaoAdsAnterior = adsAnterior.clicks > 0 ? (adsAnterior.pedidos / adsAnterior.clicks) * 100 : 0;

    const faturamentoVar = pctChange(report.kpis.faturamento, anterior.kpis.faturamento);
    const ticketVar = pctChange(report.kpis.ticket_medio, anterior.kpis.ticket_medio);
    const adsReceitaVar = pctChange(adsAtual.receita, adsAnterior.receita);
    const adsInvestVar = pctChange(adsAtual.investimento, adsAnterior.investimento);

    const diagnostico =
      faturamentoVar < -5 && adsReceitaVar >= 0
        ? "A queda parece mais ligada ao varejo organico/canais do que ao trafego pago, porque a receita atribuida de Ads nao caiu na mesma direcao."
        : faturamentoVar < -5 && adsReceitaVar < faturamentoVar
          ? "A queda tem forte sinal de pressao em trafego pago: a receita atribuida de Ads caiu mais que o faturamento total."
          : faturamentoVar > 5 && adsInvestVar <= 0
            ? "O crescimento veio com boa eficiencia, sem depender de aumento proporcional de investimento."
            : "O dia ficou relativamente alinhado ao padrao recente; a leitura principal deve focar mix de canais e eficiencia de Ads.";

    const recomendacao =
      maiorPerda && Math.abs(maiorPerda.diff) > Math.abs(report.kpis.faturamento * 0.1)
        ? `Prioridade: investigar ${maiorPerda.canal}, que sozinho explica ${formatCurrency(Math.abs(maiorPerda.diff))} de perda contra anteontem. Validar ruptura, preco, frete, buybox/anuncio e status dos SKUs campeoes antes de aumentar verba.`
        : roasAtual >= 8 && adsAtual.investimento > 0
          ? "Ha eficiencia em Ads. Se estoque e preco estiverem saudaveis, testar aumento gradual de verba nos conjuntos com ROAS alto, acompanhando ticket e pedidos a cada poucas horas."
          : "Evitar aumentar verba no escuro. Primeiro separar queda de demanda, ruptura e perda de competitividade por canal; depois redistribuir investimento para os canais com melhor resposta.";

    const periodo: Periodo = "diario";
    const data = ontem;
    const realizado = report.kpis.meta > 0 ? (report.kpis.faturamento / report.kpis.meta) * 100 : 0;
    const topCanal = [...report.canais].sort((a, b) => b.faturamento - a.faturamento)[0];
    const melhorVariacao = maiorGanho ? { canal: maiorGanho.canal, variacao: maiorGanho.variacao } : null;
    const piorVariacao = maiorPerda ? { canal: maiorPerda.canal, variacao: maiorPerda.variacao } : null;

    const texto = [
      `- Faturamento em ${formatCurrency(report.kpis.faturamento)}, equivalente a ${realizado.toFixed(1)}% da meta de ${formatCurrency(report.kpis.meta)}.`,
      `- Canal destaque: ${topCanal?.canal ?? "sem canal"} com ${formatCurrency(topCanal?.faturamento ?? 0)} e ${topCanal?.pedidos ?? 0} pedido(s).`,
      `- Melhor variação: ${melhorVariacao?.canal ?? "sem canal"} (${(melhorVariacao?.variacao ?? 0).toFixed(1)}%).`,
      `- Ponto de atenção: ${piorVariacao?.canal ?? "sem canal"} (${(piorVariacao?.variacao ?? 0).toFixed(1)}%).`,
      `- Tráfego pago: investimento de ${formatCurrency(report.kpis.investimento)} para receita atribuída de ${formatCurrency(report.kpis.receita_paga)} e ROAS ${report.kpis.roas.toFixed(2)}x.`,
    ].join("\n");

    const analise: AnaliseBot = {
      texto: [
        `- Base analisada: ontem (${ontem}) contra anteontem (${anteontem}).`,
        `- Receita total: ${formatCurrency(report.kpis.faturamento)} contra ${formatCurrency(anterior.kpis.faturamento)}, ${diffText(report.kpis.faturamento, anterior.kpis.faturamento, true)}. Pedidos tiveram ${diffText(report.kpis.pedidos, anterior.kpis.pedidos)} e ticket medio ficou em ${formatCurrency(report.kpis.ticket_medio)} (${formatPercent(ticketVar)}).`,
        `- Diagnostico: ${diagnostico}`,
        `- Canais que mais mexeram no resultado: ${maiorPerda?.canal ?? "sem canal"} foi o maior peso negativo (${formatCurrency(maiorPerda?.diff ?? 0)}, ${formatPercent(maiorPerda?.variacao ?? 0)}), enquanto ${maiorGanho?.canal ?? "sem canal"} foi o principal amortecedor/ganho (${formatCurrency(maiorGanho?.diff ?? 0)}, ${formatPercent(maiorGanho?.variacao ?? 0)}).`,
        `- Quedas por canal: ${canaisQueda.length ? canaisQueda.map((c) => `${c.canal} ${formatCurrency(c.diff)} (${formatPercent(c.variacao)}, pedidos ${c.pedidosDiff >= 0 ? "+" : ""}${c.pedidosDiff})`).join("; ") : "nenhum canal relevante em queda."}`,
        `- Altas por canal: ${canaisAlta.length ? canaisAlta.map((c) => `${c.canal} +${formatCurrency(c.diff)} (${formatPercent(c.variacao)}, pedidos ${c.pedidosDiff >= 0 ? "+" : ""}${c.pedidosDiff})`).join("; ") : "nenhum canal relevante em alta."}`,
        `- Ads: investimento ${formatCurrency(adsAtual.investimento)} (${formatPercent(adsInvestVar)}), receita atribuida ${formatCurrency(adsAtual.receita)} (${formatPercent(adsReceitaVar)}), ROAS ${roasAtual.toFixed(2)}x contra ${roasAnterior.toFixed(2)}x. Ads respondeu por ${formatPercent(participacaoAds)} do faturamento do dia.`,
        `- Funil de Ads: ${adsAtual.impressoes.toFixed(0)} impressoes, ${adsAtual.clicks.toFixed(0)} clicks e ${adsAtual.pedidos.toFixed(0)} pedidos; conversao estimada ${formatPercent(conversaoAdsAtual)} contra ${formatPercent(conversaoAdsAnterior)} no dia anterior.`,
        `- Acao recomendada: ${recomendacao}`,
      ].join("\n"),
      gerado_em: new Date().toISOString(),
      data_referencia: ontem,
      modelo: "comparativo_diario",
    };

    analisesMemoria.diario = analise;
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
