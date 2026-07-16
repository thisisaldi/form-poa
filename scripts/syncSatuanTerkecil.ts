/**
 * Reads "Kebutuhan Satuan Terkecil.xlsx" and populates
 * Product.satuanTerkecil + Product.konversiPembagi for each matching product.
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

  interface Row { proCode: string; proName: string; packName: string; konversi: number }
  const rows: Row[] = [];

  ws.eachRow((row, rn) => {
    if (rn === 1) return; // skip header
    const proCode  = row.getCell(2).value?.toString().trim();
    const proName  = row.getCell(3).value?.toString().trim() ?? "";
    const packName = row.getCell(4).value?.toString().trim().toUpperCase();
    const konversi = Number(row.getCell(5).value);
    if (proCode && packName && konversi > 0) {
      rows.push({ proCode, proName, packName, konversi });
    }
  });

  console.log(`Read ${rows.length} rows from Excel`);

  let updated = 0, skipped = 0;

  for (const r of rows) {
    // Try exact code match first, fall back to name match
    let result = await prisma.product.updateMany({
      where: { kodeProduk: r.proCode },
      data: {
        satuanTerkecil: r.packName,
        konversiPembagi: new Prisma.Decimal(r.konversi),
      },
    });

    if (result.count === 0) {
      // Fallback: strip backtick-quoted parts from name and match by namaProduk
      const normName = r.proName.replace(/`[^`]*`/g, "").trim();
      result = await prisma.product.updateMany({
        where: { namaProduk: { equals: normName, mode: "insensitive" } },
        data: {
          satuanTerkecil: r.packName,
          konversiPembagi: new Prisma.Decimal(r.konversi),
        },
      });
    }

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
