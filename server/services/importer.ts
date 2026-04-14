import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";

export interface ContatoRow {
  Nome: string;
  Numero: string;
  dadosExtras: Record<string, unknown>;
}

export interface ImportResult {
  contatos: ContatoRow[];
  descartados: number;
}

// Aliases aceitos para cada campo (tudo lowercase)
const NOME_ALIASES = new Set([
  "nome", "name", "cliente", "contato", "razao", "razao_social", "razaosocial",
]);
const NUMERO_ALIASES = new Set([
  "numero", "número", "telefone", "fone", "celular", "whatsapp", "whats",
  "phone", "tel", "mobile", "number", "num",
]);

/**
 * Detecta qual chave original do objeto corresponde a nome e numero,
 * usando aliases flexíveis. Retorna { nomeKey, numeroKey } ou null.
 */
function detectarColunas(
  colKeys: string[],
): { nomeKey: string | null; numeroKey: string | null } {
  let nomeKey: string | null = null;
  let numeroKey: string | null = null;

  for (const k of colKeys) {
    const clean = k.replace(/^\uFEFF/, "").trim().toLowerCase();
    if (!nomeKey && NOME_ALIASES.has(clean)) nomeKey = k;
    if (!numeroKey && NUMERO_ALIASES.has(clean)) numeroKey = k;
  }
  return { nomeKey, numeroKey };
}

/**
 * Lê arquivo CSV/Excel e retorna lista de contatos limpa.
 * Aceita:
 *   - Colunas "Nome" + "Numero" (ou aliases como Telefone, WhatsApp, etc.)
 *   - Apenas coluna de número (sem nome — usa "Contato 1", "Contato 2", ...)
 *   - Duas colunas quaisquer onde uma parece ser nome e outra número
 */
export function validarArquivo(filePath: string): ImportResult {
  const ext = path.extname(filePath).toLowerCase();
  let rows: Record<string, unknown>[];

  if (ext === ".csv") {
    rows = lerCsv(filePath);
  } else if (ext === ".xls" || ext === ".xlsx") {
    rows = lerExcel(filePath);
  } else {
    throw new Error("Formato não suportado. Use CSV ou Excel.");
  }

  if (!rows.length) throw new Error("Arquivo vazio ou sem dados válidos.");

  const colKeys = Object.keys(rows[0]);
  let { nomeKey, numeroKey } = detectarColunas(colKeys);

  // Fallback: se não encontrou pelas aliases, tenta heurística
  if (!numeroKey) {
    // Se tem exatamente 2 colunas, assume 1ª = nome, 2ª = número
    if (colKeys.length === 2) {
      nomeKey = colKeys[0];
      numeroKey = colKeys[1];
    }
    // Se tem 1 coluna, assume que é número
    else if (colKeys.length === 1) {
      nomeKey = null;
      numeroKey = colKeys[0];
    }
    // Tenta achar a primeira coluna cujo primeiro valor pareça numérico
    else {
      for (const k of colKeys) {
        const val = String(rows[0][k] ?? "").replace(/\D/g, "");
        if (val.length >= 8) {
          numeroKey = k;
          break;
        }
      }
      // Se achou numero mas não nome, pega a primeira coluna que não seja o numero
      if (numeroKey && !nomeKey) {
        nomeKey = colKeys.find((k) => k !== numeroKey) ?? null;
      }
    }
  }

  if (!numeroKey) {
    throw new Error(
      `Não foi possível identificar a coluna de telefone. Colunas encontradas: ${colKeys.join(", ")}. ` +
      `Use uma das seguintes: ${[...NUMERO_ALIASES].join(", ")}`,
    );
  }

  const seen = new Set<string>();
  const result: ContatoRow[] = [];
  let descartados = 0;
  let idx = 0;

  for (const row of rows) {
    idx++;
    const rawNumero = String(row[numeroKey] ?? "");
    const numero = sanitizarTelefone(rawNumero);

    if (!numero) {
      descartados++;
      continue;
    }
    if (seen.has(numero)) {
      descartados++;
      continue;
    }
    seen.add(numero);

    const nome = nomeKey
      ? String(row[nomeKey] ?? "").trim() || `Contato ${idx}`
      : `Contato ${idx}`;

    const extras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k !== nomeKey && k !== numeroKey) extras[k] = v;
    }
    result.push({ Nome: nome, Numero: numero, dadosExtras: extras });
  }

  if (!result.length) {
    throw new Error(
      `Nenhum contato válido encontrado. ${descartados} linhas descartadas por número inválido (< 10 dígitos).`,
    );
  }

  return { contatos: result, descartados };
}

function lerCsv(filePath: string): Record<string, unknown>[] {
  const raw = fs.readFileSync(filePath);
  const encodings: BufferEncoding[] = ["utf-8", "latin1"];
  const separators = [",", ";", "\t"];

  let bestResult: Record<string, unknown>[] | null = null;

  for (const encoding of encodings) {
    const text = raw.toString(encoding);
    for (const delimiter of separators) {
      try {
        const records: Record<string, unknown>[] = parse(text, {
          columns: true,
          skip_empty_lines: true,
          delimiter,
          trim: true,
          bom: true,
        });
        if (!records.length) continue;

        const cols = Object.keys(records[0]).map((c) =>
          c.toLowerCase().replace(/^\uFEFF/, "").trim(),
        );

        // Preferência: se encontrar aliases exatas, retorna imediatamente
        const hasNumero = cols.some((c) => NUMERO_ALIASES.has(c));
        if (hasNumero) return records;

        // Senão, guarda como fallback (pode ser 2 colunas genéricas)
        if (!bestResult && records.length > 0) bestResult = records;
      } catch {
        continue;
      }
    }
  }

  if (bestResult) return bestResult;
  throw new Error("Não foi possível ler o arquivo CSV. Verifique o formato.");
}

function lerExcel(filePath: string): Record<string, unknown>[] {
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Arquivo Excel vazio.");
  const sheet = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet);
}

/**
 * Remove caracteres não numéricos, valida comprimento mínimo,
 * adiciona 9° dígito se necessário, e retorna formato E.164 (55 + DDD + Número).
 * Retorna "" se inválido.
 */
export function sanitizarTelefone(telefone: string): string {
  let nums = telefone.replace(/\D/g, "");
  if (!nums) return "";

  // Se já tem DDI 55, remove para normalizar
  if (nums.length >= 12 && nums.startsWith("55")) {
    nums = nums.slice(2);
  }

  // Número precisa ter no mínimo 10 dígitos (DDD + 8 dígitos)
  if (nums.length < 10) return "";

  // Se tem 10 dígitos (DDD + 8), adiciona o 9° dígito após o DDD
  // Ex: 16 9925 1934 → 16 9 9925 1934
  if (nums.length === 10) {
    const ddd = nums.slice(0, 2);
    const resto = nums.slice(2);
    // Celular começa com 9, 8, 7 ou 6 após DDD
    if (["9", "8", "7", "6"].includes(resto[0])) {
      nums = `${ddd}9${resto}`;
    } else {
      // Telefone fixo — ainda válido para WhatsApp Business
      nums = `${ddd}${resto}`;
    }
  }

  // Se após ajuste tem 11 dígitos, OK. Se > 11, pode ser inválido
  if (nums.length > 11) return "";

  return `55${nums}`;
}
