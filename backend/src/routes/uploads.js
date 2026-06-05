// Subida de archivos (comprobantes de pago de convenios, escaneos firmados, etc.).
// Guarda en backend/uploads/ y devuelve la URL servible (/uploads/<archivo>).
// El frontend manda multipart/form-data con el campo "file".
import { Router } from "express";
import multer from "multer";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const UPLOADS_DIR = join(__dirname, "..", "..", "uploads");
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".pdf"]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname || "").toLowerCase();
    const safe = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, safe);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname || "").toLowerCase();
    if (!ALLOWED.has(ext)) return cb(new Error("Tipo de archivo no permitido"));
    cb(null, true);
  }
});

const router = Router();

// POST /api/uploads  (campo "file") -> { ok, path, url }
router.post("/", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "No se recibio archivo" });
  const url = `/uploads/${req.file.filename}`;
  res.json({ ok: true, path: url, url, filename: req.file.filename });
});

export default router;
