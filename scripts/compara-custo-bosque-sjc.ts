/**
 * Compara o custo do "custo bosque.csv" (PRO_CODIGO;PCF_CUSTO_COMPRA) com o valor
 * CERTO pro Bosque — que, segundo o Willian, não é o custo de compra
 * (produtos_cfg_filial), e sim o PREÇO DE VENDA da tabela de preço 42 na SJC
 * ("TABELA SÃO PAULO").
 *
 * Tabela de preço na SJC: TABELAS_PRODUTOS (TBP_PRO_CODIGO, TBP_TAB_CODIGO, TBP_PRECO)
 * — cada linha é um par (produto, tabela de preço); TBP_TAB_CODIGO = 42 é a tabela
 * pedida.
 *
 * Saída: uma tabela só, todos os produtos do CSV na ordem original, com "Situação"
 * (Certo / Errado / Não encontrado na SJC) e "Valor Certo" (preenchido só quando
 * Errado — o preço da tabela 42).
 *
 * Rodar: npx tsx scripts/compara-custo-bosque-sjc.ts
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const ARQUIVO_CSV = "C:/Users/willian.rubim/Documents/custo bosque.csv";
const TOLERANCIA = 0.005; // diferença de arredondamento aceitável
const TABELA_PRECO = 42;

function sqlPrecoTabela42() {
  return `
    select tp.tbp_pro_codigo, tp.tbp_preco
    from tabelas_produtos tp
    where tp.tbp_tab_codigo = ${TABELA_PRECO}
  `;
}

function lerCsvBosque(): Map<string, number | null> {
  // O código do produto veio formatado com ponto de milhar (ex.: "10.000" em vez de
  // "10000") — precisa tirar antes de comparar com o pro_codigo da SJC.
  const conteudo = fs.readFileSync(ARQUIVO_CSV, "latin1");
  const linhas = conteudo.split(/\r?\n/).filter((l) => l.trim() !== "");
  const mapa = new Map<string, number | null>();
  for (let i = 1; i < linhas.length; i++) {
    const [codigo, custoStr] = linhas[i].split(";");
    if (!codigo) continue;
    const cod = codigo.trim().replace(/\./g, "");
    const custo = custoStr && custoStr.trim() !== "" ? Number(custoStr.trim().replace(",", ".")) : null;
    mapa.set(cod, custo);
  }
  return mapa;
}

async function main() {
  console.log(`=== Comparando custo bosque.csv x preço de venda da tabela ${TABELA_PRECO} (SJC) ===\n`);

  const custosBosque = lerCsvBosque();
  console.log(`Produtos no CSV do Bosque: ${custosBosque.size}`);

  const rows = await queryFirebird<any>("sjc", sqlPrecoTabela42());
  const custosSjc = new Map<string, number>();
  rows.forEach((r: any) => {
    const codigo = r.TBP_PRO_CODIGO?.toString().trim();
    if (codigo) custosSjc.set(codigo, Number(r.TBP_PRECO) || 0);
  });
  console.log(`Produtos com preço na tabela ${TABELA_PRECO} (SJC): ${custosSjc.size}`);

  // Uma tabela só, com TODOS os produtos do CSV, na ordem em que apareceram —
  // Situação (Certo/Errado/Não encontrado) e Valor Certo (só preenchido quando errado).
  let certos = 0;
  let errados = 0;
  let naoEncontrados = 0;

  const sheetDados = [...custosBosque.entries()].map(([codigo, custoBosque]) => {
    const custoSjc = custosSjc.get(codigo);
    if (custoSjc === undefined) {
      naoEncontrados++;
      return {
        "Código": codigo,
        "Custo no CSV (Bosque)": custoBosque === null ? "" : custoBosque,
        "Situação": "Não encontrado na SJC",
        "Valor Certo": "",
      };
    }
    const custoBosqueNum = custoBosque ?? 0;
    const estaErrado = Math.abs(custoBosqueNum - custoSjc) > TOLERANCIA;
    if (estaErrado) errados++;
    else certos++;
    return {
      "Código": codigo,
      "Custo no CSV (Bosque)": custoBosque === null ? "" : custoBosque,
      "Situação": estaErrado ? "Errado" : "Certo",
      "Valor Certo": estaErrado ? Number(custoSjc.toFixed(4)) : "",
    };
  });

  console.log(`\nCerto: ${certos} | Errado: ${errados} | Não encontrado na SJC: ${naoEncontrados}`);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetDados);
  ws["!cols"] = [{ wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, `Custo Bosque x Tabela ${TABELA_PRECO}`);

  const outPath = path.join(os.homedir(), "Desktop", "Custo_Bosque_x_Tabela42_SJC.xlsx");
  XLSX.writeFile(wb, outPath);

  console.log(`\nRelatório salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
