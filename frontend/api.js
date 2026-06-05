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
  exportCalls: (from = "", to = "") => reqBlob(`/calls/export?from=${from}&to=${to}`),
  exportDirectoReferido: () => reqBlob("/clients/reports/directo-referido/export"),

  fupa: (from, to) => req(`/fupa?${new URLSearchParams({ from, to })}`),
  fupaSummary: () => req("/fupa/summary"),
  fupaPurchase: (body) => req("/fupa/purchase", { method: "POST", body }),
  fupaCount: (body) => req("/fupa/count", { method: "POST", body }),
  exportFupa: (from, to) => reqBlob(`/fupa/export?${new URLSearchParams({ from, to })}`),

  provisions: (params = {}) => req(`/provisions?${new URLSearchParams(params)}`),
  exportProvisions: () => reqBlob("/provisions/export"),
  cashBoxes: () => req("/provisions/boxes"),
  addCashBox: (body) => req("/provisions/boxes", { method: "POST", body }),
  addCashMovement: (body) => req("/provisions/movements", { method: "POST", body }),
  realizeProvision: (saleId, body) => req(`/provisions/${saleId}/realize`, { method: "POST", body }),

  expenses: (params = {}) => req(`/expenses?${new URLSearchParams(params)}`),
  addExpense: (body) => req("/expenses", { method: "POST", body }),
  deleteExpense: (id) => req(`/expenses/${id}`, { method: "DELETE" }),
  exportExpenses: (params = {}) => reqBlob(`/expenses/export?${new URLSearchParams(params)}`),

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
  invoice: (id) => req(`/sales/${id}/invoice`, { method: "POST" }),
  voidSale: (id, body) => req(`/sales/${id}/void`, { method: "POST", body }),

  closing: (date, gastos = 0) => req(`/closings?date=${date}&gastos=${gastos}`),
  exportClosing: (date, gastos = 0) => reqBlob(`/closings/export?date=${date}&gastos=${gastos}`),
  saveClosing: (body) => req("/closings", { method: "POST", body }),
  consolidado: (from, to) => req(`/closings/consolidado?from=${from}&to=${to}`),
  report: (from, to) => req(`/closings/report?from=${from}&to=${to}`),
  exportConsolidado: (from, to) => reqBlob(`/closings/report/export?from=${from}&to=${to}`),

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
  purchaseOrders: (params = {}) => req(`/purchase-orders?${new URLSearchParams(params)}`),
  createPurchaseOrder: (body) => req("/purchase-orders", { method: "POST", body }),
  voidPurchaseOrder: (id) => req(`/purchase-orders/${id}/void`, { method: "POST" }),
  exportPurchaseOrders: (params = {}) => reqBlob(`/purchase-orders/export?${new URLSearchParams(params)}`),

  allyPayments: () => req("/ally-payments"),
  allyPaymentDetail: (name) => req(`/ally-payments/${encodeURIComponent(name)}`),
  addAllyPayment: (body) => req("/ally-payments", { method: "POST", body }),
  deleteAllyPayment: (id) => req(`/ally-payments/${id}`, { method: "DELETE" }),

  notifConfig: () => req("/settings/notifications"),
  saveNotifConfig: (body) => req("/settings/notifications", { method: "PUT", body }),
  testNotif: (channel, to) => req("/settings/notifications/test", { method: "POST", body: { channel, to } }),

  dianConfig: () => req("/dian/config"),
  saveDianConfig: (body) => req("/dian/config", { method: "PUT", body }),
  dianInvoices: (params = {}) => req(`/dian/invoices?${new URLSearchParams(params)}`),
  sendDianInvoice: (id) => req(`/dian/invoices/${id}/send`, { method: "POST" }),
  exportDian: () => reqBlob("/dian/export"),

  listUsers: () => req("/users"),
  createUser: (body) => req("/users", { method: "POST", body }),
  updateUser: (id, body) => req(`/users/${id}`, { method: "PUT", body }),
  deleteUser: (id) => req(`/users/${id}`, { method: "DELETE" })
};
