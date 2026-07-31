/**
 * Import "internal/Rekomendasi Paket Produk Per Spesialisasi.xlsx", sheet
 * "Recommendation", into Product.spesialisasiRekomendasi.
 *
 * Source shape: header row 1, columns A-V — NO, PROCOD, PRODUCTS, GENERIC,
 * PACKING, HNA, HET, "Hospital Type A B", "Hospital Type C D / Klinik", then
 * one Y/blank column per specialty: BEDAH, ANASTESI, Orthopedi, "GP &UGD",
 * INTERNIST, GASTRO, JANTUNG, NEURO, OBGYN, PULMO, PEDIATRICT, PSIKIATRI,
 * UROLOGY (columns J-V, i.e. index 10-21 in a 1-based row array). Some rows
 * are section-header rows (PROCOD blank) — skipped. PROCOD is the same
 * zero-padded code as Product.kodeProduk.
 *
 * A handful of PROCODs repeat with different PRODUCTS text (source data
 * quality issue — not ours to fix here); when that happens this script
 * unions the Y columns across every row sharing that PROCOD, on the
 * assumption that the code, not the label, is authoritative once matched
 * against our own Product table.
 *
 * Effects: sets Product.spesialisasiRekomendasi (uppercased column names,
 * e.g. "BEDAH", "ORTHOPEDI", "GP &UGD") for every PROCOD that matches an
 * existing Product row. Rows whose PROCOD has no matching Product are
 * skipped (and counted) — this reference sheet is a curated subset, not a
 * product master, so it must not create Product rows of its own.
 *
 * Run: npx tsx scripts/importProductSpesialisasiRekomendasi.ts [path-to-excel]
 * Default: "internal/Rekomendasi Paket Produk Per Spesialisasi.xlsx"
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";

const BATCH = 200;

// Column index (1-based, ExcelJS cell numbering) -> uppercased specialty label.
const SPESIALISASI_COLUMNS: { col: number; label: string }[] = [
  { col: 10, label: "BEDAH" },
  { col: 11, label: "ANASTESI" },
  { col: 12, label: "ORTHOPEDI" },
  { col: 13, label: "GP &UGD" },
  { col: 14, label: "INTERNIST" },
  { col: 15, label: "GASTRO" },
  { col: 16, label: "JANTUNG" },
  { col: 17, label: "NEURO" },
  { col: 18, label: "OBGYN" },
  { col: 19, label: "PULMO" },
  { col: 20, label: "PEDIATRICT" },
  { col: 21, label: "PSIKIATRI" },
  { col: 22, label: "UROLOGY" },
];

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

async function main() {
  const filePath = path.resolve(process.argv[2] ?? "internal/Rekomendasi Paket Produk Per Spesialisasi.xlsx");
  console.log(`Reading: ${filePath}\n`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet("Recommendation");
  if (!ws) { console.error('Sheet "Recommendation" not found'); process.exit(1); }

  const byProcod = new Map<string, Set<string>>();
  let skippedBlankProcod = 0;

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const procod = String(row.getCell(2).value ?? "").trim();
    if (!procod) { skippedBlankProcod++; continue; }

    const labels = byProcod.get(procod) ?? new Set<string>();
    for (const { col, label } of SPESIALISASI_COLUMNS) {
      const v = String(row.getCell(col).value ?? "").trim().toUpperCase();
      if (v === "Y") labels.add(label);
    }
    byProcod.set(procod, labels);
  }

  console.log(`Parsed ${byProcod.size} distinct PROCOD (skipped ${skippedBlankProcod} rows with blank PROCOD — section headers).\n`);

  // ── Filter to products that actually exist ────────────────────────────────
  const productRows = await prisma.product.findMany({ select: { kodeProduk: true } });
  const validKodeProduk = new Set(productRows.map((p: { kodeProduk: string }) => p.kodeProduk));
  const matched = [...byProcod.entries()].filter(([procod]) => validKodeProduk.has(procod));
  const skippedNoProduct = byProcod.size - matched.length;
  console.log(`${matched.length}/${byProcod.size} PROCODs match an existing Product (${skippedNoProduct} skipped — no matching kodeProduk).\n`);

  console.log(`Updating ${matched.length} Product rows...`);
  for (let i = 0; i < matched.length; i += BATCH) {
    const chunk = matched.slice(i, i + BATCH);
    await Promise.all(chunk.map(([procod, labels]) =>
      prisma.$executeRawUnsafe(
        `UPDATE "Product" SET "spesialisasiRekomendasi" = ARRAY[${[...labels].map((l) => `'${esc(l)}'`).join(",")}]::TEXT[] WHERE "kodeProduk" = '${esc(procod)}'`
      )
    ));
    process.stdout.write(`  ${Math.min(i + BATCH, matched.length)}/${matched.length}\r`);
  }
  console.log(`\n✅ Product.spesialisasiRekomendasi updated: ${matched.length} rows.\n`);

  console.log("✅ Import complete.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
