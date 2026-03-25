import { Router } from "express";
import { querySqlServer, getPool } from "../db/sqlserver";

const router = Router();

/** GET /api/metas?loja=bh&mes=3&ano=2026 */
router.get("/", async (req, res) => {
  const loja = (req.query.loja as string) || "bh";
  const mes  = Number(req.query.mes)  || new Date().getMonth() + 1;
  const ano  = Number(req.query.ano)  || new Date().getFullYear();

  try {
    const rows = await querySqlServer(`
      SELECT id, rep_codigo, rep_nome, loja, meta_valor, mes, ano
      FROM dbo.METAS_VENDEDORES
      WHERE loja = @loja AND mes = @mes AND ano = @ano
    `, { loja, mes, ano });
    res.json(rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/** POST /api/metas — salva ou atualiza meta de um vendedor */
router.post("/", async (req, res) => {
  const { rep_codigo, rep_nome, loja, meta_valor, mes, ano } = req.body;

  if (!rep_codigo || !loja || !meta_valor || !mes || !ano) {
    return res.status(400).json({ error: "Campos obrigatórios: rep_codigo, loja, meta_valor, mes, ano" });
  }

  try {
    const pool = await getPool();
    await pool.request()
      .input("rep_codigo",  rep_codigo)
      .input("rep_nome",    rep_nome)
      .input("loja",        loja)
      .input("meta_valor",  meta_valor)
      .input("mes",         mes)
      .input("ano",         ano)
      .query(`
        MERGE dbo.METAS_VENDEDORES AS target
        USING (SELECT @rep_codigo AS rep_codigo, @loja AS loja, @mes AS mes, @ano AS ano) AS source
          ON  target.rep_codigo = source.rep_codigo
          AND target.loja       = source.loja
          AND target.mes        = source.mes
          AND target.ano        = source.ano
        WHEN MATCHED THEN
          UPDATE SET
            rep_nome   = @rep_nome,
            meta_valor = @meta_valor
        WHEN NOT MATCHED THEN
          INSERT (rep_codigo, rep_nome, loja, meta_valor, mes, ano)
          VALUES (@rep_codigo, @rep_nome, @loja, @meta_valor, @mes, @ano);
      `);

    res.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/** DELETE /api/metas/:id */
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const pool = await getPool();
    await pool.request().input("id", id).query(`DELETE FROM dbo.METAS_VENDEDORES WHERE id = @id`);
    res.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
