import { Router, Request, Response } from "express";
import sql from "mssql";
import { randomInt } from "crypto";
import { queryFirebird } from "../db/firebird";
import { getPool } from "../db/sqlserver";

// Sala dos Cofres: página pública (server/cofres) servida em /cofres.
// O cliente ganha 1 cofre a cada 1000 chaves compradas em SJC + MG (pedidos FF/AA).
const router = Router();
export default router;

const INICIO_CAMPANHA = "2026-11-01";
const CHAVES_POR_COFRE = 1000;
const TOTAL_COFRES = 200;
// valor do prêmio em R$ → unidades (200 prêmios, R$ 984)
export const ESTOQUE: Record<number, number> = { 3: 75, 4: 45, 5: 35, 7: 25, 10: 10, 12: 7, 15: 3 };

const falha = (status: number, msg: string) => Object.assign(new Error(msg), { status });

// Sorteio ponderado pelas unidades que ainda restam de cada prêmio.
export function sortearPremio(restantes: Record<number, number>, rnd: (max: number) => number = randomInt): number {
  const total = Object.values(restantes).reduce((a, b) => a + b, 0);
  if (!total) throw falha(409, "Todos os cofres foram abertos.");
  let ticket = rnd(total);
  for (const [valor, qtd] of Object.entries(restantes)) {
    ticket -= qtd;
    if (ticket < 0) return Number(valor);
  }
  throw new Error("Sorteio inválido");
}

let tabela: Promise<unknown> | null = null;
const garantirTabela = () =>
  (tabela ??= getPool()
    .then((p) => p.request().query(`
      IF OBJECT_ID('dbo.COFRES_ABERTOS', 'U') IS NULL
      CREATE TABLE dbo.COFRES_ABERTOS (
        cofre INT PRIMARY KEY,
        cli_codigo INT NOT NULL,
        premio INT NOT NULL,
        aberto_em DATETIME NOT NULL DEFAULT GETDATE()
      )`))
    .catch((e) => { tabela = null; throw e; }));

// Mesmo critério de chave dos relatórios (nível1 PRODUÇÃO / nível2 CHAVE), sem tipos de venda que não são venda.
const SQL_CLIENTE = `
  SELECT c.cli_nome,
    (SELECT SUM(i.pvi_quantidade)
       FROM pedidos_vendas ped
       JOIN pedidos_vendas_itens i ON i.pvi_numero = ped.pdv_numero
       JOIN produtos p ON p.pro_codigo = i.pvi_pro_codigo
      WHERE ped.pdv_cli_codigo = c.cli_codigo
        AND p.pro_nivel1 = '1' AND p.pro_nivel2 = '1'
        AND ped.pdv_psi_codigo IN ('FF', 'AA')
        AND ped.pdv_tve_codigo NOT IN ('6', '7', '26', '34')
        AND ped.pdv_data >= '${INICIO_CAMPANHA}') AS chaves
  FROM clientes c
  WHERE c.cli_codigo = ?`;

async function chavesDoCliente(codigo: string) {
  if (!/^\d{1,9}$/.test(codigo)) throw falha(400, "Código de cliente inválido.");
  const bases = await Promise.all(
    (["sjc", "mg"] as const).map((loja) => queryFirebird<{ CLI_NOME: string; CHAVES: number | null }>(loja, SQL_CLIENTE, [Number(codigo)]))
  ).catch(() => { throw falha(502, "Não foi possível consultar o Microsys. Tente novamente."); });
  const linhas = bases.flat();
  if (!linhas.length) throw falha(404, "Cliente não encontrado.");
  return { codigo: Number(codigo), nome: linhas[0].CLI_NOME.trim(), chaves: linhas.reduce((s, l) => s + (Number(l.CHAVES) || 0), 0) };
}

function resumo(cli: { codigo: number; nome: string; chaves: number }, abertos: number) {
  const cofres = Math.floor(cli.chaves / CHAVES_POR_COFRE);
  return { ...cli, cofres, abertos, saldo: Math.max(0, cofres - abertos) };
}

// Estado da sala (sem identificar quem abriu)
router.get("/sala", async (_req: Request, res: Response) => {
  await garantirTabela();
  const { recordset } = await (await getPool()).request().query(`SELECT cofre, premio FROM dbo.COFRES_ABERTOS`);
  res.json({ abertos: Object.fromEntries(recordset.map((r) => [r.cofre, r.premio])) });
});

router.get("/cliente/:codigo", async (req: Request, res: Response) => {
  await garantirTabela();
  const cli = await chavesDoCliente(String(req.params.codigo));
  const { recordset } = await (await getPool()).request()
    .input("cli", sql.Int, cli.codigo)
    .query(`SELECT COUNT(*) AS n FROM dbo.COFRES_ABERTOS WHERE cli_codigo = @cli`);
  res.json(resumo(cli, recordset[0].n));
});

router.post("/abrir", async (req: Request, res: Response) => {
  const cofre = Number(req.body?.cofre);
  if (!Number.isInteger(cofre) || cofre < 1 || cofre > TOTAL_COFRES) throw falha(400, "Cofre inválido.");
  await garantirTabela();
  const cli = await chavesDoCliente(String(req.body?.codigo ?? ""));

  // Trava a tabela inteira (no máximo 200 linhas) para que dois cliques simultâneos não estourem o saldo nem o estoque.
  const tx = new sql.Transaction(await getPool());
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const { recordset } = await new sql.Request(tx).query(`SELECT cofre, cli_codigo, premio FROM dbo.COFRES_ABERTOS WITH (TABLOCKX, HOLDLOCK)`);
    if (recordset.some((r) => r.cofre === cofre)) throw falha(409, "Este cofre já foi aberto.");
    const abertos = recordset.filter((r) => r.cli_codigo === cli.codigo).length;
    if (!resumo(cli, abertos).saldo) throw falha(409, "Este cliente não tem cofres disponíveis para abrir.");

    const restantes = { ...ESTOQUE };
    for (const r of recordset) restantes[r.premio]--;
    const premio = sortearPremio(restantes);

    await new sql.Request(tx)
      .input("cofre", sql.Int, cofre)
      .input("cli", sql.Int, cli.codigo)
      .input("premio", sql.Int, premio)
      .query(`INSERT INTO dbo.COFRES_ABERTOS (cofre, cli_codigo, premio) VALUES (@cofre, @cli, @premio)`);
    await tx.commit();
    res.json({ premio, cliente: resumo(cli, abertos + 1) });
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
});
