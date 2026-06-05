import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const prisma = new PrismaClient();
const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Componentes fiscales internos (precios IVA-incluido) ---
const products = [
  { code: "5", name: "SERVICIO MOTOCICLETAS", unitPrice: 187053, taxRate: 19 },
  { code: "8", name: "RUNT MOTOCICLETAS", unitPrice: 5600, taxRate: 0 },
  { code: "9", name: "SICOV MOTOCICLETAS", unitPrice: 35492, taxRate: 19 },
  { code: "29", name: "RECAUDO MOTOCICLETAS", unitPrice: 10345, taxRate: 19 },
  { code: "1", name: "ANSV MOTOCICLETAS 2009-ANTES", unitPrice: 8800, taxRate: 0 },
  { code: "2", name: "ANSV MOTOCICLETAS 2010-2018", unitPrice: 9100, taxRate: 0 },
  { code: "3", name: "ANSV MOTOCICLETAS 2019-2023", unitPrice: 8800, taxRate: 0 },
  { code: "4", name: "ANSV MOTOCICLETAS 2024-2026", unitPrice: 8500, taxRate: 0 }
];

// --- Combos RTM por rango de modelo ---
const packages = [
  { code: "RTM-1", name: "MOTOCICLETAS 2009-ANTES", rangeName: "MOTOCICLETAS 2009-ANTES" },
  { code: "RTM-2", name: "MOTOCICLETAS 2010-2018", rangeName: "MOTOCICLETAS 2010-2018" },
  { code: "RTM-3", name: "MOTOCICLETAS 2019-2023", rangeName: "MOTOCICLETAS 2019-2023" },
  { code: "RTM-4", name: "MOTOCICLETAS 2024-2026", rangeName: "MOTOCICLETAS 2024-2026" }
];

const bundleMap = {
  "RTM-1": ["5", "8", "9", "29", "1"],
  "RTM-2": ["5", "8", "9", "29", "2"],
  "RTM-3": ["5", "8", "9", "29", "3"],
  "RTM-4": ["5", "8", "9", "29", "4"]
};

// --- Metodos de pago con regla de costo y comportamiento fiscal ---
const paymentMethods = [
  { code: "EFECTIVO", name: "Efectivo", groupCode: "CM", costType: "none" },
  { code: "DATAFONO SG", name: "Datafono Supergiros", groupCode: "SG", costType: "percent", costRate: 0.0079 },
  { code: "QR SG", name: "QR Supergiros", groupCode: "SG", costType: "fixed", costAmount: 1000 },
  { code: "QR CM", name: "QR empresarial", groupCode: "CM", costType: "none" },
  { code: "DATAFONO CM", name: "Datafono Certimotos", groupCode: "CM", costType: "percent", costRate: 0.04 },
  { code: "TRANSFERENCIA DIRECTA", name: "Transferencia directa", groupCode: "CM", costType: "none" },
  { code: "ADDI", name: "ADDI", groupCode: "CREDITO", isCredit: true, generatesReceivable: true, facturaDian: true, costType: "percent_plus_tax", costRate: 0.09, costTaxRate: 0.19 },
  { code: "ALIADOS DE INV. GORA SAS", name: "GORA", groupCode: "CREDITO", isCredit: true, generatesReceivable: true, facturaDian: true, costType: "none" },
  { code: "CREDITO PROPIO", name: "Credito propio", groupCode: "CREDITO", isCredit: true, generatesReceivable: true, costType: "fixed", costAmount: 1000 }
];

// Tarifas MOTO 2026 (replican el formato de cierre del cliente).
const tariffs = [
  { vehicleType: "MOTO", concept: "SICOV", value: 29825 },
  { vehicleType: "MOTO", concept: "RECAUDO", value: 8693 },
  { vehicleType: "MOTO", concept: "FUPA", value: 5600 },
  { vehicleType: "MOTO", concept: "SUSTRATOS", value: 800 },
  { vehicleType: "MOTO", concept: "IVA_FACT", value: 37185 },
  { vehicleType: "MOTO", concept: "IVA_RATE", value: 19 },
  { vehicleType: "MOTO", concept: "ANSV", value: 8500, yearFrom: 2024, yearTo: 9999 },
  { vehicleType: "MOTO", concept: "ANSV", value: 8800, yearFrom: 2019, yearTo: 2023 },
  { vehicleType: "MOTO", concept: "ANSV", value: 9100, yearFrom: 2010, yearTo: 2018 },
  { vehicleType: "MOTO", concept: "ANSV", value: 8800, yearFrom: 0, yearTo: 2009 }
];

// Cajas del negocio (caja menor, provisiones, IVA). Se pueden agregar mas desde la app.
const cashBoxes = [
  { code: "CAJA_MENOR", name: "Caja menor", kind: "caja_menor" },
  { code: "PROV_RTM", name: "Provision RTM pendientes", kind: "provision_rtm" },
  { code: "PROV_CONV", name: "Provision convenios", kind: "provision_convenio" },
  { code: "IVA", name: "Provision IVA", kind: "iva" }
];

async function main() {
  // Catalogos (idempotente por code)
  for (const p of products) {
    await prisma.product.upsert({ where: { code: p.code }, update: p, create: p });
  }
  for (const b of cashBoxes) {
    await prisma.cashBox.upsert({ where: { code: b.code }, update: { name: b.name, kind: b.kind }, create: b });
  }
  for (const p of packages) {
    await prisma.package.upsert({ where: { code: p.code }, update: p, create: p });
  }
  await prisma.packageComponent.deleteMany();
  for (const [packageCode, comps] of Object.entries(bundleMap)) {
    for (const productCode of comps) {
      await prisma.packageComponent.create({ data: { packageCode, productCode } });
    }
  }
  for (const m of paymentMethods) {
    await prisma.paymentMethod.upsert({ where: { code: m.code }, update: m, create: m });
  }

  // Tarifas (catalogo: se reescriben en cada seed)
  await prisma.tariff.deleteMany();
  for (const t of tariffs) await prisma.tariff.create({ data: t });

  // Usuario admin inicial (solo si no hay usuarios). Clave: admin123
  if ((await prisma.user.count()) === 0) {
    await prisma.user.create({
      data: { username: "admin", name: "Administrador", role: "admin", passwordHash: await bcrypt.hash("admin123", 10) }
    });
    console.log("Usuario admin creado (admin / admin123).");
  }

  // Convenios / aliados desde el Excel — solo si la tabla esta vacia (no pisar ediciones).
  const existingAllies = await prisma.ally.count();
  if (existingAllies > 0) {
    console.log(`Aliados ya cargados (${existingAllies}); no se reimportan.`);
    console.log(`Seed listo: ${products.length} productos, ${packages.length} paquetes, ${paymentMethods.length} metodos, ${tariffs.length} tarifas.`);
    return;
  }
  const conveniosPath = join(__dirname, "data", "convenios.json");
  const convenios = JSON.parse(readFileSync(conveniosPath, "utf-8"));

  // Usuario directo (fidelizado) siempre presente.
  await prisma.ally.create({
    data: { name: "USUARIO", company: "DIRECTO", commission: 20000, isDirectUser: true, enrolled: true, active: true }
  });

  for (const c of convenios) {
    if (c.name.toUpperCase() === "USUARIO") continue;
    await prisma.ally.create({
      data: {
        name: c.name,
        contactPhone: c.contactPhone || null,
        altPhone: c.altPhone || null,
        docType: c.docType || null,
        docNumber: c.docNumber || null,
        paymentMethod: c.paymentMethod || null,
        accountNumber: c.accountNumber || null,
        holderDocType: c.holderDocType || null,
        holderDoc: c.holderDoc || null,
        address: c.address || null,
        company: c.company || null,
        observation: c.observation || null,
        notes: c.notes || null,
        enrolled: !!c.enrolled,
        commission: 40000,
        isDirectUser: false,
        active: true
      }
    });
  }

  // Clientes/motos de ejemplo
  await prisma.client.upsert({
    where: { docNumber: "222222222222" },
    update: {},
    create: { docType: "CC", docNumber: "222222222222", name: "Consumidor final", status: "ACTIVO" }
  });
  await prisma.client.upsert({
    where: { docNumber: "900975741" },
    update: {},
    create: { docType: "NIT", docNumber: "900975741", name: "INVERSIONES GORA SAS", address: "Girardot", status: "ACTIVO" }
  });

  const count = await prisma.ally.count();
  console.log(`Seed listo: ${products.length} productos, ${packages.length} paquetes, ${paymentMethods.length} metodos, ${count} aliados.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
