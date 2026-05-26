import { getPool } from "../db/sqlserver";
import type { CanalResumo } from "../routes/ecommerce-disparo";

const TABELA = "DOVALE.dbo.[TI-MARKETING_95-VendaEcommerce]";

// Mapeamento exato de PDV_OBS1 → nome exibido no painel
const MAPA_CANAIS: Record<string, string> = {
  "ml full":                        "Mercado Livre",
  "mercado livre":                  "Mercado Livre",
  "mercadolivre":                   "Mercado Livre",
  "shopee full":                    "Shopee",
  "shopee":                         "Shopee",
  "amazon full":                    "Amazon",
  "amazon":                         "Amazon",
  "loja virtual":                   "Site",
  "site":                           "Site",
  "tray":                           "Site",
  "ecommerce":                      "Site",
  "e-commerce":                     "Site",
  "magazine luiza":                 "Magazine Luiza",
  "magalu":                         "Magazine Luiza",
  "tiktok shop":                    "TikTok Shop",
  "tiktok":                         "TikTok Shop",
  "cnova":                          "C&Nova",
};

const IGNORAR = ["cliente retira", "retira na industria", "retira na loja"];

function normalizarCanal(obs: string | null): string | null {
  if (!obs) return null;
  const lower = obs.trim().toLowerCase();
  if (IGNORAR.some((p) => lower.includes(p))) return null;
  for (const [chave, nome] of Object.entries(MAPA_CANAIS)) {
    if (lower.includes(chave)) return nome;
  }
  return obs.trim();
}

interface RowCanal {
  obs:        string | null;
  faturamento: number;
  pedidos:    number;
  faturamento_anterior: number;
  pedidos_anterior: number;
}

async function queryCanais(filtroAtual: string, filtroAnterior: string): Promise<RowCanal[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    WITH atual AS (
      SELECT
        PDV_OBS1                   AS obs,
        SUM(VALORTOTALITEM)        AS faturamento,
        COUNT(DISTINCT PVI_NUMERO) AS pedidos
      FROM ${TABELA}
      WHERE ${filtroAtual}
        AND (STATUS IS NULL OR STATUS NOT IN ('CANCELADO','CANCELED','CANCELD','ESTORNADO'))
        AND PDV_OBS1 IS NOT NULL
      GROUP BY PDV_OBS1
    ),
    anterior AS (
      SELECT
        PDV_OBS1                   AS obs,
        SUM(VALORTOTALITEM)        AS faturamento,
        COUNT(DISTINCT PVI_NUMERO) AS pedidos
      FROM ${TABELA}
      WHERE ${filtroAnterior}
        AND (STATUS IS NULL OR STATUS NOT IN ('CANCELADO','CANCELED','CANCELD','ESTORNADO'))
        AND PDV_OBS1 IS NOT NULL
      GROUP BY PDV_OBS1
    )
    SELECT
      a.obs,
      ISNULL(a.faturamento, 0)  AS faturamento,
      ISNULL(a.pedidos, 0)      AS pedidos,
      ISNULL(p.faturamento, 0)  AS faturamento_anterior,
      ISNULL(p.pedidos, 0)      AS pedidos_anterior
    FROM atual a
    LEFT JOIN anterior p ON p.obs = a.obs
  `);
  return result.recordset;
}

function agruparPorCanal(rows: RowCanal[]): CanalResumo[] {
  const mapa = new Map<string, { fat: number; fat_ant: number; pedidos: number }>();

  for (const row of rows) {
    const canal = normalizarCanal(row.obs);
    if (!canal) continue;
    const atual = mapa.get(canal) ?? { fat: 0, fat_ant: 0, pedidos: 0 };
    mapa.set(canal, {
      fat:     atual.fat     + (row.faturamento ?? 0),
      fat_ant: atual.fat_ant + (row.faturamento_anterior ?? 0),
      pedidos: atual.pedidos + (row.pedidos ?? 0),
    });
  }

  const canais: CanalResumo[] = [];
  for (const [canal, dados] of mapa.entries()) {
    const ticketMedio = dados.pedidos > 0 ? dados.fat / dados.pedidos : 0;
    const variacao = dados.fat_ant > 0
      ? parseFloat((((dados.fat - dados.fat_ant) / dados.fat_ant) * 100).toFixed(1))
      : 0;
    canais.push({
      canal,
      faturamento:  parseFloat(dados.fat.toFixed(2)),
      pedidos:      dados.pedidos,
      ticket_medio: parseFloat(ticketMedio.toFixed(2)),
      conversao:    0,  // requer dados de tráfego
      margem:       0,  // requer dados de custo
      variacao,
    });
  }

  return canais.sort((a, b) => b.faturamento - a.faturamento);
}

export async function getCanaisDiario(data?: string): Promise<CanalResumo[] | null> {
  try {
    const filtroAtual = data
      ? `CAST(PDV_DATA AS DATE) = '${data}'`
      : `CAST(PDV_DATA AS DATE) = CAST(DATEADD(DAY,-1,GETDATE()) AS DATE)`;
    const filtroAnterior = data
      ? `CAST(PDV_DATA AS DATE) = CAST(DATEADD(DAY,-1,'${data}') AS DATE)`
      : `CAST(PDV_DATA AS DATE) = CAST(DATEADD(DAY,-2,GETDATE()) AS DATE)`;
    const rows = await queryCanais(filtroAtual, filtroAnterior);
    if (!rows.length) return null;
    return agruparPorCanal(rows);
  } catch {
    return null;
  }
}

export async function getCanaisMensal(): Promise<CanalResumo[] | null> {
  try {
    const rows = await queryCanais(
      `MONTH(PDV_DATA) = MONTH(GETDATE()) AND YEAR(PDV_DATA) = YEAR(GETDATE())`,
      `MONTH(PDV_DATA) = MONTH(DATEADD(MONTH,-1,GETDATE())) AND YEAR(PDV_DATA) = YEAR(DATEADD(MONTH,-1,GETDATE()))`
    );
    if (!rows.length) return null;
    return agruparPorCanal(rows);
  } catch {
    return null;
  }
}

// Endpoint de diagnóstico — mostra canais, status e o que está sendo excluído
export async function getCanaisRaw(): Promise<any> {
  try {
    const pool = await getPool();

    const [canais, status, semObs] = await Promise.all([
      pool.request().query(`
        SELECT
          PDV_OBS1                   AS obs,
          COUNT(DISTINCT PVI_NUMERO) AS pedidos,
          SUM(VALORTOTALITEM)        AS faturamento,
          MIN(PDV_DATA)              AS primeira_venda,
          MAX(PDV_DATA)              AS ultima_venda
        FROM ${TABELA}
        WHERE PDV_DATA >= DATEADD(DAY, -30, GETDATE())
          AND PDV_OBS1 IS NOT NULL
        GROUP BY PDV_OBS1
        ORDER BY faturamento DESC
      `),
      pool.request().query(`
        SELECT
          ISNULL(STATUS, '(null)') AS status,
          COUNT(DISTINCT PVI_NUMERO) AS pedidos,
          SUM(VALORTOTALITEM) AS faturamento
        FROM ${TABELA}
        WHERE PDV_DATA >= DATEADD(DAY, -30, GETDATE())
        GROUP BY STATUS
        ORDER BY pedidos DESC
      `),
      pool.request().query(`
        SELECT COUNT(DISTINCT PVI_NUMERO) AS pedidos_sem_canal
        FROM ${TABELA}
        WHERE PDV_DATA >= DATEADD(DAY, -30, GETDATE())
          AND PDV_OBS1 IS NULL
      `),
    ]);

    return {
      canais:           canais.recordset,
      status_existentes: status.recordset,
      pedidos_sem_canal: semObs.recordset[0]?.pedidos_sem_canal ?? 0,
    };
  } catch (e: any) {
    return { erro: e.message };
  }
}
