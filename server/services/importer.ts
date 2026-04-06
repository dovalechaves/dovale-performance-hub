import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";

export interface ContatoRow {
  Nome: string;
  Numero: string;
  dadosExtras: Record<string, unknown>;
}

/**
 * Lê arquivo CSV/Excel e valida colunas obrigatórias Nome e Numero.
 * Retorna lista de contatos limpa (sem duplicatas, telefones sanitizados).
 */
export function validarArquivo(filePath: string): ContatoRow[] {
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

  // Normalizar nomes de colunas (BOM, espaços)
  const firstRow = rows[0];
  const colKeys = Object.keys(firstRow);
  const colMap: Record<string, string> = {};
  for (const k of colKeys) {
    const clean = k.replace(/^\uFEFF/, "").trim();
    colMap[clean.toLowerCase()] = k;
  }

  if (!colMap["nome"] || !colMap["numero"]) {
    throw new Error(
      `O arquivo deve conter as colunas 'Nome' e 'Numero'. Colunas encontradas: ${colKeys.join(", ")}`,
    );
  }

  const nomeKey = colMap["nome"];
  const numeroKey = colMap["numero"];

  const seen = new Set<string>();
  const result: ContatoRow[] = [];

  for (const row of rows) {
    const nome = String(row[nomeKey] ?? "").trim();
    const numero = sanitizarTelefone(String(row[numeroKey] ?? ""));
    if (!nome || !numero) continue;
    if (seen.has(numero)) continue;
    seen.add(numero);

    const extras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k !== nomeKey && k !== numeroKey) extras[k] = v;
    }
    result.push({ Nome: nome, Numero: numero, dadosExtras: extras });
  }

  return result;
}

function lerCsv(filePath: string): Record<string, unknown>[] {
  const raw = fs.readFileSync(filePath);
  const encodings: BufferEncoding[] = ["utf-8", "latin1"];
  const separators = [",", ";", "\t"];

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
        const cols = Object.keys(records[0]).map((c) => c.toLowerCase().replace(/^\uFEFF/, "").trim());
        if (cols.includes("nome") && cols.includes("numero")) return records;
      } catch {
        continue;
      }
    }
  }
  throw new Error("Não foi possível ler o arquivo CSV. Verifique o formato e as colunas.");
}

function lerExcel(filePath: string): Record<string, unknown>[] {
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Arquivo Excel vazio.");
  const sheet = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet);
}

/**
 * Remove caracteres não numéricos e garante formato E.164 (55 + DDD + Numero)
 */
export function sanitizarTelefone(telefone: string): string {
  const nums = telefone.replace(/\D/g, "");
  if (!nums) return "";
  if (nums.length <= 11) return `55${nums}`;
  return nums;
}
