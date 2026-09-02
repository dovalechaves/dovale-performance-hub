import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import { querySqlServer } from "../db/sqlserver";

const TABELA_NOTAS = "dbo.TI_NotasAmazonFull_95";
const TABELA_ITENS = "dbo.TI_NotasAmazonFullItens_95";
/** Tabela de relatório de ecommerce já existente (hoje alimentada por Shopee) — vendas AMAZON FULL entram aqui também */
const TABELA_NFE_ECOMMERCE = "dbo.[TI-MARKETING_95-NFeEcommerce]";

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
  if (n.includes("nao entregue") || n.includes("não entregue") || n.includes("recusa") || n.includes("nao localiza") || n.includes("não localiza")) return "RETORNO_NAO_ENTREGUE";
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
  municipioDestino: string | null;
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

/**
 * Converte a data ISO da NF-e (ex: "2026-08-01T21:42:17-03:00") em Date real antes de
 * mandar pro SQL Server — passar string crua faz o driver mandar como NVarChar e a
 * conversão implícita do SQL Server pra DATETIME falha dependendo do locale da sessão
 * ("Conversion failed when converting date and/or time from character string").
 */
const dateOrNull = (v: string | null): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
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
    municipioDestino: strOrNull(dest.enderDest?.xMun),
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
  enviadasParaRelatorioEcommerce: number;
  erros: { arquivo: string; motivo: string }[];
}

const soma = (valores: (number | null)[]): number =>
  valores.reduce((acc: number, v) => acc + (v ?? 0), 0);

/**
 * Insere UMA linha por nota (não por item) na tabela de relatório de ecommerce já
 * existente (hoje alimentada por Shopee, via PEDIDO_SHOPEE). Só chamada pra notas
 * TipoOperacao = 'VENDA'. Campos de cadastro de produto (PRO_CODIGO, GRUPO,
 * SUBGRUPO, FAMILIA, SECAO, TBP_CUSTO, NVI_NUMERO, NVI_UNITARIO) ficam em branco —
 * não dá pra cruzar o código de produto da Amazon com o Microsys sem mais contexto.
 */
async function inserirNFeEcommerce(nota: NotaFiscalParseada): Promise<void> {
  const municipioUf = [nota.municipioDestino, nota.ufDestino].filter(Boolean).join("/") || null;
  const primeiroItem = nota.itens[0];

  await querySqlServer(
    `INSERT INTO ${TABELA_NFE_ECOMMERCE}
      (NTV_DATA, MUN_UF, PRO_RESUMO, NVI_QUANTIDADE, VALORTOTAL,
       NVI_IPIVALOR, NVI_ICMSVALOR, NVI_PISVALOR, NVI_COFINSVALOR,
       NVI_SUBSTICMS, DIFAL, FCP, EMP, PEDIDO_SHOPEE)
     VALUES
      (@ntvData, @munUf, @proResumo, @quantidade, @valorTotal,
       @ipiValor, @icmsValor, @pisValor, @cofinsValor,
       @substIcms, @difal, @fcp, @emp, @pedido)`,
    {
      ntvData: dateOrNull(nota.dataEmissao),
      munUf: municipioUf,
      proResumo: nota.itens.length > 1 ? `${primeiroItem?.descricao ?? ""} (+${nota.itens.length - 1} item(ns))` : primeiroItem?.descricao ?? null,
      quantidade: soma(nota.itens.map((i) => i.quantidade)) || null,
      valorTotal: nota.valorTotal,
      ipiValor: soma(nota.itens.map((i) => i.valorIpi)) || null,
      icmsValor: soma(nota.itens.map((i) => i.valorIcms)) || null,
      pisValor: soma(nota.itens.map((i) => i.valorPis)) || null,
      cofinsValor: soma(nota.itens.map((i) => i.valorCofins)) || null,
      substIcms: soma(nota.itens.map((i) => i.valorIcmsSt)) || null,
      difal: soma(nota.itens.map((i) => i.valorDifal)) || null,
      fcp: soma(nota.itens.map((i) => i.valorFcpUfDest)) || null,
      emp: "AMAZON FULL",
      pedido: nota.numeroPedidoAmazon,
    }
  );
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
    enviadasParaRelatorioEcommerce: 0,
    erros: [],
  };

  if (entradasXml.length === 0) {
    resultado.erros.push({ arquivo: contexto.arquivoOrigemZip, motivo: "Nenhum arquivo .xml encontrado dentro do ZIP." });
    return resultado;
  }

  // Passo 1: parse de tudo primeiro (sem tocar no banco), pra saber ANTES de inserir
  // se alguma nota deste mesmo ZIP já tem cancelamento junto (ordem dos arquivos dentro
  // do ZIP não é garantida — sem isso, uma nota poderia ser inserida como AUTORIZADA e
  // mandada pro relatório antes do cancelamento "alcançar" ela).
  const notasParaGravar: { conteudo: string; nota: NotaFiscalParseada }[] = [];
  const cancelamentos: EventoCancelamento[] = [];

  for (const entrada of entradasXml) {
    const conteudo = entrada.getData().toString("utf-8");
    const parseado = parseArquivoXml(entrada.entryName, conteudo);

    if (parseado.tipo === "erro") {
      resultado.erros.push({ arquivo: parseado.arquivo, motivo: parseado.motivo });
    } else if (parseado.tipo === "cancelamento") {
      if (parseado.evento.tipoEvento === "110111" && parseado.evento.chaveAcesso) {
        cancelamentos.push(parseado.evento);
      }
    } else {
      notasParaGravar.push({ conteudo, nota: parseado.nota });
    }
  }

  const chavesCanceladasNoLote = new Set(cancelamentos.map((c) => c.chaveAcesso));

  // Passo 2: grava as notas, já sabendo se alguma delas nasce cancelada dentro deste lote
  for (const { conteudo, nota } of notasParaGravar) {
    const existente = await querySqlServer<{ ChaveAcesso: string }>(
      `SELECT ChaveAcesso FROM ${TABELA_NOTAS} WHERE ChaveAcesso = @chave`,
      { chave: nota.chaveAcesso }
    );
    if (existente.length > 0) {
      resultado.notasDuplicadas++;
      continue;
    }

    const situacaoInicial = chavesCanceladasNoLote.has(nota.chaveAcesso) ? "CANCELADA" : "AUTORIZADA";

    await querySqlServer(
      `INSERT INTO ${TABELA_NOTAS}
        (ChaveAcesso, NumeroPedidoAmazon, Numero, Serie, DataEmissao, ValorTotal,
         CnpjEmitente, CnpjDestinatario, NomeDestinatario, UfDestino, NaturezaOperacao, TipoOperacao, Situacao,
         XmlConteudo, ArquivoOrigemZip, ImportadoPor)
       VALUES
        (@chaveAcesso, @numeroPedidoAmazon, @numero, @serie, @dataEmissao, @valorTotal,
         @cnpjEmitente, @cnpjDestinatario, @nomeDestinatario, @ufDestino, @naturezaOperacao, @tipoOperacao, @situacao,
         @xmlConteudo, @arquivoOrigemZip, @importadoPor)`,
      {
        chaveAcesso: nota.chaveAcesso,
        numeroPedidoAmazon: nota.numeroPedidoAmazon,
        numero: nota.numero,
        serie: nota.serie,
        dataEmissao: dateOrNull(nota.dataEmissao),
        valorTotal: nota.valorTotal,
        cnpjEmitente: nota.cnpjEmitente,
        cnpjDestinatario: nota.cnpjDestinatario,
        nomeDestinatario: nota.nomeDestinatario,
        ufDestino: nota.ufDestino,
        naturezaOperacao: nota.naturezaOperacao,
        tipoOperacao: nota.tipoOperacao,
        situacao: situacaoInicial,
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

    // Só vai pro relatório se for venda E já nascer autorizada (nunca manda venda cancelada)
    if (nota.tipoOperacao === "VENDA" && situacaoInicial === "AUTORIZADA") {
      await inserirNFeEcommerce(nota);
      resultado.enviadasParaRelatorioEcommerce++;
    }
  }

  // Passo 3: aplica cancelamentos que referem notas de uploads anteriores (já no banco)
  for (const evento of cancelamentos) {
    const rows = await querySqlServer<{ NumeroPedidoAmazon: string | null }>(
      `UPDATE ${TABELA_NOTAS} SET Situacao = 'CANCELADA' OUTPUT INSERTED.NumeroPedidoAmazon WHERE ChaveAcesso = @chave AND Situacao <> 'CANCELADA'`,
      { chave: evento.chaveAcesso }
    );
    if (rows.length > 0) {
      resultado.cancelamentosAplicados++;
      const pedido = rows[0].NumeroPedidoAmazon;
      if (pedido) {
        await querySqlServer(
          `DELETE FROM ${TABELA_NFE_ECOMMERCE} WHERE EMP = 'AMAZON FULL' AND PEDIDO_SHOPEE = @pedido`,
          { pedido }
        );
      }
    }
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
