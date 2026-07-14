export const RUNT_CONSULTA_URL = "https://portalpublico.runt.gov.co/#/consulta-vehiculo/consulta/consulta-ciudadana";

function clean(value) {
  return String(value || "").trim();
}

function normalizeDocType(type) {
  const t = clean(type).toUpperCase();
  if (t === "PAS") return "PA";
  return t || "CC";
}

function runtDataText({ client, vehicle }) {
  const plate = clean(vehicle?.plate).toUpperCase();
  const docType = normalizeDocType(client?.docType);
  const docNumber = clean(client?.docNumber || client?.clientDoc);
  const name = clean(client?.name || client?.clientName);
  const phone = clean(client?.phone);
  const modelYear = clean(vehicle?.modelYear);

  return [
    "Consulta RUNT",
    `Placa: ${plate}`,
    `Tipo documento propietario: ${docType}`,
    `Documento propietario: ${docNumber}`,
    name ? `Nombre: ${name}` : "",
    phone ? `Telefono: ${phone}` : "",
    modelYear ? `Modelo: ${modelYear}` : ""
  ].filter(Boolean).join("\n");
}

function attr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function runtData({ client, vehicle }) {
  return {
    source: "motopos-runt",
    plate: clean(vehicle?.plate).toUpperCase(),
    docType: normalizeDocType(client?.docType),
    docNumber: clean(client?.docNumber || client?.clientDoc)
  };
}

function runtFillSource(dataExpression) {
  return `(()=>{const d=${dataExpression};const ev=(e,t)=>e&&e.dispatchEvent(new Event(t,{bubbles:true}));const set=(s,v)=>{const e=document.querySelector(s);if(!e)return false;e.focus();e.value=v;ev(e,"input");ev(e,"change");ev(e,"blur");return true};const norm=s=>String(s||"").normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toUpperCase();const wanted={CC:["CEDULA","CIUDADANIA"],NIT:["NIT"],CE:["CEDULA","EXTRANJERIA"],TI:["TARJETA","IDENTIDAD"],PA:["PASAPORTE"],PAS:["PASAPORTE"]}[d.docType]||["CEDULA"];set("#mat-input-0",d.plate);set("#mat-input-1",d.docNumber);const sel=document.querySelector("#mat-select-4");if(sel){sel.click();setTimeout(()=>{const opts=[...document.querySelectorAll("mat-option,.mat-option")];const opt=opts.find(o=>wanted.every(w=>norm(o.innerText).includes(w)));if(opt)opt.click();document.querySelector("#mat-input-2")?.focus();},350)}else document.querySelector("#mat-input-2")?.focus();})()`;
}

export function runtAutofillScript(data) {
  const source = runtFillSource(JSON.stringify(runtData(data)));
  return `javascript:${source}`;
}

export function runtBookmarkletHtml() {
  const source = `(async()=>{let txt="";try{txt=await navigator.clipboard.readText()}catch(e){txt=prompt("Pega los datos RUNT copiados desde MotoPOS")||""}let d;try{d=JSON.parse(txt)}catch(e){alert("No encontre datos RUNT validos. Vuelve a MotoPOS y pulsa Buscar en el RUNT.");return}if(d.source!=="motopos-runt"||!d.plate||!d.docNumber){alert("Datos RUNT incompletos. Vuelve a MotoPOS y pulsa Buscar en el RUNT.");return}${runtFillSource("d")}})()`;
  return `<a class="runt-bookmarklet" href="javascript:${attr(source)}">Llenar RUNT</a>`;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  return ok;
}

export function runtButtonHtml(label = "Consultar RUNT") {
  return `<button class="btn runt-btn" type="button" data-runt-open>${label}</button>`;
}

export async function openRuntConsulta(data, toast) {
  const plate = clean(data?.vehicle?.plate).toUpperCase();
  const docNumber = clean(data?.client?.docNumber || data?.client?.clientDoc);
  if (!plate) return toast?.("Falta la placa para consultar RUNT");
  if (!docNumber) return toast?.("Falta el documento del propietario para consultar RUNT");

  const win = window.open(RUNT_CONSULTA_URL, "_blank", "noopener");
  try {
    await copyText(JSON.stringify(runtData(data)));
    toast?.("Datos RUNT copiados. En la pagina del RUNT haz clic en el favorito Llenar RUNT y completa el captcha.");
  } catch {
    await copyText(runtDataText(data)).catch(() => {});
    toast?.("Se abrio RUNT. Si el portapapeles fue bloqueado, copia placa y documento desde el POS.");
  }
  if (!win) toast?.("Permite las ventanas emergentes para abrir RUNT");
}
