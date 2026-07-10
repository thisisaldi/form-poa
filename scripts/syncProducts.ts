/**
 * Standalone script — run via: npx tsx scripts/syncProducts.ts <path-to-excel>
 *
 * Reads "LIST PRODUK PI" Excel file and upserts all products into the Product table.
 * Uses sheet "Update 15 JUNI (Generik)" (col layout: Procode, Brand, Nama, ZatAktif, Satuan, HNA).
 * Skips rows where Procode or HNA is missing.
 *
 * Usage:
 *   npx tsx scripts/syncProducts.ts "LIST PRODUK PI update 15 Juni 2026.xlsx"
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";

const SHEET_NAME = "Update 15 JUNI (Generik)";
const DATA_START_ROW = 4; // row 3 is header, row 4 is first data row

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx scripts/syncProducts.ts <path-to-excel>");
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  console.log(`Reading: ${absPath}`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(absPath);

  const sheet = wb.getWorksheet(SHEET_NAME);
  if (!sheet) {
    console.error(`Sheet "${SHEET_NAME}" not found in workbook.`);
    process.exit(1);
  }

  const now = new Date();
  let upserted = 0;
  let skipped = 0;

  for (let r = DATA_START_ROW; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const kodeProduk = String(row.getCell(3).value ?? "").trim();
    const namaGroupBrand = String(row.getCell(4).value ?? "").trim();
    const namaProduk = String(row.getCell(5).value ?? "").trim();
    const zatAktif = String(row.getCell(6).value ?? "").trim() || null;
    const satuan = String(row.getCell(7).value ?? "").trim();
    const hnaRaw = row.getCell(8).value;
    const hna = typeof hnaRaw === "number" ? hnaRaw : parseFloat(String(hnaRaw ?? ""));

    if (!kodeProduk || isNaN(hna)) {
      skipped++;
      continue;
    }

    await prisma.product.upsert({
      where: { kodeProduk },
      update: { namaGroupBrand, namaProduk, zatAktif, satuan, hna, syncedAt: now, updatedAt: now },
      create: { kodeProduk, namaGroupBrand, namaProduk, zatAktif, satuan, hna, syncedAt: now },
    });
    upserted++;
  }

  console.log(`Done. Upserted: ${upserted}, Skipped: ${skipped}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
