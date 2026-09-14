/**
 * Relatório: Fornecedores Curva ABC — bases SJC e MG, apenas produtos
 * Revenda / Revenda-Reacondicionamento.
 *
 * "Revenda ou reacondicionado" aqui NÃO vem do campo cli_consumorevenda do
 * cadastro do fornecedor (esse campo apareceu incorreto para vários fornecedores).
 * Em vez disso, olha para o GRUPO do produto comprado (produtos.pro_nivel1),
 * usando a tabela PRODUTOS_NIVEL1 como referência:
 *   2 = REVENDA
 *   4 = REVENDA/REACONDICIONAMENTO EMB
 * Um fornecedor entra no relatório se pelo menos parte do que ele vendeu pra
 * gente nos últimos 12 meses é de um produto desses grupos — e o "Total
 * Comprado" conta só o valor desses itens (não a nota inteira, que pode ter
 * produtos de outros grupos misturados).
 *
 * Ainda exige cli_fornecedor = 1 (caixinha "Fornecedor" marcada no cadastro) —
 * esse campo não foi apontado como errado, só o de Consumo/Revenda.
 *
 * Valor de compra por item = NCI_TOTALITEM + NCI_ICMSSUBST + NCI_FCP_VL_ST + NCI_IPIVALOR
 * (mesmo padrão usado nas vendas: pvi_totalitem + pvi_substicms + pvi_vl_fcp_st + pvi_ipivalor,
 * só que no lado de compras). Junta item -> nota por (cli_codigo, série, número) —
 * bate 100% dos itens nas duas bases (join por ntc_id perde algumas linhas).
 * Período: últimos 12 meses corridos a partir de hoje. Não achamos flag de nota
 * cancelada em notas_compras, então todas as notas do período entram.
 *
 * Regime tributário (cli_regimetributario), confirmado contra o cadastro
 * (cliente 8184 = STAM METALURGICA, tela mostra "Regime Normal" = código 3):
 *   1 = Simples Nacional
 *   2 = Simples Nacional (excesso de sublimite de receita bruta)
 *   3 = Regime Normal
 *   0 ou null = não informado
 *
 * Unificação: SJC + MG somados, e cadastros duplicados do mesmo fornecedor
 * (mesmo CNPJ, códigos de cliente diferentes) são somados em uma linha só.
 *
 * Curva ABC: fornecedores ordenados por valor comprado desc, classificados
 * pelo valor acumulado sobre o total do grupo (revenda/reacondicionado):
 *   A: até 80% acumulado
 *   B: de 80% até 95% acumulado
 *   C: acima de 95% acumulado
 * (corte padrão de curva ABC — pode ajustar se vocês usam outro corte.)
 *
 * Rodar: npx tsx scripts/relatorio-fornecedores-curva-abc-revenda.ts
 */

import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const HOJE = new Date();
const UM_ANO_ATRAS = new Date(HOJE);
UM_ANO_ATRAS.setFullYear(UM_ANO_ATRAS.getFullYear() - 1);

const fmtData = (d: Date) => d.toISOString().slice(0, 10);
const PERIODO_INICIO = fmtData(UM_ANO_ATRAS);
const PERIODO_FIM = fmtData(HOJE);

const GRUPOS_REVENDA = [2, 4]; // PRODUTOS_NIVEL1: 2=REVENDA, 4=REVENDA/REACONDICIONAMENTO EMB

const BASES = [
  { lojaKey: "sjc" as const, nome: "SJC" },
  { lojaKey: "mg" as const, nome: "MG" },
];

const REGIME_TRIBUTARIO_LABEL: Record<string, string> = {
  "0": "Não informado",
  "1": "Simples Nacional",
  "2": "Simples Nacional (excesso de sublimite)",
  "3": "Regime Normal",
};

interface FornecedorRow {
  CLI_CODIGO: any;
  CLI_NOME: any;
  CLI_CNPJ: any;
  CLI_REGIMETRIBUTARIO: any;
  VALOR: any;
}

function sqlComprasFornecedoresRevenda() {
  return `
    SELECT
      c.cli_codigo AS cli_codigo,
      c.cli_nome AS cli_nome,
      c.cli_cnpj AS cli_cnpj,
      c.cli_regimetributario AS cli_regimetributario,
      SUM(nci.nci_totalitem + nci.nci_icmssubst + nci.nci_fcp_vl_st + nci.nci_ipivalor) AS valor
    FROM notas_compras_itens nci
    INNER JOIN notas_compras ntc
      ON ntc.ntc_cli_codigo = nci.nci_cli_codigo
     AND ntc.ntc_serie = nci.nci_serie
     AND ntc.ntc_numero = nci.nci_numero
    INNER JOIN produtos p ON p.pro_codigo = nci.nci_pro_codigo
    INNER JOIN clientes c ON c.cli_codigo = nci.nci_cli_codigo
    WHERE c.cli_fornecedor = 1
      AND p.pro_nivel1 IN (${GRUPOS_REVENDA.join(",")})
      AND ntc.ntc_data >= CAST('${PERIODO_INICIO}' AS DATE)
      AND ntc.ntc_data <= CAST('${PERIODO_FIM}' AS DATE)
    GROUP BY c.cli_codigo, c.cli_nome, c.cli_cnpj, c.cli_regimetributario
  `;
}

function normalizarCnpj(cnpj: any): string {
  const digitos = String(cnpj ?? "").replace(/\D/g, "");
  return digitos || `SEM-CNPJ-${Math.random()}`;
}

interface FornecedorUnificado {
  chaveCnpj: string;
  cnpjExibicao: string;
  nome: string;
  regimeTributario: string;
  valor: number;
}

async function main() {
  console.log(`=== Relatório Fornecedores Curva ABC — Revenda/Reacondicionamento (grupo produto) — SJC/MG ===\n`);
  console.log(`Período: ${PERIODO_INICIO} a ${PERIODO_FIM} (últimos 12 meses)\n`);

  const porFornecedor = new Map<string, FornecedorUnificado>();

  for (const base of BASES) {
    console.log(`Consultando base ${base.nome}...`);
    const rows = await queryFirebird<FornecedorRow>(base.lojaKey, sqlComprasFornecedoresRevenda());
    console.log(`  ${rows.length} fornecedores com compra de produto revenda/reacondicionado na base ${base.nome}`);

    for (const row of rows) {
      const valor = Number(row.VALOR) || 0;
      if (valor <= 0) continue;

      const cnpjExibicao = String(row.CLI_CNPJ ?? "").trim();
      const chave = normalizarCnpj(row.CLI_CNPJ);
      const nome = row.CLI_NOME?.toString().trim() || "";
      const regimeCodigo = row.CLI_REGIMETRIBUTARIO === null || row.CLI_REGIMETRIBUTARIO === undefined
        ? "0"
        : String(row.CLI_REGIMETRIBUTARIO).trim();
      const regimeTributario = REGIME_TRIBUTARIO_LABEL[regimeCodigo] || "Não informado";

      const atual = porFornecedor.get(chave);
      if (atual) {
        atual.valor += valor;
        if (!atual.cnpjExibicao && cnpjExibicao) atual.cnpjExibicao = cnpjExibicao;
      } else {
        porFornecedor.set(chave, {
          chaveCnpj: chave,
          cnpjExibicao,
          nome,
          regimeTributario,
          valor,
        });
      }
    }
  }

  const fornecedores = Array.from(porFornecedor.values()).sort((a, b) => b.valor - a.valor);
  const totalGeral = fornecedores.reduce((s, f) => s + f.valor, 0);

  console.log(`\nTotal de fornecedores revenda/reacondicionado com compra no período: ${fornecedores.length}`);
  console.log(`Total comprado (12 meses): ${totalGeral.toFixed(2)}`);

  let acumulado = 0;
  let countA = 0, countB = 0, countC = 0;
  const classificados = fornecedores.map((f) => {
    acumulado += f.valor;
    const percentual = Math.round((f.valor / totalGeral) * 10000) / 100;
    const acumuladoPercentual = Math.round((acumulado / totalGeral) * 10000) / 100;
    let curva: "A" | "B" | "C";
    if (acumuladoPercentual <= 80) {
      curva = "A";
      countA++;
    } else if (acumuladoPercentual <= 95) {
      curva = "B";
      countB++;
    } else {
      curva = "C";
      countC++;
    }
    return { ...f, percentual, acumuladoPercentual, curva };
  });

  console.log(`Curva A: ${countA} | Curva B: ${countB} | Curva C: ${countC}\n`);

  const sheet = classificados.map((f) => ({
    "Curva": f.curva,
    "Nome Fornecedor": f.nome,
    "CNPJ": f.cnpjExibicao,
    "Total Comprado (12 meses)": Math.round(f.valor * 100) / 100,
    "Regime Tributário": f.regimeTributario,
    "% do Total": f.percentual,
    "% Acumulado": f.acumuladoPercentual,
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), "Fornecedores Curva ABC");

  const fileName = `Relatorio_Fornecedores_Curva_ABC_Revenda_SJC_MG.xlsx`;
  const outPath = path.join(os.homedir(), "Desktop", fileName);
  XLSX.writeFile(wb, outPath);

  console.log(`Relatório salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
