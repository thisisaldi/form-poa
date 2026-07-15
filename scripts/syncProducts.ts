/**
 * Sync products from "LAPORAN HNA" Excel into the Product table.
 *
 * Source layout (sheet "Sheet1", header row 8):
 *   Col 3:  Kd Item      → kodeProduk  (primary key)
 *   Col 4:  Nama Item    → namaProduk
 *   Col 11: Group Brand  → namaGroupBrand
 *   Col 12: HNA          → hna
 *
 * Satuan is supplemented from the LIST PRODUK file when provided as second arg.
 * Rows where Kd Item is missing are skipped.
 *
 * Usage:
 *   npx tsx scripts/syncProducts.ts <hna-file.xlsx> [list-produk.xlsx]
 *
 * Example:
 *   npx tsx scripts/syncProducts.ts \
 *     "excel/TKT202607020007 - LAPORAN HNA SARUASUBUR.xlsx" \
 *     "excel/LIST PRODUK PI update 15 Juni 2026.xlsx"
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";

const HNA_HEADER_ROW  = 8;
const HNA_DATA_START  = 9;
const LIST_DATA_START = 4;

async function loadSatuanMap(listProdukPath: string): Promise<Map<string, string>> {
  const map = new Map<string, string>(); // kodeProduk → satuan
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(listProdukPath);
  for (const sheetName of ["Update 15 JUNI (Generik)", "Update 15 JUNI (Nama Produk)"]) {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) continue;
    for (let r = LIST_DATA_START; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const kode   = String(row.getCell(3).value ?? "").trim();
      const satuan = String(row.getCell(7).value ?? "").trim();
      if (kode && satuan) map.set(kode, satuan);
    }
  }
  console.log(`Loaded ${map.size} satuan entries from LIST PRODUK.`);
  return map;
}

function clean(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s === "" || s.toUpperCase() === "NULL" ? null : s;
}

async function main() {
  const hnaPath  = process.argv[2];
  const listPath = process.argv[3];

  if (!hnaPath) {
    console.error("Usage: npx tsx scripts/syncProducts.ts <hna-file.xlsx> [list-produk.xlsx]");
    process.exit(1);
  }

  const hnaAbs = path.resolve(hnaPath);
  console.log(`Reading HNA file: ${hnaAbs}`);

  // Optional satuan supplement
  const satuanMap = listPath ? await loadSatuanMap(path.resolve(listPath)) : new Map<string, string>();

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(hnaAbs);

  const ws = wb.getWorksheet("Sheet1");
  if (!ws) { console.error('Sheet "Sheet1" not found.'); process.exit(1); }

  // Validate header row
  const header3 = String(ws.getRow(HNA_HEADER_ROW).getCell(3).value ?? "").trim();
  if (!header3.toLowerCase().includes("item")) {
    console.warn(`Warning: expected "Kd Item" at col 3 row ${HNA_HEADER_ROW}, got "${header3}"`);
  }

  const now = new Date();
  let upserted = 0, skipped = 0;

  for (let r = HNA_DATA_START; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const kodeProduk    = clean(row.getCell(3).value);
    const namaProduk    = clean(row.getCell(4).value);
    const namaGroupBrand = clean(row.getCell(11).value) ?? "—";
    const hnaRaw        = row.getCell(12).value;
    const hna           = typeof hnaRaw === "number" ? hnaRaw : parseFloat(String(hnaRaw ?? "0")) || 0;
    const satuan        = satuanMap.get(kodeProduk ?? "") ?? "—";

    if (!kodeProduk || !namaProduk) { skipped++; continue; }

    await prisma.product.upsert({
      where:  { kodeProduk },
      update: { namaGroupBrand, namaProduk, satuan, hna, syncedAt: now, updatedAt: now },
      create: { kodeProduk, namaGroupBrand, namaProduk, zatAktif: null, satuan, hna, syncedAt: now },
    });
    upserted++;
  }

  console.log(`\nDone. Upserted: ${upserted} | Skipped: ${skipped}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
