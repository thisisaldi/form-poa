/**
 * Enriches Product with Zat Aktif + dosis reference data from
 * "List Product pharos.xlsx" (sheets "Oral Product" / "Injeksi Product").
 *
 * That file's "PROCOD" column despite the name matches Product.kodeProduk
 * (Kd Item) directly — verified 07-20 against the live DB (191/192 codes
 * matched exactly, only 1 not found). No bridge/mapping file needed.
 *
 * Layout (header row 3, data from row 4):
 *   Col 2:  PROCOD                                              → kodeProduk
 *   Col 4:  ZAT AKTIF                                            → zatAktif
 *   Col 5:  DOSIS/KEKUATAN SEDIAAN                                → dosisKekuatanSediaan
 *   Col 6:  Berapa banyak per Rx per Pasien (Satuan Terkecil)     → qtyPerRxPasien
 *   Col 7:  Lama pemberian Per Pasien (Hari)                     → lamaPemberianHari
 *   Col 8:  Jumlah pemberian Per hari (Satuan Terkecil)           → jumlahPemberianPerHari
 *   Col 9:  BENTUK SEDIAAN                                        → bentukSediaan
 *   Col 10: PACKING                                               → packing
 *   Col 11: INDIKASI                                              → indikasi
 *
 * Rows without a PROCOD value are category header rows — skipped.
 *
 * Run: npx tsx scripts/syncProductZatAktifDosis.ts [path-to-excel]
 * Default: internal/List Product pharos.xlsx
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

const DATA_START = 4;
const SHEETS = ["Oral Product", "Injeksi Product"];

function str(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).trim());
  return isNaN(n) ? null : n;
}

async function main() {
  const filePath = path.resolve(process.argv[2] ?? "internal/List Product pharos.xlsx");
  console.log(`Reading: ${filePath}\n`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  let updated = 0, notFound = 0, skipped = 0;
  const notFoundCodes: string[] = [];

  for (const sheetName of SHEETS) {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) { console.error(`Sheet '${sheetName}' not found — skipping.`); continue; }

    for (let r = DATA_START; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const kodeProduk = str(row.getCell(2).value);
      if (!kodeProduk) { skipped++; continue; } // category header row

      const zatAktif = str(row.getCell(4).value);
      const dosisKekuatanSediaan = str(row.getCell(5).value);
      const qtyPerRxPasien = num(row.getCell(6).value);
      const lamaPemberianHari = num(row.getCell(7).value);
      const jumlahPemberianPerHari = num(row.getCell(8).value);
      const bentukSediaan = str(row.getCell(9).value);
      const packing = str(row.getCell(10).value);
      const indikasi = str(row.getCell(11).value);

      const result = await prisma.product.updateMany({
        where: { kodeProduk },
        data: {
          zatAktif,
          dosisKekuatanSediaan,
          qtyPerRxPasien: qtyPerRxPasien != null ? new Prisma.Decimal(qtyPerRxPasien) : null,
          lamaPemberianHari: lamaPemberianHari != null ? Math.round(lamaPemberianHari) : null,
          jumlahPemberianPerHari: jumlahPemberianPerHari != null ? new Prisma.Decimal(jumlahPemberianPerHari) : null,
          bentukSediaan,
          packing,
          indikasi,
        },
      });

      if (result.count > 0) updated++;
      else { notFound++; notFoundCodes.push(`${kodeProduk} (${sheetName})`); }
    }
  }

  console.log(`✅ Done.`);
  console.log(`   Updated       : ${updated}`);
  console.log(`   Not found in Product table: ${notFound}`);
  console.log(`   Skipped (category header rows): ${skipped}`);
  if (notFoundCodes.length > 0) console.log(`   Missing codes: ${notFoundCodes.join(", ")}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
