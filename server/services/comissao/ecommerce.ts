import { querySqlServer } from '../../db/sqlserver';

// Fonte: SQL Server (mesmo servidor do Hub), tabela de NF-e do e-commerce, 1 linha por item de nota.
//   NTV_DATA (data), VALORTOTAL (valor do item), EMP (filial/centro), PDV_OBS1 (texto livre do pedido),
//   PEDIDO_SHOPEE (nº do pedido Shopee).
const TABELA = '[TI-MARKETING_95-NFeEcommerce]';

// A tabela não tem uma coluna "plataforma" limpa. A plataforma é derivada nesta ordem:
//  1. EMP de fulfillment (ML FULL / SHOPEE FULL / AMAZON FULL) → plataforma do próprio centro
//  2. PDV_OBS1 conhecido (inclui "ML DV" = Mercado Livre)
//  3. PEDIDO_SHOPEE preenchido → Shopee
//  4. VENDA DIRETA e tudo que não for identificado → LOJA VIRTUAL (decisão do Willian, 16/10/2026)
export const PLATAFORMA_SQL = `CASE
  WHEN EMP = 'ML FULL' THEN 'MERCADO LIVRE'
  WHEN EMP = 'SHOPEE FULL' THEN 'SHOPEE'
  WHEN EMP = 'AMAZON FULL' THEN 'AMAZON'
  WHEN UPPER(LTRIM(RTRIM(PDV_OBS1))) IN ('MERCADO LIVRE', 'ML DV') THEN 'MERCADO LIVRE'
  WHEN UPPER(LTRIM(RTRIM(PDV_OBS1))) = 'SHOPEE' THEN 'SHOPEE'
  WHEN UPPER(LTRIM(RTRIM(PDV_OBS1))) = 'AMAZON' THEN 'AMAZON'
  WHEN UPPER(LTRIM(RTRIM(PDV_OBS1))) = 'MAGAZINE LUIZA' THEN 'MAGALU'
  WHEN UPPER(LTRIM(RTRIM(PDV_OBS1))) = 'TIKTOK SHOP' THEN 'TIKTOK'
  WHEN UPPER(LTRIM(RTRIM(PDV_OBS1))) = 'LOJA VIRTUAL' THEN 'LOJA VIRTUAL'
  WHEN UPPER(LTRIM(RTRIM(PDV_OBS1))) = 'VENDA DIRETA' THEN 'LOJA VIRTUAL'
  WHEN PEDIDO_SHOPEE IS NOT NULL THEN 'SHOPEE'
  ELSE 'LOJA VIRTUAL' END`;

// Nome de exibição da filial (EMP). A filial SJC é a da Loja Virtual da Dovale.
const FILIAL_LABEL: Record<string, string> = {
  'SJC': 'SJC (Loja Virtual)',
  'FAST': 'FAST',
  'SANTANA': 'Santana',
  'ML FULL': 'ML Full',
  'SHOPEE FULL': 'Shopee Full',
  'AMAZON FULL': 'Amazon Full',
};
export function filialLabel(emp: string): string {
  const e = String(emp ?? '').trim();
  return FILIAL_LABEL[e.toUpperCase()] ?? (e || 'Sem filial');
}

export interface EcomFilial { emp: string; filial: string; total: number }
export interface EcomPlataformaMes { plataforma: string; atual: number; anterior: number }
export interface EcomMes {
  ano: number;
  mes: number;
  inicio: string;
  fim: string;
  mes_em_andamento: boolean;
  total: number;
  total_anterior: number;
  por_filial: EcomFilial[];
  por_plataforma: EcomPlataformaMes[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d = 1) => `${y}-${pad(m)}-${pad(d)}`;

const CACHE_TTL_MS = 60_000;
const _cache = new Map<string, { exp: number; data: EcomMes }>();

// Faturamento do mês (e do mês anterior, para o crescimento por plataforma) numa única consulta.
export async function getEcommerceMes(ano: number, mes: number): Promise<EcomMes> {
  const chave = `${ano}-${mes}`;
  const c = _cache.get(chave);
  if (c && c.exp > Date.now()) return c.data;

  const prevAno = mes === 1 ? ano - 1 : ano;
  const prevMes = mes === 1 ? 12 : mes - 1;
  const proxAno = mes === 12 ? ano + 1 : ano;
  const proxMes = mes === 12 ? 1 : mes + 1;
  const ini = iso(ano, mes), prev = iso(prevAno, prevMes), fim = iso(proxAno, proxMes);

  const rows = await querySqlServer<{ atual: number; emp: string | null; plataforma: string; total: number }>(
    `SELECT CASE WHEN NTV_DATA >= @ini THEN 1 ELSE 0 END AS atual,
            EMP AS emp, ${PLATAFORMA_SQL} AS plataforma, SUM(VALORTOTAL) AS total
     FROM ${TABELA}
     WHERE NTV_DATA >= @prev AND NTV_DATA < @fim
     GROUP BY CASE WHEN NTV_DATA >= @ini THEN 1 ELSE 0 END, EMP, ${PLATAFORMA_SQL}`,
    { ini, prev, fim },
  );

  const filiais = new Map<string, number>();
  const plat = new Map<string, { atual: number; anterior: number }>();
  let total = 0, total_anterior = 0;
  for (const r of rows) {
    const v = Number(r.total) || 0;
    const p = plat.get(r.plataforma) ?? { atual: 0, anterior: 0 };
    if (r.atual === 1) {
      total += v; p.atual += v;
      const emp = String(r.emp ?? '').trim();
      filiais.set(emp, (filiais.get(emp) ?? 0) + v);
    } else {
      total_anterior += v; p.anterior += v;
    }
    plat.set(r.plataforma, p);
  }

  const hoje = new Date();
  const data: EcomMes = {
    ano, mes, inicio: ini, fim,
    mes_em_andamento: hoje.getFullYear() === ano && hoje.getMonth() + 1 === mes,
    total, total_anterior,
    por_filial: [...filiais.entries()]
      .map(([emp, t]) => ({ emp, filial: filialLabel(emp), total: t }))
      .sort((a, b) => b.total - a.total),
    por_plataforma: [...plat.entries()]
      .map(([plataforma, v]) => ({ plataforma, ...v }))
      .sort((a, b) => b.atual - a.atual),
  };
  _cache.set(chave, { exp: Date.now() + CACHE_TTL_MS, data });
  return data;
}

export interface EcomSerieMes { mes: number; total: number }

// Faturamento mês a mês do ano (gráfico de evolução).
export async function getEcommerceSerieAno(ano: number): Promise<EcomSerieMes[]> {
  const rows = await querySqlServer<{ mes: number; total: number }>(
    `SELECT MONTH(NTV_DATA) AS mes, SUM(VALORTOTAL) AS total
     FROM ${TABELA}
     WHERE NTV_DATA >= @ini AND NTV_DATA < @fim
     GROUP BY MONTH(NTV_DATA)`,
    { ini: iso(ano, 1), fim: iso(ano + 1, 1) },
  );
  const m = new Map(rows.map((r) => [Number(r.mes), Number(r.total) || 0]));
  return Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, total: m.get(i + 1) ?? 0 }));
}

export function invalidarCacheEcommerce(): void {
  _cache.clear();
}
