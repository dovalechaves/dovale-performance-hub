/**
 * Relatório: clientes do canal TELEVENDAS (SJC e MG) com o campo "Rede Lojas" NÃO preenchido.
 *
 * - Canal Televendas = representante do cliente (CLI_REP_CODIGO) em rep_rvs_codigo IN (1, 16)
 *   (1 = TELEVENDAS, 16 = TELEVENDAS MG) — mesmo critério dos demais relatórios de Televendas.
 * - "Rede Lojas" = clientes.cli_rcl_codigo (→ rede_clientes.rcl_nome). Não preenchido = nulo ou 0.
 * - Filial = base(s) onde o campo está vazio: só MG → "MG"; só SJC → "SJC"; vazio nas duas → "MG e SJC".
 *   Um cliente só entra numa base se for Televendas naquela base.
 *
 * Rodar: npx tsx scripts/relatorio-clientes-televendas-sem-rede-sjc-mg.ts
 */
import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const BASES = [
  { lojaKey: "mg" as const, nome: "MG" },
  { lojaKey: "sjc" as const, nome: "SJC" },
];

const SQL = `
  SELECT c.cli_codigo, c.cli_nome, c.cli_situacao, r.rep_nome
  FROM clientes c
  INNER JOIN representantes r ON r.rep_codigo = c.cli_rep_codigo
  WHERE r.rep_rvs_codigo IN (1, 16)
    AND (c.cli_rcl_codigo IS NULL OR c.cli_rcl_codigo = 0)
`;

const SITUACAO: Record<string, string> = { A: "Ativo", B: "Bloqueado", C: "Cancelado", I: "Inativo" };

interface Reg {
  codigo: string;
  nome: string;
  situacao: string;
  bases: string[];
  reps: Map<string, string>; // base -> representante
}

const t = (v: any) => (v ?? "").toString().trim();

async function main() {
  const regs = new Map<string, Reg>();

  for (const base of BASES) {
    const rows = await queryFirebird<any>(base.lojaKey, SQL);
    console.log(`${base.nome}: ${rows.length} clientes Televendas sem rede`);
    for (const r of rows) {
      const codigo = t(r.CLI_CODIGO);
      if (!codigo) continue;
      let reg = regs.get(codigo);
      if (!reg) {
        reg = { codigo, nome: t(r.CLI_NOME), situacao: t(r.CLI_SITUACAO), bases: [], reps: new Map() };
        regs.set(codigo, reg);
      }
      reg.bases.push(base.nome);
      reg.reps.set(base.nome, t(r.REP_NOME));
    }
  }

  const lista = [...regs.values()].sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }));

  const dados = lista.map((r) => {
    const repsUnicos = new Set(r.reps.values());
    const representante =
      repsUnicos.size <= 1
        ? [...repsUnicos][0] ?? ""
        : r.bases.map((b) => `${r.reps.get(b)} (${b})`).join(" / ");
    return {
      "Código": r.codigo,
      "Razão Social": r.nome,
      "Representante": representante,
      "Filial sem Rede Lojas": r.bases.join(" e "),
      "Situação": SITUACAO[r.situacao] ?? r.situacao,
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(dados);
  ws["!cols"] = [{ wch: 10 }, { wch: 45 }, { wch: 32 }, { wch: 22 }, { wch: 12 }];
  ws["!autofilter"] = { ref: `A1:E${dados.length + 1}` };
  XLSX.utils.book_append_sheet(wb, ws, "Sem Rede Lojas");

  const outPath = path.join(os.homedir(), "Desktop", "Clientes_Televendas_Sem_Rede_Lojas_SJC_MG.xlsx");
  XLSX.writeFile(wb, outPath);

  const cont = (f: (r: Reg) => boolean) => lista.filter(f).length;
  console.log(`\nClientes únicos: ${lista.length}`);
  console.log(`  Só MG: ${cont((r) => r.bases.join() === "MG")} | Só SJC: ${cont((r) => r.bases.join() === "SJC")} | MG e SJC: ${cont((r) => r.bases.length === 2)}`);
  console.log(`  Ativos: ${cont((r) => r.situacao === "A")}`);
  console.log(`Relatório salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
