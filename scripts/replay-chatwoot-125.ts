/**
 * Replay Chatwoot — Disparo #125 (ddf_promo_090626)
 * Recria contato, conversa, etiqueta, time e nota privada no Chatwoot
 * para os 189 contatos que receberam a mensagem mas não foram registrados.
 *
 * Rodar: npx tsx scripts/replay-chatwoot-125.ts
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { integrarChatwoot, detalharTemplate } from "../server/services/disparo-engine";

const DISPARO_ID = 125;
const TEMPLATE_NOME = "ddf_promo_090626";
const LANG = "pt_BR";
const INBOX_ID = 1;
const DELAY_MS = 300; // delay entre contatos para não sobrecarregar o Chatwoot

const supa = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!,
);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`\n=== Replay Chatwoot — Disparo #${DISPARO_ID} ===\n`);

  // Busca logs SENT do disparo
  const { data: logs, error: logsErr } = await supa
    .from("logs_disparo")
    .select("contato_numero")
    .eq("disparo_id", DISPARO_ID)
    .eq("status", "SENT");

  if (logsErr) throw new Error(`Erro ao buscar logs: ${logsErr.message}`);
  if (!logs?.length) { console.log("Nenhum contato SENT encontrado."); return; }

  // Busca nomes na lista de contatos
  const { data: disparo } = await supa
    .from("disparos")
    .select("lista_id")
    .eq("id", DISPARO_ID)
    .single();

  const numeros = logs.map((l) => l.contato_numero);
  const { data: contatos } = await supa
    .from("contatos_lista")
    .select("numero, nome")
    .eq("lista_id", disparo!.lista_id)
    .in("numero", numeros);

  const nomeMap: Record<string, string> = {};
  for (const c of contatos ?? []) nomeMap[c.numero] = c.nome ?? "";

  // Corpo do template para a nota privada
  let corpoTemplate = "";
  try {
    const det = await detalharTemplate(TEMPLATE_NOME, LANG);
    if (det) {
      const partes: string[] = [];
      if (det.header_text) partes.push(`*${det.header_text}*`);
      if (det.body_text) partes.push(det.body_text);
      if (det.footer_text) partes.push(`_${det.footer_text}_`);
      corpoTemplate = partes.join("\n\n");
    }
  } catch {}

  // Etiqueta do template
  const etiquetaMap: Record<string, string> = {};
  const timesMap: Record<string, number> = {};
  try {
    const { data: cfgs } = await supa.from("template_configs").select("*");
    for (const r of cfgs ?? []) {
      if (r.etiqueta) etiquetaMap[r.template_nome] = r.etiqueta;
    }
    // Busca times direto no Chatwoot
    const { listarTimes } = await import("../server/services/chatwoot");
    const times = await listarTimes();
    for (const t of times) timesMap[t.name.toLowerCase()] = t.id;
  } catch {}

  console.log(`Contatos a processar: ${numeros.length}`);
  console.log(`Etiqueta do template: ${etiquetaMap[TEMPLATE_NOME] ?? "(nenhuma)"}\n`);

  let ok = 0;
  let err = 0;

  for (let i = 0; i < numeros.length; i++) {
    const numero = numeros[i];
    const nome = nomeMap[numero] ?? "";
    try {
      await integrarChatwoot(numero, nome, TEMPLATE_NOME, INBOX_ID, corpoTemplate, etiquetaMap, timesMap);
      ok++;
      process.stdout.write(`\r[${i + 1}/${numeros.length}] ✓ ${ok} ok  ${err} erros`);
    } catch (e: any) {
      err++;
      console.error(`\nErro em ${numero}: ${e.message}`);
    }
    if (i < numeros.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n\n=== Concluído: ${ok} criados, ${err} erros ===\n`);
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
