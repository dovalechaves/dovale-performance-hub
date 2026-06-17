import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import * as meta from "../services/meta-api";
import * as cw from "../services/chatwoot";
import { getSupa } from "../services/supabase";
import { obterCotacaoUsdBrl } from "../services/cambio";

const router = Router();
export default router;

const JWT_SECRET = process.env.JWT_SECRET ?? "dovale-disparo-jwt-secret-2024";

// ── Auth (mesmo esquema do app de Disparo: Bearer JWT) ───────────────────────
router.use((req: Request, res: Response, next) => {
  if (req.method === "OPTIONS") return next();
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

// ── Helpers ──────────────────────────────────────────────────────────────────

// "YYYY-MM" -> { start, end } em unix seconds (UTC). end = 1º dia do mês seguinte.
function periodoDoMes(mes: string): { start: number; end: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(mes);
  if (!m) return null;
  const ano = Number(m[1]);
  const mesIdx = Number(m[2]) - 1;
  if (mesIdx < 0 || mesIdx > 11) return null;
  const start = Math.floor(Date.UTC(ano, mesIdx, 1) / 1000);
  const end = Math.floor(Date.UTC(ano, mesIdx + 1, 1) / 1000);
  return { start, end };
}

async function mapaTemplateEtiqueta(): Promise<Record<string, string>> {
  const supa = getSupa();
  const { data } = await supa.from("template_configs").select("template_nome,etiqueta");
  const mapa: Record<string, string> = {};
  for (const r of data ?? []) {
    if (r.etiqueta) mapa[String(r.template_nome).toLowerCase()] = String(r.etiqueta);
  }
  return mapa;
}

// ── Relatório de custos por setor ────────────────────────────────────────────
router.get("/custos", async (req: Request, res: Response) => {
  try {
    const mes = String(req.query.mes ?? "");
    const periodoMes = periodoDoMes(mes);
    if (!periodoMes) return res.status(400).json({ erro: "Parâmetro 'mes' inválido (use YYYY-MM)" });

    // template_analytics da Meta só cobre os últimos 90 dias e não aceita fim no futuro.
    const nowSec = Math.floor(Date.now() / 1000);
    const start = periodoMes.start;
    const end = Math.min(periodoMes.end, nowSec);
    if (end <= start) {
      return res.status(400).json({ erro: "O mês selecionado ainda não começou." });
    }
    // verificar pelo start (não pelo end) — um mês pode ter start fora dos 90 dias mas end dentro
    if (start < nowSec - 90 * 24 * 3600) {
      return res.status(400).json({
        erro: "A Meta só disponibiliza o custo por template dos últimos 90 dias. Selecione um mês mais recente.",
      });
    }
    const periodo = { start, end };

    // 1) Templates ativos + deletados (em paralelo) para cobrir custos de templates excluídos
    const [tpl, tplDeletados] = await Promise.all([
      meta.obterTemplates(),
      meta.obterTemplates(undefined, undefined, "DELETED"),
    ]);
    if (!tpl.data) return res.status(502).json({ erro: tpl.error || "Falha ao buscar templates na Meta" });

    const nomePorId = new Map<string, string>();
    // Deletados primeiro (menor prioridade) — ativos sobrescrevem
    for (const t of tplDeletados.data?.data ?? []) nomePorId.set(String(t.id), String(t.name));
    for (const t of tpl.data.data ?? []) nomePorId.set(String(t.id), String(t.name));

    const todosIds = [...nomePorId.keys()].filter(Boolean);
    console.log(`[relatorio-custos] templates: ${tpl.data.data?.length ?? 0} ativos, ${tplDeletados.data?.data?.length ?? 0} deletados → ${todosIds.length} IDs para analytics`);

    // 2) Custo/volume por template no período (inclui deletados via IDs salvos)
    const analytics = await meta.obterTemplateAnalytics(todosIds, periodo.start, periodo.end);
    if (analytics.error) return res.status(400).json({ erro: analytics.error });

    // 3) De-para template -> setor
    const mapaEtiqueta = await mapaTemplateEtiqueta();

    // 4) Agrupa por setor (só templates mapeados, com algum envio ou custo)
    type LinhaTemplate = { template: string; volume: number; custoUsd: number };
    const setores = new Map<string, { setor: string; volume: number; custoUsd: number; templates: LinhaTemplate[] }>();

    let custoNaoMapeadoUsd = 0;
    let volumeNaoMapeado = 0;
    const templatesNaoMapeados: string[] = [];

    for (const [id, info] of analytics.data) {
      if (info.sent <= 0 && info.cost <= 0) continue;
      const nome = nomePorId.get(id) ?? id;
      const setor = mapaEtiqueta[nome.toLowerCase()];
      if (!setor) {
        custoNaoMapeadoUsd += info.cost;
        volumeNaoMapeado += info.sent;
        if (info.cost > 0) templatesNaoMapeados.push(nome);
        continue;
      }
      const grupo = setores.get(setor) ?? { setor, volume: 0, custoUsd: 0, templates: [] };
      grupo.volume += info.sent;
      grupo.custoUsd += info.cost;
      grupo.templates.push({ template: nome, volume: info.sent, custoUsd: info.cost });
      setores.set(setor, grupo);
    }

    // 5) Câmbio + montagem final
    const { rate, fonte } = await obterCotacaoUsdBrl();
    const lista = [...setores.values()]
      .map((g) => ({
        ...g,
        custoBrl: g.custoUsd * rate,
        templates: g.templates
          .sort((a, b) => b.custoUsd - a.custoUsd)
          .map((t) => ({ ...t, custoBrl: t.custoUsd * rate })),
      }))
      .sort((a, b) => b.custoUsd - a.custoUsd);

    const totalUsd = lista.reduce((s, g) => s + g.custoUsd, 0);
    const totalVolume = lista.reduce((s, g) => s + g.volume, 0);

    res.json({
      mes,
      periodo,
      cambio: { rate, fonte },
      totalUsd,
      totalBrl: totalUsd * rate,
      totalVolume,
      setores: lista,
      naoMapeado: {
        custoUsd: custoNaoMapeadoUsd,
        custoBrl: custoNaoMapeadoUsd * rate,
        volume: volumeNaoMapeado,
        templates: templatesNaoMapeados,
      },
    });
  } catch (e: any) {
    console.error("[relatorio-custos] /custos erro:", e);
    res.status(500).json({ erro: e.message || "Erro interno" });
  }
});

// ── De-Para: lista templates + etiqueta atual + etiquetas válidas do Chatwoot ─
router.get("/de-para", async (_req: Request, res: Response) => {
  try {
    const tpl = await meta.obterTemplates();
    if (!tpl.data) return res.status(502).json({ erro: tpl.error || "Falha ao buscar templates na Meta" });

    const mapaEtiqueta = await mapaTemplateEtiqueta();
    const etiquetas = await cw.listarEtiquetasChatwoot();
    const setValidas = new Set(etiquetas.map((e) => e.toLowerCase()));

    const templates = (tpl.data.data ?? [])
      .map((t: any) => {
        const etiqueta = mapaEtiqueta[String(t.name).toLowerCase()] ?? "";
        return {
          id: String(t.id),
          name: String(t.name),
          status: t.status ?? "",
          category: t.category ?? "",
          etiqueta,
          etiquetaValida: etiqueta ? setValidas.has(etiqueta.toLowerCase()) : false,
        };
      })
      .sort((a: any, b: any) => a.name.localeCompare(b.name));

    res.json({ templates, etiquetas });
  } catch (e: any) {
    console.error("[relatorio-custos] /de-para erro:", e);
    res.status(500).json({ erro: e.message || "Erro interno" });
  }
});

// ── De-Para: salvar/atualizar setor de um template ───────────────────────────
router.post("/de-para", async (req: Request, res: Response) => {
  try {
    const template_nome = String(req.body?.template_nome ?? "").trim();
    const etiqueta = String(req.body?.etiqueta ?? "").trim();
    if (!template_nome) return res.status(400).json({ erro: "template_nome obrigatório" });

    const supa = getSupa();
    const { error } = await supa.from("template_configs").upsert(
      {
        template_nome: template_nome.toLowerCase(),
        etiqueta: etiqueta || null,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "template_nome" },
    );
    if (error) throw error;
    res.json({ ok: true });
  } catch (e: any) {
    console.error("[relatorio-custos] POST /de-para erro:", e);
    res.status(500).json({ erro: e.message || "Erro interno" });
  }
});
