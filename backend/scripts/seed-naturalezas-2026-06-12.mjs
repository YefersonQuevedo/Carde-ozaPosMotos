// Siembra 2026-06-12: completa el catalogo de naturalezas con la lista del Excel
// del cliente (hoja NATURALEZAS). Idempotente: upsert por codigo (empresa 1).
// Tambien renombra RETENCION -> "Retención Mensual" y pone Dispersión Addi como "ambos".
import { prisma } from "../src/db.js";

const normalize = (v = "") => String(v).trim().toUpperCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

const NUEVAS = [
  { name: "Ingresos QR", kind: "ingreso" },
  { name: "Dispersión Gora", kind: "ambos" },
  { name: "Retiro de efectivo", kind: "ingreso" },
  { name: "Recursos Humanos", kind: "gasto" },
  { name: "Juan Pablo Vale", kind: "gasto" },
  { name: "Software, licencias y herramientas digitales", kind: "gasto" },
  { name: "Servicios profesionales externos", kind: "gasto" },
  { name: "Marketing y publicidad", kind: "gasto" },
  { name: "Impuestos", kind: "gasto", taxRelevant: true },
  { name: "Seguros Obligatorios, polizas y Auditorias", kind: "gasto" }
];

async function main() {
  for (const n of NUEVAS) {
    const code = normalize(n.name);
    const prev = await prisma.expenseNature.findFirst({ where: { code } });
    if (prev) { console.log("· ya existe:", code); continue; }
    await prisma.expenseNature.create({ data: { code, name: n.name, kind: n.kind, taxRelevant: n.taxRelevant === true, active: true } });
    console.log("✓ creada:", n.name, `(${code}, ${n.kind})`);
  }

  // Renombra RETENCION segun el Excel (mismo codigo: el historial no se toca).
  const ret = await prisma.expenseNature.findFirst({ where: { code: "RETENCION" } });
  if (ret && ret.name !== "Retención Mensual") {
    await prisma.expenseNature.update({ where: { id: ret.id }, data: { name: "Retención Mensual" } });
    console.log("✓ RETENCION renombrada a 'Retención Mensual'");
  } else console.log("· RETENCION ya está al día");

  // Dispersión Addi figura entre los ingresos del Excel: tipo "ambos" para que
  // salga en los dos formularios (era solo gasto).
  const addi = await prisma.expenseNature.findFirst({ where: { code: "DISPERSION_ADDI" } });
  if (addi && addi.kind !== "ambos") {
    await prisma.expenseNature.update({ where: { id: addi.id }, data: { kind: "ambos" } });
    console.log("✓ DISPERSION_ADDI ahora es 'ambos'");
  } else console.log("· DISPERSION_ADDI ya está al día");

  const total = await prisma.expenseNature.count();
  console.log(`Listo. Total naturalezas: ${total}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
