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
app.use("/api/disparo",         disparoRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

const httpServer = createServer(app);
const io = new SocketServer(httpServer, { cors: { origin: "*" } });
setSocketIO(io);

io.on("connection", (socket) => {
  console.log(`[socket.io] cliente conectado: ${socket.id}`);
  socket.on("disconnect", () => console.log(`[socket.io] desconectado: ${socket.id}`));
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] rodando em http://0.0.0.0:${PORT}`);
});
