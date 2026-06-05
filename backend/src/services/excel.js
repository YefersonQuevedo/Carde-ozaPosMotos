// Helper unico de exportacion a Excel (xlsx) para todo el proyecto.
// Cualquier modulo (cierre, cartera, convenios, KPIs) construye sus hojas con
// `toWorkbook(...)` y entrega el Buffer; la ruta lo sirve como descarga.
//
// Uso:
//   const buf = await toWorkbook({
//     sheets: [{
//       name: "Cartera",
//       columns: [
//         { header: "Factura", key: "invoiceNumber", width: 16 },
//         { header: "Pendiente", key: "pending", width: 14, money: true }
//       ],
//       rows: [{ invoiceNumber: "BTA-1", pending: 120000 }],
//       title: "Cartera abierta (opcional)"
//     }]
//   });
//   sendXlsx(res, buf, "cartera.xlsx");   // helper de abajo

import ExcelJS from "exceljs";

const MONEY_FMT = '"$"#,##0';

/// Construye un workbook xlsx y devuelve un Buffer.
/// sheets: [{ name, columns:[{header,key,width,money?,number?}], rows:[obj], title? }]
export async function toWorkbook({ sheets = [], creator = "MotoPOS" } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = creator;
  wb.created = new Date();

  for (const sheet of sheets) {
    const ws = wb.addWorksheet((sheet.name || "Hoja").slice(0, 31));
    const columns = sheet.columns || [];

    let headerRowIdx = 1;
    if (sheet.title) {
      ws.mergeCells(1, 1, 1, Math.max(1, columns.length));
      const titleCell = ws.getCell(1, 1);
      titleCell.value = sheet.title;
      titleCell.font = { bold: true, size: 14 };
      headerRowIdx = 3; // deja una fila en blanco bajo el titulo
    }

    // Encabezados
    columns.forEach((c, i) => {
      const cell = ws.getCell(headerRowIdx, i + 1);
      cell.value = c.header ?? c.key;
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
      cell.border = { bottom: { style: "thin", color: { argb: "FFBBBBBB" } } };
      ws.getColumn(i + 1).width = c.width || 16;
    });

    // Filas
    (sheet.rows || []).forEach((row, r) => {
      columns.forEach((c, i) => {
        const cell = ws.getCell(headerRowIdx + 1 + r, i + 1);
        const val = row[c.key];
        cell.value = val ?? (c.money || c.number ? 0 : "");
        if (c.money) cell.numFmt = MONEY_FMT;
        else if (c.number) cell.numFmt = "#,##0";
      });
    });

    // Totales opcionales: sheet.totals = { columnKey: value }
    if (sheet.totals) {
      const totalRow = headerRowIdx + 1 + (sheet.rows || []).length;
      const labelCol = columns.findIndex((c) => !(c.money || c.number));
      if (labelCol >= 0) {
        const lc = ws.getCell(totalRow, labelCol + 1);
        lc.value = "TOTAL";
        lc.font = { bold: true };
      }
      columns.forEach((c, i) => {
        if (sheet.totals[c.key] != null) {
          const cell = ws.getCell(totalRow, i + 1);
          cell.value = sheet.totals[c.key];
          cell.font = { bold: true };
          if (c.money) cell.numFmt = MONEY_FMT;
          else if (c.number) cell.numFmt = "#,##0";
        }
      });
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/// Envia un Buffer xlsx como descarga (usar en las rutas Express).
export function sendXlsx(res, buffer, filename = "export.xlsx") {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}
