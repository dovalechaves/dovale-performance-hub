/**
 * Adiciona 2 colunas na aba "Detalhado - queda" do arquivo TelevendasChaves.xlsx
 * (que já está no Desktop, editado à mão pelo Willian — não regenera o arquivo do
 * zero, só acrescenta essas 2 colunas na aba de detalhes, sem tocar em mais nada):
 *
 *   "Última Compra nessa Faixa": a última vez (mês/ano) que esse MESMO cliente
 *   voltou a comprar dentro da MESMA faixa (ex.: 5000+) — pode ser um mês bem depois
 *   da "queda", se ele voltou a bater nessa faixa de novo; se nunca mais bateu nessa
 *   faixa, o valor é igual ao próprio "Comprou em" da linha.
 *
 *   "Quantidade (última compra nessa faixa)": a quantidade de chaves compradas
 *   nesse mês.
 *
 * Usa as linhas já existentes na aba (Código Cliente + Faixa) como referência, pra
 * garantir que a ordem/linhas batem exatamente com o que já está no arquivo, mesmo
 * que ele tenha sido editado manualmente.
 *
 * Rodar: npx tsx scripts/adiciona-ultima-compra-faixa.ts
 */
import "dotenv/config";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const ARQUIVO = "C:/Users/willian.rubim/Desktop/TelevendasChaves.xlsx";
const ABA_DETALHE = "Detalhado - queda";

const BASES = [
  { lojaKey: "sjc" as const, nome: "SJC" },
  { lojaKey: "mg" as const, nome: "MG" },
];

function sqlChavesTelevendas() {
  return `
    select
      extract(year from ped.pdv_data) as ano,
      extract(month from ped.pdv_data) as mes,
      ped.pdv_cli_codigo as codigo,
      sum(i.pvi_quantidade) as qtde
    from pedidos_vendas ped
    inner join pedidos_vendas_itens i on i.pvi_numero = ped.pdv_numero
    inner join produtos p on p.pro_codigo = i.pvi_pro_codigo
    inner join produtos_nivel2 pn on pn.codigo = p.pro_nivel2
    inner join representantes r on r.rep_codigo = ped.pdv_rep_codigo
    inner join representantes_supervisores rs on rs.rvs_codigo = r.rep_rvs_codigo
    where pn.nome = 'CHAVE'
    and rs.rvs_nome in ('TELEVENDAS','TELEVENDAS MG')
    and ped.pdv_data >= date '2025-01-01'
    and ped.pdv_data < date '2027-01-01'
    and ped.pdv_psi_codigo not in ('CC')
    and ped.pdv_tve_codigo not in ('6','7','26','34')
    group by 1,2,3
  `;
}

function faixaDe(qtde: number): string {
  if (qtde >= 5000) return "5000+";
  if (qtde >= 2000) return "2000-4999";
  if (qtde >= 1000) return "1000-1999";
  if (qtde >= 500) return "500-999";
  return "1-499";
}

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
function labelPeriodo(ano: number, mes: number) {
  return `${MESES[mes - 1]}/${String(ano).slice(2)}`;
}

async function main() {
  console.log("=== Adicionando 'Última Compra nessa Faixa' na aba de detalhes ===\n");

  // 1) Recoleta os dados mês a mês por cliente (mesma consulta do relatório original)
  const porCliente = new Map<string, Map<string, number>>(); // codigo -> "ano-mes" -> qtde
  for (const base of BASES) {
    console.log(`Consultando ${base.nome}...`);
    const rows = await queryFirebird<any>(base.lojaKey, sqlChavesTelevendas());
    console.log(`  ${rows.length} linhas`);
    rows.forEach((r: any) => {
      const codigo = r.CODIGO?.toString().trim();
      const ano = Number(r.ANO);
      const mes = Number(r.MES);
      const qtde = Number(r.QTDE) || 0;
      if (!codigo) return;
      if (!porCliente.has(codigo)) porCliente.set(codigo, new Map());
      const mapaMeses = porCliente.get(codigo)!;
      const chave = `${ano}-${mes}`;
      mapaMeses.set(chave, (mapaMeses.get(chave) ?? 0) + qtde);
    });
  }

  // 2) Índice codigo|faixa -> lista de ocorrências ordenadas por data
  const indicePorFaixa = new Map<string, { ano: number; mes: number; qtde: number }[]>();
  for (const [codigo, meses] of porCliente) {
    for (const [chaveMes, qtde] of meses) {
      if (qtde <= 0) continue;
      const [ano, mes] = chaveMes.split("-").map(Number);
      const faixa = faixaDe(qtde);
      const chave = `${codigo}|${faixa}`;
      if (!indicePorFaixa.has(chave)) indicePorFaixa.set(chave, []);
      indicePorFaixa.get(chave)!.push({ ano, mes, qtde });
    }
  }
  for (const lista of indicePorFaixa.values()) lista.sort((a, b) => a.ano - b.ano || a.mes - b.mes);

  // 3) Lê o arquivo existente e localiza as colunas da aba de detalhe
  const wb = XLSX.readFile(ARQUIVO);
  const ws = wb.Sheets[ABA_DETALHE];
  if (!ws) throw new Error(`Aba "${ABA_DETALHE}" não encontrada`);

  const cabecalho: string[] = XLSX.utils.sheet_to_json(ws, { header: 1 })[0] as string[];
  const idxCodigo = cabecalho.indexOf("Código Cliente");
  const idxFaixa = cabecalho.indexOf("Faixa");
  const idxComprouEm = cabecalho.indexOf("Comprou em");
  if (idxCodigo === -1 || idxFaixa === -1 || idxComprouEm === -1) {
    throw new Error(`Colunas não encontradas na aba (Código Cliente=${idxCodigo}, Faixa=${idxFaixa}, Comprou em=${idxComprouEm})`);
  }
  // idxNovaData/idxNovaQtde já existem de uma rodada anterior deste script — reaproveita
  // as mesmas colunas em vez de criar duas novas toda vez que rodar de novo
  let idxNovaData = cabecalho.indexOf("Última Compra nessa Faixa");
  let idxNovaQtde = cabecalho.indexOf("Quantidade (última compra nessa faixa)");
  if (idxNovaData === -1) idxNovaData = cabecalho.length;
  if (idxNovaQtde === -1) idxNovaQtde = idxNovaData + 1;

  function parseLabel(label: string): { ano: number; mes: number } | null {
    const [nomeMes, yy] = (label || "").split("/");
    const mes = MESES.indexOf(nomeMes) + 1;
    if (!mes || !yy) return null;
    return { ano: 2000 + Number(yy), mes };
  }

  const range = XLSX.utils.decode_range(ws["!ref"]!);
  const totalLinhas = range.e.r;
  console.log(`\nLinhas de dados na aba "${ABA_DETALHE}": ${totalLinhas}`);

  // Cabeçalho das novas colunas
  ws[XLSX.utils.encode_cell({ r: 0, c: idxNovaData })] = { t: "s", v: "Última Compra nessa Faixa" };
  ws[XLSX.utils.encode_cell({ r: 0, c: idxNovaQtde })] = { t: "s", v: "Quantidade (última compra nessa faixa)" };

  let semCorrespondencia = 0;
  for (let r = 1; r <= totalLinhas; r++) {
    const codCell = ws[XLSX.utils.encode_cell({ r, c: idxCodigo })];
    const faixaCell = ws[XLSX.utils.encode_cell({ r, c: idxFaixa })];
    const comprouEmCell = ws[XLSX.utils.encode_cell({ r, c: idxComprouEm })];
    if (!codCell || !faixaCell || !comprouEmCell) continue;
    const codigo = codCell.v.toString().trim();
    const faixa = faixaCell.v.toString().trim();
    const comprouEm = parseLabel(comprouEmCell.v.toString().trim());

    const lista = indicePorFaixa.get(`${codigo}|${faixa}`);
    if (!lista || lista.length === 0 || !comprouEm) {
      semCorrespondencia++;
      continue;
    }
    const ultima = lista[lista.length - 1];
    const nuncaMaisComprou = ultima.ano === comprouEm.ano && ultima.mes === comprouEm.mes;

    if (nuncaMaisComprou) {
      ws[XLSX.utils.encode_cell({ r, c: idxNovaData })] = { t: "s", v: "Não comprou mais" };
      ws[XLSX.utils.encode_cell({ r, c: idxNovaQtde })] = { t: "s", v: "" };
    } else {
      ws[XLSX.utils.encode_cell({ r, c: idxNovaData })] = { t: "s", v: labelPeriodo(ultima.ano, ultima.mes) };
      ws[XLSX.utils.encode_cell({ r, c: idxNovaQtde })] = { t: "n", v: ultima.qtde };
    }
  }

  // Atualiza o range da planilha pra incluir as novas colunas
  range.e.c = Math.max(range.e.c, idxNovaQtde);
  ws["!ref"] = XLSX.utils.encode_range(range);

  if (semCorrespondencia > 0) console.log(`Aviso: ${semCorrespondencia} linhas sem correspondência no índice (não deveria acontecer)`);

  XLSX.writeFile(wb, ARQUIVO);
  console.log(`\nArquivo atualizado (mesmo caminho): ${ARQUIVO}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro:", err);
    process.exit(1);
  });
