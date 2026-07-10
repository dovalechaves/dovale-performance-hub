import cron from "node-cron";
import {
  getProductFirstMovementStatus,
  initializeProductFirstMovementStatus,
  runProductFirstMovementCheckAndPersist,
} from "../services/productFirstMovement";

const TIMEZONE = process.env.APP_TIMEZONE?.trim() || "America/Sao_Paulo";

export async function startProductFirstMovementJob() {
  await initializeProductFirstMovementStatus();
  const status = getProductFirstMovementStatus();
  if (status.lastRunAt) {
    console.log(`[product-first-movement] Última execução: ${new Date(status.lastRunAt).toLocaleString("pt-BR")}`);
  }

  cron.schedule(
    "0 16 * * *",
    async () => {
      try {
        const result = await runProductFirstMovementCheckAndPersist();
        console.log(`[product-first-movement] ${result.novosProdutos} novo(s) item(ns) notificado(s) às 16h.`);
      } catch (err: any) {
        console.error("[product-first-movement] Falha no agendamento:", err?.message || err);
      }
    },
    { timezone: TIMEZONE }
  );

  console.log(`[product-first-movement] Cron ativo — todo dia às 16:00 (${TIMEZONE}).`);
}
