import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { queryFirebird } from "../db/firebird";
import { getPool } from "../db/sqlserver";

const router = Router();
export default router;

// ═══════════════════════════════════════════════════════════════════════════
// Consulta de Produtos (uso no celular, em reuniões) — SOMENTE LEITURA.
//
// Para um produto mostra, por filial (SJC e MG): saldo, reservado e disponível
// (procedure CONSULTA_ESTOQUE do Microsys, somente Local de Estoque 1 = Almoxarifado; ignora ECOMMERCE/outros locais) e preço/custo das
// tabelas 1 (ATACADO PADRÃO) e 4 (DDF) — TABELAS_PRODUTOS.TBP_PRECO / TBP_CUSTO.
// O catálogo (pro_codigo) é o mesmo nas duas bases, então a busca roda nas duas
// e o resultado é unido por código.
// ═══════════════════════════════════════════════════════════════════════════

const JWT_SECRET = process.env.JWT_SECRET ?? "dovale-disparo-jwt-secret-2024";
const APP_KEY = "consultaprodutos";

const FILIAIS = [
  { key: "sjc" as const, nome: "SJC", filial: 1 },
  { key: "mg" as const, nome: "MG", filial: 7 },
];
const TABELAS = [
  { codigo: 1, chave: "atacado", nome: "ATACADO PADRÃO" },
  { codigo: 4, chave: "ddf", nome: "DDF" },
];
const LIMITE_PADRAO = 12;
const LIMITE_MAX = 50;

// Token válido + usuário com acesso ao app "consultaprodutos" (custo é dado sensível).
router.use(async (req: Request, res: Response, next) => {
  if (req.method === "OPTIONS") return next();
  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Bearer ")) return res.status(401).json({ erro: "Não autenticado" });
  let usuario = "";
  try {
    const payload = jwt.verify(auth.split(" ")[1], JWT_SECRET) as { usuario?: string };
    usuario = String(payload?.usuario ?? "").trim();
  } catch (e: any) {
    if (e.name === "TokenExpiredError") return res.status(401).json({ erro: "Sessão expirada" });
    return res.status(401).json({ erro: "Token inválido" });
  }
  if (!usuario) return res.status(401).json({ erro: "Token inválido" });
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input("usuario", usuario)
      .input("app", APP_KEY)
      .query(`SELECT TOP 1 ativo FROM dbo.USUARIOS_APPS WHERE LOWER(usuario) = LOWER(@usuario) AND app_key = @app`);
    const ativo = r.recordset[0]?.ativo;
    if (!(ativo === true || ativo === 1 || ativo === "1")) return res.status(403).json({ erro: "Sem acesso a este app" });
    next();
  } catch (e) {
    console.error("[consulta-produtos] erro ao validar permissão:", e);
    res.status(500).json({ erro: "Erro ao validar permissão" });
  }
});

// Mês/ano de hoje no fuso de São Paulo (o servidor pode estar em UTC).
const MESES_PADRAO = ["JANEIRO", "FEVEREIRO", "MAR_O", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"]; // "_" cobre o Ç de MARÇO
export function mesAtual(agora = new Date()) {
  const [ano, mes] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora).split("-").map(Number);
  const mm = String(mes).padStart(2, "0");
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return { ano, nomePadrao: MESES_PADRAO[mes - 1], primeiroDia: `${ano}-${mm}-01`, ultimoDia: `${ano}-${mm}-${String(ultimo).padStart(2, "0")}` };
}

const num = (v: unknown): number | null => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const txt = (v: unknown) => String(v ?? "").trim();

// ── Índice de produtos em memória ────────────────────────────────────────────
// Busca/autocomplete precisam responder a cada letra digitada; varrer ~25 mil produtos por
// LIKE '%x%' no Firebird levava 1–3 s. Mantemos código+descrição dos produtos ATIVOS das duas bases
// em memória (o catálogo é o mesmo nas duas) e renovamos a cada 15 min. Estoque e preço continuam
// sendo lidos ao vivo do Firebird — o índice serve só para ACHAR o produto.
interface ItemIndice { codigo: string; descricao: string; tipo: string; norm: string }
const INDICE_TTL = 15 * 60 * 1000;
let indice: { itens: ItemIndice[]; ts: number } | null = null;
let carregando: Promise<ItemIndice[]> | null = null;

// maiúsculas, sem acento, espaços colapsados ("MARÇO" e "MARCO" casam)
const normalizar = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
// ignora pontuação/asteriscos no começo ("  . CADEADO ..." conta como começando em CADEADO)
const semPrefixoSujo = (t: string) => t.replace(/^[^A-Z0-9]+/, "");
const escaparRegex = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function carregarIndice(): Promise<ItemIndice[]> {
  const porBase = await Promise.all(FILIAIS.map((f) =>
    queryFirebird<Record<string, unknown>>(f.key, `SELECT pro_codigo, pro_resumo, pro_tipo FROM produtos WHERE pro_situacao = 'A'`).catch(() => [])));
  const mapa = new Map<string, ItemIndice>();
  for (const rows of porBase) { // SJC primeiro: sua descrição é a exibida
    for (const r of rows) {
      const codigo = txt(r.PRO_CODIGO), descricao = txt(r.PRO_RESUMO);
      const atual = mapa.get(codigo);
      if (!atual) mapa.set(codigo, { codigo, descricao, tipo: txt(r.PRO_TIPO), norm: normalizar(descricao) });
      else if (descricao && normalizar(descricao) !== atual.norm) atual.norm += ` | ${normalizar(descricao)}`; // casa por qualquer das duas descrições
    }
  }
  const itens = [...mapa.values()];
  if (itens.length) indice = { itens, ts: Date.now() };
  return itens;
}

async function obterIndice(): Promise<ItemIndice[]> {
  if (indice && Date.now() - indice.ts < INDICE_TTL) return indice.itens;
  if (!carregando) carregando = carregarIndice().finally(() => { carregando = null; });
  // com índice velho disponível, responde com ele e renova em segundo plano
  if (indice) return indice.itens;
  return carregando;
}
setTimeout(() => { obterIndice().catch(() => {}); }, 3000).unref?.(); // aquece logo após subir

// Acha produtos pelo texto: todas as palavras precisam estar na descrição (ou o número ser o início do
// código). Ordem: código exato > código começa > descrição começa com o texto > palavras inteiras >
// demais; dentro de cada grupo, produtos acabados (PA/PR) antes dos de processo/matéria-prima,
// depois descrição mais curta e ordem alfabética.
export async function buscarNoIndice(q: string, limite: number): Promise<{ codigo: string; descricao: string }[]> {
  const itens = await obterIndice();
  const alvo = normalizar(q);
  const palavras = alvo.split(" ").filter(Boolean).slice(0, 6);
  if (!palavras.length) return [];
  const numerico = /^\d+$/.test(alvo);
  const re = palavras.map((w) => new RegExp("(^|[^A-Z0-9])" + escaparRegex(w)));
  const achados: { it: ItemIndice; grupo: number; fim: number }[] = [];
  for (const it of itens) {
    let grupo = -1;
    if (numerico && it.codigo === alvo) grupo = 0;
    else if (numerico && it.codigo.startsWith(alvo)) grupo = 1;
    else if (palavras.every((w) => it.norm.includes(w))) {
      const limpo = semPrefixoSujo(it.norm);
      grupo = limpo.startsWith(alvo) ? 2 : re.every((r) => r.test(it.norm)) ? 3 : 4;
    }
    if (grupo >= 0) achados.push({ it, grupo, fim: /^(PA|PR)$/.test(it.tipo) ? 0 : 1 });
  }
  // Digitou um código que existe: mostra SÓ esse produto (nada de códigos que apenas começam igual).
  const exato = achados.filter((a) => a.grupo === 0);
  if (exato.length) return exato.slice(0, limite).map((a) => ({ codigo: a.it.codigo, descricao: a.it.descricao }));
  achados.sort((x, y) =>
    x.grupo - y.grupo || x.fim - y.fim || x.it.descricao.length - y.it.descricao.length || x.it.descricao.localeCompare(y.it.descricao, "pt-BR"));
  return achados.slice(0, limite).map((a) => ({ codigo: a.it.codigo, descricao: a.it.descricao }));
}

// Limita quantas consultas ao Firebird rodam ao mesmo tempo: o mesmo servidor atende o ERP das lojas,
// então paraleliza (para ser rápido) mas sem exagero.
const MAX_CONCORRENTES = 6;
let emAndamento = 0;
const fila: (() => void)[] = [];
async function limitar<T>(fn: () => Promise<T>): Promise<T> {
  if (emAndamento >= MAX_CONCORRENTES) await new Promise<void>((ok) => fila.push(ok));
  emAndamento++;
  try { return await fn(); } finally { emAndamento--; fila.shift()?.(); }
}

// Tabela "PROMOÇÃO MENSAL" do MÊS ATUAL — regra estrita, todas as condições ao mesmo tempo:
//  - marcada como promoção (tab_ind_promocao=1) e ATIVA (tab_situacao=1);
//  - nome no padrão "PROMOÇÃO MENSAL <mês> <ano>" com o mês e o ano de HOJE (um mês antigo que tenha
//    ficado ativo por engano não casa);
//  - validade dentro do mês atual e ainda não vencida.
// Sem nenhuma tabela que satisfaça tudo, nenhum produto é mostrado como promoção. Se (anomalia)
// houver mais de uma, vale a de maior código. Resultado guardado 5 min (e descartado na virada de
// mês/dia), pois a tabela do mês quase nunca muda durante o dia.
type TabelaPromo = { codigo: number; nome: string; validade: string | null } | null;
const cachePromo = new Map<string, { chave: string; ts: number; valor: TabelaPromo }>();
const PROMO_TTL = 5 * 60 * 1000;

export async function tabelaPromocaoMes(loja: "sjc" | "mg"): Promise<TabelaPromo> {
  const mes = mesAtual();
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const chave = `${mes.primeiroDia}|${hoje}`;
  const c = cachePromo.get(loja);
  if (c && c.chave === chave && Date.now() - c.ts < PROMO_TTL) return c.valor;
  const rows = await queryFirebird<Record<string, unknown>>(loja, `
    SELECT tab_codigo, tab_nome, tab_dt_validade FROM tabelas_precos
    WHERE tab_ind_promocao = 1 AND tab_situacao = 1
      AND UPPER(tab_nome) LIKE 'PROMO%MENSAL%${mes.nomePadrao}%${mes.ano}%'
      AND tab_dt_validade >= CAST('${mes.primeiroDia}' AS DATE)
      AND tab_dt_validade <= CAST('${mes.ultimoDia}' AS DATE)
      AND tab_dt_validade >= CAST('NOW' AS DATE)
    ORDER BY tab_codigo DESC`);
  if (rows.length > 1) console.warn(`[consulta-produtos] ${loja}: ${rows.length} tabelas de promoção mensal ativas no mês; usando a de maior código`);
  const r = rows[0];
  const valor: TabelaPromo = r
    ? { codigo: Number(r.TAB_CODIGO), nome: txt(r.TAB_NOME), validade: r.TAB_DT_VALIDADE ? new Date(r.TAB_DT_VALIDADE as string).toISOString().slice(0, 10) : null }
    : null;
  cachePromo.set(loja, { chave, ts: Date.now(), valor });
  return valor;
}

// ── Estoque (saldo / empenhado / disponível) ───────────────────────────────────
// Referência: a procedure CONSULTA_ESTOQUE do Microsys (a mesma conta da tela dela). Ela é lenta
// (soma todo o histórico de movimentos do produto: 0,2–0,6 s por produto, pior no SJC), então a
// busca usa um CAMINHO RÁPIDO que reproduz a mesma conta com consultas diretas:
//   saldo       = soma de PRODUTOS_SALDOS no Local de Estoque 1
//   empenhado   = itens de pedido RESERVADOS (mesma consulta da procedure), do produto + derivados
//   disponível  = saldo − empenhado
// Validado contra a procedure em 240 produtos (52 com reserva) nas duas bases: 0 divergências.
// Trava de segurança: o caminho rápido só vale enquanto as configurações do ERP forem as validadas;
// se mudarem, volta sozinho para a procedure (exata, só que lenta).
type Estoque = { SALDO: unknown; RESERVA: unknown; DISPONIVEL: unknown };
const SEM_DATA_BASE = "CAST('1899-12-31' AS DATE)"; // "sem data-base": mesmo resultado de hoje, mais rápido

// -- fallback: a própria procedure, um produto por vez, em paralelo limitado
const cacheEstoque = new Map<string, { ts: number; valor: Estoque }>();
async function estoqueViaProcedure(loja: "sjc" | "mg", filial: number, codigo: string): Promise<Estoque> {
  const k = `${loja}:${codigo}`;
  const c = cacheEstoque.get(k);
  if (c && Date.now() - c.ts < 10_000) return c.valor;
  const rows = await limitar(() => queryFirebird<Estoque>(loja,
    `SELECT saldo, reserva, disponivel FROM CONSULTA_ESTOQUE(?, ${filial}, 1, 0, ${SEM_DATA_BASE})`, [codigo]));
  const valor = rows[0] ?? { SALDO: null, RESERVA: null, DISPONIVEL: null };
  cacheEstoque.set(k, { ts: Date.now(), valor });
  if (cacheEstoque.size > 500) cacheEstoque.delete(cacheEstoque.keys().next().value as string);
  return valor;
}

// -- configurações do ERP que a procedure consulta (lidas 1x a cada 10 min)
interface ConfigEstoque { rapido: boolean; consolidado: boolean }
const cacheConfig = new Map<string, { ts: number; valor: ConfigEstoque }>();
async function configEstoque(loja: "sjc" | "mg", filial: number): Promise<ConfigEstoque> {
  const k = `${loja}:${filial}`;
  const c = cacheConfig.get(k);
  if (c && Date.now() - c.ts < 10 * 60_000) return c.valor;
  const cfg = async (col: string, filtro: string) => {
    const r = await queryFirebird<Record<string, unknown>>(loja, `SELECT FIRST 1 COALESCE(${col}, 0) AS V FROM configuracao WHERE ${filtro} ORDER BY cfg_id`);
    return Number(r[0]?.V ?? 0);
  };
  const [consolidado, pleConsolidado, gerarReserva, previsto, fil] = await Promise.all([
    cfg("cfg_valor_bol", "cfg_parametro = 'PRO_ESTOQUE_CONSOLIDADO'"),
    cfg("cfg_valor_bol", "cfg_parametro = 'PRO_PLE_CONSOLIDADO'"),
    cfg("cfg_valor_int", "cfg_modulo = 'PEDIDOS_VENDAS' AND cfg_parametro = 'GERAR_ESTOQUE_RESERVA'"),
    cfg("cfg_valor_int", "cfg_modulo = 'PEDIDOS_COMPRAS' AND cfg_parametro = 'GERAR_ESTOQUE_PREVISTO'"),
    queryFirebird<Record<string, unknown>>(loja, `SELECT COALESCE(fil_estoque_pdv, 0) AS V FROM filiais WHERE fil_codigo = ${Number(filial)}`),
  ]);
  const valor: ConfigEstoque = {
    consolidado: consolidado === 1,
    rapido: pleConsolidado !== 1 && gerarReserva > 0 && previsto === 0 && fil.length === 1 && Number(fil[0].V) === 0,
  };
  if (!valor.rapido) console.warn(`[consulta-produtos] ${loja}: configuração do ERP fora do padrão validado; usando a procedure (mais lenta)`);
  cacheConfig.set(k, { ts: Date.now(), valor });
  return valor;
}

// -- empenho de TODOS os produtos numa consulta só (50–125 ms); vale 10 s para pedidos seguidos
const cacheReserva = new Map<string, { ts: number; p: Promise<Map<string, number>> }>();
function reservaBruta(loja: "sjc" | "mg", filial: number, consolidado: boolean): Promise<Map<string, number>> {
  const k = `${loja}:${filial}`;
  const c = cacheReserva.get(k);
  if (c && Date.now() - c.ts < 10_000) return c.p;
  const p = limitar(() => queryFirebird<Record<string, unknown>>(loja, `
    SELECT pvi.pvi_pro_codigo AS c, SUM(COALESCE(pvi.pvi_qtd_reservado, 0) * IIF(pdv.pdv_tipovenda = 1, -1, 1)) AS r
    FROM pedidos_vendas pdv
    JOIN pedidos_vendas_itens pvi ON pvi.emp_fil_codigo = pdv.emp_fil_codigo AND pvi.pvi_numero = pdv.pdv_numero
    JOIN pedidos_vendas_reserva pvr ON pdv.emp_fil_codigo = pvr.emp_fil_codigo AND pdv.pdv_numero = pvr.pvr_pdv_numero
    JOIN produtos ON produtos.pro_codigo = pvi.pvi_pro_codigo
    WHERE pvi.pvi_ple_codigo = 1 AND pvi.pvi_reservado = 'SIM'
      ${consolidado ? "" : `AND pvi.emp_fil_codigo = ${Number(filial)}`}
    GROUP BY pvi.pvi_pro_codigo`)).then((rows) => new Map(rows.map((r) => [txt(r.C), Number(r.R) || 0])));
  cacheReserva.set(k, { ts: Date.now(), p });
  p.catch(() => cacheReserva.delete(k));
  return p;
}

// -- produtos derivados: o empenho do produto mestre inclui o dos derivados (como na procedure)
const cacheDerivados = new Map<string, { ts: number; p: Promise<{ filhos: Map<string, string[]>; ehFilho: Set<string> }> }>();
function derivados(loja: "sjc" | "mg") {
  const c = cacheDerivados.get(loja);
  if (c && Date.now() - c.ts < 10 * 60_000) return c.p;
  const p = limitar(() => queryFirebird<Record<string, unknown>>(loja, `SELECT pro_codigo, pro_pro_mestre FROM produtos WHERE pro_pro_mestre > 0`)).then((rows) => {
    const filhos = new Map<string, string[]>(); const ehFilho = new Set<string>();
    for (const r of rows) {
      const f = txt(r.PRO_CODIGO), m = txt(r.PRO_PRO_MESTRE);
      ehFilho.add(f); filhos.set(m, [...(filhos.get(m) ?? []), f]);
    }
    return { filhos, ehFilho };
  });
  cacheDerivados.set(loja, { ts: Date.now(), p });
  p.catch(() => cacheDerivados.delete(loja));
  return p;
}

async function estoques(loja: "sjc" | "mg", filial: number, codigos: string[]): Promise<Map<string, Estoque>> {
  const cfg = await configEstoque(loja, filial).catch(() => ({ rapido: false, consolidado: true }));
  const out = new Map<string, Estoque>();
  if (!cfg.rapido) {
    const lista = await Promise.all(codigos.map((c) => estoqueViaProcedure(loja, filial, c).catch(() => ({ SALDO: null, RESERVA: null, DISPONIVEL: null }))));
    codigos.forEach((c, i) => out.set(c, lista[i]));
    return out;
  }
  const lista = codigos.map((c) => `'${c.replace(/[^0-9A-Za-z._-]/g, "")}'`).join(",");
  const [saldos, bruta, der] = await Promise.all([
    limitar(() => queryFirebird<Record<string, unknown>>(loja, `
      SELECT prs_pro_codigo AS c, SUM(prs_saldo) AS s FROM produtos_saldos
      WHERE prs_ple_codigo = 1 ${cfg.consolidado ? "" : `AND prs_fil_codigo = ${Number(filial)}`} AND prs_pro_codigo IN (${lista})
      GROUP BY prs_pro_codigo`)),
    reservaBruta(loja, filial, cfg.consolidado),
    derivados(loja),
  ]);
  const saldoDe = new Map(saldos.map((r) => [txt(r.C), Number(r.S) || 0]));
  for (const c of codigos) {
    // procedure: ABS(soma) por produto (o próprio, se não for derivado, + cada derivado), somados
    const reserva = (der.ehFilho.has(c) ? 0 : Math.abs(bruta.get(c) ?? 0)) + (der.filhos.get(c) ?? []).reduce((a, f) => a + Math.abs(bruta.get(f) ?? 0), 0);
    const saldo = saldoDe.get(c) ?? 0;
    out.set(c, { SALDO: saldo, RESERVA: reserva, DISPONIVEL: saldo - reserva });
  }
  return out;
}

export async function detalhes(loja: "sjc" | "mg", filial: number, codigos: string[]) {
  if (!codigos.length) return [];
  const lista = codigos.map((c) => `'${c.replace(/[^0-9A-Za-z._-]/g, "")}'`).join(",");
  const promo = await tabelaPromocaoMes(loja).catch(() => null);
  const joinPromo = promo
    ? `LEFT JOIN tabelas_produtos tpm ON tpm.tbp_pro_codigo = p.pro_codigo AND tpm.tbp_tab_codigo = ${promo.codigo} AND tpm.tbp_preco > 0`
    : "";
  // preços/custos de todos os produtos numa consulta só; estoque de cada produto em paralelo
  const [rows, estoquesPorCodigo] = await Promise.all([
    limitar(() => queryFirebird<Record<string, unknown>>(loja, `
      SELECT p.pro_codigo, p.pro_resumo, p.pro_tipo,
        t1.tbp_preco AS preco_1, t1.tbp_custo AS custo_1,
        t4.tbp_preco AS preco_4, t4.tbp_custo AS custo_4,
        ${promo ? "tpm.tbp_preco" : "CAST(NULL AS DOUBLE PRECISION)"} AS promo_preco
      FROM produtos p
      LEFT JOIN tabelas_produtos t1 ON t1.tbp_pro_codigo = p.pro_codigo AND t1.tbp_tab_codigo = 1
      LEFT JOIN tabelas_produtos t4 ON t4.tbp_pro_codigo = p.pro_codigo AND t4.tbp_tab_codigo = 4
      ${joinPromo}
      WHERE p.pro_codigo IN (${lista})`)),
    estoques(loja, filial, codigos),
  ]);
  return rows.map((r): Record<string, unknown> => ({
    ...r, ...(estoquesPorCodigo.get(txt(r.PRO_CODIGO)) ?? {}),
    PROMO_NOME: promo?.nome ?? null, PROMO_VALIDADE: promo?.validade ?? null,
  }));
}

/** GET /api/consulta-produtos/sugestoes?q=texto — até 8 sugestões (código + descrição) para o autocomplete */
router.get("/sugestoes", async (req: Request, res: Response) => {
  const q = txt(req.query.q).slice(0, 80);
  if (q.length < 2) return res.json({ sugestoes: [] });
  try {
    res.json({ sugestoes: await buscarNoIndice(q, 8) });
  } catch (e) {
    console.error("[consulta-produtos] erro nas sugestões:", e);
    res.status(500).json({ erro: "Erro ao buscar sugestões" });
  }
});

/** GET /api/consulta-produtos/buscar?q=texto-ou-codigo&limite=30  (ou ?codigo=123 para um produto exato) */
router.get("/buscar", async (req: Request, res: Response) => {
  const codigoExato = txt(req.query.codigo).replace(/[^0-9A-Za-z._-]/g, "").slice(0, 20);
  const q = txt(req.query.q).slice(0, 80);
  if (!codigoExato && q.length < 2) return res.status(400).json({ erro: "Digite ao menos 2 caracteres" });
  const limite = Math.min(Math.max(parseInt(String(req.query.limite ?? LIMITE_PADRAO), 10) || LIMITE_PADRAO, 1), LIMITE_MAX);

  try {
    // 1) códigos encontrados em cada base (união); 2) detalhes dos mesmos códigos nas duas.
    const codigos = codigoExato ? [codigoExato] : (await buscarNoIndice(q, limite)).map((x) => x.codigo);

    const status: Record<string, string> = {};
    const porBase = await Promise.all(FILIAIS.map(async (f) => {
      try { status[f.key] = "ok"; return await detalhes(f.key, f.filial, codigos); }
      catch (e) { status[f.key] = e instanceof Error ? e.message : "erro"; return []; }
    }));

    const mapa = new Map<string, any>();
    for (const c of codigos) mapa.set(c, { codigo: c, descricao: "", tipo: "", filiais: {} });
    FILIAIS.forEach((f, i) => {
      for (const r of porBase[i]) {
        const item = mapa.get(txt(r.PRO_CODIGO));
        if (!item) continue;
        if (!item.descricao) item.descricao = txt(r.PRO_RESUMO);
        if (!item.tipo) item.tipo = txt(r.PRO_TIPO);
        item.filiais[f.key] = {
          saldo: num(r.SALDO), reservado: num(r.RESERVA), disponivel: num(r.DISPONIVEL),
          tabelas: {
            atacado: { preco: num(r.PRECO_1), custo: num(r.CUSTO_1) },
            ddf: { preco: num(r.PRECO_4), custo: num(r.CUSTO_4) },
          },
          promocao: num(r.PROMO_PRECO) != null
            ? {
                nome: txt(r.PROMO_NOME),
                preco: num(r.PROMO_PRECO),
                validade: (r.PROMO_VALIDADE as string | null) ?? null,
              }
            : null,
        };
      }
    });

    res.json({
      filiais: FILIAIS.map((f) => ({ key: f.key, nome: f.nome })),
      tabelas: TABELAS,
      status,
      produtos: codigos.map((c) => mapa.get(c)).filter((p) => p.descricao),
    });
  } catch (e) {
    console.error("[consulta-produtos] erro na busca:", e);
    res.status(500).json({ erro: "Erro ao consultar os produtos" });
  }
});
