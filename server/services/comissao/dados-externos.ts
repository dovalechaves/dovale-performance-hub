import { queryFirebird } from './firebird';
import { queryMySQL } from './mysql-ext';
import { getPool } from '../../db/sqlserver';
import sql from 'mssql';
import { fbSJC, fbSPM, fbLockeyMG, fbLockey, fbLockeyRJ, fbLockeyBH, myLockeyRS, myNiteroi } from './db-externas';
import { FALHA_TTL_MS, ehFalhaDeConexao } from './timeouts';
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

// ─── Cache em memória (por mês e por fonte) ──────────────────────────────────
// Antes o painel buscava o ANO INTEIRO de cada base externa de uma vez (20–50 s por base
// e, às vezes, estourando o timeout) e guardava tudo por 2 min — então a primeira tela
// depois de expirar esperava esse tempo todo. Agora cada (fonte, mês) é buscado e guardado
// separadamente: as linhas já vêm agrupadas por data, então a soma dos meses é EXATAMENTE
// o resultado do ano (mesma ordem e mesmos valores, conferido linha a linha).
//
// Vendas continuam entrando o dia inteiro — um cache longo faz o painel ficar
// sistematicamente atrás de qualquer conferência feita "na hora" numa fonte externa,
// parecendo erro sem ser. Por isso o mês corrente tem cache curto (1 min, e a consulta de
// um mês leva poucos segundos); meses fechados quase não mudam e ficam mais tempo.
// Se uma fonte falhou numa busca, aquele pedaço fica marcado como incompleto — não pode
// ficar memoizado nem o TTL normal (um blip de rede de alguns segundos não pode custar
// minutos de números errados): expira em 20 s, e só aquela fonte/mês é consultada de novo.
const TTL_MES_ATUAL = 60 * 1000;
const TTL_MES_ANTERIOR = 5 * 60 * 1000;
const TTL_MES_FECHADO = 30 * 60 * 1000;
const TTL_ANO_PASSADO = 2 * 60 * 60 * 1000;
const TTL_INCOMPLETO = 20 * 1000;
// Mês fechado vencido: devolve o que já tem (quase nunca mudou) e atualiza em segundo
// plano, em vez de segurar a tela. Passado desse limite, espera o dado novo.
const MAX_VELHO_MES_FECHADO = 24 * 60 * 60 * 1000;
// Mês corrente vencido há pouco: se a renovação já está a caminho, serve o que tem por mais
// um minuto em vez de segurar a tela (o dado continua com no máximo ~2 min, igual ao cache
// antigo de 2 min). Passou disso, espera o dado novo.
const GRACA_MES_ATUAL = 60 * 1000;
// Enquanto o painel está em uso (ou foi usado há pouco), o servidor renova sozinho o que
// está perto de vencer — assim quem volta pra tela encontra o cache já quente.
const JANELA_ATIVIDADE = 90 * 60 * 1000;
const INTERVALO_AQUECIMENTO = 15 * 1000;
// Renova quando já passou dessa fração do TTL (com tick de 15 s e consulta de poucos segundos,
// o mês corrente nunca chega a vencer enquanto há uso).
const FRACAO_RENOVACAO = 0.5;

// ─── Queries Firebird (por ano) ───────────────────────────────────────────────

function fbVendas(emp: string, ini: string, fim: string) {
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
    where ped.pdv_data >= CAST('${ini}' AS DATE)
    and ped.pdv_data < CAST('${fim}' AS DATE)
    and ped.pdv_psi_codigo not in ('CC')
    and ped.pdv_tve_codigo not in ('6','7','26','34')
    and c.cli_codigo not in ('44274','98030','49268')
    group by emp,ped.pdv_data, ea.eta_descricao, usu_nome,grupo, pn.nome, familia, rs.rvs_nome
  `;
}

function fbVendasLockey(ini: string, fim: string) {
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
    where ped.pdv_data >= CAST('${ini}' AS DATE)
    and ped.pdv_data < CAST('${fim}' AS DATE)
    and ped.pdv_psi_codigo not in ('CC')
    and ped.pdv_tve_codigo not in ('6','7','26','34')
    and c.cli_codigo not in ('44274','98030','49268')
    and ped.emp_fil_codigo in ('11','12')
    group by emp,ped.pdv_data, ea.eta_descricao, usu_nome,grupo, pn.nome, familia, rs.rvs_nome
  `;
}

function fbReceb(emp: string, ini: string, fim: string) {
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
    where b.rbx_datapagamento >= CAST('${ini}' AS DATE)
    and b.rbx_datapagamento < CAST('${fim}' AS DATE)
    and b.rbx_valorbasecomissao > 0
    group by emp, r.rec_numero, rec_data, r.rec_pedido, r.rec_vencimento, r.rec_valorpago,
    rep.rep_nome, e.eta_descricao ,c.cli_nome,b.rbx_datapagamento, rep.rep_obs1
  `;
}

function fbRecebLockey(ini: string, fim: string) {
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
    where b.rbx_datapagamento >= CAST('${ini}' AS DATE)
    and b.rbx_datapagamento < CAST('${fim}' AS DATE)
    and b.rbx_valorbasecomissao > 0
    and r.rec_fil_codigo in ('11','12')
    group by emp, r.rec_numero, rec_data, r.rec_pedido, r.rec_vencimento, r.rec_valorpago,
    rep.rep_nome, e.eta_descricao ,c.cli_nome,b.rbx_datapagamento, rep.rep_obs1
  `;
}

function mysqlVendas(emp: string, ini: string, fim: string) {
  return `
    select '${emp}' as emp, o.\`Data\` as pdv_data,o.NomeVendedor as usu_nome,
    v.departamento as eta_descricao, p.Grupo as grupo, v.departamento as rvs_nome,
    p.subGrupo as subgrupo, p.fabricante as familia, sum(i.Qtd) qtde, sum(i.Total) as total
    from orcamentoitens i
    inner join orcamento o on i.Numero = o.IdPedido
    inner join pacad p on p.codigopro = i.CodigoVenda
    inner join vendedores v on v.codid = o.vendedor
    where o.\`Data\` >= '${ini}' and o.\`Data\` < '${fim}'
    and o.Orcamento = 'PEDIDO'
    and o.wsalt not in ('2')
    and o.idFormaPagamento not in ('26')
    group by 1,2,3,4,5,6,7,8
  `;
}

function mysqlReceb(emp: string, ini: string, fim: string) {
  return `
    select '${emp}' as emp,c.Titulo as rec_numero,c.Emissao as rec_data,
    c.Vencimento as rec_vencimento, c.ValorPago as rec_valorpago,
    v.nomevende as rep_nome, c.NomeDevedor as cli_nome,'ATACADO' as eta_descricao,
    c.DataBaixa, sum(c.ValorPago) as total
    from contasreceber c
    inner join vendedores v on v.CodId = c.IdVendedor
    where c.DataBaixa >= '${ini}' and c.DataBaixa < '${fim}'
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

// A EP não tem uma coluna de setor — o setor é inferido pelo prefixo do nome do vendedor
// (mesmo critério do WHERE da query abaixo). Antes isso vinha fixo como 'DISTRIBUIDORES'
// para toda a EP, o que classificaria errado um eventual vendedor FERRAGENS/TELEVENDAS.
function rvsFromVendedorEP(vendedor: string | null): string | null {
  if (!vendedor) return null;
  const upper = vendedor.toUpperCase();
  if (upper.startsWith('TELEVENDAS MG')) return 'TELEVENDAS MG';
  if (upper.startsWith('TELEVENDAS')) return 'TELEVENDAS';
  if (upper.startsWith('FERRAGENS')) return 'FERRAGENS';
  if (upper.startsWith('DISTRIBUIDOR')) return 'DISTRIBUIDORES';
  return null;
}

async function queryEPVendas(ini: string, fim: string): Promise<VendaRow[]> {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('ini', sql.VarChar, ini)
      .input('fim', sql.VarChar, fim)
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

    return result.recordset.map((r: Record<string, unknown>) => {
      const usuNome = str(r.usu_nome)?.toUpperCase() ?? null;
      return {
        EMP: 'EP',
        PDV_DATA: toDate(r.pdv_data) ?? new Date(0),
        ETA_DESCRICAO: null,
        USU_NOME: usuNome,
        GRUPO: str(r.grupo),
        SUBGRUPO: str(r.subgrupo),
        FAMILIA: str(r.familia),
        QTDE: Number(r.qtde ?? 0),
        RVS_NOME: rvsFromVendedorEP(usuNome),
        SUM: Number(r.total ?? 0),
      };
    });
  } catch (err) {
    console.error('[dados-externos] EP vendas:', (err as Error)?.message ?? err);
    return [];
  }
}

// ─── Circuit breaker por base externa ────────────────────────────────────────
// Uma base fora do ar (ex.: Lockey BH quando a VPN cai) não pode custar o timeout de
// conexão em toda request: depois da primeira falha de conexão ela é ignorada por
// FALHA_TTL_MS. Falhas de consulta (base viva, query lenta) não abrem o breaker.

interface Falha { fonte: string; erro: string; ts: number }
const _falhas = new Map<string, Falha>();

// Instabilidade de rede/VPN de alguns segundos não deveria custar 15 min de dados
// incompletos — tenta mais uma vez antes de declarar a fonte fora do ar.
const RETRY_DELAY_MS = 1_000;

async function comBreaker<T>(
  fonte: string,
  host: string,
  fn: () => Promise<T[]>,
): Promise<T[]> {
  const chave = host || fonte;
  const falha = _falhas.get(chave);
  if (falha && Date.now() - falha.ts < FALHA_TTL_MS) {
    throw new Error(`${fonte} ignorada (falha recente de conexão: ${falha.erro})`);
  }
  try {
    const rows = await fn();
    _falhas.delete(chave);
    return rows;
  } catch (err) {
    if (!ehFalhaDeConexao(err)) {
      throw new Error(`${fonte}: ${(err as Error).message}`);
    }
    // Falha de conexão: pode ser um blip passageiro — tenta mais uma vez antes de abrir o breaker.
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    try {
      const rows = await fn();
      _falhas.delete(chave);
      return rows;
    } catch (err2) {
      if (ehFalhaDeConexao(err2)) {
        _falhas.set(chave, { fonte, erro: (err2 as Error).message, ts: Date.now() });
      }
      throw new Error(`${fonte}: ${(err2 as Error).message}`);
    }
  }
}

/** Bases externas indisponíveis agora — usado para avisar na tela que faltam dados. */
export function fontesIndisponiveis(): { fonte: string; erro: string }[] {
  const agora = Date.now();
  return [..._falhas.values()]
    .filter(f => agora - f.ts < FALHA_TTL_MS)
    .map(f => ({ fonte: f.fonte, erro: f.erro }));
}

// ─── Fetch + cache ────────────────────────────────────────────────────────────
// O cache guarda as linhas BRUTAS (sem vínculo Distribuidores aplicado). O vínculo é
// aplicado na leitura (getVendas/getRecebimentos), assim uma alteração no vínculo tem
// efeito imediato sem precisar invalidar/refazer as consultas nos bancos externos.

interface FonteExterna {
  nome: string;
  host: string;
  /** false = a própria consulta já trata falha e devolve [] (caso da EP) */
  usaBreaker: boolean;
  /** true = as linhas já saem no formato final (caso da EP), sem passar pelo normalizar */
  jaNormalizada?: boolean;
  /**
   * true = a fonte devolve mais de uma empresa (EMP) na mesma consulta (Lockey SP + FAST). A consulta
   * do ano vinha ordenada por empresa e depois por data; ao juntar os meses reproduzimos essa ordem
   * (a ordem das linhas decide qual empresa aparece primeiro para um vendedor com vendas nas duas).
   */
  ordenarPorEmp?: boolean;
  consultar: (ini: string, fim: string) => Promise<Record<string, unknown>[]>;
}

interface PedacoMes {
  mes: number;
  ini: string;
  fim: string;
  ttl: number;
  /** mês que já fechou: quase não muda, pode ser servido "velho" enquanto atualiza */
  fechado: boolean;
  /** mês corrente ou o anterior — os únicos que o forcarFresco refaz */
  recente: boolean;
}

interface Slot<T> { rows: T[]; ts: number; ok: boolean }

// Fila por fonte: no máximo UMA consulta nossa por vez em cada base (o mesmo perfil de
// carga de antes), e o que uma tela está esperando passa na frente do que é só renovação
// em segundo plano.
type Prioridade = 'alta' | 'baixa';
interface Tarefa { fn: () => Promise<void>; prio: Prioridade; promise: Promise<void>; resolve: () => void }
const _agenda = new Map<string, { rodando: boolean; fila: Tarefa[] }>();

function enfileirar(chave: string, prio: Prioridade, fn: () => Promise<void>): Tarefa {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });
  const tarefa: Tarefa = { fn, prio, promise, resolve };
  let ag = _agenda.get(chave);
  if (!ag) { ag = { rodando: false, fila: [] }; _agenda.set(chave, ag); }
  ag.fila.push(tarefa);
  void rodarFila(chave);
  return tarefa;
}

async function rodarFila(chave: string): Promise<void> {
  const ag = _agenda.get(chave)!;
  if (ag.rodando) return;
  ag.rodando = true;
  try {
    while (ag.fila.length) {
      const i = ag.fila.findIndex((t) => t.prio === 'alta');
      const [tarefa] = ag.fila.splice(i >= 0 ? i : 0, 1);
      try { await tarefa.fn(); } catch { /* a fn já trata o próprio erro */ }
      tarefa.resolve();
    }
  } finally {
    ag.rodando = false;
  }
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }

// Divide o ano em pedaços mensais [ini, fim). O mês corrente vai até o fim do ano (pega
// também eventual lançamento com data futura, como a consulta do ano inteiro fazia).
function planoDoAno(ano: number): PedacoMes[] {
  const hoje = new Date();
  const anoAtual = hoje.getFullYear();
  const mesAtual = hoje.getMonth() + 1;
  const fimAno = `${ano + 1}-01-01`;

  if (ano > anoAtual) {
    return [{ mes: 1, ini: `${ano}-01-01`, fim: fimAno, ttl: TTL_MES_ATUAL, fechado: false, recente: true }];
  }
  const ultimo = ano === anoAtual ? mesAtual : 12;
  const plano: PedacoMes[] = [];
  for (let mes = 1; mes <= ultimo; mes++) {
    const atual = ano === anoAtual && mes === mesAtual;
    const idadeMeses = (anoAtual - ano) * 12 + (mesAtual - mes);
    plano.push({
      mes,
      ini: `${ano}-${pad2(mes)}-01`,
      fim: atual ? fimAno : (mes === 12 ? fimAno : `${ano}-${pad2(mes + 1)}-01`),
      ttl: atual ? TTL_MES_ATUAL
        : idadeMeses === 1 ? TTL_MES_ANTERIOR
        : ano < anoAtual ? TTL_ANO_PASSADO
        : TTL_MES_FECHADO,
      fechado: !atual,
      recente: atual || idadeMeses === 1,
    });
  }
  return plano;
}

// Evita encher o log: uma fonte fora do ar falharia a cada renovação.
const _ultimoLogErro = new Map<string, number>();
function logarErroFonte(rotulo: string, mensagem: string): void {
  const chave = `${rotulo}|${mensagem}`;
  if (Date.now() - (_ultimoLogErro.get(chave) ?? 0) < 60_000) return;
  _ultimoLogErro.set(chave, Date.now());
  console.error(`[dados-externos] ${rotulo}:`, mensagem);
}

interface CacheMensal<T> {
  rotulo: string;
  fontes: FonteExterna[];
  normalizar: (raw: Record<string, unknown>[]) => T[];
  slots: Map<string, Slot<T>>;
  emVoo: Map<string, Tarefa>;
  montados: Map<number, { assinatura: string; rows: T[] }>;
}

function criarCacheMensal<T>(
  rotulo: string,
  fontes: FonteExterna[],
  normalizar: (raw: Record<string, unknown>[]) => T[],
): CacheMensal<T> {
  return { rotulo, fontes, normalizar, slots: new Map(), emVoo: new Map(), montados: new Map() };
}

function chaveSlot(ano: number, p: PedacoMes, fonte: FonteExterna): string {
  return `${ano}:${p.mes}:${p.fim}:${fonte.nome}`;
}

function atualizarSlot<T>(cache: CacheMensal<T>, chave: string, p: PedacoMes, fonte: FonteExterna, prio: Prioridade): Tarefa {
  const emVoo = cache.emVoo.get(chave);
  if (emVoo) {
    if (prio === 'alta') emVoo.prio = 'alta'; // alguém passou a esperar por isso: sobe na fila
    return emVoo;
  }
  const tarefa = enfileirar(`${cache.rotulo}:${fonte.nome}`, prio, async () => {
    try {
      const raw = fonte.usaBreaker
        ? await comBreaker(fonte.nome, fonte.host, () => fonte.consultar(p.ini, p.fim))
        : await fonte.consultar(p.ini, p.fim);
      cache.slots.set(chave, {
        rows: fonte.jaNormalizada ? (raw as unknown as T[]) : cache.normalizar(raw),
        ts: Date.now(),
        ok: true,
      });
    } catch (err) {
      logarErroFonte(cache.rotulo, (err as Error)?.message ?? String(err));
      // Mantém o que já se sabia desse pedaço (se houver) em vez de zerá-lo, mas marca como
      // incompleto: tenta de novo em 20 s e a tela segue avisando que a fonte está fora.
      const anterior = cache.slots.get(chave);
      cache.slots.set(chave, { rows: anterior?.rows ?? [], ts: Date.now(), ok: false });
    }
  });
  cache.emVoo.set(chave, tarefa);
  const limpar = () => { if (cache.emVoo.get(chave) === tarefa) cache.emVoo.delete(chave); };
  void tarefa.promise.then(limpar, limpar);
  return tarefa;
}

function slotPrecisaRenovar(slot: Slot<unknown> | undefined, p: PedacoMes, fracaoDoTtl: number): boolean {
  if (!slot) return true;
  const idade = Date.now() - slot.ts;
  return idade >= (slot.ok ? p.ttl * fracaoDoTtl : TTL_INCOMPLETO);
}

function montarAno<T>(cache: CacheMensal<T>, ano: number, plano: PedacoMes[]): T[] {
  const slots: Slot<T>[][] = cache.fontes.map((f) =>
    plano.map((p) => cache.slots.get(chaveSlot(ano, p, f)) ?? { rows: [], ts: 0, ok: false })
  );
  const assinatura = slots.map((linha) => linha.map((s) => s.ts).join(',')).join(';');
  const montado = cache.montados.get(ano);
  if (montado && montado.assinatura === assinatura) return montado.rows;
  // Mesma ordem de antes: fonte por fonte (SJC, SPM, ..., EP), e dentro da fonte por data.
  const rows = slots.flatMap((linha, i) => {
    const juntas = linha.flatMap((s) => s.rows);
    if (!cache.fontes[i].ordenarPorEmp) return juntas;
    // sort é estável: dentro de cada empresa a ordem por data (mês a mês) é preservada
    return juntas.sort((a, b) => {
      const ea = (a as unknown as { EMP: string }).EMP;
      const eb = (b as unknown as { EMP: string }).EMP;
      return ea < eb ? -1 : ea > eb ? 1 : 0;
    });
  });
  cache.montados.set(ano, { assinatura, rows });
  return rows;
}

// Atividade recente + anos em uso: base do aquecimento automático.
let _ultimaAtividade = 0;
const _anosEmUso = new Map<number, number>();

async function obterAno<T>(cache: CacheMensal<T>, ano: number, forcarFresco: boolean): Promise<T[]> {
  _ultimaAtividade = Date.now();
  _anosEmUso.set(ano, _ultimaAtividade);
  const plano = planoDoAno(ano);
  const esperas: Promise<void>[] = [];

  for (const p of plano) {
    for (const f of cache.fontes) {
      const chave = chaveSlot(ano, p, f);
      const slot = cache.slots.get(chave);
      const forcar = forcarFresco && p.recente;
      if (!forcar && !slotPrecisaRenovar(slot, p, 1)) continue;

      const idade = slot ? Date.now() - slot.ts : Infinity;
      const limiteVelho = p.fechado ? MAX_VELHO_MES_FECHADO : p.ttl + GRACA_MES_ATUAL;
      if (!forcar && slot && slot.ok && idade < limiteVelho) {
        void atualizarSlot(cache, chave, p, f, 'baixa');
        continue;
      }
      esperas.push(atualizarSlot(cache, chave, p, f, 'alta').promise);
    }
  }

  if (esperas.length) await Promise.all(esperas);
  return montarAno(cache, ano, plano);
}

// Renova em segundo plano o que está perto de vencer, enquanto o painel está em uso.
function aquecerCache<T>(cache: CacheMensal<T>): void {
  const agora = Date.now();
  for (const [ano, ultimoUso] of _anosEmUso) {
    if (agora - ultimoUso > JANELA_ATIVIDADE) { _anosEmUso.delete(ano); continue; }
    for (const p of planoDoAno(ano)) {
      for (const f of cache.fontes) {
        const chave = chaveSlot(ano, p, f);
        if (slotPrecisaRenovar(cache.slots.get(chave), p, FRACAO_RENOVACAO)) {
          void atualizarSlot(cache, chave, p, f, 'baixa');
        }
      }
    }
  }
}

function fonteFirebird(
  nome: string,
  opts: typeof fbSJC,
  sql: (ini: string, fim: string) => string,
): FonteExterna {
  return { nome, host: opts.host, usaBreaker: true, consultar: (ini, fim) => queryFirebird(opts, sql(ini, fim)) };
}

function fonteMySQL(
  nome: string,
  opts: typeof myLockeyRS,
  sql: (ini: string, fim: string) => string,
): FonteExterna {
  return { nome, host: opts.host, usaBreaker: true, consultar: (ini, fim) => queryMySQL(opts, sql(ini, fim)) };
}

const _cacheVendas = criarCacheMensal<VendaRow>(
  'vendas',
  [
    fonteFirebird('SJC', fbSJC, (i, f) => fbVendas('SJC', i, f)),
    fonteFirebird('SPM', fbSPM, (i, f) => fbVendas('SPM', i, f)),
    fonteFirebird('LOCKEY MG', fbLockeyMG, (i, f) => fbVendas('LOCKEY MG', i, f)),
    { ...fonteFirebird('LOCKEY SP/FAST', fbLockey, fbVendasLockey), ordenarPorEmp: true },
    fonteFirebird('Rio de Janeiro', fbLockeyRJ, (i, f) => fbVendas('Rio de Janeiro', i, f)),
    fonteFirebird('Belo Horizonte', fbLockeyBH, (i, f) => fbVendas('Belo Horizonte', i, f)),
    fonteMySQL('LOCKEY RS', myLockeyRS, (i, f) => mysqlVendas('LOCKEY RS', i, f)),
    fonteMySQL('NITEROI', myNiteroi, (i, f) => mysqlVendas('NITEROI', i, f)),
    // EP (SQL Server): entra por último (como antes: depois das 8 bases), já devolve linhas
    // no formato final e trata a própria falha devolvendo [] (sem breaker).
    {
      nome: 'EP',
      host: '',
      usaBreaker: false,
      jaNormalizada: true,
      consultar: (ini, fim) => queryEPVendas(ini, fim) as unknown as Promise<Record<string, unknown>[]>,
    },
  ],
  normalizeVendas,
);

function getVendasBrutas(ano: number, forcarFresco = false): Promise<VendaRow[]> {
  return obterAno(_cacheVendas, ano, forcarFresco);
}

const _cacheReceb = criarCacheMensal<RecebRow>(
  'recebimentos',
  [
    fonteFirebird('SJC', fbSJC, (i, f) => fbReceb('SJC', i, f)),
    fonteFirebird('SPM', fbSPM, (i, f) => fbReceb('SPM', i, f)),
    fonteFirebird('LOCKEY MG', fbLockeyMG, (i, f) => fbReceb('LOCKEY MG', i, f)),
    fonteFirebird('LOCKEY SP/FAST', fbLockey, fbRecebLockey),
    fonteFirebird('Rio de Janeiro', fbLockeyRJ, (i, f) => fbReceb('Rio de Janeiro', i, f)),
    fonteFirebird('Belo Horizonte', fbLockeyBH, (i, f) => fbReceb('Belo Horizonte', i, f)),
    fonteMySQL('LOCKEY RS', myLockeyRS, (i, f) => mysqlReceb('LOCKEY RS', i, f)),
    fonteMySQL('NITEROI', myNiteroi, (i, f) => mysqlReceb('NITEROI', i, f)),
  ],
  normalizeReceb,
);

function getRecebimentosBrutos(ano: number, forcarFresco = false): Promise<RecebRow[]> {
  return obterAno(_cacheReceb, ano, forcarFresco);
}

let _aquecimentoIniciado = false;

/**
 * Chamado uma vez na subida do servidor: já busca o ano corrente (assim a primeira tela do
 * dia não paga a consulta fria) e passa a renovar o cache sozinho enquanto o painel estiver
 * em uso. O timer não segura o processo vivo e nunca lança.
 */
export function iniciarAquecimentoComissao(): void {
  if (_aquecimentoIniciado) return;
  _aquecimentoIniciado = true;
  const ano = new Date().getFullYear();
  void getVendasBrutas(ano).catch((e) => console.error('[dados-externos] aquecimento vendas:', e?.message ?? e));
  void getRecebimentosBrutos(ano).catch((e) => console.error('[dados-externos] aquecimento recebimentos:', e?.message ?? e));
  const timer = setInterval(() => {
    try {
      if (Date.now() - _ultimaAtividade > JANELA_ATIVIDADE) return;
      aquecerCache(_cacheVendas);
      aquecerCache(_cacheReceb);
    } catch (e) {
      console.error('[dados-externos] aquecimento:', (e as Error)?.message ?? e);
    }
  }, INTERVALO_AQUECIMENTO);
  timer.unref();
}

// forcarFresco=true ignora o cache do mês corrente e do anterior e busca direto nas bases
// externas (os meses fechados não mudam o bastante para justificar).
// Usado na tela individual do vendedor, onde o número precisa refletir a venda que
// acabou de entrar, não o que foi buscado há até 2 min por outra pessoa.
export async function getVendas(ano: number, forcarFresco = false): Promise<VendaRow[]> {
  const [rows, vinculos] = await Promise.all([getVendasBrutas(ano, forcarFresco), getVinculosDistribuidoresMap()]);
  if (Object.keys(vinculos).length === 0) return rows;
  return rows.map(r => {
    const usu = aplicarVinculo(r.USU_NOME, vinculos);
    return usu === r.USU_NOME ? r : { ...r, USU_NOME: usu };
  });
}

export async function getRecebimentos(ano: number, forcarFresco = false): Promise<RecebRow[]> {
  const [rows, vinculos] = await Promise.all([getRecebimentosBrutos(ano, forcarFresco), getVinculosDistribuidoresMap()]);
  if (Object.keys(vinculos).length === 0) return rows;
  return rows.map(r => {
    const rep = aplicarVinculo(r.REP_NOME, vinculos);
    return rep === r.REP_NOME ? r : { ...r, REP_NOME: rep };
  });
}

export function invalidarCache() {
  for (const c of [_cacheVendas, _cacheReceb]) {
    c.slots.clear();
    c.emVoo.clear();
    c.montados.clear();
  }
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
