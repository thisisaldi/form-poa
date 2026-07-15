/**
 * Sync Product.nilaiRPersen from excel/Nilai R.xlsx.
 *
 * Sheet "Nilai R", header row 1, data from row 2:
 *   Col 1: KD_PRODUK  (6-digit, matches Product.kodeProduk)
 *   Col 5: NILAI_R    (absolute value)
 *   Col 6: persentase (NILAI_R / HNA — this is what we store)
 *
 * Run: npx tsx scripts/syncNilaiR.ts [path-to-excel]
 * Default: excel/Nilai R.xlsx
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";

async function main() {
  const filePath = path.resolve(process.argv[2] ?? "excel/Nilai R.xlsx");
  console.log(`Reading: ${filePath}\n`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const ws = wb.getWorksheet("Nilai R");
  if (!ws) { console.error('Sheet "Nilai R" not found'); process.exit(1); }

  let updated = 0, skipped = 0, notFound = 0;

  for (let rn = 2; rn <= ws.rowCount; rn++) {
    const row = ws.getRow(rn);
    const kodeProduk = String(row.getCell(1).value ?? "").trim();
    const persenRaw  = row.getCell(6).value;
    const persen     = typeof persenRaw === "number" ? persenRaw : parseFloat(String(persenRaw ?? "")) || null;

    if (!kodeProduk) { skipped++; continue; }
    if (persen === null) { skipped++; continue; }

    const result = await prisma.product.updateMany({
      where: { kodeProduk },
      data: { nilaiRPersen: persen },
    });

    if (result.count > 0) updated++;
    else notFound++;
  }

  console.log(`✅ Done.`);
  console.log(`   Updated  : ${updated} products`);
  console.log(`   Not found: ${notFound} (kodeProduk not in Product table)`);
  console.log(`   Skipped  : ${skipped} (empty kode or persen)`);

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
