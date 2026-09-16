/**
 * Preenche as colunas vazias de "Clientes_Sorocaba_Unificado.xlsx" cruzando com o
 * cadastro em SJC + MG (tratadas como uma única base, conforme pedido).
 *
 * Estratégia de busca do cliente:
 *  1) Se a linha já tem "Código Cliente" preenchido, usa ele direto (validado numa
 *     amostra: os códigos já preenchidos batem 100% com o nome da Razão social em
 *     SJC e MG) — evita risco de fuzzy-match desnecessário quando já se tem a chave certa.
 *  2) Se não tem código, busca por Razão social (nome normalizado: maiúsculas, sem
 *     acento, sem pontuação) casado com a Cidade da linha (também normalizada, via
 *     cli_mun_codigo -> municipios.mun_nome) — exige nome + cidade batendo para evitar
 *     falso-positivo com nome comum em cidade errada. Sem essa dupla confirmação, o
 *     cliente fica marcado como "Não encontrado" (não adivinha).
 *
 * Situação/Status (SJC+MG) = Ativo se teve alguma venda válida nos últimos 4 meses em
 * SJC OU MG, senão Inativo — confirmado por Willian (mesmo critério já usado no
 * relatório de prospecção da região de Sorocaba).
 *
 * "Segmento (CNAE)" = cli_eta_codigo -> entidades_atividades.eta_descricao (proxy
 * interno do Dovale para "tipo de negócio"; não é o CNAE oficial da Receita Federal —
 * essa base não tem CNAE oficial preenchido, gap já mapeado no projeto).
 *
 * Não mexe na estrutura da planilha (mesmas colunas/ordem/aba) — só preenche os campos.
 *
 * Rodar: npx tsx scripts/preenche-clientes-sorocaba-unificado.ts
 */

import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const ARQUIVO_ENTRADA =
  "C:/Users/willian.rubim/AppData/Local/Packages/5319275A.WhatsAppDesktop_cv1g1gvanyjgm/LocalState/sessions/7BF921060C2F3260C9019FB92A3677AA6C6A5345/transfers/2026-37/Clientes_Sorocaba_Unificado.xlsx";
const ABA = "Clientes Unificado";
const MESES_INATIVIDADE = 4;

const BASES = [
  { lojaKey: "sjc" as const, nome: "SJC" },
  { lojaKey: "mg" as const, nome: "MG" },
];

function normNome(s: unknown): string {
  return (s?.toString() || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normCidade(s: unknown): string {
  return normNome(s);
}

function soCodigo(v: unknown): string {
  const s = (v?.toString() || "").trim();
  if (!s) return "";
  const n = Number(s);
  if (Number.isFinite(n)) return String(Math.trunc(n));
  return s;
}

interface ClienteDB {
  base: string;
  cli_codigo: string;
  cli_nome: string;
  cli_cnpj: string;
  cli_estado: string;
  mun_uf: string;
  cli_bairro: string;
  cli_fone: string;
  cli_celular: string;
  cli_whatsapp: string;
  cli_email: string;
  cli_eta_codigo: string;
  eta_descricao: string;
  mun_nome: string;
}

async function main() {
  console.log("=== Preenchendo Clientes_Sorocaba_Unificado.xlsx — SJC+MG como base única ===\n");

  const wb = XLSX.readFile(ARQUIVO_ENTRADA);
  const ws = wb.Sheets[ABA];
  const linhas: any[] = XLSX.utils.sheet_to_json(ws, { defval: null });
  console.log(`Linhas na planilha: ${linhas.length}`);

  const comCodigo = linhas.filter((l) => soCodigo(l["Código Cliente"]));
  const semCodigo = linhas.filter((l) => !soCodigo(l["Código Cliente"]));
  console.log(`Com Código Cliente: ${comCodigo.length} | Sem código (busca por nome+cidade): ${semCodigo.length}`);

  // ── 1) Clientes já com código: query direta pelo código em ambas as bases ──
  const codigosDiretos = Array.from(new Set(comCodigo.map((l) => soCodigo(l["Código Cliente"]))));

  // ── 2) Clientes sem código: restringe a busca às cidades presentes na planilha,
  //      pra não puxar a base inteira ──
  const cidadesSheet = Array.from(new Set(semCodigo.map((l) => normCidade(l["Cidade"])))).filter(Boolean);

  const clientesPorBase: Record<string, ClienteDB[]> = { SJC: [], MG: [] };

  function sqlBase(where: string) {
    return `
      SELECT
        c.cli_codigo, c.cli_nome, c.cli_cnpj, c.cli_estado, c.cli_bairro,
        c.cli_fone, c.cli_celular, c.cli_whatsapp, c.cli_email, c.cli_eta_codigo,
        ea.eta_descricao, m.mun_nome, m.mun_uf
      FROM clientes c
      LEFT JOIN entidades_atividades ea ON ea.eta_codigo = c.cli_eta_codigo
      LEFT JOIN municipios m ON m.mun_codigo = c.cli_mun_codigo
      WHERE ${where}
    `;
  }

  for (const base of BASES) {
    console.log(`\nConsultando base ${base.nome}...`);

    if (codigosDiretos.length > 0) {
      const rows = await queryFirebird<any>(
        base.lojaKey,
        sqlBase(`c.cli_codigo IN (${codigosDiretos.join(",")})`)
      );
      console.log(`  Por código: ${rows.length} encontrados`);
      for (const r of rows) {
        clientesPorBase[base.nome].push(mapRow(base.nome, r));
      }
    }

    if (cidadesSheet.length > 0) {
      // Descobre os mun_codigo cujas cidades (normalizadas) batem com a planilha
      const municipiosRows = await queryFirebird<any>(base.lojaKey, `SELECT mun_codigo, mun_nome FROM municipios`);
      const munCodigosAlvo = municipiosRows
        .filter((m: any) => cidadesSheet.includes(normCidade(m.MUN_NOME)))
        .map((m: any) => m.MUN_CODIGO);

      if (munCodigosAlvo.length > 0) {
        const rows = await queryFirebird<any>(
          base.lojaKey,
          sqlBase(`c.cli_mun_codigo IN (${munCodigosAlvo.join(",")})`)
        );
        console.log(`  Por cidade (candidatos p/ nome+cidade): ${rows.length} clientes na região`);
        for (const r of rows) {
          clientesPorBase[base.nome].push(mapRow(base.nome, r));
        }
      }
    }
  }

  function mapRow(base: string, r: any): ClienteDB {
    return {
      base,
      cli_codigo: r.CLI_CODIGO?.toString().trim() || "",
      cli_nome: r.CLI_NOME?.toString().trim() || "",
      cli_cnpj: r.CLI_CNPJ?.toString().trim() || "",
      cli_estado: r.CLI_ESTADO?.toString().trim() || "",
      mun_uf: r.MUN_UF?.toString().trim() || "",
      cli_bairro: r.CLI_BAIRRO?.toString().trim() || "",
      cli_fone: r.CLI_FONE?.toString().trim() || "",
      cli_celular: r.CLI_CELULAR?.toString().trim() || "",
      cli_whatsapp: r.CLI_WHATSAPP?.toString().trim() || "",
      cli_email: r.CLI_EMAIL?.toString().trim() || "",
      cli_eta_codigo: r.CLI_ETA_CODIGO?.toString().trim() || "",
      eta_descricao: r.ETA_DESCRICAO?.toString().trim() || "",
      mun_nome: r.MUN_NOME?.toString().trim() || "",
    };
  }

  // Índice por código (para bucket 1) e por nome+cidade normalizados (para bucket 2)
  const porCodigo = new Map<string, ClienteDB[]>();
  const porNomeCidade = new Map<string, ClienteDB[]>();
  for (const base of ["SJC", "MG"]) {
    for (const c of clientesPorBase[base]) {
      if (!porCodigo.has(c.cli_codigo)) porCodigo.set(c.cli_codigo, []);
      porCodigo.get(c.cli_codigo)!.push(c);

      const chave = `${normNome(c.cli_nome)}|${normCidade(c.mun_nome)}`;
      if (!porNomeCidade.has(chave)) porNomeCidade.set(chave, []);
      porNomeCidade.get(chave)!.push(c);
    }
  }

  console.log(`\nTotal de clientes carregados (código): ${porCodigo.size} códigos distintos`);
  console.log(`Total de clientes carregados (nome+cidade): ${porNomeCidade.size} combinações distintas`);

  // ── Última compra + valor (para todos os códigos encontrados, SJC+MG somado) ──
  const todosCodigos = Array.from(porCodigo.keys());
  console.log(`\nBuscando última compra/valor para ${todosCodigos.length} códigos...`);

  interface UltimaCompra {
    ultimaData: Date | null;
    valorUltimaData: number;
    ativoRecente: boolean;
  }
  const ultimaCompraPorCodigo = new Map<string, UltimaCompra>();
  for (const codigo of todosCodigos) {
    ultimaCompraPorCodigo.set(codigo, { ultimaData: null, valorUltimaData: 0, ativoRecente: false });
  }

  const LOTE = 500;
  for (let i = 0; i < todosCodigos.length; i += LOTE) {
    const lote = todosCodigos.slice(i, i + LOTE);
    const listaSql = lote.join(",");
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
          WHERE p.pdv_cli_codigo IN (${listaSql})
            AND p.pdv_psi_codigo NOT IN ('CC')
            AND p.pdv_tve_codigo NOT IN ('6','7','26','34')
          GROUP BY p.pdv_cli_codigo
        `
      );
      for (const r of rows) {
        const codigo = r.CLI_CODIGO?.toString().trim();
        if (!codigo || !ultimaCompraPorCodigo.has(codigo)) continue;
        const info = ultimaCompraPorCodigo.get(codigo)!;
        const data = r.ULTIMA_DATA ? new Date(r.ULTIMA_DATA) : null;
        if (data && (!info.ultimaData || data > info.ultimaData)) info.ultimaData = data;
        if (Number(r.ATIVO_RECENTE) === 1) info.ativoRecente = true;
      }
    }
  }

  // Valor do dia da última compra (pode ter vindo de SJC ou MG, ou ambos)
  for (let i = 0; i < todosCodigos.length; i += LOTE) {
    const lote = todosCodigos.slice(i, i + LOTE).filter((c) => ultimaCompraPorCodigo.get(c)?.ultimaData);
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
        const info = codigo ? ultimaCompraPorCodigo.get(codigo) : undefined;
        if (!info || !info.ultimaData) continue;
        const data = new Date(r.DATA);
        if (data.getTime() === info.ultimaData.getTime()) {
          info.valorUltimaData += Number(r.VALOR) || 0;
        }
      }
    }
  }

  // ── Monta a saída ──
  let encontradosPorCodigo = 0;
  let encontradosPorNome = 0;
  let naoEncontrados = 0;

  function escolhe(...vals: (string | undefined)[]): string {
    return vals.find((v) => v && v.trim()) || "";
  }

  const linhasSaida = linhas.map((l) => {
    const codigoSheet = soCodigo(l["Código Cliente"]);
    let candidatos: ClienteDB[] = [];
    let encontradoPor = "";

    if (codigoSheet && porCodigo.has(codigoSheet)) {
      candidatos = porCodigo.get(codigoSheet)!;
      encontradoPor = "Código Cliente";
    } else {
      const chave = `${normNome(l["Razão social"])}|${normCidade(l["Cidade"])}`;
      if (porNomeCidade.has(chave)) {
        candidatos = porNomeCidade.get(chave)!;
        encontradoPor = "Nome + Cidade";
      }
    }

    if (candidatos.length === 0) {
      naoEncontrados++;
      return {
        ...l,
        "Código Cliente": l["Código Cliente"],
        "CNPJ": l["CNPJ"],
        "UF": l["UF"],
        "Bairro": l["Bairro"],
        "Telefone": l["Telefone"],
        "WhatsApp": l["WhatsApp"],
        "Email": l["Email"],
        "Na base": "Não",
        "Situação": "",
        "Encontrado por": "Não encontrado",
        "Lojas com cadastro": "",
        "Última compra": "",
        " Valor última compra ": "",
        "Segmento (CNAE)": "",
        "Última Compra ": "",
        "Status ": "",
      };
    }

    if (encontradoPor === "Código Cliente") encontradosPorCodigo++;
    else encontradosPorNome++;

    const lojas = Array.from(new Set(candidatos.map((c) => c.base)));
    const sjcRec = candidatos.find((c) => c.base === "SJC");
    const mgRec = candidatos.find((c) => c.base === "MG");
    const pref = sjcRec || mgRec!;

    const codigoFinal = pref.cli_codigo;
    const info = ultimaCompraPorCodigo.get(codigoFinal);
    const statusTxt = info?.ativoRecente ? "Ativo" : "Inativo";
    const ultimaCompraStr = info?.ultimaData ? info.ultimaData.toLocaleDateString("pt-BR") : "";
    const valorUltima = info?.ultimaData ? Math.round(info.valorUltimaData * 100) / 100 : "";

    return {
      ...l,
      "Código Cliente": codigoFinal,
      "CNPJ": escolhe(sjcRec?.cli_cnpj, mgRec?.cli_cnpj),
      "UF": escolhe(sjcRec?.cli_estado, mgRec?.cli_estado, sjcRec?.mun_uf, mgRec?.mun_uf),
      "Bairro": escolhe(sjcRec?.cli_bairro, mgRec?.cli_bairro),
      "Telefone": escolhe(sjcRec?.cli_fone, mgRec?.cli_fone, sjcRec?.cli_celular, mgRec?.cli_celular),
      "WhatsApp": escolhe(sjcRec?.cli_whatsapp, mgRec?.cli_whatsapp, sjcRec?.cli_celular, mgRec?.cli_celular),
      "Email": escolhe(sjcRec?.cli_email, mgRec?.cli_email),
      "Na base": "Sim",
      "Situação": statusTxt,
      "Encontrado por": encontradoPor,
      "Lojas com cadastro": lojas.join(" + "),
      "Última compra": ultimaCompraStr,
      " Valor última compra ": valorUltima,
      "Segmento (CNAE)": escolhe(sjcRec?.eta_descricao, mgRec?.eta_descricao),
      "Última Compra ": ultimaCompraStr,
      "Status ": statusTxt,
    };
  });

  console.log(`\nEncontrados por Código Cliente: ${encontradosPorCodigo}`);
  console.log(`Encontrados por Nome + Cidade: ${encontradosPorNome}`);
  console.log(`Não encontrados em SJC/MG: ${naoEncontrados}`);

  const colunas = Object.keys(linhas[0]);
  const wsNova = XLSX.utils.json_to_sheet(linhasSaida, { header: colunas });
  wb.Sheets[ABA] = wsNova;

  const outPath = path.join(os.homedir(), "Desktop", "Clientes_Sorocaba_Unificado_Preenchido.xlsx");
  XLSX.writeFile(wb, outPath);

  console.log(`\nArquivo salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro:", err);
    process.exit(1);
  });
