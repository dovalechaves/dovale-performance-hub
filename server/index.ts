import "dotenv/config";
import express from "express";
import cors from "cors";
import vendasRouter from "./routes/vendas";
import metasRouter from "./routes/metas";
import syncRouter from "./routes/sync";
import representantesRouter from "./routes/representantes";
import authRouter from "./routes/auth";
import { startSyncJob } from "./jobs/syncJob";

const app = express();
const PORT = Number(process.env.SERVER_PORT) || 3001;

app.use(cors({ origin: /^http:\/\/localhost:\d+$/ }));
app.use(express.json());

app.use("/api/auth",            authRouter);
app.use("/api/vendas",          vendasRouter);
app.use("/api/metas",           metasRouter);
app.use("/api/sync",            syncRouter);
app.use("/api/representantes",  representantesRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[server] rodando em http://localhost:${PORT}`);
  startSyncJob(5 * 60 * 1000); // sync a cada 5 minutos
});
