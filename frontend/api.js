// Cliente fetch hacia la API del backend.
const BASE = "/api";

async function req(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export const api = {
  catalog: () => req("/catalog"),

  findClients: (q) => req(`/clients?q=${encodeURIComponent(q)}`),
  getClient: (doc) => req(`/clients/${encodeURIComponent(doc)}`),
  saveClient: (body) => req("/clients", { method: "POST", body }),
  deleteClient: (doc) => req(`/clients/${encodeURIComponent(doc)}`, { method: "DELETE" }),

  findVehicles: (params) => req(`/vehicles?${new URLSearchParams(params)}`),
  saveVehicle: (body) => req("/vehicles", { method: "POST", body }),
  deleteVehicle: (id) => req(`/vehicles/${id}`, { method: "DELETE" }),

  findAllies: (q = "") => req(`/allies?q=${encodeURIComponent(q)}`),
  saveAlly: (body) => req("/allies", { method: "POST", body }),
  updateAlly: (id, body) => req(`/allies/${id}`, { method: "PUT", body }),
  deleteAlly: (id) => req(`/allies/${id}`, { method: "DELETE" }),

  createSale: (body) => req("/sales", { method: "POST", body }),
  listSales: (params = {}) => req(`/sales?${new URLSearchParams(params)}`),
  getSale: (id) => req(`/sales/${id}`),
  invoice: (id) => req(`/sales/${id}/invoice`, { method: "POST" }),

  closing: (date, gastos = 0) => req(`/closings?date=${date}&gastos=${gastos}`),
  saveClosing: (body) => req("/closings", { method: "POST", body }),
  consolidado: (from, to) => req(`/closings/consolidado?from=${from}&to=${to}`),
  report: (from, to) => req(`/closings/report?from=${from}&to=${to}`),

  receivables: (params = {}) => req(`/receivables?${new URLSearchParams(params)}`),
  payReceivable: (id) => req(`/receivables/${id}/pay`, { method: "POST" })
};
