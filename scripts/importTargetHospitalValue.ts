/**
 * Import target PENGAJUAN values into TargetHospitalValue — one row per
 * (namaGT, periode) monthly Rupiah sales target for 202608-202612.
 *
 * Switched 2026-08-24 from REKOMENDASI HO (top-down formula, "Rekap FFMedrep"
 * sheet) to PENGAJUAN (bottom-up, sales-submitted): business owner confirmed
 * Rekomendasi is only a starting point, Pengajuan is what sales actually
 * commits to — and "Rekap FFMedrep" data itself is unreliable for VALUES
 * (its identity/mapping columns are still fine, see below).
 *
 * Source: "internal/Target Hospital (in Value) (1).xlsx", two kinds of sheet:
 *
 *  - "Rekap FFMedrep": IDENTITY LOOKUP ONLY, not a value source. One row per
 *    GT — col A Nama GT, col C Nama Area, col F effective MR/SPV name. Used
 *    to build a (Nama Area, MR/SPV name) -> Nama GT map, since the per-NSM
 *    sheets below never spell out "Nama GT" directly. Verified 2026-08-24:
 *    260/260 Pengajuan-bearing rows from the NSM sheets matched this map with
 *    zero conflicts — reliable for identity even though its own REKOMENDASI
 *    target columns are not (per business owner, not used here).
 *
 *  - 12 per-NSM sheets — NSM_SHEETS below ("Sheet7"/"HIDING" are scratch, not
 *    data). Each is a repeating block per Area: a header row (col A = area
 *    name, cols B/C blank), a column-header row ("MR / SPV" | "NAMA ASM" |
 *    "NAMA SM" | ...), one data row per MR/SPV (col A = name, col D =
 *    numeric "SALES ACTUAL S1 2026" — used to detect data rows), then a
 *    "TOTAL" row and a few summary rows before the next Area block. NSM name
 *    is the sheet name itself, not a column. Target columns used:
 *      Q  TARGET 202608 (PENGAJUAN)
 *      R  TARGET 202609 (PENGAJUAN)
 *      S  TARGET 202610 (PENGAJUAN)
 *      T  TARGET 202611 (PENGAJUAN)
 *      U  TARGET 202612 (PENGAJUAN)
 *    A blank/non-numeric cell means that periode hasn't been submitted yet —
 *    skipped for that GT, NOT filled from Rekomendasi (2026-08-24: "pengajuan
 *    apa adanya, approved atau belum" — no fallback, no approval-status
 *    filter). A GT/periode already in the table from a prior import that has
 *    no Pengajuan value here is left untouched, not zeroed out.
 *
 * nip resolution: same as before — MR/SPV, ASM, SM, NSM names matched
 * case-insensitive/trimmed against non-dummy Users of the expected role;
 * VACANT/DUMMY placeholders and "A - B (SHADOW)" pairs legitimately don't
 * resolve — nip stays null, raw name is always kept regardless. When a name
 * DOES resolve, the stored nama* is the User's own canonical `name`, not the
 * raw source text — keeps casing consistent with other rows/sources for the
 * same person (e.g. this workbook's sheet tabs are "Fachriyanto", the User
 * table has "FACHRIYANTO" — storing the raw tab text split one NSM's rows
 * into two groups everywhere the app displays/groups by name).
 *
 * Effects: upserts TargetHospitalValue on (namaGT, periode) — same table,
 * same unique key as the original Rekomendasi-era import, this only changes
 * which source column feeds `target`.
 *
 * Run: npx tsx scripts/importTargetHospitalValue.ts [path-to-excel]
 * Default: "internal/Target Hospital (in Value) (1).xlsx"
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { randomUUID } from "crypto";
import { prisma } from "../src/lib/prisma";

const BATCH = 300;
const NSM_SHEETS = [
  "Alfred P", "Eka N", "Fachriyanto", "Umi", "Hermanto", "Darma",
  "Agus", "Stefanus", "Parasian", "Sakti", "Dody", "Angga",
];
const PENGAJUAN_COLUMNS: { col: number; periode: string }[] = [
  { col: 17, periode: "202608" }, // Q
  { col: 18, periode: "202609" }, // R
  { col: 19, periode: "202610" }, // S
  { col: 20, periode: "202611" }, // T
  { col: 21, periode: "202612" }, // U
];

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function sqlNullableStr(s: string | null): string {
  return s == null ? "NULL" : `'${esc(s)}'`;
}

interface SourceRow {
  namaGT: string;
  namaMR: string;
  namaASM: string;
  namaSM: string;
  namaNSM: string;
  targets: Record<string, number>; // periode -> target, only for submitted months
}

async function main() {
  const filePath = path.resolve(process.argv[2] ?? "internal/Target Hospital (in Value) (1).xlsx");
  console.log(`Reading: ${filePath}\n`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  // GT names confirmed 2026-09-03 by the business target team as the SAME
  // territory as its live Outlet.namaGT counterpart, despite spelling far
  // enough apart that normalizeGTName (targetHospitalValue.ts) can't safely
  // bridge them automatically (composition differs, e.g. "CIKOKOL +SUKAJADI"
  // vs live "CIKOKOL + BANJAR", or a letter/suffix differs outright, e.g.
  // "KALIDERAS" vs live "KALIDERES") — rewritten to the live spelling here so
  // every future import lands under the name /api/target-value's live-GT
  // lookup actually resolves against, instead of needing this reconciled by
  // hand again next cycle. Keyed by the RAW source text (Rekap FFMedrep col
  // A), trim+uppercase.
  const GT_NAME_ALIASES: Record<string, string> = {
    "BANDUNG BARAT1": "BANDUNG BARAT",
    "BANJAR+MAJENANG": "BANJAR",
    "CIKARANG KOTA + SUKATANI": "CIKARANG KOTA + SUKANI",
    "CIKOKOL +SUKAJADI": "CIKOKOL + BANJAR",
    "DASANA": "DASANA + TELUKNAGA",
    "KAB. BOGOR A": "KAB. BOGOR",
    "KALIDERAS": "KALIDERES",
    "MALANG C": "MALANG KOTA",
    "MALANG A": "MALANG SELATAN",
    "MALANG B": "MALANG UTARA",
    "PAMULANG +PD BENDA": "PAMULANG + PD CABE",
    "PANGANDARAN+SIDEREJA": "PANGANDARAN",
    "PASURUAN A": "PASURUAN",
    "KOTA SERANG": "SERANG + PANDEGLANG",
  };

  // ── Identity lookup: (Nama Area, MR/SPV name) -> Nama GT, from Rekap FFMedrep ──
  const rekap = wb.getWorksheet("Rekap FFMedrep");
  if (!rekap) { console.error('Sheet "Rekap FFMedrep" not found'); process.exit(1); }
  const gtByAreaAndMr = new Map<string, string>();
  for (let r = 2; r <= rekap.rowCount; r++) {
    const row = rekap.getRow(r);
    const rawNamaGT = String(row.getCell(1).value ?? "").trim();
    const namaArea = String(row.getCell(3).value ?? "").trim();
    const mrspv = String(row.getCell(6).value ?? "").trim();
    if (!rawNamaGT) continue;
    const namaGT = GT_NAME_ALIASES[rawNamaGT.toUpperCase()] ?? rawNamaGT;
    gtByAreaAndMr.set(`${namaArea.toUpperCase()}|${mrspv.toUpperCase()}`, namaGT);
  }

  // ── Per-NSM sheets: walk repeating Area blocks, collect Pengajuan rows ──
  const rows: SourceRow[] = [];
  let unmatchedGT = 0;

  for (const sheetName of NSM_SHEETS) {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) { console.error(`Sheet "${sheetName}" not found — skipped`); continue; }

    let curArea: string | null = null;
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const a = row.getCell(1).value;
      const b = row.getCell(2).value;
      const c = row.getCell(3).value;

      if (a != null && a !== "" && (b == null || b === "") && (c == null || c === "")) {
        curArea = String(a).trim().toUpperCase();
        continue;
      }
      if (a == null || a === "" || a === "MR / SPV" || a === "TOTAL") continue;
      // (2026-09-03: dropped the old "col D SUMIFS result must be cached"
      // check here — ExcelJS doesn't always carry a cached `result` for that
      // formula (silently skipped 2 real rows with real Pengajuan values,
      // e.g. Fachriyanto/ARDHY SATRIA PRATAMA/GARUT). Redundant anyway: col A
      // already excludes header/TOTAL rows, and "at least one Pengajuan
      // value" below already excludes trailing blank/summary rows.)

      const namaMR = String(a).trim();
      const namaASM = String(b ?? "").trim();
      const namaSM = String(c ?? "").trim();

      const namaGT = gtByAreaAndMr.get(`${curArea ?? ""}|${namaMR.toUpperCase()}`);
      if (!namaGT) { unmatchedGT++; continue; }

      const targets: Record<string, number> = {};
      for (const { col, periode } of PENGAJUAN_COLUMNS) {
        const v = row.getCell(col).value;
        if (typeof v === "number") targets[periode] = v;
      }
      if (Object.keys(targets).length === 0) continue; // nothing submitted yet

      rows.push({ namaGT, namaMR, namaASM, namaSM, namaNSM: sheetName, targets });
    }
  }

  console.log(`Parsed ${rows.length} GT rows with at least one Pengajuan value (${unmatchedGT} rows skipped — no Nama GT match).\n`);

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

  const nipToName = new Map(users.map((u) => [u.nip, u.name]));

  // Source spelling variants confirmed 2026-09-02 (business owner) that don't
  // normalize to the User table's canonical name via plain trim/uppercase —
  // "DONNY  SIHOMBING" drops the middle name entirely, "MUH GUSTI BAGUS A.B"
  // drops the periods. Keyed by trim+uppercase of the RAW source text.
  const SOURCE_NAME_ALIASES: Record<string, string> = {
    "DONNY  SIHOMBING": "DONNY C. SIHOMBING",
    "MUH GUSTI BAGUS A.B": "MUH. GUSTI BAGUS A.B.",
  };

  let collisions = 0;
  function resolveNip(index: Map<string, string[]>, name: string): string | null {
    if (!name) return null;
    const key = SOURCE_NAME_ALIASES[name.trim().toUpperCase()] ?? name;
    const candidates = index.get(key.toUpperCase());
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length > 1) collisions++;
    return [...candidates].sort()[0];
  }
  // Once a name resolves to a nip, store the User's own canonical `name`
  // instead of the raw source text — otherwise casing differences between
  // sources (e.g. this sheet's tab title "Fachriyanto" vs the User table's
  // "FACHRIYANTO") silently split what should be one person into two rows
  // wherever the app groups/displays by namaMR/ASM/SM/NSM (found 2026-08-24:
  // "TOTAL PER NSM" showing "Fachriyanto" and "FACHRIYANTO" separately).
  // Unresolved (VACANT/DUMMY/SHADOW placeholders) keep the raw text, same as
  // before — nothing canonical to fall back to.
  function resolveNipAndName(index: Map<string, string[]>, name: string): { nip: string | null; name: string } {
    const nip = resolveNip(index, name);
    return { nip, name: nip ? (nipToName.get(nip) ?? name) : name };
  }

  const flat: { namaGT: string; periode: string; target: number; nipMR: string | null; namaMR: string; nipASM: string | null; namaASM: string; nipSM: string | null; namaSM: string; nipNSM: string | null; namaNSM: string }[] = [];
  for (const r of rows) {
    const mr = resolveNipAndName(mrIndex, r.namaMR);
    const asm = resolveNipAndName(asmIndex, r.namaASM);
    const sm = resolveNipAndName(smIndex, r.namaSM);
    const nsm = resolveNipAndName(nsmIndex, r.namaNSM);
    for (const [periode, target] of Object.entries(r.targets)) {
      flat.push({
        namaGT: r.namaGT, periode, target,
        nipMR: mr.nip, namaMR: mr.name, nipASM: asm.nip, namaASM: asm.name,
        nipSM: sm.nip, namaSM: sm.name, nipNSM: nsm.nip, namaNSM: nsm.name,
      });
    }
  }

  console.log(`Upserting ${flat.length} TargetHospitalValue rows...`);

  const now = new Date();
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
