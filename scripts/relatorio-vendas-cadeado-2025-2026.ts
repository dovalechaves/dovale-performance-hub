/**
 * Relatório: vendas de CADEADO (família de produto) em 2025 e 2026, mês a mês,
 * quantidade e valor, separado por tamanho (mm) — extraído da descrição do produto.
 *
 * Bases:
 *  - SJC        (Firebird)
 *  - SPM        (Firebird — base "mg" / SPM industrial)
 *  - Lockey SP  (Firebird — mesma base de Lockey/FAST, emp_fil_codigo = '11')
 *  - FAST       (Firebird — mesma base de Lockey/FAST, emp_fil_codigo = '12')
 *  - Lockey MG  (Firebird)
 *  - Lockey RS  (MySQL)
 *  - EP         (SQL Server — sistema EP, catálogo próprio sem coluna de descrição;
 *                tamanho resolvido via cruzamento do código de produto com a base SJC)
 *
 * Critério "família CADEADO":
 *  - Bases Firebird: produtos_nivel3.nome = 'CADEADO' (classificação oficial já usada
 *    nos relatórios de comissão do projeto)
 *  - Lockey RS (MySQL): pacad.Descricao LIKE 'CADEADO%' (a base não tem uma coluna de
 *    família confiável — "fabricante" está nulo em vários itens de cadeado)
 *  - EP: EP_ProdutosDoPedido.FAMILIA = 'CADEADO'
 *
 * Extração de tamanho (mm) a partir da descrição:
 *  1ª tentativa: número de 2-3 dígitos imediatamente seguido de "MM" (ex.: "45MM", "30 MM")
 *  2ª tentativa: número de 2-3 dígitos isolado (não colado a outro dígito nem a "/"),
 *    para casos como "CADEADO MULT 30" ou "CADEADO LAFONTE X25 BOX"
 *  Quando nenhuma das duas casa (ex.: "CADEADO PACRI 04 SEGREDO 45/40", peças/componentes
 *  como "CILINDRO DO CADEADO", "ARRASTADOR" etc. classificados na família por engano),
 *  o item cai em "Tamanho não identificado" — listado à parte na aba "Não identificados"
 *  para revisão manual.
 *
 * Padrão de venda real do projeto: pdv_psi_codigo NOT IN ('CC') e
 * pdv_tve_codigo NOT IN ('6','7','26','34').
 *
 * Rodar: npx tsx scripts/relatorio-vendas-cadeado-2025-2026.ts
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
const DATA_FIM = "2027-01-01"; // exclusivo — cobre todo 2025 e 2026

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
  base: string;
  ano: number;
  mes: number;
  codigo: string;
  descricao: string;
  qtde: number;
  valor: number;
}

function sqlCadeadoFirebird() {
  return `
    select
      extract(year from ped.pdv_data) as ano,
      extract(month from ped.pdv_data) as mes,
      p.pro_codigo as codigo,
      p.pro_resumo as descricao,
      sum(i.pvi_quantidade) as qtde,
      sum(coalesce(i.pvi_totalitem,0)+coalesce(i.pvi_substicms,0)+coalesce(i.pvi_vl_fcp_st,0)+coalesce(i.pvi_ipivalor,0)) as valor
    from pedidos_vendas ped
    inner join pedidos_vendas_itens i on i.pvi_numero = ped.pdv_numero
    inner join produtos p on p.pro_codigo = i.pvi_pro_codigo
    inner join produtos_nivel3 pg on pg.codigo = p.pro_nivel3
    where pg.nome = 'CADEADO'
    and ped.pdv_data >= date '${DATA_INI}'
    and ped.pdv_data < date '${DATA_FIM}'
    ${FILTRO_VENDA_FB}
    group by 1,2,3,4
  `;
}

function sqlCadeadoLockeySpFast() {
  return `
    select
      case when ped.emp_fil_codigo = '11' then 'Lockey SP' when ped.emp_fil_codigo = '12' then 'FAST' end as base,
      extract(year from ped.pdv_data) as ano,
      extract(month from ped.pdv_data) as mes,
      p.pro_codigo as codigo,
      p.pro_resumo as descricao,
      sum(i.pvi_quantidade) as qtde,
      sum(coalesce(i.pvi_totalitem,0)+coalesce(i.pvi_substicms,0)+coalesce(i.pvi_vl_fcp_st,0)+coalesce(i.pvi_ipivalor,0)) as valor
    from pedidos_vendas ped
    inner join pedidos_vendas_itens i on i.pvi_numero = ped.pdv_numero
    inner join produtos p on p.pro_codigo = i.pvi_pro_codigo
    inner join produtos_nivel3 pg on pg.codigo = p.pro_nivel3
    where pg.nome = 'CADEADO'
    and ped.emp_fil_codigo in ('11','12')
    and ped.pdv_data >= date '${DATA_INI}'
    and ped.pdv_data < date '${DATA_FIM}'
    ${FILTRO_VENDA_FB}
    group by 1,2,3,4,5
  `;
}

async function coletarFirebird(nomeBase: string, cfg: FirebirdOptions): Promise<Linha[]> {
  const rows = await queryFb(cfg, sqlCadeadoFirebird());
  return rows.map((r) => ({
    base: nomeBase,
    ano: Number(r.ANO),
    mes: Number(r.MES),
    codigo: String(r.CODIGO).trim(),
    descricao: (r.DESCRICAO ?? "").toString().trim(),
    qtde: Number(r.QTDE) || 0,
    valor: Number(r.VALOR) || 0,
  }));
}

async function coletarLockeySpFast(): Promise<Linha[]> {
  const rows = await queryFb(fbLockey, sqlCadeadoLockeySpFast());
  return rows.map((r) => ({
    base: r.BASE,
    ano: Number(r.ANO),
    mes: Number(r.MES),
    codigo: String(r.CODIGO).trim(),
    descricao: (r.DESCRICAO ?? "").toString().trim(),
    qtde: Number(r.QTDE) || 0,
    valor: Number(r.VALOR) || 0,
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
        p.CodigoPro as codigo,
        p.Descricao as descricao,
        sum(i.Qtd) as qtde,
        sum(i.Total) as valor
      from orcamentoitens i
      inner join orcamento o on i.Numero = o.IdPedido
      inner join pacad p on p.codigopro = i.CodigoVenda
      where o.\`Data\` >= ? and o.\`Data\` < ?
      and o.Orcamento = 'PEDIDO'
      and o.wsalt not in ('2')
      and o.idFormaPagamento not in ('26')
      and p.Descricao like 'CADEADO%'
      group by 1,2,3,4
      `,
      [DATA_INI, DATA_FIM]
    );
    return (rows as any[]).map((r) => ({
      base: "Lockey RS",
      ano: Number(r.ano),
      mes: Number(r.mes),
      codigo: String(r.codigo).trim(),
      descricao: (r.descricao ?? "").toString().trim(),
      qtde: Number(r.qtde) || 0,
      valor: Number(r.valor) || 0,
    }));
  } finally {
    await conn.end();
  }
}

async function coletarEP(): Promise<Linha[]> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("ini", sql.VarChar, DATA_INI)
    .input("fim", sql.VarChar, DATA_FIM)
    .query(`
      select
        year(e.[DATA]) as ano,
        month(e.[DATA]) as mes,
        p.CODIGO as codigo,
        sum(p.QTD) as qtde,
        sum(p.VALORTOTAL) as valor
      from EP e
      inner join EP_ProdutosDoPedido p on p.PedidoID = e.ID
      where e.[DATA] >= @ini and e.[DATA] < @fim
      and p.FAMILIA = 'CADEADO'
      group by year(e.[DATA]), month(e.[DATA]), p.CODIGO
    `);

  const linhasBrutas = r.recordset.map((row: any) => ({
    ano: Number(row.ano),
    mes: Number(row.mes),
    codigo: String(row.codigo).trim(),
    qtde: Number(row.qtde) || 0,
    valor: Number(row.valor) || 0,
  }));

  // EP não tem coluna de descrição — resolve via catálogo de produtos da SJC (mesmo código)
  const codigosUnicos = [...new Set(linhasBrutas.map((l) => l.codigo))];
  const descricoes = new Map<string, string>();
  if (codigosUnicos.length > 0) {
    const lista = codigosUnicos.map((c) => `'${c}'`).join(",");
    const rows = await queryFb(fbSJC, `select p.pro_codigo, p.pro_resumo from produtos p where p.pro_codigo in (${lista})`);
    rows.forEach((row: any) => descricoes.set(String(row.PRO_CODIGO).trim(), (row.PRO_RESUMO ?? "").toString().trim()));
  }

  return linhasBrutas.map((l) => ({
    base: "EP",
    ano: l.ano,
    mes: l.mes,
    codigo: l.codigo,
    descricao: descricoes.get(l.codigo) ?? "",
    qtde: l.qtde,
    valor: l.valor,
  }));
}

// Extrai o tamanho (mm) do cadeado a partir da descrição. Duas passadas, sempre
// capturando o número como token completo (nunca um pedaço de um número maior —
// ex.: não deixar "1000 MM" virar "000"/0mm) e restringindo a uma faixa plausível
// de tamanho de cadeado, para não confundir com número de modelo/variante
// (ex.: "PAPAIZ 08", "PACRI 04 SEGREDO 45/40" não são tamanhos de 8mm/4mm).
function extrairTamanho(descricao: string): number | null {
  const comMM = descricao.match(/(?<!\d)(\d{2,4})(?!\d)\s*MM\b/i);
  if (comMM) {
    const n = Number(comMM[1]);
    if (n >= 10 && n <= 300) return n;
  }
  const isolados = descricao.match(/(?<![\d/])(\d{2,3})(?![\d/])/g);
  if (isolados) {
    for (const tok of isolados) {
      const n = Number(tok);
      if (n >= 15 && n <= 100) return n;
    }
  }
  return null;
}

// A linha "Cadeado Porta Aço" (KING, MILANO, MILANINHO, TETRA, LATERAL, SOLO — cadeados
// pesados para portão/porta de aço) não segue a convenção "CADEADO MARCA TAMANHO" —
// é vendida por modelo, não por mm. É, sozinha, a maior parte do valor da família
// CADEADO (~R$ 12M de ~R$ 13,7M no período), então em vez de cair tudo em "não
// identificado" ela ganha sua própria classificação por modelo.
function extrairModeloPortaAco(descricao: string): string | null {
  const d = descricao.toUpperCase();
  const ehLinhaPorta = d.includes("PORTA") || d.includes("SOLO") || (d.includes("LATERAL") && d.includes("CADEADO"));
  if (!ehLinhaPorta) return null;
  if (d.includes("MILANINHO")) return "MILANINHO";
  if (d.includes("MILANO")) return "MILANO TETRA";
  if (d.includes("KING")) return "KING";
  if (d.includes("TETRA") && d.includes("LATER")) return "LATERAL TETRA";
  if (d.includes("TETRA")) return "TETRA";
  if (d.includes("LATER")) return "LATERAL (outros)";
  if (d.includes("INTERNO")) return "INTERNO";
  if (d.includes("SOLO")) return "SOLO";
  return "OUTROS MODELOS PORTA AÇO";
}

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

async function main() {
  console.log("=== Relatório: Vendas de CADEADO 2025-2026 (SJC, SPM, Lockey SP, FAST, Lockey MG, Lockey RS, EP) ===\n");

  const bases: { nome: string; coletar: () => Promise<Linha[]> }[] = [
    { nome: "SJC", coletar: () => coletarFirebird("SJC", fbSJC) },
    { nome: "SPM", coletar: () => coletarFirebird("SPM", fbSPM) },
    { nome: "Lockey MG", coletar: () => coletarFirebird("Lockey MG", fbLockeyMG) },
    { nome: "Lockey SP + FAST", coletar: coletarLockeySpFast },
    { nome: "Lockey RS", coletar: coletarLockeyRS },
    { nome: "EP", coletar: coletarEP },
  ];

  const todasLinhas: Linha[] = [];
  const statusBases: { base: string; status: string; linhas: number }[] = [];

  for (const b of bases) {
    console.log(`Consultando ${b.nome}...`);
    try {
      const linhas = await b.coletar();
      todasLinhas.push(...linhas);
      statusBases.push({ base: b.nome, status: "OK", linhas: linhas.length });
      console.log(`  OK: ${linhas.length} linhas`);
    } catch (e: any) {
      statusBases.push({ base: b.nome, status: `ERRO: ${e.message}`, linhas: 0 });
      console.error(`  ERRO em ${b.nome}: ${e.message}`);
    }
  }

  console.log(`\nTotal de linhas coletadas: ${todasLinhas.length}`);

  // ─── Detalhado agregado (Base, Ano, Mês, Código, Descrição) ────────────────
  const detalhado = new Map<string, Linha>();
  for (const l of todasLinhas) {
    const chave = `${l.base}|${l.ano}|${l.mes}|${l.codigo}`;
    const existente = detalhado.get(chave);
    if (existente) {
      existente.qtde += l.qtde;
      existente.valor += l.valor;
    } else {
      detalhado.set(chave, { ...l });
    }
  }
  const listaDetalhado = Array.from(detalhado.values());

  // ─── Classificação por tamanho (e, separadamente, por modelo p/ linha Porta Aço) ──
  const naoIdentificados: Linha[] = [];
  const porTamanhoMes = new Map<string, { tamanho: number; ano: number; mes: number; qtde: number; valor: number }>();
  const porModeloMes = new Map<string, { modelo: string; ano: number; mes: number; qtde: number; valor: number }>();

  for (const l of listaDetalhado) {
    const tamanho = extrairTamanho(l.descricao);
    if (tamanho !== null) {
      const chave = `${tamanho}|${l.ano}|${l.mes}`;
      const existente = porTamanhoMes.get(chave);
      if (existente) {
        existente.qtde += l.qtde;
        existente.valor += l.valor;
      } else {
        porTamanhoMes.set(chave, { tamanho, ano: l.ano, mes: l.mes, qtde: l.qtde, valor: l.valor });
      }
      continue;
    }
    const modelo = extrairModeloPortaAco(l.descricao);
    if (modelo !== null) {
      const chave = `${modelo}|${l.ano}|${l.mes}`;
      const existente = porModeloMes.get(chave);
      if (existente) {
        existente.qtde += l.qtde;
        existente.valor += l.valor;
      } else {
        porModeloMes.set(chave, { modelo, ano: l.ano, mes: l.mes, qtde: l.qtde, valor: l.valor });
      }
      continue;
    }
    naoIdentificados.push(l);
  }

  const tamanhos = [...new Set(Array.from(porTamanhoMes.values()).map((v) => v.tamanho))].sort((a, b) => a - b);
  const modelosPortaAco = [...new Set(Array.from(porModeloMes.values()).map((v) => v.modelo))].sort();
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

  function montarPivotGenerico<K extends string | number>(
    chaves: K[],
    coluna: string,
    mapa: Map<string, { qtde: number; valor: number }>,
    campo: "qtde" | "valor"
  ) {
    const linhas = chaves.map((chave) => {
      const linha: Record<string, any> = { [coluna]: chave };
      let total = 0;
      for (const p of periodosOrdenados) {
        const v = mapa.get(`${chave}|${p.ano}|${p.mes}`);
        const valor = v ? v[campo] : 0;
        linha[labelPeriodo(p.ano, p.mes)] = valor;
        total += valor;
      }
      linha["Total"] = total;
      return linha;
    });
    const linhaTotal: Record<string, any> = { [coluna]: "TOTAL" };
    let totalGeral = 0;
    for (const p of periodosOrdenados) {
      const soma = chaves.reduce((acc, c) => acc + (mapa.get(`${c}|${p.ano}|${p.mes}`)?.[campo] ?? 0), 0);
      linhaTotal[labelPeriodo(p.ano, p.mes)] = soma;
      totalGeral += soma;
    }
    linhaTotal["Total"] = totalGeral;
    linhas.push(linhaTotal);
    return linhas;
  }

  const arredondar = (linhas: Record<string, any>[]) =>
    linhas.map((l) => {
      const copia: Record<string, any> = {};
      for (const k of Object.keys(l)) copia[k] = typeof l[k] === "number" ? Number(l[k].toFixed(2)) : l[k];
      return copia;
    });

  const pivotQtde = montarPivotGenerico(tamanhos, "Tamanho (mm)", porTamanhoMes as any, "qtde");
  const pivotValor = arredondar(montarPivotGenerico(tamanhos, "Tamanho (mm)", porTamanhoMes as any, "valor"));
  const pivotModeloQtde = montarPivotGenerico(modelosPortaAco, "Modelo", porModeloMes as any, "qtde");
  const pivotModeloValor = arredondar(montarPivotGenerico(modelosPortaAco, "Modelo", porModeloMes as any, "valor"));

  // ─── Monta workbook ──────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();

  const wsStatus = XLSX.utils.json_to_sheet(
    statusBases.map((s) => ({ "Base": s.base, "Status": s.status, "Linhas coletadas": s.linhas }))
  );
  wsStatus["!cols"] = [{ wch: 20 }, { wch: 50 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsStatus, "Status das bases");

  const wsQtde = XLSX.utils.json_to_sheet(pivotQtde);
  XLSX.utils.book_append_sheet(wb, wsQtde, "Qtde por tamanho-mês");

  const wsValor = XLSX.utils.json_to_sheet(pivotValor);
  XLSX.utils.book_append_sheet(wb, wsValor, "Valor por tamanho-mês");

  const wsModeloQtde = XLSX.utils.json_to_sheet(pivotModeloQtde);
  XLSX.utils.book_append_sheet(wb, wsModeloQtde, "Qtde Porta Aço por modelo-mês");

  const wsModeloValor = XLSX.utils.json_to_sheet(pivotModeloValor);
  XLSX.utils.book_append_sheet(wb, wsModeloValor, "Valor Porta Aço por modelo-mês");

  const wsDetalhado = XLSX.utils.json_to_sheet(
    listaDetalhado
      .sort((a, b) => a.ano - b.ano || a.mes - b.mes || a.base.localeCompare(b.base) || a.codigo.localeCompare(b.codigo))
      .map((l) => ({
        "Base": l.base,
        "Ano": l.ano,
        "Mês": l.mes,
        "Código": l.codigo,
        "Descrição": l.descricao,
        "Tamanho (mm)": extrairTamanho(l.descricao) ?? "",
        "Modelo Porta Aço": extrairTamanho(l.descricao) === null ? extrairModeloPortaAco(l.descricao) ?? "" : "",
        "Quantidade": l.qtde,
        "Valor (R$)": Number(l.valor.toFixed(2)),
      }))
  );
  wsDetalhado["!cols"] = [{ wch: 16 }, { wch: 8 }, { wch: 6 }, { wch: 10 }, { wch: 50 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsDetalhado, "Detalhado");

  const wsNaoIdent = XLSX.utils.json_to_sheet(
    naoIdentificados
      .sort((a, b) => b.valor - a.valor)
      .map((l) => ({
        "Base": l.base,
        "Ano": l.ano,
        "Mês": l.mes,
        "Código": l.codigo,
        "Descrição": l.descricao,
        "Quantidade": l.qtde,
        "Valor (R$)": Number(l.valor.toFixed(2)),
      }))
  );
  wsNaoIdent["!cols"] = [{ wch: 16 }, { wch: 8 }, { wch: 6 }, { wch: 10 }, { wch: 50 }, { wch: 12 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsNaoIdent, "Não identificados (tamanho)");

  const fileName = "Vendas_Cadeado_2025_2026.xlsx";
  const outPath = path.join(os.homedir(), "Desktop", fileName);
  XLSX.writeFile(wb, outPath);

  const totalGeral = listaDetalhado.reduce((a, l) => a + l.valor, 0);
  const totalTamanho = Array.from(porTamanhoMes.values()).reduce((a, v) => a + v.valor, 0);
  const totalModelo = Array.from(porModeloMes.values()).reduce((a, v) => a + v.valor, 0);
  const totalNaoIdent = naoIdentificados.reduce((a, l) => a + l.valor, 0);

  console.log(`\nTotal família CADEADO no período: R$ ${totalGeral.toFixed(2)}`);
  console.log(`Tamanhos identificados: ${tamanhos.join(", ")} mm — R$ ${totalTamanho.toFixed(2)}`);
  console.log(`Linha Porta Aço (por modelo, sem mm): ${modelosPortaAco.join(", ")} — R$ ${totalModelo.toFixed(2)}`);
  console.log(`Itens sem classificação: ${naoIdentificados.length} linhas — R$ ${totalNaoIdent.toFixed(2)}`);
  console.log(`\nRelatório salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
