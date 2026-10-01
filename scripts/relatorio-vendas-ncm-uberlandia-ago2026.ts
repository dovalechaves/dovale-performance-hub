/**
 * Relatório de vendas de Uberlândia (base própria, Firebird "uberlandia") com NCM,
 * período 01/08/2026 até 31/08/2026.
 *
 * NCM: produtos.pro_fis_codigo -> classificacao_fiscal.fis_codigo, e o código NCM
 * em si fica em classificacao_fiscal.fis_nome (confirmado por amostragem — ex:
 * fis_nome = '82055900', '83016000', etc.).
 *
 * Exclui pedidos cancelados (pdv_psi_codigo NOT IN ('CC')) e outras situações de
 * não-venda (pdv_tve_codigo NOT IN ('6','7','26','34')), padrão já usado nos
 * demais relatórios do projeto.
 *
 * Rodar: npx tsx scripts/relatorio-vendas-ncm-uberlandia-ago2026.ts
 */

import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const INICIO = "2026-08-01";
const FIM = "2026-08-31";

interface VendaRow {
  PDV_NUMERO: any;
  PDV_DATA: any;
  CLI_CODIGO: any;
  CLI_NOME: any;
  PRO_CODIGO: any;
  PRO_RESUMO: any;
  NCM: any;
  QTDE: any;
  VALOR_UNITARIO: any;
  VALOR_TOTAL: any;
}

function sqlVendasComNCM() {
  return `
    SELECT
      ped.pdv_numero AS pdv_numero,
      ped.pdv_data AS pdv_data,
      ped.pdv_cli_codigo AS cli_codigo,
      c.cli_nome AS cli_nome,
      p.pro_codigo AS pro_codigo,
      p.pro_resumo AS pro_resumo,
      cf.fis_nome AS ncm,
      i.pvi_quantidade AS qtde,
      i.pvi_unitario AS valor_unitario,
      i.pvi_totalitem AS valor_total
    FROM pedidos_vendas ped
    INNER JOIN pedidos_vendas_itens i ON i.pvi_numero = ped.pdv_numero
    INNER JOIN produtos p ON p.pro_codigo = i.pvi_pro_codigo
    LEFT JOIN clientes c ON c.cli_codigo = ped.pdv_cli_codigo
    LEFT JOIN classificacao_fiscal cf ON cf.fis_codigo = p.pro_fis_codigo
    WHERE ped.pdv_data >= CAST('${INICIO}' AS DATE)
      AND ped.pdv_data <= CAST('${FIM}' AS DATE)
      AND ped.pdv_psi_codigo NOT IN ('CC')
      AND ped.pdv_tve_codigo NOT IN ('6', '7', '26', '34')
    ORDER BY ped.pdv_data, ped.pdv_numero, p.pro_codigo
  `;
}

async function main() {
  console.log("Consultando vendas de Uberlândia (01/08/2026 a 31/08/2026)...");
  const rows = await queryFirebird<VendaRow>("uberlandia", sqlVendasComNCM());
  console.log(`${rows.length} itens de venda encontrados.`);

  const dados = rows.map((r) => ({
    Pedido: Number(r.PDV_NUMERO),
    Data: r.PDV_DATA ? new Date(r.PDV_DATA).toLocaleDateString("pt-BR") : "",
    "Código Cliente": r.CLI_CODIGO != null ? Number(r.CLI_CODIGO) : null,
    Cliente: r.CLI_NOME?.toString().trim() || "",
    "Código Produto": Number(r.PRO_CODIGO),
    Produto: r.PRO_RESUMO?.toString().trim() || "",
    NCM: r.NCM?.toString().trim() || "",
    Quantidade: Number(r.QTDE) || 0,
    "Valor Unitário": r.VALOR_UNITARIO != null ? Number(r.VALOR_UNITARIO) : 0,
    "Valor Total": r.VALOR_TOTAL != null ? Number(r.VALOR_TOTAL) : 0,
  }));

  const ws = XLSX.utils.json_to_sheet(dados);
  ws["!cols"] = [
    { wch: 10 }, // Pedido
    { wch: 12 }, // Data
    { wch: 14 }, // Código Cliente
    { wch: 35 }, // Cliente
    { wch: 14 }, // Código Produto
    { wch: 45 }, // Produto
    { wch: 12 }, // NCM
    { wch: 12 }, // Quantidade
    { wch: 14 }, // Valor Unitário
    { wch: 14 }, // Valor Total
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Vendas NCM Uberlândia");

  const fileName = "Vendas_NCM_Uberlandia_Ago2026.xlsx";
  const outPath = path.join(os.homedir(), "Desktop", fileName);
  XLSX.writeFile(wb, outPath);
  console.log(`Arquivo gerado em: ${outPath}`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
