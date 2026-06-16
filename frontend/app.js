import { api } from "./api.js";
import { $, esc, money, readCop, todayIso } from "./utils.js";
import { createSaleModule } from "./modules/sale-wizard.js";
import { createClosingReportModule } from "./modules/closing-report.js";
import { createShiftsModule } from "./modules/shifts.js";
import { createAlliesModule } from "./modules/allies.js";
import { createReceivablesModule } from "./modules/receivables.js";
import { createSalesListModule } from "./modules/sales-list.js";
import { createPayablesModule } from "./modules/payables.js";
import { createCashflowModule } from "./modules/cashflow.js";
import { createFupaModule } from "./modules/fupa.js";
import { createAdminConfigModule } from "./modules/admin-config.js";
import { createDashboardModule } from "./modules/dashboard.js";
import { createProvisionsModule } from "./modules/provisions.js";
import { createCallsModule } from "./modules/calls.js";
import { createManualInvoicesModule } from "./modules/manual-invoices.js";
import { createSuppliersModule } from "./modules/suppliers.js";
import { createUsersModule } from "./modules/users.js";
import { createClientsModule } from "./modules/clients.js";
import { createSimpleModule } from "./modules/simple-view.js";
import { createNominaModule } from "./modules/nomina.js";

const catalog = { products: [], packages: [], componentsByPackage: {}, paymentMethods: [] };
const productByCode = {};
const methodByCode = {};

const saleModule = createSaleModule({ api, catalog, productByCode, methodByCode, toast });
const reportsModule = createClosingReportModule({ api, toast, editSale });
const alliesModule = createAlliesModule({ api, toast });
const receivablesModule = createReceivablesModule({ api, toast });
const salesModule = createSalesListModule({ api, toast });
const payablesModule = createPayablesModule({ api, toast, editSale });
const cashflowModule = createCashflowModule({ api, toast });
const fupaModule = createFupaModule({ api, toast });
const adminConfigModule = createAdminConfigModule({ api, toast });
const dashboardModule = createDashboardModule({ api, toast, loadHeatmap: reportsModule.loadHeatmap });
const provisionsModule = createProvisionsModule({ api, toast });
const manualInvoicesModule = createManualInvoicesModule({ api, toast });
const suppliersModule = createSuppliersModule({ api, toast });
const usersModule = createUsersModule({ api, toast });
const clientsModule = createClientsModule({ api, toast });
const simpleModule = createSimpleModule({ api, toast, go: switchView });
const nominaModule = createNominaModule({ api, toast });
const shiftsModule = createShiftsModule({ api, toast, onShiftChange: renderShiftBadge });

// Indicador de turno en la barra superior (clic -> vista de turnos).
function renderShiftBadge(shift) {
  const el = $("shiftBadge");
  if (!el) return;
  if (shift && shift.status === "abierto") {
    el.textContent = `Turno #${shift.number} abierto`;
    el.className = "pill ok";
  } else {
    el.textContent = "Sin turno abierto";
    el.className = "pill danger";
  }
  renderShiftNotice(shift);
}

// Aviso grande al abrir el programa sin turno abierto: muestra con cuanto cerro el
// turno anterior (sugerencia de base) y abre el turno a nombre del usuario logueado.
let shiftNoticeDismissed = false;
let currentView = "venta";
function renderShiftNotice(shift) {
  const box = $("shiftNotice");
  if (!box) return;
  // El aviso de "abrir turno" solo aparece en la vista de Facturar (venta): es el unico
  // sitio donde se necesita un turno abierto. En el resto de pantallas no estorba.
  if (currentView !== "venta" || (shift && shift.status === "abierto") || shiftNoticeDismissed || !api.currentUser()) { box.innerHTML = ""; return; }
  const last = shiftsModule.getCurrent()?.lastClosed || null;
  const baseSugerida = last ? (last.countedCash ?? last.expectedCash ?? 0) : 0;
  const user = api.currentUser();
  box.innerHTML = `
    <div class="card" style="border:2px solid #e67e22;background:#fff8f0;margin-bottom:14px">
      <div class="card-head">
        <h2>⚠️ No hay turno abierto</h2>
        <button class="link" id="snLater">abrir más tarde ✕</button>
      </div>
      <div class="kpis">
        ${last ? `
        <div class="kpi"><span>Último turno</span><b>#${last.number} · ${esc(last.businessDate)}</b></div>
        <div class="kpi"><span>Cerró con (efectivo contado)</span><b>${money(last.countedCash ?? last.expectedCash ?? 0)}</b></div>
        <div class="kpi"><span>Cerró</span><b>${esc(last.closedBy || last.openedBy || "-")}</b></div>` : '<div class="kpi"><span>Historial</span><b>Sin turnos anteriores</b></div>'}
        <div class="kpi"><span>Responsable (sesión)</span><b>${esc(user?.name || "")}</b></div>
      </div>
      <div class="row" style="gap:10px;margin-top:10px;flex-wrap:wrap;align-items:end">
        <label class="fld">Base inicial (efectivo)<input id="snOpenCash" inputmode="numeric" value="${baseSugerida || ""}" placeholder="$ con cuánto abre la caja" style="max-width:200px" /></label>
        <button class="btn success" id="snOpenBtn">Abrir turno como ${esc(user?.name || "")}</button>
      </div>
      <p class="hint">La base sugerida es el efectivo con el que cerró el turno anterior. Sin turno abierto no se puede facturar.</p>
    </div>`;
  $("snLater").addEventListener("click", () => { shiftNoticeDismissed = true; box.innerHTML = ""; });
  $("snOpenBtn").addEventListener("click", async () => {
    try {
      await api.openShift({ openingCash: readCop("snOpenCash"), openedBy: user?.name || "" });
      toast("Turno abierto");
      await shiftsModule.refresh();
    } catch (e) { toast(e.message); }
  });
}
const callsModule = createCallsModule({ api, toast, switchView, loadClientDetail: clientsModule.loadClientDetail });

const VIEW_TITLES = {
  dashboard: "Dashboard", venta: "Facturar (nueva venta)", turnos: "Turnos de caja", cierre: "Cierre del día", provisiones: "Provisiones",
  consolidado: "Consolidado", cartera: "Cartera (por cobrar)", pagoconv: "Pagar comisiones a convenios", clientes: "Clientes",
  llamadas: "Llamadas / vencimientos RTM", convenios: "Convenios / aliados", facturaelec: "Factura electronica",
  proveedores: "Proveedores", ventas: "Ventas hechas", usuarios: "Usuarios", gastos: "Gastos", fupa: "Pines / FUPA",
  dian: "Facturacion DIAN", config: "Configuracion", payables: "Tablero de caja", obligaciones: "Obligaciones / cuentas por pagar", ingresos: "Ingresos",
  simple: "Vista simple", nomina: "Nómina"
};

// Seccion del menu a la que pertenece cada vista (se muestra sobre el titulo).
const VIEW_GROUPS = {
  simple: "Vista simple",
  venta: "Operación del día", ventas: "Operación del día", turnos: "Operación del día", cierre: "Operación del día",
  payables: "Dinero", obligaciones: "Dinero", provisiones: "Dinero", ingresos: "Dinero", gastos: "Dinero", cartera: "Dinero",
  convenios: "Convenios / referidos", pagoconv: "Convenios / referidos",
  clientes: "Clientes", llamadas: "Clientes",
  dashboard: "Reportes", consolidado: "Reportes",
  fupa: "Administración", facturaelec: "Administración", proveedores: "Administración",
  dian: "Administración", usuarios: "Administración", config: "Administración", nomina: "Administración"
};

// Salta a la vista Ventas y abre la venta para corregirla (usado desde el cierre diario).
function editSale(id) {
  switchView("ventas");
  salesModule.openSaleById(id);
}

function switchView(view) {
  currentView = view;
  document.body.dataset.view = view;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
  $("pageTitle").textContent = VIEW_TITLES[view] || "";
  $("pageGroup").textContent = VIEW_GROUPS[view] || "";
  // Muestra/oculta el aviso de turno segun la vista (solo en Facturar).
  renderShiftNotice(shiftsModule.getCurrent()?.shift ?? null);

  if (view === "venta") { saleModule.render(); shiftsModule.refresh(); }
  if (view === "turnos") shiftsModule.renderShifts($("shiftsRoot"));
  if (view === "cierre") reportsModule.loadClosing();
  if (view === "consolidado") reportsModule.loadReport();
  if (view === "cartera") receivablesModule.loadCartera();
  if (view === "pagoconv") alliesModule.loadPagoConv();
  if (view === "clientes") clientsModule.loadClientes();
  if (view === "convenios") alliesModule.loadConvenios();
  if (view === "ventas") salesModule.loadVentas();
  if (view === "usuarios") usersModule.loadUsuarios();
  if (view === "dashboard") dashboardModule.renderDashboard($("dashboardRoot"));
  if (view === "provisiones") provisionsModule.renderProvisiones($("provisionesRoot"));
  if (view === "gastos") cashflowModule.renderGastos($("gastosRoot"));
  if (view === "ingresos") cashflowModule.renderIngresos($("ingresosRoot"));
  if (view === "payables") payablesModule.renderPayables($("payablesRoot"));
  if (view === "obligaciones") payablesModule.renderObligaciones($("obligacionesRoot"));
  if (view === "fupa") fupaModule.renderFupa($("fupaRoot"));
  if (view === "dian") adminConfigModule.renderDian($("dianRoot"));
  if (view === "config") adminConfigModule.renderConfig($("configRoot"));
  if (view === "simple") simpleModule.renderSimple($("simpleRoot"));
  if (view === "nomina") nominaModule.renderNomina($("nominaRoot"));
  if (view === "llamadas") callsModule.renderLlamadas($("llamadasRoot"));
  if (view === "facturaelec") manualInvoicesModule.renderFacturaElec($("facturaelecRoot"));
  if (view === "proveedores") suppliersModule.renderProveedores($("proveedoresRoot"));
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

function applyRole() {
  const u = api.currentUser();
  $("userBox").innerHTML = u
    ? `<div class="uname">${esc(u.name)}</div><div class="urole">${esc(u.role)}${u.companyName ? " · " + esc(u.companyName) : ""}</div><button class="link" id="logoutBtn">Cerrar sesion</button>`
    : "";
  $("logoutBtn")?.addEventListener("click", logout);
  const isAdmin = u?.role === "admin";
  document.querySelectorAll(".admin-only").forEach((el) => el.classList.toggle("hidden", !isAdmin));
}

function showLogin() {
  $("loginOverlay").classList.remove("hidden");
  $("appShell").classList.add("hidden");
}

function showApp() {
  $("loginOverlay").classList.add("hidden");
  $("appShell").classList.remove("hidden");
}

function logout() {
  api.logout();
  showLogin();
}

let started = false;
async function startApp() {
  showApp();
  applyRole();
  if (started) {
    switchView("venta");
    saleModule.render();
    return;
  }

  started = true;
  $("closingDate").value = todayIso();
  $("ventasDate").value = todayIso();
  $("topbarMeta").textContent = new Date().toLocaleDateString("es-CO", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });
  $("tabs").addEventListener("click", (e) => {
    const t = e.target.closest(".tab");
    if (t?.dataset.view) switchView(t.dataset.view);
  });
  $("shiftBadge").addEventListener("click", () => switchView("turnos"));
  shiftsModule.refresh();

  $("loadClosing").addEventListener("click", reportsModule.loadClosing);
  $("exportClosing").addEventListener("click", reportsModule.exportClosingUI);
  $("exportClosingDetail")?.addEventListener("click", reportsModule.exportClosingDetailUI);
  $("freezeClosing").addEventListener("click", reportsModule.freezeClosing);

  const monthStart = todayIso().slice(0, 8) + "01";
  $("repFrom").value = monthStart;
  $("repTo").value = todayIso();
  $("loadReport").addEventListener("click", reportsModule.loadReport);
  $("exportReport").addEventListener("click", reportsModule.exportReportUI);

  $("ventasDate").addEventListener("change", salesModule.loadVentas);
  $("ventasSearch").addEventListener("input", salesModule.loadVentas);
  $("ventasAll").addEventListener("click", () => {
    $("ventasDate").value = "";
    salesModule.loadVentas();
  });
  $("exportVentas").addEventListener("click", salesModule.exportVentasUI);

  $("allySearch").addEventListener("input", (e) => alliesModule.loadConvenios(e.target.value));
  $("allyNew").addEventListener("click", () => alliesModule.renderAllyForm(null));
  $("clientListSearch").addEventListener("input", (e) => clientsModule.loadClientes(e.target.value));
  $("clientDirRef").addEventListener("click", callsModule.loadDirectoReferido);
  $("clientNew").addEventListener("click", clientsModule.renderNewClientForm);
  $("userNew").addEventListener("click", () => usersModule.renderUserForm(null));

  try {
    const loadedCatalog = await api.catalog();
    Object.assign(catalog, loadedCatalog);
    Object.keys(productByCode).forEach((code) => delete productByCode[code]);
    Object.keys(methodByCode).forEach((code) => delete methodByCode[code]);
    catalog.products.forEach((p) => (productByCode[p.code] = p));
    catalog.paymentMethods.forEach((m) => (methodByCode[m.code] = m));
    $("connStatus").textContent = "conectado";
    $("connStatus").classList.add("ok");
  } catch (e) {
    $("connStatus").textContent = "sin conexion API";
  }

  saleModule.render();
}

function boot() {
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("loginError").textContent = "";
    try {
      await api.login($("loginUser").value.trim(), $("loginPass").value);
      await startApp();
    } catch (err) {
      $("loginError").textContent = err.message;
    }
  });
  document.addEventListener("motopos:unauthorized", showLogin);
  if (api.hasToken()) startApp();
  else showLogin();
}

boot();
