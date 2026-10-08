/**
 * Relatório de vendas de setembro/2026 — fechaduras/câmeras Ezviz, TWG e
 * controles PPA, somado em TODAS as bases (não distingue por base nem por
 * cliente — só código, nome, quantidade e valor).
 *
 * Bases: bh, l2 (Santana), l3 (Rio de Janeiro), fast (Lockey SP), campinas,
 * riopreto, sjc, mg, fortaleza, uberlandia, goiania, bosque, sorocaba (todas
 * as da server/db/firebird.ts, exceto "baseteste") + Lockey MG (conexão
 * separada, não coberta pelo módulo acima). Confirmado por amostragem que o
 * código do produto é o mesmo em todas as bases (catálogo espelhado).
 *
 * Códigos:
 *  - Ezviz: 22419-22436 (fechaduras, câmeras, campainha, cartões de memória)
 *  - TWG: 22437-22440 (câmeras e fechaduras)
 *  - Controles PPA: 22507, 22508, 57105, 57106, 57107, 57108, 2057105,
 *    2057106, 2057108 ("PPG" no pedido original não existe no catálogo,
 *    assumido erro de digitação — "PPA" é a marca real e bateu com vendas
 *    reais em setembro)
 *
 * Valor vendido = pvi_totalitem (valor real da venda, padrão do projeto).
 * Exclui cancelados e outras situações de não-venda, padrão já usado nos
 * demais relatórios.
 *
 * Rodar: npx tsx scripts/relatorio-ezviz-twg-ppa-set2026.ts
 */

import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird, firebirdLojas } from "../server/db/firebird";
import { fbLockeyMG } from "../server/services/comissao/db-externas";
import { queryFirebird as queryFirebirdExt } from "../server/services/comissao/firebird";

const CODIGOS = [
  // Ezviz
  22419, 22420, 22421, 22422, 22423, 22424, 22425, 22426, 22427, 22428,
  22429, 22430, 22431, 22432, 22433, 22434, 22435, 22436,
  // TWG
  22437, 22438, 22439, 22440,
  // Controles PPA
  22507, 22508, 57105, 57106, 57107, 57108, 2057105, 2057106, 2057108,
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
  const bases = firebirdLojas.filter((b) => b !== "baseteste");
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
  XLSX.utils.book_append_sheet(wb, ws, "Ezviz TWG PPA Set2026");

  const outPath = path.join(os.homedir(), "Desktop", "Vendas_Ezviz_TWG_PPA_Set2026.xlsx");
  XLSX.writeFile(wb, outPath);
  console.log(`\nArquivo gerado em: ${outPath}`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
