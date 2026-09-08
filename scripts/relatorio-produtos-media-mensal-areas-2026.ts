/**
 * Relatório: média mensal de vendas (quantidade), Jan-Ago 2026, para 4 grupos de
 * produtos, cada um com visão Geral + visão por área (TELEVENDAS, TELEVENDAS MG,
 * DISTRIBUIDORES, FERRAGENS, LOJAS) — mesmo esquema de setor do relatório de
 * "Chaves por setor" (scripts/relatorio-chaves-setores-2026.ts): RVS_NOME exato
 * para Televendas/Televendas MG/Distribuidores/Ferragens, prefixo "LOJA" p/ Lojas.
 *
 * Bases (6, exatamente as pedidas): SJC, MG (= base "SPM" no painel de comissão),
 * LOCKEY SP + FAST (mesma base, emp_fil_codigo 11/12), LOCKEY MG, LOCKEY RS (MySQL),
 * EP (SQL Server). Confirmado por introspecção: os códigos de produto pedidos batem
 * com o mesmo catálogo (mesma pro_resumo/Descricao) nas 6 bases.
 *
 * Partes:
 *  1) códigos: 87002,69026,77002,86002,87007,87008,69002,89002
 *  2) códigos: 17500,69011,17600,18350,69010,69012,37001,38001
 *  3) códigos: 75400,75401,79400,79401
 *  4) subgrupo FERRAGEM (pro_nivel2=6) OU família CILINDRO (pro_nivel3=17) —
 *     confirmado que união ≠ apenas FERRAGEM (2 produtos de CILINDRO ficam em outro
 *     subgrupo). Em Lockey RS (pacad) não existe a mesma hierarquia; usa-se
 *     SubGrupo='FERRAGEM' ou Fabricante='CILINDRO' (equivalente, conferido nos dados).
 *     Em EP, EP_ProdutosDoPedido.SUBGRUPO='FERRAGEM' ou FAMILIA='CILINDRO'.
 *
 * Setor em EP: não há coluna de setor — inferido pelo prefixo de e.VENDEDOR
 * (mesmo critério do painel de comissão, server/services/comissao/dados-externos.ts).
 * Setor em Lockey RS: vendedores.departamento (mesmo campo usado como "rvs_nome"
 * equivalente no painel de comissão para essa base).
 *
 * "Média Geral" = total vendido (todas as 6 bases, qualquer setor, inclusive
 * setores fora dos 5 listados) dividido por 8 meses. As colunas de área são a
 * mesma média, restrita ao setor.
 *
 * Padrão de venda real do projeto (bases Firebird): pdv_psi_codigo NOT IN ('CC'),
 * pdv_tve_codigo NOT IN ('6','7','26','34'), e exclusão dos clientes internos
 * ('44274','98030','49268') — mesmos filtros do painel de comissão.
 *
 * Rodar: npx tsx scripts/relatorio-produtos-media-mensal-areas-2026.ts
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

const DATA_INI = "2026-01-01";
const DATA_FIM = "2026-09-01"; // exclusivo — cobre Jan a Ago/2026
const MESES_PERIODO = 8;

const FILTRO_VENDA_FB = `
  and ped.pdv_psi_codigo not in ('CC')
  and ped.pdv_tve_codigo not in ('6','7','26','34')
  and ped.pdv_cli_codigo not in ('44274','98030','49268')
`;

const SETORES = ["TELEVENDAS", "TELEVENDAS MG", "DISTRIBUIDORES", "FERRAGENS", "LOJAS"] as const;
type Setor = (typeof SETORES)[number];

function classificarSetor(nomeRaw: string | null): Setor | null {
  if (!nomeRaw) return null;
  const nome = nomeRaw.trim().toUpperCase();
  if (nome === "TELEVENDAS") return "TELEVENDAS";
  if (nome === "TELEVENDAS MG") return "TELEVENDAS MG";
  if (nome === "DISTRIBUIDORES") return "DISTRIBUIDORES";
  if (nome === "FERRAGENS") return "FERRAGENS";
  if (nome.startsWith("LOJA")) return "LOJAS";
  return null;
}

// EP não tem coluna de setor — mesmo critério do painel de comissão (prefixo do vendedor)
function classificarSetorEP(vendedorRaw: string | null): Setor | null {
  if (!vendedorRaw) return null;
  const v = vendedorRaw.trim().toUpperCase();
  if (v.startsWith("TELEVENDAS MG")) return "TELEVENDAS MG";
  if (v.startsWith("TELEVENDAS")) return "TELEVENDAS";
  if (v.startsWith("FERRAGENS")) return "FERRAGENS";
  if (v.startsWith("DISTRIBUIDOR")) return "DISTRIBUIDORES";
  return null;
}

interface Linha {
  codigo: string;
  resumo: string;
  setor: Setor | null;
  qtde: number;
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

interface Parte {
  numero: number;
  titulo: string;
  codigos?: string[]; // se definido, filtra por lista de códigos
  categoriaFirebird?: string; // WHERE extra p/ bases Firebird (produtos p já no FROM)
  categoriaLockeyRS?: string; // WHERE extra p/ Lockey RS (pacad p já no FROM)
  categoriaEP?: string; // WHERE extra p/ EP (EP_ProdutosDoPedido p já no FROM)
}

const PARTES: Parte[] = [
  {
    numero: 1,
    titulo: "Parte 1",
    codigos: ["87002", "69026", "77002", "86002", "87007", "87008", "69002", "89002"],
  },
  {
    numero: 2,
    titulo: "Parte 2",
    codigos: ["17500", "69011", "17600", "18350", "69010", "69012", "37001", "38001"],
  },
  {
    numero: 3,
    titulo: "Parte 3",
    codigos: ["75400", "75401", "79400", "79401"],
  },
  {
    numero: 4,
    titulo: "Parte 4 - Ferragens (subgrupo 6) + Cilindros (família 17)",
    categoriaFirebird: "(p.pro_nivel2 = 6 or p.pro_nivel3 = 17)",
    categoriaLockeyRS: "(p.SubGrupo = 'FERRAGEM' or p.Fabricante = 'CILINDRO')",
    categoriaEP: "(p.SUBGRUPO = 'FERRAGEM' or p.FAMILIA = 'CILINDRO')",
  },
];

function whereFirebird(parte: Parte): string {
  if (parte.codigos) return `p.pro_codigo in (${parte.codigos.map((c) => `'${c}'`).join(",")})`;
  return parte.categoriaFirebird!;
}
function whereLockeyRS(parte: Parte): string {
  if (parte.codigos) return `p.CodigoPro in (${parte.codigos.map((c) => `'${c}'`).join(",")})`;
  return parte.categoriaLockeyRS!;
}
function whereEP(parte: Parte): string {
  if (parte.codigos) return `p.CODIGO in (${parte.codigos.map((c) => `'${c}'`).join(",")})`;
  return parte.categoriaEP!;
}

async function coletarFirebird(nomeBase: string, cfg: FirebirdOptions, parte: Parte, extraFiltro = ""): Promise<Linha[]> {
  const sqlText = `
    select
      p.pro_codigo as codigo,
      p.pro_resumo as resumo,
      rs.rvs_nome as setor,
      sum(i.pvi_quantidade) as qtde
    from pedidos_vendas ped
    inner join pedidos_vendas_itens i on i.pvi_numero = ped.pdv_numero
    inner join produtos p on p.pro_codigo = i.pvi_pro_codigo
    left join representantes r on r.rep_codigo = ped.pdv_rep_codigo
    left join representantes_supervisores rs on rs.rvs_codigo = r.rep_rvs_codigo
    where ${whereFirebird(parte)}
    ${extraFiltro}
    and ped.pdv_data >= date '${DATA_INI}'
    and ped.pdv_data < date '${DATA_FIM}'
    ${FILTRO_VENDA_FB}
    group by 1,2,3
  `;
  const rows = await queryFb(cfg, sqlText);
  return rows.map((r) => ({
    codigo: String(r.CODIGO).trim(),
    resumo: (r.RESUMO ?? "").toString().trim(),
    setor: classificarSetor(r.SETOR ? String(r.SETOR) : null),
    qtde: Number(r.QTDE) || 0,
  }));
}

async function coletarLockeyRS(parte: Parte): Promise<Linha[]> {
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
        p.CodigoPro as codigo,
        p.Descricao as resumo,
        v.departamento as setor,
        sum(i.Qtd) as qtde
      from orcamentoitens i
      inner join orcamento o on i.Numero = o.IdPedido
      inner join pacad p on p.codigopro = i.CodigoVenda
      left join vendedores v on v.codid = o.vendedor
      where ${whereLockeyRS(parte)}
      and o.\`Data\` >= ? and o.\`Data\` < ?
      and o.Orcamento = 'PEDIDO'
      and o.wsalt not in ('2')
      and o.idFormaPagamento not in ('26')
      group by 1,2,3
      `,
      [DATA_INI, DATA_FIM]
    );
    return (rows as any[]).map((r) => ({
      codigo: String(r.codigo).trim(),
      resumo: (r.resumo ?? "").toString().trim(),
      setor: classificarSetor(r.setor ?? null),
      qtde: Number(r.qtde) || 0,
    }));
  } finally {
    await conn.end();
  }
}

async function coletarEP(parte: Parte): Promise<Linha[]> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("ini", sql.VarChar, DATA_INI)
    .input("fim", sql.VarChar, DATA_FIM)
    .query(`
      select
        p.CODIGO as codigo,
        e.VENDEDOR as vendedor,
        sum(p.QTD) as qtde
      from EP e
      inner join EP_ProdutosDoPedido p on p.PedidoID = e.ID
      where ${whereEP(parte)}
      and e.[DATA] >= @ini and e.[DATA] < @fim
      group by p.CODIGO, e.VENDEDOR
    `);
  return r.recordset.map((row: any) => ({
    codigo: String(row.codigo).trim(),
    resumo: "", // EP não tem descrição — resolvida depois via catálogo SJC
    setor: classificarSetorEP(row.vendedor ?? null),
    qtde: Number(row.qtde) || 0,
  }));
}

async function resolverResumosFaltantes(codigos: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (codigos.length === 0) return mapa;
  const LOTE = 500;
  for (let i = 0; i < codigos.length; i += LOTE) {
    const pedaco = codigos.slice(i, i + LOTE);
    const lista = pedaco.map((c) => `'${c}'`).join(",");
    const rows = await queryFb(fbSJC, `select pro_codigo, pro_resumo from produtos where pro_codigo in (${lista})`);
    rows.forEach((row: any) => {
      const codigo = String(row.PRO_CODIGO).trim();
      const resumo = (row.PRO_RESUMO ?? "").toString().trim();
      if (resumo) mapa.set(codigo, resumo);
    });
  }
  return mapa;
}

interface Totais {
  geral: number;
  porSetor: Record<Setor, number>;
}

async function processarParte(parte: Parte): Promise<{
  linhas: Record<string, any>[];
  statusBases: { base: string; status: string; linhas: number }[];
}> {
  console.log(`\n=== ${parte.titulo} ===`);

  const bases: { nome: string; coletar: () => Promise<Linha[]> }[] = [
    { nome: "SJC", coletar: () => coletarFirebird("SJC", fbSJC, parte) },
    { nome: "MG", coletar: () => coletarFirebird("MG", fbSPM, parte) },
    { nome: "LOCKEY MG", coletar: () => coletarFirebird("LOCKEY MG", fbLockeyMG, parte) },
    {
      nome: "LOCKEYSP/FAST",
      coletar: () => coletarFirebird("LOCKEYSP/FAST", fbLockey, parte, "and ped.emp_fil_codigo in ('11','12')"),
    },
    { nome: "LOCKEY RS", coletar: () => coletarLockeyRS(parte) },
    { nome: "EP", coletar: () => coletarEP(parte) },
  ];

  const todasLinhas: Linha[] = [];
  const statusBases: { base: string; status: string; linhas: number }[] = [];

  for (const b of bases) {
    console.log(`  Consultando ${b.nome}...`);
    try {
      const linhas = await b.coletar();
      todasLinhas.push(...linhas);
      statusBases.push({ base: b.nome, status: "OK", linhas: linhas.length });
      console.log(`    OK: ${linhas.length} linhas`);
    } catch (e: any) {
      statusBases.push({ base: b.nome, status: `ERRO: ${e.message}`, linhas: 0 });
      console.error(`    ERRO em ${b.nome}: ${e.message}`);
    }
  }

  // ─── Resumo: prioriza a primeira base (na ordem acima) que trouxe descrição ──
  const resumoMap = new Map<string, string>();
  for (const l of todasLinhas) {
    if (l.resumo && !resumoMap.has(l.codigo)) resumoMap.set(l.codigo, l.resumo);
  }
  const codigosSemResumo = [...new Set(todasLinhas.map((l) => l.codigo))].filter((c) => !resumoMap.has(c));
  const resumosResolvidos = await resolverResumosFaltantes(codigosSemResumo);
  resumosResolvidos.forEach((resumo, codigo) => resumoMap.set(codigo, resumo));

  // ─── Agregação por código ────────────────────────────────────────────────────
  const totaisPorCodigo = new Map<string, Totais>();
  for (const l of todasLinhas) {
    if (!totaisPorCodigo.has(l.codigo)) {
      totaisPorCodigo.set(l.codigo, {
        geral: 0,
        porSetor: { TELEVENDAS: 0, "TELEVENDAS MG": 0, DISTRIBUIDORES: 0, FERRAGENS: 0, LOJAS: 0 },
      });
    }
    const t = totaisPorCodigo.get(l.codigo)!;
    t.geral += l.qtde;
    if (l.setor) t.porSetor[l.setor] += l.qtde;
  }

  const ordemCodigos = parte.codigos
    ? parte.codigos
    : [...totaisPorCodigo.keys()].sort((a, b) => (totaisPorCodigo.get(b)!.geral - totaisPorCodigo.get(a)!.geral));

  const linhasSaida = ordemCodigos.map((codigo) => {
    const t = totaisPorCodigo.get(codigo) ?? {
      geral: 0,
      porSetor: { TELEVENDAS: 0, "TELEVENDAS MG": 0, DISTRIBUIDORES: 0, FERRAGENS: 0, LOJAS: 0 } as Record<Setor, number>,
    };
    const media = (v: number) => Math.round(v / MESES_PERIODO);
    return {
      "Código": codigo,
      "Resumo": resumoMap.get(codigo) ?? "",
      "Média Mensal - Geral": media(t.geral),
      "Média Mensal - Televendas": media(t.porSetor.TELEVENDAS),
      "Média Mensal - Televendas MG": media(t.porSetor["TELEVENDAS MG"]),
      "Média Mensal - Distribuidores": media(t.porSetor.DISTRIBUIDORES),
      "Média Mensal - Ferragens": media(t.porSetor.FERRAGENS),
      "Média Mensal - Lojas": media(t.porSetor.LOJAS),
    };
  });

  // ─── Linha de total ──────────────────────────────────────────────────────────
  const linhaTotal: Record<string, any> = { "Código": "TOTAL", "Resumo": "" };
  for (const col of [
    "Média Mensal - Geral",
    "Média Mensal - Televendas",
    "Média Mensal - Televendas MG",
    "Média Mensal - Distribuidores",
    "Média Mensal - Ferragens",
    "Média Mensal - Lojas",
  ]) {
    linhaTotal[col] = Math.round(linhasSaida.reduce((acc, l) => acc + (l[col] as number), 0));
  }
  linhasSaida.push(linhaTotal);

  return { linhas: linhasSaida, statusBases };
}

async function main() {
  console.log("=== Relatório: Média mensal por produto e área — Jan a Ago/2026 ===");
  console.log("Bases: SJC, MG, LOCKEY MG, LOCKEYSP/FAST, LOCKEY RS, EP");

  const wb = XLSX.utils.book_new();
  const statusGeral: { parte: string; base: string; status: string; linhas: number }[] = [];

  for (const parte of PARTES) {
    const { linhas, statusBases } = await processarParte(parte);
    statusBases.forEach((s) => statusGeral.push({ parte: parte.titulo, ...s }));

    const ws = XLSX.utils.json_to_sheet(linhas);
    ws["!cols"] = [
      { wch: 10 },
      { wch: 55 },
      { wch: 16 },
      { wch: 16 },
      { wch: 18 },
      { wch: 18 },
      { wch: 16 },
      { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, `Parte ${parte.numero}`);
    console.log(`  ${parte.titulo}: ${linhas.length - 1} produtos`);
  }

  const wsStatus = XLSX.utils.json_to_sheet(
    statusGeral.map((s) => ({ "Parte": s.parte, "Base": s.base, "Status": s.status, "Linhas coletadas": s.linhas }))
  );
  wsStatus["!cols"] = [{ wch: 40 }, { wch: 16 }, { wch: 40 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsStatus, "Status das bases");

  const wsNotas = XLSX.utils.json_to_sheet([
    { Item: "Período", Detalhe: "Janeiro a Agosto de 2026 (8 meses) — média = total do período / 8" },
    { Item: "Bases", Detalhe: "SJC, MG, LOCKEY MG, LOCKEYSP/FAST (emp_fil_codigo 11/12), LOCKEY RS, EP" },
    {
      Item: "Setor (área)",
      Detalhe:
        "RVS_NOME (Firebird) / departamento (Lockey RS): exato p/ TELEVENDAS, TELEVENDAS MG, DISTRIBUIDORES, FERRAGENS; prefixo 'LOJA' p/ LOJAS. EP: inferido pelo prefixo do vendedor (mesmo critério do painel de comissão)",
    },
    { Item: "Média Geral", Detalhe: "Total vendido em todas as 6 bases, qualquer setor (inclusive fora dos 5 listados), / 8" },
    { Item: "Parte 4 - critério", Detalhe: "Subgrupo FERRAGEM (pro_nivel2=6) OU família CILINDRO (pro_nivel3=17); equivalentes em Lockey RS (SubGrupo/Fabricante) e EP (SUBGRUPO/FAMILIA)" },
    { Item: "Filtro de venda (Firebird)", Detalhe: "pdv_psi_codigo NOT IN ('CC'), pdv_tve_codigo NOT IN ('6','7','26','34'), exclui clientes internos 44274/98030/49268" },
  ]);
  wsNotas["!cols"] = [{ wch: 26 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(wb, wsNotas, "Notas");

  // Reordena: Notas e Status primeiro
  wb.SheetNames = ["Notas", "Status das bases", ...PARTES.map((p) => `Parte ${p.numero}`)];

  const outPath = path.join(os.homedir(), "Desktop", "Media_Mensal_Produtos_Por_Area_2026.xlsx");
  XLSX.writeFile(wb, outPath);
  console.log(`\nRelatório salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
