/**
 * Import PSSP contract history into PsspKontrak table.
 *
 * Source (2026-07-22): "PSSP VB Horizontal dan Vertikal.xlsx", sheet
 * "PSSPVBHor" — replaces the old "20260630_PSSP Pelunasan..." file/format.
 * "PSSPVBVer" (the other sheet in this workbook) is the same data unpivoted
 * to one-row-per-period — redundant for our purposes, not imported.
 *
 * Column differences from the old format:
 *   - No "BM_" (Biaya Murni) columns at all anymore, and no "EstBaris"/
 *     "BM_BARIS" row-total columns — only per-period "Estimasi_YYYYMM" and
 *     "Pelunasan_YYYYMM". estBaris/totalEst are now computed as the sum of
 *     Estimasi_YYYYMM across all period columns (the closest available
 *     substitute for the old dedicated total column). bmBaris/totalBm are
 *     left null and bmByPeriod "{}" — nothing in the app reads them (only
 *     biaya/estBaris/totalLunas are ever queried, see getPsspHistory /
 *     getActivePsspByOutlets in app/actions/customer.ts), so this is safe.
 *   - New "QtyEst_YYYYMM" quantity columns exist but aren't imported — no
 *     schema field or UI consumes a quantity dimension from this table yet.
 *   - "ROLE" column is gone, replaced by "GOL" (golongan/tier, e.g. "USER") —
 *     stored in the `role` field as the closest analog; nothing reads it downstream.
 *   - No date is embedded in this file's name (unlike the old
 *     "20260630_..." naming) — snapshotDate is just the import run's date.
 *
 * This file is large (~30k rows, ~37MB) — run with extra heap:
 *   node --max-old-space-size=6144 node_modules/.bin/tsx scripts/importPsspKontrak.ts [path-to-excel]
 * Default: internal/PSSP VB Horizontal dan Vertikal.xlsx
 *
 * Full-replace semantics (2026-07-22, "ikuti yang baru, yang lama buang" —
 * same principle as the org-struktur/outlet-assignment imports this session):
 * after upserting every row from this run, any PREVIOUSLY-imported PsspKontrak
 * row whose (cUrut, kdProduk) key is NOT in this run's data is deleted — a
 * contract that no longer appears in the latest snapshot is closed/superseded,
 * not still-active stale data.
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

const SHEET_NAME = "PSSPVBHor";

function cellRaw(v: unknown): unknown {
  if (v != null && typeof v === "object" && "result" in (v as object)) {
    return (v as { result: unknown }).result;
  }
  return v;
}

function txt(v: unknown): string | null {
  const raw = cellRaw(v);
  if (raw == null) return null;
  const s = String(raw).trim();
  return s || null;
}

function flt(v: unknown, fallback = 0): number {
  const raw = cellRaw(v);
  if (typeof raw === "number") return isNaN(raw) ? fallback : raw;
  const n = parseFloat(String(raw ?? ""));
  return isNaN(n) ? fallback : n;
}

async function main() {
  const filePath = path.resolve(
    process.argv[2] ?? "internal/PSSP VB Horizontal dan Vertikal.xlsx"
  );

  const snapshotDate = new Date();

  console.log(`Reading: ${filePath} (sheet ${SHEET_NAME}, snapshot ${snapshotDate.toISOString().slice(0, 10)})\n`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) { console.error(`Sheet "${SHEET_NAME}" not found`); process.exit(1); }

  const headerRow = ws.getRow(1);
  const colIdx = new Map<string, number>();
  for (let c = 1; c <= ws.columnCount; c++) {
    const h = txt(headerRow.getCell(c).value);
    if (h) colIdx.set(h, c);
  }
  const col = (name: string) => colIdx.get(name);

  // Period columns — exact prefix match only (Estimasi_202601, not QtyEst_202601).
  const estCols: { col: number; period: string }[] = [];
  const lunasCols: { col: number; period: string }[] = [];
  for (const [name, c] of colIdx) {
    const estM = name.match(/^Estimasi_(\d{6})$/);
    if (estM) estCols.push({ col: c, period: estM[1] });
    const lunM = name.match(/^Pelunasan_(\d{6})$/);
    if (lunM) lunasCols.push({ col: c, period: lunM[1] });
  }
  console.log(`Period columns — Estimasi: ${estCols.length}, Pelunasan: ${lunasCols.length}\n`);

  type Row = [
    string, string | null, string, string | null, string | null, string | null, number | null, string | null,
    number, string, string, string | null, string | null, string | null, string | null,
    string | null, string, string | null,
    number, number, number,
    string, string,
    Date,
  ];

  // Keyed by cUrut|kdProduk — de-dupes rows sharing the unique constraint so a
  // single multi-row INSERT never targets the same conflict target twice
  // ("last row in the sheet wins", same as a sequential upsert).
  const rowsByKey = new Map<string, Row>();
  let skipped = 0;
  let sourceRowCount = 0;

  for (let rn = 2; rn <= ws.rowCount; rn++) {
    const row = ws.getRow(rn);
    const get = (name: string) => (col(name) ? row.getCell(col(name)!).value : undefined);

    const cUrut = txt(get("C_URUT"));
    const kdCust = txt(get("KD_CUST"));
    if (!cUrut || !kdCust) { skipped++; continue; }
    sourceRowCount++;

    const periodMap = (cols: { col: number; period: string }[]) => {
      const m: Record<string, number> = {};
      for (const { col: c, period } of cols) m[period] = flt(row.getCell(c).value, 0);
      return m;
    };
    const estMap = periodMap(estCols);
    const lunMap = periodMap(lunasCols);
    const estBaris = Object.values(estMap).reduce((a, b) => a + b, 0);
    const totalLunas = Object.values(lunMap).reduce((a, b) => a + b, 0);

    const nDivisiRaw = get("N_DIVISI");
    const nDivisi = nDivisiRaw != null && txt(nDivisiRaw) != null ? Math.trunc(flt(nDivisiRaw)) : null;

    const kdProduk = txt(get("KD_PRODUK")) ?? "";
    rowsByKey.set(`${cUrut}|${kdProduk}`, [
      kdCust, txt(get("NM_CUST")), cUrut, txt(get("KD_SPC")), txt(get("NM_SPC")), txt(get("GOL")), nDivisi, txt(get("DIV_KODE")),
      flt(get("Biaya")), txt(get("PRD_AWAL")) ?? "", txt(get("PRD_AKHIR")) ?? "", txt(get("NIP_USUL")), txt(get("NM_USUL")),
      txt(get("KD_OUTLET")), txt(get("NM_OUTLET")),
      txt(get("DIV_PROD")), kdProduk, txt(get("NM_PRODUK")),
      estBaris, estBaris, totalLunas, // estBaris + totalEst both = sum of Estimasi_YYYYMM (no separate baris total column in this source)
      JSON.stringify(estMap), JSON.stringify(lunMap),
      snapshotDate,
    ]);
  }

  const rows = [...rowsByKey.values()];
  const dupeCount = sourceRowCount - rows.length;
  console.log(`Rows to upsert: ${rows.length} (skipped ${skipped} with missing C_URUT/KD_CUST, ${dupeCount} duplicate cUrut+kdProduk rows collapsed to last value)\n`);

  const BATCH = 500;
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const valueTuples = batch.map((r) => Prisma.sql`(
      gen_random_uuid(), ${r[0]}, ${r[1]}, ${r[2]}, ${r[3]}, ${r[4]}, ${r[5]}, ${r[6]}, ${r[7]},
      ${r[8]}, ${r[9]}, ${r[10]}, ${r[11]}, ${r[12]}, ${r[13]}, ${r[14]},
      ${r[15]}, ${r[16]}, ${r[17]},
      ${r[18]}, NULL, ${r[19]}, NULL, ${r[20]},
      ${r[21]}::jsonb, '{}'::jsonb, ${r[22]}::jsonb,
      ${r[23]}, NOW()
    )`);

    await prisma.$executeRaw`
      INSERT INTO "PsspKontrak" (
        id, "kdCust", "nmCust", "cUrut", "kdSpc", "nmSpc", role, "nDivisi", "divKode",
        biaya, "prdAwal", "prdAkhir", "nipUsul", "nmUsul", "kdOutlet", "nmOutlet",
        "divProd", "kdProduk", "nmProduk",
        "estBaris", "bmBaris", "totalEst", "totalBm", "totalLunas",
        "estByPeriod", "bmByPeriod", "lunasByPeriod",
        "snapshotDate", "importedAt"
      ) VALUES ${Prisma.join(valueTuples)}
      ON CONFLICT ("cUrut", "kdProduk") DO UPDATE SET
        "kdCust" = EXCLUDED."kdCust", "nmCust" = EXCLUDED."nmCust",
        "kdSpc" = EXCLUDED."kdSpc", "nmSpc" = EXCLUDED."nmSpc", role = EXCLUDED.role,
        "nDivisi" = EXCLUDED."nDivisi", "divKode" = EXCLUDED."divKode", biaya = EXCLUDED.biaya,
        "prdAwal" = EXCLUDED."prdAwal", "prdAkhir" = EXCLUDED."prdAkhir",
        "nipUsul" = EXCLUDED."nipUsul", "nmUsul" = EXCLUDED."nmUsul",
        "kdOutlet" = EXCLUDED."kdOutlet", "nmOutlet" = EXCLUDED."nmOutlet",
        "divProd" = EXCLUDED."divProd", "nmProduk" = EXCLUDED."nmProduk",
        "estBaris" = EXCLUDED."estBaris", "bmBaris" = EXCLUDED."bmBaris",
        "totalEst" = EXCLUDED."totalEst", "totalBm" = EXCLUDED."totalBm", "totalLunas" = EXCLUDED."totalLunas",
        "estByPeriod" = EXCLUDED."estByPeriod", "bmByPeriod" = EXCLUDED."bmByPeriod", "lunasByPeriod" = EXCLUDED."lunasByPeriod",
        "snapshotDate" = EXCLUDED."snapshotDate", "importedAt" = NOW()
    `;

    done += batch.length;
    console.log(`  ${done}/${rows.length} rows...`);
  }

  console.log(`\n✅ Upserted ${rows.length} rows into PsspKontrak.`);

  // ── Full-replace: retire contracts no longer present in this snapshot ──────
  console.log("\nChecking for stale contracts to retire...");
  const newKeys = new Set(rows.map((r) => `${r[2]}|${r[16]}`)); // cUrut|kdProduk
  const existing = await prisma.psspKontrak.findMany({ select: { id: true, cUrut: true, kdProduk: true } });
  const staleIds = existing
    .filter((e: { id: string; cUrut: string; kdProduk: string | null }) => !newKeys.has(`${e.cUrut}|${e.kdProduk ?? ""}`))
    .map((e: { id: string }) => e.id);

  if (staleIds.length > 0) {
    console.log(`  Deleting ${staleIds.length} stale rows (contract+product no longer in this snapshot)...`);
    for (let i = 0; i < staleIds.length; i += BATCH) {
      const chunk = staleIds.slice(i, i + BATCH);
      await prisma.psspKontrak.deleteMany({ where: { id: { in: chunk } } });
      console.log(`    ${Math.min(i + BATCH, staleIds.length)}/${staleIds.length}`);
    }
  } else {
    console.log("  None — nothing to retire.");
  }

  console.log(`\n✅ Done. ${rows.length} rows current, ${staleIds.length} stale rows retired.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
