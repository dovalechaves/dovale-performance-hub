import { NextFunction, Request, Response, Router } from "express";
import { getPool } from "../db/sqlserver";
import { getShopeeAdsData } from "../services/shopee-ads.service";
import { getMlAdsRaw } from "../services/ml-ads.service";
import { getCanaisDiario, getCanaisMensal, getCanaisRaw, CanalResumo } from "../services/ecommerce-canais.service";

const router = Router();

const ALLOWED_USERS = (process.env.ECOMMERCE_DISPARO_ALLOWED_USERS ?? "henrique.berbert,andreza")
  .split(",")
  .map((u) => u.trim().toLowerCase())
  .filter(Boolean);

type Periodo = "diario" | "mensal";


function usuarioAutorizado(usuario: string): boolean {
  const normalized = usuario.trim().toLowerCase();
  if (!normalized) return false;
  return ALLOWED_USERS.some((allowed) => normalized === allowed || normalized.includes(allowed));
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

async function requireAccess(req: Request, res: Response, next: NextFunction) {
  const usuario = String(req.headers["x-dovale-usuario"] ?? req.query.usuario ?? "").trim();
  if (usuarioAutorizado(usuario)) return next();
  if (await isHubAdmin(usuario)) return next();
  return res.status(403).json({ erro: "Acesso permitido apenas para Henrique e Andreza." });
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

const canaisDiario: CanalResumo[] = [
  { canal: "Mercado Livre", faturamento: 68450.9, pedidos: 312, ticket_medio: 219.39, conversao: 3.8, margem: 21.4, variacao: 8.7 },
  { canal: "Shopee", faturamento: 24890.2, pedidos: 184, ticket_medio: 135.27, conversao: 2.9, margem: 17.8, variacao: -3.1 },
  { canal: "Amazon", faturamento: 18320.5, pedidos: 76, ticket_medio: 241.06, conversao: 2.4, margem: 19.2, variacao: 5.4 },
  { canal: "Site", faturamento: 42870.4, pedidos: 138, ticket_medio: 310.66, conversao: 4.6, margem: 26.1, variacao: 12.2 },
];

const canaisMensal: CanalResumo[] = [
  { canal: "Mercado Livre", faturamento: 1298400.8, pedidos: 5940, ticket_medio: 218.59, conversao: 3.6, margem: 21.2, variacao: 9.4 },
  { canal: "Shopee", faturamento: 486300.2, pedidos: 3680, ticket_medio: 132.15, conversao: 2.8, margem: 17.2, variacao: 1.8 },
  { canal: "Amazon", faturamento: 358900.7, pedidos: 1492, ticket_medio: 240.55, conversao: 2.3, margem: 18.8, variacao: 6.3 },
  { canal: "Site", faturamento: 821760.4, pedidos: 2655, ticket_medio: 309.51, conversao: 4.8, margem: 26.9, variacao: 14.1 },
];

const historico = [
  { id: 1, periodo: "diario", data_envio: "2026-05-12T08:05:00.000Z", destinatario: "Henrique Berbert", status: "SIMULADO" },
  { id: 2, periodo: "diario", data_envio: "2026-05-12T08:05:00.000Z", destinatario: "Andreza", status: "SIMULADO" },
  { id: 3, periodo: "mensal", data_envio: "2026-05-01T08:30:00.000Z", destinatario: "Henrique Berbert", status: "SIMULADO" },
  { id: 4, periodo: "mensal", data_envio: "2026-05-01T08:30:00.000Z", destinatario: "Andreza", status: "SIMULADO" },
];

async function getReport(periodo: Periodo, data?: string) {
  const canaisDb = periodo === "mensal" ? await getCanaisMensal() : await getCanaisDiario(data);
  const canais = canaisDb ?? (periodo === "mensal" ? canaisMensal : canaisDiario);
  const faturamento = canais.reduce((acc, c) => acc + c.faturamento, 0);
  const pedidos = canais.reduce((acc, c) => acc + c.pedidos, 0);
  const margemMedia = canais.reduce((acc, c) => acc + c.margem, 0) / canais.length;
  const conversaoMedia = canais.reduce((acc, c) => acc + c.conversao, 0) / canais.length;
  const ticketMedio = faturamento / pedidos;
  const meta = periodo === "mensal" ? 3200000 : 165000;

  const shopeeAds = await getShopeeAdsData(periodo);

  const shopeeInvestimento = shopeeAds.expense > 0 ? shopeeAds.expense : 0;
  const shopeeReceita     = shopeeAds.gmv > 0     ? shopeeAds.gmv     : 0;
  const shopeeRoas        = shopeeAds.roas > 0    ? shopeeAds.roas    : 0;
  const shopeeConversao   = shopeeAds.orders > 0 && shopeeAds.clicks > 0
    ? parseFloat(((shopeeAds.orders / shopeeAds.clicks) * 100).toFixed(2))
    : 0;

  const investimentoTotal = shopeeInvestimento;
  const receitaTotal      = shopeeReceita;
  const roasGeral         = investimentoTotal > 0 ? parseFloat((receitaTotal / investimentoTotal).toFixed(2)) : 0;

  return {
    periodo,
    gerado_em: new Date().toISOString(),
    fonte: shopeeAds.fonte === "api" ? "shopee_api" : "sem_dados_trafego",
    integracoes: {
      tray: "mockado",
      whatsapp: "simulado",
      shopee_ads: shopeeAds.fonte,
    },
    destinatarios: [
      { nome: "Henrique Berbert", telefone: process.env.ECOMMERCE_DISPARO_HENRIQUE ?? "+55 12 99999-0001" },
      { nome: "Andreza", telefone: process.env.ECOMMERCE_DISPARO_ANDREZA ?? "+55 12 99999-0002" },
    ],
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
      margem: margemMedia,
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
      { origem: "Mercado Livre Ads", investimento: null, receita: null, roas: null, conversao: null, fonte: "sem_permissao", status: "Sem permissão API - ML" },
    ],
    pontos_criticos: [
      "Shopee abaixo do ritmo esperado, com queda de margem e ticket menor.",
      "Site próprio lidera conversão e deve receber reforço em campanhas de remarketing.",
      "Mercado Livre mantém volume alto, mas exige atenção ao custo de frete por pedido.",
    ],
    direcionamentos: [
      "Redistribuir verba de campanhas com ROAS abaixo de 4,5 para Google Ads e Site.",
      "Revisar kits de maior giro na Shopee para recuperar margem sem reduzir volume.",
      "Priorizar estoque dos SKUs que puxam Site e Mercado Livre nas próximas 48h.",
    ],
  };
}

async function montarMensagem(periodo: Periodo): Promise<string> {
  const report = await getReport(periodo);
  const label = periodo === "mensal" ? "MENSAL" : "DIARIO";
  const topCanal = [...report.canais].sort((a, b) => b.faturamento - a.faturamento)[0];
  const canais = report.canais
    .map((c) => `- ${c.canal}: ${formatCurrency(c.faturamento)} | ${c.pedidos} pedidos | margem ${c.margem.toFixed(1)}%`)
    .join("\n");

  return [
    `Relatorio ${label} Ecommerce - Dovale`,
    "",
    `Faturamento: ${formatCurrency(report.kpis.faturamento)}`,
    `Pedidos: ${report.kpis.pedidos}`,
    `Ticket medio: ${formatCurrency(report.kpis.ticket_medio)}`,
    `Conversao: ${report.kpis.conversao.toFixed(1)}%`,
    `ROAS: ${report.kpis.roas.toFixed(2)}x`,
    `Margem: ${report.kpis.margem.toFixed(1)}%`,
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

router.use(requireAccess);

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

router.get("/teste-canais", async (_req, res) => {
  res.json(await getCanaisRaw());
});

router.post("/preview", async (req, res) => {
  const periodo = req.body?.periodo === "mensal" ? "mensal" : "diario";
  res.json({ periodo, mensagem: await montarMensagem(periodo), modo_simulacao: true });
});

router.post("/enviar", async (req, res) => {
  const periodo = req.body?.periodo === "mensal" ? "mensal" : "diario";
  const report = await getReport(periodo);
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
