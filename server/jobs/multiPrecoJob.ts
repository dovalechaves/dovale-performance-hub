import cron from "node-cron";
import nodemailer from "nodemailer";

type SyncEvent = {
  status?: string;
  message?: string;
  storeName?: string;
  productCode?: string;
  oldPrice?: number;
  newPrice?: number;
  tableName?: string;
};

const TIMEZONE = process.env.APP_TIMEZONE?.trim() || "America/Sao_Paulo";
const DEFAULT_CRON = "0 3 * * *";

function getApiBaseUrl(): string {
  const envBase = process.env.MULTI_PRECO_INTERNAL_API_URL?.trim();
  if (envBase) return envBase.replace(/\/$/, "");

  const port = Number(process.env.SERVER_PORT) || 3001;
  return `http://127.0.0.1:${port}`;
}

function parseRecipients(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function hasSmtpConfig(): boolean {
  return Boolean(
    process.env.SMTP_SERVER &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASSWORD &&
    process.env.EMAIL_TO,
  );
}

function createTransporter() {
  const host = process.env.SMTP_SERVER!;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER!;
  const pass = process.env.SMTP_PASSWORD!;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

async function sendCriticalErrorEmail(errorMessage: string) {
  if (!hasSmtpConfig()) {
    console.log("[multi-preco-job] Configuração SMTP incompleta. Alerta crítico não enviado.");
    return;
  }

  const transporter = createTransporter();
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER!;
  const to = parseRecipients(process.env.EMAIL_TO);

  const subject = `🚨 ERRO CRÍTICO: Sincronização Multi-Preço - ${new Date().toLocaleDateString("pt-BR")}`;
  const text = [
    "Olá,",
    "",
    "A sincronização automática de preços encontrou um ERRO CRÍTICO e foi interrompida.",
    "",
    "Detalhes do Erro:",
    errorMessage,
    "",
    `Data/Hora: ${new Date().toLocaleString("pt-BR")}`,
    "",
    "Verifique o console do servidor para mais detalhes.",
  ].join("\n");

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
  });

  console.log("[multi-preco-job] Alerta crítico enviado por e-mail.");
}

function toCsvValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/;/g, ",").replace(/\r?\n/g, " ");
}

function formatPrice(v?: number): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "";
  return Number(v).toFixed(2).replace(".", ",");
}

function buildCsv(logs: SyncEvent[]): string {
  const header = "Data/Hora;Status;Loja;Codigo;Valor Anterior;Novo Preco;Tabela;Mensagem";
  const now = new Date().toLocaleString("pt-BR");

  const lines = logs.map((log) => {
    return [
      now,
      toCsvValue(log.status || ""),
      toCsvValue(log.storeName || ""),
      toCsvValue(log.productCode || ""),
      formatPrice(log.oldPrice),
      formatPrice(log.newPrice),
      toCsvValue(log.tableName || ""),
      toCsvValue(log.message || ""),
    ].join(";");
  });

  return [header, ...lines].join("\n");
}

async function sendCsvReportEmail(logs: SyncEvent[]) {
  if (!logs.length) {
    console.log("[multi-preco-job] Sem logs exportáveis. E-mail de relatório ignorado.");
    return;
  }

  if (!hasSmtpConfig()) {
    console.log("[multi-preco-job] Configuração SMTP incompleta. Relatório não enviado.");
    return;
  }

  const transporter = createTransporter();
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER!;
  const to = parseRecipients(process.env.EMAIL_TO);

  const csv = buildCsv(logs);
  const filename = `Relatorio_Sync_${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}.csv`;

  await transporter.sendMail({
    from,
    to,
    subject: `Relatório Sincronização Multi-Preço - ${new Date().toLocaleDateString("pt-BR")}`,
    text: "Olá,\n\nSegue em anexo o relatório CSV da sincronização automática de preços.\n\nAtt,\nSistema Multi-Preço",
    attachments: [
      {
        filename,
        content: Buffer.from(`\uFEFF${csv}`, "utf-8"),
        contentType: "text/csv",
      },
    ],
  });

  console.log(`[multi-preco-job] Relatório CSV enviado para ${to.join(", ")}.`);
}

async function runScheduledSyncInternal(): Promise<{ logs: SyncEvent[]; criticalError: string | null }> {
  const base = getApiBaseUrl();
  const url = `${base}/api/multi-preco/sync?usuario=SistemaAutomatico`;

  const response = await fetch(url, { method: "POST" });
  if (!response.ok || !response.body) {
    throw new Error(`Falha ao chamar endpoint de sync: HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const logs: SyncEvent[] = [];
  let criticalError: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";

    for (const line of parts) {
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line) as SyncEvent;
        if (evt.status === "success" || evt.status === "error") logs.push(evt);
        if (evt.status === "error" && String(evt.message || "").includes("Erro crítico:")) {
          criticalError = evt.message || "Erro crítico não especificado";
        }
      } catch {
        // ignora linhas inválidas
      }
    }
  }

  return { logs, criticalError };
}

export async function runMultiPrecoScheduledJob() {
  console.log(`[multi-preco-job] Iniciando sincronização automática (${new Date().toLocaleString("pt-BR")})...`);

  try {
    const { logs, criticalError } = await runScheduledSyncInternal();

    if (criticalError) {
      await sendCriticalErrorEmail(criticalError);
      return;
    }

    await sendCsvReportEmail(logs);
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error("[multi-preco-job] Erro na execução automática:", msg);

    try {
      await sendCriticalErrorEmail(msg);
    } catch (mailErr: any) {
      console.error("[multi-preco-job] Falha ao enviar alerta crítico:", mailErr?.message || String(mailErr));
    }
  }
}

export function startMultiPrecoJob() {
  const enabled = String(process.env.MULTI_PRECO_JOB_ENABLED || "true").toLowerCase() === "true";
  if (!enabled) {
    console.log("[multi-preco-job] Job desativado via MULTI_PRECO_JOB_ENABLED.");
    return;
  }

  const cronExpr = process.env.MULTI_PRECO_CRON?.trim() || DEFAULT_CRON;
  const runOnStartup = String(process.env.MULTI_PRECO_RUN_ON_STARTUP || "false").toLowerCase() === "true";

  let running = false;
  const guardedRun = async () => {
    if (running) {
      console.log("[multi-preco-job] Execução ignorada: job já está em andamento.");
      return;
    }
    running = true;
    try {
      await runMultiPrecoScheduledJob();
    } finally {
      running = false;
    }
  };

  cron.schedule(cronExpr, guardedRun, { timezone: TIMEZONE });
  console.log(`[multi-preco-job] Cron ativo (${cronExpr}) timezone=${TIMEZONE}`);

  if (runOnStartup) {
    guardedRun().catch((err) =>
      console.error("[multi-preco-job] Falha na execução inicial:", err?.message || String(err)),
    );
  }
}
