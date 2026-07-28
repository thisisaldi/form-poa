/**
 * Import DPL (Diskon Penjualan Langsung) contracts from
 * internal/DPL MEI 2026.xlsx into the DiskonKontrak table — the PRIMARY
 * source for "% Diskon (DPL/DPF)" (see resolveDiskonPct in
 * LineItemEditor.tsx). scripts/importDiskonHistory.ts populates the
 * FALLBACK source (DiskonHistory), only ever consulted when no row here
 * covers the outlet+product+period.
 *
 * Reads sheet "DPL" (one row per NOMOR contract × PRODUK). "NEW ON_PI" is the
 * effective/active on-invoice discount % — the column PoaLineItem.avgDiskon is
 * derived from when a contract's period is running for the POA being edited.
 *
 * Run: npx tsx scripts/importDpl.ts [path-to-excel]
 * Default: excel/DPL MEI 2026.xlsx
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";
import { Prisma } from "@prisma/client";

const SHEET_NAME = "DPL";

const COL = {
  nomor: 1, nmAreaPi: 2, areaPi: 3, kodePI: 4, namaOutlet: 5, bumn: 6,
  prdAwal: 7, prdAkhir: 8, divisi: 9, kodeProduk: 10, namaProduk: 11,
  onPi: 12, offPi: 13, onDist: 14, offDist: 15, qtyBon: 16, qtyBuy: 17,
  newOnPi: 18,
} as const;

const INDO_MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, jun: 5,
  jul: 6, agu: 7, sep: 8, okt: 9, nov: 10, des: 11,
};

function cellRaw(v: unknown): unknown {
  if (v != null && typeof v === "object" && "result" in (v as object)) {
    return (v as { result: unknown }).result;
  }
  return v;
}

function cellText(v: unknown): string | null {
  const raw = cellRaw(v);
  if (raw == null) return null;
  const s = String(raw).trim();
  return s || null;
}

function cellNumber(v: unknown): number | null {
  const raw = cellRaw(v);
  if (typeof raw === "number") return raw;
  const s = cellText(v);
  if (s == null) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function periodeYYYYMM(v: unknown): string | null {
  const raw = cellRaw(v);
  if (raw instanceof Date) {
    return `${raw.getFullYear()}${String(raw.getMonth() + 1).padStart(2, "0")}`;
  }
  const s = cellText(v);
  if (!s) return null;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const digits = s.replace(/\D/g, "");
  return digits.length === 6 ? digits : null;
}

async function main() {
  const filePath = path.resolve(process.argv[2] ?? "excel/DPL MEI 2026.xlsx");
  console.log(`Reading: ${filePath}\n`);

  // Snapshot date from filename "DPL <BULAN> <TAHUN>.xlsx", e.g. "DPL MEI 2026.xlsx"
  const nameMatch = path.basename(filePath).match(/([A-Za-z]{3,})\s+(\d{4})/);
  const snapshotDate = (() => {
    if (!nameMatch) return null;
    const month = INDO_MONTHS[nameMatch[1].slice(0, 3).toLowerCase()];
    if (month == null) return null;
    return new Date(parseInt(nameMatch[2]), month, 1);
  })();

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) { console.error(`Sheet "${SHEET_NAME}" not found`); process.exit(1); }

  let upserted = 0, skipped = 0;

  for (let rn = 2; rn <= ws.rowCount; rn++) {
    const row = ws.getRow(rn);
    const nomor = cellText(row.getCell(COL.nomor).value);
    const kodePIRaw = cellText(row.getCell(COL.kodePI).value);
    const areaPi = cellText(row.getCell(COL.areaPi).value);
    const kodeProduk = cellText(row.getCell(COL.kodeProduk).value);
    const prdAwal = periodeYYYYMM(row.getCell(COL.prdAwal).value);
    const prdAkhir = periodeYYYYMM(row.getCell(COL.prdAkhir).value);

    if (!nomor || !kodePIRaw || !kodeProduk || !prdAwal || !prdAkhir) {
      skipped++;
      continue;
    }

    // Outlet.kodePI is areaPi + the raw numeric KODEPI from this sheet (e.g. "G1" + "000343").
    const kodePI = (areaPi ?? "") + kodePIRaw;

    const onPi = cellNumber(row.getCell(COL.onPi).value);
    // NEW ON_PI's own formula falls back to 0.0 when its lookup misses — mirror that.
    const newOnPi = cellNumber(row.getCell(COL.newOnPi).value) ?? 0;

    const data = {
      nmAreaPi: cellText(row.getCell(COL.nmAreaPi).value),
      areaPi,
      kodePIRaw,
      namaOutlet: cellText(row.getCell(COL.namaOutlet).value),
      bumn: cellText(row.getCell(COL.bumn).value),
      divisi: cellText(row.getCell(COL.divisi).value),
      prdAwal,
      prdAkhir,
      namaProduk: cellText(row.getCell(COL.namaProduk).value),
      onPi: onPi != null ? new Prisma.Decimal(onPi.toFixed(4)) : null,
      offPi: (() => { const v = cellNumber(row.getCell(COL.offPi).value); return v != null ? new Prisma.Decimal(v.toFixed(4)) : null; })(),
      onDist: (() => { const v = cellNumber(row.getCell(COL.onDist).value); return v != null ? new Prisma.Decimal(v.toFixed(4)) : null; })(),
      offDist: (() => { const v = cellNumber(row.getCell(COL.offDist).value); return v != null ? new Prisma.Decimal(v.toFixed(4)) : null; })(),
      qtyBon: (() => { const v = cellNumber(row.getCell(COL.qtyBon).value); return v != null ? new Prisma.Decimal(v.toFixed(2)) : null; })(),
      qtyBuy: (() => { const v = cellNumber(row.getCell(COL.qtyBuy).value); return v != null ? new Prisma.Decimal(v.toFixed(2)) : null; })(),
      newOnPi: new Prisma.Decimal(newOnPi.toFixed(4)),
      snapshotDate,
    };

    await prisma.diskonKontrak.upsert({
      where: { nomor_kodeProduk: { nomor, kodeProduk } },
      create: { nomor, kodePI, kodeProduk, ...data },
      update: { kodePI, ...data },
    });
    upserted++;
  }

  console.log(`✅ Done.`);
  console.log(`   Upserted: ${upserted} rows`);
  console.log(`   Skipped : ${skipped} (missing required fields)`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
