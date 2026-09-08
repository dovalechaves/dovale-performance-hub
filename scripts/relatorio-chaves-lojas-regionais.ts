/**
 * Mesmo relatório de chaves (faixa/queda/pivot cliente-mês) do Televendas, agora
 * para 5 lojas regionais — cada uma na sua PRÓPRIA base, sem unificar com nenhuma
 * outra (loja RJ = base RJ, loja Campinas = base Campinas, etc.):
 *
 *   BH        -> loja key "bh"
 *   Campinas  -> loja key "campinas"
 *   Santana   -> loja key "l2"  (confirmado em várias rotas do projeto: ecommerce.ts,
 *                inventario.ts, sugestao-compras.ts, sales-compass.ts, Hub.tsx)
 *   RJ        -> loja key "l3"  (confirmado em dados-externos.ts / Hub.tsx)
 *   Fortaleza -> loja key "fortaleza"
 *
 * SEM filtro de setor/Televendas: nenhuma dessas 5 lojas tem "TELEVENDAS" nos
 * setores (representantes_supervisores) — lá os setores são outros (LOJA,
 * DISTRIBUIDORES, VENDEDORES ATIVOS, VENDEDORES, LOJAS). Esse relatório traz TODAS
 * as vendas de chave da loja, de qualquer representante/setor.
 *
 * Faixas: 1-499 | 500-999 | 1000-1999 | 2000-4999 | 5000+
 * Padrão de venda real do projeto: pdv_psi_codigo NOT IN ('CC') e
 * pdv_tve_codigo NOT IN ('6','7','26','34').
 *
 * Representante = do CADASTRO do cliente (cli_rep_codigo), não do pedido.
 * Cliente aparece só uma vez na aba de detalhes (a queda de maior quantidade).
 *
 * Rodar: npx tsx scripts/relatorio-chaves-lojas-regionais.ts
 */
import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const LOJAS: { lojaKey: any; nomeArquivo: string }[] = [
  { lojaKey: "bh", nomeArquivo: "Chaves_BH.xlsx" },
  { lojaKey: "campinas", nomeArquivo: "Chaves_Campinas.xlsx" },
  { lojaKey: "l2", nomeArquivo: "Chaves_Santana.xlsx" },
  { lojaKey: "l3", nomeArquivo: "Chaves_RJ.xlsx" },
  { lojaKey: "fortaleza", nomeArquivo: "Chaves_Fortaleza.xlsx" },
];

function sqlChaves() {
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
    and ped.pdv_data >= date '2025-01-01'
    and ped.pdv_data < date '2027-01-01'
    and ped.pdv_psi_codigo not in ('CC')
    and ped.pdv_tve_codigo not in ('6','7','26','34')
    group by 1,2,3
  `;
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
function labelPeriodo(ano: number, mes: number) {
  return `${MESES[mes - 1]}/${String(ano).slice(2)}`;
}

interface MesInfo {
  qtde: number;
}

async function buscarNomesClientes(lojaKey: any, codigos: string[]): Promise<Map<string, string>> {
  const LOTE = 1000;
  const mapa = new Map<string, string>();
  for (let i = 0; i < codigos.length; i += LOTE) {
    const pedaco = codigos.slice(i, i + LOTE);
    const lista = pedaco.map((c) => `'${c}'`).join(",");
    const rows = await queryFirebird<any>(lojaKey, `select cli_codigo, cli_nome from clientes where cli_codigo in (${lista})`);
    rows.forEach((r: any) => {
      const codigo = r.CLI_CODIGO?.toString().trim();
      const nome = r.CLI_NOME?.toString().trim();
      if (codigo && nome) mapa.set(codigo, nome);
    });
  }
  return mapa;
}

async function buscarRepresentantesClientes(lojaKey: any, codigos: string[]): Promise<Map<string, string>> {
  const LOTE = 1000;
  const mapa = new Map<string, string>();
  for (let i = 0; i < codigos.length; i += LOTE) {
    const pedaco = codigos.slice(i, i + LOTE);
    const lista = pedaco.map((c) => `'${c}'`).join(",");
    const rows = await queryFirebird<any>(
      lojaKey,
      `select c.cli_codigo, r.rep_nome
       from clientes c
       inner join representantes r on r.rep_codigo = c.cli_rep_codigo
       where c.cli_codigo in (${lista})`
    );
    rows.forEach((r: any) => {
      const codigo = r.CLI_CODIGO?.toString().trim();
      const nome = r.REP_NOME?.toString().trim();
      if (codigo && nome) mapa.set(codigo, nome);
    });
  }
  return mapa;
}

function construirPivotClienteMes(
  porCliente: Map<string, Map<string, MesInfo>>,
  nomesClientes: Map<string, string>,
  representantesClientes: Map<string, string>
): XLSX.WorkSheet {
  const anos = [2025, 2026];
  const hoje = new Date();
  const mesesPorAno: Record<number, number[]> = {};
  for (const ano of anos) {
    const meses: number[] = [];
    for (let mes = 1; mes <= 12; mes++) {
      if (ano === 2026 && new Date(ano, mes - 1, 1) > hoje) continue;
      meses.push(mes);
    }
    mesesPorAno[ano] = meses;
  }

  const totalPorCliente = new Map<string, number>();
  for (const [codigo, meses] of porCliente) {
    let total = 0;
    for (const info of meses.values()) total += info.qtde;
    totalPorCliente.set(codigo, total);
  }
  const codigosOrdenados = [...porCliente.keys()].sort((a, b) => (totalPorCliente.get(b) ?? 0) - (totalPorCliente.get(a) ?? 0));

  const linhas: any[][] = [];
  const linhaAno: any[] = ["", ""];
  const linhaMes: any[] = ["Vendedor", "Cliente"];
  const merges: any[] = [];
  let colAtual = 2;
  for (const ano of anos) {
    const inicio = colAtual;
    for (const mes of mesesPorAno[ano]) {
      linhaMes[colAtual] = mes;
      colAtual++;
    }
    linhaAno[inicio] = ano;
    linhaMes[colAtual] = "Total";
    colAtual++;
    merges.push({ s: { r: 0, c: inicio }, e: { r: 0, c: colAtual - 1 } });
  }
  linhas.push(linhaAno, linhaMes);

  const totalColunas = colAtual;
  const totaisColuna: number[] = new Array(totalColunas).fill(0);

  for (const codigo of codigosOrdenados) {
    const meses = porCliente.get(codigo)!;
    const linha: any[] = [representantesClientes.get(codigo) || "", nomesClientes.get(codigo) || ""];
    let col = 2;
    for (const ano of anos) {
      let totalAno = 0;
      for (const mes of mesesPorAno[ano]) {
        const qtde = meses.get(`${ano}-${mes}`)?.qtde ?? 0;
        linha[col] = qtde || "";
        totaisColuna[col] += qtde;
        totalAno += qtde;
        col++;
      }
      linha[col] = totalAno || "";
      totaisColuna[col] += totalAno;
      col++;
    }
    linhas.push(linha);
  }

  const linhaTotal: any[] = ["", "Total"];
  for (let c = 2; c < totalColunas; c++) linhaTotal[c] = totaisColuna[c] || "";
  linhas.push(linhaTotal);

  const ws = XLSX.utils.aoa_to_sheet(linhas);
  ws["!merges"] = merges;
  ws["!cols"] = [{ wch: 26 }, { wch: 40 }, ...new Array(totalColunas - 2).fill({ wch: 9 })];
  return ws;
}

async function gerarRelatorio(lojaKey: any, nomeArquivo: string) {
  console.log(`\n=== ${nomeArquivo} — base "${lojaKey}", todas as vendas de chave ===`);

  const porCliente = new Map<string, Map<string, MesInfo>>();
  const rows = await queryFirebird<any>(lojaKey, sqlChaves());
  console.log(`  ${rows.length} linhas`);
  rows.forEach((r: any) => {
    const codigo = r.CODIGO?.toString().trim();
    const ano = Number(r.ANO);
    const mes = Number(r.MES);
    const qtde = Number(r.QTDE) || 0;
    if (!codigo) return;
    if (!porCliente.has(codigo)) porCliente.set(codigo, new Map());
    const mapaMeses = porCliente.get(codigo)!;
    const chaveMes = `${ano}-${mes}`;
    if (!mapaMeses.has(chaveMes)) mapaMeses.set(chaveMes, { qtde: 0 });
    mapaMeses.get(chaveMes)!.qtde += qtde;
  });

  console.log(`  Clientes únicos: ${porCliente.size}`);

  const periodosOrdenados: { ano: number; mes: number }[] = [];
  for (const ano of [2025, 2026]) {
    for (let mes = 1; mes <= 12; mes++) {
      if (ano === 2026 && new Date(ano, mes - 1, 1) > new Date()) continue;
      periodosOrdenados.push({ ano, mes });
    }
  }
  const hoje = new Date();
  const mesFechado = (ano: number, mes: number) => new Date(ano, mes, 1) <= hoje;

  const indicePorFaixa = new Map<string, { ano: number; mes: number; qtde: number }[]>();
  const ultimaCompraGeral = new Map<string, { ano: number; mes: number; qtde: number }>();

  for (const [codigo, meses] of porCliente) {
    for (const [chaveMes, info] of meses) {
      if (info.qtde <= 0) continue;
      const [ano, mes] = chaveMes.split("-").map(Number);
      const faixa = faixaDe(info.qtde);
      const chaveFaixa = `${codigo}|${faixa}`;
      if (!indicePorFaixa.has(chaveFaixa)) indicePorFaixa.set(chaveFaixa, []);
      indicePorFaixa.get(chaveFaixa)!.push({ ano, mes, qtde: info.qtde });

      const atual = ultimaCompraGeral.get(codigo);
      if (!atual || ano > atual.ano || (ano === atual.ano && mes > atual.mes)) {
        ultimaCompraGeral.set(codigo, { ano, mes, qtde: info.qtde });
      }
    }
  }
  for (const lista of indicePorFaixa.values()) lista.sort((a, b) => a.ano - b.ano || a.mes - b.mes);

  // ─── Aba: clientes por faixa-mês ────────────────────────────────────────────
  const contagem = new Map<string, Set<string>>();
  for (const [codigo, meses] of porCliente) {
    for (const [chaveMes, info] of meses) {
      if (info.qtde <= 0) continue;
      const [ano, mes] = chaveMes.split("-").map(Number);
      const faixa = faixaDe(info.qtde);
      const chave = `${faixa}|${ano}|${mes}`;
      if (!contagem.has(chave)) contagem.set(chave, new Set());
      contagem.get(chave)!.add(codigo);
    }
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

  // ─── Aba: análise de queda ──────────────────────────────────────────────────
  interface Queda {
    codigo: string;
    ano: number;
    mes: number;
    qtde: number;
    faixa: string;
    mesSeguinteLabel: string;
  }
  const quedas: Queda[] = [];
  for (let i = 0; i < periodosOrdenados.length - 1; i++) {
    const atual = periodosOrdenados[i];
    const seguinte = periodosOrdenados[i + 1];
    if (!mesFechado(seguinte.ano, seguinte.mes)) continue;

    for (const [codigo, meses] of porCliente) {
      const infoAtual = meses.get(`${atual.ano}-${atual.mes}`);
      if (!infoAtual || infoAtual.qtde <= 0) continue;
      const infoSeguinte = meses.get(`${seguinte.ano}-${seguinte.mes}`);
      if (infoSeguinte && infoSeguinte.qtde > 0) continue;

      quedas.push({
        codigo,
        ano: atual.ano,
        mes: atual.mes,
        qtde: infoAtual.qtde,
        faixa: faixaDe(infoAtual.qtde),
        mesSeguinteLabel: labelPeriodo(seguinte.ano, seguinte.mes),
      });
    }
  }
  console.log(`  Instâncias de queda: ${quedas.length}`);

  const resumoQueda = new Map<string, number>();
  quedas.forEach((q) => {
    const chave = `${q.faixa}|${labelPeriodo(q.ano, q.mes)}`;
    resumoQueda.set(chave, (resumoQueda.get(chave) ?? 0) + 1);
  });
  const periodosFechados = periodosOrdenados
    .slice(0, -1)
    .filter((p, i) => mesFechado(periodosOrdenados[i + 1].ano, periodosOrdenados[i + 1].mes));
  const pivotQueda = FAIXAS_ORDEM.map((faixa) => {
    const linha: Record<string, any> = { "Faixa no mês da compra": faixa };
    let total = 0;
    for (const p of periodosFechados) {
      const label = labelPeriodo(p.ano, p.mes);
      const n = resumoQueda.get(`${faixa}|${label}`) ?? 0;
      linha[`Comprou em ${label}, sumiu no seguinte`] = n;
      total += n;
    }
    linha["Total"] = total;
    return linha;
  });

  // ─── Nomes e representante (do cadastro) dos clientes ──────────────────────
  const codigosClientes = [...porCliente.keys()];
  const [nomesClientes, representantesClientes] = await Promise.all([
    buscarNomesClientes(lojaKey, codigosClientes),
    buscarRepresentantesClientes(lojaKey, codigosClientes),
  ]);

  // ─── Um cliente só aparece uma vez: fica a queda de maior quantidade ──────
  const quedaPorCliente = new Map<string, Queda>();
  for (const q of quedas) {
    const existente = quedaPorCliente.get(q.codigo);
    if (!existente || q.qtde > existente.qtde) quedaPorCliente.set(q.codigo, q);
  }
  const quedasUnicasPorCliente = [...quedaPorCliente.values()];

  const detalhado = quedasUnicasPorCliente
    .sort((a, b) => a.ano - b.ano || a.mes - b.mes || b.qtde - a.qtde)
    .map((q) => {
      const listaFaixa = indicePorFaixa.get(`${q.codigo}|${q.faixa}`) ?? [];
      const ultimaNaFaixa = listaFaixa[listaFaixa.length - 1];
      const nuncaMaisNaFaixa = ultimaNaFaixa && ultimaNaFaixa.ano === q.ano && ultimaNaFaixa.mes === q.mes;

      const ultimaGeral = ultimaCompraGeral.get(q.codigo);
      const semCompraDepois = !ultimaGeral || (ultimaGeral.ano === q.ano && ultimaGeral.mes === q.mes);

      return {
        "Código Cliente": q.codigo,
        "Cliente": nomesClientes.get(q.codigo) || "",
        "Representante": representantesClientes.get(q.codigo) || "",
        "Comprou em": labelPeriodo(q.ano, q.mes),
        "Quantidade Comprada": q.qtde,
        "Faixa": q.faixa,
        "Sumiu em": q.mesSeguinteLabel,
        "Última Compra nessa Faixa": nuncaMaisNaFaixa || !ultimaNaFaixa ? "Não comprou mais" : labelPeriodo(ultimaNaFaixa.ano, ultimaNaFaixa.mes),
        "Quantidade (última compra nessa faixa)": nuncaMaisNaFaixa || !ultimaNaFaixa ? "" : ultimaNaFaixa.qtde,
        "Data da Última Compra (qualquer quantidade)": semCompraDepois ? "Não comprou mais" : labelPeriodo(ultimaGeral!.ano, ultimaGeral!.mes),
        "Quantidade da Última Compra (qualquer quantidade)": semCompraDepois ? "" : ultimaGeral!.qtde,
      };
    });

  // ─── Monta workbook ──────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();

  const wsPivot = XLSX.utils.json_to_sheet(pivot);
  XLSX.utils.book_append_sheet(wb, wsPivot, "Clientes por faixa-mês");

  const wsResumoQueda = XLSX.utils.json_to_sheet(pivotQueda);
  XLSX.utils.book_append_sheet(wb, wsResumoQueda, "Resumo de queda");

  const wsDetalhado = XLSX.utils.json_to_sheet(detalhado);
  wsDetalhado["!cols"] = [
    { wch: 14 }, { wch: 40 }, { wch: 26 }, { wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 22 }, { wch: 22 }, { wch: 26 }, { wch: 26 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDetalhado, "Detalhado - queda");

  const wsClienteMes = construirPivotClienteMes(porCliente, nomesClientes, representantesClientes);
  XLSX.utils.book_append_sheet(wb, wsClienteMes, "Cliente x Mês");

  const outPath = path.join(os.homedir(), "Desktop", nomeArquivo);
  XLSX.writeFile(wb, outPath);
  console.log(`  Salvo em: ${outPath}`);
}

async function main() {
  for (const loja of LOJAS) {
    try {
      await gerarRelatorio(loja.lojaKey, loja.nomeArquivo);
    } catch (e: any) {
      console.error(`ERRO em ${loja.nomeArquivo}: ${e.message}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
