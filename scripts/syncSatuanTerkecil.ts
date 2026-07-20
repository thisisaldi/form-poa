/**
 * Reads "Kebutuhan Satuan Terkecil.xlsx" and populates
 * Product.satuanTerkecil + Product.konversiPembagi for each matching product.
 *
 * The sheet keys rows by "Kode Item", which matches Product.kodeProduk
 * directly since Product is sourced from LAPORAN HNA SARUASUBUR keyed by the
 * same code. No bridge/mapping file needed.
 *
 * Run: npx tsx scripts/syncSatuanTerkecil.ts
 */

import ExcelJS from "exceljs";
import path from "path";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const EXCEL_PATH = path.join(process.cwd(), "excel", "Kebutuhan Satuan Terkecil.xlsx");

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL_PATH);

  const ws = wb.getWorksheet("Data Satuan Sell Pack Cent");
  if (!ws) throw new Error("Sheet 'Data Satuan Sell Pack Cent' not found");

  interface Row { kodeProduk: string; packName: string; konversi: number }
  const rows: Row[] = [];

  ws.eachRow((row, rn) => {
    if (rn === 1) return; // skip header
    const kodeProduk = row.getCell(1).value?.toString().trim();  // Kode Item — matches Product.kodeProduk directly
    const packName = row.getCell(4).value?.toString().trim().toUpperCase();
    const konversi = Number(row.getCell(5).value);
    if (kodeProduk && packName && konversi > 0) {
      rows.push({ kodeProduk, packName, konversi });
    }
  });

  console.log(`Read ${rows.length} rows from Excel`);

  let updated = 0, skipped = 0;

  for (const r of rows) {
    const result = await prisma.product.updateMany({
      where: { kodeProduk: r.kodeProduk },
      data: {
        satuanTerkecil: r.packName,
        konversiPembagi: new Prisma.Decimal(r.konversi),
      },
    });
    if (result.count > 0) updated++;
    else skipped++;
  }

  console.log(`Updated: ${updated} | Not found in DB: ${skipped}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
