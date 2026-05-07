import cron from "node-cron";
import { queryFirebird } from "../db/firebird";
import { getPool } from "../db/sqlserver";
import { obterTemplates, enviarTemplate } from "../services/meta-api";

const TIMEZONE = process.env.APP_TIMEZONE?.trim() || "America/Sao_Paulo";

const SITUACAO_TEMPLATE: Record<string, string> = {
  "VENCE EM 2 DIAS": "cobranca_vence_2dias",
  "VENCIDO HÁ 5 DIAS": "cobranca_vencido_5dias",
  "VENCIDO HÁ 15 DIAS": "cobranca_vencido_15dias",
  "VENCIDO HÁ 30 DIAS": "cobranca_vencido_30dias",
  "VENCIDO HÁ 60 DIAS": "cobranca_vencido_60dias",
};

const SQL_BOLETOS = `
  SELECT
    rt.EMP_FIL_CODIGO,
    rt.REC_ID,
    rt.REC_NUMERO,
    CAST(rt.REC_VENCIMENTO AS DATE) AS REC_VENCIMENTO,
    rt.REC_VALOR,
    COALESCE(SUM(rb.RBX_VALORPAGO), 0) AS TOTAL_PAGO,
    rt.REC_VALOR - COALESCE(SUM(rb.RBX_VALORPAGO), 0) AS SALDO_ABERTO,
    CASE
      WHEN CAST(rt.REC_VENCIMENTO AS DATE) = DATEADD(DAY,  2, CURRENT_DATE) THEN 'VENCE EM 2 DIAS'
      WHEN CAST(rt.REC_VENCIMENTO AS DATE) = DATEADD(DAY, -5, CURRENT_DATE) THEN 'VENCIDO HÁ 5 DIAS'
      WHEN CAST(rt.REC_VENCIMENTO AS DATE) = DATEADD(DAY,-15, CURRENT_DATE) THEN 'VENCIDO HÁ 15 DIAS'
      WHEN CAST(rt.REC_VENCIMENTO AS DATE) = DATEADD(DAY,-30, CURRENT_DATE) THEN 'VENCIDO HÁ 30 DIAS'
      WHEN CAST(rt.REC_VENCIMENTO AS DATE) = DATEADD(DAY,-60, CURRENT_DATE) THEN 'VENCIDO HÁ 60 DIAS'
    END AS SITUACAO,
    rt.REC_CLI_CODIGO,
    c.CLI_NOME,
    COALESCE(NULLIF(TRIM(c.CLI_FONE), ''), c.CLI_CELULAR) AS TELEFONE
  FROM RECEBER_TITULOS rt
  LEFT JOIN RECEBER_BAIXAS rb ON rb.EMP_FIL_CODIGO = rt.EMP_FIL_CODIGO
                              AND rb.RBX_REC_ID = rt.REC_ID
  LEFT JOIN CLIENTES c ON c.CLI_CODIGO = rt.REC_CLI_CODIGO
  WHERE CAST(rt.REC_VENCIMENTO AS DATE) IN (
    DATEADD(DAY,  2, CURRENT_DATE),
    DATEADD(DAY, -5, CURRENT_DATE),
    DATEADD(DAY,-15, CURRENT_DATE),
    DATEADD(DAY,-30, CURRENT_DATE),
    DATEADD(DAY,-60, CURRENT_DATE)
  )
  GROUP BY
    rt.EMP_FIL_CODIGO, rt.REC_ID, rt.REC_NUMERO, rt.REC_VENCIMENTO, rt.REC_VALOR,
    rt.REC_CLI_CODIGO, c.CLI_NOME, c.CLI_FONE, c.CLI_CELULAR
  HAVING COALESCE(SUM(rb.RBX_VALORPAGO), 0) < rt.REC_VALOR
  ORDER BY rt.REC_VENCIMENTO
`;

const SQL_SALDO_BOLETO = `
  SELECT
    rt.REC_ID,
    rt.REC_VALOR - COALESCE(SUM(rb.RBX_VALORPAGO), 0) AS SALDO_ABERTO
  FROM RECEBER_TITULOS rt
  LEFT JOIN RECEBER_BAIXAS rb ON rb.EMP_FIL_CODIGO = rt.EMP_FIL_CODIGO
                              AND rb.RBX_REC_ID = rt.REC_ID
  WHERE rt.REC_ID = ?
    AND rt.EMP_FIL_CODIGO = ?
  GROUP BY rt.REC_ID, rt.REC_VALOR
`;

function normalizarTelefone(tel: string): string | null {
  let digits = tel.replace(/\D/g, "");
  if (!digits || digits.length < 8) return null;
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.startsWith("55")) {
    const sem55 = digits.slice(2);
    if (sem55.length === 10) digits = "55" + sem55.slice(0, 2) + "9" + sem55.slice(2);
    return digits.length >= 12 ? digits : null;
  }
  if (digits.length === 10) digits = "55" + digits.slice(0, 2) + "9" + digits.slice(2);
  else if (digits.length === 11) digits = "55" + digits;
  else return null;
  return digits;
}

async function ensureCobrancaTables(pool: any): Promise<void> {
  await pool.request().query(`
    IF OBJECT_ID('dbo.COBRANCA_DISPAROS', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.COBRANCA_DISPAROS (
        id INT IDENTITY(1,1) PRIMARY KEY,
        fonte VARCHAR(10) NOT NULL,
        emp_fil_codigo NVARCHAR(10) NULL,
        rec_id INT NOT NULL,
        rec_numero NVARCHAR(50) NULL,
        rec_vencimento DATE NOT NULL,
        rec_valor DECIMAL(15,2) NOT NULL,
        cli_codigo NVARCHAR(50) NOT NULL,
        cli_nome NVARCHAR(255) NULL,
        telefone NVARCHAR(20) NULL,
        situacao VARCHAR(50) NOT NULL,
        template_nome NVARCHAR(100) NULL,
        data_disparo DATETIME NOT NULL DEFAULT GETDATE(),
        status VARCHAR(20) NOT NULL DEFAULT 'ENVIADO',
        erro NVARCHAR(500) NULL,
        wamid NVARCHAR(100) NULL,
        manual BIT NOT NULL DEFAULT 0,
        pago_apos_disparo BIT NOT NULL DEFAULT 0,
        data_verificacao_pagamento DATETIME NULL
      );
    END

    IF OBJECT_ID('dbo.COBRANCA_BONUS', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.COBRANCA_BONUS (
        id INT IDENTITY(1,1) PRIMARY KEY,
        disparo_id INT NOT NULL REFERENCES dbo.COBRANCA_DISPAROS(id),
        mes_ano VARCHAR(7) NOT NULL,
        valor DECIMAL(10,2) NOT NULL DEFAULT 1.00,
        exportado BIT NOT NULL DEFAULT 0,
        data_exportacao DATETIME NULL,
        data_registro DATETIME NOT NULL DEFAULT GETDATE()
      );
    END
  `);
}

async function obterTemplatesAprovados(): Promise<Set<string>> {
  const { data, error } = await obterTemplates();
  if (error || !data?.data) return new Set();
  const aprovados = new Set<string>();
  for (const t of data.data) {
    if (t.status === "APPROVED") aprovados.add(t.name);
  }
  return aprovados;
}

async function jaDisparadoHoje(pool: any, fonte: string, recId: number, situacao: string): Promise<boolean> {
  const hoje = new Date().toISOString().slice(0, 10);
  const result = await pool.request()
    .input("fonte", fonte)
    .input("recId", recId)
    .input("situacao", situacao)
    .input("hoje", hoje)
    .query(`
      SELECT TOP 1 id FROM dbo.COBRANCA_DISPAROS
      WHERE fonte = @fonte AND rec_id = @recId AND situacao = @situacao
        AND CAST(data_disparo AS DATE) = @hoje
    `);
  return result.recordset.length > 0;
}

async function salvarDisparo(pool: any, params: {
  fonte: string; empFilCodigo: string; recId: number; recNumero: string;
  recVencimento: string; recValor: number; cliCodigo: string; cliNome: string;
  telefone: string | null; situacao: string; templateNome: string;
  status: string; erro: string | null; wamid: string | null; manual: boolean;
}): Promise<number> {
  const result = await pool.request()
    .input("fonte", params.fonte)
    .input("empFilCodigo", params.empFilCodigo)
    .input("recId", params.recId)
    .input("recNumero", params.recNumero)
    .input("recVencimento", params.recVencimento)
    .input("recValor", params.recValor)
    .input("cliCodigo", params.cliCodigo)
    .input("cliNome", params.cliNome)
    .input("telefone", params.telefone)
    .input("situacao", params.situacao)
    .input("templateNome", params.templateNome)
    .input("status", params.status)
    .input("erro", params.erro)
    .input("wamid", params.wamid)
    .input("manual", params.manual ? 1 : 0)
    .query(`
      INSERT INTO dbo.COBRANCA_DISPAROS
        (fonte, emp_fil_codigo, rec_id, rec_numero, rec_vencimento, rec_valor,
         cli_codigo, cli_nome, telefone, situacao, template_nome, status, erro, wamid, manual)
      OUTPUT INSERTED.id
      VALUES
        (@fonte, @empFilCodigo, @recId, @recNumero, @recVencimento, @recValor,
         @cliCodigo, @cliNome, @telefone, @situacao, @templateNome, @status, @erro, @wamid, @manual)
    `);
  return result.recordset[0]?.id ?? 0;
}

async function verificarPagamentosEBonus(pool: any): Promise<void> {
  const pendentes = await pool.request().query(`
    SELECT id, fonte, emp_fil_codigo, rec_id, data_disparo
    FROM dbo.COBRANCA_DISPAROS
    WHERE pago_apos_disparo = 0 AND status = 'ENVIADO'
  `);

  for (const row of pendentes.recordset) {
    try {
      const rows = await queryFirebird<any>(row.fonte, SQL_SALDO_BOLETO, [row.rec_id, row.emp_fil_codigo]);
      const saldo = rows[0]?.SALDO_ABERTO ?? null;
      if (saldo !== null && Number(saldo) <= 0) {
        await pool.request()
          .input("id", row.id)
          .query(`UPDATE dbo.COBRANCA_DISPAROS SET pago_apos_disparo = 1, data_verificacao_pagamento = GETDATE() WHERE id = @id`);

        const jaTemBonus = await pool.request()
          .input("disparoId", row.id)
          .query(`SELECT TOP 1 id FROM dbo.COBRANCA_BONUS WHERE disparo_id = @disparoId`);

        if (jaTemBonus.recordset.length === 0) {
          const mesAno = new Date().toISOString().slice(0, 7);
          await pool.request()
            .input("disparoId", row.id)
            .input("mesAno", mesAno)
            .query(`INSERT INTO dbo.COBRANCA_BONUS (disparo_id, mes_ano, valor) VALUES (@disparoId, @mesAno, 1.00)`);
        }
      }
    } catch {
      // ignora erros de verificação individual
    }
  }
}

export async function executarCobranca(manual = false): Promise<{ enviados: number; falhos: number; ignorados: number }> {
  console.log(`[cobranca] iniciando execução ${manual ? "MANUAL" : "automática"}...`);
  const pool = await getPool();
  await ensureCobrancaTables(pool);

  const templatesAprovados = await obterTemplatesAprovados();
  console.log(`[cobranca] templates aprovados: ${[...templatesAprovados].join(", ") || "nenhum"}`);

  let enviados = 0, falhos = 0, ignorados = 0;

  for (const fonte of ["sjc", "mg"] as const) {
    let boletos: any[];
    try {
      boletos = await queryFirebird(fonte, SQL_BOLETOS);
      console.log(`[cobranca] ${fonte}: ${boletos.length} boletos encontrados`);
    } catch (err: any) {
      console.error(`[cobranca] ${fonte}: erro ao buscar boletos:`, err.message);
      continue;
    }

    for (const b of boletos) {
      const situacao: string = b.SITUACAO;
      if (!situacao) { ignorados++; continue; }

      const templateNome = SITUACAO_TEMPLATE[situacao];
      if (!templateNome || !templatesAprovados.has(templateNome)) {
        ignorados++;
        continue;
      }

      const jaDisparado = await jaDisparadoHoje(pool, fonte, b.REC_ID, situacao);
      if (jaDisparado) { ignorados++; continue; }

      const telefoneRaw: string = b.TELEFONE ?? "";
      const telefone = normalizarTelefone(telefoneRaw);
      if (!telefone) {
        console.warn(`[cobranca] ${fonte} rec_id=${b.REC_ID}: telefone inválido "${telefoneRaw}"`);
        ignorados++;
        continue;
      }

      const { data, error } = await enviarTemplate(telefone, templateNome);
      const wamid = data?.messages?.[0]?.id ?? null;
      const status = error ? "FALHOU" : "ENVIADO";

      if (error) {
        console.error(`[cobranca] ${fonte} rec_id=${b.REC_ID}: erro ao enviar:`, error);
        falhos++;
      } else {
        enviados++;
      }

      await salvarDisparo(pool, {
        fonte,
        empFilCodigo: String(b.EMP_FIL_CODIGO ?? ""),
        recId: b.REC_ID,
        recNumero: String(b.REC_NUMERO ?? ""),
        recVencimento: b.REC_VENCIMENTO instanceof Date
          ? b.REC_VENCIMENTO.toISOString().slice(0, 10)
          : String(b.REC_VENCIMENTO ?? ""),
        recValor: Number(b.REC_VALOR),
        cliCodigo: String(b.REC_CLI_CODIGO ?? ""),
        cliNome: String(b.CLI_NOME ?? ""),
        telefone,
        situacao,
        templateNome,
        status,
        erro: error || null,
        wamid,
        manual,
      });
    }
  }

  await verificarPagamentosEBonus(pool);

  console.log(`[cobranca] concluído — enviados: ${enviados}, falhos: ${falhos}, ignorados: ${ignorados}`);
  return { enviados, falhos, ignorados };
}

export function startCobrancaJob(): void {
  cron.schedule("0 8 * * 1-6", async () => {
    console.log("[cobranca] cron disparado às 8h");
    try {
      await executarCobranca(false);
    } catch (err: any) {
      console.error("[cobranca] erro no cron:", err.message);
    }
  }, { timezone: TIMEZONE });

  console.log("[cobranca] job agendado — 8h (seg-sáb)");
}
