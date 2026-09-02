import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import { querySqlServer } from "../db/sqlserver";

// ⚠️ Confira o número de área da tabela (ver database/2026-09-02_notas_fiscais_amazon.sql)
const TABELA_NOTAS = "dbo.[TI-FISCAL_900-NotasFiscaisAmazon]";
const TABELA_ITENS = "dbo.[TI-FISCAL_900-NotasFiscaisAmazonItens]";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

const asArray = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

export interface NotaFiscalItem {
  numeroItem: number | null;
  codigoProduto: string | null;
  descricao: string | null;
  ncm: string | null;
  cfop: string | null;
  quantidade: number | null;
  valorUnitario: number | null;
  valorTotal: number | null;
  valorIcms: number | null;
  valorIcmsSt: number | null;
  valorFcp: number | null;
  valorIpi: number | null;
  valorPis: number | null;
  valorCofins: number | null;
}

export interface NotaFiscalParseada {
  chaveAcesso: string;
  numeroPedidoAmazon: string | null;
  numero: string | null;
  serie: string | null;
  dataEmissao: string | null;
  valorTotal: number | null;
  cnpjEmitente: string | null;
  cnpjDestinatario: string | null;
  nomeDestinatario: string | null;
  ufDestino: string | null;
  itens: NotaFiscalItem[];
}

export interface EventoCancelamento {
  chaveAcesso: string;
  tipoEvento: string;
}

type ArquivoParseado =
  | { tipo: "nota"; nota: NotaFiscalParseada }
  | { tipo: "cancelamento"; evento: EventoCancelamento }
  | { tipo: "erro"; arquivo: string; motivo: string };

const numOrNull = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const strOrNull = (v: unknown): string | null => {
  if (v === undefined || v === null || v === "") return null;
  return String(v);
};

/** Extrai os dados de uma NF-e (nfeProc ou NFe solto) já convertida em objeto pelo fast-xml-parser */
function parseNfe(raiz: any): NotaFiscalParseada {
  const nfe = raiz.nfeProc?.NFe ?? raiz.NFe;
  const infNFe = nfe.infNFe;
  const chaveAcesso = String(infNFe["@_Id"] ?? "").replace(/^NFe/, "");

  const ide = infNFe.ide ?? {};
  const emit = infNFe.emit ?? {};
  const dest = infNFe.dest ?? {};
  const total = infNFe.total?.ICMSTot ?? {};

  const dets = asArray(infNFe.det);

  // xPed = "Número do Pedido de Compra" — campo padrão do layout NF-e (grupo I01),
  // usado por marketplaces para referenciar o pedido de origem. Confirmar contra
  // uma nota real da Amazon antes de confiar 100% neste campo.
  const numeroPedidoAmazon =
    dets.map((d) => strOrNull(d?.prod?.xPed)).find((v) => v != null) ?? null;

  const itens: NotaFiscalItem[] = dets.map((d) => {
    const prod = d?.prod ?? {};
    const imposto = d?.imposto ?? {};
    const icms = imposto.ICMS ? Object.values(imposto.ICMS)[0] as any : {};
    const ipi = imposto.IPI?.IPITrib ?? {};
    const pis = imposto.PIS?.PISAliq ?? imposto.PIS?.PISNT ?? imposto.PIS?.PISOutr ?? {};
    const cofins = imposto.COFINS?.COFINSAliq ?? imposto.COFINS?.COFINSNT ?? imposto.COFINS?.COFINSOutr ?? {};

    return {
      numeroItem: numOrNull(d?.["@_nItem"]),
      codigoProduto: strOrNull(prod.cProd),
      descricao: strOrNull(prod.xProd),
      ncm: strOrNull(prod.NCM),
      cfop: strOrNull(prod.CFOP),
      quantidade: numOrNull(prod.qCom),
      valorUnitario: numOrNull(prod.vUnCom),
      valorTotal: numOrNull(prod.vProd),
      valorIcms: numOrNull(icms?.vICMS),
      valorIcmsSt: numOrNull(icms?.vICMSST),
      valorFcp: numOrNull(icms?.vFCP),
      valorIpi: numOrNull(ipi?.vIPI),
      valorPis: numOrNull(pis?.vPIS),
      valorCofins: numOrNull(cofins?.vCOFINS),
    };
  });

  return {
    chaveAcesso,
    numeroPedidoAmazon,
    numero: strOrNull(ide.nNF),
    serie: strOrNull(ide.serie),
    dataEmissao: strOrNull(ide.dhEmi ?? ide.dEmi),
    valorTotal: numOrNull(total.vNF),
    cnpjEmitente: strOrNull(emit.CNPJ),
    cnpjDestinatario: strOrNull(dest.CNPJ ?? dest.CPF),
    nomeDestinatario: strOrNull(dest.xNome),
    ufDestino: strOrNull(dest.enderDest?.UF),
    itens,
  };
}

/** Extrai chave + tipo de um evento de cancelamento (procEventoNFe) */
function parseEvento(raiz: any): EventoCancelamento {
  const infEvento = raiz.procEventoNFe?.evento?.infEvento ?? raiz.evento?.infEvento;
  return {
    chaveAcesso: String(infEvento.chNFe ?? ""),
    tipoEvento: String(infEvento.tpEvento ?? ""),
  };
}

function parseArquivoXml(nomeArquivo: string, conteudo: string): ArquivoParseado {
  try {
    const raiz = parser.parse(conteudo);
    if (raiz.procEventoNFe || raiz.evento) {
      return { tipo: "cancelamento", evento: parseEvento(raiz) };
    }
    if (raiz.nfeProc || raiz.NFe) {
      const nota = parseNfe(raiz);
      if (!nota.chaveAcesso || nota.chaveAcesso.length !== 44) {
        return { tipo: "erro", arquivo: nomeArquivo, motivo: "Chave de acesso ausente ou inválida no XML." };
      }
      return { tipo: "nota", nota };
    }
    return { tipo: "erro", arquivo: nomeArquivo, motivo: "XML não reconhecido (esperado NFe, nfeProc ou procEventoNFe)." };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { tipo: "erro", arquivo: nomeArquivo, motivo: `Falha ao ler XML: ${msg}` };
  }
}

export interface ResultadoImportacao {
  totalArquivosXml: number;
  notasNovas: number;
  notasDuplicadas: number;
  cancelamentosAplicados: number;
  erros: { arquivo: string; motivo: string }[];
}

/** Lê o .zip do Faturador Amazon, faz parse de cada XML e grava no banco evitando duplicidade por ChaveAcesso */
export async function importarZipNotasFiscais(
  zipBuffer: Buffer,
  contexto: { arquivoOrigemZip: string; importadoPor: string | null }
): Promise<ResultadoImportacao> {
  const zip = new AdmZip(zipBuffer);
  const entradasXml = zip.getEntries().filter((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith(".xml"));

  const resultado: ResultadoImportacao = {
    totalArquivosXml: entradasXml.length,
    notasNovas: 0,
    notasDuplicadas: 0,
    cancelamentosAplicados: 0,
    erros: [],
  };

  if (entradasXml.length === 0) {
    resultado.erros.push({ arquivo: contexto.arquivoOrigemZip, motivo: "Nenhum arquivo .xml encontrado dentro do ZIP." });
    return resultado;
  }

  for (const entrada of entradasXml) {
    const conteudo = entrada.getData().toString("utf-8");
    const parseado = parseArquivoXml(entrada.entryName, conteudo);

    if (parseado.tipo === "erro") {
      resultado.erros.push({ arquivo: parseado.arquivo, motivo: parseado.motivo });
      continue;
    }

    if (parseado.tipo === "cancelamento") {
      const isCancelamento = parseado.evento.tipoEvento === "110111";
      if (!isCancelamento || !parseado.evento.chaveAcesso) continue;
      const rows = await querySqlServer<{ n: number }>(
        `UPDATE ${TABELA_NOTAS} SET Situacao = 'CANCELADA' OUTPUT 1 AS n WHERE ChaveAcesso = @chave`,
        { chave: parseado.evento.chaveAcesso }
      );
      if (rows.length > 0) resultado.cancelamentosAplicados++;
      continue;
    }

    const nota = parseado.nota;
    const existente = await querySqlServer<{ ChaveAcesso: string }>(
      `SELECT ChaveAcesso FROM ${TABELA_NOTAS} WHERE ChaveAcesso = @chave`,
      { chave: nota.chaveAcesso }
    );
    if (existente.length > 0) {
      resultado.notasDuplicadas++;
      continue;
    }

    await querySqlServer(
      `INSERT INTO ${TABELA_NOTAS}
        (ChaveAcesso, NumeroPedidoAmazon, Numero, Serie, DataEmissao, ValorTotal,
         CnpjEmitente, CnpjDestinatario, NomeDestinatario, UfDestino, XmlConteudo, ArquivoOrigemZip, ImportadoPor)
       VALUES
        (@chaveAcesso, @numeroPedidoAmazon, @numero, @serie, @dataEmissao, @valorTotal,
         @cnpjEmitente, @cnpjDestinatario, @nomeDestinatario, @ufDestino, @xmlConteudo, @arquivoOrigemZip, @importadoPor)`,
      {
        chaveAcesso: nota.chaveAcesso,
        numeroPedidoAmazon: nota.numeroPedidoAmazon,
        numero: nota.numero,
        serie: nota.serie,
        dataEmissao: nota.dataEmissao,
        valorTotal: nota.valorTotal,
        cnpjEmitente: nota.cnpjEmitente,
        cnpjDestinatario: nota.cnpjDestinatario,
        nomeDestinatario: nota.nomeDestinatario,
        ufDestino: nota.ufDestino,
        xmlConteudo: conteudo,
        arquivoOrigemZip: contexto.arquivoOrigemZip,
        importadoPor: contexto.importadoPor,
      }
    );

    for (const item of nota.itens) {
      await querySqlServer(
        `INSERT INTO ${TABELA_ITENS}
          (ChaveAcesso, NumeroItem, CodigoProduto, Descricao, Ncm, Cfop, Quantidade, ValorUnitario, ValorTotal,
           ValorIcms, ValorIcmsSt, ValorFcp, ValorIpi, ValorPis, ValorCofins)
         VALUES
          (@chaveAcesso, @numeroItem, @codigoProduto, @descricao, @ncm, @cfop, @quantidade, @valorUnitario, @valorTotal,
           @valorIcms, @valorIcmsSt, @valorFcp, @valorIpi, @valorPis, @valorCofins)`,
        { chaveAcesso: nota.chaveAcesso, ...item }
      );
    }

    resultado.notasNovas++;
  }

  return resultado;
}

export interface NotaFiscalListItem {
  ChaveAcesso: string;
  NumeroPedidoAmazon: string | null;
  Numero: string | null;
  Serie: string | null;
  DataEmissao: string | null;
  ValorTotal: number | null;
  Situacao: string;
  DataImportacao: string;
}

export async function listarNotasFiscais(params: { busca?: string; pagina: number; limite: number }): Promise<{ dados: NotaFiscalListItem[]; total: number }> {
  const { busca, pagina, limite } = params;
  const offset = (pagina - 1) * limite;
  const filtro = busca
    ? `WHERE ChaveAcesso LIKE @busca OR NumeroPedidoAmazon LIKE @busca OR Numero LIKE @busca`
    : "";
  const buscaParam = busca ? `%${busca}%` : undefined;

  const dados = await querySqlServer<NotaFiscalListItem>(
    `SELECT ChaveAcesso, NumeroPedidoAmazon, Numero, Serie, DataEmissao, ValorTotal, Situacao, DataImportacao
     FROM ${TABELA_NOTAS}
     ${filtro}
     ORDER BY DataImportacao DESC
     OFFSET @offset ROWS FETCH NEXT @limite ROWS ONLY`,
    { busca: buscaParam, offset, limite }
  );

  const totalRows = await querySqlServer<{ total: number }>(
    `SELECT COUNT(*) AS total FROM ${TABELA_NOTAS} ${filtro}`,
    { busca: buscaParam }
  );

  return { dados, total: totalRows[0]?.total ?? 0 };
}
