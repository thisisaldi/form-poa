/**
 * One-time backfill: TargetHospitalValue for periode "202607" (Juli 2026) —
 * the month before KAM and Hospinet divisions merged into one FF structure
 * (confirmed by business owner 2026-08-24: "juli hospital masih KAM dan
 * hospinet dipisah, disatukan sejak agustus"). Neither July source has a
 * per-GT breakdown (both are per-person incentive-calc reports, not
 * per-territory like "Target Hospital (in Value).xlsx"), so this creates ONE
 * TargetHospitalValue row per MR-level nip instead of skipping the month
 * entirely — Q3 rollups (Jul+Aug+Sep) would otherwise silently miss July.
 * namaGT: reuses the GT that nip CURRENTLY holds live (Outlet +
 * MrOutletAssignment, via getCurrentGTsForMrNips) when exactly one exists —
 * 2026-09-14 rewrite: originally cross-referenced that nip's stored August
 * TargetHospitalValue.nipMR row instead of live data, but nipMR was dropped
 * from the table entirely that same day (see schema doc comment, "udah
 * gaada personil ... cuma ada target by gt") — live current-holder is the
 * only source left, and is actually MORE correct for a historical backfill
 * anyway (doesn't depend on whatever GT that nip happened to hold back when
 * August was last imported). Falls back to a synthetic
 * "[JULI-NO-GT] <nama> (<nip>)" placeholder when 0 or >1 GT resolves (mostly
 * Hospinet, which isn't part of the GT-level source at all).
 *
 * Sources:
 *  - "internal/2. RATIO INSENTIF JULI 26 UNTUK PAK BRIAN.xlsx", sheet
 *    "JULI TO BU EVELIN" — KAM division. Col B NIP, C Nama, D Jabatan
 *    (MR/SPV/ASM/SM/NSM/DIR), E Target Sales. Jabatan MR or SPV is the
 *    leaf/territory-holding level (SPV IS MR for this purpose, same
 *    convention scripts/importStrukturVerifiedKAM.ts documents) — ASM/SM/
 *    NSM/DIR rows are managers' own aggregate targets, not per-territory,
 *    skipped here.
 *  - "internal/INSENTIF HOSPINET KE BU EVELYN.xlsx", sheet "TARGET" (added
 *    to the workbook after this script's first version, which had parsed
 *    "DETAIL INSENTIF"'s six stacked per-level blocks instead — corrected
 *    2026-08-24 per business owner: "yang dari INSENTIF HOSPINET... ambil
 *    yang di sheet TARGET"). Flat table: col A NIP, B Nama, C Target, D
 *    Jabatan (MR/SPV/ASM/SM/NSM). Jabatan MR or SPV is the leaf/territory-
 *    holding level, same convention as KAM below — ASM/SM/NSM rows are
 *    managers' own aggregates, skipped.
 *
 * nip is given DIRECTLY by both sources (not name-matched, unlike the
 * recurring GT import) — confirmed zero NIP overlap between the two files
 * (disjoint divisions, matches the business owner's statement). A nip that
 * doesn't resolve to a live User falls back to the placeholder namaGT (no
 * live GT to resolve without a real User) — the raw source name isn't kept
 * anywhere anymore since this table has no personnel columns (2026-09-14).
 *
 * Effects: upserts TargetHospitalValue on (namaGT, periode="202607") only —
 * does not touch any other periode's rows.
 *
 * Run: npx tsx scripts/importTargetHospitalValueJuli.ts
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { randomUUID } from "crypto";
import { prisma } from "../src/lib/prisma";
import { getCurrentGTsForMrNips } from "../src/lib/targetHospitalValue";

const PERIODE = "202607";

interface SourceRow {
  nip: string;
  nama: string;
  target: number;
}

function readKam(wb: ExcelJS.Workbook): SourceRow[] {
  const ws = wb.getWorksheet("JULI TO BU EVELIN");
  if (!ws) { console.error('KAM: sheet "JULI TO BU EVELIN" not found'); process.exit(1); }
  const rows: SourceRow[] = [];
  for (let r = 4; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const jabatan = String(row.getCell(4).value ?? "").trim();
    if (jabatan !== "MR" && jabatan !== "SPV") continue;
    const nip = String(row.getCell(2).value ?? "").trim();
    const nama = String(row.getCell(3).value ?? "").trim();
    const target = row.getCell(5).value;
    if (!nip || typeof target !== "number") continue;
    rows.push({ nip, nama, target });
  }
  return rows;
}

function readHospinet(wb: ExcelJS.Workbook): SourceRow[] {
  const ws = wb.getWorksheet("TARGET");
  if (!ws) { console.error('Hospinet: sheet "TARGET" not found'); process.exit(1); }
  const rows: SourceRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const jabatan = String(row.getCell(4).value ?? "").trim();
    if (jabatan !== "MR" && jabatan !== "SPV") continue;
    const nip = String(row.getCell(1).value ?? "").trim();
    const nama = String(row.getCell(2).value ?? "").trim();
    const target = row.getCell(3).value;
    if (!nip || typeof target !== "number") continue;
    rows.push({ nip, nama, target });
  }
  return rows;
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}
function sqlNullableStr(s: string | null): string {
  return s == null ? "NULL" : `'${esc(s)}'`;
}

async function main() {
  const kamPath = path.resolve("internal/2. RATIO INSENTIF JULI 26 UNTUK PAK BRIAN.xlsx");
  const hospPath = path.resolve("internal/INSENTIF HOSPINET KE BU EVELYN.xlsx");
  console.log(`Reading: ${kamPath}\nReading: ${hospPath}\n`);

  const kamWb = new ExcelJS.Workbook();
  await kamWb.xlsx.readFile(kamPath);
  const hospWb = new ExcelJS.Workbook();
  await hospWb.xlsx.readFile(hospPath);

  const kamRows = readKam(kamWb);
  const hospRows = readHospinet(hospWb);
  console.log(`KAM (MR/SPV): ${kamRows.length} rows. Hospinet (PSR+SPV): ${hospRows.length} rows.`);

  const overlap = kamRows.filter((k) => hospRows.some((h) => h.nip === k.nip));
  if (overlap.length > 0) {
    console.error(`❌ ${overlap.length} nip(s) appear in BOTH sources (expected disjoint divisions) — aborting: ${overlap.map((r) => r.nip).join(", ")}`);
    process.exit(1);
  }
  const allRows = [...kamRows, ...hospRows];

  // Clean up any synthetic placeholder rows from a prior run of this script
  // before re-inserting under a (possibly different, see below) namaGT — the
  // insert below upserts on (namaGT, periode), so a namaGT change would
  // otherwise leave the old placeholder row behind as an orphaned duplicate.
  await prisma.targetHospitalValue.deleteMany({ where: { periode: PERIODE, namaGT: { startsWith: "[JULI-NO-GT]" } } });

  // ── nip -> User map (single bulk fetch) ──
  const users = await prisma.user.findMany({ where: { isDummy: false }, select: { nip: true, name: true } });
  const userByNip = new Map(users.map((u) => [u.nip, u]));

  const now = new Date();
  // Keyed by namaGT (this periode is fixed) — 2 different source nips COULD
  // resolve to the same live GT, which would otherwise hit the same
  // "ON CONFLICT cannot affect row a second time" failure this table's other
  // import scripts already hit and fixed (2026-09-11/14) — sum defensively.
  const byNamaGT = new Map<string, number>();
  let placeholderCount = 0;
  for (const r of allRows) {
    const u = userByNip.get(r.nip);
    const namaMR = u?.name ?? r.nama;
    const liveGts = u ? await getCurrentGTsForMrNips([u.nip]) : [];
    const namaGT = liveGts.length === 1 ? liveGts[0] : `[JULI-NO-GT] ${namaMR} (${r.nip})`;
    if (liveGts.length !== 1) placeholderCount++;
    byNamaGT.set(namaGT, (byNamaGT.get(namaGT) ?? 0) + r.target);
  }

  const values = [...byNamaGT.entries()].map(([namaGT, target]) => `(
      '${randomUUID()}',
      '${esc(namaGT)}',
      '${PERIODE}',
      ${target},
      '${now.toISOString()}',
      '${now.toISOString()}'
    )`);

  console.log(`Upserting ${values.length} TargetHospitalValue rows for periode ${PERIODE}...`);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "TargetHospitalValue" (
      "id", "namaGT", "periode", "target", "syncedAt", "updatedAt"
    )
    VALUES ${values.join(",\n")}
    ON CONFLICT ("namaGT", "periode") DO UPDATE SET
      "target" = EXCLUDED."target",
      "syncedAt" = EXCLUDED."syncedAt",
      "updatedAt" = EXCLUDED."updatedAt"
  `);

  console.log(`\n✅ TargetHospitalValue upserted: ${values.length} rows for periode ${PERIODE}.`);
  console.log(`   (${placeholderCount} row(s) fell back to the "[JULI-NO-GT] ..." placeholder — 0 or >1 live GT resolved.)\n`);

  console.log("✅ Import complete.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
