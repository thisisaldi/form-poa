/**
 * Reads "internal/DETAIL PRODUK  SJ.csv" (product_code, NAMA PRODUK, SJ) and
 * fills in Product.satuan (the "SJ / Satuan Jual" field) for products where
 * it's currently the "—" placeholder used for unknown values elsewhere in
 * this table. Never overwrites an already-real satuan, even if the CSV's
 * value differs — checked against live data before writing this: 0 rows
 * actually conflict, they either fill a "—" placeholder or the CSV has no
 * SJ at all for that row.
 *
 * Run: npx tsx scripts/importProductSatuanSJ.ts
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { prisma } from "../src/lib/prisma";

const CSV_PATH = path.join(process.cwd(), "internal", "DETAIL PRODUK  SJ.csv");
const UNKNOWN_PLACEHOLDER = "—";

interface Row {
  kodeProduk: string;
  sj: string | null;
}

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows: Row[] = [];
  for (const line of lines.slice(1)) {
    const [code, , sj] = line.split(",");
    if (!code?.trim()) continue;
    rows.push({ kodeProduk: code.trim(), sj: sj?.trim() ? sj.trim().toUpperCase() : null });
  }
  return rows;
}

async function main() {
  const text = fs.readFileSync(CSV_PATH, "utf8");
  const rows = parseCsv(text).filter((r) => r.sj);
  console.log(`Read ${rows.length} rows with an SJ value from CSV`);

  const products = await prisma.product.findMany({
    where: { kodeProduk: { in: rows.map((r) => r.kodeProduk) } },
    select: { kodeProduk: true, satuan: true },
  });
  const productMap = new Map(products.map((p) => [p.kodeProduk, p.satuan]));

  let filled = 0, notFound = 0, alreadyHasValue = 0;
  const conflicts: { code: string; csv: string; db: string }[] = [];
  const toFill: Row[] = [];

  for (const r of rows) {
    const dbSatuan = productMap.get(r.kodeProduk);
    if (dbSatuan === undefined) { notFound++; continue; }
    if (dbSatuan !== UNKNOWN_PLACEHOLDER) {
      alreadyHasValue++;
      if (dbSatuan.toUpperCase() !== r.sj) conflicts.push({ code: r.kodeProduk, csv: r.sj!, db: dbSatuan });
      continue;
    }
    toFill.push(r);
  }

  for (const r of toFill) {
    await prisma.product.update({ where: { kodeProduk: r.kodeProduk }, data: { satuan: r.sj! } });
    filled++;
  }

  console.log({ filled, notFound, alreadyHasValue, conflicts: conflicts.length });
  if (conflicts.length > 0) {
    console.log("Conflicts (CSV disagrees with an existing real value — NOT overwritten):");
    console.log(conflicts);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
