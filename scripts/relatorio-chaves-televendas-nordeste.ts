/**
 * Relatório: quantidade de CHAVES vendidas (subgrupo produtos_nivel2 = 'CHAVE'),
 * mês a mês, 2025 e 2026 — bases SJC e MG combinadas, filtrado aos setores
 * TELEVENDAS e TELEVENDAS MG separadamente (rvs_nome, atribuído pelo representante
 * do PEDIDO — pdv_rep_codigo — não pelo cadastro do cliente).
 *
 * Filtro de estado do cliente (cli_mun_codigo -> municipios.mun_uf), tudo somado numa
 * linha só por mês (sem quebrar por estado, como pedido): Bahia, Sergipe (inclui
 * Aracaju, é a capital do estado), Alagoas, Pernambuco, Paraíba, Rio Grande do Norte
 * — UFs BA, SE, AL, PE, PB, RN.
 *
 * Padrão de venda real do projeto: pdv_psi_codigo NOT IN ('CC') e
 * pdv_tve_codigo NOT IN ('6','7','26','34').
 *
 * Rodar: npx tsx scripts/relatorio-chaves-televendas-nordeste.ts
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

const SETORES = ["TELEVENDAS", "TELEVENDAS MG"];
const UFS = "'BA','SE','AL','PE','PB','RN'";

function sqlChavesTelevendas() {
  return `
    select
      rs.rvs_nome as setor,
      extract(year from ped.pdv_data) as ano,
      extract(month from ped.pdv_data) as mes,
      sum(i.pvi_quantidade) as qtde
    from pedidos_vendas ped
    inner join pedidos_vendas_itens i on i.pvi_numero = ped.pdv_numero
    inner join produtos p on p.pro_codigo = i.pvi_pro_codigo
    inner join produtos_nivel2 pn on pn.codigo = p.pro_nivel2
    inner join clientes c on c.cli_codigo = ped.pdv_cli_codigo
    inner join municipios m on m.mun_codigo = c.cli_mun_codigo
    inner join representantes r on r.rep_codigo = ped.pdv_rep_codigo
    inner join representantes_supervisores rs on rs.rvs_codigo = r.rep_rvs_codigo
    where pn.nome = 'CHAVE'
    and rs.rvs_nome in ('${SETORES.join("','")}')
    and m.mun_uf in (${UFS})
    and ped.pdv_data >= date '2025-01-01'
    and ped.pdv_data < date '2027-01-01'
    and ped.pdv_psi_codigo not in ('CC')
    and ped.pdv_tve_codigo not in ('6','7','26','34')
    group by 1,2,3
  `;
}

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

async function main() {
  console.log("=== Relatório: Chaves vendidas — TELEVENDAS / TELEVENDAS MG — Nordeste (BA/SE/AL/PE/PB/RN) — SJC+MG ===\n");

  const porSetorMes = new Map<string, { setor: string; ano: number; mes: number; qtde: number }>();

  for (const base of BASES) {
    console.log(`Consultando base ${base.nome}...`);
    const rows = await queryFirebird<any>(base.lojaKey, sqlChavesTelevendas());
    console.log(`  ${rows.length} linhas`);
    rows.forEach((r: any) => {
      const setor = r.SETOR?.toString().trim();
      const ano = Number(r.ANO);
      const mes = Number(r.MES);
      const qtde = Number(r.QTDE) || 0;
      const chave = `${setor}|${ano}|${mes}`;
      const existente = porSetorMes.get(chave);
      if (existente) existente.qtde += qtde;
      else porSetorMes.set(chave, { setor, ano, mes, qtde });
    });
  }

  const mesesComDadoPorAno = (ano: number) =>
    MESES.filter((_, i) => !(ano === 2026 && new Date(ano, i, 1) > new Date())).length;

  const wb = XLSX.utils.book_new();

  for (const setor of SETORES) {
    const linhas = MESES.map((nomeMes, i) => {
      const mes = i + 1;
      const v2025 = porSetorMes.get(`${setor}|2025|${mes}`)?.qtde ?? 0;
      const dadoDisponivel2026 = !(new Date(2026, i, 1) > new Date());
      const v2026 = dadoDisponivel2026 ? porSetorMes.get(`${setor}|2026|${mes}`)?.qtde ?? 0 : null;
      return { "Mês": nomeMes, "2025": v2025, "2026": v2026 };
    });

    const total2025 = linhas.reduce((a, l) => a + (l["2025"] as number), 0);
    const total2026 = linhas.reduce((a, l) => a + ((l["2026"] as number) ?? 0), 0);
    const qtdMeses2026 = mesesComDadoPorAno(2026);
    const media2025 = total2025 / 12;
    const media2026 = qtdMeses2026 ? total2026 / qtdMeses2026 : 0;

    linhas.push({ "Mês": "TOTAL", "2025": total2025, "2026": total2026 });
    linhas.push({ "Mês": "MÉDIA MENSAL", "2025": Number(media2025.toFixed(1)), "2026": Number(media2026.toFixed(1)) });

    const nomeAba = setor === "TELEVENDAS" ? "Televendas" : "Televendas MG";
    const ws = XLSX.utils.json_to_sheet(linhas);
    ws["!cols"] = [{ wch: 16 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, nomeAba);

    console.log(`\n${setor}:`);
    console.log(`  2025: total ${total2025} | média mensal ${media2025.toFixed(1)}`);
    console.log(`  2026 (${qtdMeses2026} meses até agora): total ${total2026} | média mensal ${media2026.toFixed(1)}`);
  }

  const outPath = path.join(os.homedir(), "Desktop", "Chaves_Televendas_Nordeste_2025_2026.xlsx");
  XLSX.writeFile(wb, outPath);
  console.log(`\nRelatório salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
