/**
 * Relatório: clientes de Varejo + Televendas, INATIVOS (sem compra válida nos últimos
 * 4 meses) em SJC + MG (tratadas como base única), restrito às cidades da lista abaixo
 * (região de Sorocaba/Itapetininga/Botucatu).
 *
 * Filtros de escopo do cliente (mesmo critério do relatório de clientes ativos já feito
 * para o projeto): cli_eta_codigo IN (1,2,3) = VAREJO / VAREJO DISTRIBUIDOR / VAREJO
 * CLIENTES ESPECIAIS; representante do cliente com rep_rvs_codigo IN (1,16) =
 * TELEVENDAS / TELEVENDAS MG; exclui representantes "especiais" (rep_nome like '*%').
 * Um cliente entra se bater esse critério em QUALQUER uma das duas bases (SJC ou MG).
 *
 * Inatividade: sem nenhuma venda válida (pdv_psi_codigo NOT IN ('CC'), pdv_tve_codigo
 * NOT IN ('6','7','26','34')) nos últimos 4 meses, olhando SJC+MG somadas — inclui
 * clientes que nunca compraram.
 *
 * CNAE: a base NÃO tem CNAE oficial da Receita Federal preenchido (tabela
 * CLIENTES_SERASA_INFATIV existe mas está com 0 linhas em SJC e MG — gap confirmado).
 * Por isso a coluna "CNAE / Ramo de Atividade" só traz o Ramo de Atividade
 * (cli_eta_codigo -> entidades_atividades) para clientes CPF (cli_pessoa = 'F');
 * pra CNPJ (cli_pessoa = 'J') fica em branco, com uma coluna à parte avisando que não
 * há CNAE oficial disponível.
 *
 * Telefone = COALESCE(cli_whatsapp, cli_fone, cli_celular, 0), conforme pedido.
 *
 * Rodar: npx tsx scripts/relatorio-clientes-inativos-varejo-televendas-regiao-sorocaba.ts
 */

import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const MESES_INATIVIDADE = 4;

const CIDADES_ALVO = [
  "Alambari", "Alumínio", "Araçariguama", "Araçoiaba da Serra", "Boituva",
  "Capela do Alto", "Cerquilho", "Cesário Lange", "Conchas", "Ibiúna", "Iperó",
  "Itapetininga", "Itu", "Laranjal Paulista", "Mairinque", "Piedade", "Pilar do Sul",
  "Porangaba", "Porto Feliz", "Salto de Pirapora", "Santana de Parnaíba",
  "São Miguel Arcanjo", "São Roque", "Sarapuí", "Tapiraí", "Tatuí", "Tietê",
  "Torre de Pedra", "Votorantim", "Angatuba", "Bofete", "Botucatu", "Capão Bonito",
  "Guareí", "Pereiras", "Quadra", "Sorocaba",
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

interface ClienteDB {
  base: string;
  cli_codigo: string;
  cli_nome: string;
  cli_pessoa: string;
  cli_cnpj: string;
  cli_estado: string;
  mun_uf: string;
  mun_nome: string;
  cli_bairro: string;
  telefone: string;
  cli_email: string;
  eta_descricao: string;
}

function sqlClientesVarejoTelevendas(munCodigos: number[]) {
  return `
    SELECT
      c.cli_codigo, c.cli_nome, c.cli_pessoa, c.cli_cnpj, c.cli_estado, c.cli_bairro,
      COALESCE(c.cli_whatsapp, c.cli_fone, c.cli_celular, '0') AS telefone,
      c.cli_email, ea.eta_descricao, m.mun_nome, m.mun_uf
    FROM clientes c
    INNER JOIN representantes r ON r.rep_codigo = c.cli_rep_codigo
    LEFT JOIN entidades_atividades ea ON ea.eta_codigo = c.cli_eta_codigo
    LEFT JOIN municipios m ON m.mun_codigo = c.cli_mun_codigo
    WHERE c.cli_mun_codigo IN (${munCodigos.join(",")})
      AND c.cli_eta_codigo IN (1,2,3)
      AND c.cli_cliente = '1'
      AND r.rep_rvs_codigo IN (1,16)
      AND r.rep_nome NOT LIKE '*%'
  `;
}

async function main() {
  console.log("=== Clientes Varejo + Televendas INATIVOS (4 meses) — SJC+MG — Região de Sorocaba ===\n");

  const cidadesAlvoNorm = new Set(CIDADES_ALVO.map(normCidade));
  const clientesPorBase: Record<string, ClienteDB[]> = { SJC: [], MG: [] };

  for (const base of BASES) {
    console.log(`Consultando base ${base.nome}...`);
    const municipiosRows = await queryFirebird<any>(base.lojaKey, `SELECT mun_codigo, mun_nome FROM municipios`);
    const munCodigosAlvo = municipiosRows
      .filter((m: any) => cidadesAlvoNorm.has(normCidade(m.MUN_NOME)))
      .map((m: any) => m.MUN_CODIGO);
    console.log(`  Municípios-alvo encontrados no cadastro: ${munCodigosAlvo.length}`);

    if (munCodigosAlvo.length === 0) continue;

    const rows = await queryFirebird<any>(base.lojaKey, sqlClientesVarejoTelevendas(munCodigosAlvo));
    console.log(`  Clientes Varejo+Televendas na região: ${rows.length}`);

    for (const r of rows) {
      clientesPorBase[base.nome].push({
        base: base.nome,
        cli_codigo: r.CLI_CODIGO?.toString().trim() || "",
        cli_nome: r.CLI_NOME?.toString().trim() || "",
        cli_pessoa: r.CLI_PESSOA?.toString().trim() || "",
        cli_cnpj: r.CLI_CNPJ?.toString().trim() || "",
        cli_estado: r.CLI_ESTADO?.toString().trim() || "",
        mun_uf: r.MUN_UF?.toString().trim() || "",
        mun_nome: r.MUN_NOME?.toString().trim() || "",
        cli_bairro: r.CLI_BAIRRO?.toString().trim() || "",
        telefone: r.TELEFONE?.toString().trim() || "0",
        cli_email: r.CLI_EMAIL?.toString().trim() || "",
        eta_descricao: r.ETA_DESCRICAO?.toString().trim() || "",
      });
    }
  }

  // União por cli_codigo (cliente entra se bateu o critério em qualquer uma das bases)
  const porCodigo = new Map<string, ClienteDB[]>();
  for (const base of ["SJC", "MG"]) {
    for (const c of clientesPorBase[base]) {
      if (!porCodigo.has(c.cli_codigo)) porCodigo.set(c.cli_codigo, []);
      porCodigo.get(c.cli_codigo)!.push(c);
    }
  }
  const codigos = Array.from(porCodigo.keys());
  console.log(`\nTotal de clientes únicos (Varejo+Televendas, região-alvo, SJC ∪ MG): ${codigos.length}`);

  // ── Última compra + status de atividade (SJC+MG somadas) ──
  interface UltimaCompra { ultimaData: Date | null; valorUltimaData: number; ativoRecente: boolean; }
  const ultimaCompra = new Map<string, UltimaCompra>();
  for (const c of codigos) ultimaCompra.set(c, { ultimaData: null, valorUltimaData: 0, ativoRecente: false });

  const LOTE = 500;
  for (let i = 0; i < codigos.length; i += LOTE) {
    const lote = codigos.slice(i, i + LOTE);
    for (const base of BASES) {
      const rows = await queryFirebird<any>(
        base.lojaKey,
        `
          SELECT p.pdv_cli_codigo AS cli_codigo, MAX(p.pdv_data) AS ultima_data,
            CASE WHEN EXISTS (
              SELECT 1 FROM pedidos_vendas p2
              WHERE p2.pdv_cli_codigo = p.pdv_cli_codigo
                AND p2.pdv_data >= DATEADD(MONTH, -${MESES_INATIVIDADE}, CURRENT_DATE)
                AND p2.pdv_psi_codigo NOT IN ('CC')
                AND p2.pdv_tve_codigo NOT IN ('6','7','26','34')
            ) THEN 1 ELSE 0 END AS ativo_recente
          FROM pedidos_vendas p
          WHERE p.pdv_cli_codigo IN (${lote.join(",")})
            AND p.pdv_psi_codigo NOT IN ('CC')
            AND p.pdv_tve_codigo NOT IN ('6','7','26','34')
          GROUP BY p.pdv_cli_codigo
        `
      );
      for (const r of rows) {
        const codigo = r.CLI_CODIGO?.toString().trim();
        const info = codigo ? ultimaCompra.get(codigo) : undefined;
        if (!info) continue;
        const data = r.ULTIMA_DATA ? new Date(r.ULTIMA_DATA) : null;
        if (data && (!info.ultimaData || data > info.ultimaData)) info.ultimaData = data;
        if (Number(r.ATIVO_RECENTE) === 1) info.ativoRecente = true;
      }
    }
  }

  for (let i = 0; i < codigos.length; i += LOTE) {
    const lote = codigos.slice(i, i + LOTE).filter((c) => ultimaCompra.get(c)?.ultimaData);
    if (lote.length === 0) continue;
    for (const base of BASES) {
      const rows = await queryFirebird<any>(
        base.lojaKey,
        `
          SELECT i.pvi_numero AS numero, p.pdv_cli_codigo AS cli_codigo, p.pdv_data AS data,
            SUM(i.pvi_totalitem + i.pvi_substicms + i.pvi_vl_fcp_st + i.pvi_ipivalor) AS valor
          FROM pedidos_vendas_itens i
          INNER JOIN pedidos_vendas p ON p.pdv_numero = i.pvi_numero
          WHERE p.pdv_cli_codigo IN (${lote.join(",")})
            AND p.pdv_psi_codigo NOT IN ('CC')
            AND p.pdv_tve_codigo NOT IN ('6','7','26','34')
          GROUP BY i.pvi_numero, p.pdv_cli_codigo, p.pdv_data
        `
      );
      for (const r of rows) {
        const codigo = r.CLI_CODIGO?.toString().trim();
        const info = codigo ? ultimaCompra.get(codigo) : undefined;
        if (!info || !info.ultimaData) continue;
        const data = new Date(r.DATA);
        if (data.getTime() === info.ultimaData.getTime()) {
          info.valorUltimaData += Number(r.VALOR) || 0;
        }
      }
    }
  }

  // ── Filtra só os INATIVOS e monta a saída ──
  function escolhe(...vals: (string | undefined)[]): string {
    return vals.find((v) => v && v.trim()) || "";
  }

  const linhasSaida: any[] = [];
  for (const codigo of codigos) {
    const info = ultimaCompra.get(codigo)!;
    if (info.ativoRecente) continue; // só inativos

    const candidatos = porCodigo.get(codigo)!;
    const sjcRec = candidatos.find((c) => c.base === "SJC");
    const mgRec = candidatos.find((c) => c.base === "MG");
    const pref = sjcRec || mgRec!;
    const pessoa = pref.cli_pessoa.toUpperCase();

    linhasSaida.push({
      "Código do Cliente": codigo,
      "Nome do Cliente": pref.cli_nome,
      "CNPJ/CPF": escolhe(sjcRec?.cli_cnpj, mgRec?.cli_cnpj),
      "UF": escolhe(sjcRec?.cli_estado, mgRec?.cli_estado, sjcRec?.mun_uf, mgRec?.mun_uf),
      "Cidade": escolhe(sjcRec?.mun_nome, mgRec?.mun_nome),
      "Bairro": escolhe(sjcRec?.cli_bairro, mgRec?.cli_bairro),
      "Telefone": escolhe(sjcRec?.telefone, mgRec?.telefone) || "0",
      "Email": escolhe(sjcRec?.cli_email, mgRec?.cli_email),
      "Situação": "Inativo",
      "Data Última Compra (SJC+MG)": info.ultimaData ? info.ultimaData.toLocaleDateString("pt-BR") : "",
      "Valor Última Compra (R$)": info.ultimaData ? Math.round(info.valorUltimaData * 100) / 100 : "",
      "CNAE / Ramo de Atividade": pessoa === "F" ? escolhe(sjcRec?.eta_descricao, mgRec?.eta_descricao) : "",
      "CNAE oficial disponível?": pessoa === "J" ? "Não (base não tem CNAE da Receita cadastrado)" : "",
      "Lojas com cadastro": Array.from(new Set(candidatos.map((c) => c.base))).join(" + "),
    });
  }

  console.log(`\nTotal de clientes INATIVOS no resultado final: ${linhasSaida.length}`);

  linhasSaida.sort((a, b) => a["Cidade"].localeCompare(b["Cidade"]) || a["Nome do Cliente"].localeCompare(b["Nome do Cliente"]));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(linhasSaida);
  XLSX.utils.book_append_sheet(wb, ws, "Clientes Inativos");

  const outPath = path.join(os.homedir(), "Desktop", "Clientes_Inativos_Varejo_Televendas_Regiao_Sorocaba_SJC_MG.xlsx");
  XLSX.writeFile(wb, outPath);

  console.log(`\nRelatório salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
