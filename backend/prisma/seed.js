import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();

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
  { code: "CREDITO PROPIO", name: "Credito propio", groupCode: "CREDITO", isCredit: true, generatesReceivable: true, costType: "fixed", costAmount: 1000 },
  // Cupon / descuento al usuario: NO es dinero real, completa el total para que la
  // factura salga plena y Supergiros (CM) se calcule completo; el CDA lo absorbe (diferencia Jasper).
  { code: "DESCUENTO_FENIX", name: "Cupón / descuento", groupCode: "CM", costType: "none" }
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

// Empresa que siembra este seed. El seed usa el PrismaClient crudo (sin la
// extension multi-empresa de src/db.js), y tenant.js usa 1 como fallback fuera
// de un request, asi que todo el catalogo base va a la empresa 1.
const COMPANY_ID = 1;

async function main() {
  // Empresa inicial. Sin esta fila, tenant.js apunta a una empresa inexistente.
  // El nombre real lo pone el cliente desde la app; aca solo un placeholder.
  if ((await prisma.company.count()) === 0) {
    await prisma.company.create({
      data: { id: COMPANY_ID, name: process.env.COMPANY_NAME?.trim() || "Mi empresa", active: true }
    });
    console.log("Empresa inicial creada.");
  }

  // Catalogos (idempotente por code).
  // OJO: el unique es compuesto (@@unique([companyId, code])), asi que el where
  // de los upsert tiene que ser companyId_code. Con { code } solo, Prisma falla.
  for (const p of products) {
    await prisma.product.upsert({
      where: { companyId_code: { companyId: COMPANY_ID, code: p.code } }, update: p, create: p
    });
  }
  for (const b of cashBoxes) {
    await prisma.cashBox.upsert({
      where: { companyId_code: { companyId: COMPANY_ID, code: b.code } },
      update: { name: b.name, kind: b.kind }, create: b
    });
  }
  for (const p of packages) {
    await prisma.package.upsert({
      where: { companyId_code: { companyId: COMPANY_ID, code: p.code } }, update: p, create: p
    });
  }
  await prisma.packageComponent.deleteMany();
  for (const [packageCode, comps] of Object.entries(bundleMap)) {
    for (const productCode of comps) {
      await prisma.packageComponent.create({ data: { packageCode, productCode } });
    }
  }
  for (const m of paymentMethods) {
    await prisma.paymentMethod.upsert({
      where: { companyId_code: { companyId: COMPANY_ID, code: m.code } }, update: m, create: m
    });
  }

  // Tarifas (catalogo: se reescriben en cada seed)
  await prisma.tariff.deleteMany();
  for (const t of tariffs) await prisma.tariff.create({ data: t });

  // Usuario admin inicial (solo si no hay usuarios).
  // La clave sale de ADMIN_PASSWORD; si no esta, se genera una al azar y se
  // imprime UNA sola vez. Nunca una clave fija: si no, todas las instalaciones
  // salen con la misma credencial conocida.
  if ((await prisma.user.count()) === 0) {
    const plain = process.env.ADMIN_PASSWORD?.trim() || randomBytes(9).toString("base64url");
    await prisma.user.create({
      data: { username: "admin", name: "Administrador", role: "admin", passwordHash: await bcrypt.hash(plain, 10) }
    });
    console.log("\n" + "=".repeat(52));
    console.log("  Usuario admin creado.");
    console.log(`  usuario: admin`);
    console.log(`  clave:   ${plain}`);
    console.log("  Anotala: no se vuelve a mostrar. Cambiala al entrar.");
    console.log("=".repeat(52) + "\n");
  }

  // Usuario directo (fidelizado) siempre presente.
  if ((await prisma.ally.count()) === 0) {
    await prisma.ally.create({
      data: { name: "USUARIO", company: "DIRECTO", commission: 20000, isDirectUser: true, enrolled: true, active: true }
    });
  }

  // Clientes base. "Consumidor final" lo necesita el POS para las ventas sin
  // cliente identificado, asi que va SIEMPRE (antes del corte de aliados).
  await prisma.client.upsert({
    where: { companyId_docNumber: { companyId: COMPANY_ID, docNumber: "222222222222" } },
    update: {},
    create: { docType: "CC", docNumber: "222222222222", name: "Consumidor final", status: "ACTIVO" }
  });
  await prisma.client.upsert({
    where: { companyId_docNumber: { companyId: COMPANY_ID, docNumber: "900975741" } },
    update: {},
    create: { docType: "NIT", docNumber: "900975741", name: "INVERSIONES GORA SAS", address: "Girardot", status: "ACTIVO" }
  });

  // --- Convenios / aliados (OPCIONAL, datos de UN cliente concreto) ---
  //
  // Estos son datos personales reales (nombres, cedulas, cuentas bancarias) de
  // los aliados de una empresa. NO van en el repo ni en la imagen Docker: cada
  // CDA carga los suyos. Por eso el archivo es externo y opcional.
  //
  //   SEED_ALLIES_FILE=/ruta/a/convenios.json npm run seed
  //
  // Sin esa variable, el seed termina aca y la instalacion arranca sin aliados,
  // que es lo correcto para un cliente nuevo.
  const alliesFile = process.env.SEED_ALLIES_FILE?.trim();
  if (!alliesFile) {
    console.log(`Seed base listo: ${products.length} productos, ${packages.length} paquetes, ${paymentMethods.length} metodos, ${tariffs.length} tarifas.`);
    console.log("Sin aliados (defini SEED_ALLIES_FILE para importarlos).");
    return;
  }
  if (!existsSync(alliesFile)) {
    console.error(`SEED_ALLIES_FILE apunta a un archivo que no existe: ${alliesFile}`);
    process.exit(1);
  }

  // Solo si la tabla esta vacia (aparte del USUARIO directo): no pisar ediciones.
  if ((await prisma.ally.count()) > 1) {
    console.log("Aliados ya cargados; no se reimportan.");
    return;
  }
  const convenios = JSON.parse(readFileSync(alliesFile, "utf-8"));

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

  const count = await prisma.ally.count();
  console.log(`Seed listo: ${products.length} productos, ${packages.length} paquetes, ${paymentMethods.length} metodos, ${count} aliados.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
