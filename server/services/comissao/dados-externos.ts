import { queryFirebird } from './firebird';
import { queryMySQL } from './mysql-ext';
import { getPool } from '../../db/sqlserver';
import sql from 'mssql';
import { fbSJC, fbSPM, fbLockeyMG, fbLockey, fbLockeyRJ, fbLockeyBH, myLockeyRS, myNiteroi } from './db-externas';
import { SETORES_ATIVOS } from './setores';
import { ensureDistTables } from './distribuidores-tables';

// ─── Tipos normalizados (mesmos nomes de coluna do SQL Server) ───────────────

export interface VendaRow {
  EMP: string;
  PDV_DATA: Date;
  ETA_DESCRICAO: string | null;
  USU_NOME: string | null;
  GRUPO: string | null;
  SUBGRUPO: string | null;
  FAMILIA: string | null;
  QTDE: number;
  RVS_NOME: string | null;
  SUM: number;
}

export interface RecebRow {
  EMP: string;
  REP_NOME: string | null;
  TOTAL: number;
  DATABAIXA: Date | null;
}

// ─── Cache em memória (5 min por ano) ────────────────────────────────────────

const TTL = 15 * 60 * 1000;
const _cv = new Map<number, { rows: VendaRow[]; ts: number }>();
const _cr = new Map<number, { rows: RecebRow[]; ts: number }>();
// In-flight deduplication: evita múltiplas queries simultâneas para o mesmo ano
const _inFlightV = new Map<number, Promise<VendaRow[]>>();
const _inFlightR = new Map<number, Promise<RecebRow[]>>();

// ─── Queries Firebird (por ano) ───────────────────────────────────────────────

function fbVendas(emp: string, ano: number) {
  return `
    select '${emp}' as emp,ped.pdv_data, ea.eta_descricao, r.rep_nome usu_nome,g.nome grupo,
    pn.nome subgrupo, pg.nome as familia ,sum(i.pvi_quantidade) qtde, rs.rvs_nome,
    (SUM((COALESCE(i.PVI_TOTALITEM,0)+COALESCE(i.PVI_SUBSTICMS,0)+
    COALESCE(i.pvi_vl_fcp_st,0)+COALESCE(i.PVI_IPIVALOR,0)))) as total
    from pedidos_vendas ped
    inner join pedidos_vendas_itens i on i.pvi_numero = ped.pdv_numero
    inner join produtos p on p.pro_codigo = i.pvi_pro_codigo
    inner join clientes c on c.cli_codigo = ped.pdv_cli_codigo
    inner join filiais f on f.fil_codigo = ped.emp_fil_codigo
    left join entidades_atividades ea on ea.eta_codigo = c.cli_eta_codigo
    left join representantes r on r.rep_codigo = ped.pdv_rep_codigo
    inner join representantes_supervisores rs on rs.rvs_codigo = r.rep_rvs_codigo
    left join produtos_nivel2 pn on pn.codigo = p.pro_nivel2
    left join produtos_nivel1 g on g.codigo = p.pro_nivel1
    left join produtos_nivel3 pg on pg.codigo = p.pro_nivel3
    where ped.pdv_data >= CAST('${ano}-01-01' AS DATE)
    and ped.pdv_data < CAST('${ano + 1}-01-01' AS DATE)
    and ped.pdv_psi_codigo not in ('CC')
    and ped.pdv_tve_codigo not in ('6','7','26','34')
    and c.cli_codigo not in ('44274','98030','49268')
    group by emp,ped.pdv_data, ea.eta_descricao, usu_nome,grupo, pn.nome, familia, rs.rvs_nome
  `;
}

function fbVendasLockey(ano: number) {
  return `
    select CASE WHEN ped.emp_fil_codigo='11' THEN 'Lockey SP'
                WHEN ped.emp_fil_codigo='12' THEN 'FAST' END as emp,
    ped.pdv_data, ea.eta_descricao, r.rep_nome usu_nome,g.nome grupo,
    pn.nome subgrupo, pg.nome as familia ,sum(i.pvi_quantidade) qtde, rs.rvs_nome,
    (SUM((COALESCE(i.PVI_TOTALITEM,0)+COALESCE(i.PVI_SUBSTICMS,0)+
    COALESCE(i.pvi_vl_fcp_st,0)+COALESCE(i.PVI_IPIVALOR,0)))) as total
    from pedidos_vendas ped
    inner join pedidos_vendas_itens i on i.pvi_numero = ped.pdv_numero
    inner join produtos p on p.pro_codigo = i.pvi_pro_codigo
    inner join clientes c on c.cli_codigo = ped.pdv_cli_codigo
    inner join filiais f on f.fil_codigo = ped.emp_fil_codigo
    left join entidades_atividades ea on ea.eta_codigo = c.cli_eta_codigo
    left join representantes r on r.rep_codigo = ped.pdv_rep_codigo
    inner join representantes_supervisores rs on rs.rvs_codigo = r.rep_rvs_codigo
    left join produtos_nivel2 pn on pn.codigo = p.pro_nivel2
    left join produtos_nivel1 g on g.codigo = p.pro_nivel1
    left join produtos_nivel3 pg on pg.codigo = p.pro_nivel3
    where ped.pdv_data >= CAST('${ano}-01-01' AS DATE)
    and ped.pdv_data < CAST('${ano + 1}-01-01' AS DATE)
    and ped.pdv_psi_codigo not in ('CC')
    and ped.pdv_tve_codigo not in ('6','7','26','34')
    and c.cli_codigo not in ('44274','98030','49268')
    and ped.emp_fil_codigo in ('11','12')
    group by emp,ped.pdv_data, ea.eta_descricao, usu_nome,grupo, pn.nome, familia, rs.rvs_nome
  `;
}

function fbReceb(emp: string, ano: number) {
  return `
    select '${emp}' as emp, r.rec_numero, b.rbx_dataliberacao as rec_data, r.rec_pedido,
    r.rec_vencimento, r.rec_valorpago,rep.rep_nome,
    c.cli_nome ,e.eta_descricao ,b.rbx_datapagamento as databaixa,rep.rep_obs1,
    sum(b.rbx_valorbasecomissao) as total
    from receber_titulos r
    inner join receber_baixas b on b.rbx_rec_id = r.rec_id
    inner join representantes rep on rep.rep_codigo = r.rec_rep_codigo
    inner join clientes c on c.cli_codigo = r.rec_cli_codigo
    left join entidades_atividades e on e.eta_codigo = c.cli_eta_codigo
    where b.rbx_datapagamento >= CAST('${ano}-01-01' AS DATE)
    and b.rbx_datapagamento < CAST('${ano + 1}-01-01' AS DATE)
    and b.rbx_valorbasecomissao > 0
    group by emp, r.rec_numero, rec_data, r.rec_pedido, r.rec_vencimento, r.rec_valorpago,
    rep.rep_nome, e.eta_descricao ,c.cli_nome,b.rbx_datapagamento, rep.rep_obs1
  `;
}

function fbRecebLockey(ano: number) {
  return `
    select CASE WHEN r.rec_fil_codigo='11' THEN 'LOCKEY SP'
                WHEN r.rec_fil_codigo='12' THEN 'FAST' END as emp,
    r.rec_numero, b.rbx_dataliberacao as rec_data, r.rec_pedido,
    r.rec_vencimento, r.rec_valorpago,rep.rep_nome,
    c.cli_nome ,e.eta_descricao ,b.rbx_datapagamento as databaixa,rep.rep_obs1,
    sum(b.rbx_valorbasecomissao) as total
    from receber_titulos r
    inner join receber_baixas b on b.rbx_rec_id = r.rec_id
    inner join representantes rep on rep.rep_codigo = r.rec_rep_codigo
    inner join clientes c on c.cli_codigo = r.rec_cli_codigo
    left join entidades_atividades e on e.eta_codigo = c.cli_eta_codigo
    where b.rbx_datapagamento >= CAST('${ano}-01-01' AS DATE)
    and b.rbx_datapagamento < CAST('${ano + 1}-01-01' AS DATE)
    and b.rbx_valorbasecomissao > 0
    and r.rec_fil_codigo in ('11','12')
    group by emp, r.rec_numero, rec_data, r.rec_pedido, r.rec_vencimento, r.rec_valorpago,
    rep.rep_nome, e.eta_descricao ,c.cli_nome,b.rbx_datapagamento, rep.rep_obs1
  `;
}

function mysqlVendas(emp: string, ano: number) {
  return `
    select '${emp}' as emp, o.\`Data\` as pdv_data,o.NomeVendedor as usu_nome,
    v.departamento as eta_descricao, p.Grupo as grupo, v.departamento as rvs_nome,
    p.subGrupo as subgrupo, p.fabricante as familia, sum(i.Qtd) qtde, sum(i.Total) as total
    from orcamentoitens i
    inner join orcamento o on i.Numero = o.IdPedido
    inner join pacad p on p.codigopro = i.CodigoVenda
    inner join vendedores v on v.codid = o.vendedor
    where o.\`Data\` >= '${ano}-01-01' and o.\`Data\` < '${ano + 1}-01-01'
    and o.Orcamento = 'PEDIDO'
    and o.wsalt not in ('2')
    and o.idFormaPagamento not in ('26')
    group by 1,2,3,4,5,6,7,8
  `;
}

function mysqlReceb(emp: string, ano: number) {
  return `
    select '${emp}' as emp,c.Titulo as rec_numero,c.Emissao as rec_data,
    c.Vencimento as rec_vencimento, c.ValorPago as rec_valorpago,
    v.nomevende as rep_nome, c.NomeDevedor as cli_nome,'ATACADO' as eta_descricao,
    c.DataBaixa, sum(c.ValorPago) as total
    from contasreceber c
    inner join vendedores v on v.CodId = c.IdVendedor
    where c.DataBaixa >= '${ano}-01-01' and c.DataBaixa < '${ano + 1}-01-01'
    group by 1,2,3,4,5,6,7,8,9
  `;
}

// ─── Normalização ─────────────────────────────────────────────────────────────

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// Agrupa vendedores de Ferragens pelo nome base (remove região/representante)
// Ex: "FERRAGENS ANESIA / ADILSON BA" → "FERRAGENS ANESIA"
// Exceções: TATIANA A e TATIANA R ficam separadas
function normalizarNomeFerragens(nome: string): string {
  if (nome.startsWith('FERRAGENS TATIANA A')) return 'FERRAGENS TATIANA A';
  if (nome.startsWith('FERRAGENS TATIANA R')) return 'FERRAGENS TATIANA R';
  const words = nome.split(/\s*\/\s*|\s+/);
  return `${words[0] ?? ''} ${words[1] ?? ''}`.trim();
}

// Aplica o vínculo Distribuidores (vendedor "filho" → vendedor "principal"), configurável em Configuração
function aplicarVinculo(nome: string | null, vinculos: Record<string, string>): string | null {
  if (!nome) return nome;
  return vinculos[nome.toUpperCase()] ?? nome;
}

function normalizeVendas(raw: Record<string, unknown>[]): VendaRow[] {
  return raw.map(r => {
    const rvs = str(r.rvs_nome);
    const usu = str(r.usu_nome);
    return {
      EMP: str(r.emp) ?? '',
      PDV_DATA: toDate(r.pdv_data) ?? new Date(0),
      ETA_DESCRICAO: str(r.eta_descricao),
      USU_NOME: rvs === 'FERRAGENS' && usu ? normalizarNomeFerragens(usu) : usu,
      GRUPO: str(r.grupo),
      SUBGRUPO: str(r.subgrupo),
      FAMILIA: str(r.familia),
      QTDE: Number(r.qtde ?? 0),
      RVS_NOME: rvs,
      SUM: Number(r.total ?? 0),
    };
  });
}

function normalizeReceb(raw: Record<string, unknown>[]): RecebRow[] {
  return raw.map(r => {
    const repNome = str(r.rep_nome);
    const repNomeNorm = repNome && repNome.toUpperCase().startsWith('FERRAGENS')
      ? normalizarNomeFerragens(repNome.toUpperCase())
      : repNome;
    return {
      EMP: str(r.emp) ?? '',
      REP_NOME: repNomeNorm,
      TOTAL: Number(r.total ?? 0),
      DATABAIXA: toDate(r.databaixa ?? r.DataBaixa),
    };
  });
}

// Mapa VENDEDOR_VINCULADO → VENDEDOR_PRINCIPAL (Distribuidores), configurável em Configuração.
// Cache curto (1 min) — evita bater no SQL Server a cada request sem deixar o vínculo travado por 15 min.
const VINC_TTL = 60 * 1000;
let _vinculosCache: { map: Record<string, string>; ts: number } | null = null;

async function getVinculosDistribuidoresMap(): Promise<Record<string, string>> {
  if (_vinculosCache && Date.now() - _vinculosCache.ts < VINC_TTL) return _vinculosCache.map;
  try {
    await ensureDistTables();
    const pool = await getPool();
    const res = await pool.request().query(
      `SELECT VENDEDOR_VINCULADO, VENDEDOR_PRINCIPAL FROM [TI-PAINELCOMISSAO_DISTRIBUIDORES_VINCULOS]`
    );
    const map: Record<string, string> = {};
    res.recordset.forEach((r: Record<string, unknown>) => {
      const vinc = str(r.VENDEDOR_VINCULADO)?.toUpperCase();
      const princ = str(r.VENDEDOR_PRINCIPAL)?.toUpperCase();
      if (vinc && princ) map[vinc] = princ;
    });
    _vinculosCache = { map, ts: Date.now() };
    return map;
  } catch (err) {
    console.error('[dados-externos] vinculos distribuidores:', (err as Error)?.message ?? err);
    return _vinculosCache?.map ?? {};
  }
}

// Chamado ao salvar os vínculos em Configuração, para o efeito ser imediato
export function invalidarCacheVinculos() {
  _vinculosCache = null;
}

// Lista bruta (sem vínculo aplicado) dos representantes Distribuidores que já têm vendas
// registradas — usa exatamente as mesmas fontes (Firebird/MySQL/EP) que alimentam o resto do
// painel, para não deixar de fora representantes que não vêm do sistema EP.
export async function getDistribuidoresNomesRaw(): Promise<string[]> {
  const anoAtual = new Date().getFullYear();
  const anos = [anoAtual, anoAtual - 1, anoAtual - 2];
  const nomes = new Set<string>();
  for (const ano of anos) {
    const rows = await getVendasBrutas(ano);
    rows.forEach(r => {
      if (r.RVS_NOME === 'DISTRIBUIDORES' && r.USU_NOME) nomes.add(r.USU_NOME);
    });
  }
  return [...nomes].sort();
}

// Lista bruta (sem vínculo aplicado) dos vendedores de TODOS os setores ativos que já
// têm vendas registradas. Usada na tela de Configuração para montar os vínculos
// (vendedor vinculado → principal), que são aplicados globalmente em todos os setores/bases.
export async function getVendedoresNomesRaw(): Promise<string[]> {
  const anoAtual = new Date().getFullYear();
  const anos = [anoAtual, anoAtual - 1, anoAtual - 2];
  const setoresAtivos = new Set<string>(SETORES_ATIVOS as readonly string[]);
  const nomes = new Set<string>();
  for (const ano of anos) {
    const rows = await getVendasBrutas(ano);
    rows.forEach(r => {
      if (r.USU_NOME && r.RVS_NOME && setoresAtivos.has(r.RVS_NOME)) nomes.add(r.USU_NOME);
    });
  }
  return [...nomes].sort();
}

// ─── EP (SQL Server principal) ───────────────────────────────────────────────

async function queryEPVendas(ano: number): Promise<VendaRow[]> {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('ini', sql.VarChar, `${ano}-01-01`)
      .input('fim', sql.VarChar, `${ano + 1}-01-01`)
      .query(`
        SELECT
          e.VENDEDOR      AS usu_nome,
          p.GRUPO         AS grupo,
          p.SUBGRUPO      AS subgrupo,
          p.FAMILIA       AS familia,
          e.[DATA]        AS pdv_data,
          SUM(p.QTD)      AS qtde,
          SUM(p.VALORTOTAL) AS total
        FROM EP e
        INNER JOIN EP_ProdutosDoPedido p ON p.PedidoID = e.ID
        WHERE e.[DATA] >= @ini
          AND e.[DATA] <  @fim
          AND (
            e.VENDEDOR LIKE 'DISTRIBUIDOR%'
            OR e.VENDEDOR LIKE 'FERRAGENS%'
            OR e.VENDEDOR LIKE 'TELEVENDAS%'
          )
        GROUP BY e.VENDEDOR, p.GRUPO, p.SUBGRUPO, p.FAMILIA, e.[DATA]
      `);

    return result.recordset.map((r: Record<string, unknown>) => ({
      EMP: 'EP',
      PDV_DATA: toDate(r.pdv_data) ?? new Date(0),
      ETA_DESCRICAO: null,
      USU_NOME: str(r.usu_nome)?.toUpperCase() ?? null,
      GRUPO: str(r.grupo),
      SUBGRUPO: str(r.subgrupo),
      FAMILIA: str(r.familia),
      QTDE: Number(r.qtde ?? 0),
      RVS_NOME: 'DISTRIBUIDORES',
      SUM: Number(r.total ?? 0),
    }));
  } catch (err) {
    console.error('[dados-externos] EP vendas:', (err as Error)?.message ?? err);
    return [];
  }
}

// ─── Fetch + cache ────────────────────────────────────────────────────────────
// O cache guarda as linhas BRUTAS (sem vínculo Distribuidores aplicado). O vínculo é
// aplicado na leitura (getVendas/getRecebimentos), assim uma alteração no vínculo tem
// efeito imediato sem precisar invalidar/refazer as consultas nos bancos externos.

function getVendasBrutas(ano: number): Promise<VendaRow[]> {
  const hit = _cv.get(ano);
  if (hit && Date.now() - hit.ts < TTL) return Promise.resolve(hit.rows);

  const inflight = _inFlightV.get(ano);
  if (inflight) return inflight;

  const promise = (async () => {
    const [settled, epRows] = await Promise.all([
      Promise.allSettled([
        queryFirebird(fbSJC, fbVendas('SJC', ano)),
        queryFirebird(fbSPM, fbVendas('SPM', ano)),
        queryFirebird(fbLockeyMG, fbVendas('LOCKEY MG', ano)),
        queryFirebird(fbLockey, fbVendasLockey(ano)),
        queryFirebird(fbLockeyRJ, fbVendas('Rio de Janeiro', ano)),
        queryFirebird(fbLockeyBH, fbVendas('Belo Horizonte', ano)),
        queryMySQL(myLockeyRS, mysqlVendas('LOCKEY RS', ano)),
        queryMySQL(myNiteroi, mysqlVendas('NITEROI', ano)),
      ]),
      queryEPVendas(ano),
    ]);

    const raw: Record<string, unknown>[] = [];
    settled.forEach(r => {
      if (r.status === 'fulfilled') raw.push(...r.value);
      else console.error('[dados-externos] vendas:', (r.reason as Error)?.message ?? r.reason);
    });

    const rows = [...normalizeVendas(raw), ...epRows];
    _cv.set(ano, { rows, ts: Date.now() });
    _inFlightV.delete(ano);
    return rows;
  })();

  _inFlightV.set(ano, promise);
  return promise;
}

function getRecebimentosBrutos(ano: number): Promise<RecebRow[]> {
  const hit = _cr.get(ano);
  if (hit && Date.now() - hit.ts < TTL) return Promise.resolve(hit.rows);

  const inflight = _inFlightR.get(ano);
  if (inflight) return inflight;

  const promise = (async () => {
    const settled = await Promise.allSettled([
      queryFirebird(fbSJC, fbReceb('SJC', ano)),
      queryFirebird(fbSPM, fbReceb('SPM', ano)),
      queryFirebird(fbLockeyMG, fbReceb('LOCKEY MG', ano)),
      queryFirebird(fbLockey, fbRecebLockey(ano)),
      queryFirebird(fbLockeyRJ, fbReceb('Rio de Janeiro', ano)),
      queryFirebird(fbLockeyBH, fbReceb('Belo Horizonte', ano)),
      queryMySQL(myLockeyRS, mysqlReceb('LOCKEY RS', ano)),
      queryMySQL(myNiteroi, mysqlReceb('NITEROI', ano)),
    ]);

    const raw: Record<string, unknown>[] = [];
    settled.forEach(r => {
      if (r.status === 'fulfilled') raw.push(...r.value);
      else console.error('[dados-externos] recebimentos:', (r.reason as Error)?.message ?? r.reason);
    });

    const rows = normalizeReceb(raw);
    _cr.set(ano, { rows, ts: Date.now() });
    _inFlightR.delete(ano);
    return rows;
  })();

  _inFlightR.set(ano, promise);
  return promise;
}

export async function getVendas(ano: number): Promise<VendaRow[]> {
  const [rows, vinculos] = await Promise.all([getVendasBrutas(ano), getVinculosDistribuidoresMap()]);
  if (Object.keys(vinculos).length === 0) return rows;
  return rows.map(r => {
    const usu = aplicarVinculo(r.USU_NOME, vinculos);
    return usu === r.USU_NOME ? r : { ...r, USU_NOME: usu };
  });
}

export async function getRecebimentos(ano: number): Promise<RecebRow[]> {
  const [rows, vinculos] = await Promise.all([getRecebimentosBrutos(ano), getVinculosDistribuidoresMap()]);
  if (Object.keys(vinculos).length === 0) return rows;
  return rows.map(r => {
    const rep = aplicarVinculo(r.REP_NOME, vinculos);
    return rep === r.REP_NOME ? r : { ...r, REP_NOME: rep };
  });
}

export function invalidarCache() {
  _cv.clear();
  _cr.clear();
  _inFlightV.clear();
  _inFlightR.clear();
}

// ─── Helpers de filtro e agregação (usados nos routes) ───────────────────────

// Compara data sem depender de fuso horário
function dateInt(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
function strInt(s: string): number {
  return parseInt(s.replace(/-/g, ''), 10);
}

export function dateInRange(d: Date | null, inicio: string, fim: string): boolean {
  if (!d) return false;
  const t = dateInt(d);
  return t >= strInt(inicio) && t <= strInt(fim);
}

export interface FiltroVendas {
  inicio: string;
  fim: string;
  setores: string[];       // [] = todos de SETORES_ATIVOS
  userSetores: string[];   // [] = sem restrição (ADM)
  vendedor?: string;
  empresa?: string;
}

export function filtrarVendas(rows: VendaRow[], f: FiltroVendas): VendaRow[] {
  const setoresPermitidos = f.userSetores.length
    ? f.userSetores.filter(s => (SETORES_ATIVOS as readonly string[]).includes(s))
    : [...SETORES_ATIVOS];

  return rows.filter(v => {
    if (!dateInRange(v.PDV_DATA, f.inicio, f.fim)) return false;
    if (!v.RVS_NOME || !setoresPermitidos.includes(v.RVS_NOME)) return false;
    if (f.setores.length && !f.setores.includes(v.RVS_NOME)) return false;
    if (f.vendedor !== undefined && v.USU_NOME !== f.vendedor) return false;
    if (f.empresa !== undefined && v.EMP !== f.empresa) return false;
    return true;
  });
}

export interface FiltroReceb {
  inicio: string;
  fim: string;
  vendedor?: string;
}

export function filtrarReceb(rows: RecebRow[], f: FiltroReceb): RecebRow[] {
  return rows.filter(r => {
    if (!dateInRange(r.DATABAIXA, f.inicio, f.fim)) return false;
    if (f.vendedor !== undefined && r.REP_NOME !== f.vendedor) return false;
    return true;
  });
}

export function somarVendas(rows: VendaRow[]): number {
  return rows.reduce((s, r) => s + r.SUM, 0);
}

export function somarReceb(rows: RecebRow[]): number {
  return rows.reduce((s, r) => s + r.TOTAL, 0);
}

export function groupBy<T>(arr: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of arr) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(x);
  }
  return m;
}
