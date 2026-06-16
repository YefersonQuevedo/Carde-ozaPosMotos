// Siembra 2026-06-13 (empresa 1 / Certimotos), idempotente:
//  - 8 empleados del Excel (nomina).
//  - Saldo inicial de Bancolombia ($2.096.661) en la caja BANCO.
//  - Costos fijos mensuales como Obligaciones (arriendo, software, 4xmil+canal, contadores).
import { prisma } from "../src/db.js";

const EMP = [
  { name: "Rita Paola Torres Rodriguez", role: "Operadora CDA", paymentMethod: "banco", auxAlimentacion: 0 },
  { name: "Solfa Inés Salas Villanueva", role: "Operadora CDA", paymentMethod: "banco", auxAlimentacion: 0 },
  { name: "Antonio Bonifacio Castro Romero", role: "Inspector Técnico", paymentMethod: "banco", auxAlimentacion: 240072 },
  { name: "Daniela Alejandra Espinosa Manrique", role: "Operadora CDA", paymentMethod: "banco", auxAlimentacion: 0, startDate: "2026-03-18" },
  { name: "Leidy Katerin Suárez Galeano", role: "Operadora CDA", paymentMethod: "efectivo", auxAlimentacion: 640072 },
  { name: "Yan Carlos León", role: "Inspector Técnico", paymentMethod: "efectivo", auxAlimentacion: 240072 },
  { name: "Juan Enrique Pachón Rozo", role: "Inspector Técnico", paymentMethod: "efectivo", auxAlimentacion: 1340072 },
  { name: "Sebastián Cardeñoza", role: "Inspector Técnico", paymentMethod: "efectivo", auxAlimentacion: 1540072 }
];
const SALARY_BASE = 1750905, AUX_TRANSPORTE = 249095;

const OBLIG = [
  { concept: "Arriendo mensual", creditor: "Arrendador", category: "ARRIENDO", totalAmount: 9800000 },
  { concept: "Software, licencias y herramientas digitales", creditor: "Varios", category: "SOFTWARE_LICENCIAS_Y_HERRAMIENTAS_DIGITA", totalAmount: 2100000 },
  { concept: "4xmil + Canal Negocios", creditor: "Bancolombia", category: "CUATRO_POR_MIL", totalAmount: 580000 },
  { concept: "Contadores (servicios profesionales)", creditor: "Contadores", category: "SERVICIOS_PROFESIONALES_EXTERNOS", totalAmount: 1506000 }
];

async function main() {
  console.log("--- EMPLEADOS ---");
  for (const e of EMP) {
    const exist = await prisma.employee.findFirst({ where: { name: e.name } });
    if (exist) { console.log("·", e.name, "ya existe"); continue; }
    await prisma.employee.create({ data: {
      name: e.name, role: e.role, salaryBase: SALARY_BASE, auxTransporte: AUX_TRANSPORTE,
      auxAlimentacion: e.auxAlimentacion || 0, paymentMethod: e.paymentMethod, active: true, startDate: e.startDate || null
    } });
    console.log("✓", e.name, "(" + e.paymentMethod + ", alim " + (e.auxAlimentacion || 0) + ")");
  }

  console.log("--- SALDO INICIAL BANCOS ---");
  const banco = await prisma.cashBox.findFirst({ where: { code: "BANCO" } });
  if (!banco) console.log("⚠ No existe la caja BANCO");
  else {
    const prev = await prisma.cashMovement.findFirst({ where: { boxCode: "BANCO", refType: "saldo_inicial" } });
    if (prev) console.log("· Saldo inicial ya registrado");
    else {
      await prisma.cashMovement.create({ data: { boxCode: "BANCO", type: "ingreso", amount: 2096661, refType: "saldo_inicial", date: "2026-01-01", note: "Saldo inicial Bancolombia Cuenta Corriente" } });
      console.log("✓ Saldo inicial Bancolombia $2.096.661 registrado");
    }
  }

  console.log("--- OBLIGACIONES FIJAS MENSUALES ---");
  for (const o of OBLIG) {
    const exist = await prisma.payable.findFirst({ where: { concept: o.concept, refType: "fijo_seed" } });
    if (exist) { console.log("·", o.concept, "ya existe"); continue; }
    await prisma.payable.create({ data: {
      concept: o.concept, creditor: o.creditor, category: o.category, totalAmount: o.totalAmount, paidAmount: 0,
      frequency: "mensual", status: "pendiente", refType: "fijo_seed", note: "Costo fijo mensual (Excel mayo)"
    } });
    console.log("✓", o.concept, "$" + o.totalAmount.toLocaleString("es-CO"));
  }

  const nomina = EMP.reduce((s, e) => s + SALARY_BASE + AUX_TRANSPORTE + (e.auxAlimentacion || 0), 0);
  const oblig = OBLIG.reduce((s, o) => s + o.totalAmount, 0);
  console.log("Nomina mensual:", nomina.toLocaleString("es-CO"), "| Obligaciones fijas:", oblig.toLocaleString("es-CO"), "| Costos fijos:", (nomina + oblig).toLocaleString("es-CO"));
  console.log("Listo.");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
