/**
 * Relatório: clientes do TELEVENDAS e TELEVENDAS MG (SJC + MG), últimos 12 meses —
 * qual % dos produtos distintos que o cliente comprou no período ele repete (ou
 * seja, comprou em 2 ou mais pedidos diferentes), olhando TODOS os pedidos dele no
 * período (não só pares consecutivos).
 *
 * Métrica por cliente: entre os produtos distintos que ele comprou no período,
 * quantos apareceram em 2+ pedidos diferentes, dividido pelo total de produtos
 * distintos comprados. Só entram clientes com alguma repetição (% > 0).
 *
 * Bases: SJC e MG, pedidos combinados por cliente (cli_codigo). Setor pelo
 * representante do PEDIDO (rvs_nome = TELEVENDAS ou TELEVENDAS MG), mesmo critério
 * já usado nos relatórios anteriores de Televendas.
 *
 * Padrão de venda real do projeto: pdv_psi_codigo NOT IN ('CC') e
 * pdv_tve_codigo NOT IN ('6','7','26','34').
 *
 * Rodar: npx tsx scripts/relatorio-televendas-repeticao-produtos-12m.ts
 */
import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const BASES = ["sjc", "mg"] as const;

const hoje = new Date();
const dozeMesesAtras = new Date(hoje.getFullYear(), hoje.getMonth() - 12, hoje.getDate());
const DATA_INI = dozeMesesAtras.toISOString().slice(0, 10);
const DATA_FIM = hoje.toISOString().slice(0, 10);

function sqlPedidosTelevendas() {
  return `
    select
      ped.pdv_numero as pedido,
      ped.pdv_cli_codigo as cliente,
      i.pvi_pro_codigo as produto
    from pedidos_vendas ped
    inner join pedidos_vendas_itens i on i.pvi_numero = ped.pdv_numero
    inner join representantes r on r.rep_codigo = ped.pdv_rep_codigo
    inner join representantes_supervisores rs on rs.rvs_codigo = r.rep_rvs_codigo
    where rs.rvs_nome in ('TELEVENDAS','TELEVENDAS MG')
    and ped.pdv_data >= date '${DATA_INI}'
    and ped.pdv_data <= date '${DATA_FIM}'
    and ped.pdv_psi_codigo not in ('CC')
    and ped.pdv_tve_codigo not in ('6','7','26','34')
  `;
}

async function buscarNomesClientes(codigos: string[]): Promise<Map<string, string>> {
  const LOTE = 1000;
  const mapa = new Map<string, string>();
  for (const loja of BASES) {
    for (let i = 0; i < codigos.length; i += LOTE) {
      const pedaco = codigos.slice(i, i + LOTE);
      const lista = pedaco.map((c) => `'${c}'`).join(",");
      const rows = await queryFirebird<any>(loja, `select cli_codigo, cli_nome from clientes where cli_codigo in (${lista})`);
      rows.forEach((r: any) => {
        const codigo = r.CLI_CODIGO?.toString().trim();
        const nome = r.CLI_NOME?.toString().trim();
        if (codigo && nome && !mapa.has(codigo)) mapa.set(codigo, nome);
      });
    }
  }
  return mapa;
}

async function buscarRepresentantesClientes(codigos: string[]): Promise<Map<string, string>> {
  const LOTE = 1000;
  const porBase: Record<(typeof BASES)[number], Map<string, string>> = { sjc: new Map(), mg: new Map() };
  for (const loja of BASES) {
    for (let i = 0; i < codigos.length; i += LOTE) {
      const pedaco = codigos.slice(i, i + LOTE);
      const lista = pedaco.map((c) => `'${c}'`).join(",");
      const rows = await queryFirebird<any>(
        loja,
        `select c.cli_codigo, r.rep_nome
         from clientes c
         inner join representantes r on r.rep_codigo = c.cli_rep_codigo
         where c.cli_codigo in (${lista})`
      );
      rows.forEach((r: any) => {
        const codigo = r.CLI_CODIGO?.toString().trim();
        const nome = r.REP_NOME?.toString().trim();
        if (codigo && nome) porBase[loja].set(codigo, nome);
      });
    }
  }
  const mapa = new Map<string, string>();
  for (const codigo of codigos) {
    mapa.set(codigo, porBase.sjc.get(codigo) || porBase.mg.get(codigo) || "");
  }
  return mapa;
}

async function main() {
  console.log(`=== Repetição de produtos — Televendas + Televendas MG (SJC+MG), ${DATA_INI} a ${DATA_FIM} ===\n`);

  // codigoPedido (namespaced por base, pra não colidir número de pedido entre bases) -> {cliente, produtos}
  const pedidos = new Map<string, { cliente: string; produtos: Set<string> }>();
  const statusBases: { base: string; linhas: number }[] = [];

  for (const loja of BASES) {
    console.log(`Consultando ${loja.toUpperCase()}...`);
    const rows = await queryFirebird<any>(loja, sqlPedidosTelevendas());
    console.log(`  ${rows.length} linhas`);
    statusBases.push({ base: loja.toUpperCase(), linhas: rows.length });
    rows.forEach((r: any) => {
      const pedido = r.PEDIDO?.toString().trim();
      const cliente = r.CLIENTE?.toString().trim();
      const produto = r.PRODUTO?.toString().trim();
      if (!pedido || !cliente || !produto) return;
      const chavePedido = `${loja}-${pedido}`;
      if (!pedidos.has(chavePedido)) pedidos.set(chavePedido, { cliente, produtos: new Set() });
      pedidos.get(chavePedido)!.produtos.add(produto);
    });
  }

  console.log(`Pedidos únicos (SJC+MG combinados): ${pedidos.size}`);

  // cliente -> produto -> quantidade de pedidos distintos em que apareceu
  const porCliente = new Map<string, Map<string, number>>();
  const pedidosPorCliente = new Map<string, number>();
  for (const { cliente, produtos } of pedidos.values()) {
    pedidosPorCliente.set(cliente, (pedidosPorCliente.get(cliente) ?? 0) + 1);
    if (!porCliente.has(cliente)) porCliente.set(cliente, new Map());
    const mapaProdutos = porCliente.get(cliente)!;
    produtos.forEach((p) => mapaProdutos.set(p, (mapaProdutos.get(p) ?? 0) + 1));
  }

  console.log(`Clientes distintos no período: ${porCliente.size}`);

  interface Linha {
    cliente: string;
    produtosDistintos: number;
    produtosRepetidos: number;
    percentualRepetido: number;
    pedidos: number;
  }
  const linhas: Linha[] = [];
  for (const [cliente, mapaProdutos] of porCliente) {
    const produtosDistintos = mapaProdutos.size;
    let produtosRepetidos = 0;
    mapaProdutos.forEach((qtdePedidos) => {
      if (qtdePedidos >= 2) produtosRepetidos++;
    });
    if (produtosRepetidos === 0) continue; // só quem tem alguma repetição
    linhas.push({
      cliente,
      produtosDistintos,
      produtosRepetidos,
      percentualRepetido: (produtosRepetidos / produtosDistintos) * 100,
      pedidos: pedidosPorCliente.get(cliente) ?? 0,
    });
  }

  console.log(`Clientes com alguma repetição de produto: ${linhas.length}`);

  const codigosClientes = linhas.map((l) => l.cliente);
  const [nomesClientes, representantesClientes] = await Promise.all([
    buscarNomesClientes(codigosClientes),
    buscarRepresentantesClientes(codigosClientes),
  ]);

  const saida = linhas
    .sort((a, b) => b.percentualRepetido - a.percentualRepetido)
    .map((l) => ({
      "Código Cliente": l.cliente,
      "Cliente": nomesClientes.get(l.cliente) || "",
      "Representante (Cadastro)": representantesClientes.get(l.cliente) || "",
      "% Produtos Repetidos": Number(l.percentualRepetido.toFixed(1)),
      "Pedidos no Período": l.pedidos,
      "Produtos Distintos no Período": l.produtosDistintos,
      "Produtos Repetidos (2+ pedidos)": l.produtosRepetidos,
    }));

  const wb = XLSX.utils.book_new();

  const wsNotas = XLSX.utils.json_to_sheet([
    { Item: "Período", Detalhe: `${DATA_INI} a ${DATA_FIM} (últimos 12 meses)` },
    { Item: "Bases", Detalhe: "SJC e MG, pedidos combinados por cliente (cli_codigo)" },
    { Item: "Setor", Detalhe: "TELEVENDAS ou TELEVENDAS MG — pelo representante do PEDIDO (pdv_rep_codigo)" },
    { Item: "% Produtos Repetidos", Detalhe: "Entre os produtos distintos comprados no período, quantos apareceram em 2 ou mais pedidos diferentes, dividido pelo total de produtos distintos comprados" },
    { Item: "Critério de entrada", Detalhe: "Só clientes com pelo menos 1 produto repetido (% > 0)" },
    { Item: "Filtro de venda", Detalhe: "pdv_psi_codigo NOT IN ('CC'), pdv_tve_codigo NOT IN ('6','7','26','34')" },
  ]);
  wsNotas["!cols"] = [{ wch: 26 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(wb, wsNotas, "Notas");

  const wsStatus = XLSX.utils.json_to_sheet(statusBases.map((s) => ({ "Base": s.base, "Linhas coletadas": s.linhas })));
  XLSX.utils.book_append_sheet(wb, wsStatus, "Status das bases");

  const wsDados = XLSX.utils.json_to_sheet(saida);
  wsDados["!cols"] = [{ wch: 14 }, { wch: 40 }, { wch: 26 }, { wch: 18 }, { wch: 16 }, { wch: 22 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsDados, "Clientes - % Repetido");

  wb.SheetNames = ["Notas", "Status das bases", "Clientes - % Repetido"];

  const outPath = path.join(os.homedir(), "Desktop", "Televendas_Repeticao_Produtos_12m.xlsx");
  XLSX.writeFile(wb, outPath);
  console.log(`\nRelatório salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
