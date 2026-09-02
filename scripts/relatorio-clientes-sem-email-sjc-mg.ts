/**
 * Relatório: clientes do canal TELEVENDAS cadastrados sem e-mail válido — bases SJC e MG.
 * Canal = representante (CLI_REP_CODIGO) vinculado aos supervisores "TELEVENDAS" ou "TELEVENDAS MG"
 * (representantes_supervisores.rvs_codigo IN (1, 16) — mesma numeração nas duas bases).
 *
 * Critério de e-mail (em qualquer uma das duas bases):
 *   - cli_email nulo/vazio, OU
 *   - cli_email contém o placeholder genérico "DOVALE@DOVALE" (com variações/erros de digitação), OU
 *   - cli_email contém marcador interno equivalente a "sem e-mail" (ex.: "sememail@", "naotememail@", "desconsiderar@")
 *
 * Para cada cliente encontrado: código, razão social, vendedor/canal, e-mail cadastrado em cada base,
 * motivo do apontamento e data da última compra (considerando pedidos das duas bases).
 *
 * Rodar: npx tsx scripts/relatorio-clientes-sem-email-sjc-mg.ts
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

const FILTRO_VENDA = `
  AND p.pdv_psi_codigo NOT IN ('CC')
  AND p.pdv_tve_codigo NOT IN ('6', '7', '26', '34')
`;

// e-mail nulo/vazio OU placeholder genérico "dovale@dovale" (com variações) OU marcador interno de "sem e-mail"
function condicaoSemEmail() {
  return `(
    c.cli_email IS NULL
    OR TRIM(c.cli_email) = ''
    OR UPPER(c.cli_email) LIKE '%DOVALE@DOVALE%'
    OR LOWER(c.cli_email) LIKE '%sememail%'
    OR LOWER(c.cli_email) LIKE '%naotememail%'
    OR LOWER(c.cli_email) LIKE '%naotemmail%'
    OR LOWER(c.cli_email) LIKE '%desconsiderar%'
  )`;
}

// canais "Televendas" (mesma numeração em ambas as bases)
const RVS_TELEVENDAS = [1, 16]; // 1 = TELEVENDAS, 16 = TELEVENDAS MG

function sqlClientesSemEmail() {
  return `
    SELECT c.cli_codigo, c.cli_nome, c.cli_email, r.rep_nome, rs.rvs_nome, MAX(p.pdv_data) AS ultima_compra
    FROM clientes c
    INNER JOIN representantes r ON r.rep_codigo = c.cli_rep_codigo
    INNER JOIN representantes_supervisores rs ON rs.rvs_codigo = r.rep_rvs_codigo
    LEFT JOIN pedidos_vendas p
      ON p.pdv_cli_codigo = c.cli_codigo
      ${FILTRO_VENDA}
    WHERE rs.rvs_codigo IN (${RVS_TELEVENDAS.join(",")})
      AND ${condicaoSemEmail()}
    GROUP BY c.cli_codigo, c.cli_nome, c.cli_email, r.rep_nome, rs.rvs_nome
  `;
}

function motivo(email: any): string {
  const e = (email ?? "").toString().trim();
  if (!e) return "Sem e-mail cadastrado";
  const upper = e.toUpperCase();
  if (upper.includes("DOVALE@DOVALE")) return "E-mail genérico (dovale@dovale)";
  const lower = e.toLowerCase();
  if (lower.includes("sememail") || lower.includes("naotememail") || lower.includes("naotemmail")) return "Marcador interno: sem e-mail";
  if (lower.includes("desconsiderar")) return "Marcador interno: desconsiderar";
  return "E-mail inválido/placeholder";
}

interface ClienteRow {
  CLI_CODIGO: any;
  CLI_NOME: any;
  CLI_EMAIL: any;
  REP_NOME: any;
  RVS_NOME: any;
  ULTIMA_COMPRA: any;
}

interface Registro {
  codigo: string;
  nome: string;
  emailSjc: string | null;
  emailMg: string | null;
  motivoSjc: string | null;
  motivoMg: string | null;
  vendedorSjc: string | null;
  canalSjc: string | null;
  vendedorMg: string | null;
  canalMg: string | null;
  ultimaCompraSjc: Date | null;
  ultimaCompraMg: Date | null;
}

async function main() {
  console.log("=== Relatório: Clientes Televendas sem e-mail válido — SJC/MG ===\n");

  const registros = new Map<string, Registro>();

  for (const base of BASES) {
    console.log(`Consultando base ${base.nome}...`);
    const rows = await queryFirebird<ClienteRow>(base.lojaKey, sqlClientesSemEmail());
    console.log(`  ${rows.length} clientes com e-mail ausente/inválido na base ${base.nome}`);

    for (const row of rows) {
      const codigo = row.CLI_CODIGO?.toString().trim() || "";
      if (!codigo) continue;
      const nome = row.CLI_NOME?.toString().trim() || "";
      const email = row.CLI_EMAIL?.toString().trim() || "";
      const vendedor = row.REP_NOME?.toString().trim() || "";
      const canal = row.RVS_NOME?.toString().trim() || "";
      const ultimaCompra = row.ULTIMA_COMPRA ? new Date(row.ULTIMA_COMPRA) : null;

      let reg = registros.get(codigo);
      if (!reg) {
        reg = {
          codigo,
          nome,
          emailSjc: null,
          emailMg: null,
          motivoSjc: null,
          motivoMg: null,
          vendedorSjc: null,
          canalSjc: null,
          vendedorMg: null,
          canalMg: null,
          ultimaCompraSjc: null,
          ultimaCompraMg: null,
        };
        registros.set(codigo, reg);
      }
      if (!reg.nome && nome) reg.nome = nome;

      if (base.lojaKey === "sjc") {
        reg.emailSjc = email;
        reg.motivoSjc = motivo(email);
        reg.vendedorSjc = vendedor;
        reg.canalSjc = canal;
        reg.ultimaCompraSjc = ultimaCompra;
      } else {
        reg.emailMg = email;
        reg.motivoMg = motivo(email);
        reg.vendedorMg = vendedor;
        reg.canalMg = canal;
        reg.ultimaCompraMg = ultimaCompra;
      }
    }
  }

  console.log(`\nTotal de clientes únicos sem e-mail válido (SJC ∪ MG): ${registros.size}`);

  const lista = Array.from(registros.values()).sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }));

  function fmtData(d: Date | null): string {
    if (!d) return "";
    return d.toISOString().slice(0, 10).split("-").reverse().join("/");
  }

  const sheetDados = lista.map((r) => {
    const ultimas = [r.ultimaCompraSjc, r.ultimaCompraMg].filter((d): d is Date => d !== null);
    const ultimaGeral = ultimas.length > 0 ? new Date(Math.max(...ultimas.map((d) => d.getTime()))) : null;
    const bases: string[] = [];
    if (r.motivoSjc) bases.push("SJC");
    if (r.motivoMg) bases.push("MG");

    return {
      "Código": r.codigo,
      "Razão Social": r.nome,
      "Base(s) com problema": bases.join(" + "),
      "Vendedor (SJC)": r.vendedorSjc || "",
      "Canal (SJC)": r.canalSjc || "",
      "E-mail cadastrado (SJC)": r.emailSjc || "",
      "Motivo (SJC)": r.motivoSjc || "",
      "Vendedor (MG)": r.vendedorMg || "",
      "Canal (MG)": r.canalMg || "",
      "E-mail cadastrado (MG)": r.emailMg || "",
      "Motivo (MG)": r.motivoMg || "",
      "Última compra (SJC)": fmtData(r.ultimaCompraSjc),
      "Última compra (MG)": fmtData(r.ultimaCompraMg),
      "Última compra (geral)": fmtData(ultimaGeral),
    };
  });

  const totalSjc = lista.filter((r) => r.motivoSjc).length;
  const totalMg = lista.filter((r) => r.motivoMg).length;
  const totalAmbas = lista.filter((r) => r.motivoSjc && r.motivoMg).length;
  const nuncaComprou = lista.filter((r) => !r.ultimaCompraSjc && !r.ultimaCompraMg).length;

  const sheetResumo = [
    { "Indicador": "Filtro de canal", "Valor": "TELEVENDAS + TELEVENDAS MG" },
    { "Indicador": "Clientes únicos sem e-mail válido (SJC ∪ MG)", "Valor": lista.length },
    { "Indicador": "Com problema na base SJC", "Valor": totalSjc },
    { "Indicador": "Com problema na base MG", "Valor": totalMg },
    { "Indicador": "Com problema em ambas as bases", "Valor": totalAmbas },
    { "Indicador": "Nunca compraram (sem pedido registrado)", "Valor": nuncaComprou },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetResumo), "Resumo");
  const wsDados = XLSX.utils.json_to_sheet(sheetDados);
  wsDados["!cols"] = [
    { wch: 10 }, { wch: 40 }, { wch: 16 }, { wch: 22 }, { wch: 18 }, { wch: 28 }, { wch: 26 },
    { wch: 22 }, { wch: 18 }, { wch: 28 }, { wch: 26 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDados, "Clientes sem e-mail");

  const fileName = `Clientes_Televendas_Sem_Email_SJC_MG.xlsx`;
  const outPath = path.join(os.homedir(), "Desktop", fileName);
  XLSX.writeFile(wb, outPath);

  console.log(`\nResumo:`);
  sheetResumo.forEach((s) => console.log(`  ${s.Indicador}: ${s.Valor}`));
  console.log(`\nRelatório salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
