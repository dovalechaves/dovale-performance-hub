/**
 * Relatório: mesma análise de "clientes que compraram CHAVES por faixa de
 * quantidade, mês a mês" de antes, mas agora:
 *   - só bases SJC + MG, UNIFICADAS (mesmo código de cliente nas duas = mesmo
 *     cliente, soma a quantidade — pedido explícito do Willian pra esse relatório)
 *   - só setores TELEVENDAS e TELEVENDAS MG (pelo representante do PEDIDO,
 *     pdv_rep_codigo, não pelo cadastro do cliente)
 *
 * Mais uma aba nova: "queda" de cliente — cliente que comprou chaves (qualquer
 * faixa) num mês e ficou com ZERO de chave no mês seguinte. Só considera pares de
 * mês onde os dois meses já fecharam (não avalia contra o mês corrente, ainda em
 * andamento — comprar zero num mês que não acabou não quer dizer que parou).
 *
 * Faixas: 1-499 | 500-999 | 1000-1999 | 2000-4999 | 5000+
 * Padrão de venda real do projeto: pdv_psi_codigo NOT IN ('CC') e
 * pdv_tve_codigo NOT IN ('6','7','26','34').
 *
 * Rodar: npx tsx scripts/relatorio-chaves-televendas-faixa-e-queda.ts
 */
import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const BASES = [
  { lojaKey: "sjc" as const, nome: "SJC" },
  { lojaKey: "mg" as const, nome: "MG" },
];

function sqlChavesTelevendas() {
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
    inner join representantes r on r.rep_codigo = ped.pdv_rep_codigo
    inner join representantes_supervisores rs on rs.rvs_codigo = r.rep_rvs_codigo
    where pn.nome = 'CHAVE'
    and rs.rvs_nome in ('TELEVENDAS','TELEVENDAS MG')
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

async function main() {
  console.log("=== Chaves — TELEVENDAS/TELEVENDAS MG — SJC+MG unificadas — faixa e análise de queda ===\n");

  // codigo -> "ano-mes" -> qtde (SJC+MG somadas)
  const porCliente = new Map<string, Map<string, number>>();
  const statusBases: { base: string; linhas: number }[] = [];

  for (const base of BASES) {
    console.log(`Consultando ${base.nome}...`);
    const rows = await queryFirebird<any>(base.lojaKey, sqlChavesTelevendas());
    console.log(`  ${rows.length} linhas`);
    statusBases.push({ base: base.nome, linhas: rows.length });
    rows.forEach((r: any) => {
      const codigo = r.CODIGO?.toString().trim();
      const ano = Number(r.ANO);
      const mes = Number(r.MES);
      const qtde = Number(r.QTDE) || 0;
      if (!codigo) return;
      if (!porCliente.has(codigo)) porCliente.set(codigo, new Map());
      const mapaMeses = porCliente.get(codigo)!;
      const chaveMes = `${ano}-${mes}`;
      mapaMeses.set(chaveMes, (mapaMeses.get(chaveMes) ?? 0) + qtde);
    });
  }

  console.log(`\nClientes únicos (SJC+MG unificado, Televendas/Televendas MG): ${porCliente.size}`);

  // Nomes dos clientes (SJC+MG), pra exibir na aba de detalhes — em lotes, o
  // Firebird não aceita mais de 1500 valores num IN (...)
  const codigosTodos = [...porCliente.keys()];
  const LOTE = 1000;
  async function buscarNomes(loja: "sjc" | "mg"): Promise<Map<string, string>> {
    const mapa = new Map<string, string>();
    for (let i = 0; i < codigosTodos.length; i += LOTE) {
      const pedaco = codigosTodos.slice(i, i + LOTE);
      const lista = pedaco.map((c) => `'${c}'`).join(",");
      const rows = await queryFirebird<any>(loja, `select cli_codigo, cli_nome from clientes where cli_codigo in (${lista})`);
      rows.forEach((r: any) => {
        const codigo = r.CLI_CODIGO?.toString().trim();
        const nome = r.CLI_NOME?.toString().trim();
        if (codigo && nome) mapa.set(codigo, nome);
      });
    }
    return mapa;
  }
  const [nomesSjc, nomesMg] = await Promise.all([buscarNomes("sjc"), buscarNomes("mg")]);
  function nomeDoCliente(codigo: string): string {
    return nomesSjc.get(codigo) || nomesMg.get(codigo) || "";
  }

  const periodosOrdenados: { ano: number; mes: number }[] = [];
  for (const ano of [2025, 2026]) {
    for (let mes = 1; mes <= 12; mes++) {
      if (ano === 2026 && new Date(ano, mes - 1, 1) > new Date()) continue;
      periodosOrdenados.push({ ano, mes });
    }
  }
  const hoje = new Date();
  const mesFechado = (ano: number, mes: number) => new Date(ano, mes, 1) <= hoje; // mês seguinte já começou = este mês fechou
  function labelPeriodo(ano: number, mes: number) {
    return `${MESES[mes - 1]}/${String(ano).slice(2)}`;
  }

  // ─── Aba 1: clientes por faixa-mês ──────────────────────────────────────────
  const contagem = new Map<string, Set<string>>(); // faixa|ano|mes -> set de codigo
  for (const [codigo, meses] of porCliente) {
    for (const [chaveMes, qtde] of meses) {
      if (qtde <= 0) continue;
      const [ano, mes] = chaveMes.split("-").map(Number);
      const faixa = faixaDe(qtde);
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

  // ─── Aba 2: análise de queda (comprou no mês N, zerou no mês N+1) ──────────
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
    if (!mesFechado(seguinte.ano, seguinte.mes)) continue; // não avalia contra mês em andamento

    for (const [codigo, meses] of porCliente) {
      const qtdeAtual = meses.get(`${atual.ano}-${atual.mes}`) ?? 0;
      if (qtdeAtual <= 0) continue;
      const qtdeSeguinte = meses.get(`${seguinte.ano}-${seguinte.mes}`) ?? 0;
      if (qtdeSeguinte > 0) continue; // continuou comprando, não é queda

      quedas.push({
        codigo,
        ano: atual.ano,
        mes: atual.mes,
        qtde: qtdeAtual,
        faixa: faixaDe(qtdeAtual),
        mesSeguinteLabel: labelPeriodo(seguinte.ano, seguinte.mes),
      });
    }
  }

  console.log(`\nInstâncias de queda (comprou e zerou no mês seguinte): ${quedas.length}`);

  // resumo: quantos clientes "sumiram" por mês x faixa
  const resumoQueda = new Map<string, number>();
  quedas.forEach((q) => {
    const chave = `${q.faixa}|${labelPeriodo(q.ano, q.mes)}`;
    resumoQueda.set(chave, (resumoQueda.get(chave) ?? 0) + 1);
  });
  const periodosFechados = periodosOrdenados.slice(0, -1).filter((p, i) => mesFechado(periodosOrdenados[i + 1].ano, periodosOrdenados[i + 1].mes));
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

  // ─── Monta workbook ──────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();

  const wsStatus = XLSX.utils.json_to_sheet(statusBases.map((s) => ({ "Base": s.base, "Linhas coletadas": s.linhas })));
  XLSX.utils.book_append_sheet(wb, wsStatus, "Status das bases");

  const wsPivot = XLSX.utils.json_to_sheet(pivot);
  XLSX.utils.book_append_sheet(wb, wsPivot, "Clientes por faixa-mês");

  const wsResumoQueda = XLSX.utils.json_to_sheet(pivotQueda);
  XLSX.utils.book_append_sheet(wb, wsResumoQueda, "Resumo de queda");

  const wsQueda = XLSX.utils.json_to_sheet(
    quedas
      .sort((a, b) => a.ano - b.ano || a.mes - b.mes || b.qtde - a.qtde)
      .map((q) => ({
        "Código Cliente": q.codigo,
        "Cliente": nomeDoCliente(q.codigo),
        "Comprou em": labelPeriodo(q.ano, q.mes),
        "Quantidade Comprada": q.qtde,
        "Faixa": q.faixa,
        "Sumiu em": q.mesSeguinteLabel,
      }))
  );
  wsQueda["!cols"] = [{ wch: 14 }, { wch: 40 }, { wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsQueda, "Detalhado - queda");

  const outPath = path.join(os.homedir(), "Desktop", "Chaves_Televendas_Faixa_e_Queda_SJC_MG.xlsx");
  XLSX.writeFile(wb, outPath);

  console.log(`\nRelatório salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
