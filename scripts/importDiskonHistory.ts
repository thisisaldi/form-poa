/**
 * Import "internal/08062026 Data Diskon All Product Jan-Apr'26.xlsx" (sheet
 * "Raw Data", ~490k rows / 196MB) into DiskonHistory — a fallback discount
 * source used ONLY when no DiskonKontrak (DPL) covers an outlet+product (see
 * resolveDiskonPct in LineItemEditor.tsx). DPL always wins when present; this
 * is purely a fallback, never overrides it.
 *
 * The file is too large to load with ExcelJS's normal in-memory reader (OOMs
 * well under 4GB heap) — uses the streaming WorkbookReader instead, row by row.
 *
 * "Total Diskon" and "% Total Diskon" are Excel FORMULA columns (Gross-Net,
 * (Gross-Net)/Gross) — some rows don't have a cached formula result available
 * via the streaming reader, so this recomputes both directly from the literal
 * "Gross Subtotal" / "Net Subtotal" columns instead of reading the formula cells.
 *
 * Aggregates to one weighted-average % per (KodePI, Item Kode) pair:
 *   avgDiskonPct = sum(Gross - Net) / sum(Gross) * 100
 * across every invoice line for that outlet+product in the file.
 *
 * Run: npx tsx scripts/importDiskonHistory.ts [path-to-excel]
 * Default: internal/08062026 Data Diskon All Product Jan-Apr'26.xlsx
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

const SHEET_NAME = "Raw Data";
const DATA_START = 2; // row 1 is the header

// 1-based column indices, matching the header row read during exploration.
const COL = {
  kodePI: 3, periode: 6, itemKode: 7, grossSubtotal: 11, netSubtotal: 12,
} as const;

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? ""));
  return isNaN(n) ? 0 : n;
}

async function main() {
  const filePath = path.resolve(process.argv[2] ?? "internal/08062026 Data Diskon All Product Jan-Apr'26.xlsx");
  console.log(`Reading (streaming): ${filePath}\n`);

  const reader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    entries: "emit", sharedStrings: "cache", styles: "ignore", worksheets: "emit",
  });

  const agg = new Map<string, { gross: number; net: number }>(); // key: kodePI|kodeProduk
  let periodeMin: number | null = null, periodeMax: number | null = null;
  let rowsRead = 0, rowsSkipped = 0;

  for await (const worksheetReader of reader) {
    if (worksheetReader.name !== SHEET_NAME) continue;

    let rn = 0;
    for await (const row of worksheetReader) {
      rn++;
      if (rn < DATA_START) continue;

      const values = row.values as unknown[]; // 1-indexed, values[0] is unused
      const kodePI = String(values[COL.kodePI] ?? "").trim();
      const itemKode = String(values[COL.itemKode] ?? "").trim();
      const gross = toNum(values[COL.grossSubtotal]);
      const net = toNum(values[COL.netSubtotal]);
      const periode = Number(values[COL.periode]);

      if (!kodePI || !itemKode || gross <= 0) { rowsSkipped++; continue; }

      if (!isNaN(periode)) {
        periodeMin = periodeMin == null ? periode : Math.min(periodeMin, periode);
        periodeMax = periodeMax == null ? periode : Math.max(periodeMax, periode);
      }

      const key = `${kodePI}|${itemKode}`;
      const entry = agg.get(key) ?? { gross: 0, net: 0 };
      entry.gross += gross;
      entry.net += net;
      agg.set(key, entry);

      rowsRead++;
      if (rowsRead % 100000 === 0) console.log(`   ...${rowsRead} rows aggregated so far`);
    }
  }

  console.log(`\nRead ${rowsRead} rows (skipped ${rowsSkipped} missing KodePI/Item Kode/Gross).`);
  console.log(`Aggregated to ${agg.size} distinct (outlet, produk) pairs.\n`);

  const sourcePeriod = periodeMin != null && periodeMax != null ? `${periodeMin}-${periodeMax}` : "unknown";
  const now = new Date();

  // Fresh import each run — this is a point-in-time historical snapshot, always replaced wholesale.
  await prisma.diskonHistory.deleteMany({});

  const data = [...agg.entries()]
    .filter(([, v]) => v.gross > 0)
    .map(([key, v]) => {
      const [kodePI, kodeProduk] = key.split("|");
      const avgDiskonPct = ((v.gross - v.net) / v.gross) * 100;
      return { kodePI, kodeProduk, avgDiskonPct: new Prisma.Decimal(avgDiskonPct), sourcePeriod, syncedAt: now };
    });

  const CHUNK = 1000;
  for (let i = 0; i < data.length; i += CHUNK) {
    await prisma.diskonHistory.createMany({ data: data.slice(i, i + CHUNK) });
  }

  console.log(`✅ DiskonHistory populated: ${data.length} rows (source period ${sourcePeriod}).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
