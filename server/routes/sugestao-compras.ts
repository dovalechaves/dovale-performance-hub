import { Router } from "express";
import { queryFirebird } from "../db/firebird";

const router = Router();

interface LojaConfig {
  nome: string;
  lojaKey: Parameters<typeof queryFirebird>[0];
  filialId: number;
  visible: boolean;
}

const LOJAS_CONFIG: Record<string, LojaConfig> = {
  "1": { nome: "SJC",        lojaKey: "sjc",        filialId: 1,  visible: false },
  "2": { nome: "BH",         lojaKey: "bh",         filialId: 2,  visible: true  },
  "3": { nome: "Fortaleza",  lojaKey: "fortaleza",  filialId: 1,  visible: true  },
  "4": { nome: "RJ",         lojaKey: "l3",         filialId: 9,  visible: true  },
  "5": { nome: "UBERLANDIA", lojaKey: "uberlandia", filialId: 12, visible: true  },
  "6": { nome: "SANTANA",    lojaKey: "l2",         filialId: 1,  visible: true  },
  "7": { nome: "GOIANIA",    lojaKey: "goiania",    filialId: 1,  visible: true  },
  "8": { nome: "CAMPINAS",   lojaKey: "campinas",   filialId: 1,  visible: true  },
  "9": { nome: "MG",         lojaKey: "mg",         filialId: 7,  visible: false },
};

async function getEstoqueBase(lojaId: string, codigos: string[]): Promise<Record<string, number>> {
  const config = LOJAS_CONFIG[lojaId];
  if (!config || codigos.length === 0) return {};

  const estoque: Record<string, number> = {};
  const chunkSize = 500;

  for (let i = 0; i < codigos.length; i += chunkSize) {
    const chunk = codigos.slice(i, i + chunkSize);
    const inClause = chunk.map(() => "?").join(",");
    const sql = `
      SELECT p.pro_codigo,
             COALESCE((SELECT disponivel FROM CONSULTA_ESTOQUE(p.pro_codigo, ${config.filialId}, 1, 0, CAST('NOW' AS DATE))), 0) AS saldo
      FROM produtos p
      WHERE p.pro_codigo IN (${inClause})
    `;
    try {
      const rows = await queryFirebird<{ PRO_CODIGO: any; SALDO: any }>(config.lojaKey, sql, chunk);
      for (const row of rows) {
        estoque[row.PRO_CODIGO?.toString().trim()] = Number(row.SALDO) || 0;
      }
    } catch (err) {
      console.error(`[sugestao-compras] getEstoqueBase chunk error (${config.nome}):`, err);
    }
  }

  return estoque;
}

/** GET /api/sugestao-compras/lojas */
router.get("/lojas", (_req, res) => {
  const lojas = Object.entries(LOJAS_CONFIG)
    .filter(([, c]) => c.visible)
    .map(([id, c]) => ({ id, nome: c.nome }));
  res.json(lojas);
});

/** GET /api/sugestao-compras/sugestoes?loja=2  (SSE stream) */
router.get("/sugestoes", async (req, res) => {
  const lojaId = String(req.query.loja || "2");
  const config = LOJAS_CONFIG[lojaId];

  if (!config) return res.status(400).json({ error: "Loja não configurada." });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const pingInterval = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => clearInterval(pingInterval));

  const sql = `
    WITH params AS (
      SELECT DATEADD(MONTH, -4, CAST('NOW' AS DATE)) AS data_corte FROM RDB$DATABASE
    ),
    vendas AS (
      SELECT
        i.pvi_pro_codigo,
        MAX(i.pvi_und_codigo) AS pvi_und_codigo,
        SUM(i.pvi_quantidade) / 4.0 AS media_venda
      FROM pedidos_vendas_itens i
      INNER JOIN pedidos_vendas ped ON ped.pdv_numero = i.pvi_numero
      CROSS JOIN params p
      WHERE ped.pdv_data > p.data_corte
        AND ped.pdv_psi_codigo NOT IN ('CC')
        AND ped.pdv_tve_codigo NOT IN ('7', '6')
      GROUP BY i.pvi_pro_codigo
    ),
    base AS (
      SELECT '${config.nome}' AS emp, p.pro_codigo, p.pro_resumo, tp.tbp_custo, tp.tbp_preco,
             a.nome AS grupo, b.nome AS subgrupo, c.nome AS familia, d.nome AS secao,
             forn.cli_codigo, forn.cli_nome,
             COALESCE(v.media_venda, 0) AS media_venda,
             v.pvi_und_codigo AS unidade,
             COALESCE((SELECT disponivel FROM CONSULTA_ESTOQUE(p.pro_codigo, ${config.filialId}, 1, 0, CAST('NOW' AS DATE))), 0) AS saldo
      FROM produtos p
      INNER JOIN produtos_nivel1 a  ON a.codigo = p.pro_nivel1
      LEFT  JOIN produtos_nivel2 b  ON b.codigo = p.pro_nivel2
      LEFT  JOIN produtos_nivel3 c  ON c.codigo = p.pro_nivel3
      LEFT  JOIN produtos_nivel4 d  ON d.codigo = p.pro_nivel4
      LEFT  JOIN tabelas_produtos tp ON tp.tbp_pro_codigo = p.pro_codigo AND tp.tbp_tab_codigo = '1'
      LEFT  JOIN clientes forn       ON forn.cli_codigo = p.pro_for_codigo
      LEFT  JOIN vendas v            ON v.pvi_pro_codigo = p.pro_codigo
      WHERE p.pro_situacao = 'A'
    )
    SELECT emp, pro_codigo, pro_resumo, unidade, tbp_custo, tbp_preco,
           grupo, subgrupo, familia, secao, cli_codigo, cli_nome,
           media_venda, saldo,
           media_venda - saldo AS sugestao_1mes,
           (media_venda * 3) - saldo AS sugestao_3meses,
           (media_venda * 6) - saldo AS sugestao_6meses
    FROM base
    WHERE media_venda - saldo > 0
    ORDER BY media_venda DESC
  `;

  try {
    const result = await queryFirebird<Record<string, any>>(config.lojaKey, sql);

    const items = result.map((row) => {
      const mediaMensal = Number(row.MEDIA_VENDA) || 0;
      const saldoAtual = Number(row.SALDO) || 0;
      return {
        id: `${lojaId}-${row.PRO_CODIGO?.toString().trim()}`,
        codigo: row.PRO_CODIGO?.toString().trim() || "",
        descricao: row.PRO_RESUMO?.toString().trim() || "",
        unidade: row.UNIDADE?.toString().trim() || "UN",
        categoria: row.GRUPO?.toString().trim() || "Geral",
        estoqueAtual: saldoAtual,
        mediaDiaria: mediaMensal / 30,
        sugestao30: Math.max(0, Math.ceil(Number(row.SUGESTAO_1MES) || 0)),
        sugestao90: Math.max(0, Math.ceil(Number(row.SUGESTAO_3MESES) || 0)),
        sugestao180: Math.max(0, Math.ceil(Number(row.SUGESTAO_6MESES) || 0)),
        precoUnitario: Number(row.TBP_PRECO) || 0,
        estoqueSjc: 0,
      };
    });

    const CHUNK = 200;
    for (let i = 0; i < items.length; i += CHUNK) {
      send("chunk", items.slice(i, i + CHUNK));
    }

    if (items.length > 0) {
      const estoqueSjc = await getEstoqueBase("1", items.map((i) => i.codigo)).catch((err) => {
        console.error("[sugestao-compras] Erro ao buscar estoque SJC:", err);
        return {} as Record<string, number>;
      });
      send("estoque", estoqueSjc);
    }

    send("done", { total: items.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sugestao-compras] Erro na query de sugestões (${config.nome}):`, message);
    send("error", { error: `Erro de conexão com a loja ${config.nome}: ${message}` });
  } finally {
    clearInterval(pingInterval);
    res.end();
  }
});

/** POST /api/sugestao-compras/verificar-estoques */
router.post("/verificar-estoques", async (req, res) => {
  const { codigos } = req.body;
  if (!codigos || !Array.isArray(codigos) || codigos.length === 0) {
    return res.json({ sjc: {}, mg: {} });
  }

  try {
    const [estoqueSjc, estoqueMg] = await Promise.allSettled([
      getEstoqueBase("1", codigos),
      getEstoqueBase("9", codigos),
    ]);

    if (estoqueSjc.status === "rejected") {
      return res.status(500).json({ error: "Erro na conexão com base SJC." });
    }

    res.json({
      sjc: estoqueSjc.value,
      mg: estoqueMg.status === "fulfilled" ? estoqueMg.value : {},
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
