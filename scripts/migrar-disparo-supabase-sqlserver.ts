/**
 * Copia o histórico do Disparo do Supabase para o SQL Server local (tabelas DISPARO_*).
 *
 *   npx tsx scripts/migrar-disparo-supabase-sqlserver.ts --dry-run   # só conta e mostra o que faria
 *   npx tsx scripts/migrar-disparo-supabase-sqlserver.ts             # migra
 *
 * - Preserva os ids originais (IDENTITY_INSERT); os seeds das tabelas novas começam acima
 *   deles, então o que já foi criado direto no SQL Server não colide.
 * - Pode rodar de novo sem duplicar: cada tabela retoma do maior id já migrado (< seed).
 * - template_configs só insere o que não existe (não sobrescreve de-para feito no SQL Server).
 * - URLs de mídia do Supabase Storage na configuração viram a URL do backend (o arquivo
 *   sempre foi gravado também em uploads_media no servidor que fez o upload).
 * - Disparo que ficou ativo no Supabase (o bloqueio 402 interrompeu no meio) não pode
 *   travar os novos: AWAITING_APPROVAL vira REJECTED e PROCESSING/PAUSING vira PAUSED
 *   (dá pra retomar — pula quem já tem log — ou cancelar pela tela).
 */
import "dotenv/config";
import sql from "mssql";
import { getSupa } from "../server/services/supabase";
import { getPool } from "../server/db/sqlserver";
import * as db from "../server/services/disparo-db";

const PAGINA = 1000;

export interface FonteSupabase {
  /** Linhas com id > aposId, em ordem de id, no máximo `limite`. */
  lerPagina(tabela: string, aposId: number, limite: number): Promise<any[]>;
  /** Todas as linhas da tabela (usada só em template_configs, que é pequena e não tem id). */
  lerTudo(tabela: string): Promise<any[]>;
}

export const fonteSupabase: FonteSupabase = {
  async lerPagina(tabela, aposId, limite) {
    const { data, error } = await getSupa().from(tabela).select("*").gt("id", aposId).order("id").limit(limite);
    if (error) throw new Error(`Supabase ${tabela}: ${error.message}`);
    return data ?? [];
  },
  async lerTudo(tabela) {
    const todas: any[] = [];
    for (let de = 0; ; de += PAGINA) {
      const { data, error } = await getSupa().from(tabela).select("*").order("template_nome").range(de, de + PAGINA - 1);
      if (error) throw new Error(`Supabase ${tabela}: ${error.message}`);
      todas.push(...(data ?? []));
      if (!data || data.length < PAGINA) return todas;
    }
  },
};

// ── Conversões ───────────────────────────────────────────────────────────────

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function data(...vals: unknown[]): Date | null {
  for (const v of vals) {
    if (v === null || v === undefined || v === "") continue;
    const d = new Date(v as string);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

const RE_MIDIA_SUPABASE = /https:\/\/[^/"\s]+\.supabase\.co\/storage\/v1\/object\/public\/[^/"\s]+\/([^?#"\s]+)/g;

export function reescreverMidia(configuracao: string | null): string | null {
  if (!configuracao) return configuracao;
  const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base) return configuracao;
  return configuracao.replace(RE_MIDIA_SUPABASE, (_m, nome) => `${base}/api/disparo/media/${nome}`);
}

function statusMigrado(status: string): string {
  if (status === "AWAITING_APPROVAL") return "REJECTED";
  if (status === "PROCESSING" || status === "PAUSING") return "PAUSED";
  return status;
}

// ── Cópia genérica com IDENTITY_INSERT ───────────────────────────────────────

interface Coluna { nome: string; tipo: () => sql.ISqlType | sql.ISqlTypeFactoryWithNoParams; valor: (row: any) => unknown }

async function copiarTabela(
  fonte: FonteSupabase, origem: string, destino: string, seed: number, colunas: Coluna[], dryRun: boolean,
  log: (m: string) => void,
): Promise<{ lidas: number; inseridas: number }> {
  const pool = await getPool();
  const r = await pool.request().input("seed", sql.BigInt, seed)
    .query(`SELECT ISNULL(MAX(id), 0) AS ultimo FROM ${destino} WHERE id < @seed`);
  let ultimo = Number(r.recordset[0].ultimo);
  if (ultimo) log(`  ${origem}: retomando após id ${ultimo}`);

  const nomes = ["id", ...colunas.map((c) => c.nome)];
  const porInsert = Math.floor(2000 / nomes.length);
  let lidas = 0;
  let inseridas = 0;
  for (;;) {
    const pagina = await fonte.lerPagina(origem, ultimo, PAGINA);
    if (!pagina.length) break;
    lidas += pagina.length;
    const maior = Math.max(...pagina.map((p) => Number(p.id)));
    if (maior >= seed) {
      throw new Error(`${origem}: id ${maior} no Supabase alcança o seed ${seed} de ${destino} — ajuste o seed antes de migrar.`);
    }
    if (dryRun) {
      for (const row of pagina) colunas.forEach((c) => c.valor(row)); // valida as conversões
    } else {
      for (let i = 0; i < pagina.length; i += porInsert) {
        const chunk = pagina.slice(i, i + porInsert);
        const rq = pool.request();
        const valores = chunk.map((row, j) => {
          rq.input(`id${j}`, sql.BigInt, Number(row.id));
          colunas.forEach((c, k) => rq.input(`c${k}_${j}`, c.tipo(), c.valor(row)));
          return `(@id${j}, ${colunas.map((_, k) => `@c${k}_${j}`).join(", ")})`;
        });
        // Um batch só: IDENTITY_INSERT vale por sessão, e o pool pode trocar de conexão entre requests
        await rq.query(`
          SET IDENTITY_INSERT ${destino} ON;
          INSERT INTO ${destino} (${nomes.join(", ")}) VALUES ${valores.join(",")};
          SET IDENTITY_INSERT ${destino} OFF;
        `);
        inseridas += chunk.length;
      }
    }
    ultimo = maior;
    if (lidas % 20000 < PAGINA) log(`  ${origem}: ${lidas} lidas...`);
  }
  return { lidas, inseridas };
}

// ── Migração ─────────────────────────────────────────────────────────────────

export async function migrar(fonte: FonteSupabase, dryRun: boolean, log: (m: string) => void = console.log) {
  await db.garantirTabelasDisparo();
  log(dryRun ? "DRY-RUN — nada será gravado\n" : "Migrando Supabase → SQL Server\n");

  const resumo: Record<string, { lidas: number; inseridas: number }> = {};

  resumo.listas_contatos = await copiarTabela(fonte, "listas_contatos", db.T_LISTAS, db.SEED_LISTAS, [
    { nome: "nome_arquivo", tipo: () => sql.NVarChar(500), valor: (r) => texto(r.nome_arquivo) },
    { nome: "total_contatos", tipo: () => sql.Int, valor: (r) => Number(r.total_contatos ?? 0) },
    { nome: "criado_em", tipo: () => sql.DateTime2, valor: (r) => data(r.created_at, r.data_upload, r.criado_em, r.data_criacao) ?? new Date() },
  ], dryRun, log);

  resumo.contatos_lista = await copiarTabela(fonte, "contatos_lista", db.T_CONTATOS, db.SEED_CONTATOS, [
    { nome: "lista_id", tipo: () => sql.Int, valor: (r) => Number(r.lista_id) },
    { nome: "nome", tipo: () => sql.NVarChar(500), valor: (r) => texto(r.nome) },
    { nome: "numero", tipo: () => sql.VarChar(40), valor: (r) => String(r.numero ?? "") },
    { nome: "dados_extras", tipo: () => sql.NVarChar(sql.MAX), valor: (r) => texto(r.dados_extras) },
  ], dryRun, log);

  const ativosAjustados: string[] = [];
  resumo.disparos = await copiarTabela(fonte, "disparos", db.T_DISPAROS, db.SEED_DISPAROS, [
    { nome: "lista_id", tipo: () => sql.Int, valor: (r) => Number(r.lista_id) },
    { nome: "template_nome", tipo: () => sql.NVarChar(512), valor: (r) => String(r.template_nome ?? "") },
    {
      nome: "status", tipo: () => sql.VarChar(30), valor: (r) => {
        const novo = statusMigrado(String(r.status ?? ""));
        if (novo !== r.status) ativosAjustados.push(`#${r.id} ${r.status} → ${novo}`);
        return novo;
      },
    },
    { nome: "configuracao", tipo: () => sql.NVarChar(sql.MAX), valor: (r) => reescreverMidia(texto(r.configuracao)) },
    { nome: "resultado", tipo: () => sql.NVarChar(sql.MAX), valor: (r) => texto(r.resultado) },
    { nome: "data_inicio", tipo: () => sql.DateTime2, valor: (r) => data(r.data_inicio, r.created_at) ?? new Date() },
    { nome: "aprovacao_conversa_id", tipo: () => sql.Int, valor: (r) => (r.aprovacao_conversa_id ? Number(r.aprovacao_conversa_id) : null) },
    { nome: "aprovacao_msg_id", tipo: () => sql.Int, valor: (r) => (r.aprovacao_msg_id !== null && r.aprovacao_msg_id !== undefined ? Number(r.aprovacao_msg_id) : null) },
    { nome: "aprovacao_ts", tipo: () => sql.DateTime2, valor: (r) => data(r.aprovacao_ts) },
  ], dryRun, log);

  resumo.logs_disparo = await copiarTabela(fonte, "logs_disparo", db.T_LOGS, db.SEED_LOGS, [
    { nome: "disparo_id", tipo: () => sql.Int, valor: (r) => Number(r.disparo_id) },
    { nome: "contato_numero", tipo: () => sql.VarChar(40), valor: (r) => String(r.contato_numero ?? "?") },
    { nome: "status", tipo: () => sql.VarChar(20), valor: (r) => String(r.status ?? "") },
    { nome: "mensagem_erro", tipo: () => sql.NVarChar(sql.MAX), valor: (r) => texto(r.mensagem_erro) || null },
    { nome: "meta_wamid", tipo: () => sql.NVarChar(255), valor: (r) => texto(r.meta_wamid) || null },
    { nome: "criado_em", tipo: () => sql.DateTime2, valor: (r) => data(r.timestamp, r.created_at) ?? new Date() },
  ], dryRun, log);

  // template_configs: sem id; só insere o que ainda não existe no SQL Server
  const configs = await fonte.lerTudo("template_configs");
  let configsInseridas = 0;
  if (!dryRun) {
    const pool = await getPool();
    for (const c of configs) {
      const nome = String(c.template_nome ?? "").trim().toLowerCase();
      if (!nome) continue;
      const r = await pool.request()
        .input("nome", sql.NVarChar(512), nome)
        .input("etiqueta", sql.NVarChar(255), texto(c.etiqueta) || null)
        .input("atualizado_em", sql.DateTime2, data(c.atualizado_em) ?? new Date())
        .query(`
          IF NOT EXISTS (SELECT 1 FROM ${db.T_TEMPLATE_CONFIGS} WHERE template_nome = @nome)
            INSERT INTO ${db.T_TEMPLATE_CONFIGS} (template_nome, etiqueta, atualizado_em) VALUES (@nome, @etiqueta, @atualizado_em);
        `);
      configsInseridas += r.rowsAffected.reduce((a, b) => a + b, 0);
    }
  }
  resumo.template_configs = { lidas: configs.length, inseridas: configsInseridas };

  log("\nResumo (lidas no Supabase / inseridas no SQL Server):");
  for (const [t, r] of Object.entries(resumo)) log(`  ${t.padEnd(18)} ${String(r.lidas).padStart(9)} / ${r.inseridas}`);
  if (ativosAjustados.length) log(`\nDisparos que estavam ativos no Supabase (status ajustado):\n  ${ativosAjustados.join("\n  ")}`);
  return { resumo, ativosAjustados };
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("migrar-disparo-supabase-sqlserver.ts")) {
  migrar(fonteSupabase, process.argv.includes("--dry-run"))
    .then(() => process.exit(0))
    .catch((e) => { console.error("\nFALHOU:", e.message ?? e); process.exit(1); });
}
