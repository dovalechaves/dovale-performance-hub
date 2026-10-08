/**
 * Relatório de vendas de setembro/2026 — puxadores, somado nas bases SJC,
 * MG, Lockey SP, Lockey MG e FAST (não distingue por base nem por cliente —
 * só código, nome, quantidade e valor).
 *
 * "Lockey SP" e "FAST" são a MESMA base física (mesmo banco, separados só
 * por emp_fil_codigo internamente) — por isso aparecem como uma consulta só
 * aqui ("fast" no server/db/firebird.ts). Lockey MG é uma base separada.
 *
 * Códigos: união de todos os produtos com "PUXADOR" no resumo em SJC e MG
 * (37 códigos distintos — catálogo espelhado, confirmado por amostragem).
 *
 * Valor vendido = pvi_totalitem (valor real da venda, padrão do projeto).
 * Exclui cancelados e outras situações de não-venda, padrão já usado nos
 * demais relatórios.
 *
 * Rodar: npx tsx scripts/relatorio-puxadores-set2026.ts
 */

import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";
import { fbLockeyMG } from "../server/services/comissao/db-externas";
import { queryFirebird as queryFirebirdExt } from "../server/services/comissao/firebird";

const CODIGOS = [
  30112, 30128, 30149, 30171, 50102, 50110, 50120, 50130, 50131, 50132,
  50133, 50134, 50135, 50150, 50151, 50152, 50153, 50154, 50175, 50176,
  50178, 50179, 50200, 50201, 50202, 50203, 50204, 50391, 50392, 50400,
  60177, 62550, 86104, 86140, 880404, 887358, 5050400,
];

const INICIO = "2026-09-01";
const FIM = "2026-10-01";

const FILTRO_VENDA = `
  and ped.pdv_psi_codigo not in ('CC')
  and ped.pdv_tve_codigo not in ('6','7','26','34')
`;

function sql() {
  return `
    select p.pro_codigo as pro_codigo, p.pro_resumo as pro_resumo,
      sum(i.pvi_quantidade) as qtde,
      sum(i.pvi_totalitem) as valor
    from pedidos_vendas ped
    inner join pedidos_vendas_itens i on i.pvi_numero = ped.pdv_numero
    inner join produtos p on p.pro_codigo = i.pvi_pro_codigo
    where p.pro_codigo in (${CODIGOS.join(",")})
      and ped.pdv_data >= date '${INICIO}' and ped.pdv_data < date '${FIM}'
      ${FILTRO_VENDA}
    group by p.pro_codigo, p.pro_resumo
  `;
}

interface VendaRow {
  PRO_CODIGO: any;
  PRO_RESUMO: any;
  QTDE: any;
  VALOR: any;
}
interface VendaRowExt {
  pro_codigo: any;
  pro_resumo: any;
  qtde: any;
  valor: any;
}

async function main() {
  const bases = ["sjc", "mg", "fast"] as const; // fast = Lockey SP
  const acumulado = new Map<number, { resumo: string; qtde: number; valor: number }>();

  function somar(codigo: number, resumo: string, qtde: number, valor: number) {
    const atual = acumulado.get(codigo);
    if (atual) {
      atual.qtde += qtde;
      atual.valor += valor;
      if (!atual.resumo && resumo) atual.resumo = resumo;
    } else {
      acumulado.set(codigo, { resumo, qtde, valor });
    }
  }

  for (const base of bases) {
    try {
      const rows = await queryFirebird<VendaRow>(base, sql());
      for (const r of rows) {
        somar(Number(r.PRO_CODIGO), r.PRO_RESUMO?.toString().trim() || "", Number(r.QTDE) || 0, r.VALOR != null ? Number(r.VALOR) : 0);
      }
      console.log(`${base}: ${rows.length} produto(s)`);
    } catch (e: any) {
      console.log(`${base}: ERRO — ${e.message}`);
    }
  }

  try {
    const rowsMg = await queryFirebirdExt(fbLockeyMG, sql()) as unknown as VendaRowExt[];
    for (const r of rowsMg) {
      somar(Number(r.pro_codigo), r.pro_resumo?.toString().trim() || "", Number(r.qtde) || 0, r.valor != null ? Number(r.valor) : 0);
    }
    console.log(`lockeymg: ${rowsMg.length} produto(s)`);
  } catch (e: any) {
    console.log(`lockeymg: ERRO — ${e.message}`);
  }

  const dados = [...acumulado.entries()]
    .map(([codigo, v]) => ({ Código: codigo, Nome: v.resumo, Quantidade: v.qtde, Valor: Math.round(v.valor * 100) / 100 }))
    .sort((a, b) => a.Código - b.Código);

  const ws = XLSX.utils.json_to_sheet(dados);
  ws["!cols"] = [{ wch: 10 }, { wch: 55 }, { wch: 12 }, { wch: 14 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Puxadores Set2026");

  const outPath = path.join(os.homedir(), "Desktop", "Vendas_Puxadores_Set2026.xlsx");
  XLSX.writeFile(wb, outPath);
  console.log(`\nArquivo gerado em: ${outPath}`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
