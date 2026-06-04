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
  voidSale: (id, body) => req(`/sales/${id}/void`, { method: "POST", body }),

  closing: (date, gastos = 0) => req(`/closings?date=${date}&gastos=${gastos}`),
  saveClosing: (body) => req("/closings", { method: "POST", body }),
  consolidado: (from, to) => req(`/closings/consolidado?from=${from}&to=${to}`),
  report: (from, to) => req(`/closings/report?from=${from}&to=${to}`),

  receivables: (params = {}) => req(`/receivables?${new URLSearchParams(params)}`),
  payReceivable: (id) => req(`/receivables/${id}/pay`, { method: "POST" }),

  allyPayments: () => req("/ally-payments"),
  allyPaymentDetail: (name) => req(`/ally-payments/${encodeURIComponent(name)}`),
  addAllyPayment: (body) => req("/ally-payments", { method: "POST", body }),
  deleteAllyPayment: (id) => req(`/ally-payments/${id}`, { method: "DELETE" }),

  listUsers: () => req("/users"),
  createUser: (body) => req("/users", { method: "POST", body }),
  updateUser: (id, body) => req(`/users/${id}`, { method: "PUT", body }),
  deleteUser: (id) => req(`/users/${id}`, { method: "DELETE" })
};
