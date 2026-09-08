/**
 * Relatório: vendas de tudo que NÃO é subgrupo CHAVE, separado por tipo de produto
 * (PA/PR), 2025 e 2026 mês a mês, quantidade e valor — mesmas bases do relatório de
 * cadeado (SJC, SPM, Lockey SP, FAST, Lockey MG, Lockey RS, EP).
 *
 * Subgrupo: produtos_nivel2.nome = 'CHAVE' (confirmado no banco — singular, sem "S").
 * Exclui esse subgrupo; mantém tudo o mais (FERRAGEM, FERRAGEM PARA CHAVEIRO,
 * AUTO PEÇAS, AUTO TECNOLOGIA, MICHA, AUTOMAÇÃO RESIDENCIAL, MÁQUINA, CARIMBO,
 * BATERIA, e itens sem subgrupo cadastrado).
 *
 * Tipo PA/PR:
 *  - SJC, SPM, Lockey MG, Lockey SP, FAST (Firebird): campo direto produtos.pro_tipo
 *    (mesmo campo já usado em outras rotinas do projeto — PA = Produto Acabado,
 *    PR = Produto Revenda). Outros tipos existentes na base (MP, PP, SV, ME, IM etc.)
 *    ficam fora do pedido e são somados à parte em "Outros tipos (fora do pedido)".
 *  - Lockey RS (MySQL) e EP (SQL Server) NÃO têm um campo equivalente a pro_tipo.
 *    Nessas duas bases uso o campo de grupo do produto como aproximação:
 *      Lockey RS: pacad.Grupo  → 'DOVALE' tratado como PA, 'REVENDA' como PR
 *      EP:        GRUPO        → 'PRODUÇÃO' tratado como PA, 'REVENDA' como PR
 *    Em ambos os casos, o que não cai em nenhuma das duas (ex.: Lockey RS "PADRAO"/
 *    em branco, EP "IMPORTADOS") fica em "Não classificado (aproximação)" — é uma
 *    aproximação, não o mesmo critério exato das bases Firebird.
 *
 * Padrão de venda real do projeto: pdv_psi_codigo NOT IN ('CC') e
 * pdv_tve_codigo NOT IN ('6','7','26','34').
 *
 * Rodar: npx tsx scripts/relatorio-vendas-nao-chave-pa-pr-2025-2026.ts
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

type Categoria = "PA" | "PR" | "OUTROS";

interface Linha {
  base: string;
  ano: number;
  mes: number;
  subgrupo: string;
  tipoOriginal: string;
  categoria: Categoria;
  aproximado: boolean;
  qtde: number;
  valor: number;
}

function sqlNaoChaveFirebird() {
  return `
    select
      extract(year from ped.pdv_data) as ano,
      extract(month from ped.pdv_data) as mes,
      p.pro_tipo as tipo,
      pn.nome as subgrupo,
      sum(i.pvi_quantidade) as qtde,
      sum(coalesce(i.pvi_totalitem,0)+coalesce(i.pvi_substicms,0)+coalesce(i.pvi_vl_fcp_st,0)+coalesce(i.pvi_ipivalor,0)) as valor
    from pedidos_vendas ped
    inner join pedidos_vendas_itens i on i.pvi_numero = ped.pdv_numero
    inner join produtos p on p.pro_codigo = i.pvi_pro_codigo
    left join produtos_nivel2 pn on pn.codigo = p.pro_nivel2
    where (pn.nome is null or pn.nome <> 'CHAVE')
    and ped.pdv_data >= date '${DATA_INI}'
    and ped.pdv_data < date '${DATA_FIM}'
    ${FILTRO_VENDA_FB}
    group by 1,2,3,4
  `;
}

function sqlNaoChaveLockeySpFast() {
  return `
    select
      case when ped.emp_fil_codigo = '11' then 'Lockey SP' when ped.emp_fil_codigo = '12' then 'FAST' end as base,
      extract(year from ped.pdv_data) as ano,
      extract(month from ped.pdv_data) as mes,
      p.pro_tipo as tipo,
      pn.nome as subgrupo,
      sum(i.pvi_quantidade) as qtde,
      sum(coalesce(i.pvi_totalitem,0)+coalesce(i.pvi_substicms,0)+coalesce(i.pvi_vl_fcp_st,0)+coalesce(i.pvi_ipivalor,0)) as valor
    from pedidos_vendas ped
    inner join pedidos_vendas_itens i on i.pvi_numero = ped.pdv_numero
    inner join produtos p on p.pro_codigo = i.pvi_pro_codigo
    left join produtos_nivel2 pn on pn.codigo = p.pro_nivel2
    where (pn.nome is null or pn.nome <> 'CHAVE')
    and ped.emp_fil_codigo in ('11','12')
    and ped.pdv_data >= date '${DATA_INI}'
    and ped.pdv_data < date '${DATA_FIM}'
    ${FILTRO_VENDA_FB}
    group by 1,2,3,4,5
  `;
}

function categoriaFirebird(tipo: string): { categoria: Categoria } {
  const t = (tipo || "").trim().toUpperCase();
  if (t === "PA") return { categoria: "PA" };
  if (t === "PR") return { categoria: "PR" };
  return { categoria: "OUTROS" };
}

async function coletarFirebird(nomeBase: string, cfg: FirebirdOptions): Promise<Linha[]> {
  const rows = await queryFb(cfg, sqlNaoChaveFirebird());
  return rows.map((r) => {
    const tipo = (r.TIPO ?? "").toString().trim();
    return {
      base: nomeBase,
      ano: Number(r.ANO),
      mes: Number(r.MES),
      subgrupo: (r.SUBGRUPO ?? "(sem subgrupo)").toString().trim() || "(sem subgrupo)",
      tipoOriginal: tipo,
      aproximado: false,
      ...categoriaFirebird(tipo),
      qtde: Number(r.QTDE) || 0,
      valor: Number(r.VALOR) || 0,
    };
  });
}

async function coletarLockeySpFast(): Promise<Linha[]> {
  const rows = await queryFb(fbLockey, sqlNaoChaveLockeySpFast());
  return rows.map((r) => {
    const tipo = (r.TIPO ?? "").toString().trim();
    return {
      base: r.BASE,
      ano: Number(r.ANO),
      mes: Number(r.MES),
      subgrupo: (r.SUBGRUPO ?? "(sem subgrupo)").toString().trim() || "(sem subgrupo)",
      tipoOriginal: tipo,
      aproximado: false,
      ...categoriaFirebird(tipo),
      qtde: Number(r.QTDE) || 0,
      valor: Number(r.VALOR) || 0,
    };
  });
}

function categoriaProxy(grupo: string, mapaPA: string, mapaPR: string): Categoria {
  const g = (grupo || "").trim().toUpperCase();
  if (g === mapaPA.toUpperCase()) return "PA";
  if (g === mapaPR.toUpperCase()) return "PR";
  return "OUTROS";
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
        p.Grupo as grupo,
        p.SubGrupo as subgrupo,
        sum(i.Qtd) as qtde,
        sum(i.Total) as valor
      from orcamentoitens i
      inner join orcamento o on i.Numero = o.IdPedido
      inner join pacad p on p.codigopro = i.CodigoVenda
      where o.\`Data\` >= ? and o.\`Data\` < ?
      and o.Orcamento = 'PEDIDO'
      and o.wsalt not in ('2')
      and o.idFormaPagamento not in ('26')
      and (p.SubGrupo is null or p.SubGrupo <> 'CHAVE')
      group by 1,2,3,4
      `,
      [DATA_INI, DATA_FIM]
    );
    return (rows as any[]).map((r) => ({
      base: "Lockey RS",
      ano: Number(r.ano),
      mes: Number(r.mes),
      subgrupo: (r.subgrupo ?? "(sem subgrupo)").toString().trim() || "(sem subgrupo)",
      tipoOriginal: (r.grupo ?? "").toString().trim(),
      aproximado: true,
      categoria: categoriaProxy(r.grupo, "DOVALE", "REVENDA"),
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
        p.GRUPO as grupo,
        p.SUBGRUPO as subgrupo,
        sum(p.QTD) as qtde,
        sum(p.VALORTOTAL) as valor
      from EP e
      inner join EP_ProdutosDoPedido p on p.PedidoID = e.ID
      where e.[DATA] >= @ini and e.[DATA] < @fim
      and (p.SUBGRUPO is null or p.SUBGRUPO <> 'CHAVE')
      group by year(e.[DATA]), month(e.[DATA]), p.GRUPO, p.SUBGRUPO
    `);

  return r.recordset.map((row: any) => ({
    base: "EP",
    ano: Number(row.ano),
    mes: Number(row.mes),
    subgrupo: (row.subgrupo ?? "(sem subgrupo)").toString().trim() || "(sem subgrupo)",
    tipoOriginal: (row.grupo ?? "").toString().trim(),
    aproximado: true,
    categoria: categoriaProxy(row.grupo, "PRODUÇÃO", "REVENDA"),
    qtde: Number(row.qtde) || 0,
    valor: Number(row.valor) || 0,
  }));
}

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

async function main() {
  console.log("=== Relatório: Vendas subgrupo <> CHAVE, por tipo PA/PR — 2025-2026 (SJC, SPM, Lockey SP, FAST, Lockey MG, Lockey RS, EP) ===\n");

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

  // ─── Agregação por categoria (PA/PR/OUTROS) x Ano x Mês ────────────────────
  const porCategoriaMes = new Map<string, { categoria: Categoria; ano: number; mes: number; qtde: number; valor: number }>();
  for (const l of todasLinhas) {
    const chave = `${l.categoria}|${l.ano}|${l.mes}`;
    const e = porCategoriaMes.get(chave);
    if (e) {
      e.qtde += l.qtde;
      e.valor += l.valor;
    } else {
      porCategoriaMes.set(chave, { categoria: l.categoria, ano: l.ano, mes: l.mes, qtde: l.qtde, valor: l.valor });
    }
  }

  // Uma linha por mês, com quantidade e valor lado a lado para cada categoria —
  // tudo na mesma tabela/página, em vez de abas separadas por métrica.
  function montarTabelaMensal(categorias: Categoria[]) {
    const linhas = periodosOrdenados.map((p) => {
      const linha: Record<string, any> = { "Ano": p.ano, "Mês": MESES[p.mes - 1] };
      let totalQtde = 0;
      let totalValor = 0;
      for (const cat of categorias) {
        const v = porCategoriaMes.get(`${cat}|${p.ano}|${p.mes}`);
        const qtde = v?.qtde ?? 0;
        const valor = Number((v?.valor ?? 0).toFixed(2));
        linha[`${cat} - Quantidade`] = qtde;
        linha[`${cat} - Valor (R$)`] = valor;
        totalQtde += qtde;
        totalValor += valor;
      }
      if (categorias.length > 1) {
        linha["Total - Quantidade"] = totalQtde;
        linha["Total - Valor (R$)"] = Number(totalValor.toFixed(2));
      }
      return linha;
    });

    const linhaTotal: Record<string, any> = { "Ano": "", "Mês": "TOTAL" };
    let totalQtdeGeral = 0;
    let totalValorGeral = 0;
    for (const cat of categorias) {
      const somaQtde = periodosOrdenados.reduce((acc, p) => acc + (porCategoriaMes.get(`${cat}|${p.ano}|${p.mes}`)?.qtde ?? 0), 0);
      const somaValor = periodosOrdenados.reduce((acc, p) => acc + (porCategoriaMes.get(`${cat}|${p.ano}|${p.mes}`)?.valor ?? 0), 0);
      linhaTotal[`${cat} - Quantidade`] = somaQtde;
      linhaTotal[`${cat} - Valor (R$)`] = Number(somaValor.toFixed(2));
      totalQtdeGeral += somaQtde;
      totalValorGeral += somaValor;
    }
    if (categorias.length > 1) {
      linhaTotal["Total - Quantidade"] = totalQtdeGeral;
      linhaTotal["Total - Valor (R$)"] = Number(totalValorGeral.toFixed(2));
    }
    linhas.push(linhaTotal);
    return linhas;
  }

  const tabelaPAPR = montarTabelaMensal(["PA", "PR"]);
  const tabelaOutros = montarTabelaMensal(["OUTROS"]);

  // ─── Detalhado agregado (Base, Ano, Mês, Subgrupo, Tipo original, Categoria) ─
  const detalhado = new Map<string, Linha>();
  for (const l of todasLinhas) {
    const chave = `${l.base}|${l.ano}|${l.mes}|${l.subgrupo}|${l.tipoOriginal}|${l.categoria}`;
    const e = detalhado.get(chave);
    if (e) {
      e.qtde += l.qtde;
      e.valor += l.valor;
    } else {
      detalhado.set(chave, { ...l });
    }
  }
  const listaDetalhado = Array.from(detalhado.values()).sort(
    (a, b) => a.ano - b.ano || a.mes - b.mes || a.base.localeCompare(b.base) || a.subgrupo.localeCompare(b.subgrupo)
  );

  // ─── Monta workbook ──────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();

  const wsNotas = XLSX.utils.json_to_sheet([
    { "Item": "Subgrupo excluído", "Detalhe": "produtos_nivel2.nome = 'CHAVE' (confirmado no banco, singular)" },
    { "Item": "Bases com tipo PA/PR real", "Detalhe": "SJC, SPM, Lockey MG, Lockey SP, FAST (campo produtos.pro_tipo)" },
    { "Item": "Bases com tipo aproximado", "Detalhe": "Lockey RS (Grupo: DOVALE→PA, REVENDA→PR) e EP (GRUPO: PRODUÇÃO→PA, REVENDA→PR) — não têm campo equivalente a pro_tipo" },
    { "Item": "Período", "Detalhe": "01/01/2025 a hoje (2026)" },
    { "Item": "Filtro de venda real", "Detalhe": "pdv_psi_codigo NOT IN ('CC') e pdv_tve_codigo NOT IN ('6','7','26','34')" },
  ]);
  wsNotas["!cols"] = [{ wch: 26 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, wsNotas, "Notas");

  const wsStatus = XLSX.utils.json_to_sheet(
    statusBases.map((s) => ({ "Base": s.base, "Status": s.status, "Linhas coletadas": s.linhas }))
  );
  wsStatus["!cols"] = [{ wch: 20 }, { wch: 50 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsStatus, "Status das bases");

  const wsPAPR = XLSX.utils.json_to_sheet(tabelaPAPR);
  wsPAPR["!cols"] = [{ wch: 6 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsPAPR, "PA e PR por mês");

  const wsOutros = XLSX.utils.json_to_sheet(tabelaOutros);
  wsOutros["!cols"] = [{ wch: 6 }, { wch: 8 }, { wch: 18 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsOutros, "Outros tipos por mês");

  const wsDetalhado = XLSX.utils.json_to_sheet(
    listaDetalhado.map((l) => ({
      "Base": l.base,
      "Ano": l.ano,
      "Mês": l.mes,
      "Subgrupo": l.subgrupo,
      "Tipo/Grupo original": l.tipoOriginal,
      "Categoria (PA/PR)": l.categoria,
      "Aproximado?": l.aproximado ? "Sim" : "Não",
      "Quantidade": l.qtde,
      "Valor (R$)": Number(l.valor.toFixed(2)),
    }))
  );
  wsDetalhado["!cols"] = [{ wch: 16 }, { wch: 8 }, { wch: 6 }, { wch: 26 }, { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsDetalhado, "Detalhado");

  const fileName = "Vendas_Nao_Chave_PA_PR_2025_2026.xlsx";
  const outPath = path.join(os.homedir(), "Desktop", fileName);
  XLSX.writeFile(wb, outPath);

  const totalPA = Array.from(porCategoriaMes.values()).filter((v) => v.categoria === "PA").reduce((a, v) => a + v.valor, 0);
  const totalPR = Array.from(porCategoriaMes.values()).filter((v) => v.categoria === "PR").reduce((a, v) => a + v.valor, 0);
  const totalOutros = Array.from(porCategoriaMes.values()).filter((v) => v.categoria === "OUTROS").reduce((a, v) => a + v.valor, 0);

  console.log(`\nPA: R$ ${totalPA.toFixed(2)}`);
  console.log(`PR: R$ ${totalPR.toFixed(2)}`);
  console.log(`Outros tipos (fora do pedido): R$ ${totalOutros.toFixed(2)}`);
  console.log(`\nRelatório salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
