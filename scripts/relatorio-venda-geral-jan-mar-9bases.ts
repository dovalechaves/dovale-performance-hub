/**
 * Relatório: Venda Geral — Janeiro, Fevereiro e Março/2026 — 9 bases:
 * SJC, MG, LOCKEY MG, LOCKEY SP, FAST, NITERÓI, BH, LOCKEY RS, EP.
 *
 * Todas as bases calculadas direto na origem (não usa a tabela
 * [TI-COMERCIAL_62-ControleEP] — ela só tem histórico a partir de 01/03/2026,
 * o que subestimaria Jan/Fev pra SJC/MG/EP; confirmado empiricamente).
 *
 * Fórmula padrão de venda do projeto:
 *  - Firebird (SJC, MG, LOCKEY MG, LOCKEY SP, FAST, BH): pvi_totalitem +
 *    pvi_substicms + pvi_vl_fcp_st + pvi_ipivalor. Filtro padrão:
 *    pdv_psi_codigo NOT IN ('CC'), pdv_tve_codigo NOT IN ('6','7','26','34').
 *    Lockey SP e FAST são a mesma base Firebird, separadas por
 *    emp_fil_codigo ('11'=Lockey SP, '12'=FAST).
 *  - MySQL (NITERÓI, LOCKEY RS): SUM(i.Total) — mesmo campo do painel de
 *    comissão (server/services/comissao/dados-externos.ts).
 *  - EP (SQL Server): SUM(p.VALORTOTAL) em EP + EP_ProdutosDoPedido — mesma
 *    fonte/campo já usados no painel de comissão (queryEPVendas).
 *
 * Rodar: npx tsx scripts/relatorio-venda-geral-jan-mar-9bases.ts
 */
import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import Firebird from "node-firebird";
import mysql from "mysql2/promise";
import sql from "mssql";
import { getPool } from "../server/db/sqlserver";
import { fbSJC, fbSPM, fbLockeyMG, fbLockey, fbLockeyBH, myLockeyRS, myNiteroi } from "../server/services/comissao/db-externas";
import type { FirebirdOptions } from "../server/services/comissao/firebird";
import type { MySQLExtOptions } from "../server/services/comissao/mysql-ext";

const MESES = [1, 2, 3];
const MESES_LABEL: Record<number, string> = { 1: "Jan", 2: "Fev", 3: "Mar" };
const DATA_INI = "2026-01-01";
const DATA_FIM = "2026-04-01"; // exclusivo — cobre Jan a Mar/2026

const FILTRO_VENDA_FB = `
  and ped.pdv_psi_codigo not in ('CC')
  and ped.pdv_tve_codigo not in ('6','7','26','34')
`;

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

interface ValorMes {
  mes: number;
  valor: number;
}

async function coletarFirebird(cfg: FirebirdOptions, extraFiltro = ""): Promise<ValorMes[]> {
  const sqlText = `
    select extract(month from ped.pdv_data) as mes,
      sum(coalesce(i.pvi_totalitem,0) + coalesce(i.pvi_substicms,0) + coalesce(i.pvi_vl_fcp_st,0) + coalesce(i.pvi_ipivalor,0)) as valor
    from pedidos_vendas ped
    inner join pedidos_vendas_itens i on i.pvi_numero = ped.pdv_numero
    where ped.pdv_data >= date '${DATA_INI}'
      and ped.pdv_data < date '${DATA_FIM}'
      ${FILTRO_VENDA_FB}
      ${extraFiltro}
    group by 1
  `;
  const rows = await queryFb(cfg, sqlText);
  return rows.map((r) => ({ mes: Number(r.MES), valor: Number(r.VALOR) || 0 }));
}

async function coletarMySQL(cfg: MySQLExtOptions): Promise<ValorMes[]> {
  const conn = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    connectTimeout: 15000,
  });
  try {
    const [rows] = await conn.query(
      `
      select month(o.\`Data\`) as mes, sum(i.Total) as valor
      from orcamentoitens i
      inner join orcamento o on i.Numero = o.IdPedido
      where o.\`Data\` >= ? and o.\`Data\` < ?
        and o.Orcamento = 'PEDIDO'
        and o.wsalt not in ('2')
        and o.idFormaPagamento not in ('26')
      group by 1
      `,
      [DATA_INI, DATA_FIM]
    );
    return (rows as any[]).map((r) => ({ mes: Number(r.mes), valor: Number(r.valor) || 0 }));
  } finally {
    await conn.end();
  }
}

async function coletarEP(): Promise<ValorMes[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("ini", sql.VarChar, DATA_INI)
    .input("fim", sql.VarChar, DATA_FIM)
    .query(`
      SELECT MONTH(e.[DATA]) AS MES, SUM(p.VALORTOTAL) AS VALOR
      FROM EP e
      INNER JOIN EP_ProdutosDoPedido p ON p.PedidoID = e.ID
      WHERE e.[DATA] >= @ini AND e.[DATA] < @fim
      GROUP BY MONTH(e.[DATA])
    `);
  return result.recordset.map((r: any) => ({ mes: Number(r.MES), valor: Number(r.VALOR) || 0 }));
}

interface Base {
  nome: string;
  coletar: () => Promise<ValorMes[]>;
}

async function main() {
  console.log("=== Venda Geral Jan-Mar/2026 — 9 bases (tudo direto de pedidos, sem ControleEP) ===\n");

  const bases: Base[] = [
    { nome: "SJC", coletar: () => coletarFirebird(fbSJC) },
    { nome: "MG", coletar: () => coletarFirebird(fbSPM) },
    { nome: "LOCKEY MG", coletar: () => coletarFirebird(fbLockeyMG) },
    { nome: "LOCKEY SP", coletar: () => coletarFirebird(fbLockey, "and ped.emp_fil_codigo = '11'") },
    { nome: "FAST", coletar: () => coletarFirebird(fbLockey, "and ped.emp_fil_codigo = '12'") },
    { nome: "BH", coletar: () => coletarFirebird(fbLockeyBH) },
    { nome: "NITERÓI", coletar: () => coletarMySQL(myNiteroi) },
    { nome: "LOCKEY RS", coletar: () => coletarMySQL(myLockeyRS) },
    { nome: "EP", coletar: () => coletarEP() },
  ];

  const linhas: Record<string, any>[] = [];
  const status: { base: string; status: string }[] = [];

  for (const base of bases) {
    console.log(`Consultando ${base.nome}...`);
    try {
      const valores = await base.coletar();
      const porMes = new Map(valores.map((v) => [v.mes, v.valor]));
      const linha: Record<string, any> = { "Base": base.nome };
      let total = 0;
      for (const mes of MESES) {
        const v = Math.round((porMes.get(mes) || 0) * 100) / 100;
        linha[MESES_LABEL[mes]] = v;
        total += v;
      }
      linha["Total (Jan-Mar)"] = Math.round(total * 100) / 100;
      linhas.push(linha);
      status.push({ base: base.nome, status: "OK" });
      console.log(`  OK`);
    } catch (e: any) {
      status.push({ base: base.nome, status: `ERRO: ${e.message}` });
      console.error(`  ERRO: ${e.message}`);
    }
  }

  const linhaTotal: Record<string, any> = { "Base": "TOTAL GERAL" };
  for (const mes of MESES) {
    linhaTotal[MESES_LABEL[mes]] = Math.round(linhas.reduce((s, l) => s + (l[MESES_LABEL[mes]] || 0), 0) * 100) / 100;
  }
  linhaTotal["Total (Jan-Mar)"] = Math.round(linhas.reduce((s, l) => s + (l["Total (Jan-Mar)"] || 0), 0) * 100) / 100;
  linhas.push(linhaTotal);

  console.log("\nResultado:");
  console.table(linhas);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(linhas);
  ws["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws, "Venda Geral Jan-Mar");

  const wsStatus = XLSX.utils.json_to_sheet(status);
  XLSX.utils.book_append_sheet(wb, wsStatus, "Status das bases");

  const fileName = `Relatorio_Venda_Geral_Jan_Mar_2026_9Bases.xlsx`;
  const outPath = path.join(os.homedir(), "Desktop", fileName);
  XLSX.writeFile(wb, outPath);

  console.log(`\nRelatório salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
