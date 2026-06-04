import express from "express";
import cors from "cors";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import clients from "./routes/clients.js";
import vehicles from "./routes/vehicles.js";
import allies from "./routes/allies.js";
import catalog from "./routes/catalog.js";
import sales from "./routes/sales.js";
import closings from "./routes/closings.js";
import receivables from "./routes/receivables.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/clients", clients);
app.use("/api/vehicles", vehicles);
app.use("/api/allies", allies);
app.use("/api/catalog", catalog);
app.use("/api/sales", sales);
app.use("/api/closings", closings);
app.use("/api/receivables", receivables);

// Sirve el frontend estatico (../frontend).
app.use(express.static(join(__dirname, "..", "..", "frontend")));

// Manejo de errores uniforme.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Error interno" });
});

const PORT = process.env.PORT || 5180;
app.listen(PORT, () => {
  console.log(`MotoPOS API en http://127.0.0.1:${PORT}`);
});
