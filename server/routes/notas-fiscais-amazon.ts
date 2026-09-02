import { Router } from "express";
import multer from "multer";
import { importarZipNotasFiscais, listarNotasFiscais } from "../services/notas-fiscais-amazon.service";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/zip" || file.originalname.toLowerCase().endsWith(".zip")) cb(null, true);
    else cb(new Error("Envie um arquivo .zip exportado do Faturador da Amazon."));
  },
});

/** POST /api/notas-fiscais-amazon/importar — recebe o .zip do Faturador Amazon e importa (idempotente por ChaveAcesso) */
router.post("/importar", upload.single("arquivo"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ erro: "Nenhum arquivo enviado. Campo esperado: 'arquivo'." });
    return;
  }
  try {
    const importadoPor = (req.headers["x-dovale-usuario"] as string) || null;
    const resultado = await importarZipNotasFiscais(req.file.buffer, {
      arquivoOrigemZip: req.file.originalname,
      importadoPor,
    });
    res.json(resultado);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[notas-fiscais-amazon] Erro ao importar ZIP:", message);
    res.status(500).json({ erro: `Falha ao importar: ${message}` });
  }
});

/** GET /api/notas-fiscais-amazon?busca=&pagina=&limite= — lista notas já importadas */
router.get("/", async (req, res) => {
  try {
    const pagina = Math.max(1, Number(req.query.pagina) || 1);
    const limite = Math.min(200, Math.max(1, Number(req.query.limite) || 50));
    const busca = typeof req.query.busca === "string" ? req.query.busca.trim() : "";
    const resultado = await listarNotasFiscais({ busca: busca || undefined, pagina, limite });
    res.json(resultado);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[notas-fiscais-amazon] Erro ao listar notas:", message);
    res.status(500).json({ erro: `Falha ao listar notas: ${message}` });
  }
});

export default router;
