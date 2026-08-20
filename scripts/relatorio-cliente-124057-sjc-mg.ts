/**
 * Relatório: Quantidade vendida por produto, mês a mês, para o cliente 124057 — bases SJC e MG.
 * Período: 01/01/2025 até hoje.
 * Exclui pedidos cancelados (pdv_psi_codigo NOT IN ('CC')) e outras situações de não-venda
 * (pdv_tve_codigo NOT IN ('6','7','26','34')), padrão já usado nos demais relatórios do projeto.
 *
 * Aba 1: Qtd por Mês — pivot Código/Descrição x mês (SJC+MG somados), com total.
 * Aba 2: Detalhe por Base — Base / Ano / Mês / Código / Descrição / Qtd.
 *
 * Rodar: npx tsx scripts/relatorio-cliente-124057-sjc-mg.ts
 */

import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const CLIENTE_CODIGO = 124057;

const BASES = [
  { lojaKey: "sjc" as const, nome: "SJC" },
  { lojaKey: "mg" as const, nome: "MG" },
];

const MESES_ABREV = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

interface VendaRow {
  PRO_CODIGO: any;
  PRO_RESUMO: any;
  ANO: any;
  MES: any;
  QTD: any;
}

interface ClienteRow {
  CLI_NOME: any;
}

function sqlVendas() {
  return `
    SELECT p.pro_codigo, p.pro_resumo,
      EXTRACT(YEAR FROM ped.pdv_data) AS ano,
      EXTRACT(MONTH FROM ped.pdv_data) AS mes,
      SUM(i.pvi_quantidade) AS qtd
    FROM pedidos_vendas_itens i
    INNER JOIN pedidos_vendas ped ON ped.pdv_numero = i.pvi_numero
    INNER JOIN produtos p ON p.pro_codigo = i.pvi_pro_codigo
    WHERE ped.pdv_cli_codigo = ${CLIENTE_CODIGO}
      AND ped.pdv_data >= CAST('2025-01-01' AS DATE)
      AND ped.pdv_data <= CAST('NOW' AS DATE)
      AND ped.pdv_psi_codigo NOT IN ('CC')
      AND ped.pdv_tve_codigo NOT IN ('6', '7', '26', '34')
    GROUP BY p.pro_codigo, p.pro_resumo, EXTRACT(YEAR FROM ped.pdv_data), EXTRACT(MONTH FROM ped.pdv_data)
    ORDER BY p.pro_codigo, ano, mes
  `;
}

function sqlCliente() {
  return `SELECT cli_nome FROM clientes WHERE cli_codigo = ${CLIENTE_CODIGO}`;
}

interface Produto {
  codigo: string;
  descricao: string;
  meses: Map<string, number>; // chave "AAAA-MM" -> qtd
  total: number;
}

function gerarChavesMeses(): { chave: string; label: string; ano: number; mes: number }[] {
  const inicio = { ano: 2025, mes: 1 };
  const hoje = new Date();
  const fim = { ano: hoje.getFullYear(), mes: hoje.getMonth() + 1 };

  const chaves: { chave: string; label: string; ano: number; mes: number }[] = [];
  let ano = inicio.ano;
  let mes = inicio.mes;
  while (ano < fim.ano || (ano === fim.ano && mes <= fim.mes)) {
    const chave = `${ano}-${String(mes).padStart(2, "0")}`;
    const label = `${MESES_ABREV[mes - 1]}/${String(ano).slice(2)}`;
    chaves.push({ chave, label, ano, mes });
    mes++;
    if (mes > 12) {
      mes = 1;
      ano++;
    }
  }
  return chaves;
}

async function main() {
  console.log(`=== Relatório Qtd. Vendida por Produto/Mês — Cliente ${CLIENTE_CODIGO} — SJC/MG ===\n`);

  const chavesMeses = gerarChavesMeses();
  console.log(`Período: ${chavesMeses[0].label} até ${chavesMeses[chavesMeses.length - 1].label} (${chavesMeses.length} meses)\n`);

  const consolidado = new Map<string, Produto>();
  const detalheBase: { base: string; ano: number; mes: number; codigo: string; descricao: string; qtd: number }[] = [];
  let nomeCliente = "";

  for (const base of BASES) {
    console.log(`Consultando base ${base.nome}...`);

    try {
      const clienteRows = await queryFirebird<ClienteRow>(base.lojaKey, sqlCliente());
      if (clienteRows.length > 0 && !nomeCliente) {
        nomeCliente = clienteRows[0].CLI_NOME?.toString().trim() || "";
      }
    } catch (err) {
      console.warn(`  Aviso: não foi possível buscar nome do cliente na base ${base.nome}`);
    }

    const rows = await queryFirebird<VendaRow>(base.lojaKey, sqlVendas());
    console.log(`  ${rows.length} linhas produto/mês com venda na base ${base.nome}`);

    for (const row of rows) {
      const codigo = row.PRO_CODIGO?.toString().trim() || "";
      if (!codigo) continue;
      const descricao = row.PRO_RESUMO?.toString().trim() || "";
      const ano = Number(row.ANO);
      const mes = Number(row.MES);
      const qtd = Number(row.QTD) || 0;
      const chave = `${ano}-${String(mes).padStart(2, "0")}`;

      detalheBase.push({ base: base.nome, ano, mes, codigo, descricao, qtd });

      let produto = consolidado.get(codigo);
      if (!produto) {
        produto = { codigo, descricao, meses: new Map(), total: 0 };
        consolidado.set(codigo, produto);
      }
      produto.meses.set(chave, (produto.meses.get(chave) || 0) + qtd);
      produto.total += qtd;
    }
  }

  console.log(`\nCliente: ${CLIENTE_CODIGO}${nomeCliente ? " - " + nomeCliente : ""}`);
  console.log(`Total de produtos com venda no período: ${consolidado.size}`);

  const produtos = Array.from(consolidado.values()).sort((a, b) => a.codigo.localeCompare(b.codigo));

  const sheetPivot = produtos.map((p) => {
    const linha: Record<string, any> = {
      "Código": p.codigo,
      "Descrição": p.descricao,
    };
    for (const m of chavesMeses) {
      linha[m.label] = Math.round((p.meses.get(m.chave) || 0) * 100) / 100;
    }
    linha["Total"] = Math.round(p.total * 100) / 100;
    return linha;
  });

  const sheetDetalhe = detalheBase
    .sort((a, b) =>
      a.base.localeCompare(b.base) ||
      a.codigo.localeCompare(b.codigo) ||
      a.ano - b.ano ||
      a.mes - b.mes
    )
    .map((d) => ({
      "Base": d.base,
      "Ano": d.ano,
      "Mês": String(d.mes).padStart(2, "0"),
      "Código": d.codigo,
      "Descrição": d.descricao,
      "Qtd. Vendida": Math.round(d.qtd * 100) / 100,
    }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetPivot), "Qtd por Mês");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetDetalhe), "Detalhe por Base");

  const fileName = `Relatorio_Cliente_${CLIENTE_CODIGO}_SJC_MG.xlsx`;
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
