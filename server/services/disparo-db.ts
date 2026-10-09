import sql from "mssql";
import { getPool } from "../db/sqlserver";

// Persistência do Disparo no SQL Server local (DOVALE). Substitui o Supabase, que no
// plano free bloqueia o projeto inteiro (402) quando estoura cota e pausa por inatividade.
// Os nomes de coluna são os mesmos das tabelas antigas do Supabase (ver
// scripts/migrar-disparo-supabase-sqlserver.ts, que copia o histórico preservando os ids).

export const T_LISTAS = "dbo.DISPARO_LISTAS_CONTATOS";
export const T_CONTATOS = "dbo.DISPARO_CONTATOS_LISTA";
export const T_DISPAROS = "dbo.DISPARO_DISPAROS";
export const T_LOGS = "dbo.DISPARO_LOGS";
export const T_TEMPLATE_CONFIGS = "dbo.DISPARO_TEMPLATE_CONFIGS";

// Seeds acima dos maiores ids do Supabase (disparo ~#230, lista ~#280 em set/2026) para o
// histórico migrado entrar com o id original sem colidir com o que for criado aqui antes.
export const SEED_DISPAROS = 1001;
export const SEED_LISTAS = 5001;
export const SEED_CONTATOS = 100_000_001;
export const SEED_LOGS = 100_000_001;

export const STATUS_ATIVOS = ["AWAITING_APPROVAL", "PROCESSING", "PAUSING", "PAUSED"] as const;

export interface Disparo {
  id: number;
  lista_id: number;
  template_nome: string;
  status: string;
  configuracao: string | null;
  resultado: string | null;
  data_inicio: Date | null;
  aprovacao_conversa_id: number | null;
  aprovacao_msg_id: number | null;
  aprovacao_ts: Date | null;
}

// id BIGINT: o driver mssql devolve como string
export interface ContatoLista {
  id: string;
  lista_id: number;
  nome: string | null;
  numero: string;
  dados_extras: string | null;
}

export interface LogDisparo {
  id: string;
  disparo_id: number;
  contato_numero: string;
  status: string;
  mensagem_erro: string | null;
  meta_wamid: string | null;
  criado_em: Date | null;
}

// ── Schema ───────────────────────────────────────────────────────────────────

let schemaPronto: Promise<void> | null = null;

export function garantirTabelasDisparo(): Promise<void> {
  if (!schemaPronto) {
    schemaPronto = criarTabelas().catch((e) => {
      schemaPronto = null; // tenta de novo na próxima chamada
      throw e;
    });
  }
  return schemaPronto;
}

async function criarTabelas(): Promise<void> {
  const pool = await getPool();
  await pool.request().query(`
    IF OBJECT_ID('${T_LISTAS}', 'U') IS NULL
    BEGIN
      CREATE TABLE ${T_LISTAS} (
        id INT IDENTITY(${SEED_LISTAS},1) PRIMARY KEY,
        nome_arquivo NVARCHAR(500) NULL,
        total_contatos INT NOT NULL DEFAULT 0,
        criado_em DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END

    IF OBJECT_ID('${T_CONTATOS}', 'U') IS NULL
    BEGIN
      CREATE TABLE ${T_CONTATOS} (
        id BIGINT IDENTITY(${SEED_CONTATOS},1) PRIMARY KEY,
        lista_id INT NOT NULL,
        nome NVARCHAR(500) NULL,
        numero VARCHAR(40) NOT NULL,
        dados_extras NVARCHAR(MAX) NULL
      );
      CREATE INDEX IX_DISPARO_CONTATOS_LISTA_lista ON ${T_CONTATOS} (lista_id);
    END

    IF OBJECT_ID('${T_DISPAROS}', 'U') IS NULL
    BEGIN
      CREATE TABLE ${T_DISPAROS} (
        id INT IDENTITY(${SEED_DISPAROS},1) PRIMARY KEY,
        lista_id INT NOT NULL,
        template_nome NVARCHAR(512) NOT NULL,
        status VARCHAR(30) NOT NULL,
        configuracao NVARCHAR(MAX) NULL,
        resultado NVARCHAR(MAX) NULL,
        data_inicio DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        aprovacao_conversa_id INT NULL,
        aprovacao_msg_id INT NULL,
        aprovacao_ts DATETIME2 NULL
      );
      CREATE INDEX IX_DISPARO_DISPAROS_status ON ${T_DISPAROS} (status, data_inicio);
    END

    IF OBJECT_ID('${T_LOGS}', 'U') IS NULL
    BEGIN
      CREATE TABLE ${T_LOGS} (
        id BIGINT IDENTITY(${SEED_LOGS},1) PRIMARY KEY,
        disparo_id INT NOT NULL,
        contato_numero VARCHAR(40) NOT NULL,
        status VARCHAR(20) NOT NULL,
        mensagem_erro NVARCHAR(MAX) NULL,
        meta_wamid NVARCHAR(255) NULL,
        criado_em DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
      CREATE INDEX IX_DISPARO_LOGS_disparo ON ${T_LOGS} (disparo_id, status);
    END

    IF OBJECT_ID('${T_TEMPLATE_CONFIGS}', 'U') IS NULL
    BEGIN
      CREATE TABLE ${T_TEMPLATE_CONFIGS} (
        template_nome NVARCHAR(512) NOT NULL PRIMARY KEY,
        etiqueta NVARCHAR(255) NULL,
        atualizado_em DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END
  `);
}

async function req(): Promise<sql.Request> {
  await garantirTabelasDisparo();
  return (await getPool()).request();
}

// SQL Server aceita no máximo 2100 parâmetros por comando.
function tamanhoLote(colunas: number): number {
  return Math.max(1, Math.floor(2000 / colunas));
}

// ── Listas de contatos ───────────────────────────────────────────────────────

/** Cria a lista e insere os contatos numa transação só (não deixa lista órfã se falhar no meio). */
export async function criarListaComContatos(
  nomeArquivo: string,
  contatos: { nome: string; numero: string; dados_extras: string }[],
): Promise<number> {
  await garantirTabelasDisparo();
  const tx = new sql.Transaction(await getPool());
  await tx.begin();
  try {
    const r = await new sql.Request(tx)
      .input("nome_arquivo", sql.NVarChar(500), nomeArquivo)
      .input("total", sql.Int, contatos.length)
      .query(`INSERT INTO ${T_LISTAS} (nome_arquivo, total_contatos) OUTPUT INSERTED.id VALUES (@nome_arquivo, @total)`);
    const listaId = Number(r.recordset[0].id);

    const lote = tamanhoLote(3);
    for (let i = 0; i < contatos.length; i += lote) {
      const chunk = contatos.slice(i, i + lote);
      const rq = new sql.Request(tx).input("lista_id", sql.Int, listaId);
      const valores = chunk.map((c, j) => {
        rq.input(`n${j}`, sql.NVarChar(500), c.nome ?? null);
        rq.input(`t${j}`, sql.VarChar(40), c.numero);
        rq.input(`d${j}`, sql.NVarChar(sql.MAX), c.dados_extras ?? null);
        return `(@lista_id, @n${j}, @t${j}, @d${j})`;
      });
      await rq.query(`INSERT INTO ${T_CONTATOS} (lista_id, nome, numero, dados_extras) VALUES ${valores.join(",")}`);
    }
    await tx.commit();
    return listaId;
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

export async function contarContatos(listaId: number): Promise<number> {
  const r = await (await req())
    .input("lista_id", sql.Int, listaId)
    .query(`SELECT COUNT(*) AS total FROM ${T_CONTATOS} WHERE lista_id = @lista_id`);
  return Number(r.recordset[0]?.total ?? 0);
}

export async function listarContatos(listaId: number): Promise<ContatoLista[]> {
  const r = await (await req())
    .input("lista_id", sql.Int, listaId)
    .query(`SELECT id, lista_id, nome, numero, dados_extras FROM ${T_CONTATOS} WHERE lista_id = @lista_id ORDER BY id`);
  return r.recordset as ContatoLista[];
}

// ── Disparos ─────────────────────────────────────────────────────────────────

export async function obterDisparo(id: number): Promise<Disparo | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const r = await (await req()).input("id", sql.Int, id).query(`SELECT * FROM ${T_DISPAROS} WHERE id = @id`);
  return (r.recordset[0] as Disparo) ?? null;
}

export async function obterStatusDisparo(id: number): Promise<string | null> {
  const r = await (await req()).input("id", sql.Int, id).query(`SELECT status FROM ${T_DISPAROS} WHERE id = @id`);
  return r.recordset[0]?.status ?? null;
}

/** Disparo mais recente em andamento/pausado/aguardando aprovação (só pode haver um por vez). */
export async function obterDisparoAtivo(): Promise<Disparo | null> {
  const r = await (await req()).query(`
    SELECT TOP 1 * FROM ${T_DISPAROS}
    WHERE status IN (${STATUS_ATIVOS.map((s) => `'${s}'`).join(",")})
    ORDER BY data_inicio DESC, id DESC
  `);
  return (r.recordset[0] as Disparo) ?? null;
}

/** Disparo aguardando aprovação — pela conversa do Chatwoot quando informada. */
export async function obterDisparoAguardandoAprovacao(conversaId: number | null): Promise<Disparo | null> {
  const rq = await req();
  let filtro = "";
  if (conversaId) {
    rq.input("conversa_id", sql.Int, conversaId);
    filtro = "AND aprovacao_conversa_id = @conversa_id";
  }
  const r = await rq.query(`
    SELECT TOP 1 * FROM ${T_DISPAROS}
    WHERE status = 'AWAITING_APPROVAL' ${filtro}
    ORDER BY data_inicio DESC, id DESC
  `);
  return (r.recordset[0] as Disparo) ?? null;
}

export async function criarDisparo(d: { lista_id: number; template_nome: string; status: string; configuracao: string }): Promise<Disparo> {
  const r = await (await req())
    .input("lista_id", sql.Int, d.lista_id)
    .input("template_nome", sql.NVarChar(512), d.template_nome)
    .input("status", sql.VarChar(30), d.status)
    .input("configuracao", sql.NVarChar(sql.MAX), d.configuracao)
    .query(`
      INSERT INTO ${T_DISPAROS} (lista_id, template_nome, status, configuracao)
      OUTPUT INSERTED.*
      VALUES (@lista_id, @template_nome, @status, @configuracao)
    `);
  return r.recordset[0] as Disparo;
}

export async function atualizarStatusDisparo(id: number, status: string, resultado?: string): Promise<void> {
  const rq = (await req()).input("id", sql.Int, id).input("status", sql.VarChar(30), status);
  let setResultado = "";
  if (resultado !== undefined) {
    rq.input("resultado", sql.NVarChar(sql.MAX), resultado);
    setResultado = ", resultado = @resultado";
  }
  await rq.query(`UPDATE ${T_DISPAROS} SET status = @status${setResultado} WHERE id = @id`);
}

export async function registrarConversaAprovacao(id: number, conversaId: number): Promise<void> {
  await (await req())
    .input("id", sql.Int, id)
    .input("conversa_id", sql.Int, conversaId)
    .input("ts", sql.DateTime2, new Date())
    .query(`UPDATE ${T_DISPAROS} SET aprovacao_conversa_id = @conversa_id, aprovacao_msg_id = 0, aprovacao_ts = @ts WHERE id = @id`);
}

// ── Logs ─────────────────────────────────────────────────────────────────────

export async function listarLogs(disparoId: number): Promise<LogDisparo[]> {
  const r = await (await req())
    .input("disparo_id", sql.Int, disparoId)
    .query(`SELECT id, disparo_id, contato_numero, status, mensagem_erro, meta_wamid, criado_em FROM ${T_LOGS} WHERE disparo_id = @disparo_id ORDER BY id`);
  return r.recordset as LogDisparo[];
}

export async function contarLogsPorStatus(disparoId: number): Promise<{ enviados: number; falhas: number }> {
  const r = await (await req())
    .input("disparo_id", sql.Int, disparoId)
    .query(`
      SELECT
        SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) AS enviados,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS falhas
      FROM ${T_LOGS} WHERE disparo_id = @disparo_id
    `);
  return { enviados: Number(r.recordset[0]?.enviados ?? 0), falhas: Number(r.recordset[0]?.falhas ?? 0) };
}

export async function inserirLogs(
  logs: { disparo_id: number; contato_numero: string; status: string; mensagem_erro: string; meta_wamid: string }[],
): Promise<void> {
  if (!logs.length) return;
  await garantirTabelasDisparo();
  const pool = await getPool();
  const lote = tamanhoLote(5);
  for (let i = 0; i < logs.length; i += lote) {
    const chunk = logs.slice(i, i + lote);
    const rq = pool.request();
    const valores = chunk.map((l, j) => {
      rq.input(`d${j}`, sql.Int, l.disparo_id);
      rq.input(`n${j}`, sql.VarChar(40), l.contato_numero);
      rq.input(`s${j}`, sql.VarChar(20), l.status);
      rq.input(`e${j}`, sql.NVarChar(sql.MAX), l.mensagem_erro || null);
      rq.input(`w${j}`, sql.NVarChar(255), l.meta_wamid || null);
      return `(@d${j}, @n${j}, @s${j}, @e${j}, @w${j})`;
    });
    await rq.query(`INSERT INTO ${T_LOGS} (disparo_id, contato_numero, status, mensagem_erro, meta_wamid) VALUES ${valores.join(",")}`);
  }
}

// ── Template → etiqueta (setor) ──────────────────────────────────────────────

/** Mapa template_nome (minúsculo) → etiqueta. Templates sem etiqueta ficam de fora. */
export async function mapaTemplateEtiqueta(): Promise<Record<string, string>> {
  const r = await (await req()).query(`SELECT template_nome, etiqueta FROM ${T_TEMPLATE_CONFIGS} WHERE etiqueta IS NOT NULL AND etiqueta <> ''`);
  const mapa: Record<string, string> = {};
  for (const row of r.recordset) mapa[String(row.template_nome).toLowerCase()] = String(row.etiqueta);
  return mapa;
}

export async function salvarTemplateEtiqueta(templateNome: string, etiqueta: string | null): Promise<void> {
  await (await req())
    .input("nome", sql.NVarChar(512), templateNome.toLowerCase())
    .input("etiqueta", sql.NVarChar(255), etiqueta || null)
    .query(`
      MERGE ${T_TEMPLATE_CONFIGS} WITH (HOLDLOCK) AS t
      USING (SELECT @nome AS template_nome) AS s ON t.template_nome = s.template_nome
      WHEN MATCHED THEN UPDATE SET etiqueta = @etiqueta, atualizado_em = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (template_nome, etiqueta) VALUES (@nome, @etiqueta);
    `);
}
