import "dotenv/config";
import express from "express";
import cors from "cors";
import vendasRouter from "./routes/vendas";
import metasRouter from "./routes/metas";
import syncRouter from "./routes/sync";
import representantesRouter from "./routes/representantes";
import authRouter from "./routes/auth";
import ecommerceRouter from "./routes/ecommerce";
import { startSyncJob } from "./jobs/syncJob";

const app = express();
const PORT = Number(process.env.SERVER_PORT) || 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use("/api/auth",            authRouter);
app.use("/api/vendas",          vendasRouter);
app.use("/api/metas",           metasRouter);
app.use("/api/sync",            syncRouter);
app.use("/api/representantes",  representantesRouter);
app.use("/api/ecommerce",       ecommerceRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] rodando em http://0.0.0.0:${PORT}`);
  // syncJob desativado — frontend busca direto do Firebird via /api/sync/vendas
});
