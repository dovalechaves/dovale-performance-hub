-- ============================================================================
-- Feature: Notas Fiscais Amazon FBA Classic
-- Banco: DOVALE (SQL Server interno, 10.13.x — mesmo host de DB_SQLSERVER_HOST)
-- ============================================================================

USE DOVALE;
GO

-- Nota fiscal (uma linha por NF-e importada do ZIP do Faturador Amazon)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TI_NotasAmazonFull_95')
BEGIN
    CREATE TABLE dbo.TI_NotasAmazonFull_95 (
        Id                  INT IDENTITY(1,1) PRIMARY KEY,
        ChaveAcesso         CHAR(44)        NOT NULL,
        NumeroPedidoAmazon  VARCHAR(50)     NULL,       -- AmazonOrderId, extraído do texto livre em infCpl ("Numero do pedido da compra: ...") — usado na conciliação
        Numero              VARCHAR(20)     NULL,
        Serie               VARCHAR(10)     NULL,
        DataEmissao         DATETIME        NULL,
        ValorTotal          DECIMAL(18,2)   NULL,
        CnpjEmitente        VARCHAR(14)     NULL,
        CnpjDestinatario    VARCHAR(14)     NULL,
        NomeDestinatario    VARCHAR(200)    NULL,
        UfDestino           CHAR(2)         NULL,
        NaturezaOperacao    VARCHAR(150)    NULL,       -- ide/natOp cru (ex: "Venda de Mercadoria destinada a nao contribuinte")
        TipoOperacao        VARCHAR(25)     NULL,       -- classificação: VENDA | DEVOLUCAO | REMESSA | RETORNO_SIMBOLICO | RETORNO_NAO_ENTREGUE | OUTRO
        Situacao            VARCHAR(20)     NOT NULL DEFAULT 'AUTORIZADA',  -- AUTORIZADA | CANCELADA
        XmlConteudo         NVARCHAR(MAX)   NOT NULL,
        ArquivoOrigemZip    VARCHAR(255)    NULL,
        ImportadoPor        VARCHAR(100)    NULL,       -- X-Dovale-Usuario de quem fez o upload
        DataImportacao      DATETIME        NOT NULL DEFAULT GETDATE(),

        CONSTRAINT UQ_NotasAmazonFull_ChaveAcesso UNIQUE (ChaveAcesso)
    );

    CREATE INDEX IX_NotasAmazonFull_NumeroPedido
        ON dbo.TI_NotasAmazonFull_95 (NumeroPedidoAmazon);

    CREATE INDEX IX_NotasAmazonFull_DataEmissao
        ON dbo.TI_NotasAmazonFull_95 (DataEmissao);

    CREATE INDEX IX_NotasAmazonFull_TipoOperacao
        ON dbo.TI_NotasAmazonFull_95 (TipoOperacao);
END
GO

-- Itens da nota (tributos por item — base para o futuro motor de cálculo de GNRE)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TI_NotasAmazonFullItens_95')
BEGIN
    CREATE TABLE dbo.TI_NotasAmazonFullItens_95 (
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
        ValorDifal      DECIMAL(18,2)   NULL,   -- ICMSUFDest.vICMSUFDest — já vem calculado pelo emissor
        ValorFcpUfDest  DECIMAL(18,2)   NULL,   -- ICMSUFDest.vFCPUFDest — já vem calculado pelo emissor

        CONSTRAINT FK_NotasAmazonFullItens_Nota
            FOREIGN KEY (ChaveAcesso)
            REFERENCES dbo.TI_NotasAmazonFull_95 (ChaveAcesso)
    );

    CREATE INDEX IX_NotasAmazonFullItens_ChaveAcesso
        ON dbo.TI_NotasAmazonFullItens_95 (ChaveAcesso);
END
GO
