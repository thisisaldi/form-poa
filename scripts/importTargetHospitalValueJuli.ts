/**
 * One-time backfill: TargetHospitalValue for periode "202607" (Juli 2026) —
 * the month before KAM and Hospinet divisions merged into one FF structure
 * (confirmed by business owner 2026-08-24: "juli hospital masih KAM dan
 * hospinet dipisah, disatukan sejak agustus"). Neither July source has a
 * per-GT breakdown (both are per-person incentive-calc reports, not
 * per-territory like "Target Hospital (in Value).xlsx"), so this creates ONE
 * TargetHospitalValue row per MR-level nip instead of skipping the month
 * entirely — Q3 rollups (Jul+Aug+Sep) would otherwise silently miss July.
 * namaGT: reuses the SAME namaGT as that nip's real August row when exactly
 * one exists (185 of 239, verified 2026-08-24 — so July lands in the same
 * row as Aug-Dec in the admin table, not a separate one), else falls back to
 * a synthetic "[JULI-NO-GT] <nama> (<nip>)" placeholder (mostly Hospinet,
 * which isn't part of the GT-level source at all).
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
 * (disjoint divisions, matches the business owner's statement). ASM/SM/NSM
 * attribution is derived by walking User.nipAtasan up from each resolved
 * nip, in memory (one-time script over ~280 rows, so the per-node walk
 * docs/PERFORMANCE.md §2 point 2 warns against for real app routes is fine
 * here — same exemption as sync job batches). A nip that doesn't resolve to
 * a live User keeps the source's raw name (nipMR null), same tolerant
 * pattern as the recurring import script.
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

  // A July nip that already owns exactly one real GT in the August (Pengajuan)
  // import reuses THAT namaGT — 2026-08-24 fix, found 2026-08-24: the first
  // version of this script always used a synthetic per-person namaGT, so July
  // never showed up in the same row as that MR's real Aug-Dec GT data (185 of
  // 239 nips DO have exactly one matching Aug GT — verified zero ambiguous
  // multi-GT cases). Only nips with no Aug GT match (mostly Hospinet, which
  // isn't part of the GT-level source at all) fall back to the placeholder.
  const augRows = await prisma.targetHospitalValue.findMany({ where: { periode: "202608", nipMR: { not: null } }, select: { nipMR: true, namaGT: true } });
  const augGtByNip = new Map<string, string[]>();
  for (const r of augRows) {
    if (!r.nipMR) continue;
    augGtByNip.set(r.nipMR, [...(augGtByNip.get(r.nipMR) ?? []), r.namaGT]);
  }

  // ── nip -> User map (single bulk fetch, in-memory hierarchy walk below) ──
  const users = await prisma.user.findMany({ where: { isDummy: false }, select: { nip: true, name: true, role: true, nipAtasan: true } });
  const userByNip = new Map(users.map((u) => [u.nip, u]));

  function walkUp(nip: string): { nipASM: string | null; namaASM: string; nipSM: string | null; namaSM: string; nipNSM: string | null; namaNSM: string } {
    let asm: typeof users[number] | null = null, sm: typeof users[number] | null = null, nsm: typeof users[number] | null = null;
    const seen = new Set([nip]);
    let cursor = userByNip.get(nip)?.nipAtasan ?? null;
    for (let depth = 0; depth < 10 && cursor && !seen.has(cursor); depth++) {
      seen.add(cursor);
      const u = userByNip.get(cursor);
      if (!u) break;
      if (u.role === "ASM" && !asm) asm = u;
      if (u.role === "SM" && !sm) sm = u;
      if (u.role === "NSM" && !nsm) nsm = u;
      cursor = u.nipAtasan;
    }
    return {
      nipASM: asm?.nip ?? null, namaASM: asm?.name ?? "",
      nipSM: sm?.nip ?? null, namaSM: sm?.name ?? "",
      nipNSM: nsm?.nip ?? null, namaNSM: nsm?.name ?? "",
    };
  }

  const now = new Date();
  const values = allRows.map((r) => {
    const u = userByNip.get(r.nip);
    const nipMR = u?.nip ?? null;
    const namaMR = u?.name ?? r.nama;
    const hier = nipMR ? walkUp(nipMR) : { nipASM: null, namaASM: "", nipSM: null, namaSM: "", nipNSM: null, namaNSM: "" };
    const augGts = nipMR ? augGtByNip.get(nipMR) : undefined;
    const namaGT = augGts && augGts.length === 1 ? augGts[0] : `[JULI-NO-GT] ${namaMR} (${r.nip})`;
    return `(
      '${randomUUID()}',
      '${esc(namaGT)}',
      '${PERIODE}',
      ${r.target},
      ${sqlNullableStr(nipMR)},
      '${esc(namaMR)}',
      ${sqlNullableStr(hier.nipASM)},
      '${esc(hier.namaASM)}',
      ${sqlNullableStr(hier.nipSM)},
      '${esc(hier.namaSM)}',
      ${sqlNullableStr(hier.nipNSM)},
      '${esc(hier.namaNSM)}',
      '${now.toISOString()}',
      '${now.toISOString()}'
    )`;
  });

  console.log(`Upserting ${values.length} TargetHospitalValue rows for periode ${PERIODE}...`);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "TargetHospitalValue" (
      "id", "namaGT", "periode", "target", "nipMR", "namaMR", "nipASM", "namaASM",
      "nipSM", "namaSM", "nipNSM", "namaNSM", "syncedAt", "updatedAt"
    )
    VALUES ${values.join(",\n")}
    ON CONFLICT ("namaGT", "periode") DO UPDATE SET
      "target" = EXCLUDED."target",
      "nipMR" = EXCLUDED."nipMR", "namaMR" = EXCLUDED."namaMR",
      "nipASM" = EXCLUDED."nipASM", "namaASM" = EXCLUDED."namaASM",
      "nipSM" = EXCLUDED."nipSM", "namaSM" = EXCLUDED."namaSM",
      "nipNSM" = EXCLUDED."nipNSM", "namaNSM" = EXCLUDED."namaNSM",
      "syncedAt" = EXCLUDED."syncedAt",
      "updatedAt" = EXCLUDED."updatedAt"
  `);

  const unresolved = allRows.filter((r) => !userByNip.get(r.nip));
  console.log(`\n✅ TargetHospitalValue upserted: ${values.length} rows for periode ${PERIODE}.`);
  console.log(`   (${unresolved.length} nip(s) did not resolve to a live User — kept raw name, nipMR null: ${unresolved.map((r) => r.nip).join(", ") || "-"})\n`);

  console.log("✅ Import complete.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
