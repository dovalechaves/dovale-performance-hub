import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import { querySqlServer } from "../db/sqlserver";

const TABELA_NOTAS = "dbo.TI_NotasAmazonFull_95";
const TABELA_ITENS = "dbo.TI_NotasAmazonFullItens_95";

// parseTagValue: false é essencial — o default (true) converte texto numérico em number,
// o que corrompe CPF/CNPJ/CEP com zero à esquerda (ex: "08937521776" virava 8937521776).
// Convertemos pra number manualmente (numOrNull) só nos campos que realmente são numéricos.
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false });

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
  /** DIFAL — ICMSUFDest.vICMSUFDest, já calculado pelo emissor */
  valorDifal: number | null;
  /** FCP da UF de destino — ICMSUFDest.vFCPUFDest, já calculado pelo emissor */
  valorFcpUfDest: number | null;
}

/**
 * Tipos de operação observados num ZIP real do Faturador Amazon (não é só nota de venda):
 * VENDA/DEVOLUCAO = fluxo com o consumidor final (interessa pra GNRE).
 * REMESSA/RETORNO_SIMBOLICO = fluxo interno vendedor <-> depósito Amazon (armazenagem FBA).
 */
export type TipoOperacao = "VENDA" | "DEVOLUCAO" | "REMESSA" | "RETORNO_SIMBOLICO" | "RETORNO_NAO_ENTREGUE" | "OUTRO";

function classificarTipoOperacao(natOp: string | null): TipoOperacao {
  if (!natOp) return "OUTRO";
  const n = natOp.toLowerCase();
  if (n.includes("devolu")) return "DEVOLUCAO";
  if (n.includes("venda")) return "VENDA";
  if (n.includes("retorno simb")) return "RETORNO_SIMBOLICO";
  if (n.includes("nao entregue") || n.includes("não entregue")) return "RETORNO_NAO_ENTREGUE";
  if (n.includes("remessa")) return "REMESSA";
  return "OUTRO";
}

/** Amazon não usa xPed — o número do pedido vem como texto livre dentro de infCpl */
function extrairNumeroPedido(infCpl: string | null): string | null {
  if (!infCpl) return null;
  const m = infCpl.match(/N[uú]mero do pedido da compra:\s*([\d-]+)/i);
  return m ? m[1] : null;
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
  naturezaOperacao: string | null;
  tipoOperacao: TipoOperacao;
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

  // A Amazon não preenche xPed (campo padrão do layout NF-e pra número de pedido) —
  // o número do pedido vem como texto solto dentro de infAdic.infCpl, ex:
  // "...Numero do pedido da compra: 701-3915314-6833059". Confirmado contra ZIP real.
  const infCpl = strOrNull(infNFe.infAdic?.infCpl);
  const numeroPedidoAmazon = extrairNumeroPedido(infCpl);
  const naturezaOperacao = strOrNull(ide.natOp);

  const itens: NotaFiscalItem[] = dets.map((d) => {
    const prod = d?.prod ?? {};
    const imposto = d?.imposto ?? {};
    const icms = imposto.ICMS ? Object.values(imposto.ICMS)[0] as any : {};
    const icmsUfDest = imposto.ICMSUFDest ?? {};
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
      // Já vêm calculados pelo emissor — é o valor que efetivamente compõe a GNRE
      valorDifal: numOrNull(icmsUfDest?.vICMSUFDest),
      valorFcpUfDest: numOrNull(icmsUfDest?.vFCPUFDest),
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
    naturezaOperacao,
    tipoOperacao: classificarTipoOperacao(naturezaOperacao),
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
         CnpjEmitente, CnpjDestinatario, NomeDestinatario, UfDestino, NaturezaOperacao, TipoOperacao,
         XmlConteudo, ArquivoOrigemZip, ImportadoPor)
       VALUES
        (@chaveAcesso, @numeroPedidoAmazon, @numero, @serie, @dataEmissao, @valorTotal,
         @cnpjEmitente, @cnpjDestinatario, @nomeDestinatario, @ufDestino, @naturezaOperacao, @tipoOperacao,
         @xmlConteudo, @arquivoOrigemZip, @importadoPor)`,
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
        naturezaOperacao: nota.naturezaOperacao,
        tipoOperacao: nota.tipoOperacao,
        xmlConteudo: conteudo,
        arquivoOrigemZip: contexto.arquivoOrigemZip,
        importadoPor: contexto.importadoPor,
      }
    );

    for (const item of nota.itens) {
      await querySqlServer(
        `INSERT INTO ${TABELA_ITENS}
          (ChaveAcesso, NumeroItem, CodigoProduto, Descricao, Ncm, Cfop, Quantidade, ValorUnitario, ValorTotal,
           ValorIcms, ValorIcmsSt, ValorFcp, ValorIpi, ValorPis, ValorCofins, ValorDifal, ValorFcpUfDest)
         VALUES
          (@chaveAcesso, @numeroItem, @codigoProduto, @descricao, @ncm, @cfop, @quantidade, @valorUnitario, @valorTotal,
           @valorIcms, @valorIcmsSt, @valorFcp, @valorIpi, @valorPis, @valorCofins, @valorDifal, @valorFcpUfDest)`,
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
  TipoOperacao: TipoOperacao;
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
    `SELECT ChaveAcesso, NumeroPedidoAmazon, Numero, Serie, DataEmissao, ValorTotal, Situacao, TipoOperacao, DataImportacao
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
