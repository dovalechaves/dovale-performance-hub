/**
 * Relatório: contas a receber em aberto de clientes cuja razão social contém
 * "LEROY MERLIN" — SJC e MG somadas.
 *
 * A Leroy Merlin tem um cadastro de cliente por loja (mais de 50 lojas cadastradas
 * em cada base, cada uma com CNPJ de filial próprio). O cli_codigo é o mesmo pras
 * duas bases pra cada loja (cadastro espelhado, confirmado em relatório anterior),
 * então cada loja aparece uma linha só, com o saldo em aberto de SJC + MG somado —
 * não é duplicidade, são dívidas reais e distintas em cada base (cada uma fatura e
 * cobra separadamente), só apresentadas juntas por loja.
 *
 * Em aberto = receber_titulos.rec_saldo > 0 (saldo ainda não quitado do título).
 *
 * Rodar: npx tsx scripts/relatorio-contas-receber-leroy-merlin.ts
 */

import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const BASES = [
  { lojaKey: "sjc" as const, nome: "SJC" },
  { lojaKey: "mg" as const, nome: "MG" },
];

function sqlSaldoLeroyMerlin() {
  return `
    SELECT
      c.cli_codigo AS cod_cliente,
      c.cli_nome AS cliente,
      SUM(r.rec_saldo) AS saldo_aberto
    FROM receber_titulos r
    INNER JOIN clientes c ON c.cli_codigo = r.rec_cli_codigo
    WHERE UPPER(c.cli_nome) CONTAINING 'LEROY MERLIN'
      AND r.rec_saldo > 0
    GROUP BY c.cli_codigo, c.cli_nome
  `;
}

interface SaldoRow {
  COD_CLIENTE: any;
  CLIENTE: any;
  SALDO_ABERTO: any;
}

interface ClienteUnificado {
  codigo: string;
  nome: string;
  saldo: number;
}

async function main() {
  console.log("=== Relatório: Contas a Receber em Aberto — LEROY MERLIN (SJC + MG) ===\n");

  const porCodigo = new Map<string, ClienteUnificado>();

  for (const base of BASES) {
    console.log(`Consultando base ${base.nome}...`);
    const rows = await queryFirebird<SaldoRow>(base.lojaKey, sqlSaldoLeroyMerlin());
    console.log(`  ${rows.length} cadastros LEROY MERLIN com saldo em aberto na base ${base.nome}`);

    for (const row of rows) {
      const codigo = row.COD_CLIENTE?.toString() || "";
      if (!codigo) continue;
      const nome = row.CLIENTE?.toString().trim() || "";
      const saldo = Number(row.SALDO_ABERTO) || 0;

      const atual = porCodigo.get(codigo);
      if (atual) {
        atual.saldo += saldo;
        // prefere o nome mais descritivo (com loja/local), que costuma ser mais longo
        if (nome.length > atual.nome.length) atual.nome = nome;
      } else {
        porCodigo.set(codigo, { codigo, nome, saldo });
      }
    }
  }

  const lista = Array.from(porCodigo.values()).sort((a, b) => b.saldo - a.saldo);
  const totalGeral = lista.reduce((s, c) => s + c.saldo, 0);

  console.log(`\nCadastros LEROY MERLIN com saldo em aberto (SJC ∪ MG, unificados por cli_codigo): ${lista.length}`);
  console.log(`TOTAL EM ABERTO: R$ ${totalGeral.toFixed(2)}`);

  const sheetDados = lista.map((c) => ({
    "Código Cliente": c.codigo,
    "Nome Cliente": c.nome,
    "Saldo em Aberto (R$)": Math.round(c.saldo * 100) / 100,
  }));
  sheetDados.push({
    "Código Cliente": "",
    "Nome Cliente": "TOTAL GERAL",
    "Saldo em Aberto (R$)": Math.round(totalGeral * 100) / 100,
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetDados);
  ws["!cols"] = [{ wch: 12 }, { wch: 55 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws, "Contas a Receber - Leroy Merlin");

  const fileName = `Contas_a_Receber_Leroy_Merlin_SJC_MG.xlsx`;
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
