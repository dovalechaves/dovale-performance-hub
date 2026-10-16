/* eslint-disable @typescript-eslint/no-explicit-any */
// Painel de Comissões — setor E-COMMERCE. Montado em /api/comissao/ecommerce (ver server/index.ts).
// Regras de cálculo em services/comissao/commission-ecommerce.ts; dados em services/comissao/ecommerce.ts.
import { Router } from "express";
import sql from "mssql";
import { getPool } from "../db/sqlserver";
import { getComissaoUsuario, podeVerTudo, type ComissaoUsuario } from "../services/comissao/permissions";
import { ensureEcommerceTables } from "../services/comissao/ecommerce-tables";
import { getEcommerceMes, getEcommerceSerieAno } from "../services/comissao/ecommerce";
import {
  calcularComissaoEcommerce, FAIXAS_BONUS_PADRAO, PERCENTUAL_SEM_META_PADRAO,
  type EcomMeta, type EcomFaixa,
} from "../services/comissao/commission-ecommerce";

const router = Router();
const SETOR = "ECOMMERCE";

function getActor(req: any): string {
  return String(req.header("x-dovale-usuario") || "").trim();
}

function normalizar(nome: unknown): string {
  return String(nome || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}

// "Andreza" casa com "ANDREZA" e com "ANDREZA SILVA" (palavra inteira), nunca por pedaço de palavra.
function nomesCasam(a: unknown, b: unknown): boolean {
  const x = normalizar(a), y = normalizar(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const dentro = (menor: string, maior: string) =>
    menor.length >= 3 && new RegExp(`(^|\\s)${menor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\s)`).test(maior);
  return dentro(x, y) || dentro(y, x);
}

interface Vendedora { nome: string; ativo: boolean }

async function getVendedoras(): Promise<Vendedora[]> {
  const pool = await getPool();
  const r = await pool.request().query(`SELECT NOME, ATIVO FROM [TI-PAINELCOMISSAO_ECOMMERCE_VENDEDORAS] ORDER BY NOME`);
  return r.recordset.map((x: any) => ({ nome: String(x.NOME).trim(), ativo: x.ATIVO === true || x.ATIVO === 1 }));
}

interface Acesso {
  permitido: boolean;
  papel: "ADM" | "GESTOR" | "VENDEDORA" | null;
  vendedora: string | null;
  podeConfigurar: boolean;
}

function resolverAcesso(usuario: ComissaoUsuario, vendedoras: Vendedora[]): Acesso {
  if (podeVerTudo(usuario.cargo)) return { permitido: true, papel: "ADM", vendedora: null, podeConfigurar: true };
  if (usuario.cargo === "GESTOR") {
    const ok = usuario.setores.map(normalizar).includes(SETOR);
    return { permitido: ok, papel: ok ? "GESTOR" : null, vendedora: null, podeConfigurar: ok };
  }
  const minha = vendedoras.find((v) => v.ativo && nomesCasam(v.nome, usuario.nome_vendedor));
  return { permitido: !!minha, papel: minha ? "VENDEDORA" : null, vendedora: minha?.nome ?? null, podeConfigurar: false };
}

// Autentica, garante as tabelas e resolve o acesso. Responde 401/403 e retorna null quando não pode seguir.
async function autorizar(req: any, res: any, exigirConfig = false) {
  const actor = getActor(req);
  if (!actor) { res.status(401).json({ error: "Não autenticado" }); return null; }
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) { res.status(403).json({ error: "Sem permissão" }); return null; }
  await ensureEcommerceTables();
  const vendedoras = await getVendedoras();
  const acesso = resolverAcesso(usuario, vendedoras);
  if (!acesso.permitido || (exigirConfig && !acesso.podeConfigurar)) {
    res.status(403).json({ error: "Sem permissão para o setor E-commerce" });
    return null;
  }
  return { usuario, vendedoras, acesso };
}

function anoMes(req: any, fonte: any = req.query) {
  const hoje = new Date();
  const ano = parseInt(String(fonte.ano ?? hoje.getFullYear()), 10);
  const mes = parseInt(String(fonte.mes ?? hoje.getMonth() + 1), 10);
  if (!Number.isInteger(ano) || ano < 2020 || ano > 2100 || !Number.isInteger(mes) || mes < 1 || mes > 12) return null;
  return { ano, mes };
}

async function carregarConfig(ano: number, mes: number) {
  const pool = await getPool();
  const metaRes = await pool.request().input("ano", sql.Int, ano).input("mes", sql.Int, mes).query(`
    SELECT TOP 1 META1_VALOR AS meta1_valor, META1_PERCENTUAL AS meta1_percentual,
           META2_VALOR AS meta2_valor, META2_PERCENTUAL AS meta2_percentual,
           META3_VALOR AS meta3_valor, META3_PERCENTUAL AS meta3_percentual,
           PERCENTUAL_SEM_META AS percentual_sem_meta
    FROM [TI-PAINELCOMISSAO_ECOMMERCE_METAS] WHERE ANO = @ano AND MES = @mes ORDER BY ID DESC`);
  const m = metaRes.recordset[0];
  const meta: EcomMeta | null = m ? {
    meta1_valor: m.meta1_valor ?? 0, meta1_percentual: m.meta1_percentual ?? 0,
    meta2_valor: m.meta2_valor ?? 0, meta2_percentual: m.meta2_percentual ?? 0,
    meta3_valor: m.meta3_valor ?? 0, meta3_percentual: m.meta3_percentual ?? 0,
    percentual_sem_meta: m.percentual_sem_meta ?? PERCENTUAL_SEM_META_PADRAO,
  } : null;

  // Faixas do mês; se o mês não tem, herda as do mês mais recente anterior que tenha; senão, as padrão.
  const ref = ano * 100 + mes;
  const orig = await pool.request().input("ref", sql.Int, ref).query(`
    SELECT TOP 1 ANO, MES FROM [TI-PAINELCOMISSAO_ECOMMERCE_BONUS_FAIXAS]
    WHERE ANO * 100 + MES <= @ref GROUP BY ANO, MES ORDER BY ANO DESC, MES DESC`);
  let faixas: EcomFaixa[] = FAIXAS_BONUS_PADRAO;
  let faixas_origem: { ano: number; mes: number } | "padrao" = "padrao";
  if (orig.recordset[0]) {
    const { ANO, MES } = orig.recordset[0];
    const fr = await pool.request().input("a", sql.Int, ANO).input("m", sql.Int, MES).query(`
      SELECT CRESC_MIN AS cresc_min, VALOR AS valor FROM [TI-PAINELCOMISSAO_ECOMMERCE_BONUS_FAIXAS]
      WHERE ANO = @a AND MES = @m ORDER BY CRESC_MIN`);
    faixas = fr.recordset.map((x: any) => ({ cresc_min: Number(x.cresc_min), valor: Number(x.valor) }));
    faixas_origem = { ano: ANO, mes: MES };
  }
  return { meta, faixas, faixas_origem };
}

// GET /acesso — o front usa para decidir se mostra as telas do e-commerce
router.get("/acesso", async (req: any, res: any) => {
  try {
    const ctx = await autorizarSemBloqueio(req, res);
    if (!ctx) return;
    res.set("Cache-Control", "private, max-age=60");
    const vendedoras = !ctx.acesso.permitido ? []
      : ctx.acesso.papel === "VENDEDORA" ? [ctx.acesso.vendedora as string]
      : ctx.vendedoras.filter((v) => v.ativo).map((v) => v.nome);
    return res.json({ ecommerce: ctx.acesso.permitido, papel: ctx.acesso.papel, vendedora: ctx.acesso.vendedora, pode_configurar: ctx.acesso.podeConfigurar, vendedoras });
  } catch (e) {
    console.error("[ecommerce/acesso]", e);
    return res.status(500).json({ error: "Erro ao verificar acesso" });
  }
});

async function autorizarSemBloqueio(req: any, res: any) {
  const actor = getActor(req);
  if (!actor) { res.status(401).json({ error: "Não autenticado" }); return null; }
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) { res.status(403).json({ error: "Sem permissão" }); return null; }
  await ensureEcommerceTables();
  const vendedoras = await getVendedoras();
  return { usuario, vendedoras, acesso: resolverAcesso(usuario, vendedoras) };
}

// GET /resumo?ano=&mes= — faturamento, filiais, plataformas, comissão e bônus
router.get("/resumo", async (req: any, res: any) => {
  try {
    const ctx = await autorizar(req, res);
    if (!ctx) return;
    const p = anoMes(req);
    if (!p) return res.status(400).json({ error: "ano/mes inválidos" });

    const [cfg, dados, serie] = await Promise.all([
      carregarConfig(p.ano, p.mes), getEcommerceMes(p.ano, p.mes), getEcommerceSerieAno(p.ano),
    ]);
    const ativas = ctx.vendedoras.filter((v) => v.ativo);
    const comissao = calcularComissaoEcommerce(dados.total, cfg.meta, dados.por_plataforma, cfg.faixas, ativas.length);

    res.set("Cache-Control", "private, max-age=30");
    return res.json({
      ano: p.ano, mes: p.mes,
      acesso: { papel: ctx.acesso.papel, vendedora: ctx.acesso.vendedora, pode_configurar: ctx.acesso.podeConfigurar },
      dados, serie,
      config: { meta: cfg.meta, faixas: cfg.faixas, faixas_origem: cfg.faixas_origem, percentual_sem_meta_padrao: PERCENTUAL_SEM_META_PADRAO },
      comissao,
      vendedoras: ativas.map((v) => ({ nome: v.nome, comissao: comissao.comissao_por_vendedora })),
      minha_comissao: ctx.acesso.vendedora ? comissao.comissao_por_vendedora : null,
    });
  } catch (e) {
    console.error("[ecommerce/resumo]", e);
    return res.status(500).json({ error: "Erro ao buscar dados do e-commerce" });
  }
});

// GET /config?ano=&mes= — o que o gestor edita (metas, faixas de bônus, vendedoras)
router.get("/config", async (req: any, res: any) => {
  try {
    const ctx = await autorizar(req, res, true);
    if (!ctx) return;
    const p = anoMes(req);
    if (!p) return res.status(400).json({ error: "ano/mes inválidos" });
    const [cfg, dados] = await Promise.all([carregarConfig(p.ano, p.mes), getEcommerceMes(p.ano, p.mes)]);
    res.set("Cache-Control", "private, no-store");
    return res.json({ ...cfg, vendedoras: ctx.vendedoras, plataformas: dados.por_plataforma, percentual_sem_meta_padrao: PERCENTUAL_SEM_META_PADRAO });
  } catch (e) {
    console.error("[ecommerce/config GET]", e);
    return res.status(500).json({ error: "Erro ao buscar configuração" });
  }
});

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : NaN; };

router.put("/metas", async (req: any, res: any) => {
  try {
    const ctx = await autorizar(req, res, true);
    if (!ctx) return;
    const b = req.body ?? {};
    const p = anoMes(req, b);
    if (!p) return res.status(400).json({ error: "ano/mes inválidos" });
    const campos = ["meta1_valor", "meta1_percentual", "meta2_valor", "meta2_percentual", "meta3_valor", "meta3_percentual", "percentual_sem_meta"];
    const v: Record<string, number> = {};
    for (const c of campos) {
      v[c] = num(b[c] ?? 0);
      if (Number.isNaN(v[c])) return res.status(400).json({ error: `Valor inválido em ${c}` });
    }
    if ([v.meta1_percentual, v.meta2_percentual, v.meta3_percentual, v.percentual_sem_meta].some((x) => x > 100)) {
      return res.status(400).json({ error: "Percentual não pode passar de 100" });
    }
    const pool = await getPool();
    await pool.request()
      .input("ano", sql.Int, p.ano).input("mes", sql.Int, p.mes)
      .input("m1v", sql.Float, v.meta1_valor).input("m1p", sql.Float, v.meta1_percentual)
      .input("m2v", sql.Float, v.meta2_valor).input("m2p", sql.Float, v.meta2_percentual)
      .input("m3v", sql.Float, v.meta3_valor).input("m3p", sql.Float, v.meta3_percentual)
      .input("psm", sql.Float, v.percentual_sem_meta)
      .query(`
        MERGE [TI-PAINELCOMISSAO_ECOMMERCE_METAS] AS t
        USING (SELECT @ano AS A, @mes AS M) AS s ON t.ANO = s.A AND t.MES = s.M
        WHEN MATCHED THEN UPDATE SET META1_VALOR=@m1v, META1_PERCENTUAL=@m1p, META2_VALOR=@m2v, META2_PERCENTUAL=@m2p,
                                     META3_VALOR=@m3v, META3_PERCENTUAL=@m3p, PERCENTUAL_SEM_META=@psm
        WHEN NOT MATCHED THEN INSERT (ANO, MES, META1_VALOR, META1_PERCENTUAL, META2_VALOR, META2_PERCENTUAL, META3_VALOR, META3_PERCENTUAL, PERCENTUAL_SEM_META)
        VALUES (@ano, @mes, @m1v, @m1p, @m2v, @m2p, @m3v, @m3p, @psm);`);
    return res.json({ ok: true });
  } catch (e) {
    console.error("[ecommerce/metas PUT]", e);
    return res.status(500).json({ error: "Erro ao salvar metas" });
  }
});

router.put("/bonus-faixas", async (req: any, res: any) => {
  try {
    const ctx = await autorizar(req, res, true);
    if (!ctx) return;
    const b = req.body ?? {};
    const p = anoMes(req, b);
    if (!p) return res.status(400).json({ error: "ano/mes inválidos" });
    const lista: Array<{ cresc_min: number; valor: number }> = Array.isArray(b.faixas) ? b.faixas : [];
    if (!lista.length || lista.length > 12) return res.status(400).json({ error: "Informe de 1 a 12 faixas" });
    const faixas = lista.map((f) => ({ cresc_min: num(f.cresc_min), valor: num(f.valor) }));
    if (faixas.some((f) => Number.isNaN(f.cresc_min) || Number.isNaN(f.valor))) return res.status(400).json({ error: "Faixa com valor inválido" });
    if (new Set(faixas.map((f) => f.cresc_min)).size !== faixas.length) return res.status(400).json({ error: "Há faixas com o mesmo crescimento mínimo" });

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx).input("a", sql.Int, p.ano).input("m", sql.Int, p.mes)
        .query(`DELETE FROM [TI-PAINELCOMISSAO_ECOMMERCE_BONUS_FAIXAS] WHERE ANO = @a AND MES = @m`);
      for (const f of faixas) {
        await new sql.Request(tx).input("a", sql.Int, p.ano).input("m", sql.Int, p.mes)
          .input("c", sql.Float, f.cresc_min).input("v", sql.Float, f.valor)
          .query(`INSERT INTO [TI-PAINELCOMISSAO_ECOMMERCE_BONUS_FAIXAS] (ANO, MES, CRESC_MIN, VALOR) VALUES (@a, @m, @c, @v)`);
      }
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error("[ecommerce/bonus-faixas PUT]", e);
    return res.status(500).json({ error: "Erro ao salvar faixas de bônus" });
  }
});

router.put("/vendedoras", async (req: any, res: any) => {
  try {
    const ctx = await autorizar(req, res, true);
    if (!ctx) return;
    const lista: Vendedora[] = (Array.isArray(req.body) ? req.body : [])
      .map((v: any) => ({ nome: normalizar(v?.nome), ativo: v?.ativo !== false }))
      .filter((v: Vendedora) => v.nome);
    if (!lista.some((v) => v.ativo)) return res.status(400).json({ error: "Mantenha ao menos uma vendedora ativa" });
    if (new Set(lista.map((v) => v.nome)).size !== lista.length) return res.status(400).json({ error: "Nome de vendedora repetido" });

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx).query(`DELETE FROM [TI-PAINELCOMISSAO_ECOMMERCE_VENDEDORAS]`);
      for (const v of lista) {
        await new sql.Request(tx).input("n", sql.VarChar, v.nome).input("a", sql.Bit, v.ativo ? 1 : 0)
          .query(`INSERT INTO [TI-PAINELCOMISSAO_ECOMMERCE_VENDEDORAS] (NOME, ATIVO) VALUES (@n, @a)`);
      }
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error("[ecommerce/vendedoras PUT]", e);
    return res.status(500).json({ error: "Erro ao salvar vendedoras" });
  }
});

export default router;
