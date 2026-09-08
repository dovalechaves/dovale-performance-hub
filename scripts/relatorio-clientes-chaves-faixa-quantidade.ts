/**
 * Relatório: quantos clientes compraram CHAVES (subgrupo produtos_nivel2 = 'CHAVE',
 * código 1), por faixa de quantidade comprada no mês, de 2025 até hoje, mês a mês —
 * bases SJC, SPM, Lockey SP, FAST, Lockey MG, Lockey RS, EP.
 *
 * Faixas de quantidade (soma de pvi_quantidade/Qtd do cliente naquele mês, só chaves):
 *   1-499 | 500-999 | 1000-1999 | 2000-4999 | 5000+
 *
 * EP: fica no SQL Server 10.13, tabelas EP + EP_ProdutosDoPedido (confirmado pelo
 * Willian). Essa base não tem cadastro de cliente de verdade — a query que alimenta o
 * painel usa e.VENDEDOR como "cli_nome" (na prática é cidade/região, ex.: "Vila Velha",
 * "Rio de Janeiro"), então para a EP a unidade contada é essa cidade/região, não uma
 * empresa-cliente de fato. Chave = SUBGRUPO = 'CHAVE'; só existe status 'AA' na base
 * (sem cancelamento a filtrar).
 *
 * "Cliente" aqui é por empresa/base — não tento unificar identidade de cliente entre
 * sistemas diferentes (Microsys de SJC/SPM/Lockey MG/Lockey SP+FAST são bases Firebird
 * separadas: mesmo código numérico em duas dessas bases não é garantia de ser o mesmo
 * cliente físico; Lockey RS é outro sistema (MySQL/SAS) com codificação própria; EP nem
 * tem cliente real, usa cidade/região). Por isso a contagem final é a soma de
 * clientes-por-empresa em cada faixa/mês: um cliente que compra em duas empresas
 * diferentes conta uma vez em cada uma. Ver aba "Detalhado" para auditar por empresa/código.
 *
 * Padrão de venda real do projeto: pdv_psi_codigo NOT IN ('CC') e
 * pdv_tve_codigo NOT IN ('6','7','26','34') (equivalente em Lockey RS: Orcamento='PEDIDO',
 * wsalt<>'2', idFormaPagamento<>'26').
 *
 * Rodar: npx tsx scripts/relatorio-clientes-chaves-faixa-quantidade.ts
 */
import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import Firebird from "node-firebird";
import mysql from "mysql2/promise";
import sql from "mssql";
import { getPool } from "../server/db/sqlserver";
import { fbSJC, fbSPM, fbLockeyMG, fbLockey, myLockeyRS } from "../server/services/comissao/db-externas";
import type { FirebirdOptions } from "../server/services/comissao/firebird";

const DATA_INI = "2025-01-01";
const DATA_FIM = "2027-01-01"; // exclusivo — cobre todo 2025 e 2026 até hoje

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

interface Linha {
  empresa: string;
  ano: number;
  mes: number;
  codigo: string;
  qtde: number;
}

function sqlChavesFirebird(filtroFilial: string) {
  return `
    select
      extract(year from ped.pdv_data) as ano,
      extract(month from ped.pdv_data) as mes,
      ped.pdv_cli_codigo as codigo,
      sum(i.pvi_quantidade) as qtde
    from pedidos_vendas ped
    inner join pedidos_vendas_itens i on i.pvi_numero = ped.pdv_numero
    inner join produtos p on p.pro_codigo = i.pvi_pro_codigo
    inner join produtos_nivel2 pn on pn.codigo = p.pro_nivel2
    where pn.nome = 'CHAVE'
    ${filtroFilial}
    and ped.pdv_data >= date '${DATA_INI}'
    and ped.pdv_data < date '${DATA_FIM}'
    ${FILTRO_VENDA_FB}
    group by 1,2,3
  `;
}

async function coletarFirebird(empresa: string, cfg: FirebirdOptions, filtroFilial = ""): Promise<Linha[]> {
  const rows = await queryFb(cfg, sqlChavesFirebird(filtroFilial));
  return rows.map((r) => ({
    empresa,
    ano: Number(r.ANO),
    mes: Number(r.MES),
    codigo: String(r.CODIGO).trim(),
    qtde: Number(r.QTDE) || 0,
  }));
}

async function coletarLockeyRS(): Promise<Linha[]> {
  const conn = await mysql.createConnection({
    host: myLockeyRS.host,
    port: myLockeyRS.port,
    database: myLockeyRS.database,
    user: myLockeyRS.user,
    password: myLockeyRS.password,
    connectTimeout: 15000,
  });
  try {
    const [rows] = await conn.query(
      `
      select
        year(o.\`Data\`) as ano,
        month(o.\`Data\`) as mes,
        o.Cliente as codigo,
        sum(i.Qtd) as qtde
      from orcamentoitens i
      inner join orcamento o on i.Numero = o.IdPedido
      inner join pacad p on p.codigopro = i.CodigoVenda
      where p.SubGrupo = 'CHAVE'
      and o.\`Data\` >= ? and o.\`Data\` < ?
      and o.Orcamento = 'PEDIDO'
      and o.wsalt not in ('2')
      and o.idFormaPagamento not in ('26')
      group by 1,2,3
      `,
      [DATA_INI, DATA_FIM]
    );
    return (rows as any[])
      .filter((r) => r.codigo !== null && r.codigo !== undefined && String(r.codigo).trim() !== "")
      .map((r) => ({
        empresa: "Lockey RS",
        ano: Number(r.ano),
        mes: Number(r.mes),
        codigo: String(r.codigo).trim(),
        qtde: Number(r.qtde) || 0,
      }));
  } finally {
    await conn.end();
  }
}

async function coletarEP(): Promise<Linha[]> {
  // Query confirmada pelo Willian — mesma que alimenta a tabela/painel da EP.
  // e.VENDEDOR (aliasado como cli_nome na query original) é cidade/região, não uma
  // empresa-cliente de verdade — é o que existe de mais próximo de "cliente" na EP.
  const pool = await getPool();
  const r = await pool
    .request()
    .input("ini", sql.VarChar, DATA_INI)
    .input("fim", sql.VarChar, DATA_FIM)
    .query(`
      select
        year(e.[DATA]) as ano,
        month(e.[DATA]) as mes,
        e.VENDEDOR as cli_nome,
        sum(p.QTD) as qtde
      from EP e
      inner join EP_ProdutosDoPedido p on p.PedidoID = e.ID
      where p.SUBGRUPO = 'CHAVE'
      and e.[DATA] >= @ini and e.[DATA] < @fim
      group by year(e.[DATA]), month(e.[DATA]), e.VENDEDOR
    `);

  return r.recordset
    .filter((row: any) => row.cli_nome !== null && String(row.cli_nome).trim() !== "")
    .map((row: any) => ({
      empresa: "EP",
      ano: Number(row.ano),
      mes: Number(row.mes),
      codigo: String(row.cli_nome).trim(),
      qtde: Number(row.qtde) || 0,
    }));
}

function faixaDe(qtde: number): string {
  if (qtde >= 5000) return "5000+";
  if (qtde >= 2000) return "2000-4999";
  if (qtde >= 1000) return "1000-1999";
  if (qtde >= 500) return "500-999";
  return "1-499";
}

const FAIXAS_ORDEM = ["1-499", "500-999", "1000-1999", "2000-4999", "5000+"];
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

async function main() {
  console.log("=== Relatório: Clientes que compraram CHAVES por faixa de quantidade — 2025 até hoje ===\n");

  const fontes: { nome: string; coletar: () => Promise<Linha[]> }[] = [
    { nome: "SJC", coletar: () => coletarFirebird("SJC", fbSJC) },
    { nome: "SPM", coletar: () => coletarFirebird("SPM", fbSPM) },
    { nome: "Lockey MG", coletar: () => coletarFirebird("Lockey MG", fbLockeyMG) },
    { nome: "Lockey SP + FAST", coletar: () => coletarFirebird("Lockey SP + FAST", fbLockey, "and ped.emp_fil_codigo in ('11','12')") },
    { nome: "Lockey RS", coletar: coletarLockeyRS },
    { nome: "EP", coletar: coletarEP },
  ];

  const todasLinhas: Linha[] = [];
  const statusBases: { base: string; status: string; linhas: number }[] = [];

  for (const f of fontes) {
    console.log(`Consultando ${f.nome}...`);
    try {
      const linhas = await f.coletar();
      todasLinhas.push(...linhas);
      statusBases.push({ base: f.nome, status: "OK", linhas: linhas.length });
      console.log(`  OK: ${linhas.length} linhas`);
    } catch (e: any) {
      statusBases.push({ base: f.nome, status: `ERRO: ${e.message}`, linhas: 0 });
      console.error(`  ERRO em ${f.nome}: ${e.message}`);
    }
  }
  console.log(`\nTotal de linhas coletadas: ${todasLinhas.length}`);

  const periodosOrdenados: { ano: number; mes: number }[] = [];
  for (const ano of [2025, 2026]) {
    for (let mes = 1; mes <= 12; mes++) {
      if (ano === 2026 && new Date(ano, mes - 1, 1) > new Date()) continue;
      periodosOrdenados.push({ ano, mes });
    }
  }
  function labelPeriodo(ano: number, mes: number) {
    return `${MESES[mes - 1]}/${String(ano).slice(2)}`;
  }

  // ─── Detalhado: uma linha por (empresa, ano, mes, cliente) ─────────────────
  const detalhado = todasLinhas.map((l) => ({
    empresa: l.empresa,
    ano: l.ano,
    mes: l.mes,
    codigo: l.codigo,
    qtde: l.qtde,
    faixa: faixaDe(l.qtde),
  }));

  // ─── Contagem de clientes por faixa x mês (soma entre empresas) ────────────
  const contagem = new Map<string, Set<string>>(); // chave: faixa|ano|mes -> set de "empresa|codigo"
  for (const l of detalhado) {
    const chave = `${l.faixa}|${l.ano}|${l.mes}`;
    if (!contagem.has(chave)) contagem.set(chave, new Set());
    contagem.get(chave)!.add(`${l.empresa}|${l.codigo}`);
  }

  const pivot = FAIXAS_ORDEM.map((faixa) => {
    const linha: Record<string, any> = { "Faixa de Quantidade": faixa };
    let total = 0;
    for (const p of periodosOrdenados) {
      const n = contagem.get(`${faixa}|${p.ano}|${p.mes}`)?.size ?? 0;
      linha[labelPeriodo(p.ano, p.mes)] = n;
      total += n;
    }
    linha["Total (soma dos meses)"] = total;
    return linha;
  });

  const linhaTotal: Record<string, any> = { "Faixa de Quantidade": "TOTAL DE CLIENTES NO MÊS" };
  let totalGeral = 0;
  for (const p of periodosOrdenados) {
    const setMes = new Set<string>();
    FAIXAS_ORDEM.forEach((faixa) => {
      const s = contagem.get(`${faixa}|${p.ano}|${p.mes}`);
      if (s) s.forEach((v) => setMes.add(v));
    });
    linhaTotal[labelPeriodo(p.ano, p.mes)] = setMes.size;
    totalGeral += setMes.size;
  }
  linhaTotal["Total (soma dos meses)"] = totalGeral;
  pivot.push(linhaTotal);

  // ─── Monta workbook ──────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();

  const wsStatus = XLSX.utils.json_to_sheet(
    statusBases.map((s) => ({ "Base": s.base, "Status": s.status, "Linhas coletadas": s.linhas }))
  );
  wsStatus["!cols"] = [{ wch: 18 }, { wch: 90 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsStatus, "Status das bases");

  const wsPivot = XLSX.utils.json_to_sheet(pivot);
  XLSX.utils.book_append_sheet(wb, wsPivot, "Clientes por faixa-mês");

  const wsDetalhado = XLSX.utils.json_to_sheet(
    detalhado
      .sort((a, b) => a.ano - b.ano || a.mes - b.mes || a.empresa.localeCompare(b.empresa) || a.codigo.localeCompare(b.codigo, undefined, { numeric: true }))
      .map((l) => ({
        "Empresa": l.empresa,
        "Ano": l.ano,
        "Mês": l.mes,
        "Código Cliente": l.codigo,
        "Quantidade de Chaves no Mês": l.qtde,
        "Faixa": l.faixa,
      }))
  );
  wsDetalhado["!cols"] = [{ wch: 18 }, { wch: 8 }, { wch: 6 }, { wch: 14 }, { wch: 24 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsDetalhado, "Detalhado");

  const fileName = "Clientes_Chaves_Faixa_Quantidade_2025_2026.xlsx";
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
