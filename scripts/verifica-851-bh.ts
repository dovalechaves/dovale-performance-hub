import "dotenv/config";
import { queryFirebird } from "../server/db/firebird";
import { getPool } from "../server/db/sqlserver";
import sql from "mssql";

async function main() {
  const inicio = "2026-09-01";
  const fim = "2026-09-30";
  const clientesBH = [8106, 11283, 14985, 63718];
  const inClientes = clientesBH.join(",");

  console.log("=== Preço admin (MARGEM_LOJAS_PRECO_CHAVE) para 851 ===");
  const pool = await getPool();
  const rAdmin = await pool.request().input("codigo", sql.Int, 851).query(
    `SELECT preco FROM dbo.MARGEM_LOJAS_PRECO_CHAVE WHERE pro_codigo = @codigo`
  );
  console.log(rAdmin.recordset);

  console.log("\n=== SJC: TBP_PRECO tabela BH (6) para 851 ===");
  const sjcPreco = await queryFirebird("sjc", `
    SELECT tbp_preco FROM tabelas_produtos WHERE tbp_pro_codigo = 851 AND tbp_tab_codigo = 6
  `);
  console.log(sjcPreco);

  console.log("\n=== MG: TBP_PRECO tabela BH (8) para 851 ===");
  const mgPreco = await queryFirebird("mg", `
    SELECT tbp_preco FROM tabelas_produtos WHERE tbp_pro_codigo = 851 AND tbp_tab_codigo = 8
  `);
  console.log(mgPreco);

  console.log("\n=== SJC: vendas diretas 851 para BH no período ===");
  const sjcVendas = await queryFirebird("sjc", `
    SELECT sum(i.pvi_quantidade) as qtde, sum(i.pvi_totalitem) as valor
    FROM pedidos_vendas ped
    INNER JOIN pedidos_vendas_itens i ON i.pvi_numero = ped.pdv_numero
    WHERE i.pvi_pro_codigo = 851
      AND ped.pdv_cli_codigo IN (${inClientes})
      AND ped.pdv_data >= '${inicio}' AND ped.pdv_data <= '${fim}'
  `);
  console.log(sjcVendas);

  console.log("\n=== MG: vendas diretas 851 para BH no período ===");
  const mgVendas = await queryFirebird("mg", `
    SELECT sum(i.pvi_quantidade) as qtde, sum(i.pvi_totalitem) as valor
    FROM pedidos_vendas ped
    INNER JOIN pedidos_vendas_itens i ON i.pvi_numero = ped.pdv_numero
    WHERE i.pvi_pro_codigo = 851
      AND ped.pdv_cli_codigo IN (${inClientes})
      AND ped.pdv_data >= '${inicio}' AND ped.pdv_data <= '${fim}'
  `);
  console.log(mgVendas);

  console.log("\n=== EP: vendas 851 para BH no período ===");
  const rEP = await pool.request()
    .input("inicio", sql.Date, new Date(inicio))
    .input("fim", sql.Date, new Date(fim))
    .query(`
      SELECT p.CODIGO, p.QTD, p.VALORTOTAL, e.VENDEDOR, e.DATA
      FROM EP e
      INNER JOIN EP_ProdutosDoPedido p ON p.PEDIDO = e.PEDIDO
      WHERE p.CODIGO = 851
        AND e.VENDEDOR IN ('BH', 'Belo Horizonte')
        AND e.DATA >= @inicio AND e.DATA <= @fim
    `);
  console.log(rEP.recordset);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
