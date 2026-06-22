// Cliente fetch hacia la API del backend (con sesion JWT).
const BASE = "/api";

let token = localStorage.getItem("motopos.token") || null;
let currentUser = JSON.parse(localStorage.getItem("motopos.user") || "null");

function setSession(t, u) {
  token = t;
  currentUser = u;
  localStorage.setItem("motopos.token", t);
  localStorage.setItem("motopos.user", JSON.stringify(u));
}
function clearSession() {
  token = null;
  currentUser = null;
  localStorage.removeItem("motopos.token");
  localStorage.removeItem("motopos.user");
}

async function req(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (res.status === 401) {
    clearSession();
    document.dispatchEvent(new Event("motopos:unauthorized"));
    throw new Error("Sesion expirada");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

async function reqBlob(path, options = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method: options.method || "GET", headers });
  if (res.status === 401) {
    clearSession();
    document.dispatchEvent(new Event("motopos:unauthorized"));
    throw new Error("Sesion expirada");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Error ${res.status}`);
  }
  return res.blob();
}

// Subida de archivos (comprobantes). Devuelve { ok, path, url }.
async function uploadFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + "/uploads", { method: "POST", headers, body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export const api = {
  // sesion
  login: async (username, password) => {
    const d = await req("/auth/login", { method: "POST", body: { username, password } });
    setSession(d.token, d.user);
    return d.user;
  },
  logout: clearSession,
  currentUser: () => currentUser,
  hasToken: () => !!token,

  catalog: () => req("/catalog"),
  uploadFile,
  dashboard: (from, to) => req(`/dashboard?${new URLSearchParams({ from, to })}`),
  exportDashboard: (from, to) => reqBlob(`/dashboard/export?${new URLSearchParams({ from, to })}`),

  findClients: (q) => req(`/clients?q=${encodeURIComponent(q)}`),
  getClient: (doc) => req(`/clients/${encodeURIComponent(doc)}`),
  saveClient: (body) => req("/clients", { method: "POST", body }),
  deleteClient: (doc) => req(`/clients/${encodeURIComponent(doc)}`, { method: "DELETE" }),
  directoReferido: () => req("/clients/reports/directo-referido"),

  calls: (from = "", to = "") => req(`/calls?from=${from}&to=${to}`),
  callLogs: (params = {}) => req(`/calls/logs?${new URLSearchParams(params)}`),
  saveCallLog: (body) => req("/calls/logs", { method: "POST", body }),
  deleteCallLog: (id) => req(`/calls/logs/${id}`, { method: "DELETE" }),
  exportCallLogs: (params = {}) => reqBlob(`/calls/logs/export?${new URLSearchParams(params)}`),
  referidosReport: () => req("/calls/referidos"),

  payables: (params = {}) => req(`/payables?${new URLSearchParams(params)}`),
  payable: (id) => req(`/payables/${id}`),
  createPayable: (body) => req("/payables", { method: "POST", body }),
  updatePayable: (id, body) => req(`/payables/${id}`, { method: "PUT", body }),
  payPayable: (id, body) => req(`/payables/${id}/pay`, { method: "POST", body }),
  updatePayablePayment: (id, paymentId, body) => req(`/payables/${id}/payments/${paymentId}`, { method: "PUT", body }),
  deletePayable: (id) => req(`/payables/${id}`, { method: "DELETE" }),
  deletePayablePayment: (id, paymentId) => req(`/payables/${id}/payments/${paymentId}`, { method: "DELETE" }),
  exportPayables: (params = {}) => reqBlob(`/payables/export?${new URLSearchParams(params)}`),
  exportCalls: (from = "", to = "") => reqBlob(`/calls/export?from=${from}&to=${to}`),
  exportDirectoReferido: () => reqBlob("/clients/reports/directo-referido/export"),

  fupa: (from, to) => req(`/fupa?${new URLSearchParams({ from, to })}`),
  fupaSummary: () => req("/fupa/summary"),
  fupaPurchase: (body) => req("/fupa/purchase", { method: "POST", body }),
  fupaCount: (body) => req("/fupa/count", { method: "POST", body }),
  exportFupa: (from, to) => reqBlob(`/fupa/export?${new URLSearchParams({ from, to })}`),

  provisions: (params = {}) => req(`/provisions?${new URLSearchParams(params)}`),
  exportProvisions: (params = {}) => reqBlob(`/provisions/export?${new URLSearchParams(params)}`),
  cashBoxes: () => req("/provisions/boxes"),
  cashLedger: (params = {}) => req(`/provisions/ledger?${new URLSearchParams(params)}`),
  exportCashLedger: (params = {}) => reqBlob(`/provisions/ledger/export?${new URLSearchParams(params)}`),
  addCashBox: (body) => req("/provisions/boxes", { method: "POST", body }),
  addCashMovement: (body) => req("/provisions/movements", { method: "POST", body }),
  voidCashMovement: (id) => req(`/provisions/movements/${id}/void`, { method: "POST" }),
  realizeProvision: (saleId, body) => req(`/provisions/${saleId}/realize`, { method: "POST", body }),

  employees: () => req("/nomina/employees"),
  saveEmployee: (body) => req("/nomina/employees", { method: "POST", body }),
  updateEmployee: (id, body) => req(`/nomina/employees/${id}`, { method: "PUT", body }),
  deleteEmployee: (id) => req(`/nomina/employees/${id}`, { method: "DELETE" }),
  nominaQuincena: () => req("/nomina/quincena"),
  payNomina: (body) => req("/nomina/pay", { method: "POST", body }),

  income: (params = {}) => req(`/income?${new URLSearchParams(params)}`),
  addIncome: (body) => req("/income", { method: "POST", body }),
  deleteIncome: (id) => req(`/income/${id}`, { method: "DELETE" }),
  incomeByNature: (params = {}) => req(`/income/by-nature?${new URLSearchParams(params)}`),
  incomeConsolidado: (params = {}) => req(`/income/consolidado?${new URLSearchParams(params)}`),
  exportIncome: (params = {}) => reqBlob(`/income/export?${new URLSearchParams(params)}`),

  expenses: (params = {}) => req(`/expenses?${new URLSearchParams(params)}`),
  expenseConsolidado: (params = {}) => req(`/expenses/consolidado?${new URLSearchParams(params)}`),
  addExpense: (body) => req("/expenses", { method: "POST", body }),
  deleteExpense: (id) => req(`/expenses/${id}`, { method: "DELETE" }),
  exportExpenses: (params = {}) => reqBlob(`/expenses/export?${new URLSearchParams(params)}`),
  expenseNatures: () => req("/expenses/natures"),
  expenseNaturesAll: () => req("/expenses/natures?all=1"),
  saveExpenseNature: (body) => req("/expenses/natures", { method: "POST", body }),
  updateExpenseNature: (code, body) => req(`/expenses/natures/${encodeURIComponent(code)}`, { method: "PUT", body }),
  deleteExpenseNature: (code) => req(`/expenses/natures/${encodeURIComponent(code)}`, { method: "DELETE" }),
  expenseNatureReport: (params = {}) => req(`/expenses/natures/report?${new URLSearchParams(params)}`),
  exportExpenseNatureReport: (params = {}) => reqBlob(`/expenses/natures/report/export?${new URLSearchParams(params)}`),

  findVehicles: (params) => req(`/vehicles?${new URLSearchParams(params)}`),
  saveVehicle: (body) => req("/vehicles", { method: "POST", body }),
  deleteVehicle: (id) => req(`/vehicles/${id}`, { method: "DELETE" }),

  findAllies: (q = "") => req(`/allies?q=${encodeURIComponent(q)}`),
  saveAlly: (body) => req("/allies", { method: "POST", body }),
  updateAlly: (id, body) => req(`/allies/${id}`, { method: "PUT", body }),
  applyAlliesCommission: (commission) => req("/allies/commission-all", { method: "PUT", body: { commission } }),
  deleteAlly: (id) => req(`/allies/${id}`, { method: "DELETE" }),

  createSale: (body) => req("/sales", { method: "POST", body }),
  listSales: (params = {}) => req(`/sales?${new URLSearchParams(params)}`),
  exportSales: (params = {}) => reqBlob(`/sales/export?${new URLSearchParams(params)}`),
  getSale: (id) => req(`/sales/${id}`),
  updateSale: (id, body) => req(`/sales/${id}`, { method: "PUT", body }),
  deleteSale: (id) => req(`/sales/${id}`, { method: "DELETE" }),
  invoice: (id) => req(`/sales/${id}/invoice`, { method: "POST" }),
  voidSale: (id, body) => req(`/sales/${id}/void`, { method: "POST", body }),

  currentShift: () => req("/shifts/current"),
  shifts: (params = {}) => req(`/shifts?${new URLSearchParams(params)}`),
  openShift: (body) => req("/shifts/open", { method: "POST", body }),
  closeShift: (id, body) => req(`/shifts/${id}/close`, { method: "POST", body }),
  exportShifts: (params = {}) => reqBlob(`/shifts/export?${new URLSearchParams(params)}`),

  closing: (date, gastos = 0) => req(`/closings?date=${date}&gastos=${gastos}`),
  exportClosing: (date, gastos = 0) => reqBlob(`/closings/export?date=${date}&gastos=${gastos}`),
  closingDay: (date) => req(`/closings/day?date=${date}`),
  closingRange: (from, to, methods = null) => req(`/closings/range?from=${from}&to=${to}${methods && methods.length ? `&methods=${encodeURIComponent(methods.join(","))}` : ""}`),
  closingDetail: (date, gastos = 0, methods = null) => req(`/closings/detail?date=${date}&gastos=${gastos}${methods && methods.length ? `&methods=${encodeURIComponent(methods.join(","))}` : ""}`),
  exportClosingDetail: (date, gastos = 0) => reqBlob(`/closings/detail/export?date=${date}&gastos=${gastos}`),
  saveClosing: (body) => req("/closings", { method: "POST", body }),
  consolidado: (from, to) => req(`/closings/consolidado?from=${from}&to=${to}`),
  report: (from, to) => req(`/closings/report?from=${from}&to=${to}`),
  exportConsolidado: (from, to) => reqBlob(`/closings/report/export?from=${from}&to=${to}`),
  reportDetail: (from, to, methods = null) => req(`/closings/report/detail?from=${from}&to=${to}${methods && methods.length ? `&methods=${encodeURIComponent(methods.join(","))}` : ""}`),
  exportConsolidadoDetalle: (from, to) => reqBlob(`/closings/report/detail/export?from=${from}&to=${to}`),
  heatmap: (from, to) => req(`/reports/heatmap?from=${from}&to=${to}`),

  receivables: (params = {}) => req(`/receivables?${new URLSearchParams(params)}`),
  payReceivable: (id) => req(`/receivables/${id}/pay`, { method: "POST" }),
  addReceivablePayment: (id, body) => req(`/receivables/${id}/payments`, { method: "POST", body }),
  exportReceivables: (params = {}) => reqBlob(`/receivables/export?${new URLSearchParams(params)}`),

  manualInvoices: (params = {}) => req(`/manual-invoices?${new URLSearchParams(params)}`),
  createManualInvoice: (body) => req("/manual-invoices", { method: "POST", body }),
  voidManualInvoice: (id) => req(`/manual-invoices/${id}/void`, { method: "POST" }),
  exportManualInvoices: (params = {}) => reqBlob(`/manual-invoices/export?${new URLSearchParams(params)}`),

  suppliers: (q = "") => req(`/suppliers?q=${encodeURIComponent(q)}`),
  saveSupplier: (body) => req("/suppliers", { method: "POST", body }),
  updateSupplier: (id, body) => req(`/suppliers/${id}`, { method: "PUT", body }),
  deleteSupplier: (id) => req(`/suppliers/${id}`, { method: "DELETE" }),
  supplierInvoices: (params = {}) => req(`/suppliers/invoices?${new URLSearchParams(params)}`),
  createSupplierInvoice: (body) => req("/suppliers/invoices", { method: "POST", body }),
  paySupplierInvoice: (id, body) => req(`/suppliers/invoices/${id}/pay`, { method: "POST", body }),
  voidSupplierInvoice: (id) => req(`/suppliers/invoices/${id}/void`, { method: "POST" }),
  exportSupplierInvoices: (params = {}) => reqBlob(`/suppliers/invoices/export?${new URLSearchParams(params)}`),
  purchaseOrders: (params = {}) => req(`/purchase-orders?${new URLSearchParams(params)}`),
  createPurchaseOrder: (body) => req("/purchase-orders", { method: "POST", body }),
  voidPurchaseOrder: (id) => req(`/purchase-orders/${id}/void`, { method: "POST" }),
  exportPurchaseOrders: (params = {}) => reqBlob(`/purchase-orders/export?${new URLSearchParams(params)}`),

  allyPayments: () => req("/ally-payments"),
  exportReferidos: (params = {}) => reqBlob(`/ally-payments/referidos/export?${new URLSearchParams(params)}`),
  allyPaymentDetail: (name) => req(`/ally-payments/${encodeURIComponent(name)}`),
  addAllyPayment: (body) => req("/ally-payments", { method: "POST", body }),
  deleteAllyPayment: (id) => req(`/ally-payments/${id}`, { method: "DELETE" }),
  updateAllyPayment: (id, body) => req(`/ally-payments/${id}`, { method: "PUT", body }),

  tariffs: (params = {}) => req(`/catalog/tariffs?${new URLSearchParams(params)}`),
  saveTariff: (body) => req("/catalog/tariffs", { method: "POST", body }),
  updateTariff: (id, body) => req(`/catalog/tariffs/${id}`, { method: "PUT", body }),
  deleteTariff: (id) => req(`/catalog/tariffs/${id}`, { method: "DELETE" }),

  companies: () => req("/companies"),
  createCompany: (body) => req("/companies", { method: "POST", body }),
  updateCompany: (id, body) => req(`/companies/${id}`, { method: "PUT", body }),

  notifConfig: () => req("/settings/notifications"),
  saveNotifConfig: (body) => req("/settings/notifications", { method: "PUT", body }),
  testNotif: (channel, to) => req("/settings/notifications/test", { method: "POST", body: { channel, to } }),
  resetOperacional: (confirm) => req("/settings/reset-operacional", { method: "POST", body: { confirm } }),

  dianConfig: () => req("/dian/config"),
  saveDianConfig: (body) => req("/dian/config", { method: "PUT", body }),
  dianInvoices: (params = {}) => req(`/dian/invoices?${new URLSearchParams(params)}`),
  dianIva: (params = {}) => req(`/dian/iva?${new URLSearchParams(params)}`),
  sendDianInvoice: (id) => req(`/dian/invoices/${id}/send`, { method: "POST" }),
  exportDian: () => reqBlob("/dian/export"),

  listUsers: () => req("/users"),
  createUser: (body) => req("/users", { method: "POST", body }),
  updateUser: (id, body) => req(`/users/${id}`, { method: "PUT", body }),
  deleteUser: (id) => req(`/users/${id}`, { method: "DELETE" }),

  myPermissions: () => req("/permissions/mine"),
  rolePermissions: () => req("/permissions"),
  saveRolePermissions: (role, body) => req(`/permissions/${encodeURIComponent(role)}`, { method: "PUT", body })
};
