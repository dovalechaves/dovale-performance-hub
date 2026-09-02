import "dotenv/config";
import { queryFirebird } from "../server/db/firebird";

const BASES = ["sjc", "mg"] as const;

async function contar(loja: (typeof BASES)[number], sql: string) {
  const rows = await queryFirebird<{ QTD: any }>(loja, sql);
  return Number(rows[0]?.QTD) || 0;
}

async function main() {
  for (const loja of BASES) {
    console.log(`\n=== Base ${loja.toUpperCase()} ===`);
    const pedidos = await contar(loja, `SELECT COUNT(*) AS qtd FROM PEDIDOS_VENDAS WHERE PDV_DATA >= CAST('2024-01-01' AS DATE)`);
    console.log(`Pedidos desde 2024-01-01: ${pedidos}`);
    const itens = await contar(loja, `
      SELECT COUNT(*) AS qtd FROM PEDIDOS_VENDAS_ITENS i
      INNER JOIN PEDIDOS_VENDAS p ON p.PDV_NUMERO = i.PVI_NUMERO
      WHERE p.PDV_DATA >= CAST('2024-01-01' AS DATE)
    `);
    console.log(`Itens desde 2024-01-01: ${itens}`);
    const produtos = await contar(loja, `SELECT COUNT(*) AS qtd FROM PRODUTOS`);
    console.log(`Produtos (total): ${produtos}`);
    const clientes = await contar(loja, `SELECT COUNT(*) AS qtd FROM CLIENTES`);
    console.log(`Clientes (total): ${clientes}`);
    const representantes = await contar(loja, `SELECT COUNT(*) AS qtd FROM REPRESENTANTES`);
    console.log(`Representantes (total): ${representantes}`);
    const supervisores = await contar(loja, `SELECT COUNT(*) AS qtd FROM REPRESENTANTES_SUPERVISORES`);
    console.log(`Supervisores (total): ${supervisores}`);
    const tiposVenda = await contar(loja, `SELECT COUNT(*) AS qtd FROM TIPOS_VENDAS`);
    console.log(`Tipos de venda (total): ${tiposVenda}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
