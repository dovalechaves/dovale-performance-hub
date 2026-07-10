/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from "express";
import sql from "mssql";
import { getPool } from "../db/sqlserver";
import { getComissaoUsuario, podeVerTudo, isADM, type ComissaoUsuario } from "../services/comissao/permissions";
import { SETORES_ATIVOS, addSetoresGlobais } from "../services/comissao/setores";
import { ensureVendedorAtivoTable, getVendedoresInativos } from "../services/comissao/vendedorAtivoTable";
import {
  calcularComissaoTelevendas, isTelevendas,
  type MetaConfig, type BonusConfig,
} from "../services/comissao/commission";
import {
  calcularComissaoFerragens, isFerragens,
  type FerrMetaConfig, type FerrBonusConfig, type FerrMetaGrupoConfig,
} from "../services/comissao/commission-ferragens";
import {
  calcularComissaoDistribuidores, isDistribuidores,
  type DistMetaConfig, type DistBonusConfig,
} from "../services/comissao/commission-distribuidores";
import { ensureFerrTables } from "../services/comissao/ferragens-tables";
import { ensureDistTables } from "../services/comissao/distribuidores-tables";
import {
  getVendas, getRecebimentos,
  filtrarVendas, filtrarReceb,
  somarVendas, somarReceb,
  groupBy,
  getVendedoresNomesRaw,
  invalidarCacheVinculos,
} from "../services/comissao/dados-externos";
import { queryFirebird } from "../services/comissao/firebird";
import { queryMySQL } from "../services/comissao/mysql-ext";
import { fbSJC, fbSPM, fbLockeyMG, fbLockey, myLockeyRS, myNiteroi } from "../services/comissao/db-externas";

const router = Router();

// Ator do hub: header x-dovale-usuario injetado pela tela do Hub.
function getActor(req: any): string {
  return String(req.header("x-dovale-usuario") || "").trim();
}

const SETORES_TELEVENDAS = ["TELEVENDAS", "TELEVENDAS MG"];

function normalizarNome(nome: unknown): string {
  return String(nome || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function escaparRegex(valor: string): string {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function vendedorCasaComConfig(nomeReal: unknown, nomeConfig: unknown): boolean {
  const real = normalizarNome(nomeReal);
  const config = normalizarNome(nomeConfig);
  if (!real || !config) return false;
  if (real === config) return true;
  if (config.length < 3) return false;
  return new RegExp(`(^|\\s)${escaparRegex(config)}($|\\s)`).test(real);
}

function filtrarVendedoresPorConfig(nomes: string[], nomeConfig: string | null): string[] {
  if (!nomeConfig) return [];
  const matches = nomes.filter((nome) => vendedorCasaComConfig(nome, nomeConfig));
  return matches.length ? matches : [nomeConfig];
}

function podeAcessarSetor(usuario: ComissaoUsuario, setor: string): boolean {
  return podeVerTudo(usuario.cargo) || usuario.setores.includes(setor);
}

function podeAcessarAlgumSetor(usuario: ComissaoUsuario, setores: string[]): boolean {
  return podeVerTudo(usuario.cargo) || setores.some((setor) => usuario.setores.includes(setor));
}

function exigirSetor(usuario: ComissaoUsuario, res: any, setor: string): boolean {
  if (podeAcessarSetor(usuario, setor)) return true;
  res.status(403).json({ error: "Sem permissão para este setor" });
  return false;
}

function exigirAlgumSetor(usuario: ComissaoUsuario, res: any, setores: string[]): boolean {
  if (podeAcessarAlgumSetor(usuario, setores)) return true;
  res.status(403).json({ error: "Sem permissão para este setor" });
  return false;
}

async function getVendedoresPermitidos(
  usuario: ComissaoUsuario,
  ano = new Date().getFullYear(),
  setores?: string[],
): Promise<Set<string> | null> {
  if (podeVerTudo(usuario.cargo)) return null;
  if (usuario.cargo === "VENDEDOR") {
    if (!usuario.nome_vendedor) return new Set();
    const vendas = await getVendas(ano);
    const nomes = [...new Set(vendas.map((v) => v.USU_NOME).filter(Boolean))];
    return new Set(filtrarVendedoresPorConfig(nomes, usuario.nome_vendedor).map(normalizarNome));
  }

  const setoresPermitidos = (setores?.length ? setores : usuario.setores)
    .filter((setor) => usuario.setores.includes(setor));
  if (!setoresPermitidos.length) return new Set();

  const vendas = filtrarVendas(await getVendas(ano), {
    inicio: `${ano}-01-01`,
    fim: `${ano}-12-31`,
    userSetores: setoresPermitidos,
    setores: setoresPermitidos,
  });
  return new Set(vendas.map((v) => normalizarNome(v.USU_NOME)).filter(Boolean));
}

function filtrarLinhasPorVendedor<T extends Record<string, any>>(
  rows: T[],
  permitidos: Set<string> | null,
  campo = "nome_vendedor",
): T[] {
  if (!permitidos) return rows;
  return rows.filter((row) => permitidos.has(normalizarNome(row[campo])));
}

async function garantirVendedoresDoBody(
  usuario: ComissaoUsuario,
  rows: Array<Record<string, any>>,
  ano: number,
  setores?: string[],
): Promise<boolean> {
  const permitidos = await getVendedoresPermitidos(usuario, ano, setores);
  if (!permitidos) return true;
  return rows.every((row) => permitidos.has(normalizarNome(row.nome_vendedor)));
}

// ─── metas (VendedorMeta) helpers ────────────────────────────────────────────
async function ensureVendedorMetaTable() {
  const pool = await getPool();
  // Cria tabela se não existir
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='VendedorMeta' AND xtype='U')
    BEGIN
      CREATE TABLE VendedorMeta (
        id INT IDENTITY(1,1) PRIMARY KEY,
        nome_vendedor VARCHAR(200) NOT NULL UNIQUE,
        meta1_valor      DECIMAL(18,2) NOT NULL DEFAULT 0,
        meta1_percentual DECIMAL(5,2)  NOT NULL DEFAULT 0,
        meta2_valor      DECIMAL(18,2) NOT NULL DEFAULT 0,
        meta2_percentual DECIMAL(5,2)  NOT NULL DEFAULT 0,
        meta3_valor      DECIMAL(18,2) NOT NULL DEFAULT 0,
        meta3_percentual DECIMAL(5,2)  NOT NULL DEFAULT 0,
        criado_em DATETIME DEFAULT GETDATE(),
        atualizado_em DATETIME DEFAULT GETDATE()
      )
    END
  `);
  // Migra schema antigo para 3 faixas se a tabela existia com o schema anterior
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME='VendedorMeta' AND COLUMN_NAME='meta1_valor'
    )
    BEGIN
      IF EXISTS (SELECT * FROM sysobjects WHERE name='VendedorMeta' AND xtype='U')
      BEGIN
        ALTER TABLE VendedorMeta ADD meta1_valor      DECIMAL(18,2) NOT NULL DEFAULT 0
        ALTER TABLE VendedorMeta ADD meta1_percentual DECIMAL(5,2)  NOT NULL DEFAULT 0
        ALTER TABLE VendedorMeta ADD meta2_valor      DECIMAL(18,2) NOT NULL DEFAULT 0
        ALTER TABLE VendedorMeta ADD meta2_percentual DECIMAL(5,2)  NOT NULL DEFAULT 0
        ALTER TABLE VendedorMeta ADD meta3_valor      DECIMAL(18,2) NOT NULL DEFAULT 0
        ALTER TABLE VendedorMeta ADD meta3_percentual DECIMAL(5,2)  NOT NULL DEFAULT 0
      END
    END
  `);
}

// ─── comissao (ComissaoConfig) helpers ───────────────────────────────────────
async function ensureComissaoConfigTable() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ComissaoConfig' AND xtype='U')
    CREATE TABLE ComissaoConfig (
      id INT IDENTITY(1,1) PRIMARY KEY,
      setor VARCHAR(200) NOT NULL,
      percentual DECIMAL(5,2) NOT NULL DEFAULT 0,
      meta_mensal DECIMAL(18,2) NOT NULL DEFAULT 0,
      ativo BIT NOT NULL DEFAULT 1,
      criado_em DATETIME DEFAULT GETDATE(),
      atualizado_em DATETIME DEFAULT GETDATE()
    )
  `);
}

// ─── metas-mensais helpers ───────────────────────────────────────────────────
const TABELA_METAS_MENSAIS = "[TI-PAINELCOMISSAO_METAS]";

let _psmEnsured: boolean | null = null;

async function garantirColunaPSM(pool: Awaited<ReturnType<typeof getPool>>): Promise<boolean> {
  if (_psmEnsured !== null) return _psmEnsured;
  try {
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'TI-PAINELCOMISSAO_METAS' AND COLUMN_NAME = 'PERCENTUAL_SEM_META'
      )
      BEGIN
        ALTER TABLE ${TABELA_METAS_MENSAIS} ADD PERCENTUAL_SEM_META FLOAT DEFAULT 0;
      END
    `);
    _psmEnsured = true;
    return true;
  } catch (err) {
    console.error('[metas-mensais] garantirColunaPSM falhou — coluna PERCENTUAL_SEM_META não pôde ser criada:', err);
    _psmEnsured = false;
    return false;
  }
}

// ─── bonus-config helpers ────────────────────────────────────────────────────
const TABELA_BONUS_CONFIG = "[TI-PAINELCOMISSAO_BONUS_CONFIG]";

let _tabelaEnsured = false;

const VAZIO = {
  bonus1_valor: 0, bonus1_percentual: 0,
  bonus2_valor: 0, bonus2_percentual: 0,
  bonus3_valor: 0, bonus3_percentual: 0,
  bonus4_valor: 0, bonus4_percentual: 0,
  bonus5_valor: 0, bonus5_percentual: 0,
};

async function garantirTabela(pool: Awaited<ReturnType<typeof getPool>>) {
  if (_tabelaEnsured) return;
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TI-PAINELCOMISSAO_BONUS_CONFIG')
    BEGIN
      CREATE TABLE ${TABELA_BONUS_CONFIG} (
        ID INT IDENTITY(1,1) PRIMARY KEY,
        BONUS1_VALOR FLOAT DEFAULT 0, BONUS1_PERCENTUAL FLOAT DEFAULT 0,
        BONUS2_VALOR FLOAT DEFAULT 0, BONUS2_PERCENTUAL FLOAT DEFAULT 0,
        BONUS3_VALOR FLOAT DEFAULT 0, BONUS3_PERCENTUAL FLOAT DEFAULT 0,
        BONUS4_VALOR FLOAT DEFAULT 0, BONUS4_PERCENTUAL FLOAT DEFAULT 0,
        BONUS5_VALOR FLOAT DEFAULT 0, BONUS5_PERCENTUAL FLOAT DEFAULT 0
      );
      INSERT INTO ${TABELA_BONUS_CONFIG}
        (BONUS1_VALOR,BONUS1_PERCENTUAL,BONUS2_VALOR,BONUS2_PERCENTUAL,BONUS3_VALOR,BONUS3_PERCENTUAL,
         BONUS4_VALOR,BONUS4_PERCENTUAL,BONUS5_VALOR,BONUS5_PERCENTUAL)
      VALUES (0,0,0,0,0,0,0,0,0,0);
    END
  `);
  _tabelaEnsured = true;
}

// ─── bonus-mensais helpers ───────────────────────────────────────────────────
const TABELA_BONUS_MENSAIS = "[TI-PAINELCOMISSAO_BONUS]";

// ─── externo/vendas helpers ──────────────────────────────────────────────────
// Firebird vendas — emp literal (SJC, SPM, LOCKEY MG)
function fbVendas(emp: string) {
  return `
    select '${emp}' as emp,ped.pdv_data, ea.eta_descricao, r.rep_nome usu_nome,g.nome grupo, pn.nome subgrupo, pg.nome as familia ,sum(i.pvi_quantidade) qtde, rs.rvs_nome,
    (SUM((COALESCE(i.PVI_TOTALITEM,0) +
    COALESCE(i.PVI_SUBSTICMS,0) +
    COALESCE(i.pvi_vl_fcp_st,0)+
    COALESCE(i.PVI_IPIVALOR,0)))) as total
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
    where ped.pdv_data > DATEADD(MONTH, -8, current_date)
    and ped.pdv_psi_codigo not in ('CC')
    and ped.pdv_tve_codigo not in ('6','7','26', '34')
    and c.cli_codigo not in ('44274','98030','49268')
    group by emp,ped.pdv_data, ea.eta_descricao, usu_nome,grupo, pn.nome, familia, rs.rvs_nome
  `;
}

// Firebird vendas — Lockey SP (11) + FAST (12), mesma base
const FB_VENDAS_LOCKEY = `
  select CASE WHEN ped.emp_fil_codigo = '11' THEN 'Lockey SP' WHEN ped.emp_fil_codigo = '12' THEN 'FAST' END as emp,ped.pdv_data, ea.eta_descricao, r.rep_nome usu_nome,g.nome grupo, pn.nome subgrupo, pg.nome as familia ,sum(i.pvi_quantidade) qtde, rs.rvs_nome,
  (SUM((COALESCE(i.PVI_TOTALITEM,0) +
  COALESCE(i.PVI_SUBSTICMS,0) +
  COALESCE(i.pvi_vl_fcp_st,0)+
  COALESCE(i.PVI_IPIVALOR,0)))) as total
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
  where ped.pdv_data > DATEADD(MONTH, -8, current_date)
  and ped.pdv_psi_codigo not in ('CC')
  and ped.pdv_tve_codigo not in ('6','7','26', '34')
  and c.cli_codigo not in ('44274','98030','49268')
  and ped.emp_fil_codigo in ('11','12')
  group by emp,ped.pdv_data, ea.eta_descricao, usu_nome,grupo, pn.nome, familia, rs.rvs_nome
`;

// MySQL vendas — Lockey RS e Niterói (mesma estrutura SAS)
function mysqlVendas(emp: string) {
  return `
    select '${emp}' as emp, o.\`Data\` as pdv_data,o.NomeVendedor as usu_nome, v.departamento as eta_descricao, p.Grupo as grupo, v.departamento as rvs_nome,
    p.subGrupo as subgrupo, p.fabricante as familia, sum(i.Qtd) qtde, sum(i.Total) as total
    from orcamentoitens i
    inner join orcamento o on i.Numero = o.IdPedido
    inner join pacad p on p.codigopro = i.CodigoVenda
    inner join vendedores v on v.codid = o.vendedor
    where o.\`Data\` >= DATE_SUB(CURDATE(), INTERVAL 4 MONTH)
    and o.Orcamento = 'PEDIDO'
    and o.wsalt not in ('2')
    and o.idFormaPagamento not in ('26')
    group by 1,2,3,4,5,6,7,8
  `;
}

const LABELS_VENDAS = ['SJC', 'SPM', 'LOCKEY MG', 'LOCKEY SP/FAST', 'LOCKEY RS', 'NITEROI'];

// ─── externo/recebimentos helpers ────────────────────────────────────────────
// Firebird recebimentos — emp literal (SJC, SPM, LOCKEY MG)
function fbRecebimentos(emp: string) {
  return `
    select '${emp}' as emp, r.rec_numero, b.rbx_dataliberacao as rec_data, r.rec_pedido, r.rec_vencimento, r.rec_valorpago,rep.rep_nome,
    c.cli_nome ,e.eta_descricao ,b.rbx_datapagamento as databaixa,rep.rep_obs1 ,sum(b.rbx_valorbasecomissao) as total
    from receber_titulos r
    inner join receber_baixas b on b.rbx_rec_id = r.rec_id
    inner join representantes rep on rep.rep_codigo = r.rec_rep_codigo
    inner join clientes c on c.cli_codigo = r.rec_cli_codigo
    left join entidades_atividades e on e.eta_codigo = c.cli_eta_codigo
    where b.rbx_dataliberacao > DATEADD(MONTH, -4, current_date)
    and b.rbx_valorbasecomissao > 0
    group by emp, r.rec_numero, rec_data, r.rec_pedido, r.rec_vencimento, r.rec_valorpago,rep.rep_nome, e.eta_descricao ,c.cli_nome,b.rbx_datapagamento, rep.rep_obs1
  `;
}

// Firebird recebimentos — Lockey SP (11) + FAST (12), mesma base
const FB_RECEB_LOCKEY = `
  select CASE WHEN r.rec_fil_codigo = '11' THEN 'LOCKEY SP' WHEN r.rec_fil_codigo = '12' THEN 'FAST' END as emp, r.rec_numero, b.rbx_dataliberacao as rec_data, r.rec_pedido, r.rec_vencimento, r.rec_valorpago,rep.rep_nome,
  c.cli_nome ,e.eta_descricao ,b.rbx_datapagamento as databaixa,rep.rep_obs1 ,sum(b.rbx_valorbasecomissao) as total
  from receber_titulos r
  inner join receber_baixas b on b.rbx_rec_id = r.rec_id
  inner join representantes rep on rep.rep_codigo = r.rec_rep_codigo
  inner join clientes c on c.cli_codigo = r.rec_cli_codigo
  left join entidades_atividades e on e.eta_codigo = c.cli_eta_codigo
  where b.rbx_dataliberacao > DATEADD(MONTH, -4, current_date)
  and b.rbx_valorbasecomissao > 0
  and r.rec_fil_codigo in ('11','12')
  group by emp, r.rec_numero, rec_data, r.rec_pedido, r.rec_vencimento, r.rec_valorpago,rep.rep_nome, e.eta_descricao ,c.cli_nome,b.rbx_datapagamento, rep.rep_obs1
`;

// MySQL recebimentos — Lockey RS e Niterói (mesma estrutura SAS)
function mysqlRecebimentos(emp: string) {
  return `
    select '${emp}' as emp,c.Titulo as rec_numero ,c.Emissao as rec_data,c.Vencimento as rec_vencimento, c.ValorPago as rec_valorpago,v.nomevende as rep_nome, c.NomeDevedor as cli_nome,'ATACADO' as eta_descricao, c.DataBaixa, sum(c.ValorPago) as total
    from contasreceber c
    inner join vendedores v on v.CodId = c.IdVendedor
    where c.DataBaixa >= DATE_SUB(CURDATE(), INTERVAL 4 MONTH)
    group by 1,2,3,4,5,6,7,8,9
  `;
}

const LABELS_RECEB = ['SJC', 'SPM', 'LOCKEY MG', 'LOCKEY SP/FAST', 'LOCKEY RS', 'NITEROI'];

// ═══════════════════════════════════════════════════════════════════════════
// GET /dashboard
// ═══════════════════════════════════════════════════════════════════════════
router.get("/dashboard", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  if (!isADM(usuario.cargo)) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  const ano = parseInt(req.query.ano || new Date().getFullYear().toString());
  const mes = req.query.mes;

  const dataInicio = mes ? `${ano}-${String(mes).padStart(2, '0')}-01` : `${ano}-01-01`;
  const dataFim = mes
    ? new Date(ano, parseInt(mes), 0).toISOString().split('T')[0]
    : `${ano}-12-31`;

  const verTudo = podeVerTudo(usuario.cargo);
  const userSetores = verTudo ? [] : usuario.setores;

  try {
    const [todasVendas, todosReceb] = await Promise.all([
      getVendas(ano),
      getRecebimentos(ano),
    ]);

    const fBase = { userSetores, setores: [], inicio: `${ano}-01-01`, fim: `${ano}-12-31` };
    const fPeriodo = { userSetores, setores: [], inicio: dataInicio, fim: dataFim };

    const vendasAno = filtrarVendas(todasVendas, fBase);
    const vendasPeriodo = filtrarVendas(todasVendas, fPeriodo);

    // Vendedores inativos não aparecem em nenhuma estatística por vendedor
    let inativosSet = new Set<string>();
    try {
      inativosSet = await getVendedoresInativos();
    } catch { /* se falhar, não filtra inativos */ }
    const vendasAnoAtivos = vendasAno.filter(v => !v.USU_NOME || !inativosSet.has(v.USU_NOME));
    const vendasPeriodoAtivos = vendasPeriodo.filter(v => !v.USU_NOME || !inativosSet.has(v.USU_NOME));

    // ── Total Ano ──────────────────────────────────────────────────────────
    const total_vendas = somarVendas(vendasAno);
    const total_vendedores = new Set(vendasAnoAtivos.filter(v => v.SUM > 0 && v.USU_NOME).map(v => v.USU_NOME)).size;
    const total_setores = new Set(vendasAno.filter(v => v.RVS_NOME).map(v => v.RVS_NOME)).size;

    // ── Total Mês / Período ────────────────────────────────────────────────
    const total_vendas_mes = somarVendas(vendasPeriodo);

    // ── Top 10 vendedores (período) ────────────────────────────────────────
    const byVend = groupBy(vendasPeriodoAtivos.filter(v => v.USU_NOME), v => `${v.USU_NOME}||${v.RVS_NOME}||${v.EMP}`);
    const top_vendedores = [...byVend.entries()]
      .map(([k, rows]) => {
        const [vendedor, setor, empresa] = k.split('||');
        return {
          vendedor,
          setor,
          empresa,
          total_vendas: somarVendas(rows),
          total_qtde: rows.reduce((s, r) => s + r.QTDE, 0),
          total_registros: rows.length,
        };
      })
      .sort((a, b) => b.total_vendas - a.total_vendas)
      .slice(0, 10);

    // ── Vendas por setor (período) ─────────────────────────────────────────
    const bySetor = groupBy(vendasPeriodo.filter(v => v.RVS_NOME), v => v.RVS_NOME!);
    const vendas_por_setor = [...bySetor.entries()]
      .map(([setor, rows]) => ({
        setor,
        total_vendas: somarVendas(rows),
        total_qtde: rows.reduce((s, r) => s + r.QTDE, 0),
        total_registros: rows.length,
      }))
      .sort((a, b) => b.total_vendas - a.total_vendas);

    // ── Vendas por empresa (ano) ───────────────────────────────────────────
    const byEmp = groupBy(vendasAno, v => v.EMP);
    const vendas_por_empresa = [...byEmp.entries()]
      .map(([empresa, rows]) => ({
        empresa,
        total_vendas: somarVendas(rows),
        total_qtde: rows.reduce((s, r) => s + r.QTDE, 0),
      }))
      .sort((a, b) => b.total_vendas - a.total_vendas);

    // ── Tendência mensal (ano) ─────────────────────────────────────────────
    const byMes = groupBy(vendasAno, v => {
      const m = v.PDV_DATA.getMonth() + 1;
      return `${ano}-${String(m).padStart(2, '0')}`;
    });
    const tendencia_mensal = [...byMes.entries()]
      .map(([key, rows]) => {
        const m = parseInt(key.split('-')[1]);
        return {
          ano,
          mes: m,
          total_vendas: somarVendas(rows),
          total_qtde: rows.reduce((s, r) => s + r.QTDE, 0),
        };
      })
      .sort((a, b) => a.mes - b.mes);

    // ── Comissão Televendas (só quando mês selecionado) ────────────────────
    let total_pa_televendas = 0;
    let total_recebimentos_televendas = 0;
    let total_comissao_televendas = 0;

    if (mes) {
      try {
        const pool = await getPool();

        const televendasSetores = ['TELEVENDAS', 'TELEVENDAS MG'];

        // PA = vendas televendas no período
        const vendasTv = filtrarVendas(todasVendas, { ...fPeriodo, setores: televendasSetores });
        const paMap: Record<string, number> = {};
        vendasTv.filter(v => v.USU_NOME && !inativosSet.has(v.USU_NOME)).forEach(v => {
          paMap[v.USU_NOME!] = (paMap[v.USU_NOME!] ?? 0) + v.SUM;
        });

        // Vendedores televendas
        const vendedoresTv = Object.keys(paMap);

        // Recebimentos televendas no período
        const recebTv = filtrarReceb(todosReceb, { inicio: dataInicio, fim: dataFim });
        const recMap: Record<string, number> = {};
        recebTv
          .filter(r => r.REP_NOME && vendedoresTv.includes(r.REP_NOME))
          .forEach(r => { recMap[r.REP_NOME!] = (recMap[r.REP_NOME!] ?? 0) + r.TOTAL; });

        // Metas e bônus do SQL Server (configuração permanece lá)
        const [metaResult, bonusResult] = await Promise.all([
          pool.request()
            .input('metaAno', sql.Int, ano)
            .input('metaMes', sql.VarChar, mes)
            .query(`
              SELECT VENDEDOR as nome_vendedor,
                     META1_VALOR as meta1_valor, META1_PERCENTUAL as meta1_percentual,
                     META2_VALOR as meta2_valor, META2_PERCENTUAL as meta2_percentual,
                     META3_VALOR as meta3_valor, META3_PERCENTUAL as meta3_percentual,
                     ISNULL(PERCENTUAL_SEM_META,0) as percentual_sem_meta
              FROM [TI-PAINELCOMISSAO_METAS]
              WHERE ANO = @metaAno AND MES = @metaMes
            `),
          pool.request().query(`
            SELECT TOP 1
                   BONUS1_VALOR as bonus1_valor, BONUS1_PERCENTUAL as bonus1_percentual,
                   BONUS2_VALOR as bonus2_valor, BONUS2_PERCENTUAL as bonus2_percentual,
                   BONUS3_VALOR as bonus3_valor, BONUS3_PERCENTUAL as bonus3_percentual,
                   BONUS4_VALOR as bonus4_valor, BONUS4_PERCENTUAL as bonus4_percentual,
                   BONUS5_VALOR as bonus5_valor, BONUS5_PERCENTUAL as bonus5_percentual
            FROM [TI-PAINELCOMISSAO_BONUS_CONFIG]
          `),
        ]);

        const metaMap: Record<string, MetaConfig> = {};
        metaResult.recordset.forEach((r: any) => {
          metaMap[r.nome_vendedor] = {
            meta1_valor: r.meta1_valor, meta1_percentual: r.meta1_percentual,
            meta2_valor: r.meta2_valor, meta2_percentual: r.meta2_percentual,
            meta3_valor: r.meta3_valor, meta3_percentual: r.meta3_percentual,
            percentual_sem_meta: r.percentual_sem_meta,
          };
        });

        const bonusRow = bonusResult.recordset[0] as any | null;
        const bonus: BonusConfig | null = bonusRow ? {
          bonus1_valor: bonusRow.bonus1_valor, bonus1_percentual: bonusRow.bonus1_percentual,
          bonus2_valor: bonusRow.bonus2_valor, bonus2_percentual: bonusRow.bonus2_percentual,
          bonus3_valor: bonusRow.bonus3_valor, bonus3_percentual: bonusRow.bonus3_percentual,
          bonus4_valor: bonusRow.bonus4_valor, bonus4_percentual: bonusRow.bonus4_percentual,
          bonus5_valor: bonusRow.bonus5_valor, bonus5_percentual: bonusRow.bonus5_percentual,
        } : null;

        const allVendors = new Set([...Object.keys(paMap), ...Object.keys(recMap)]);
        for (const vendedor of allVendors) {
          const pa = paMap[vendedor] || 0;
          const rec = recMap[vendedor] || 0;
          total_pa_televendas += pa;
          total_recebimentos_televendas += rec;
          const meta = metaMap[vendedor] || null;
          if (meta) {
            const c = calcularComissaoTelevendas(pa, rec, meta, bonus);
            total_comissao_televendas += c.comissao_total;
          }
        }
      } catch (commErr) {
        console.error('[dashboard] comissão Televendas falhou:', commErr);
      }
    }

    return res.json({
      total_vendas,
      total_vendas_mes,
      total_vendedores,
      total_setores,
      top_vendedores,
      vendas_por_setor,
      vendas_por_empresa,
      tendencia_mensal,
      total_pa_televendas,
      total_recebimentos_televendas,
      total_comissao_televendas,
    });
  } catch (error) {
    console.error('Erro ao buscar dashboard:', error);
    return res.status(500).json({ error: 'Erro ao buscar dados' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /filtros
// ═══════════════════════════════════════════════════════════════════════════
router.get("/filtros", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  try {
    const ano = new Date().getFullYear();
    const verTudo = podeVerTudo(usuario.cargo);

    // Lê todos os vendedores do ano dos bancos externos
    const todasVendas = await getVendas(ano);

    if (usuario.cargo === 'VENDEDOR') {
      const setorFiltroVend = req.query.setor;
      const setoresFiltroVend = setorFiltroVend
        ? String(setorFiltroVend).split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];
      const vendasVend = filtrarVendas(todasVendas, {
        inicio: `${ano}-01-01`,
        fim: `${ano}-12-31`,
        userSetores: [],
        setores: setoresFiltroVend,
      });
      const nomes = [...new Set(vendasVend.map((v) => v.USU_NOME).filter(Boolean))].sort();
      return res.json({
        vendedores: filtrarVendedoresPorConfig(nomes, usuario.nome_vendedor),
        setores: [],
        empresas: [],
      });
    }

    // Aplica filtro de setores do usuário (GESTOR só vê seus setores)
    const userSetores = verTudo ? [] : usuario.setores;
    const setorFiltro = req.query.setor;
    const setoresFiltro = setorFiltro ? String(setorFiltro).split(',').map((s: string) => s.trim()).filter(Boolean) : [];
    const vendas = filtrarVendas(todasVendas, {
      inicio: `${ano}-01-01`,
      fim: `${ano}-12-31`,
      userSetores,
      setores: setoresFiltro,
    });

    // Vendedores inativos (ainda vem do SQL Server)
    let inativosSet = new Set<string>();
    try {
      inativosSet = await getVendedoresInativos();
    } catch { /* se falhar, não filtra inativos */ }

    const vendedores = [...new Set(
      vendas.filter(v => v.USU_NOME && !inativosSet.has(v.USU_NOME)).map(v => v.USU_NOME!)
    )].sort();

    const setores = verTudo
      ? [...SETORES_ATIVOS]
      : usuario.setores.filter(s => (SETORES_ATIVOS as readonly string[]).includes(s));

    const empresas = [...new Set(vendas.map(v => v.EMP).filter(Boolean))].sort();

    res.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
    return res.json({ vendedores, setores, empresas });
  } catch (error) {
    console.error('Erro ao buscar filtros:', error);
    return res.status(500).json({ error: 'Erro ao buscar dados' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /vendedores
// ═══════════════════════════════════════════════════════════════════════════
router.get("/vendedores", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  if (usuario.cargo === 'VENDEDOR') {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  const ano = parseInt(req.query.ano || new Date().getFullYear().toString());
  const mes = req.query.mes;
  const setor = req.query.setor;
  const empresa = req.query.empresa;

  const dataInicio = mes ? `${ano}-${String(mes).padStart(2, '0')}-01` : `${ano}-01-01`;
  const dataFim = mes
    ? new Date(ano, parseInt(mes), 0).toISOString().split('T')[0]
    : `${ano}-12-31`;

  const verTudo = podeVerTudo(usuario.cargo);
  const userSetores = verTudo ? [] : usuario.setores;

  // Filtro de setor manual dentro dos setores permitidos
  if (setor && !verTudo && !usuario.setores.includes(setor)) {
    return res.json([]);
  }

  try {
    const [todasVendas, todosReceb] = await Promise.all([
      getVendas(ano),
      getRecebimentos(ano),
    ]);

    let inativosSet = new Set<string>();
    try {
      inativosSet = await getVendedoresInativos();
    } catch { /* se falhar, não filtra inativos */ }

    const vendas = filtrarVendas(todasVendas, {
      inicio: dataInicio,
      fim: dataFim,
      userSetores,
      setores: setor ? [setor] : [],
      empresa: empresa ?? undefined,
    }).filter(v => v.USU_NOME !== null && !inativosSet.has(v.USU_NOME));

    const recMap: Record<string, number> = {};
    filtrarReceb(todosReceb, { inicio: dataInicio, fim: dataFim }).forEach(r => {
      if (r.REP_NOME) recMap[r.REP_NOME] = (recMap[r.REP_NOME] ?? 0) + r.TOTAL;
    });

    // Agrupa por vendedor + setor (equivalente ao GROUP BY USU_NOME, RVS_NOME)
    const byKey = groupBy(vendas, v => `${v.USU_NOME}||${v.RVS_NOME ?? ''}`);

    const resultado = [...byKey.entries()]
      .map(([key, rows]) => {
        const [vendedor, setorV] = key.split('||');
        const datas = rows.map(r => r.PDV_DATA.getTime());
        return {
          vendedor,
          setor: setorV,
          empresa: rows[0].EMP,
          total_vendas: somarVendas(rows),
          total_qtde: rows.reduce((s, r) => s + r.QTDE, 0),
          total_registros: rows.length,
          primeira_venda: new Date(Math.min(...datas)),
          ultima_venda: new Date(Math.max(...datas)),
          valor_pa: rows.reduce((s, r) => {
            const isPA = r.SUBGRUPO === 'CHAVE' || ['PRODUÇÃO', 'DOVALE'].includes(r.GRUPO ?? '');
            return s + (isPA ? r.SUM : 0);
          }, 0),
          total_recebido: recMap[vendedor] ?? 0,
          is_televendas: isTelevendas(setorV),
        };
      })
      .sort((a, b) => b.total_vendas - a.total_vendas);

    res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
    return res.json(resultado);
  } catch (error) {
    console.error('Erro ao buscar vendedores:', error);
    return res.status(500).json({ error: 'Erro ao buscar dados' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /vendedor/:nome
// ═══════════════════════════════════════════════════════════════════════════
router.get("/vendedor/:nome", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  const vendedor = decodeURIComponent(req.params.nome).trim();

  if (usuario.cargo === 'VENDEDOR' && !vendedorCasaComConfig(vendedor, usuario.nome_vendedor)) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  try {
    const inativosSet = await getVendedoresInativos();
    if (inativosSet.has(vendedor)) {
      return res.status(404).json({ error: 'Vendedor inativo' });
    }
  } catch { /* se falhar, não bloqueia por inativo */ }

  const ano = parseInt(req.query.ano || new Date().getFullYear().toString());
  const mes = req.query.mes;

  const dataInicio = mes ? `${ano}-${String(mes).padStart(2, '0')}-01` : `${ano}-01-01`;
  const dataFim = mes
    ? new Date(ano, parseInt(mes), 0).toISOString().split('T')[0]
    : `${ano}-12-31`;

  try {
    const [todasVendas, todosReceb] = await Promise.all([
      getVendas(ano),
      getRecebimentos(ano),
    ]);

    // Filtro base: só esse vendedor, aplicando SETORES_ATIVOS
    const userSetores = usuario.cargo === "GESTOR" ? usuario.setores : [];
    const fPeriodo = { inicio: dataInicio, fim: dataFim, userSetores, setores: [], vendedor };
    const fAno = { inicio: `${ano}-01-01`, fim: `${ano}-12-31`, userSetores, setores: [], vendedor };

    const vendasPeriodo = filtrarVendas(todasVendas, fPeriodo);
    const vendasAno = filtrarVendas(todasVendas, fAno);

    if (usuario.cargo === "GESTOR" && vendasAno.length === 0) {
      return res.status(403).json({ error: "Sem permissÃ£o" });
    }

    // ── Resumo ─────────────────────────────────────────────────────────────
    const byResumo = groupBy(vendasPeriodo, v => `${v.USU_NOME}||${v.RVS_NOME ?? ''}||${v.EMP}`);
    const resumo = [...byResumo.entries()].map(([k, rows]) => {
      const [vend, setor, empresa] = k.split('||');
      return {
        vendedor: vend,
        setor,
        empresa,
        total_vendas: somarVendas(rows),
        total_qtde: rows.reduce((s, r) => s + r.QTDE, 0),
        total_registros: rows.length,
      };
    });

    // Permissão GESTOR: verifica se o setor do vendedor está nos setores do usuário
    if (!podeVerTudo(usuario.cargo) && usuario.cargo !== 'VENDEDOR') {
      const setorDoVendedor = resumo[0]?.setor;
      if (setorDoVendedor && !usuario.setores.includes(setorDoVendedor)) {
        return res.status(403).json({ error: 'Sem permissão' });
      }
    }

    // ── Mensal (ano completo) ──────────────────────────────────────────────
    const byMes = groupBy(vendasAno, v => String(v.PDV_DATA.getMonth() + 1));
    const mensal = [...byMes.entries()]
      .map(([m, rows]) => ({
        mes: parseInt(m),
        total_vendas: somarVendas(rows),
        total_qtde: rows.reduce((s, r) => s + r.QTDE, 0),
      }))
      .sort((a, b) => a.mes - b.mes);

    // ── Por Subgrupo ───────────────────────────────────────────────────────
    const bySub = groupBy(vendasPeriodo, v => v.SUBGRUPO ?? '');
    const porSubgrupo = [...bySub.entries()]
      .map(([subgrupo, rows]) => ({
        subgrupo,
        total_vendas: somarVendas(rows),
        total_qtde: rows.reduce((s, r) => s + r.QTDE, 0),
      }))
      .sort((a, b) => b.total_vendas - a.total_vendas);

    // ── Vendas detalhadas (TOP 100) ────────────────────────────────────────
    const vendas = vendasPeriodo
      .sort((a, b) => b.PDV_DATA.getTime() - a.PDV_DATA.getTime())
      .slice(0, 100)
      .map(v => ({
        data: v.PDV_DATA,
        cliente: v.ETA_DESCRICAO,
        subgrupo: v.SUBGRUPO,
        familia: v.FAMILIA,
        qtde: v.QTDE,
        valor: v.SUM,
        empresa: v.EMP,
      }));

    // ── PA ─────────────────────────────────────────────────────────────────
    const valor_pa = vendasPeriodo.reduce((s, v) => {
      const isPA = v.SUBGRUPO === 'CHAVE' || ['PRODUÇÃO', 'DOVALE'].includes(v.GRUPO ?? '');
      return s + (isPA ? v.SUM : 0);
    }, 0);
    const valor_chave = vendasPeriodo.reduce((s, v) => s + (v.SUBGRUPO === 'CHAVE' ? v.SUM : 0), 0);
    const valor_ferragens_pa = vendasPeriodo.reduce((s, v) => {
      const isFerragens = ['PRODUÇÃO', 'DOVALE'].includes(v.GRUPO ?? '') && v.SUBGRUPO !== 'CHAVE';
      return s + (isFerragens ? v.SUM : 0);
    }, 0);
    const valor_mercadoria = vendasPeriodo.reduce((s, v) => {
      const isMerc = v.SUBGRUPO !== 'CHAVE' && !['PRODUÇÃO', 'DOVALE'].includes(v.GRUPO ?? '');
      return s + (isMerc ? v.SUM : 0);
    }, 0);

    // ── Setor ──────────────────────────────────────────────────────────────
    const setor = resumo[0]?.setor ?? '';
    const is_televendas = isTelevendas(setor);
    const is_ferragens = isFerragens(setor);
    const is_distribuidores = isDistribuidores(setor);

    const pool = await getPool();

    // Garante coluna PERCENTUAL_SEM_META
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'TI-PAINELCOMISSAO_METAS' AND COLUMN_NAME = 'PERCENTUAL_SEM_META'
      )
      BEGIN ALTER TABLE [TI-PAINELCOMISSAO_METAS] ADD PERCENTUAL_SEM_META FLOAT DEFAULT 0; END
    `).catch(() => {});

    // Meta mensal (SQL Server — configuração permanece lá)
    let metaVendedor = { recordset: [] as Array<Record<string, unknown>> };
    if (mes) {
      metaVendedor = await pool.request()
        .input('nomeVend', sql.VarChar, vendedor)
        .input('anoMeta', sql.Int, ano)
        .input('mesMeta', sql.VarChar, mes)
        .query(`SELECT META1_VALOR as meta1_valor, META1_PERCENTUAL as meta1_percentual,
                       META2_VALOR as meta2_valor, META2_PERCENTUAL as meta2_percentual,
                       META3_VALOR as meta3_valor, META3_PERCENTUAL as meta3_percentual,
                       ISNULL(PERCENTUAL_SEM_META,0) as percentual_sem_meta
                FROM [TI-PAINELCOMISSAO_METAS]
                WHERE VENDEDOR=@nomeVend AND ANO=@anoMeta AND MES=@mesMeta`)
        .catch(() => ({ recordset: [] as Array<Record<string, unknown>> }));
    }

    // Bônus (SQL Server)
    let bonusConfig: BonusConfig | null = null;
    if (is_televendas) {
      const bonusResult = await pool.request()
        .query(`SELECT TOP 1
                  BONUS1_VALOR as bonus1_valor, BONUS1_PERCENTUAL as bonus1_percentual,
                  BONUS2_VALOR as bonus2_valor, BONUS2_PERCENTUAL as bonus2_percentual,
                  BONUS3_VALOR as bonus3_valor, BONUS3_PERCENTUAL as bonus3_percentual,
                  BONUS4_VALOR as bonus4_valor, BONUS4_PERCENTUAL as bonus4_percentual,
                  BONUS5_VALOR as bonus5_valor, BONUS5_PERCENTUAL as bonus5_percentual
                FROM [TI-PAINELCOMISSAO_BONUS_CONFIG]`)
        .catch(() => ({ recordset: [] as Array<Record<string, unknown>> }));
      if (bonusResult.recordset.length) bonusConfig = bonusResult.recordset[0] as unknown as BonusConfig;
    }

    // Recebimentos do vendedor no período
    let total_recebido = 0;
    if ((is_televendas || is_ferragens || is_distribuidores) && mes) {
      total_recebido = somarReceb(
        filtrarReceb(todosReceb, { inicio: dataInicio, fim: dataFim, vendedor })
      );
    }

    const metaRow = metaVendedor.recordset[0] as unknown as MetaConfig | null;
    const comissao_televendas = is_televendas
      ? calcularComissaoTelevendas(valor_pa, total_recebido, metaRow, bonusConfig)
      : null;

    // ── Ferragens ─────────────────────────────────────────────────────────────
    let comissao_ferragens = null;
    let ferr_meta: FerrMetaConfig | null = null;
    let ferr_bonus: FerrBonusConfig | null = null;
    let ferr_meta_grupo: FerrMetaGrupoConfig | null = null;
    let vendas_setor_ferragens = 0;

    if (is_ferragens && mes) {
      try {
        await ensureFerrTables();
        const [fMetaRes, fBonusRes, fGrupoRes] = await Promise.all([
          pool.request()
            .input('fv', sql.VarChar, vendedor)
            .input('fa', sql.Int, ano)
            .input('fm', sql.Int, parseInt(mes))
            .query(`SELECT META1_VALOR as meta1_valor, META1_PERCENTUAL as meta1_percentual,
                           META2_VALOR as meta2_valor, META2_PERCENTUAL as meta2_percentual,
                           META3_VALOR as meta3_valor, META3_PERCENTUAL as meta3_percentual,
                           METADESAFIO_VALOR as metadesafio_valor, METADESAFIO_PERCENTUAL as metadesafio_percentual,
                           PERCENTUAL_SEM_META as percentual_sem_meta
                    FROM [TI-PAINELCOMISSAO_FERRAGENS_METAS]
                    WHERE VENDEDOR=@fv AND ANO=@fa AND MES=@fm`),
          pool.request()
            .input('fv', sql.VarChar, vendedor)
            .input('fa', sql.Int, ano)
            .input('fm', sql.Int, parseInt(mes))
            .query(`SELECT BONUS1_VALOR as bonus1_valor, BONUS2_VALOR as bonus2_valor,
                           BONUS3_VALOR as bonus3_valor, BONUSDESAFIO_VALOR as bonusdesafio_valor
                    FROM [TI-PAINELCOMISSAO_FERRAGENS_BONUS]
                    WHERE VENDEDOR=@fv AND ANO=@fa AND MES=@fm`),
          pool.request()
            .input('fa', sql.Int, ano)
            .input('fm', sql.Int, parseInt(mes))
            .query(`SELECT TOP 1
                           META1_VALOR as meta1_valor, META1_BONUS as meta1_bonus,
                           META2_VALOR as meta2_valor, META2_BONUS as meta2_bonus,
                           META3_VALOR as meta3_valor, META3_BONUS as meta3_bonus,
                           METADESAFIO_VALOR as metadesafio_valor, METADESAFIO_BONUS as metadesafio_bonus
                    FROM [TI-PAINELCOMISSAO_FERRAGENS_META_GRUPO]
                    WHERE ANO=@fa AND MES=@fm`),
        ]).catch(() => [{ recordset: [] }, { recordset: [] }, { recordset: [] }]) as [
          { recordset: Record<string,unknown>[] },
          { recordset: Record<string,unknown>[] },
          { recordset: Record<string,unknown>[] }
        ];

        if (fMetaRes.recordset.length) ferr_meta = fMetaRes.recordset[0] as unknown as FerrMetaConfig;
        if (fBonusRes.recordset.length) ferr_bonus = fBonusRes.recordset[0] as unknown as FerrBonusConfig;
        if (fGrupoRes.recordset.length) ferr_meta_grupo = fGrupoRes.recordset[0] as unknown as FerrMetaGrupoConfig;

        // Total vendas setor FERRAGENS no período
        const vendasFerragens = filtrarVendas(todasVendas, {
          inicio: dataInicio, fim: dataFim, userSetores, setores: ['FERRAGENS'],
        });
        vendas_setor_ferragens = vendasFerragens.reduce((s, v) => s + v.SUM, 0);

        // Total vendas do vendedor (geral, não só PA)
        const vendas_total_vendedor = vendasPeriodo.reduce((s, v) => s + v.SUM, 0);

        comissao_ferragens = calcularComissaoFerragens(
          vendas_total_vendedor, total_recebido,
          ferr_meta, ferr_bonus,
          vendas_setor_ferragens, ferr_meta_grupo,
        );
      } catch (e) {
        console.error('[vendedor ferragens]', e);
      }
    }

    // ── Distribuidores ───────────────────────────────────────────────────────
    let comissao_distribuidores = null;
    let dist_meta: DistMetaConfig | null = null;
    let dist_bonus: DistBonusConfig | null = null;

    if (is_distribuidores && mes) {
      try {
        await ensureDistTables();
        const [distMetaRes, distBonusRes] = await Promise.all([
          pool.request()
            .input('dv', sql.VarChar, vendedor)
            .input('da', sql.Int, ano)
            .input('dm', sql.Int, parseInt(mes))
            .query(`SELECT META1_VALOR as meta1_valor, META1_PERCENTUAL as meta1_percentual,
                           META2_VALOR as meta2_valor, META2_PERCENTUAL as meta2_percentual,
                           META3_VALOR as meta3_valor, META3_PERCENTUAL as meta3_percentual,
                           METADESAFIO_VALOR as metadesafio_valor, METADESAFIO_PERCENTUAL as metadesafio_percentual,
                           PERCENTUAL_SEM_META as percentual_sem_meta
                    FROM [TI-PAINELCOMISSAO_DISTRIBUIDORES_METAS]
                    WHERE VENDEDOR=@dv AND ANO=@da AND MES=@dm`)
            .catch(() => ({ recordset: [] as Array<Record<string, unknown>> })),
          pool.request()
            .input('dv', sql.VarChar, vendedor)
            .input('da', sql.Int, ano)
            .input('dm', sql.Int, parseInt(mes))
            .query(`SELECT BONUS1_VALOR as bonus1_valor, BONUS2_VALOR as bonus2_valor,
                           BONUS3_VALOR as bonus3_valor, BONUSDESAFIO_VALOR as bonusdesafio_valor
                    FROM [TI-PAINELCOMISSAO_DISTRIBUIDORES_BONUS]
                    WHERE VENDEDOR=@dv AND ANO=@da AND MES=@dm`)
            .catch(() => ({ recordset: [] as Array<Record<string, unknown>> })),
        ]);

        if (distMetaRes.recordset.length) dist_meta = distMetaRes.recordset[0] as unknown as DistMetaConfig;
        if (distBonusRes.recordset.length) dist_bonus = distBonusRes.recordset[0] as unknown as DistBonusConfig;

        const vendas_total_vendedor_dist = vendasPeriodo.reduce((s, v) => s + v.SUM, 0);
        comissao_distribuidores = calcularComissaoDistribuidores(vendas_total_vendedor_dist, total_recebido, dist_meta, dist_bonus);
      } catch (e) {
        console.error('[vendedor distribuidores]', e);
      }
    }

    return res.json({
      resumo,
      mensal,
      porSubgrupo,
      vendas,
      meta_vendedor: metaVendedor.recordset[0] || null,
      is_televendas,
      is_ferragens,
      is_distribuidores,
      valor_pa,
      valor_chave,
      valor_ferragens_pa,
      valor_mercadoria,
      total_recebido,
      bonus_config: bonusConfig,
      comissao_televendas,
      comissao_ferragens,
      ferr_meta,
      ferr_bonus,
      ferr_meta_grupo,
      vendas_setor_ferragens,
      comissao_distribuidores,
      dist_meta,
      dist_bonus,
    });
  } catch (error) {
    console.error('Erro ao buscar vendedor:', error);
    return res.status(500).json({ error: 'Erro ao buscar dados' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /vendedor/:nome/evolucao — últimos 6 meses (total vendas + PA)
// ═══════════════════════════════════════════════════════════════════════════
router.get("/vendedor/:nome/evolucao", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  const vendedor = decodeURIComponent(req.params.nome).trim();

  if (usuario.cargo === 'VENDEDOR' && !vendedorCasaComConfig(vendedor, usuario.nome_vendedor)) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  try {
    const inativosSet = await getVendedoresInativos();
    if (inativosSet.has(vendedor)) {
      return res.status(404).json({ error: 'Vendedor inativo' });
    }
  } catch { /* se falhar, não bloqueia por inativo */ }

  const hoje = new Date();
  const anoRef = parseInt(req.query.ano) || hoje.getFullYear();
  const mesRef = parseInt(req.query.mes) || hoje.getMonth() + 1;

  // Últimos 6 meses terminando em anoRef/mesRef (cruza virada de ano se necessário)
  const meses: { ano: number; mes: number }[] = [];
  let a = anoRef, m = mesRef;
  for (let i = 0; i < 6; i++) {
    meses.unshift({ ano: a, mes: m });
    m -= 1;
    if (m === 0) { m = 12; a -= 1; }
  }

  try {
    const anosNecessarios = [...new Set(meses.map((x) => x.ano))];
    const vendasPorAno = await Promise.all(anosNecessarios.map((ano) => getVendas(ano)));
    const todasVendas = vendasPorAno.flat();

    const userSetores = usuario.cargo === "GESTOR" ? usuario.setores : [];
    const primeiroMes = meses[0];
    const ultimoMes = meses[meses.length - 1];
    const inicio = `${primeiroMes.ano}-${String(primeiroMes.mes).padStart(2, '0')}-01`;
    const fim = new Date(ultimoMes.ano, ultimoMes.mes, 0).toISOString().split('T')[0];

    const vendasVendedor = filtrarVendas(todasVendas, { inicio, fim, userSetores, setores: [], vendedor });

    if (usuario.cargo === "GESTOR" && vendasVendedor.length === 0) {
      return res.status(403).json({ error: "Sem permissão" });
    }

    const setorDoVendedor = vendasVendedor[0]?.RVS_NOME ?? '';
    if (!podeVerTudo(usuario.cargo) && usuario.cargo !== 'VENDEDOR' && setorDoVendedor && !usuario.setores.includes(setorDoVendedor)) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const mapa = new Map<string, { total_vendas: number; valor_pa: number }>();
    meses.forEach(({ ano, mes }) => mapa.set(`${ano}-${mes}`, { total_vendas: 0, valor_pa: 0 }));

    vendasVendedor.forEach((v) => {
      const key = `${v.PDV_DATA.getFullYear()}-${v.PDV_DATA.getMonth() + 1}`;
      const entry = mapa.get(key);
      if (!entry) return;
      entry.total_vendas += v.SUM;
      const isPA = v.SUBGRUPO === 'CHAVE' || ['PRODUÇÃO', 'DOVALE'].includes(v.GRUPO ?? '');
      if (isPA) entry.valor_pa += v.SUM;
    });

    const evolucao = meses.map(({ ano, mes }) => ({ ano, mes, ...mapa.get(`${ano}-${mes}`)! }));

    return res.json({ evolucao, is_televendas: isTelevendas(setorDoVendedor) });
  } catch (error) {
    console.error('Erro ao buscar evolução do vendedor:', error);
    return res.status(500).json({ error: 'Erro ao buscar dados' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// /vendedor-ativo (GET, PUT)
// ═══════════════════════════════════════════════════════════════════════════
router.get("/vendedor-ativo", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario || !['ADM', 'GESTOR'].includes(usuario.cargo)) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  try {
    const pool = await getPool();
    await ensureVendedorAtivoTable();

    // All vendors from VendaPorSetor (same setor filter as filtros)
    const rVend = pool.request();
    const wVend = addSetoresGlobais(rVend, 'WHERE USU_NOME IS NOT NULL');
    const vendResult = await rVend.query(`
      SELECT DISTINCT USU_NOME as nome
      FROM [TI-COMERCIAL_45-VendaPorSetor]
      ${wVend}
      ORDER BY USU_NOME
    `);

    // Current status map
    const statusResult = await pool.request().query(`
      SELECT nome_vendedor, ativo FROM [TI-PAINELCOMISSAO_VENDEDOR_ATIVO]
    `);
    const statusMap: Record<string, boolean> = {};
    statusResult.recordset.forEach((r: any) => {
      statusMap[r.nome_vendedor] = r.ativo === true || r.ativo === 1;
    });

    const permitidos = await getVendedoresPermitidos(usuario);
    const vendors = filtrarLinhasPorVendedor(
      vendResult.recordset.map((r: any) => ({
      nome: r.nome as string,
      ativo: statusMap[r.nome] !== undefined ? statusMap[r.nome] : true,
      })),
      permitidos,
      "nome",
    );

    return res.json(vendors);
  } catch (err) {
    console.error('[vendedor-ativo GET]', err);
    return res.status(500).json({ error: 'Erro ao consultar banco' });
  }
});

router.put("/vendedor-ativo", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario || !['ADM', 'GESTOR'].includes(usuario.cargo)) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  const body = req.body;
  const { nome_vendedor, ativo } = body;
  if (!nome_vendedor || typeof ativo !== 'boolean') {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }

  try {
    const pool = await getPool();
    await ensureVendedorAtivoTable();

    if (!(await garantirVendedoresDoBody(usuario, [{ nome_vendedor }], new Date().getFullYear()))) {
      return res.status(403).json({ error: 'Sem permissÃ£o para este vendedor' });
    }

    await pool
      .request()
      .input('nome', sql.VarChar(200), nome_vendedor)
      .input('ativo', sql.Bit, ativo ? 1 : 0)
      .query(`
        MERGE [TI-PAINELCOMISSAO_VENDEDOR_ATIVO] AS target
        USING (SELECT @nome AS nome_vendedor) AS source
          ON target.nome_vendedor = source.nome_vendedor
        WHEN MATCHED THEN
          UPDATE SET ativo = @ativo
        WHEN NOT MATCHED THEN
          INSERT (nome_vendedor, ativo) VALUES (@nome, @ativo);
      `);

    return res.json({ ok: true });
  } catch (err) {
    console.error('[vendedor-ativo PUT]', err);
    return res.status(500).json({ error: 'Erro ao salvar' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// /metas (GET, PUT) — VendedorMeta
// ═══════════════════════════════════════════════════════════════════════════
router.get("/metas", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  try {
    await ensureVendedorMetaTable();
    const pool = await getPool();
    const result = await pool
      .request()
      .query('SELECT * FROM VendedorMeta ORDER BY nome_vendedor');
    const permitidos = await getVendedoresPermitidos(usuario);
    return res.json(filtrarLinhasPorVendedor(result.recordset, permitidos));
  } catch (error) {
    console.error('Erro ao buscar metas:', error);
    return res.status(500).json({ error: 'Erro ao buscar dados' });
  }
});

// Salva lista completa de vendedores em lote
router.put("/metas", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario || !isADM(usuario.cargo)) {
    return res.status(403).json({ error: 'Apenas ADM pode alterar metas' });
  }

  try {
    await ensureVendedorMetaTable();
    const metas: {
      nome_vendedor: string;
      meta1_valor: number; meta1_percentual: number;
      meta2_valor: number; meta2_percentual: number;
      meta3_valor: number; meta3_percentual: number;
    }[] = req.body;

    const pool = await getPool();

    for (const m of metas) {
      const existing = await pool
        .request()
        .input('nome', sql.VarChar, m.nome_vendedor)
        .query('SELECT id FROM VendedorMeta WHERE nome_vendedor = @nome');

      if (existing.recordset.length > 0) {
        await pool.request()
          .input('nome',  sql.VarChar,        m.nome_vendedor)
          .input('m1v',   sql.Decimal(18, 2), m.meta1_valor)
          .input('m1p',   sql.Decimal(5,  2), m.meta1_percentual)
          .input('m2v',   sql.Decimal(18, 2), m.meta2_valor)
          .input('m2p',   sql.Decimal(5,  2), m.meta2_percentual)
          .input('m3v',   sql.Decimal(18, 2), m.meta3_valor)
          .input('m3p',   sql.Decimal(5,  2), m.meta3_percentual)
          .query(`
            UPDATE VendedorMeta
            SET meta1_valor=@m1v, meta1_percentual=@m1p,
                meta2_valor=@m2v, meta2_percentual=@m2p,
                meta3_valor=@m3v, meta3_percentual=@m3p,
                atualizado_em=GETDATE()
            WHERE nome_vendedor=@nome
          `);
      } else {
        await pool.request()
          .input('nome',  sql.VarChar,        m.nome_vendedor)
          .input('m1v',   sql.Decimal(18, 2), m.meta1_valor)
          .input('m1p',   sql.Decimal(5,  2), m.meta1_percentual)
          .input('m2v',   sql.Decimal(18, 2), m.meta2_valor)
          .input('m2p',   sql.Decimal(5,  2), m.meta2_percentual)
          .input('m3v',   sql.Decimal(18, 2), m.meta3_valor)
          .input('m3p',   sql.Decimal(5,  2), m.meta3_percentual)
          .query(`
            INSERT INTO VendedorMeta
              (nome_vendedor,meta1_valor,meta1_percentual,meta2_valor,meta2_percentual,meta3_valor,meta3_percentual)
            VALUES (@nome,@m1v,@m1p,@m2v,@m2p,@m3v,@m3p)
          `);
      }
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Erro ao salvar metas:', error);
    return res.status(500).json({ error: 'Erro ao salvar' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// /metas-mensais (GET, PUT)
// ═══════════════════════════════════════════════════════════════════════════
router.get("/metas-mensais", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  const ano = req.query.ano;
  const mes = req.query.mes;

  try {
    const pool = await getPool();
    const hasPSM = await garantirColunaPSM(pool);
    const r = pool.request();
    let where = 'WHERE 1=1';
    if (ano) { r.input('ano', sql.Int, parseInt(ano)); where += ' AND ANO = @ano'; }
    if (mes) { r.input('mes', sql.VarChar, mes);       where += ' AND MES = @mes'; }

    const psmCol = hasPSM ? 'ISNULL(PERCENTUAL_SEM_META, 0) as percentual_sem_meta' : '0 as percentual_sem_meta';
    const result = await r.query(
      `SELECT VENDEDOR as nome_vendedor, ANO as ano, MES as mes,
              META1_VALOR as meta1_valor, META1_PERCENTUAL as meta1_percentual,
              META2_VALOR as meta2_valor, META2_PERCENTUAL as meta2_percentual,
              META3_VALOR as meta3_valor, META3_PERCENTUAL as meta3_percentual,
              ${psmCol}
       FROM ${TABELA_METAS_MENSAIS} ${where} ORDER BY VENDEDOR`
    );
    const permitidos = await getVendedoresPermitidos(usuario, ano ? parseInt(ano) : new Date().getFullYear(), SETORES_TELEVENDAS);
    res.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
    return res.json(filtrarLinhasPorVendedor(result.recordset, permitidos));
  } catch (error) {
    console.error('Erro ao buscar metas mensais:', error);
    return res.status(500).json({ error: 'Erro ao buscar dados' });
  }
});

router.put("/metas-mensais", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario || !['ADM', 'GESTOR'].includes(usuario.cargo)) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  try {
    const metas: {
      nome_vendedor: string; ano: number; mes: number;
      meta1_valor: number; meta1_percentual: number;
      meta2_valor: number; meta2_percentual: number;
      meta3_valor: number; meta3_percentual: number;
      percentual_sem_meta: number;
    }[] = req.body;

    const pool = await getPool();
    const hasPSM = await garantirColunaPSM(pool);
    const anoPermissao = metas[0]?.ano ?? new Date().getFullYear();
    if (!(await garantirVendedoresDoBody(usuario, metas, anoPermissao, SETORES_TELEVENDAS))) {
      return res.status(403).json({ error: 'Sem permissÃ£o para este vendedor' });
    }

    for (const m of metas) {
      const mesStr = String(m.mes);
      const existing = await pool.request()
        .input('nome', sql.VarChar, m.nome_vendedor)
        .input('ano',  sql.Int,     m.ano)
        .input('mes',  sql.VarChar, mesStr)
        .query(`SELECT ID FROM ${TABELA_METAS_MENSAIS} WHERE VENDEDOR=@nome AND ANO=@ano AND MES=@mes`);

      const r = pool.request()
        .input('nome', sql.VarChar, m.nome_vendedor)
        .input('ano',  sql.Int,     m.ano)
        .input('mes',  sql.VarChar, mesStr)
        .input('m1v',  sql.Float,   m.meta1_valor)
        .input('m1p',  sql.Float,   m.meta1_percentual)
        .input('m2v',  sql.Float,   m.meta2_valor)
        .input('m2p',  sql.Float,   m.meta2_percentual)
        .input('m3v',  sql.Float,   m.meta3_valor)
        .input('m3p',  sql.Float,   m.meta3_percentual);

      if (hasPSM) r.input('psm', sql.Float, m.percentual_sem_meta ?? 0);

      if (existing.recordset.length > 0) {
        await r.query(hasPSM
          ? `UPDATE ${TABELA_METAS_MENSAIS}
             SET META1_VALOR=@m1v, META1_PERCENTUAL=@m1p,
                 META2_VALOR=@m2v, META2_PERCENTUAL=@m2p,
                 META3_VALOR=@m3v, META3_PERCENTUAL=@m3p,
                 PERCENTUAL_SEM_META=@psm
             WHERE VENDEDOR=@nome AND ANO=@ano AND MES=@mes`
          : `UPDATE ${TABELA_METAS_MENSAIS}
             SET META1_VALOR=@m1v, META1_PERCENTUAL=@m1p,
                 META2_VALOR=@m2v, META2_PERCENTUAL=@m2p,
                 META3_VALOR=@m3v, META3_PERCENTUAL=@m3p
             WHERE VENDEDOR=@nome AND ANO=@ano AND MES=@mes`
        );
      } else {
        await r.query(hasPSM
          ? `INSERT INTO ${TABELA_METAS_MENSAIS}
               (VENDEDOR, ANO, MES, META1_VALOR, META1_PERCENTUAL, META2_VALOR, META2_PERCENTUAL,
                META3_VALOR, META3_PERCENTUAL, PERCENTUAL_SEM_META)
             VALUES (@nome, @ano, @mes, @m1v, @m1p, @m2v, @m2p, @m3v, @m3p, @psm)`
          : `INSERT INTO ${TABELA_METAS_MENSAIS}
               (VENDEDOR, ANO, MES, META1_VALOR, META1_PERCENTUAL, META2_VALOR, META2_PERCENTUAL,
                META3_VALOR, META3_PERCENTUAL)
             VALUES (@nome, @ano, @mes, @m1v, @m1p, @m2v, @m2p, @m3v, @m3p)`
        );
      }
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Erro ao salvar metas mensais:', error);
    return res.status(500).json({ error: 'Erro ao salvar' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// /bonus-config (GET, PUT)
// ═══════════════════════════════════════════════════════════════════════════
router.get("/bonus-config", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  try {
    const pool = await getPool();
    await garantirTabela(pool);
    const result = await pool.request().query(`
      SELECT TOP 1
        BONUS1_VALOR as bonus1_valor, BONUS1_PERCENTUAL as bonus1_percentual,
        BONUS2_VALOR as bonus2_valor, BONUS2_PERCENTUAL as bonus2_percentual,
        BONUS3_VALOR as bonus3_valor, BONUS3_PERCENTUAL as bonus3_percentual,
        BONUS4_VALOR as bonus4_valor, BONUS4_PERCENTUAL as bonus4_percentual,
        BONUS5_VALOR as bonus5_valor, BONUS5_PERCENTUAL as bonus5_percentual
      FROM ${TABELA_BONUS_CONFIG}
    `);
    res.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
    return res.json(result.recordset[0] ?? VAZIO);
  } catch (error) {
    console.error('Erro ao buscar bonus config:', error);
    return res.json(VAZIO);
  }
});

router.put("/bonus-config", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario || !['ADM', 'GESTOR'].includes(usuario.cargo)) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  if (!exigirAlgumSetor(usuario, res, SETORES_TELEVENDAS)) return;

  try {
    const b: typeof VAZIO = req.body;
    const pool = await getPool();
    await garantirTabela(pool);

    const exists = await pool.request().query(`SELECT TOP 1 ID FROM ${TABELA_BONUS_CONFIG}`);

    const r = pool.request()
      .input('b1v', sql.Float, b.bonus1_valor) .input('b1p', sql.Float, b.bonus1_percentual)
      .input('b2v', sql.Float, b.bonus2_valor) .input('b2p', sql.Float, b.bonus2_percentual)
      .input('b3v', sql.Float, b.bonus3_valor) .input('b3p', sql.Float, b.bonus3_percentual)
      .input('b4v', sql.Float, b.bonus4_valor) .input('b4p', sql.Float, b.bonus4_percentual)
      .input('b5v', sql.Float, b.bonus5_valor) .input('b5p', sql.Float, b.bonus5_percentual);

    if (exists.recordset.length > 0) {
      await r.query(`
        UPDATE ${TABELA_BONUS_CONFIG} SET
          BONUS1_VALOR=@b1v, BONUS1_PERCENTUAL=@b1p,
          BONUS2_VALOR=@b2v, BONUS2_PERCENTUAL=@b2p,
          BONUS3_VALOR=@b3v, BONUS3_PERCENTUAL=@b3p,
          BONUS4_VALOR=@b4v, BONUS4_PERCENTUAL=@b4p,
          BONUS5_VALOR=@b5v, BONUS5_PERCENTUAL=@b5p
        WHERE ID = (SELECT TOP 1 ID FROM ${TABELA_BONUS_CONFIG})
      `);
    } else {
      await r.query(`
        INSERT INTO ${TABELA_BONUS_CONFIG}
          (BONUS1_VALOR,BONUS1_PERCENTUAL,BONUS2_VALOR,BONUS2_PERCENTUAL,BONUS3_VALOR,BONUS3_PERCENTUAL,
           BONUS4_VALOR,BONUS4_PERCENTUAL,BONUS5_VALOR,BONUS5_PERCENTUAL)
        VALUES (@b1v,@b1p,@b2v,@b2p,@b3v,@b3p,@b4v,@b4p,@b5v,@b5p)
      `);
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Erro ao salvar bonus config:', error);
    return res.status(500).json({ error: 'Erro ao salvar' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// /bonus-mensais (GET, PUT)
// ═══════════════════════════════════════════════════════════════════════════
router.get("/bonus-mensais", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  const ano = req.query.ano;
  const mes = req.query.mes;

  try {
    const pool = await getPool();
    const r = pool.request();
    let where = 'WHERE 1=1';
    if (ano)  { r.input('ano', sql.Int,     parseInt(ano)); where += ' AND ANO = @ano'; }
    if (mes)  { r.input('mes', sql.VarChar,  mes);           where += ' AND MES = @mes'; }
    const result = await r.query(`
      SELECT VENDEDOR as nome_vendedor, ANO as ano, MES as mes,
             BONUS1_VALOR as bonus1_valor, BONUS1_PERCENTUAL as bonus1_percentual,
             BONUS2_VALOR as bonus2_valor, BONUS2_PERCENTUAL as bonus2_percentual,
             BONUS3_VALOR as bonus3_valor, BONUS3_PERCENTUAL as bonus3_percentual,
             BONUS4_VALOR as bonus4_valor, BONUS4_PERCENTUAL as bonus4_percentual,
             BONUS5_VALOR as bonus5_valor, BONUS5_PERCENTUAL as bonus5_percentual
      FROM ${TABELA_BONUS_MENSAIS} ${where} ORDER BY VENDEDOR
    `);
    const permitidos = await getVendedoresPermitidos(usuario, ano ? parseInt(ano) : new Date().getFullYear(), SETORES_TELEVENDAS);
    return res.json(filtrarLinhasPorVendedor(result.recordset, permitidos));
  } catch (error) {
    console.error('Erro ao buscar bonus:', error);
    return res.status(500).json({ error: 'Erro ao buscar dados' });
  }
});

router.put("/bonus-mensais", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario || !['ADM', 'GESTOR'].includes(usuario.cargo)) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  try {
    const items: {
      nome_vendedor: string; ano: number; mes: number;
      bonus1_valor: number; bonus1_percentual: number;
      bonus2_valor: number; bonus2_percentual: number;
      bonus3_valor: number; bonus3_percentual: number;
      bonus4_valor: number; bonus4_percentual: number;
      bonus5_valor: number; bonus5_percentual: number;
    }[] = req.body;

    const pool = await getPool();
    const anoPermissao = items[0]?.ano ?? new Date().getFullYear();
    if (!(await garantirVendedoresDoBody(usuario, items, anoPermissao, SETORES_TELEVENDAS))) {
      return res.status(403).json({ error: 'Sem permissÃ£o para este vendedor' });
    }
    for (const b of items) {
      const mesStr = String(b.mes);
      const exists = await pool.request()
        .input('nome', sql.VarChar, b.nome_vendedor)
        .input('ano',  sql.Int,     b.ano)
        .input('mes',  sql.VarChar, mesStr)
        .query(`SELECT ID FROM ${TABELA_BONUS_MENSAIS} WHERE VENDEDOR=@nome AND ANO=@ano AND MES=@mes`);

      const r = pool.request()
        .input('nome', sql.VarChar, b.nome_vendedor)
        .input('ano',  sql.Int,     b.ano)
        .input('mes',  sql.VarChar, mesStr)
        .input('b1v',  sql.Float, b.bonus1_valor) .input('b1p', sql.Float, b.bonus1_percentual)
        .input('b2v',  sql.Float, b.bonus2_valor) .input('b2p', sql.Float, b.bonus2_percentual)
        .input('b3v',  sql.Float, b.bonus3_valor) .input('b3p', sql.Float, b.bonus3_percentual)
        .input('b4v',  sql.Float, b.bonus4_valor) .input('b4p', sql.Float, b.bonus4_percentual)
        .input('b5v',  sql.Float, b.bonus5_valor) .input('b5p', sql.Float, b.bonus5_percentual);

      if (exists.recordset.length > 0) {
        await r.query(`
          UPDATE ${TABELA_BONUS_MENSAIS}
          SET BONUS1_VALOR=@b1v,BONUS1_PERCENTUAL=@b1p,
              BONUS2_VALOR=@b2v,BONUS2_PERCENTUAL=@b2p,
              BONUS3_VALOR=@b3v,BONUS3_PERCENTUAL=@b3p,
              BONUS4_VALOR=@b4v,BONUS4_PERCENTUAL=@b4p,
              BONUS5_VALOR=@b5v,BONUS5_PERCENTUAL=@b5p
          WHERE VENDEDOR=@nome AND ANO=@ano AND MES=@mes
        `);
      } else {
        await r.query(`
          INSERT INTO ${TABELA_BONUS_MENSAIS}
            (VENDEDOR,ANO,MES,BONUS1_VALOR,BONUS1_PERCENTUAL,BONUS2_VALOR,BONUS2_PERCENTUAL,
             BONUS3_VALOR,BONUS3_PERCENTUAL,BONUS4_VALOR,BONUS4_PERCENTUAL,BONUS5_VALOR,BONUS5_PERCENTUAL)
          VALUES(@nome,@ano,@mes,@b1v,@b1p,@b2v,@b2p,@b3v,@b3p,@b4v,@b4p,@b5v,@b5p)
        `);
      }
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Erro ao salvar bonus:', error);
    return res.status(500).json({ error: 'Erro ao salvar' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /recebimentos-media
// ═══════════════════════════════════════════════════════════════════════════
router.get("/recebimentos-media", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  const vendedor = req.query.vendedor || '';
  const mes = parseInt(req.query.mes || '0');
  const ano = parseInt(req.query.ano || '0');

  if (!vendedor || !mes || !ano) {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }

  // Últimos 3 meses completos antes de (mes, ano)
  if (usuario.cargo === "VENDEDOR" && !vendedorCasaComConfig(vendedor, usuario.nome_vendedor)) {
    return res.status(403).json({ error: "Sem permissÃ£o" });
  }
  if (usuario.cargo === "GESTOR") {
    const permitidos = await getVendedoresPermitidos(usuario, ano);
    if (!permitidos?.has(normalizarNome(vendedor))) {
      return res.status(403).json({ error: "Sem permissÃ£o" });
    }
  }

  const periodos: { ano: number; mes: number }[] = [];
  let m = mes - 1, a = ano;
  for (let i = 0; i < 3; i++) {
    if (m === 0) { m = 12; a--; }
    periodos.unshift({ ano: a, mes: m });
    m--;
  }

  try {
    // Carrega todos os anos necessários (pode ser até 2 anos diferentes)
    const anosNecessarios = [...new Set(periodos.map(p => p.ano))];
    const recebPorAno = await Promise.all(
      anosNecessarios.map(a2 => getRecebimentos(a2))
    );
    const todosReceb = recebPorAno.flat();

    const resultados = periodos.map(({ ano: a2, mes: m2 }) => {
      const inicio = `${a2}-${String(m2).padStart(2, '0')}-01`;
      const ultimoDia = new Date(a2, m2, 0).getDate();
      const fim = `${a2}-${String(m2).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;

      const rows = filtrarReceb(todosReceb, { inicio, fim, vendedor });
      return {
        ano: a2,
        mes: m2,
        label: `${MESES_PT[m2 - 1]}/${String(a2).slice(2)}`,
        total: somarReceb(rows),
      };
    });

    const media = resultados.reduce((s, r) => s + r.total, 0) / resultados.length;

    return res.json({
      media: Math.round(media * 100) / 100,
      meses: resultados,
    });
  } catch (err) {
    console.error('[recebimentos-media]', err);
    return res.status(500).json({ error: 'Erro ao consultar banco' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /vendas-media-setor
// ═══════════════════════════════════════════════════════════════════════════
router.get("/vendas-media-setor", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  const setor = req.query.setor || '';
  const mes = parseInt(req.query.mes || '0');
  const ano = parseInt(req.query.ano || '0');
  const setorFiltro = String(setor).toUpperCase();

  if (!setor || !mes || !ano) {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }

  // Últimos 3 meses completos antes de (mes, ano)
  if (!podeAcessarSetor(usuario, setorFiltro)) {
    return res.status(403).json({ error: "Sem permissÃ£o" });
  }

  const periodos: { ano: number; mes: number }[] = [];
  let m = mes - 1, a = ano;
  for (let i = 0; i < 3; i++) {
    if (m === 0) { m = 12; a--; }
    periodos.unshift({ ano: a, mes: m });
    m--;
  }

  try {
    const anosNecessarios = [...new Set(periodos.map(p => p.ano))];
    const vendasPorAno = await Promise.all(anosNecessarios.map(a2 => getVendas(a2)));
    const todasVendas = vendasPorAno.flat();

    const resultados = periodos.map(({ ano: a2, mes: m2 }) => {
      const ultimoDia = new Date(a2, m2, 0).getDate();
      const inicio = `${a2}-${String(m2).padStart(2, '0')}-01`;
      const fim = `${a2}-${String(m2).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;

      const rows = filtrarVendas(todasVendas, {
        inicio, fim,
        setores: [setorFiltro],
        userSetores: usuario.cargo === "GESTOR" ? usuario.setores : [],
      });

      return {
        ano: a2,
        mes: m2,
        label: `${MESES_PT[m2 - 1]}/${String(a2).slice(2)}`,
        total: somarVendas(rows),
      };
    });

    const media = resultados.reduce((s, r) => s + r.total, 0) / resultados.length;

    return res.json({
      media: Math.round(media * 100) / 100,
      meses: resultados,
    });
  } catch (err) {
    console.error('[vendas-media-setor]', err);
    return res.status(500).json({ error: 'Erro ao consultar dados' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /ultima-atualizacao
// ═══════════════════════════════════════════════════════════════════════════
router.get("/ultima-atualizacao", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  try {
    const pool = await getPool();
    const r = pool.request();
    const w = addSetoresGlobais(r, 'WHERE PDV_DATA IS NOT NULL');
    const result = await r.query(`
      SELECT MAX(PDV_DATA) as ultima_atualizacao
      FROM [TI-COMERCIAL_45-VendaPorSetor]
      ${w}
    `);
    return res.json({
      ultima_atualizacao: result.recordset[0]?.ultima_atualizacao ?? null,
    });
  } catch (err) {
    console.error('[ultima-atualizacao]', err);
    return res.json({ ultima_atualizacao: null });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// /config-setor (GET, POST) — ComissaoConfig
// ═══════════════════════════════════════════════════════════════════════════
router.get("/config-setor", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  try {
    await ensureComissaoConfigTable();
    const pool = await getPool();
    const result = await pool
      .request()
      .query('SELECT * FROM ComissaoConfig ORDER BY setor');
    const rows = podeVerTudo(usuario.cargo)
      ? result.recordset
      : result.recordset.filter((row: any) => usuario.setores.includes(row.setor));
    return res.json(rows);
  } catch (error) {
    console.error('Erro ao buscar comissões:', error);
    return res.status(500).json({ error: 'Erro ao buscar dados' });
  }
});

router.post("/config-setor", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario || !isADM(usuario.cargo)) {
    return res.status(403).json({ error: 'Apenas ADM pode alterar configurações' });
  }

  try {
    await ensureComissaoConfigTable();
    const body = req.body;
    const pool = await getPool();

    const existing = await pool
      .request()
      .input('setor', sql.VarChar, body.setor)
      .query('SELECT id FROM ComissaoConfig WHERE setor = @setor');

    if (existing.recordset.length > 0) {
      await pool
        .request()
        .input('setor', sql.VarChar, body.setor)
        .input('percentual', sql.Decimal(5, 2), body.percentual)
        .input('meta_mensal', sql.Decimal(18, 2), body.meta_mensal)
        .input('ativo', sql.Bit, body.ativo ? 1 : 0)
        .query(`
          UPDATE ComissaoConfig
          SET percentual = @percentual, meta_mensal = @meta_mensal, ativo = @ativo,
              atualizado_em = GETDATE()
          WHERE setor = @setor
        `);
    } else {
      await pool
        .request()
        .input('setor', sql.VarChar, body.setor)
        .input('percentual', sql.Decimal(5, 2), body.percentual)
        .input('meta_mensal', sql.Decimal(18, 2), body.meta_mensal)
        .input('ativo', sql.Bit, body.ativo ? 1 : 0)
        .query(`
          INSERT INTO ComissaoConfig (setor, percentual, meta_mensal, ativo)
          VALUES (@setor, @percentual, @meta_mensal, @ativo)
        `);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Erro ao salvar comissão:', error);
    return res.status(500).json({ error: 'Erro ao salvar' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /externo/vendas
// ═══════════════════════════════════════════════════════════════════════════
router.get("/externo/vendas", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  if (usuario.cargo === 'VENDEDOR') {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  const results = await Promise.allSettled([
    queryFirebird(fbSJC, fbVendas('SJC')),
    queryFirebird(fbSPM, fbVendas('SPM')),
    queryFirebird(fbLockeyMG, fbVendas('LOCKEY MG')),
    queryFirebird(fbLockey, FB_VENDAS_LOCKEY),
    queryMySQL(myLockeyRS, mysqlVendas('LOCKEY RS')),
    queryMySQL(myNiteroi, mysqlVendas('NITEROI')),
  ]);

  const data: Record<string, unknown>[] = [];
  const erros: string[] = [];

  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      data.push(...r.value);
    } else {
      erros.push(`${LABELS_VENDAS[i]}: ${(r.reason as Error)?.message ?? String(r.reason)}`);
    }
  });

  return res.json({ data, erros });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /externo/recebimentos
// ═══════════════════════════════════════════════════════════════════════════
router.get("/externo/recebimentos", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  if (usuario.cargo === 'VENDEDOR') {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  const results = await Promise.allSettled([
    queryFirebird(fbSJC, fbRecebimentos('SJC')),
    queryFirebird(fbSPM, fbRecebimentos('SPM')),
    queryFirebird(fbLockeyMG, fbRecebimentos('LOCKEY MG')),
    queryFirebird(fbLockey, FB_RECEB_LOCKEY),
    queryMySQL(myLockeyRS, mysqlRecebimentos('LOCKEY RS')),
    queryMySQL(myNiteroi, mysqlRecebimentos('NITEROI')),
  ]);

  const data: Record<string, unknown>[] = [];
  const erros: string[] = [];

  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      data.push(...r.value);
    } else {
      erros.push(`${LABELS_RECEB[i]}: ${(r.reason as Error)?.message ?? String(r.reason)}`);
    }
  });

  return res.json({ data, erros });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /distribuidores/config
// ═══════════════════════════════════════════════════════════════════════════
router.get("/distribuidores/config", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  const ano = parseInt(req.query.ano || String(new Date().getFullYear()));
  const mes = parseInt(req.query.mes || String(new Date().getMonth() + 1));
  if (!exigirSetor(usuario, res, "DISTRIBUIDORES")) return;

  try {
    await ensureDistTables();
    const pool = await getPool();

    const [metasResult, bonusResult] = await Promise.all([
      pool.request()
        .input('ano', sql.Int, ano)
        .input('mes', sql.Int, mes)
        .query(`
          SELECT VENDEDOR as nome_vendedor,
                 META1_VALOR as meta1_valor, META1_PERCENTUAL as meta1_percentual,
                 META2_VALOR as meta2_valor, META2_PERCENTUAL as meta2_percentual,
                 META3_VALOR as meta3_valor, META3_PERCENTUAL as meta3_percentual,
                 METADESAFIO_VALOR as metadesafio_valor, METADESAFIO_PERCENTUAL as metadesafio_percentual,
                 PERCENTUAL_SEM_META as percentual_sem_meta
          FROM [TI-PAINELCOMISSAO_DISTRIBUIDORES_METAS]
          WHERE ANO = @ano AND MES = @mes
        `),
      pool.request()
        .input('ano', sql.Int, ano)
        .input('mes', sql.Int, mes)
        .query(`
          SELECT VENDEDOR as nome_vendedor,
                 BONUS1_VALOR as bonus1_valor, BONUS2_VALOR as bonus2_valor,
                 BONUS3_VALOR as bonus3_valor, BONUSDESAFIO_VALOR as bonusdesafio_valor
          FROM [TI-PAINELCOMISSAO_DISTRIBUIDORES_BONUS]
          WHERE ANO = @ano AND MES = @mes
        `),
    ]);

    res.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
    const permitidos = await getVendedoresPermitidos(usuario, ano, ["DISTRIBUIDORES"]);
    return res.json({
      metas: filtrarLinhasPorVendedor(metasResult.recordset, permitidos),
      bonus: filtrarLinhasPorVendedor(bonusResult.recordset, permitidos),
    });
  } catch (e) {
    console.error('[distribuidores/config GET]', e);
    return res.status(500).json({ error: 'Erro ao buscar' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// /distribuidores/metas (GET, PUT)
// ═══════════════════════════════════════════════════════════════════════════
router.get("/distribuidores/metas", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  const ano = parseInt(req.query.ano || String(new Date().getFullYear()));
  const mes = parseInt(req.query.mes || String(new Date().getMonth() + 1));
  if (!exigirSetor(usuario, res, "DISTRIBUIDORES")) return;

  try {
    await ensureDistTables();
    const pool = await getPool();
    const result = await pool.request()
      .input('ano', sql.Int, ano)
      .input('mes', sql.Int, mes)
      .query(`
        SELECT VENDEDOR as nome_vendedor,
               META1_VALOR as meta1_valor, META1_PERCENTUAL as meta1_percentual,
               META2_VALOR as meta2_valor, META2_PERCENTUAL as meta2_percentual,
               META3_VALOR as meta3_valor, META3_PERCENTUAL as meta3_percentual,
               METADESAFIO_VALOR as metadesafio_valor, METADESAFIO_PERCENTUAL as metadesafio_percentual,
               PERCENTUAL_SEM_META as percentual_sem_meta
        FROM [TI-PAINELCOMISSAO_DISTRIBUIDORES_METAS]
        WHERE ANO = @ano AND MES = @mes
      `);
    const permitidos = await getVendedoresPermitidos(usuario, ano, ["DISTRIBUIDORES"]);
    return res.json(filtrarLinhasPorVendedor(result.recordset, permitidos));
  } catch (e) {
    console.error('[distribuidores/metas GET]', e);
    return res.status(500).json({ error: 'Erro ao buscar' });
  }
});

router.put("/distribuidores/metas", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario || !['ADM', 'GESTOR'].includes(usuario.cargo)) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  const body: Array<{
    nome_vendedor: string; ano: number; mes: number;
    meta1_valor: number; meta1_percentual: number;
    meta2_valor: number; meta2_percentual: number;
    meta3_valor: number; meta3_percentual: number;
    metadesafio_valor: number; metadesafio_percentual: number;
    percentual_sem_meta: number;
  }> = req.body;
  if (!exigirSetor(usuario, res, "DISTRIBUIDORES")) return;

  try {
    await ensureDistTables();
    const anoPermissao = body[0]?.ano ?? new Date().getFullYear();
    if (!(await garantirVendedoresDoBody(usuario, body, anoPermissao, ["DISTRIBUIDORES"]))) {
      return res.status(403).json({ error: 'Sem permissÃ£o para este vendedor' });
    }
    const pool = await getPool();
    for (const row of body) {
      await pool.request()
        .input('vend', sql.VarChar, row.nome_vendedor)
        .input('ano', sql.Int, row.ano)
        .input('mes', sql.Int, row.mes)
        .input('m1v', sql.Float, row.meta1_valor || 0)
        .input('m1p', sql.Float, row.meta1_percentual || 0)
        .input('m2v', sql.Float, row.meta2_valor || 0)
        .input('m2p', sql.Float, row.meta2_percentual || 0)
        .input('m3v', sql.Float, row.meta3_valor || 0)
        .input('m3p', sql.Float, row.meta3_percentual || 0)
        .input('mdv', sql.Float, row.metadesafio_valor || 0)
        .input('mdp', sql.Float, row.metadesafio_percentual || 0)
        .input('psm', sql.Float, row.percentual_sem_meta || 0)
        .query(`
          MERGE [TI-PAINELCOMISSAO_DISTRIBUIDORES_METAS] AS t
          USING (SELECT @vend AS V, @ano AS A, @mes AS M) AS s ON t.VENDEDOR=s.V AND t.ANO=s.A AND t.MES=s.M
          WHEN MATCHED THEN UPDATE SET
            META1_VALOR=@m1v, META1_PERCENTUAL=@m1p,
            META2_VALOR=@m2v, META2_PERCENTUAL=@m2p,
            META3_VALOR=@m3v, META3_PERCENTUAL=@m3p,
            METADESAFIO_VALOR=@mdv, METADESAFIO_PERCENTUAL=@mdp,
            PERCENTUAL_SEM_META=@psm
          WHEN NOT MATCHED THEN INSERT
            (VENDEDOR,ANO,MES,META1_VALOR,META1_PERCENTUAL,META2_VALOR,META2_PERCENTUAL,
             META3_VALOR,META3_PERCENTUAL,METADESAFIO_VALOR,METADESAFIO_PERCENTUAL,PERCENTUAL_SEM_META)
          VALUES(@vend,@ano,@mes,@m1v,@m1p,@m2v,@m2p,@m3v,@m3p,@mdv,@mdp,@psm);
        `);
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('[distribuidores/metas PUT]', e);
    return res.status(500).json({ error: 'Erro ao salvar' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// /distribuidores/bonus (GET, PUT)
// ═══════════════════════════════════════════════════════════════════════════
router.get("/distribuidores/bonus", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  const ano = parseInt(req.query.ano || String(new Date().getFullYear()));
  const mes = parseInt(req.query.mes || String(new Date().getMonth() + 1));
  if (!exigirSetor(usuario, res, "DISTRIBUIDORES")) return;

  try {
    await ensureDistTables();
    const pool = await getPool();
    const result = await pool.request()
      .input('ano', sql.Int, ano)
      .input('mes', sql.Int, mes)
      .query(`
        SELECT VENDEDOR as nome_vendedor,
               BONUS1_VALOR as bonus1_valor, BONUS2_VALOR as bonus2_valor,
               BONUS3_VALOR as bonus3_valor, BONUSDESAFIO_VALOR as bonusdesafio_valor
        FROM [TI-PAINELCOMISSAO_DISTRIBUIDORES_BONUS]
        WHERE ANO = @ano AND MES = @mes
      `);
    const permitidos = await getVendedoresPermitidos(usuario, ano, ["DISTRIBUIDORES"]);
    return res.json(filtrarLinhasPorVendedor(result.recordset, permitidos));
  } catch (e) {
    console.error('[distribuidores/bonus GET]', e);
    return res.status(500).json({ error: 'Erro ao buscar' });
  }
});

router.put("/distribuidores/bonus", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario || !['ADM', 'GESTOR'].includes(usuario.cargo)) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  const body: Array<{
    nome_vendedor: string; ano: number; mes: number;
    bonus1_valor: number; bonus2_valor: number; bonus3_valor: number; bonusdesafio_valor: number;
  }> = req.body;
  if (!exigirSetor(usuario, res, "DISTRIBUIDORES")) return;

  try {
    await ensureDistTables();
    const anoPermissao = body[0]?.ano ?? new Date().getFullYear();
    if (!(await garantirVendedoresDoBody(usuario, body, anoPermissao, ["DISTRIBUIDORES"]))) {
      return res.status(403).json({ error: 'Sem permissÃ£o para este vendedor' });
    }
    const pool = await getPool();
    for (const row of body) {
      await pool.request()
        .input('vend', sql.VarChar, row.nome_vendedor)
        .input('ano', sql.Int, row.ano)
        .input('mes', sql.Int, row.mes)
        .input('b1', sql.Float, row.bonus1_valor || 0)
        .input('b2', sql.Float, row.bonus2_valor || 0)
        .input('b3', sql.Float, row.bonus3_valor || 0)
        .input('bd', sql.Float, row.bonusdesafio_valor || 0)
        .query(`
          MERGE [TI-PAINELCOMISSAO_DISTRIBUIDORES_BONUS] AS t
          USING (SELECT @vend AS V, @ano AS A, @mes AS M) AS s ON t.VENDEDOR=s.V AND t.ANO=s.A AND t.MES=s.M
          WHEN MATCHED THEN UPDATE SET BONUS1_VALOR=@b1,BONUS2_VALOR=@b2,BONUS3_VALOR=@b3,BONUSDESAFIO_VALOR=@bd
          WHEN NOT MATCHED THEN INSERT (VENDEDOR,ANO,MES,BONUS1_VALOR,BONUS2_VALOR,BONUS3_VALOR,BONUSDESAFIO_VALOR)
          VALUES(@vend,@ano,@mes,@b1,@b2,@b3,@bd);
        `);
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('[distribuidores/bonus PUT]', e);
    return res.status(500).json({ error: 'Erro ao salvar' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// /distribuidores/vinculos (GET, PUT)
// ═══════════════════════════════════════════════════════════════════════════
router.get("/distribuidores/vinculos", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  if (!exigirSetor(usuario, res, "DISTRIBUIDORES")) return;

  try {
    await ensureDistTables();
    const pool = await getPool();
    const result = await pool.request().query(
      `SELECT VENDEDOR_VINCULADO as vendedor_vinculado, VENDEDOR_PRINCIPAL as vendedor_principal
       FROM [TI-PAINELCOMISSAO_DISTRIBUIDORES_VINCULOS]`
    );
    const permitidos = await getVendedoresPermitidos(usuario, undefined, ["DISTRIBUIDORES"]);
    const rows = permitidos
      ? result.recordset.filter((row: any) =>
          permitidos.has(normalizarNome(row.vendedor_vinculado)) &&
          permitidos.has(normalizarNome(row.vendedor_principal))
        )
      : result.recordset;
    return res.json(rows);
  } catch (e) {
    console.error('[distribuidores/vinculos GET]', e);
    return res.status(500).json({ error: 'Erro ao buscar' });
  }
});

router.put("/distribuidores/vinculos", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario || !['ADM', 'GESTOR'].includes(usuario.cargo)) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  const body: Array<{ vendedor_vinculado: string; vendedor_principal: string }> = req.body;
  if (!exigirSetor(usuario, res, "DISTRIBUIDORES")) return;

  try {
    await ensureDistTables();
    const permitidos = await getVendedoresPermitidos(usuario, undefined, ["DISTRIBUIDORES"]);
    if (permitidos && body.some((row) =>
      !permitidos.has(normalizarNome(row.vendedor_vinculado)) ||
      !permitidos.has(normalizarNome(row.vendedor_principal))
    )) {
      return res.status(403).json({ error: 'Sem permissÃ£o para este vendedor' });
    }
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx).query(`DELETE FROM [TI-PAINELCOMISSAO_DISTRIBUIDORES_VINCULOS]`);
      for (const row of body) {
        const vinculado = row.vendedor_vinculado?.trim().toUpperCase();
        const principal = row.vendedor_principal?.trim().toUpperCase();
        if (!vinculado || !principal || vinculado === principal) continue;
        await new sql.Request(tx)
          .input('vv', sql.VarChar, vinculado)
          .input('vp', sql.VarChar, principal)
          .query(`INSERT INTO [TI-PAINELCOMISSAO_DISTRIBUIDORES_VINCULOS] (VENDEDOR_VINCULADO, VENDEDOR_PRINCIPAL) VALUES (@vv, @vp)`);
      }
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
    invalidarCacheVinculos();
    return res.json({ ok: true });
  } catch (e) {
    console.error('[distribuidores/vinculos PUT]', e);
    return res.status(500).json({ error: 'Erro ao salvar' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /distribuidores/vendedores-raw
// ═══════════════════════════════════════════════════════════════════════════
router.get("/distribuidores/vendedores-raw", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  if (!exigirSetor(usuario, res, "DISTRIBUIDORES")) return;

  try {
    const vendedores = await getVendedoresNomesRaw();
    const permitidos = await getVendedoresPermitidos(usuario, undefined, ["DISTRIBUIDORES"]);
    return res.json({
      vendedores: permitidos
        ? vendedores.filter((nome: string) => permitidos.has(normalizarNome(nome)))
        : vendedores,
    });
  } catch (e) {
    console.error('[distribuidores/vendedores-raw GET]', e);
    return res.status(500).json({ error: 'Erro ao buscar' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /ferragens/config
// ═══════════════════════════════════════════════════════════════════════════
router.get("/ferragens/config", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  const ano = parseInt(req.query.ano || String(new Date().getFullYear()));
  const mes = parseInt(req.query.mes || String(new Date().getMonth() + 1));
  if (!exigirSetor(usuario, res, "FERRAGENS")) return;

  try {
    await ensureFerrTables();
    const pool = await getPool();

    const [metasResult, bonusResult, grupoResult] = await Promise.all([
      pool.request()
        .input('ano', sql.Int, ano)
        .input('mes', sql.Int, mes)
        .query(`
          SELECT VENDEDOR as nome_vendedor,
                 META1_VALOR as meta1_valor, META1_PERCENTUAL as meta1_percentual,
                 META2_VALOR as meta2_valor, META2_PERCENTUAL as meta2_percentual,
                 META3_VALOR as meta3_valor, META3_PERCENTUAL as meta3_percentual,
                 METADESAFIO_VALOR as metadesafio_valor, METADESAFIO_PERCENTUAL as metadesafio_percentual,
                 PERCENTUAL_SEM_META as percentual_sem_meta
          FROM [TI-PAINELCOMISSAO_FERRAGENS_METAS]
          WHERE ANO = @ano AND MES = @mes
        `),
      pool.request()
        .input('ano', sql.Int, ano)
        .input('mes', sql.Int, mes)
        .query(`
          SELECT VENDEDOR as nome_vendedor,
                 BONUS1_VALOR as bonus1_valor, BONUS2_VALOR as bonus2_valor,
                 BONUS3_VALOR as bonus3_valor, BONUSDESAFIO_VALOR as bonusdesafio_valor
          FROM [TI-PAINELCOMISSAO_FERRAGENS_BONUS]
          WHERE ANO = @ano AND MES = @mes
        `),
      pool.request()
        .input('ano', sql.Int, ano)
        .input('mes', sql.Int, mes)
        .query(`
          SELECT TOP 1
            META1_VALOR as meta1_valor, META1_BONUS as meta1_bonus,
            META2_VALOR as meta2_valor, META2_BONUS as meta2_bonus,
            META3_VALOR as meta3_valor, META3_BONUS as meta3_bonus,
            METADESAFIO_VALOR as metadesafio_valor, METADESAFIO_BONUS as metadesafio_bonus
          FROM [TI-PAINELCOMISSAO_FERRAGENS_META_GRUPO]
          WHERE ANO = @ano AND MES = @mes
        `),
    ]);

    res.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
    const permitidos = await getVendedoresPermitidos(usuario, ano, ["FERRAGENS"]);
    return res.json({
      metas: filtrarLinhasPorVendedor(metasResult.recordset, permitidos),
      bonus: filtrarLinhasPorVendedor(bonusResult.recordset, permitidos),
      metaGrupo: grupoResult.recordset[0] ?? null,
    });
  } catch (e) {
    console.error('[ferragens/config GET]', e);
    return res.status(500).json({ error: 'Erro ao buscar' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// /ferragens/metas (GET, PUT)
// ═══════════════════════════════════════════════════════════════════════════
router.get("/ferragens/metas", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  const ano = parseInt(req.query.ano || String(new Date().getFullYear()));
  const mes = parseInt(req.query.mes || String(new Date().getMonth() + 1));
  if (!exigirSetor(usuario, res, "FERRAGENS")) return;

  try {
    await ensureFerrTables();
    const pool = await getPool();
    const result = await pool.request()
      .input('ano', sql.Int, ano)
      .input('mes', sql.Int, mes)
      .query(`
        SELECT VENDEDOR as nome_vendedor,
               META1_VALOR as meta1_valor, META1_PERCENTUAL as meta1_percentual,
               META2_VALOR as meta2_valor, META2_PERCENTUAL as meta2_percentual,
               META3_VALOR as meta3_valor, META3_PERCENTUAL as meta3_percentual,
               METADESAFIO_VALOR as metadesafio_valor, METADESAFIO_PERCENTUAL as metadesafio_percentual,
               PERCENTUAL_SEM_META as percentual_sem_meta
        FROM [TI-PAINELCOMISSAO_FERRAGENS_METAS]
        WHERE ANO = @ano AND MES = @mes
      `);
    const permitidos = await getVendedoresPermitidos(usuario, ano, ["FERRAGENS"]);
    return res.json(filtrarLinhasPorVendedor(result.recordset, permitidos));
  } catch (e) {
    console.error('[ferragens/metas GET]', e);
    return res.status(500).json({ error: 'Erro ao buscar' });
  }
});

router.put("/ferragens/metas", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario || !['ADM', 'GESTOR'].includes(usuario.cargo)) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  const body: Array<{
    nome_vendedor: string; ano: number; mes: number;
    meta1_valor: number; meta1_percentual: number;
    meta2_valor: number; meta2_percentual: number;
    meta3_valor: number; meta3_percentual: number;
    metadesafio_valor: number; metadesafio_percentual: number;
    percentual_sem_meta: number;
  }> = req.body;
  if (!exigirSetor(usuario, res, "FERRAGENS")) return;

  try {
    await ensureFerrTables();
    const anoPermissao = body[0]?.ano ?? new Date().getFullYear();
    if (!(await garantirVendedoresDoBody(usuario, body, anoPermissao, ["FERRAGENS"]))) {
      return res.status(403).json({ error: 'Sem permissÃ£o para este vendedor' });
    }
    const pool = await getPool();
    for (const row of body) {
      await pool.request()
        .input('vend', sql.VarChar, row.nome_vendedor)
        .input('ano', sql.Int, row.ano)
        .input('mes', sql.Int, row.mes)
        .input('m1v', sql.Float, row.meta1_valor || 0)
        .input('m1p', sql.Float, row.meta1_percentual || 0)
        .input('m2v', sql.Float, row.meta2_valor || 0)
        .input('m2p', sql.Float, row.meta2_percentual || 0)
        .input('m3v', sql.Float, row.meta3_valor || 0)
        .input('m3p', sql.Float, row.meta3_percentual || 0)
        .input('mdv', sql.Float, row.metadesafio_valor || 0)
        .input('mdp', sql.Float, row.metadesafio_percentual || 0)
        .input('psm', sql.Float, row.percentual_sem_meta || 0)
        .query(`
          MERGE [TI-PAINELCOMISSAO_FERRAGENS_METAS] AS t
          USING (SELECT @vend AS V, @ano AS A, @mes AS M) AS s ON t.VENDEDOR=s.V AND t.ANO=s.A AND t.MES=s.M
          WHEN MATCHED THEN UPDATE SET
            META1_VALOR=@m1v, META1_PERCENTUAL=@m1p,
            META2_VALOR=@m2v, META2_PERCENTUAL=@m2p,
            META3_VALOR=@m3v, META3_PERCENTUAL=@m3p,
            METADESAFIO_VALOR=@mdv, METADESAFIO_PERCENTUAL=@mdp,
            PERCENTUAL_SEM_META=@psm
          WHEN NOT MATCHED THEN INSERT
            (VENDEDOR,ANO,MES,META1_VALOR,META1_PERCENTUAL,META2_VALOR,META2_PERCENTUAL,
             META3_VALOR,META3_PERCENTUAL,METADESAFIO_VALOR,METADESAFIO_PERCENTUAL,PERCENTUAL_SEM_META)
          VALUES(@vend,@ano,@mes,@m1v,@m1p,@m2v,@m2p,@m3v,@m3p,@mdv,@mdp,@psm);
        `);
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('[ferragens/metas PUT]', e);
    return res.status(500).json({ error: 'Erro ao salvar' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// /ferragens/bonus (GET, PUT)
// ═══════════════════════════════════════════════════════════════════════════
router.get("/ferragens/bonus", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  const ano = parseInt(req.query.ano || String(new Date().getFullYear()));
  const mes = parseInt(req.query.mes || String(new Date().getMonth() + 1));
  if (!exigirSetor(usuario, res, "FERRAGENS")) return;

  try {
    await ensureFerrTables();
    const pool = await getPool();
    const result = await pool.request()
      .input('ano', sql.Int, ano)
      .input('mes', sql.Int, mes)
      .query(`
        SELECT VENDEDOR as nome_vendedor,
               BONUS1_VALOR as bonus1_valor, BONUS2_VALOR as bonus2_valor,
               BONUS3_VALOR as bonus3_valor, BONUSDESAFIO_VALOR as bonusdesafio_valor
        FROM [TI-PAINELCOMISSAO_FERRAGENS_BONUS]
        WHERE ANO = @ano AND MES = @mes
      `);
    const permitidos = await getVendedoresPermitidos(usuario, ano, ["FERRAGENS"]);
    return res.json(filtrarLinhasPorVendedor(result.recordset, permitidos));
  } catch (e) {
    console.error('[ferragens/bonus GET]', e);
    return res.status(500).json({ error: 'Erro ao buscar' });
  }
});

router.put("/ferragens/bonus", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario || !['ADM', 'GESTOR'].includes(usuario.cargo)) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  const body: Array<{
    nome_vendedor: string; ano: number; mes: number;
    bonus1_valor: number; bonus2_valor: number; bonus3_valor: number; bonusdesafio_valor: number;
  }> = req.body;
  if (!exigirSetor(usuario, res, "FERRAGENS")) return;

  try {
    await ensureFerrTables();
    const anoPermissao = body[0]?.ano ?? new Date().getFullYear();
    if (!(await garantirVendedoresDoBody(usuario, body, anoPermissao, ["FERRAGENS"]))) {
      return res.status(403).json({ error: 'Sem permissÃ£o para este vendedor' });
    }
    const pool = await getPool();
    for (const row of body) {
      await pool.request()
        .input('vend', sql.VarChar, row.nome_vendedor)
        .input('ano', sql.Int, row.ano)
        .input('mes', sql.Int, row.mes)
        .input('b1', sql.Float, row.bonus1_valor || 0)
        .input('b2', sql.Float, row.bonus2_valor || 0)
        .input('b3', sql.Float, row.bonus3_valor || 0)
        .input('bd', sql.Float, row.bonusdesafio_valor || 0)
        .query(`
          MERGE [TI-PAINELCOMISSAO_FERRAGENS_BONUS] AS t
          USING (SELECT @vend AS V, @ano AS A, @mes AS M) AS s ON t.VENDEDOR=s.V AND t.ANO=s.A AND t.MES=s.M
          WHEN MATCHED THEN UPDATE SET BONUS1_VALOR=@b1,BONUS2_VALOR=@b2,BONUS3_VALOR=@b3,BONUSDESAFIO_VALOR=@bd
          WHEN NOT MATCHED THEN INSERT (VENDEDOR,ANO,MES,BONUS1_VALOR,BONUS2_VALOR,BONUS3_VALOR,BONUSDESAFIO_VALOR)
          VALUES(@vend,@ano,@mes,@b1,@b2,@b3,@bd);
        `);
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('[ferragens/bonus PUT]', e);
    return res.status(500).json({ error: 'Erro ao salvar' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// /ferragens/meta-grupo (GET, PUT)
// ═══════════════════════════════════════════════════════════════════════════
router.get("/ferragens/meta-grupo", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario) return res.status(403).json({ error: "Sem permissão" });

  const ano = parseInt(req.query.ano || String(new Date().getFullYear()));
  const mes = parseInt(req.query.mes || String(new Date().getMonth() + 1));
  if (!exigirSetor(usuario, res, "FERRAGENS")) return;

  try {
    await ensureFerrTables();
    const pool = await getPool();
    const result = await pool.request()
      .input('ano', sql.Int, ano)
      .input('mes', sql.Int, mes)
      .query(`
        SELECT TOP 1
          META1_VALOR as meta1_valor, META1_BONUS as meta1_bonus,
          META2_VALOR as meta2_valor, META2_BONUS as meta2_bonus,
          META3_VALOR as meta3_valor, META3_BONUS as meta3_bonus,
          METADESAFIO_VALOR as metadesafio_valor, METADESAFIO_BONUS as metadesafio_bonus
        FROM [TI-PAINELCOMISSAO_FERRAGENS_META_GRUPO]
        WHERE ANO = @ano AND MES = @mes
      `);
    return res.json(result.recordset[0] ?? null);
  } catch (e) {
    console.error('[ferragens/meta-grupo GET]', e);
    return res.json(null);
  }
});

router.put("/ferragens/meta-grupo", async (req: any, res: any) => {
  const actor = getActor(req);
  if (!actor) return res.status(401).json({ error: "Não autenticado" });
  const usuario = await getComissaoUsuario(actor);
  if (!usuario || !['ADM', 'GESTOR'].includes(usuario.cargo)) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  const body: {
    ano: number; mes: number;
    meta1_valor: number; meta1_bonus: number;
    meta2_valor: number; meta2_bonus: number;
    meta3_valor: number; meta3_bonus: number;
    metadesafio_valor: number; metadesafio_bonus: number;
  } = req.body;
  if (!exigirSetor(usuario, res, "FERRAGENS")) return;

  try {
    await ensureFerrTables();
    const pool = await getPool();
    await pool.request()
      .input('ano', sql.Int, body.ano)
      .input('mes', sql.Int, body.mes)
      .input('m1v', sql.Float, body.meta1_valor || 0)
      .input('m1b', sql.Float, body.meta1_bonus || 0)
      .input('m2v', sql.Float, body.meta2_valor || 0)
      .input('m2b', sql.Float, body.meta2_bonus || 0)
      .input('m3v', sql.Float, body.meta3_valor || 0)
      .input('m3b', sql.Float, body.meta3_bonus || 0)
      .input('mdv', sql.Float, body.metadesafio_valor || 0)
      .input('mdb', sql.Float, body.metadesafio_bonus || 0)
      .query(`
        MERGE [TI-PAINELCOMISSAO_FERRAGENS_META_GRUPO] AS t
        USING (SELECT @ano AS A, @mes AS M) AS s ON t.ANO=s.A AND t.MES=s.M
        WHEN MATCHED THEN UPDATE SET
          META1_VALOR=@m1v, META1_BONUS=@m1b,
          META2_VALOR=@m2v, META2_BONUS=@m2b,
          META3_VALOR=@m3v, META3_BONUS=@m3b,
          METADESAFIO_VALOR=@mdv, METADESAFIO_BONUS=@mdb
        WHEN NOT MATCHED THEN INSERT
          (ANO,MES,META1_VALOR,META1_BONUS,META2_VALOR,META2_BONUS,META3_VALOR,META3_BONUS,METADESAFIO_VALOR,METADESAFIO_BONUS)
        VALUES(@ano,@mes,@m1v,@m1b,@m2v,@m2b,@m3v,@m3b,@mdv,@mdb);
      `);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[ferragens/meta-grupo PUT]', e);
    return res.status(500).json({ error: 'Erro ao salvar' });
  }
});

export default router;
