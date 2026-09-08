/**
 * Relatório: quantidade e valor de CHAVES vendidas em 2026 (Jan-Ago), mês a mês,
 * por setor — TELEVENDAS, TELEVENDAS MG, DISTRIBUIDORES, FERRAGENS, LOJAS.
 *
 * Usa a MESMA fonte de dados do painel de comissão (getVendas, em
 * server/services/comissao/dados-externos.ts), que já puxa de todas as bases onde
 * cada setor vende: SJC, SPM, Lockey MG, Lockey SP/FAST, Rio de Janeiro, Belo
 * Horizonte, Lockey RS, Niterói e EP — exatamente como pedido ("pode tomar como
 * exemplo o painel de comissão"). Campinas/Fortaleza/Santana/Uberlândia/Goiânia/
 * Bosque não entram porque não fazem parte do universo do painel de comissão.
 *
 * "LOJAS" não é um único RVS_NOME — é composto por todo setor cujo nome começa com
 * "LOJA" em qualquer base (confirmado nos dados de 2026): LOJA BH, LOJA RIO,
 * LOJA RS, LOJAS, LOJAS PROPRIAS, LOJAS TERCEIRAS.
 *
 * Outros setores que aparecem nas bases (CENTRO DE DISTRIBUIÇÃO, ATACADO SP,
 * E-COMMERCE, FUNCIONARIOS, DESCONSIDERAR, CLIENTES DAS LOJAS PROPRIAS, VENDEDORES
 * ATIVOS) ficam de fora — não pedidos.
 *
 * Chave = SUBGRUPO = 'CHAVE'.
 *
 * Rodar: npx tsx scripts/relatorio-chaves-setores-2026.ts
 */
import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { getVendas } from "../server/services/comissao/dados-externos";

const ANO = 2026;
const SETORES = ["TELEVENDAS", "TELEVENDAS MG", "DISTRIBUIDORES", "FERRAGENS", "LOJAS"] as const;
type Setor = (typeof SETORES)[number];

function classificarSetor(rvsNome: string | null): Setor | null {
  if (!rvsNome) return null;
  const nome = rvsNome.trim().toUpperCase();
  if (nome === "TELEVENDAS") return "TELEVENDAS";
  if (nome === "TELEVENDAS MG") return "TELEVENDAS MG";
  if (nome === "DISTRIBUIDORES") return "DISTRIBUIDORES";
  if (nome === "FERRAGENS") return "FERRAGENS";
  if (nome.startsWith("LOJA")) return "LOJAS";
  return null;
}

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

async function main() {
  console.log(`=== Chaves por setor — ${ANO} mês a mês (fonte: painel de comissão) ===\n`);

  const todasVendas = await getVendas(ANO);
  console.log(`Total de linhas puxadas (todas as bases, todos os setores/produtos): ${todasVendas.length}`);

  const chaves = todasVendas.filter((r) => (r.SUBGRUPO || "").trim().toUpperCase() === "CHAVE");
  console.log(`Linhas de CHAVE: ${chaves.length}`);

  const dataFim = new Date(ANO, 8, 1); // 01/09 — exclusivo, cobre até agosto
  const porSetorMes = new Map<string, { qtde: number; valor: number }>();
  const setoresIgnorados = new Set<string>();

  for (const r of chaves) {
    const data = r.PDV_DATA instanceof Date ? r.PDV_DATA : new Date(r.PDV_DATA as any);
    if (isNaN(data.getTime()) || data < new Date(ANO, 0, 1) || data >= dataFim) continue;

    const setor = classificarSetor(r.RVS_NOME);
    if (!setor) {
      if (r.RVS_NOME) setoresIgnorados.add(r.RVS_NOME);
      continue;
    }

    const mes = data.getMonth() + 1;
    const chave = `${setor}|${mes}`;
    const existente = porSetorMes.get(chave) ?? { qtde: 0, valor: 0 };
    existente.qtde += Number(r.QTDE) || 0;
    existente.valor += Number(r.SUM) || 0;
    porSetorMes.set(chave, existente);
  }

  console.log(`Setores fora do escopo pedido (ignorados): ${[...setoresIgnorados].join(", ")}`);

  const meses = Array.from({ length: 8 }, (_, i) => i + 1); // Jan-Ago
  const MESES_EXTENSO = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto",
    "Setembro", "Outubro", "Novembro", "Dezembro",
  ];

  function valorMetrica(setor: string, mes: number, metrica: "qtde" | "valor"): number {
    const v = porSetorMes.get(`${setor}|${mes}`) ?? { qtde: 0, valor: 0 };
    return v[metrica];
  }

  // Matriz igual ao mockup: "2026" mesclado em cima de tudo, cada mês mesclado sobre
  // suas 2 sub-colunas (quantidade/valor), Total no fim — uma linha só por setor.
  const grupos = [...meses.map((m) => ({ label: MESES_EXTENSO[m - 1].toUpperCase(), mes: m })), { label: "TOTAL", mes: null as number | null }];

  const linhas: any[][] = [];
  const linhaAno: any[] = [""];
  const linhaGrupo: any[] = ["SETOR"];
  const linhaMetrica: any[] = [""];
  const merges: any[] = [];
  let col = 1;
  for (const grupo of grupos) {
    const inicio = col;
    linhaGrupo[col] = grupo.label;
    linhaMetrica[col] = "QUANTIDADE";
    col++;
    linhaMetrica[col] = "VALOR (R$)";
    col++;
    merges.push({ s: { r: 1, c: inicio }, e: { r: 1, c: col - 1 } });
  }
  linhaAno[1] = ANO;
  merges.push({ s: { r: 0, c: 1 }, e: { r: 0, c: col - 1 } });
  linhas.push(linhaAno, linhaGrupo, linhaMetrica);

  const totalColunas = col;
  const totaisColuna: number[] = new Array(totalColunas).fill(0);

  for (const setor of SETORES) {
    const linha: any[] = [setor.toUpperCase()];
    let c = 1;
    let totalQtdeSetor = 0;
    let totalValorSetor = 0;
    for (const mes of meses) {
      const qtde = valorMetrica(setor, mes, "qtde");
      const valor = valorMetrica(setor, mes, "valor");
      linha[c] = qtde || "";
      totaisColuna[c] += qtde;
      c++;
      linha[c] = valor ? Number(valor.toFixed(2)) : "";
      totaisColuna[c] += valor;
      c++;
      totalQtdeSetor += qtde;
      totalValorSetor += valor;
    }
    linha[c] = totalQtdeSetor || "";
    totaisColuna[c] += totalQtdeSetor;
    c++;
    linha[c] = totalValorSetor ? Number(totalValorSetor.toFixed(2)) : "";
    totaisColuna[c] += totalValorSetor;
    linhas.push(linha);
  }

  const linhaTotal: any[] = ["TOTAL"];
  for (let c = 1; c < totalColunas; c++) linhaTotal[c] = totaisColuna[c] ? Number(totaisColuna[c].toFixed(2)) : "";
  linhas.push(linhaTotal);

  const wb = XLSX.utils.book_new();

  const wsNotas = XLSX.utils.json_to_sheet([
    { "Item": "Fonte dos dados", "Detalhe": "getVendas() — mesma função que alimenta o painel de comissão" },
    { "Item": "Bases incluídas", "Detalhe": "SJC, SPM, Lockey MG, Lockey SP/FAST, Rio de Janeiro, Belo Horizonte, Lockey RS, Niterói, EP" },
    { "Item": "Bases fora (não fazem parte do painel de comissão)", "Detalhe": "Campinas, Fortaleza, Santana, Uberlândia, Goiânia, Bosque" },
    { "Item": "LOJAS = ", "Detalhe": "todo RVS_NOME que começa com 'LOJA': LOJA BH, LOJA RIO, LOJA RS, LOJAS, LOJAS PROPRIAS, LOJAS TERCEIRAS" },
    { "Item": "Setores ignorados (fora do pedido)", "Detalhe": [...setoresIgnorados].join(", ") },
    { "Item": "Chave", "Detalhe": "SUBGRUPO = 'CHAVE'" },
    { "Item": "Período", "Detalhe": "Janeiro a Agosto de 2026" },
  ]);
  wsNotas["!cols"] = [{ wch: 40 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, wsNotas, "Notas");

  const wsTabela = XLSX.utils.aoa_to_sheet(linhas);
  wsTabela["!merges"] = merges;
  wsTabela["!cols"] = [{ wch: 18 }, ...new Array(totalColunas - 1).fill({ wch: 13 })];
  XLSX.utils.book_append_sheet(wb, wsTabela, "Chaves por setor-mês");

  const outPath = path.join(os.homedir(), "Desktop", "Chaves_Por_Setor_2026.xlsx");
  XLSX.writeFile(wb, outPath);

  const totalQtdeGeral = SETORES.reduce((acc, s) => acc + meses.reduce((a, m) => a + valorMetrica(s, m, "qtde"), 0), 0);
  const totalValorGeral = SETORES.reduce((acc, s) => acc + meses.reduce((a, m) => a + valorMetrica(s, m, "valor"), 0), 0);
  console.log(`\nTotal geral 2026 (Jan-Ago): ${totalQtdeGeral} chaves | R$ ${totalValorGeral.toFixed(2)}`);
  console.log(`Relatório salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
