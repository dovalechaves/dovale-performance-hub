import { Router } from "express";
import { getPool } from "../db/sqlserver";
import { executarCobranca } from "../jobs/cobrancaJob";
import { obterTemplates, enviarTemplate } from "../services/meta-api";
import { queryFirebird } from "../db/firebird";

const router = Router();

const SITUACAO_TEMPLATE: Record<string, string> = {
  "VENCE EM 2 DIAS": "cobranca_vence_2dias",
  "VENCIDO HÁ 5 DIAS": "cobranca_vencido_5dias",
  "VENCIDO HÁ 15 DIAS": "cobranca_vencido_15dias",
  "VENCIDO HÁ 30 DIAS": "cobranca_vencido_30dias",
  "VENCIDO HÁ 60 DIAS": "cobranca_vencido_60dias",
};

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

/** GET /api/cobranca/painel — disparos de hoje */
router.get("/painel", async (_req, res) => {
  try {
    const pool = await getPool();
    const hoje = new Date().toISOString().slice(0, 10);
    const result = await pool.request()
      .input("hoje", hoje)
      .query(`
        SELECT
          id, fonte, emp_fil_codigo, rec_id, rec_numero, rec_vencimento, rec_valor,
          cli_codigo, cli_nome, telefone, situacao, template_nome, data_disparo,
          status, erro, wamid, manual, pago_apos_disparo
        FROM dbo.COBRANCA_DISPAROS
        WHERE CAST(data_disparo AS DATE) = @hoje
        ORDER BY data_disparo DESC
      `);

    const rows = result.recordset;
    const total = rows.length;
    const enviados = rows.filter((r: any) => r.status === "ENVIADO").length;
    const falhos = rows.filter((r: any) => r.status === "FALHOU").length;
    const pagos = rows.filter((r: any) => r.pago_apos_disparo).length;

    res.json({ total, enviados, falhos, pagos, disparos: rows });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

/** GET /api/cobranca/historico — histórico paginado */
router.get("/historico", async (req, res) => {
  try {
    const pool = await getPool();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const { situacao, status, fonte, dataInicio, dataFim, busca } = req.query as Record<string, string>;

    const filters: string[] = [];
    const request = pool.request();

    if (situacao) { filters.push("situacao = @situacao"); request.input("situacao", situacao); }
    if (status) { filters.push("status = @status"); request.input("status", status); }
    if (fonte) { filters.push("fonte = @fonte"); request.input("fonte", fonte); }
    if (dataInicio) { filters.push("CAST(data_disparo AS DATE) >= @dataInicio"); request.input("dataInicio", dataInicio); }
    if (dataFim) { filters.push("CAST(data_disparo AS DATE) <= @dataFim"); request.input("dataFim", dataFim); }
    if (busca) {
      filters.push("(cli_nome LIKE @busca OR cli_codigo LIKE @busca OR rec_numero LIKE @busca OR telefone LIKE @busca)");
      request.input("busca", `%${busca}%`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const countResult = await pool.request().query(`SELECT COUNT(*) AS total FROM dbo.COBRANCA_DISPAROS ${where}`);
    const total = countResult.recordset[0]?.total ?? 0;

    request.input("offset", offset).input("limit", limit);
    const result = await request.query(`
      SELECT
        id, fonte, emp_fil_codigo, rec_id, rec_numero, rec_vencimento, rec_valor,
        cli_codigo, cli_nome, telefone, situacao, template_nome, data_disparo,
        status, erro, wamid, manual, pago_apos_disparo, data_verificacao_pagamento
      FROM dbo.COBRANCA_DISPAROS
      ${where}
      ORDER BY data_disparo DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    res.json({ total, page, limit, pages: Math.ceil(total / limit), disparos: result.recordset });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

/** GET /api/cobranca/historico/exportar — CSV com os mesmos filtros do histórico */
router.get("/historico/exportar", async (req, res) => {
  try {
    const pool = await getPool();
    const { situacao, status, fonte, dataInicio, dataFim, busca } = req.query as Record<string, string>;
    const filters: string[] = [];
    const request = pool.request();
    if (situacao) { filters.push("situacao = @situacao"); request.input("situacao", situacao); }
    if (status)   { filters.push("status = @status");     request.input("status", status); }
    if (fonte)    { filters.push("fonte = @fonte");        request.input("fonte", fonte); }
    if (dataInicio) { filters.push("CAST(data_disparo AS DATE) >= @dataInicio"); request.input("dataInicio", dataInicio); }
    if (dataFim)    { filters.push("CAST(data_disparo AS DATE) <= @dataFim");    request.input("dataFim", dataFim); }
    if (busca) {
      filters.push("(cli_nome LIKE @busca OR cli_codigo LIKE @busca OR rec_numero LIKE @busca OR telefone LIKE @busca)");
      request.input("busca", `%${busca}%`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const result = await request.query(`
      SELECT
        id, fonte, rec_numero,
        CONVERT(VARCHAR, rec_vencimento, 103)  AS rec_vencimento,
        rec_valor, cli_codigo, cli_nome, telefone, situacao, template_nome,
        CONVERT(VARCHAR, data_disparo, 103)    AS data_disparo_data,
        CONVERT(VARCHAR, data_disparo, 108)    AS data_disparo_hora,
        status, erro, manual, pago_apos_disparo
      FROM dbo.COBRANCA_DISPAROS
      ${where}
      ORDER BY data_disparo DESC
    `);

    const rows = result.recordset;
    const header = "ID;Origem;Nº Boleto;Vencimento;Valor;Cód. Cliente;Cliente;Telefone;Situação;Template;Data;Hora;Status;Erro;Tipo;Pago após disparo\n";
    const csv = header + rows.map((r: any) =>
      [
        r.id, r.fonte, r.rec_numero ?? "", r.rec_vencimento ?? "",
        Number(r.rec_valor).toFixed(2), r.cli_codigo ?? "", r.cli_nome ?? "",
        r.telefone ?? "", r.situacao ?? "", r.template_nome ?? "",
        r.data_disparo_data ?? "", r.data_disparo_hora ?? "",
        r.status ?? "", (r.erro ?? "").replace(/;/g, ","),
        r.manual ? "Manual" : "Auto",
        r.pago_apos_disparo ? "Sim" : "Não",
      ].join(";")
    ).join("\n");

    const hoje = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="historico_cobranca_${hoje}.csv"`);
    res.send("﻿" + csv);
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

router.get("/bonus", async (req, res) => {
  try {
    const pool = await getPool();
    const { mes } = req.query as Record<string, string>;

    const request = pool.request();
    let where = "";
    if (mes) { where = "WHERE b.mes_ano = @mes"; request.input("mes", mes); }

    const result = await request.query(`
      SELECT
        b.mes_ano,
        COUNT(*) AS total_bonus,
        SUM(b.valor) AS total_valor,
        SUM(CASE WHEN b.exportado = 1 THEN 1 ELSE 0 END) AS exportados,
        MIN(b.data_registro) AS primeiro_registro,
        MAX(b.data_registro) AS ultimo_registro
      FROM dbo.COBRANCA_BONUS b
      ${where}
      GROUP BY b.mes_ano
      ORDER BY b.mes_ano DESC
    `);

    const detalhes = await pool.request().query(`
      SELECT
        b.id, b.disparo_id, b.mes_ano, b.valor, b.exportado, b.data_exportacao, b.data_registro,
        d.cli_nome, d.cli_codigo, d.rec_numero, d.rec_vencimento, d.rec_valor,
        d.situacao, d.data_disparo, d.fonte, d.telefone
      FROM dbo.COBRANCA_BONUS b
      JOIN dbo.COBRANCA_DISPAROS d ON d.id = b.disparo_id
      ${where}
      ORDER BY b.data_registro DESC
    `);

    res.json({ resumo: result.recordset, detalhes: detalhes.recordset });
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

/** GET /api/cobranca/bonus/exportar?mes=YYYY-MM — CSV */
router.get("/bonus/exportar", async (req, res) => {
  try {
    const pool = await getPool();
    const { mes } = req.query as Record<string, string>;
    if (!mes) return res.status(400).json({ erro: "Parâmetro 'mes' obrigatório (YYYY-MM)" });

    const result = await pool.request()
      .input("mes", mes)
      .query(`
        SELECT
          b.id, b.mes_ano, b.valor,
          d.cli_nome, d.cli_codigo, d.rec_numero,
          CONVERT(VARCHAR, d.rec_vencimento, 103) AS rec_vencimento,
          d.rec_valor, d.situacao,
          CONVERT(VARCHAR, d.data_disparo, 103) AS data_disparo,
          d.fonte, d.telefone
        FROM dbo.COBRANCA_BONUS b
        JOIN dbo.COBRANCA_DISPAROS d ON d.id = b.disparo_id
        WHERE b.mes_ano = @mes
        ORDER BY b.data_registro
      `);

    await pool.request()
      .input("mes", mes)
      .query(`UPDATE dbo.COBRANCA_BONUS SET exportado = 1, data_exportacao = GETDATE() WHERE mes_ano = @mes AND exportado = 0`);

    const rows = result.recordset;
    const header = "ID;Mês/Ano;Valor Bônus;Cliente;Código Cliente;Nº Boleto;Vencimento;Valor Boleto;Situação;Data Disparo;Origem;Telefone\n";
    const csv = header + rows.map((r: any) =>
      `${r.id};${r.mes_ano};${Number(r.valor).toFixed(2)};${r.cli_nome ?? ""};${r.cli_codigo ?? ""};${r.rec_numero ?? ""};${r.rec_vencimento ?? ""};${Number(r.rec_valor).toFixed(2)};${r.situacao ?? ""};${r.data_disparo ?? ""};${r.fonte ?? ""};${r.telefone ?? ""}`
    ).join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="bonus_cobranca_${mes}.csv"`);
    res.send("﻿" + csv);
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

/** POST /api/cobranca/disparar-manual — re-disparo manual (mesma regra do automático) */
router.post("/disparar-manual", async (_req, res) => {
  try {
    const resultado = await executarCobranca(true);
    res.json({ ok: true, ...resultado });
  } catch (err: any) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

/** GET /api/cobranca/templates — lista templates de cobrança e status no Meta */
router.get("/templates", async (_req, res) => {
  try {
    const { data, error } = await obterTemplates();
    if (error) return res.status(500).json({ erro: error });

    const todosTemplates = data?.data ?? [];
    const resultado = Object.entries(SITUACAO_TEMPLATE).map(([situacao, nome]) => {
      const t = todosTemplates.find((t: any) => t.name === nome);
      return {
        situacao,
        template_nome: nome,
        status: t?.status ?? "NAO_CRIADO",
        id: t?.id ?? null,
        language: t?.language ?? null,
      };
    });

    res.json(resultado);
  } catch (err: any) {
    res.status(500).json({ erro: err.message });
  }
});

export default router;
