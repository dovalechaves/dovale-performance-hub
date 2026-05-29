import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import vendasRouter from "./routes/vendas";
import metasRouter from "./routes/metas";
import syncRouter from "./routes/sync";
import representantesRouter from "./routes/representantes";
import authRouter from "./routes/auth";
import ecommerceRouter from "./routes/ecommerce";
import disparoRouter, { setSocketIO } from "./routes/disparo";
import aiAssistantRouter from "./routes/ai-assistant";
import multiPrecoRouter from "./routes/multi-preco";
import inventarioRouter, { setInventarioIO } from "./routes/inventario";
import onboardingRouter from "./routes/onboarding";
import scoreRouter from "./routes/score";
import cobrancaRouter from "./routes/cobranca";
import ecommerceDisparoRouter from "./routes/ecommerce-disparo";
import sugestaoComprasRouter from "./routes/sugestao-compras";
import salesCompassRouter from "./routes/sales-compass";
import { startSyncJob } from "./jobs/syncJob";
import { startStockSnapshotJob, runStockSnapshotManual, getStockSnapshotStatus } from "./jobs/stockSnapshotJob";
import { startMultiPrecoJob } from "./jobs/multiPrecoJob";
import { startCobrancaJob } from "./jobs/cobrancaJob";
import { setupSwagger } from "./swagger";

const app = express();
const PORT = Number(process.env.SERVER_PORT) || 3001;

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://localhost:3000")
  .split(",").map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.some(o => origin === o || origin.startsWith(o))) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.options("*", cors());
app.use(express.json());

app.use("/api/auth",            authRouter);
app.use("/api/vendas",          vendasRouter);
app.use("/api/metas",           metasRouter);
app.use("/api/sync",            syncRouter);
app.use("/api/representantes",  representantesRouter);
app.use("/api/ecommerce",       ecommerceRouter);
app.use("/api/disparo",         disparoRouter);
app.use("/api/ai-assistant",    aiAssistantRouter);
app.use("/api/multi-preco",     multiPrecoRouter);
app.use("/api/inventario",      inventarioRouter);
app.use("/api/onboarding",      onboardingRouter);
app.use("/api/score",           scoreRouter);
app.use("/api/cobranca",        cobrancaRouter);
app.use("/api/ecommerce-disparo", ecommerceDisparoRouter);
app.use("/api/sugestao-compras",  sugestaoComprasRouter);
app.use("/api/sales-compass",     salesCompassRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Stock Snapshot (Fechamento Histórico Estoque) ───────────────────────────
app.get("/api/stock-snapshot/status", (_req, res) => {
  res.json(getStockSnapshotStatus());
});

app.post("/api/stock-snapshot/run", async (_req, res) => {
  try {
    const result = await runStockSnapshotManual(true);
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ ok: false, erro: err.message || String(err) });
  }
});

app.get("/api/stock-snapshot/history", async (_req, res) => {
  try {
    const { getPool: getP } = await import("./db/sqlserver");
    const pool = await getP();
    const result = await pool.request().query(`
      SELECT EMP, VALORESTOQUE, VENDASRECEBIDAS, VENDASLOJASINDUSTRIA,
             CAR, LUCROBRUTO, LUCROREAL, LUCROREALINDUSTRIA, LUCROFINAL, DESPESAS, CAP,
             MESREFERENCIA, ANOREFERENCIA
      FROM DOVALE.dbo.[TI-FINANCEIRO_131-FechamentoLojas_Historico]
      WHERE MESREFERENCIA IS NOT NULL AND ANOREFERENCIA IS NOT NULL
      ORDER BY ANOREFERENCIA DESC, MESREFERENCIA DESC, EMP
    `);
    res.json(result.recordset);
  } catch (err: any) {
    res.status(500).json({ erro: err.message || String(err) });
  }
});

setupSwagger(app);

// Global error handler — garante CORS headers mesmo com exceções
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("[server] Erro não tratado:", err?.message ?? err);
  if (!res.headersSent) {
    res.status(err.status || 500).json({ erro: err.message || "Erro interno" });
  }
});

const httpServer = createServer(app);
const io = new SocketServer(httpServer, { cors: { origin: "*" } });
setSocketIO(io);
setInventarioIO(io);

io.on("connection", (socket) => {
  console.log(`[socket.io] cliente conectado: ${socket.id}`);
  socket.on("disconnect", () => console.log(`[socket.io] desconectado: ${socket.id}`));
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] rodando em http://0.0.0.0:${PORT}`);
  startStockSnapshotJob().catch((err) => console.error("[stock-snapshot] Erro ao iniciar:", err));
  startMultiPrecoJob();
  startCobrancaJob();
});
