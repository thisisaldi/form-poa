/**
 * Import Listing Fee contracts from excel/20260528_Listing Fee KAM 202604_FIC.xlsx
 * into the ListingFeeKontrak table.
 *
 * Reads sheet "ListingFeeKPDMHrz" (clean rows, YYYYMM periods already computed,
 * plus monthly BM_YYYYMM and % LISTING_YYYYMM columns folded into JSONB maps).
 *
 * Run: npx tsx scripts/importListingFee.ts [path-to-excel]
 * Default: excel/20260528_Listing Fee KAM 202604_FIC.xlsx
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";
import { Prisma } from "@prisma/client";

const SHEET_NAME = "ListingFeeKPDMHrz";

const COL = {
  noreq: 1, div: 2, jenis: 3, tglApprove: 4, tglPpud: 5, noOr: 6,
  kdCust: 7, nmCust: 8, kdOutlet: 9, nmOutlet: 10,
  awal: 11, akhir: 12, value: 13, targetSales: 14,
  kdProduk: 15, nmProduk: 16, nsm: 17,
  prdAwal: 18, prdAkhir: 19,
} as const;

function cellText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object" && "result" in (v as object)) {
    return String((v as { result: unknown }).result ?? "").trim() || null;
  }
  const s = String(v).trim();
  return s || null;
}

function cellNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  const s = cellText(v);
  if (s == null) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function cellDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  const s = cellText(v);
  if (!s) return null;
  // Format DD-MM-YYYY
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function periodeYYYYMM(v: unknown): string | null {
  const s = cellText(v);
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  return digits.length === 6 ? digits : null;
}

async function main() {
  const filePath = path.resolve(process.argv[2] ?? "excel/20260528_Listing Fee KAM 202604_FIC.xlsx");
  console.log(`Reading: ${filePath}\n`);

  // Snapshot date from filename prefix (YYYYMMDD)
  const dateMatch = path.basename(filePath).match(/(\d{8})/);
  const snapshotDate = dateMatch
    ? new Date(
        parseInt(dateMatch[1].slice(0, 4)),
        parseInt(dateMatch[1].slice(4, 6)) - 1,
        parseInt(dateMatch[1].slice(6, 8))
      )
    : null;

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) { console.error(`Sheet "${SHEET_NAME}" not found`); process.exit(1); }

  // Column headers to detect BM_YYYYMM / % LISTING_YYYYMM period columns
  const headerRow = ws.getRow(1);
  const bmCols: { col: number; period: string }[] = [];
  const pctCols: { col: number; period: string }[] = [];
  for (let c = 1; c <= ws.columnCount; c++) {
    const h = cellText(headerRow.getCell(c).value) ?? "";
    const bmMatch = h.match(/^BM_(\d{6})$/);
    if (bmMatch) bmCols.push({ col: c, period: bmMatch[1] });
    const pctMatch = h.match(/^% LISTING_(\d{6})$/);
    if (pctMatch) pctCols.push({ col: c, period: pctMatch[1] });
  }
  console.log(`Found ${bmCols.length} BM period columns, ${pctCols.length} % LISTING period columns.\n`);

  let upserted = 0, skipped = 0;

  for (let rn = 2; rn <= ws.rowCount; rn++) {
    const row = ws.getRow(rn);
    const noreq = cellText(row.getCell(COL.noreq).value);
    const kdCust = cellText(row.getCell(COL.kdCust).value);
    const nmCust = cellText(row.getCell(COL.nmCust).value);
    const value = cellNumber(row.getCell(COL.value).value);
    const prdAwal = periodeYYYYMM(row.getCell(COL.prdAwal).value);
    const prdAkhir = periodeYYYYMM(row.getCell(COL.prdAkhir).value);

    if (!noreq || !kdCust || !nmCust || value == null || !prdAwal || !prdAkhir) {
      skipped++;
      continue;
    }

    const bmByPeriod: Record<string, number> = {};
    for (const { col, period } of bmCols) {
      const v = cellNumber(row.getCell(col).value);
      if (v != null) bmByPeriod[period] = v;
    }
    const pctListingByPeriod: Record<string, number> = {};
    for (const { col, period } of pctCols) {
      const v = cellNumber(row.getCell(col).value);
      if (v != null) pctListingByPeriod[period] = v;
    }

    const kdProduk = cellText(row.getCell(COL.kdProduk).value);

    await prisma.listingFeeKontrak.upsert({
      where: { noreq_kdProduk: { noreq, kdProduk: kdProduk ?? "" } },
      create: {
        noreq,
        div: cellText(row.getCell(COL.div).value),
        jenis: cellText(row.getCell(COL.jenis).value),
        tglApprove: cellDate(row.getCell(COL.tglApprove).value),
        tglPpud: cellDate(row.getCell(COL.tglPpud).value),
        noOr: cellText(row.getCell(COL.noOr).value),
        kdCust,
        nmCust,
        kdOutlet: cellText(row.getCell(COL.kdOutlet).value),
        nmOutlet: cellText(row.getCell(COL.nmOutlet).value),
        prdAwal,
        prdAkhir,
        value: new Prisma.Decimal(value.toFixed(2)),
        targetSales: (() => {
          const t = cellNumber(row.getCell(COL.targetSales).value);
          return t != null ? new Prisma.Decimal(t.toFixed(2)) : null;
        })(),
        kdProduk,
        nmProduk: cellText(row.getCell(COL.nmProduk).value),
        nsm: cellText(row.getCell(COL.nsm).value),
        bmByPeriod,
        pctListingByPeriod,
        snapshotDate,
      },
      update: {
        div: cellText(row.getCell(COL.div).value),
        jenis: cellText(row.getCell(COL.jenis).value),
        tglApprove: cellDate(row.getCell(COL.tglApprove).value),
        tglPpud: cellDate(row.getCell(COL.tglPpud).value),
        noOr: cellText(row.getCell(COL.noOr).value),
        nmCust,
        kdOutlet: cellText(row.getCell(COL.kdOutlet).value),
        nmOutlet: cellText(row.getCell(COL.nmOutlet).value),
        prdAwal,
        prdAkhir,
        value: new Prisma.Decimal(value.toFixed(2)),
        targetSales: (() => {
          const t = cellNumber(row.getCell(COL.targetSales).value);
          return t != null ? new Prisma.Decimal(t.toFixed(2)) : null;
        })(),
        nmProduk: cellText(row.getCell(COL.nmProduk).value),
        nsm: cellText(row.getCell(COL.nsm).value),
        bmByPeriod,
        pctListingByPeriod,
        snapshotDate,
      },
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
