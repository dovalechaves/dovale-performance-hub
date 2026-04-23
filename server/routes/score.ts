import { Router, Request, Response } from "express";
import Firebird from "node-firebird";

type FbConn = {
  query: (sql: string, params: unknown[], cb: (err: unknown, rows: unknown[]) => void) => void;
  detach: (cb: () => void) => void;
};

type DbConfig = {
  host: string;
  database: string;
  user: string;
  password: string;
  port: number;
};

type Purchase = {
  id: string;
  date: string;
  description: string;
  orderId: string | null;
  value: number;
  dueDate: string;
  paymentDate: string | null;
  paymentCode: string | null;
  paymentMethod: string;
  delayDays: number;
  status: "paid" | "pending" | "overdue";
};

type Adjustment = {
  reason: string;
  points: number;
  limiteChange: number;
};

const router = Router();

const MACHINE_PRODUCTS = [
  5513, 7723, 77041, 77042, 26230, 26231, 26232, 26300,
  26400, 77018, 77037, 77039, 77051, 77050, 79502, 79503,
  79504, 78611, 79220, 79225, 26401, 26303, 79389,
];

const PAYMENT_LABEL: Record<string, string> = {
  B: "Boleto",
  C: "Cheque",
  T: "À vista / Pix",
  D: "Depósito",
  R: "Carteira",
  P: "Antecipado",
  V: "Vale",
};

function normalizeDate(value: unknown): string {
  if (!value) return "N/D";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const asDate = new Date(String(value));
  return Number.isNaN(asDate.getTime()) ? "N/D" : asDate.toISOString().slice(0, 10);
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const dt = new Date(String(value));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fbConnect(config: DbConfig): Promise<FbConn> {
  return new Promise((resolve, reject) => {
    Firebird.attach(config, (err, db) => {
      if (err || !db) return reject(err ?? new Error("Falha ao conectar no Firebird"));
      resolve(db as FbConn);
    });
  });
}

function fbQuery<T = Record<string, unknown>>(db: FbConn, sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve((rows ?? []) as T[]);
    });
  });
}

function fbDetach(db: FbConn | null): void {
  if (!db) return;
  try {
    db.detach(() => undefined);
  } catch {
    undefined;
  }
}

router.get("/clientes/:clientCode/score", async (req: Request, res: Response) => {
  const clientCode = String(req.params.clientCode || "").trim();
  if (!clientCode) return res.status(400).json({ error: "Código do cliente é obrigatório." });

  const db1: DbConfig = {
    host: process.env.DB1_HOST || process.env.DB_FIREBIRD_SJC_HOST || process.env.DB_FIREBIRD_ECOMMERCE_HOST || "localhost",
    database: process.env.DB1_PATH || process.env.DB_FIREBIRD_SJC_PATH || process.env.DB_FIREBIRD_ECOMMERCE_PATH || "",
    user: process.env.DB1_USER || process.env.DB_FIREBIRD_SJC_USER || process.env.DB_FIREBIRD_ECOMMERCE_USER || process.env.DB_USER || "SYSDBA",
    password: process.env.DB1_PASSWORD || process.env.DB_FIREBIRD_SJC_PASSWORD || process.env.DB_FIREBIRD_ECOMMERCE_PASSWORD || process.env.DB_PASSWORD || "masterkey",
    port: Number(process.env.DB1_PORT || process.env.DB_FIREBIRD_SJC_PORT || process.env.DB_FIREBIRD_ECOMMERCE_PORT || 3050),
  };

  const db2: DbConfig = {
    host: process.env.DB2_HOST || process.env.DB_FIREBIRD_MG_HOST || process.env.DB_FIREBIRD_SPM_HOST || "localhost",
    database: process.env.DB2_PATH || process.env.DB_FIREBIRD_MG_PATH || process.env.DB_FIREBIRD_SPM_PATH || "",
    user: process.env.DB2_USER || process.env.DB_FIREBIRD_MG_USER || process.env.DB_FIREBIRD_SPM_USER || process.env.DB_USER || "SYSDBA",
    password: process.env.DB2_PASSWORD || process.env.DB_FIREBIRD_MG_PASSWORD || process.env.DB_FIREBIRD_SPM_PASSWORD || process.env.DB_PASSWORD || "masterkey",
    port: Number(process.env.DB2_PORT || process.env.DB_FIREBIRD_MG_PORT || process.env.DB_FIREBIRD_SPM_PORT || 3050),
  };

  const databases = [db1, db2].filter((d) => d.database);
  if (!databases.length) {
    return res.status(500).json({ error: "Configuração ausente: DB1_PATH/DB2_PATH." });
  }

  const sqlClientByCode = `
    SELECT c.cli_codigo, c.cli_nome, c.cli_cnpj, c.cli_endereco, c.cli_bairro, c.cli_cep
    FROM clientes c
    WHERE c.cli_codigo = ?
  `;

  const sqlClientByCnpj = `
    SELECT c.cli_codigo, c.cli_nome, c.cli_cnpj, c.cli_endereco, c.cli_bairro, c.cli_cep
    FROM clientes c
    WHERE c.cli_cnpj = ?
  `;

  const sqlPurchases = `
    SELECT
      rb.rec_numero,
      pv.pdv_data,
      rb.rec_valor,
      rb.rec_vencimento,
      (rb.rec_valor - COALESCE(rb.rec_valorpago, 0)) AS saldo_devedor,
      rb.rec_datapagamento,
      rb.rec_pedido,
      (SELECT COUNT(pvi.pvi_pro_codigo)
       FROM pedidos_vendas_itens pvi
       WHERE pvi.pvi_numero = pv.pdv_numero
         AND pvi.pvi_pro_codigo IN (${MACHINE_PRODUCTS.join(",")})
      ) AS qtd_maquinas,
      pv.pdv_tipopagamento
    FROM receber_titulos rb
    LEFT JOIN pedidos_vendas pv ON pv.pdv_numero = rb.rec_pedido
                              AND pv.pdv_cli_codigo = rb.rec_cli_codigo
    WHERE rb.rec_cli_codigo = ?
      AND rb.rec_vencimento >= DATEADD(-6 MONTH TO CURRENT_DATE)
    ORDER BY rb.rec_vencimento DESC
  `;

  let clientInfo: Record<string, unknown> | null = null;
  let targetCnpj: string | null = null;
  const rows: Array<{ dbIdx: number; row: Record<string, unknown> }> = [];

  for (let i = 0; i < databases.length; i += 1) {
    const dbCfg = databases[i];
    let conn: FbConn | null = null;
    try {
      conn = await fbConnect(dbCfg);

      let localClientCode: unknown = null;
      if (!targetCnpj) {
        const found = await fbQuery<Record<string, unknown>>(conn, sqlClientByCode, [clientCode]);
        if (found[0]) {
          clientInfo = found[0];
          localClientCode = found[0].CLI_CODIGO;
          targetCnpj = String(found[0].CLI_CNPJ || "").trim() || null;
        }
      } else {
        const found = await fbQuery<Record<string, unknown>>(conn, sqlClientByCnpj, [targetCnpj]);
        if (found[0]) localClientCode = found[0].CLI_CODIGO;
      }

      if (localClientCode != null) {
        const purchases = await fbQuery<Record<string, unknown>>(conn, sqlPurchases, [localClientCode]);
        for (const row of purchases) rows.push({ dbIdx: i + 1, row });
      }
    } catch (err) {
      console.warn(`[score] base offline/erro: ${dbCfg.database}`, err);
    } finally {
      fbDetach(conn);
    }
  }

  if (!clientInfo) {
    return res.status(404).json({ error: "Cliente não encontrado em nenhuma base." });
  }

  const purchases: Purchase[] = [];
  const groupedOrders: Record<string, number> = {};
  let boughtMachine = false;
  let totalEvaluated = 0;
  let totalDelay = 0;
  let paidOnTime = 0;
  let paidLate = 0;
  let overdueOpen = 0;
  let paidCash = 0;

  rows.forEach(({ dbIdx, row }, idx) => {
    const recNumero = row.REC_NUMERO;
    const pdvData = row.PDV_DATA;
    const recValor = toNumber(row.REC_VALOR);
    const recVencimento = toDate(row.REC_VENCIMENTO);
    const saldoDevedor = toNumber(row.SALDO_DEVEDOR);
    const recDataPg = toDate(row.REC_DATAPAGAMENTO);
    const recPedido = row.REC_PEDIDO;
    const qtdMaquinas = toNumber(row.QTD_MAQUINAS);
    const paymentCodeRaw = row.PDV_TIPOPAGAMENTO == null ? "" : String(row.PDV_TIPOPAGAMENTO);
    const paymentCode = paymentCodeRaw || null;

    if (qtdMaquinas > 0) boughtMachine = true;

    const orderKey = recPedido != null ? `DB${dbIdx}-${recPedido}` : `AVULSO-DB${dbIdx}-${recNumero ?? idx}`;
    groupedOrders[orderKey] = (groupedOrders[orderKey] || 0) + recValor;

    let status: Purchase["status"] = "pending";
    let delayDays = 0;
    let desc = "";

    if (saldoDevedor <= 0) {
      status = "paid";
      delayDays = recDataPg && recVencimento ? Math.floor((recDataPg.getTime() - recVencimento.getTime()) / 86400000) : 0;
      desc = `Fatura Paga ${recNumero ?? ""}`.trim();
    } else {
      const today = new Date();
      delayDays = recVencimento ? Math.floor((today.getTime() - recVencimento.getTime()) / 86400000) : 0;
      if (delayDays > 0) {
        status = "overdue";
        desc = `Fatura Vencida ${recNumero ?? ""} (Saldo: R$ ${saldoDevedor.toFixed(2)})`.trim();
      } else {
        status = "pending";
        delayDays = 0;
        desc = `Fatura a Vencer ${recNumero ?? ""} (Saldo: R$ ${saldoDevedor.toFixed(2)})`.trim();
      }
    }

    if (status === "paid" || status === "overdue") {
      totalEvaluated += 1;
      if (status === "overdue") {
        overdueOpen += 1;
        totalDelay += delayDays;
      } else if (delayDays > 0) {
        paidLate += 1;
        totalDelay += delayDays;
      } else {
        paidOnTime += 1;
        if (paymentCode === "T") paidCash += 1;
      }
    }

    purchases.push({
      id: recNumero != null ? `DB${dbIdx}-${recNumero}` : `FAT-DB${dbIdx}-${idx}`,
      date: normalizeDate(pdvData),
      description: `${desc} (Base ${dbIdx})`,
      orderId: recPedido != null ? `DB${dbIdx}-${recPedido}` : null,
      value: recValor,
      dueDate: normalizeDate(recVencimento),
      paymentDate: recDataPg ? normalizeDate(recDataPg) : null,
      paymentCode,
      paymentMethod: paymentCode ? (PAYMENT_LABEL[paymentCode] || "Outro") : "Outro",
      delayDays,
      status,
    });
  });

  const maxOrder = Math.max(...Object.values(groupedOrders), 0);
  const originalLimit = Math.max(5000, maxOrder * 2);
  const adjustments: Adjustment[] = [];

  let score = 500;
  if (totalEvaluated > 0) {
    const pointsOnTime = Math.floor((paidOnTime / totalEvaluated) * 500);
    const pointsLate = Math.floor((paidLate / totalEvaluated) * 200);
    const pointsOverdue = Math.floor((overdueOpen / totalEvaluated) * 500);
    const pointsCash = Math.floor((paidCash / totalEvaluated) * 50);

    score = 500 + pointsOnTime - pointsLate - pointsOverdue + pointsCash;
    if (pointsOnTime) adjustments.push({ reason: `Pagamentos pontuais (${paidOnTime} faturas)`, points: pointsOnTime, limiteChange: 0 });
    if (pointsLate) adjustments.push({ reason: `Pagamentos com atraso (${paidLate} faturas)`, points: -pointsLate, limiteChange: 0 });
    if (pointsOverdue) adjustments.push({ reason: `Faturas vencidas (${overdueOpen} faturas)`, points: -pointsOverdue, limiteChange: 0 });
    if (pointsCash) adjustments.push({ reason: `Bônus: Pagamento À Vista/PIX (${paidCash} faturas)`, points: pointsCash, limiteChange: 0 });
  }

  if (boughtMachine) {
    score += 100;
    adjustments.push({ reason: "Bônus Perfil: Compra de Máquinas", points: 100, limiteChange: 0 });
  }

  score = Math.max(0, Math.min(1000, Math.floor(score)));
  const avgDelay = totalEvaluated > 0 ? Math.round((totalDelay / totalEvaluated) * 10) / 10 : 0;

  let riskFactor = 1;
  if (score >= 800) riskFactor = 1.5;
  else if (score >= 600) riskFactor = 1.2;
  else if (score >= 400) riskFactor = 1;
  else if (score >= 200) riskFactor = 0.5;
  else riskFactor = 0;

  const adjustedLimit = originalLimit * riskFactor;
  const limitDiff = adjustedLimit - originalLimit;
  if (limitDiff !== 0) {
    adjustments.push({ reason: `Ajuste de Risco (Score: ${score})`, points: 0, limiteChange: limitDiff });
  }

  return res.json({
    client: {
      codigo: clientCode,
      razaoSocial: String(clientInfo.CLI_NOME || ""),
      cnpj: String(clientInfo.CLI_CNPJ || ""),
      endereco: String(clientInfo.CLI_ENDERECO || ""),
      bairro: String(clientInfo.CLI_BAIRRO || ""),
      cep: String(clientInfo.CLI_CEP || ""),
      limiteCredito: originalLimit,
      purchases,
    },
    scoreResult: {
      score,
      limiteCredito: adjustedLimit,
      atrasoMedio: avgDelay,
      adjustments,
    },
  });
});

export default router;
