/**
 * Update Product.nilaiRPersen from internal/product_r.xlsx — a new Nilai R
 * source with a DIFFERENT shape than the one scripts/syncNilaiR.ts reads
 * (sheet "Sheet0", columns id/product_code/name/r_value; no precomputed
 * percentage column like the old "Nilai R.xlsx" had). r_value is the
 * absolute NILAI_R figure, so persen = r_value / Product.hna is computed
 * here — same formula the old file's own precomputed percentage column
 * used (verified against a known row before writing this: kodeProduk
 * 013390, r_value 13118 / hna 105000 = 0.1249, matches the existing
 * nilaiRPersen 0.125 already in the DB almost exactly).
 *
 * POA SAFETY: Product.nilaiRPersen is master-data reference only — every
 * PoaLineItem stores its own pengaliNilaiR as a separate, already-entered
 * value (schema.prisma:339 vs :436), never a live read of Product at render
 * time. This script only ever updates Product, so no already-submitted (or
 * still-draft) POA's numbers change because of it — same denormalized-
 * snapshot safety guarantee documented in importStrukturHospital.ts etc.
 *
 * Run: npx tsx scripts/importProductR.ts [path-to-excel]
 * Default: internal/product_r.xlsx
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";

const COL = { productCode: 2, name: 3, rValue: 4 } as const;

async function main() {
  const filePath = path.resolve(process.argv[2] ?? "internal/product_r.xlsx");
  console.log(`Reading: ${filePath}\n`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) { console.error("No worksheet found"); process.exit(1); }

  const rows: { kodeProduk: string; rValue: number }[] = [];
  let skipped = 0;

  for (let rn = 2; rn <= ws.rowCount; rn++) {
    const row = ws.getRow(rn);
    const kodeProduk = String(row.getCell(COL.productCode).value ?? "").trim();
    const rValueRaw = row.getCell(COL.rValue).value;
    const rValue = typeof rValueRaw === "number" ? rValueRaw : parseFloat(String(rValueRaw ?? "")) || null;

    if (!kodeProduk || rValue === null) { skipped++; continue; }
    rows.push({ kodeProduk, rValue });
  }

  console.log(`Parsed ${rows.length} rows (skipped ${skipped} with no product_code/r_value).\n`);

  const kodeProduks = rows.map((r) => r.kodeProduk);
  const products = await prisma.product.findMany({
    where: { kodeProduk: { in: kodeProduks } },
    select: { kodeProduk: true, hna: true },
  });
  const hnaByKode = new Map(products.map((p) => [p.kodeProduk, parseFloat(p.hna.toString())]));

  let updated = 0, notFound = 0, noHna = 0;
  const sample: string[] = [];

  for (const r of rows) {
    const hna = hnaByKode.get(r.kodeProduk);
    if (hna === undefined) { notFound++; continue; }
    if (!hna || hna <= 0) { noHna++; continue; }

    const persen = r.rValue / hna;
    await prisma.product.update({
      where: { kodeProduk: r.kodeProduk },
      data: { nilaiRPersen: persen },
    });
    updated++;
    if (sample.length < 5) sample.push(`${r.kodeProduk}: r_value=${r.rValue} / hna=${hna} = ${persen.toFixed(6)}`);
  }

  console.log(`✅ Done.`);
  console.log(`   Updated       : ${updated} products`);
  console.log(`   Not found     : ${notFound} (kodeProduk not in Product table)`);
  console.log(`   No/zero HNA   : ${noHna} (can't compute persen without it)`);
  console.log(`\n   Sample:`);
  sample.forEach((s) => console.log(`   ${s}`));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
