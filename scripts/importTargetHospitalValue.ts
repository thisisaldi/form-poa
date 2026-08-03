/**
 * Import "internal/Target Hospital (in Value).xlsx", sheet "Rekap FFMedrep",
 * into TargetHospitalValue — one row per (namaGT, periode) monthly Rupiah
 * sales target, for 202608-202612 (2026-07-31 request).
 *
 * Source shape: header row 1, one row per GT (territory) — columns used:
 *   A  Nama GT
 *   D  MR (raw — literal "DUMMY MR ..." when no real MR assigned)
 *   E  SPV (fallback name when D is a dummy placeholder)
 *   F  MR/ SPV (already-resolved effective name — D falling back to E — use
 *      this one, not D/E directly)
 *   G  ASM   H  SM   I  NSM
 *   P  TARGET 202608 (REKOMENDASI HO)
 *   Q  TARGET 202609 (REKOMENDASI HO)
 *   S  TARGET 202610 (REKOMENDASI HO)   [R is a TARGET Q4 aggregate, skipped]
 *   T  TARGET 202611 (REKOMENDASI HO)
 *   U  TARGET 202612 (REKOMENDASI HO)
 *
 * nip resolution: each of MR/SPV, ASM, SM, NSM names is matched by exact
 * (case-insensitive, trimmed) name against User, restricted to isDummy=false
 * AND the expected role for that level (MR/SPV -> role MR, ASM -> ASM, SM ->
 * SM, NSM -> NSM) — the User table has, per real person, a parallel set of
 * isDummy=true "shadow" accounts sharing that person's exact name at every
 * role level (workshop/demo data), so an unfiltered name match would
 * frequently resolve to the wrong nip. Placeholder names ("VACANT ...", "...
 * (SHADOW)", "DUMMY ...") legitimately match nothing — nip stays null, the
 * raw name is kept regardless so the row is still fully attributable. If
 * more than one non-dummy user of the right role shares the exact name
 * (a handful of real same-name collisions exist), the lowest nip is picked
 * deterministically and the collision is reported — resolve manually via the
 * admin edit page if it matters for a specific row.
 *
 * Effects: upserts TargetHospitalValue on (namaGT, periode). Rows with a
 * blank Nama GT are skipped.
 *
 * Run: npx tsx scripts/importTargetHospitalValue.ts [path-to-excel]
 * Default: "internal/Target Hospital (in Value).xlsx"
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { randomUUID } from "crypto";
import { prisma } from "../src/lib/prisma";

const BATCH = 300;
const PERIODE_COLUMNS: { col: number; periode: string }[] = [
  { col: 16, periode: "202608" },
  { col: 17, periode: "202609" },
  { col: 19, periode: "202610" },
  { col: 20, periode: "202611" },
  { col: 21, periode: "202612" },
];

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function sqlNullableStr(s: string | null): string {
  return s == null ? "NULL" : `'${esc(s)}'`;
}

function numCell(v: unknown): number {
  return typeof v === "number" ? v : parseFloat(String(v ?? "")) || 0;
}

interface SourceRow {
  namaGT: string;
  namaMR: string;
  namaASM: string;
  namaSM: string;
  namaNSM: string;
  targets: Record<string, number>; // periode -> target
}

async function main() {
  const filePath = path.resolve(process.argv[2] ?? "internal/Target Hospital (in Value).xlsx");
  console.log(`Reading: ${filePath}\n`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet("Rekap FFMedrep");
  if (!ws) { console.error('Sheet "Rekap FFMedrep" not found'); process.exit(1); }

  const rows: SourceRow[] = [];
  let skippedBlankGT = 0;

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const namaGT = String(row.getCell(1).value ?? "").trim();
    if (!namaGT) { skippedBlankGT++; continue; }

    const namaMR = String(row.getCell(6).value ?? "").trim();
    const namaASM = String(row.getCell(7).value ?? "").trim();
    const namaSM = String(row.getCell(8).value ?? "").trim();
    const namaNSM = String(row.getCell(9).value ?? "").trim();

    const targets: Record<string, number> = {};
    for (const { col, periode } of PERIODE_COLUMNS) {
      targets[periode] = numCell(row.getCell(col).value);
    }

    rows.push({ namaGT, namaMR, namaASM, namaSM, namaNSM, targets });
  }

  console.log(`Parsed ${rows.length} GT rows (skipped ${skippedBlankGT} blank-Nama-GT rows).\n`);

  // ── Name -> nip resolution, restricted to non-dummy users of the expected role ──
  const users = await prisma.user.findMany({ where: { isDummy: false }, select: { nip: true, name: true, role: true } });
  function buildNameIndex(role: string): Map<string, string[]> {
    const idx = new Map<string, string[]>();
    for (const u of users) {
      if (u.role !== role) continue;
      const key = u.name.trim().toUpperCase();
      const list = idx.get(key) ?? [];
      list.push(u.nip);
      idx.set(key, list);
    }
    return idx;
  }
  const mrIndex = buildNameIndex("MR");
  const asmIndex = buildNameIndex("ASM");
  const smIndex = buildNameIndex("SM");
  const nsmIndex = buildNameIndex("NSM");

  let collisions = 0;
  function resolveNip(index: Map<string, string[]>, name: string): string | null {
    if (!name) return null;
    const candidates = index.get(name.toUpperCase());
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length > 1) collisions++;
    return [...candidates].sort()[0];
  }

  console.log(`Upserting ${rows.length} GT × ${PERIODE_COLUMNS.length} months = ${rows.length * PERIODE_COLUMNS.length} TargetHospitalValue rows...`);

  const now = new Date();
  const flat: { namaGT: string; periode: string; target: number; nipMR: string | null; namaMR: string; nipASM: string | null; namaASM: string; nipSM: string | null; namaSM: string; nipNSM: string | null; namaNSM: string }[] = [];
  for (const r of rows) {
    const nipMR = resolveNip(mrIndex, r.namaMR);
    const nipASM = resolveNip(asmIndex, r.namaASM);
    const nipSM = resolveNip(smIndex, r.namaSM);
    const nipNSM = resolveNip(nsmIndex, r.namaNSM);
    for (const { periode } of PERIODE_COLUMNS) {
      flat.push({
        namaGT: r.namaGT, periode, target: r.targets[periode],
        nipMR, namaMR: r.namaMR, nipASM, namaASM: r.namaASM,
        nipSM, namaSM: r.namaSM, nipNSM, namaNSM: r.namaNSM,
      });
    }
  }

  for (let i = 0; i < flat.length; i += BATCH) {
    const chunk = flat.slice(i, i + BATCH);
    const values = chunk.map((r) => `(
      '${randomUUID()}',
      '${esc(r.namaGT)}',
      '${esc(r.periode)}',
      ${r.target},
      ${sqlNullableStr(r.nipMR)},
      '${esc(r.namaMR)}',
      ${sqlNullableStr(r.nipASM)},
      '${esc(r.namaASM)}',
      ${sqlNullableStr(r.nipSM)},
      '${esc(r.namaSM)}',
      ${sqlNullableStr(r.nipNSM)},
      '${esc(r.namaNSM)}',
      '${now.toISOString()}',
      '${now.toISOString()}'
    )`).join(",\n");
    await prisma.$executeRawUnsafe(`
      INSERT INTO "TargetHospitalValue" (
        "id", "namaGT", "periode", "target", "nipMR", "namaMR", "nipASM", "namaASM",
        "nipSM", "namaSM", "nipNSM", "namaNSM", "syncedAt", "updatedAt"
      )
      VALUES ${values}
      ON CONFLICT ("namaGT", "periode") DO UPDATE SET
        "target" = EXCLUDED."target",
        "nipMR" = EXCLUDED."nipMR", "namaMR" = EXCLUDED."namaMR",
        "nipASM" = EXCLUDED."nipASM", "namaASM" = EXCLUDED."namaASM",
        "nipSM" = EXCLUDED."nipSM", "namaSM" = EXCLUDED."namaSM",
        "nipNSM" = EXCLUDED."nipNSM", "namaNSM" = EXCLUDED."namaNSM",
        "syncedAt" = EXCLUDED."syncedAt",
        "updatedAt" = EXCLUDED."updatedAt"
    `);
    process.stdout.write(`  ${Math.min(i + BATCH, flat.length)}/${flat.length}\r`);
  }
  console.log(`\n✅ TargetHospitalValue upserted: ${flat.length} rows.`);
  console.log(`   (${collisions} name collisions hit during resolution — picked lowest nip deterministically, see doc comment.)\n`);

  console.log("✅ Import complete.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
