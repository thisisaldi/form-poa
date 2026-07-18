/**
 * Import PSSP Pelunasan Excel into PsspKontrak table.
 * TypeScript port of importPsspKontrak.py (kept for reference / non-Node
 * environments) — same sheet, same column mapping, same upsert semantics
 * (ON CONFLICT cUrut+kdProduk DO UPDATE), just without a Python toolchain.
 *
 * Run: npx tsx scripts/importPsspKontrak.ts [path-to-excel]
 * Default: excel/20260630_PSSP Pelunasan_Biaya Murni dan Pelunasan_Value.xlsx
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

const SHEET_NAME = "PSSP";

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
    process.argv[2] ?? "excel/20260630_PSSP Pelunasan_Biaya Murni dan Pelunasan_Value.xlsx"
  );

  const dateMatch = path.basename(filePath).match(/(\d{8})/);
  const snapshotDate = dateMatch
    ? new Date(
        parseInt(dateMatch[1].slice(0, 4)),
        parseInt(dateMatch[1].slice(4, 6)) - 1,
        parseInt(dateMatch[1].slice(6, 8))
      )
    : null;

  console.log(`Reading: ${filePath} (snapshot ${snapshotDate?.toISOString().slice(0, 10)})\n`);

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

  // Period columns — exact prefix match only (Est_202601, not QtyEst_202601 or Kontribusi_202601).
  const estCols: { col: number; period: string }[] = [];
  const bmCols: { col: number; period: string }[] = [];
  const lunasCols: { col: number; period: string }[] = [];
  for (const [name, c] of colIdx) {
    const estM = name.match(/^Est_(\d{6})$/);
    if (estM) estCols.push({ col: c, period: estM[1] });
    const bmM = name.match(/^BM_(\d{6})$/);
    if (bmM) bmCols.push({ col: c, period: bmM[1] });
    const lunM = name.match(/^Lunas_(\d{6})$/);
    if (lunM) lunasCols.push({ col: c, period: lunM[1] });
  }
  console.log(`Period columns — Est: ${estCols.length}, BM: ${bmCols.length}, Lunas: ${lunasCols.length}\n`);

  type Row = [
    string, string | null, string, string | null, string | null, string | null, number | null, string | null,
    number, string, string, string | null, string | null, string | null, string | null,
    string | null, string, string | null,
    number, number, number, number, number,
    string, string, string,
    Date | null,
  ];

  // Keyed by cUrut|kdProduk — de-dupes rows sharing the unique constraint (the source
  // sheet has ~1,100 such duplicates) so a single multi-row INSERT never targets the
  // same conflict target twice ("last row in the sheet wins", same as a sequential upsert).
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
    const bmMap = periodMap(bmCols);
    const lunMap = periodMap(lunasCols);

    const nDivisiRaw = get("N_DIVISI");
    const nDivisi = nDivisiRaw != null && txt(nDivisiRaw) != null ? Math.trunc(flt(nDivisiRaw)) : null;

    const kdProduk = txt(get("KD_PRODUK")) ?? "";
    rowsByKey.set(`${cUrut}|${kdProduk}`, [
      kdCust, txt(get("NM_CUST")), cUrut, txt(get("KD_SPC")), txt(get("NM_SPC")), txt(get("ROLE")), nDivisi, txt(get("DIV_KODE")),
      flt(get("Biaya")), txt(get("PRD_AWAL")) ?? "", txt(get("PRD_AKHIR")) ?? "", txt(get("NIP_USUL")), txt(get("NM_USUL")),
      txt(get("KD_OUTLET")), txt(get("NM_OUTLET")),
      txt(get("DIV_PROD")), kdProduk, txt(get("NM_PRODUK")),
      flt(get("EstBaris")), flt(get("BM_BARIS")),
      Object.values(estMap).reduce((a, b) => a + b, 0),
      Object.values(bmMap).reduce((a, b) => a + b, 0),
      Object.values(lunMap).reduce((a, b) => a + b, 0),
      JSON.stringify(estMap), JSON.stringify(bmMap), JSON.stringify(lunMap),
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
      ${r[18]}, ${r[19]}, ${r[20]}, ${r[21]}, ${r[22]},
      ${r[23]}::jsonb, ${r[24]}::jsonb, ${r[25]}::jsonb,
      ${r[26]}, NOW()
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

  console.log(`\n✅ Done. ${rows.length} rows upserted into PsspKontrak.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
