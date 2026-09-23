/**
 * Mesmo esquema de scripts/ferragens-pa-media-venda-2026.ts, mas agora a nova coluna
 * é a média de venda em VALOR (R$) de 2026, não quantidade. Adiciona só essa coluna
 * nova ao arquivo (usa exceljs pra preservar a formatação existente).
 *
 * Média = soma do valor vendido em 2026 (todas as 7 bases somadas) dividida pelo
 * número de meses que tiveram venda (valor > 0) — mesmo critério já usado pra
 * quantidade.
 *
 * Valor de venda (padrão do projeto):
 *  - Firebird (SJC, MG, Lockey MG, Lockey SP/FAST): SUM(pvi_totalitem + pvi_substicms
 *    + pvi_vl_fcp_st + pvi_ipivalor).
 *  - MySQL (Lockey RS, Niterói): SUM(i.Total) — mesmo campo usado no painel de comissão.
 *  - EP (SQL Server): SUM(p.VALORTOTAL) — mesmo campo usado no painel de comissão.
 *
 * Rodar: npx tsx scripts/ferragens-pa-media-valor-2026.ts
 */
import "dotenv/config";
import Firebird from "node-firebird";
import mysql from "mysql2/promise";
import sql from "mssql";
import ExcelJS from "exceljs";
import XLSX from "xlsx";
import { getPool } from "../server/db/sqlserver";
import { fbSJC, fbSPM, fbLockeyMG, fbLockey, myLockeyRS, myNiteroi } from "../server/services/comissao/db-externas";
import type { FirebirdOptions } from "../server/services/comissao/firebird";
import type { MySQLExtOptions } from "../server/services/comissao/mysql-ext";

const FILE_PATH = String.raw`C:\Users\willian.rubim\Documents\FerragensPA (1).xlsx`;

const DATA_INI = "2026-01-01";
function amanha(): string {
  const hoje = new Date();
  const t = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1);
  return t.toISOString().slice(0, 10);
}
const DATA_FIM = amanha();

const FILTRO_VENDA_FB = `
  and ped.pdv_psi_codigo not in ('CC')
  and ped.pdv_tve_codigo not in ('6','7','26','34')
  and ped.pdv_cli_codigo not in ('44274','98030','49268')
`;

interface Ponto {
  codigo: string;
  mes: number;
  valor: number;
}

function queryFb(cfg: FirebirdOptions, sqlText: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    Firebird.attach(cfg as any, (err, db) => {
      if (err) return reject(err);
      db.query(sqlText, [], (err2, result) => {
        db.detach();
        if (err2) return reject(err2);
        resolve((result as any[]) || []);
      });
    });
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function coletarFirebird(
  nome: string,
  cfg: FirebirdOptions,
  codigos: string[],
  extraFiltro = ""
): Promise<Ponto[]> {
  const out: Ponto[] = [];
  for (const lote of chunk(codigos, 400)) {
    const listaCodigos = lote.map((c) => `'${c}'`).join(",");
    const sqlText = `
      select p.pro_codigo as codigo, extract(month from ped.pdv_data) as mes,
      sum(coalesce(i.pvi_totalitem,0) + coalesce(i.pvi_substicms,0) + coalesce(i.pvi_vl_fcp_st,0) + coalesce(i.pvi_ipivalor,0)) as valor
      from pedidos_vendas ped
      inner join pedidos_vendas_itens i on i.pvi_numero = ped.pdv_numero
      inner join produtos p on p.pro_codigo = i.pvi_pro_codigo
      where p.pro_codigo in (${listaCodigos})
      and ped.pdv_data >= date '${DATA_INI}'
      and ped.pdv_data < date '${DATA_FIM}'
      ${FILTRO_VENDA_FB}
      ${extraFiltro}
      group by 1,2
    `;
    const rows = await queryFb(cfg, sqlText);
    for (const r of rows) {
      out.push({ codigo: String(r.CODIGO).trim(), mes: Number(r.MES), valor: Number(r.VALOR) || 0 });
    }
  }
  console.log(`  ${nome}: ${out.length} linhas código/mês`);
  return out;
}

async function coletarMySQL(nome: string, cfg: MySQLExtOptions, codigos: string[]): Promise<Ponto[]> {
  const out: Ponto[] = [];
  const conn = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    connectTimeout: 15000,
  });
  try {
    for (const lote of chunk(codigos, 400)) {
      const listaCodigos = lote.map((c) => `'${c}'`).join(",");
      const [rows] = await conn.query(
        `
        select p.CodigoPro as codigo, month(o.\`Data\`) as mes, sum(i.Total) as valor
        from orcamentoitens i
        inner join orcamento o on i.Numero = o.IdPedido
        inner join pacad p on p.codigopro = i.CodigoVenda
        where p.CodigoPro in (${listaCodigos})
        and o.\`Data\` >= ? and o.\`Data\` < ?
        and o.Orcamento = 'PEDIDO'
        and o.wsalt not in ('2')
        and o.idFormaPagamento not in ('26')
        group by 1,2
        `,
        [DATA_INI, DATA_FIM]
      );
      for (const r of rows as any[]) {
        out.push({ codigo: String(r.codigo).trim(), mes: Number(r.mes), valor: Number(r.valor) || 0 });
      }
    }
  } finally {
    await conn.end();
  }
  console.log(`  ${nome}: ${out.length} linhas código/mês`);
  return out;
}

async function coletarEP(codigos: string[]): Promise<Ponto[]> {
  const out: Ponto[] = [];
  const pool = await getPool();
  for (const lote of chunk(codigos, 400)) {
    const listaCodigos = lote.map((c) => `'${c}'`).join(",");
    const r = await pool
      .request()
      .input("ini", sql.VarChar, DATA_INI)
      .input("fim", sql.VarChar, DATA_FIM)
      .query(`
        select p.CODIGO as codigo, month(e.[DATA]) as mes, sum(p.VALORTOTAL) as valor
        from EP e
        inner join EP_ProdutosDoPedido p on p.PedidoID = e.ID
        where p.CODIGO in (${listaCodigos})
        and e.[DATA] >= @ini and e.[DATA] < @fim
        group by p.CODIGO, month(e.[DATA])
      `);
    for (const row of r.recordset as any[]) {
      out.push({ codigo: String(row.codigo).trim(), mes: Number(row.mes), valor: Number(row.valor) || 0 });
    }
  }
  console.log(`  EP: ${out.length} linhas código/mês`);
  return out;
}

async function main() {
  console.log("=== FerragensPA: adicionando coluna 'Média de Venda 2026 (R$)' ===");
  console.log(`Período: ${DATA_INI} até ${DATA_FIM} (exclusivo)\n`);

  const wbRead = XLSX.readFile(FILE_PATH);
  const wsRead = wbRead.Sheets[wbRead.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(wsRead, { header: 1, defval: null }) as any[][];
  const codigos = raw
    .slice(2)
    .map((row) => (row[0] != null ? String(row[0]).trim() : ""))
    .filter(Boolean);
  console.log(`Códigos encontrados no arquivo: ${codigos.length}\n`);

  const todosPontos: Ponto[] = [];
  todosPontos.push(...(await coletarFirebird("SJC", fbSJC, codigos)));
  todosPontos.push(...(await coletarFirebird("MG", fbSPM, codigos)));
  todosPontos.push(...(await coletarFirebird("LOCKEY MG", fbLockeyMG, codigos)));
  todosPontos.push(
    ...(await coletarFirebird("LOCKEY SP/FAST", fbLockey, codigos, "and ped.emp_fil_codigo in ('11','12')"))
  );
  todosPontos.push(...(await coletarMySQL("LOCKEY RS", myLockeyRS, codigos)));
  todosPontos.push(...(await coletarMySQL("NITERÓI", myNiteroi, codigos)));
  todosPontos.push(...(await coletarEP(codigos)));

  const porCodigoMes = new Map<string, Map<number, number>>();
  for (const p of todosPontos) {
    if (!porCodigoMes.has(p.codigo)) porCodigoMes.set(p.codigo, new Map());
    const m = porCodigoMes.get(p.codigo)!;
    m.set(p.mes, (m.get(p.mes) || 0) + p.valor);
  }

  const mediaPorCodigo = new Map<string, number>();
  for (const codigo of codigos) {
    const meses = porCodigoMes.get(codigo);
    if (!meses || meses.size === 0) {
      mediaPorCodigo.set(codigo, 0);
      continue;
    }
    let soma = 0;
    let mesesComVenda = 0;
    for (const valor of meses.values()) {
      soma += valor;
      if (valor > 0) mesesComVenda++;
    }
    mediaPorCodigo.set(codigo, mesesComVenda > 0 ? soma / mesesComVenda : 0);
  }

  console.log(`\nAtualizando arquivo: ${FILE_PATH}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE_PATH);
  const ws = wb.worksheets[0];

  const headerRow = ws.getRow(2);
  const novaColIdx = headerRow.cellCount + 1;
  headerRow.getCell(novaColIdx).value = "Média de Venda 2026 (R$)";

  for (let r = 3; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const codigoCell = row.getCell(1).value;
    const codigo = codigoCell != null ? String(codigoCell).trim() : "";
    if (!codigo) continue;
    const media = mediaPorCodigo.get(codigo) ?? 0;
    row.getCell(novaColIdx).value = Math.round(media * 100) / 100;
  }

  await wb.xlsx.writeFile(FILE_PATH);
  console.log("Arquivo atualizado com sucesso.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao atualizar arquivo:", err);
    process.exit(1);
  });
