/**
 * Relatório: quantidade vendida do item 7702 em 2026 (ano inteiro), somando SJC, MG,
 * Lockey SP, FAST, Lockey MG e EP. Apenas quantidade (sem valor).
 *
 * SJC/MG: server/db/firebird.ts (mesma base/estrutura do restante do projeto).
 * Lockey SP/FAST e Lockey MG: reaproveita as conexões já configuradas no painel de
 * comissão (server/services/comissao/db-externas.ts) — Lockey SP e FAST são a MESMA
 * base Firebird, separadas por emp_fil_codigo ('11'=Lockey SP, '12'=FAST).
 * EP: SQL Server, tabelas EP + EP_ProdutosDoPedido (coluna CODIGO).
 *
 * Exclui cancelados (pdv_psi_codigo NOT IN ('CC')) e situações de não-venda
 * (pdv_tve_codigo NOT IN ('6','7','26','34')) nas bases Firebird — padrão do projeto.
 *
 * Rodar: npx tsx scripts/relatorio-item-7702-2026-multibase.ts
 */

import "dotenv/config";
import { queryFirebird as queryFirebirdLoja } from "../server/db/firebird";
import { queryFirebird as queryFirebirdOpts } from "../server/services/comissao/firebird";
import { querySqlServer } from "../server/db/sqlserver";
import { fbLockey, fbLockeyMG } from "../server/services/comissao/db-externas";

const CODIGO = "77002";
const ANO = 2026;
const INICIO = `${ANO}-01-01`;
const FIM = `${ANO + 1}-01-01`;

function sqlQtdPadrao() {
  return `
    SELECT SUM(i.pvi_quantidade) AS qtd
    FROM pedidos_vendas_itens i
    INNER JOIN pedidos_vendas ped ON ped.pdv_numero = i.pvi_numero
    WHERE i.pvi_pro_codigo = '${CODIGO}'
      AND ped.pdv_data >= CAST('${INICIO}' AS DATE)
      AND ped.pdv_data < CAST('${FIM}' AS DATE)
      AND ped.pdv_psi_codigo NOT IN ('CC')
      AND ped.pdv_tve_codigo NOT IN ('6', '7', '26', '34')
  `;
}

function sqlQtdLockeySPFAST() {
  return `
    SELECT ped.emp_fil_codigo AS emp, SUM(i.pvi_quantidade) AS qtd
    FROM pedidos_vendas_itens i
    INNER JOIN pedidos_vendas ped ON ped.pdv_numero = i.pvi_numero
    WHERE i.pvi_pro_codigo = '${CODIGO}'
      AND ped.pdv_data >= CAST('${INICIO}' AS DATE)
      AND ped.pdv_data < CAST('${FIM}' AS DATE)
      AND ped.pdv_psi_codigo NOT IN ('CC')
      AND ped.pdv_tve_codigo NOT IN ('6', '7', '26', '34')
      AND ped.emp_fil_codigo IN ('11', '12')
    GROUP BY ped.emp_fil_codigo
  `;
}

async function main() {
  console.log(`=== Quantidade vendida do item ${CODIGO} em ${ANO} — SJC, MG, Lockey SP, FAST, Lockey MG, EP ===\n`);

  const resultados: { base: string; qtd: number }[] = [];

  // SJC
  try {
    const rows = await queryFirebirdLoja<{ QTD: any }>("sjc", sqlQtdPadrao());
    resultados.push({ base: "SJC", qtd: Number(rows[0]?.QTD) || 0 });
  } catch (err) {
    console.error("Erro SJC:", (err as Error).message);
    resultados.push({ base: "SJC", qtd: NaN });
  }

  // MG
  try {
    const rows = await queryFirebirdLoja<{ QTD: any }>("mg", sqlQtdPadrao());
    resultados.push({ base: "MG", qtd: Number(rows[0]?.QTD) || 0 });
  } catch (err) {
    console.error("Erro MG:", (err as Error).message);
    resultados.push({ base: "MG", qtd: NaN });
  }

  // Lockey SP + FAST (mesma base, separadas por emp_fil_codigo)
  try {
    const rows = await queryFirebirdOpts(fbLockey, sqlQtdLockeySPFAST());
    const porFilial = new Map<string, number>();
    for (const r of rows as any[]) {
      porFilial.set(String(r.emp), Number(r.qtd) || 0);
    }
    resultados.push({ base: "Lockey SP", qtd: porFilial.get("11") || 0 });
    resultados.push({ base: "FAST", qtd: porFilial.get("12") || 0 });
  } catch (err) {
    console.error("Erro Lockey SP/FAST:", (err as Error).message);
    resultados.push({ base: "Lockey SP", qtd: NaN });
    resultados.push({ base: "FAST", qtd: NaN });
  }

  // Lockey MG
  try {
    const rows = await queryFirebirdOpts(fbLockeyMG, sqlQtdPadrao());
    resultados.push({ base: "Lockey MG", qtd: Number((rows[0] as any)?.qtd) || 0 });
  } catch (err) {
    console.error("Erro Lockey MG:", (err as Error).message);
    resultados.push({ base: "Lockey MG", qtd: NaN });
  }

  // EP (SQL Server)
  try {
    const rows = await querySqlServer<{ qtd: any }>(
      `
        SELECT SUM(p.QTD) AS qtd
        FROM EP e
        INNER JOIN EP_ProdutosDoPedido p ON p.PedidoID = e.ID
        WHERE p.CODIGO = @codigo
          AND e.[DATA] >= @ini
          AND e.[DATA] < @fim
      `,
      { codigo: CODIGO, ini: INICIO, fim: FIM }
    );
    resultados.push({ base: "EP", qtd: Number(rows[0]?.qtd) || 0 });
  } catch (err) {
    console.error("Erro EP:", (err as Error).message);
    resultados.push({ base: "EP", qtd: NaN });
  }

  console.log("Quantidade vendida por base:");
  let total = 0;
  for (const r of resultados) {
    console.log(`  ${r.base.padEnd(12)}: ${Number.isNaN(r.qtd) ? "ERRO" : r.qtd}`);
    if (!Number.isNaN(r.qtd)) total += r.qtd;
  }
  console.log(`\nTOTAL GERAL 2026: ${total}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
