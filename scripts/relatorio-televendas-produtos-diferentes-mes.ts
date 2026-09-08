/**
 * Relatório: clientes do setor TELEVENDAS (SJC + MG), mês a mês de Set/2025 a
 * Ago/2026 — quantidade de PRODUTOS DIFERENTES comprados em cada mês (contagem
 * de pro_codigo distintos, não soma de itens/quantidade) + total de produtos
 * diferentes comprados no período inteiro (deduplicado entre meses e bases).
 *
 * "Cliente do TELEVENDAS": setor do REPRESENTANTE DO PEDIDO (pdv_rep_codigo →
 * representantes_supervisores.rvs_nome = 'TELEVENDAS'), mesmo critério usado em
 * scripts/relatorio-chaves-televendas-separado.ts. Depois disso, filtra ainda
 * mais: só entram clientes cujo REPRESENTANTE DO CADASTRO (cli_rep_codigo →
 * rep_nome) tem "TELEVENDAS" no nome — pedido explícito, para tirar linhas como
 * "CADASTRO INCOMPLETO"/"CLIENTE C/ PENDENCIA" ou clientes cujo vendedor fixo é
 * de outro setor mas que compraram via pedido de Televendas.
 *
 * Padrão de venda real do projeto: pdv_psi_codigo NOT IN ('CC') e
 * pdv_tve_codigo NOT IN ('6','7','26','34').
 *
 * Rodar: npx tsx scripts/relatorio-televendas-produtos-diferentes-mes.ts
 */
import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const BASES = ["sjc", "mg"] as const;

const FILTRO_VENDA = `
  and ped.pdv_psi_codigo not in ('CC')
  and ped.pdv_tve_codigo not in ('6','7','26','34')
`;

// Traz o produto em si (não já agregado) para poder deduplicar corretamente entre
// meses e entre bases na hora de calcular o total de produtos diferentes no período.
function sqlProdutosPorMes() {
  return `
    select distinct
      extract(year from ped.pdv_data) as ano,
      extract(month from ped.pdv_data) as mes,
      ped.pdv_cli_codigo as codigo,
      i.pvi_pro_codigo as produto
    from pedidos_vendas ped
    inner join pedidos_vendas_itens i on i.pvi_numero = ped.pdv_numero
    inner join representantes r on r.rep_codigo = ped.pdv_rep_codigo
    inner join representantes_supervisores rs on rs.rvs_codigo = r.rep_rvs_codigo
    where rs.rvs_nome = 'TELEVENDAS'
    and ped.pdv_data >= date '2025-09-01'
    and ped.pdv_data < date '2026-09-01'
    ${FILTRO_VENDA}
  `;
}

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
function labelPeriodo(ano: number, mes: number) {
  return `${MESES[mes - 1]}/${String(ano).slice(2)}`;
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
  // Representante do CADASTRO do cliente (cli_rep_codigo) — prefere SJC quando o
  // código existe nas duas bases com representante diferente.
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
  console.log("=== Televendas — produtos diferentes por mês (SJC + MG, Set/25 a Ago/26) ===\n");

  // codigo -> "ano-mes" -> Set de produtos naquele mês (a união de todos os meses
  // dá o total de produtos diferentes no período, deduplicado entre meses e bases)
  const porCliente = new Map<string, Map<string, Set<string>>>();
  const statusBases: { base: string; linhas: number }[] = [];

  for (const loja of BASES) {
    console.log(`Consultando ${loja.toUpperCase()}...`);
    const rows = await queryFirebird<any>(loja, sqlProdutosPorMes());
    console.log(`  ${rows.length} linhas`);
    statusBases.push({ base: loja.toUpperCase(), linhas: rows.length });
    rows.forEach((r: any) => {
      const codigo = r.CODIGO?.toString().trim();
      const produto = r.PRODUTO?.toString().trim();
      if (!codigo || !produto) return;
      const ano = Number(r.ANO);
      const mes = Number(r.MES);
      if (!porCliente.has(codigo)) porCliente.set(codigo, new Map());
      const mapaMeses = porCliente.get(codigo)!;
      const chaveMes = `${ano}-${mes}`;
      if (!mapaMeses.has(chaveMes)) mapaMeses.set(chaveMes, new Set());
      mapaMeses.get(chaveMes)!.add(produto);
    });
  }

  console.log(`\nClientes únicos (Televendas, SJC+MG, antes do filtro de representante): ${porCliente.size}`);

  const periodos: { ano: number; mes: number }[] = [];
  for (let mes = 9; mes <= 12; mes++) periodos.push({ ano: 2025, mes });
  for (let mes = 1; mes <= 8; mes++) periodos.push({ ano: 2026, mes });

  const codigosClientes = [...porCliente.keys()];
  const [nomesClientes, representantesClientes] = await Promise.all([
    buscarNomesClientes(codigosClientes),
    buscarRepresentantesClientes(codigosClientes),
  ]);

  // Só entram clientes cujo representante do CADASTRO tem "TELEVENDAS" no nome
  const codigosFiltrados = codigosClientes.filter((codigo) =>
    (representantesClientes.get(codigo) || "").toUpperCase().includes("TELEVENDAS")
  );
  console.log(`Clientes após filtro (representante do cadastro contém "TELEVENDAS"): ${codigosFiltrados.length}`);

  const codigosOrdenados = codigosFiltrados.sort((a, b) => {
    const repA = representantesClientes.get(a) || "";
    const repB = representantesClientes.get(b) || "";
    if (repA !== repB) return repA.localeCompare(repB);
    return (nomesClientes.get(a) || "").localeCompare(nomesClientes.get(b) || "");
  });

  const linhas = codigosOrdenados.map((codigo) => {
    const meses = porCliente.get(codigo)!;
    const linha: Record<string, any> = {
      "Código Cliente": codigo,
      "Cliente": nomesClientes.get(codigo) || "",
      "Representante (Cadastro)": representantesClientes.get(codigo) || "",
    };
    for (const p of periodos) {
      linha[labelPeriodo(p.ano, p.mes)] = meses.get(`${p.ano}-${p.mes}`)?.size ?? 0;
    }
    const produtosNoPeriodo = new Set<string>();
    for (const setMes of meses.values()) setMes.forEach((prod) => produtosNoPeriodo.add(prod));
    linha["Produtos Diferentes (Total no Período)"] = produtosNoPeriodo.size;
    return linha;
  });

  const wb = XLSX.utils.book_new();

  const wsStatus = XLSX.utils.json_to_sheet(statusBases.map((s) => ({ "Base": s.base, "Linhas coletadas": s.linhas })));
  XLSX.utils.book_append_sheet(wb, wsStatus, "Status das bases");

  const wsNotas = XLSX.utils.json_to_sheet([
    { Item: "Período", Detalhe: "Setembro/2025 a Agosto/2026 (mês a mês)" },
    { Item: "Bases", Detalhe: "SJC e MG" },
    { Item: "Setor", Detalhe: "TELEVENDAS — pelo representante do PEDIDO (pdv_rep_codigo), não do cadastro do cliente" },
    { Item: "Filtro de representante", Detalhe: "Só ficam clientes cujo representante do CADASTRO (cli_rep_codigo → rep_nome) contém \"TELEVENDAS\" no nome" },
    { Item: "Métrica mensal", Detalhe: "Quantidade de produtos DIFERENTES (pro_codigo distintos) comprados naquele mês, não soma de itens/quantidade" },
    { Item: "Produtos Diferentes (Total no Período)", Detalhe: "Produtos diferentes comprados em QUALQUER mês do período (Set/25-Ago/26), deduplicado entre meses e entre SJC/MG — não é a soma das colunas mensais" },
    { Item: "Representante (Cadastro)", Detalhe: "Vem do cadastro do cliente (cli_rep_codigo) — pode ser diferente do representante de cada pedido" },
    { Item: "Filtro de venda", Detalhe: "pdv_psi_codigo NOT IN ('CC'), pdv_tve_codigo NOT IN ('6','7','26','34')" },
  ]);
  wsNotas["!cols"] = [{ wch: 26 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, wsNotas, "Notas");

  const wsDados = XLSX.utils.json_to_sheet(linhas);
  wsDados["!cols"] = [{ wch: 14 }, { wch: 40 }, { wch: 26 }, ...periodos.map(() => ({ wch: 8 })), { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsDados, "Produtos diferentes por mês");

  wb.SheetNames = ["Notas", "Status das bases", "Produtos diferentes por mês"];

  const outPath = path.join(os.homedir(), "Desktop", "Televendas_Produtos_Diferentes_Por_Mes.xlsx");
  XLSX.writeFile(wb, outPath);
  console.log(`\nRelatório salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
