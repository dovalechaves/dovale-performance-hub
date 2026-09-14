/**
 * Relatório: clientes da planilha "clientes_prospeccao_6360.xlsx" que estão nas cidades
 * da região de Sorocaba/Itapetininga (lista abaixo), com um campo de status Ativo/Inativo
 * olhando SJC e MG como uma base só.
 *
 * Regra de ativo/inativo (pedida por Willian): SJC e MG são tratadas como uma única base —
 * se o cliente comprou em SJC OU em MG nos últimos 4 meses, é Ativo; se não comprou em
 * nenhuma das duas nesse período (inclusive quem nunca teve cadastro/compra em SJC/MG), é
 * Inativo. Não é a mesma coisa que a coluna "Situação" que já vem na planilha original —
 * aquela reflete o cadastro em todas as lojas (Campinas, Santana, etc.), essa aqui olha
 * só SJC+MG, como pedido.
 *
 * Cliente da planilha é casado com o cadastro em SJC/MG pelo CNPJ (normalizado para só
 * dígitos dos dois lados, já que o cadastro no Firebird guarda o CNPJ ora formatado ora
 * não). "Última compra (SJC+MG)" é a mais recente entre as duas bases, mesmo se antiga —
 * ajuda a conferir o resultado. "Cadastro SJC/MG" mostra se achou o CNPJ em alguma das
 * duas bases; quando não acha em nenhuma, o cliente entra como Inativo mesmo assim (não
 * tem pedido em SJC/MG porque nem tem cadastro lá).
 *
 * Rodar: npx tsx scripts/relatorio-clientes-prospeccao-status-sjc-mg-cidades-sorocaba.ts
 */

import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const ARQUIVO_ORIGEM = path.join(os.homedir(), "Desktop", "clientes_prospeccao_6360.xlsx");
const MESES_INATIVIDADE = 4;

const CIDADES_ALVO = [
  "Sorocaba", "Barueri", "Itapevi", "Itu", "Itapetininga", "Santana de Parnaíba",
  "Botucatu", "Tatuí", "Votorantim", "Jandira", "São Roque", "Ibiúna", "Boituva",
  "Porto Feliz", "Piedade", "Mairinque", "Capão Bonito", "Cerquilho",
  "Salto de Pirapora", "Tietê", "Iperó", "Araçoiaba da Serra", "São Miguel Arcanjo",
  "Pilar do Sul", "Laranjal Paulista", "Angatuba", "Araçariguama", "Capela do Alto",
  "Miracatu", "Cesário Lange", "Alumínio", "Juquiá", "Conchas", "Guareí", "Sarapuí",
  "Bofete", "Porangaba", "Pereiras", "Tapiraí", "Pardinho", "Alambari", "Quadra",
  "Torre de Pedra",
];

const BASES = [
  { lojaKey: "sjc" as const, nome: "SJC" },
  { lojaKey: "mg" as const, nome: "MG" },
];

function normCidade(s: unknown): string {
  return (s?.toString() || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

function soDigitos(s: unknown): string {
  return (s?.toString() || "").replace(/\D/g, "");
}

interface LinhaExcel {
  [key: string]: any;
}

interface StatusSjcMg {
  cadastroBases: string[]; // ["SJC"], ["MG"], ["SJC","MG"] ou []
  ativo: boolean;
  ultimaCompra: Date | null;
}

async function main() {
  console.log("=== Relatório: Status SJC+MG dos clientes de prospecção nas cidades da região de Sorocaba ===\n");

  const wb = XLSX.readFile(ARQUIVO_ORIGEM);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const linhas: LinhaExcel[] = XLSX.utils.sheet_to_json(ws, { defval: null });
  console.log(`Planilha origem: ${linhas.length} clientes`);

  const cidadesAlvoNorm = new Set(CIDADES_ALVO.map(normCidade));
  const filtradas = linhas.filter((l) => cidadesAlvoNorm.has(normCidade(l["Cidade"])));
  console.log(`Clientes nas cidades da lista: ${filtradas.length}`);

  const cnpjPorLinha = new Map<LinhaExcel, string>();
  const cnpjsUnicos = new Set<string>();
  for (const l of filtradas) {
    const digitos = soDigitos(l["CNPJ"]);
    if (digitos) {
      cnpjPorLinha.set(l, digitos);
      cnpjsUnicos.add(digitos);
    }
  }
  console.log(`CNPJs únicos a consultar em SJC/MG: ${cnpjsUnicos.size}`);

  const statusPorCnpj = new Map<string, StatusSjcMg>();
  for (const cnpj of cnpjsUnicos) {
    statusPorCnpj.set(cnpj, { cadastroBases: [], ativo: false, ultimaCompra: null });
  }

  const listaCnpjSql = Array.from(cnpjsUnicos).map((c) => `'${c}'`).join(",");

  if (listaCnpjSql) {
    for (const base of BASES) {
      console.log(`\nConsultando base ${base.nome}...`);
      const sql = `
        SELECT
          c.cli_codigo AS cod_cliente,
          REPLACE(REPLACE(REPLACE(c.cli_cnpj, '.', ''), '/', ''), '-', '') AS cnpj_digitos,
          (SELECT MAX(p2.pdv_data) FROM pedidos_vendas p2
             WHERE p2.pdv_cli_codigo = c.cli_codigo
               AND p2.pdv_psi_codigo NOT IN ('CC')
               AND p2.pdv_tve_codigo NOT IN ('6', '7', '26', '34')) AS ultima_compra,
          CASE WHEN EXISTS (
            SELECT 1 FROM pedidos_vendas p
            WHERE p.pdv_cli_codigo = c.cli_codigo
              AND p.pdv_data >= DATEADD(MONTH, -${MESES_INATIVIDADE}, CURRENT_DATE)
              AND p.pdv_psi_codigo NOT IN ('CC')
              AND p.pdv_tve_codigo NOT IN ('6', '7', '26', '34')
          ) THEN 1 ELSE 0 END AS ativo_recente
        FROM clientes c
        WHERE REPLACE(REPLACE(REPLACE(c.cli_cnpj, '.', ''), '/', ''), '-', '') IN (${listaCnpjSql})
      `;
      const rows = await queryFirebird<any>(base.lojaKey, sql);
      console.log(`  ${rows.length} cadastros encontrados em ${base.nome}`);

      for (const row of rows) {
        const cnpj = row.CNPJ_DIGITOS?.toString().trim();
        if (!cnpj || !statusPorCnpj.has(cnpj)) continue;
        const status = statusPorCnpj.get(cnpj)!;
        status.cadastroBases.push(base.nome);
        if (Number(row.ATIVO_RECENTE) === 1) status.ativo = true;
        if (row.ULTIMA_COMPRA) {
          const data = new Date(row.ULTIMA_COMPRA);
          if (!status.ultimaCompra || data > status.ultimaCompra) status.ultimaCompra = data;
        }
      }
    }
  }

  let contAtivos = 0;
  let contInativos = 0;
  let contSemCadastro = 0;

  const linhasSaida = filtradas.map((l) => {
    const cnpj = cnpjPorLinha.get(l);
    const status = cnpj ? statusPorCnpj.get(cnpj) : undefined;
    const temCadastro = !!status && status.cadastroBases.length > 0;
    const ativo = !!status && status.ativo;

    if (!temCadastro) contSemCadastro++;
    else if (ativo) contAtivos++;
    else contInativos++;

    return {
      ...l,
      "Cadastro SJC/MG": temCadastro ? status!.cadastroBases.join(" + ") : "Não",
      "Última Compra (SJC+MG)": status?.ultimaCompra
        ? status.ultimaCompra.toLocaleDateString("pt-BR")
        : "",
      "Status (SJC+MG)": ativo ? "Ativo" : "Inativo",
    };
  });

  console.log(`\nTotal na planilha final: ${linhasSaida.length}`);
  console.log(`  Ativos (compraram em SJC ou MG nos últimos ${MESES_INATIVIDADE} meses): ${contAtivos}`);
  console.log(`  Inativos com cadastro em SJC/MG: ${contInativos}`);
  console.log(`  Inativos sem cadastro em SJC/MG: ${contSemCadastro}`);

  const wsOut = XLSX.utils.json_to_sheet(linhasSaida);
  const wbOut = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbOut, wsOut, "Clientes");

  const fileName = "Clientes_Prospeccao_Regiao_Sorocaba_Status_SJC_MG.xlsx";
  const outPath = path.join(os.homedir(), "Desktop", fileName);
  XLSX.writeFile(wbOut, outPath);

  console.log(`\nRelatório salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
