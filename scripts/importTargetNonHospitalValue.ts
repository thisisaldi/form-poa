/**
 * Import target PENGAJUAN values into TargetNonHospitalValue — one row per
 * (namaGT, periode) monthly Rupiah sales target for the non-hospital
 * (project OMEGA) team. See docs/target-non-hospital-value/ for the spec.
 *
 * Source: "internal/Target Non-Hospital (In Value).xlsx", one sheet per area
 * (AREA_SHEETS below). Each sheet has 2 repeating blocks separated by blank
 * rows: "GT OUTLET NON DORMANT RETAIL" (divisi RETAIL) and "GT OUTLET NON
 * DORMANT PBF DAN GROSIR" (divisi GROSIR_PBF), each with its own "NAMA GT" /
 * "NAMA FF" / "NAMA SM" / ... header row, then one data row per GT, then a
 * "TOTAL" row. Detected by walking col A: a divisi header row switches
 * `curDivisi`, "NAMA GT"/"TOTAL"/blank rows are skipped, everything else
 * while curDivisi is set is a data row (row-position-agnostic, since block
 * length differs per area — same approach as this table's PBF/Retail blocks
 * not having a fixed row range).
 *
 * Target columns used: J = TARGET 202608 (PENGAJUAN), K = TARGET 202609
 * (PENGAJUAN). Blank/non-numeric means not submitted yet for that periode —
 * skipped, not zeroed (same "pengajuan apa adanya" rule as the hospital
 * import).
 *
 * TargetNonHospitalValue has no personnel columns (2026-09-14, "udah gaada
 * personil mr -> nsm lagi cuma ada target by gt") — col B (NAMA FF)/col C
 * (NAMA SM), XLOOKUP formulas into the STRUKTUR sheet, are no longer read at
 * all (they were only ever used to populate the now-dropped nipMR/namaMR/
 * nipSM/namaSM columns; namaGT itself comes straight from col A, unlike
 * hospital which needs the MR name to identify the GT). "Who holds this GT"
 * is resolved LIVE (getCurrentGTsForOmegaMrNips), never from this import.
 *
 * kodeGT: looked up from this SAME workbook's "STRUKTUR" sheet (per-outlet
 * org structure dump, cols "Kode GT"/"Nama GT") by exact Nama GT match —
 * confirmed 2026-09-14 all 347 distinct target-sheet GT names match a
 * STRUKTUR row exactly with zero name/code collisions, so plain exact-match
 * (no normalizeGTName-style fuzzing needed, unlike hospital).
 *
 * Run: npx tsx scripts/importTargetNonHospitalValue.ts [path-to-excel]
 * Default: "internal/Target Non-Hospital (In Value).xlsx"
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { randomUUID } from "crypto";
import { prisma } from "../src/lib/prisma";

const BATCH = 300;

// Order as given by the business team ("cirebon sampai depok"); excludes
// non-area sheets (GUIDELINE, Area, MEMO, "Target by Area (*)", TEMPLATE,
// ActiveRetail, ActiveGrosirPBF, STRUKTUR — confirmed via workbook.eachSheet,
// 2026-09-11).
const AREA_SHEETS = [
  "CIREBON", "BANDUNG", "PALANGKARAYA", "BANJARMASIN", "MANADO", "PALU",
  "SURABAYA", "TANGERANG", "JAKARTA BARAT", "MEDAN", "MAKASSAR", "ACEH",
  "JAKARTA TIMUR", "JEMBER", "SAMARINDA", "BEKASI", "KARAWANG", "DENPASAR",
  "MALANG", "JAKARTA UTARA + JAKARTA PUSAT", "BOGOR", "SIDOARJO",
  "PALEMBANG BARAT", "LAMPUNG", "PALEMBANG TIMUR", "JAMBI", "PONTIANAK",
  "TUBAN", "JAKARTA SELATAN", "PADANG", "PEKANBARU", "BATAM",
  "SEMARANG TIMUR", "SEMARANG BARAT", "PURWOKERTO", "SOLO", "YOGYAKARTA",
  "DEPOK",
];

const PENGAJUAN_COLUMNS: { col: number; periode: string }[] = [
  { col: 10, periode: "202608" }, // J
  { col: 11, periode: "202609" }, // K
];

const DIVISI_HEADERS: Record<string, string> = {
  "GT OUTLET NON DORMANT RETAIL": "RETAIL",
  "GT OUTLET NON DORMANT PBF DAN GROSIR": "GROSIR_PBF",
};

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function sqlNullableStr(s: string | null): string {
  return s == null ? "NULL" : `'${esc(s)}'`;
}

interface SourceRow {
  namaGT: string;
  divisi: string;
  targets: Record<string, number>;
}

async function main() {
  const filePath = path.resolve(process.argv[2] ?? "internal/Target Non-Hospital (In Value).xlsx");
  console.log(`Reading: ${filePath}\n`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  // ── Kode GT lookup: exact Nama GT match against the STRUKTUR sheet ──
  const strukturWs = wb.getWorksheet("STRUKTUR");
  if (!strukturWs) { console.error('Sheet "STRUKTUR" not found'); process.exit(1); }
  const kodeGTByNama = new Map<string, string>();
  for (let r = 2; r <= strukturWs.rowCount; r++) {
    const row = strukturWs.getRow(r);
    const namaGT = String(row.getCell(16).value ?? "").trim(); // col P
    const kodeGT = String(row.getCell(15).value ?? "").trim(); // col O
    if (namaGT && kodeGT) kodeGTByNama.set(namaGT, kodeGT);
  }

  const rows: SourceRow[] = [];

  for (const sheetName of AREA_SHEETS) {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) { console.error(`Sheet "${sheetName}" not found — skipped`); continue; }

    let curDivisi: string | null = null;
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const aRaw = row.getCell(1).value;
      const a = typeof aRaw === "string" ? aRaw.trim() : aRaw == null ? "" : String(aRaw).trim();

      if (a in DIVISI_HEADERS) { curDivisi = DIVISI_HEADERS[a]; continue; }
      if (!curDivisi) continue; // rows before the first divisi header (title/blank rows)
      if (a === "" || a === "NAMA GT" || a === "TOTAL") continue;

      const namaGT = a;

      const targets: Record<string, number> = {};
      for (const { col, periode } of PENGAJUAN_COLUMNS) {
        const v = row.getCell(col).value;
        if (typeof v === "number") targets[periode] = v;
      }
      if (Object.keys(targets).length === 0) continue; // nothing submitted yet

      rows.push({ namaGT, divisi: curDivisi, targets });
    }
  }

  console.log(`Parsed ${rows.length} GT rows with at least one Pengajuan value.\n`);

  let kodeGTMisses = 0;
  const flat: { namaGT: string; kodeGT: string | null; divisi: string; periode: string; target: number }[] = [];
  for (const r of rows) {
    const kodeGT = kodeGTByNama.get(r.namaGT) ?? null;
    if (!kodeGT) kodeGTMisses++;
    for (const [periode, target] of Object.entries(r.targets)) {
      flat.push({ namaGT: r.namaGT, kodeGT, divisi: r.divisi, periode, target });
    }
  }

  console.log(`Upserting ${flat.length} TargetNonHospitalValue rows...`);

  const now = new Date();
  for (let i = 0; i < flat.length; i += BATCH) {
    const chunk = flat.slice(i, i + BATCH);
    const values = chunk.map((r) => `(
      '${randomUUID()}',
      '${esc(r.namaGT)}',
      ${sqlNullableStr(r.kodeGT)},
      '${esc(r.divisi)}',
      '${esc(r.periode)}',
      ${r.target},
      '${now.toISOString()}',
      '${now.toISOString()}'
    )`).join(",\n");
    await prisma.$executeRawUnsafe(`
      INSERT INTO "TargetNonHospitalValue" (
        "id", "namaGT", "kodeGT", "divisi", "periode", "target", "syncedAt", "updatedAt"
      )
      VALUES ${values}
      ON CONFLICT ("namaGT", "divisi", "periode") DO UPDATE SET
        "kodeGT" = EXCLUDED."kodeGT",
        "target" = EXCLUDED."target",
        "syncedAt" = EXCLUDED."syncedAt",
        "updatedAt" = EXCLUDED."updatedAt"
    `);
    process.stdout.write(`  ${Math.min(i + BATCH, flat.length)}/${flat.length}\r`);
  }
  console.log(`\n✅ TargetNonHospitalValue upserted: ${flat.length} rows.`);
  console.log(`   (${kodeGTMisses} GT rows with no STRUKTUR kodeGT match.)\n`);

  console.log("✅ Import complete.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
