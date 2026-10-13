import ExcelJS from "exceljs";

/**
 * Sheet helpers for the streamed SC Excel exports (ExcelJS WorkbookWriter).
 * Every row is committed as soon as it is written, so memory stays flat no
 * matter how many rows the export has — a buffered Workbook keeps each cell as
 * an object until writeBuffer, a few hundred MB for ~20k rows.
 */

export const SC_EXPORT_RP_FMT = "#,##0";
export const SC_EXPORT_PCT_FMT = "0.0%";

const BLUE = "FF0063A0";
const WHITE = "FFFFFFFF";

export type ScExportCol = { header: string; key: string; width: number; numFmt?: string };

/** Sheet dengan header berwarna + format angka per kolom (WorkbookWriter: header ditulis manual lalu di-commit). */
export function startScExportSheet(wb: ExcelJS.stream.xlsx.WorkbookWriter, name: string, cols: ScExportCol[]) {
  const ws = wb.addWorksheet(name);
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
  const header = ws.addRow(cols.map((c) => c.header));
  header.font = { bold: true, color: { argb: WHITE } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
  header.alignment = { wrapText: true, vertical: "middle" };
  header.commit();
  return ws;
}

/** Tulis satu baris (objek ber-key) tepat sesuai urutan kolom, lalu commit supaya langsung dilepas dari memori. */
export function writeScExportRow(ws: ExcelJS.Worksheet, cols: ScExportCol[], data: Record<string, unknown>) {
  const row = ws.addRow(cols.map((c) => data[c.key] as ExcelJS.CellValue));
  row.commit();
}
