import { Router } from "express";
import bcrypt from "bcrypt";
import { getPool } from "../db/sqlserver";

const router = Router();

/** POST /api/auth/login */
router.post("/login", async (req, res) => {
  const { usuario, senha } = req.body;

  if (!usuario || !senha) {
    return res.status(400).json({ error: "Usuário e senha obrigatórios." });
  }

  try {
    // 1. Autentica via API do AD (Dovale)
    const adRes = await fetch("https://api.dovale.com.br/LoginUsuario1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, senha }),
    });

    if (!adRes.ok) {
      return res.status(401).json({ error: "Usuário ou senha inválidos." });
    }

    const adData = await adRes.json().catch(() => ({}));

    // 2. Busca a role no banco local
    const pool = await getPool();
    const result = await pool.request()
      .input("usuario", usuario)
      .query(`
        SELECT role FROM dbo.USUARIOS_LOJAS
        WHERE usuario = @usuario AND ativo = 1
      `);

    const role = result.recordset[0]?.role ?? "viewer";

    res.json({
      token: adData?.token || adData?.access_token || `ad_${Date.now()}`,
      usuario,
      role,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/** POST /api/auth/seed — cria usuários de teste (remover em produção) */
router.post("/seed", async (req, res) => {
  const usuarios = [
    { usuario: "kevin.silva",   senha: "admin123",   role: "admin"   },
    { usuario: "gerente.teste", senha: "gerente123", role: "manager" },
    { usuario: "editor.teste",  senha: "editor123",  role: "editor"  },
    { usuario: "viewer.teste",  senha: "viewer123",  role: "viewer"  },
  ];

  try {
    const pool = await getPool();
    for (const u of usuarios) {
      const hash = await bcrypt.hash(u.senha, 10);
      await pool.request()
        .input("usuario", u.usuario)
        .input("hash",    hash)
        .input("role",    u.role)
        .query(`
          MERGE dbo.USUARIOS_LOJAS AS target
          USING (SELECT @usuario AS usuario) AS source
            ON target.usuario = source.usuario
          WHEN MATCHED THEN
            UPDATE SET senha_hash = @hash, role = @role
          WHEN NOT MATCHED THEN
            INSERT (usuario, senha_hash, role)
            VALUES (@usuario, @hash, @role);
        `);
    }
    res.json({ ok: true, criados: usuarios.map(u => u.usuario) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
