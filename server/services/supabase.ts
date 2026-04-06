import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupa(): SupabaseClient {
  const url = (process.env.SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_KEY ?? "").trim();
  if (!url || !key) throw new Error("Configure SUPABASE_URL e SUPABASE_KEY no .env");
  if (!_client) _client = createClient(url, key);
  return _client;
}

export function resetSupa(): void {
  _client = null;
}

/**
 * Busca todos os registros paginando (Supabase limita 1000/req por padrão).
 */
export async function supaGetAll<T = Record<string, unknown>>(
  tableName: string,
  query: { column?: string; value?: unknown; inColumn?: string; inValues?: string[] } = {},
  select = "*",
  pageSize = 1000,
): Promise<T[]> {
  const supa = getSupa();
  const all: T[] = [];
  let offset = 0;
  while (true) {
    let qb = supa.from(tableName).select(select);
    if (query.column && query.value !== undefined) qb = qb.eq(query.column, query.value);
    if (query.inColumn && query.inValues) qb = qb.in(query.inColumn, query.inValues);
    const { data, error } = await qb.range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

/**
 * Insere registros em lotes para evitar limite de payload.
 */
export async function supaInsertBatch(
  tableName: string,
  rows: Record<string, unknown>[],
  batchSize = 500,
): Promise<void> {
  const supa = getSupa();
  for (let i = 0; i < rows.length; i += batchSize) {
    const { error } = await supa.from(tableName).insert(rows.slice(i, i + batchSize));
    if (error) throw error;
  }
}
