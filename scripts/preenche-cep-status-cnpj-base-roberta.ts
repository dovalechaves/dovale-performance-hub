/**
 * Preenche, na planilha "Base_Roberta_707_para_TI_Status_Cadastral_CEP.xlsx", só as
 * duas colunas pedidas: CEP e Status Cadastral - Receita Federal — sem tocar em mais
 * nada (a aba tem DUAS colunas chamadas "CEP"; a que fica colada em "Status Cadastral -
 * Receita Federal" é a que a própria aba "Orientação TI - Cadastro" pede pra preencher
 * junto com o status, então é essa que preencho — a primeira "CEP", perto de UF/Cidade,
 * fica intocada). Escreve célula a célula por posição, não reconstrói a planilha, pra
 * não arriscar embaralhar as duas colunas de mesmo nome nem mexer nas outras abas.
 *
 * CEP: vem do cadastro (cli_cep) em SJC/MG, mesmo critério de fallback usado no
 * preenchimento de Bairro (prefere SJC quando os dois têm valores diferentes).
 *
 * Status Cadastral: consulta pública da Receita Federal via a API "Minha Receita"
 * (https://minhareceita.org — espelho aberto dos dados públicos do CNPJ, sem limite de
 * taxa perceptível, ao contrário da ReceitaWS gratuita que limitou em ~3 consultas/min
 * nos testes). Usa o CNPJ do cadastro (cli_cnpj), não o que aparece truncado no nome do
 * cliente na planilha. Mapeia direto para ATIVA | BAIXADA | INAPTA | SUSPENSA | NULA
 * (mesmo vocabulário oficial da Receita). Cai em "REVISAR" quando: é CPF (pessoa física,
 * não tem situação cadastral de CNPJ), não tem documento no cadastro, ou a consulta falhou.
 *
 * Rodar: npx tsx scripts/preenche-cep-status-cnpj-base-roberta.ts
 */
import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const ARQUIVO_ENTRADA = "C:/Users/willian.rubim/Documents/Base_Roberta_707_para_TI_Status_Cadastral_CEP.xlsx";
const ABA_DADOS = "Base Mestra Roberta 707";

function colLetra(idx0: number): string {
  return XLSX.utils.encode_col(idx0);
}

async function buscarCadastro(loja: "sjc" | "mg", codigos: string[]): Promise<Map<string, { cep: string; cnpj: string }>> {
  const lista = codigos.map((c) => `'${c}'`).join(",");
  const rows = await queryFirebird<any>(loja, `select cli_codigo, cli_cep, cli_cnpj from clientes where cli_codigo in (${lista})`);
  const mapa = new Map<string, { cep: string; cnpj: string }>();
  rows.forEach((r: any) => {
    const codigo = r.CLI_CODIGO?.toString().trim();
    if (!codigo) return;
    mapa.set(codigo, {
      cep: (r.CLI_CEP ?? "").toString().trim(),
      cnpj: (r.CLI_CNPJ ?? "").toString().replace(/\D/g, ""),
    });
  });
  return mapa;
}

async function consultarSituacao(cnpj: string): Promise<string> {
  try {
    const r = await fetch(`https://minhareceita.org/${cnpj}`);
    if (!r.ok) return "REVISAR";
    const data: any = await r.json();
    const situacao = (data.descricao_situacao_cadastral ?? "").toString().trim().toUpperCase();
    if (["ATIVA", "BAIXADA", "INAPTA", "SUSPENSA", "NULA"].includes(situacao)) return situacao;
    return "REVISAR";
  } catch {
    return "REVISAR";
  }
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function main() {
  console.log("=== Preenchendo CEP e Status Cadastral (Receita Federal) — Base Roberta 707 ===\n");

  const wb = XLSX.readFile(ARQUIVO_ENTRADA);
  const ws = wb.Sheets[ABA_DADOS];
  const cabecalho: string[] = XLSX.utils.sheet_to_json(ws, { header: 1 })[0] as string[];

  const idxCodigo = cabecalho.indexOf("Código do Cliente");
  const idxStatus = cabecalho.indexOf("Status Cadastral - Receita Federal");
  const idxCep = cabecalho.indexOf("CEP", idxStatus); // a 2ª ocorrência de "CEP", depois do Status
  if (idxCodigo === -1 || idxStatus === -1 || idxCep === -1) {
    throw new Error(`Colunas não encontradas: codigo=${idxCodigo} status=${idxStatus} cep=${idxCep}`);
  }
  console.log(`Coluna Código do Cliente: ${colLetra(idxCodigo)} | Status Cadastral: ${colLetra(idxStatus)} | CEP (a preencher): ${colLetra(idxCep)}`);

  const range = XLSX.utils.decode_range(ws["!ref"]!);
  const totalLinhas = range.e.r; // linha 0 é cabeçalho
  console.log(`Linhas de dados: ${totalLinhas}`);

  const codigos: string[] = [];
  for (let r = 1; r <= totalLinhas; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: idxCodigo })];
    if (cell && cell.v !== undefined && cell.v !== null) codigos.push(cell.v.toString().trim());
  }

  const [sjc, mg] = await Promise.all([buscarCadastro("sjc", codigos), buscarCadastro("mg", codigos)]);

  let cepPreenchido = 0;
  let statusConsultado = 0;
  let statusRevisar = 0;
  let conflitosCep = 0;

  for (let r = 1; r <= totalLinhas; r++) {
    const codCell = ws[XLSX.utils.encode_cell({ r, c: idxCodigo })];
    if (!codCell || codCell.v === undefined || codCell.v === null) continue;
    const codigo = codCell.v.toString().trim();

    const dSjc = sjc.get(codigo);
    const dMg = mg.get(codigo);

    // CEP: prefere SJC quando os dois têm valor e divergem (mesmo critério do Bairro)
    let cep = "";
    if (dSjc?.cep && dMg?.cep) {
      if (dSjc.cep !== dMg.cep) conflitosCep++;
      cep = dSjc.cep;
    } else {
      cep = dSjc?.cep || dMg?.cep || "";
    }
    if (cep) {
      ws[XLSX.utils.encode_cell({ r, c: idxCep })] = { t: "s", v: cep };
      cepPreenchido++;
    }

    // CNPJ: prefere o valor da SJC, cai pro da MG
    let doc = dSjc?.cnpj || dMg?.cnpj || "";
    if (doc.length === 13) doc = "0" + doc; // alguns vieram sem o zero à esquerda

    let status: string;
    if (doc.length === 14) {
      status = await consultarSituacao(doc);
      statusConsultado++;
      if (status === "REVISAR") statusRevisar++;
      await sleep(150);
    } else {
      status = "REVISAR"; // CPF (pessoa física) ou sem documento no cadastro
      statusRevisar++;
    }
    ws[XLSX.utils.encode_cell({ r, c: idxStatus })] = { t: "s", v: status };

    if (r % 50 === 0) console.log(`  ... ${r}/${totalLinhas} processados`);
  }

  console.log(`\nCEP preenchido: ${cepPreenchido}/${totalLinhas}`);
  console.log(`Conflitos de CEP entre SJC e MG (usei o da SJC): ${conflitosCep}`);
  console.log(`CNPJs consultados na Receita: ${statusConsultado}`);
  console.log(`Caíram em REVISAR: ${statusRevisar}`);

  const outPath = path.join(os.homedir(), "Desktop", "Base_Roberta_707_com_CEP_e_Status_Cadastral.xlsx");
  XLSX.writeFile(wb, outPath);
  console.log(`\nArquivo salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro:", err);
    process.exit(1);
  });
