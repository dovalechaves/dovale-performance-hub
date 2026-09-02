-- ============================================================================
-- Feature: Notas Fiscais Amazon FBA Classic
-- Banco: DOVALE (SQL Server interno, 10.13.x — mesmo host de DB_SQLSERVER_HOST)
--
-- ⚠️ CONFIRME ANTES DE RODAR:
--   O prefixo "TI-FISCAL_900-" usa "900" como placeholder, seguindo o padrão
--   já existente (ex: TI-FINANCEIRO_131-..., TI-MARKETING_95-..., TI-COMERCIAL_45-...).
--   Ninguém confirmou qual número de área é o correto para o setor Fiscal —
--   troque "900" abaixo (find & replace) pelo número certo antes de executar.
-- ============================================================================

USE DOVALE;
GO

-- Nota fiscal (uma linha por NF-e importada do ZIP do Faturador Amazon)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TI-FISCAL_900-NotasFiscaisAmazon')
BEGIN
    CREATE TABLE dbo.[TI-FISCAL_900-NotasFiscaisAmazon] (
        Id                  INT IDENTITY(1,1) PRIMARY KEY,
        ChaveAcesso         CHAR(44)        NOT NULL,
        NumeroPedidoAmazon  VARCHAR(50)     NULL,       -- AmazonOrderId, quando identificado no XML (xPed) — usado na conciliação
        Numero              VARCHAR(20)     NULL,
        Serie               VARCHAR(10)     NULL,
        DataEmissao         DATETIME        NULL,
        ValorTotal          DECIMAL(18,2)   NULL,
        CnpjEmitente        VARCHAR(14)     NULL,
        CnpjDestinatario    VARCHAR(14)     NULL,
        NomeDestinatario    VARCHAR(200)    NULL,
        UfDestino           CHAR(2)         NULL,
        Situacao            VARCHAR(20)     NOT NULL DEFAULT 'AUTORIZADA',  -- AUTORIZADA | CANCELADA
        XmlConteudo         NVARCHAR(MAX)   NOT NULL,
        ArquivoOrigemZip    VARCHAR(255)    NULL,
        ImportadoPor        VARCHAR(100)    NULL,       -- X-Dovale-Usuario de quem fez o upload
        DataImportacao      DATETIME        NOT NULL DEFAULT GETDATE(),

        CONSTRAINT UQ_NotasFiscaisAmazon_ChaveAcesso UNIQUE (ChaveAcesso)
    );

    CREATE INDEX IX_NotasFiscaisAmazon_NumeroPedido
        ON dbo.[TI-FISCAL_900-NotasFiscaisAmazon] (NumeroPedidoAmazon);

    CREATE INDEX IX_NotasFiscaisAmazon_DataEmissao
        ON dbo.[TI-FISCAL_900-NotasFiscaisAmazon] (DataEmissao);
END
GO

-- Itens da nota (tributos por item — base para o futuro motor de cálculo de GNRE)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TI-FISCAL_900-NotasFiscaisAmazonItens')
BEGIN
    CREATE TABLE dbo.[TI-FISCAL_900-NotasFiscaisAmazonItens] (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        ChaveAcesso     CHAR(44)        NOT NULL,
        NumeroItem      INT             NULL,
        CodigoProduto   VARCHAR(60)     NULL,   -- código Amazon do produto (não é o SKU do vendedor — ver README)
        Descricao       VARCHAR(255)    NULL,
        Ncm             VARCHAR(10)     NULL,
        Cfop            VARCHAR(6)      NULL,
        Quantidade      DECIMAL(18,4)   NULL,
        ValorUnitario   DECIMAL(18,4)   NULL,
        ValorTotal      DECIMAL(18,2)   NULL,
        ValorIcms       DECIMAL(18,2)   NULL,
        ValorIcmsSt     DECIMAL(18,2)   NULL,
        ValorFcp        DECIMAL(18,2)   NULL,
        ValorIpi        DECIMAL(18,2)   NULL,
        ValorPis        DECIMAL(18,2)   NULL,
        ValorCofins     DECIMAL(18,2)   NULL,

        CONSTRAINT FK_NotasFiscaisAmazonItens_Nota
            FOREIGN KEY (ChaveAcesso)
            REFERENCES dbo.[TI-FISCAL_900-NotasFiscaisAmazon] (ChaveAcesso)
    );

    CREATE INDEX IX_NotasFiscaisAmazonItens_ChaveAcesso
        ON dbo.[TI-FISCAL_900-NotasFiscaisAmazonItens] (ChaveAcesso);
END
GO
