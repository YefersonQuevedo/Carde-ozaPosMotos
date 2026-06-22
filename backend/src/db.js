// Cliente Prisma con AISLAMIENTO MULTI-EMPRESA automatico.
// Toda consulta sobre un modelo de negocio queda filtrada por la empresa del
// request (ver tenant.js): los finds agregan companyId al where y los creates
// lo ponen en data. Asi ninguna ruta puede leer/escribir datos de otra empresa
// aunque se le olvide filtrar.
import { PrismaClient } from "@prisma/client";
import { currentCompanyId } from "./tenant.js";

// Modelos aislados por empresa. NO estan:
//  - Company: es el catalogo de empresas (lo maneja el superadmin).
//  - User: el login busca por username GLOBAL (sin saber la empresa todavia);
//    users.js filtra por companyId a mano.
const COMPANY_MODELS = new Set([
  "Client", "Vehicle", "Ally", "Product", "Tariff", "Package", "PackageComponent",
  "PaymentMethod", "Sale", "Shift", "SaleLine", "SalePayment", "SaleCost",
  "Receivable", "ReceivablePayment", "Invoice", "NotificationConfig", "DianConfig",
  "CallLog", "Payable", "PayablePayment", "Reversal", "AllyPayment", "ClientHistory",
  "CashBox", "CashMovement", "FupaMovement", "Income", "Expense", "ExpenseNature",
  "Supplier", "SupplierInvoice", "SupplierInvoicePayment", "PurchaseOrder",
  "PurchaseOrderLine", "ManualInvoice", "ManualInvoiceLine", "DailyClosing", "Employee",
  "RolePermission"
]);

// Operaciones que filtran por where. findUnique/update/delete aceptan campos
// extra no-unicos en el where (Prisma >= 5), asi que tambien se aislan.
const WHERE_OPS = new Set([
  "findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow",
  "count", "aggregate", "groupBy", "update", "delete", "updateMany", "deleteMany"
]);

const base = new PrismaClient();

export const prisma = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!COMPANY_MODELS.has(model)) return query(args);
        const companyId = currentCompanyId();
        args = args ?? {};
        if (WHERE_OPS.has(operation)) {
          // Respeta un companyId explicito (p.ej. clonar catalogo a otra empresa).
          args.where = { companyId, ...(args.where ?? {}) };
        }
        if (operation === "create") {
          args.data = { companyId, ...(args.data ?? {}) };
        }
        if (operation === "createMany" || operation === "createManyAndReturn") {
          const rows = Array.isArray(args.data) ? args.data : [args.data];
          args.data = rows.map((d) => ({ companyId, ...d }));
        }
        if (operation === "upsert") {
          // El where de un upsert debe usar la clave unica compuesta (companyId_xxx);
          // aqui solo se garantiza que el create quede en la empresa correcta.
          args.create = { companyId, ...(args.create ?? {}) };
        }
        return query(args);
      }
    }
  }
});
