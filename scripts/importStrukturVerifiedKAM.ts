/**
 * Import "internal/Struktur Verified Part KAM.xlsx" (sheet "ALL") — a manually
 * verified outlet↔org-structure mapping for the KAM division, superseding the
 * old draft (see importStrukturBaru.ts) which mapped by name only. This file
 * gives NIPs directly for every role level (GM/NSM/SM/ASM/SPV/MR), which
 * sidesteps most of the old name-resolution ambiguity.
 *
 * Known data bugs in the "NIP NSM" column (both confirmed with the business
 * owner, overrides hardcoded below):
 *   - "EKA" (2026-07-20): corrupted — instead of repeating her one real NIP,
 *     it contains a distinct sequential code per row (P260205, P260206, ...).
 *     Her correct NIP is P260205.
 *   - "DODY ALWARDY" (2026-07-21): blank on all 580 rows he appears on — the
 *     column was simply never filled in for him. His correct NIP is P250442.
 *     Without this override, every outlet under him whose SM/ASM/MR are all
 *     placeholder (197 of his 580 rows) has nobody to fall back to at all.
 * All other NSMs have a single consistent NIP across their rows (verified
 * before this script was written) so no further override is needed.
 *
 * Role mapping mirrors the existing MSSQL org sync (src/lib/sync/orgStructureSync.ts),
 * plus GM (added 2026-07-20 so every NIP in the structure can log in):
 *   GM   → GM,    reports to nobody tracked here (top of this file's hierarchy)
 *   NSM  → NSM,  reports to nobody tracked here
 *   SM   → SM,   reports to NSM
 *   ASM  → ASM,  reports to SM
 *   SPV  → MR,   reports to ASM (skip level, same as SPV/FF collapsing in the MSSQL sync)
 *   MR   → MR,   reports to ASM (skip level — this is the file's leaf/outlet-holding rep)
 * Names starting with "DUMMY " or "VACANT " are placeholders for an unfilled
 * position — skipped entirely, not created as Users.
 *
 * SPV IS MR for outlet-ownership purposes (2026-07-21 fix): a row's SPV and MR
 * columns are two names for the same leaf level — only one is filled per row.
 * Every place that resolves "who owns/covers this outlet" (resolveCoverage,
 * MrOutletAssignment) must use `mrNip ?? spvNip`, not `mrNip` alone, or rows
 * where only the SPV column is filled get wrongly treated as vacant-MR.
 *
 * NIP "NEW" (v2 file, 2026-07-21): a real, named person (not a DUMMY/VACANT
 * placeholder) whose NIP hasn't been issued by HR yet. Treated as unresolvable
 * (resolvableNip()), same effect as a blank NIP: no phantom User gets created
 * for it, and hierarchy/coverage/assignment correctly skip past it to the next
 * real level up in the meantime. The raw "NEW" text is still preserved as-is
 * in OutletStrukturBaru (step 1) so the outlet↔name mapping isn't lost — once
 * a real NIP is known, either the source file gets updated or (as happened
 * for "NIRA MAYA" below) it's hardcoded here, then re-running resolves normally.
 *   - "NIRA MAYA" (ASM, 24 rows): NIP "NEW" in the file → confirmed by the
 *     business owner 2026-07-21 as L260457, hardcoded as an override below.
 *
 * "(SHADOW)" pairs (v2 file, 2026-07-21): at SPV/MR level only (64 rows), some
 * outlets are jointly held by two people, both packed into one cell each:
 * name "A - B (SHADOW)", nip "nipA - nipB (SHADOW)". Business owner 2026-07-21:
 * both should actually hold the outlet, not just one — parseShadowPair() splits
 * these into two {name,nip} holders, both get collected as Users, and BOTH get
 * a MrOutletAssignment row for that outlet (Outlet.coveredByNip stays singular,
 * so it uses only the first-listed holder as the representative for the
 * vacant-team-coverage feature, which is a different concern from assignment).
 *
 * Stale NIP on a vacant position (v2 file, 2026-07-21): 1,233 rows have a
 * "DUMMY ..."/"VACANT ..." NAME (a genuinely unfilled position) whose NIP
 * COLUMN was never cleared out to match — e.g. ASM name "DUMMY DORMANT ASM
 * JAWA BARAT" with NIP "L230095" still sitting in the cell (a real NIP,
 * usually still active as someone else's real position elsewhere in the
 * file). resolvableLevelNip() now requires the NAME to be non-placeholder
 * too, not just the NIP non-blank, before a level counts as "filled" for
 * hierarchy-skip or coverage purposes — otherwise a vacant ASM with a stale
 * NIP was wrongly treated as filled, which both silently mis-wired MRs'
 * nipAtasan to a stale/unrelated NIP (breaking "ASM vacant → approval skips
 * straight to SM") and could mis-attribute Outlet.coveredByNip to that same
 * stale NIP.
 *
 * More placeholder spelling variants (v2 file, 2026-07-21, found while fixing
 * the above): 25 NAME variants used "(DUMMY) ..."/"(VACANT) ..." (parens) or
 * ran the word straight into the next word with no space at all, e.g.
 * "DUMMYPEKANBARU BARAT + ROHUL" — isPlaceholder()'s old regex required a
 * word boundary right after DUMMY/VACANT, which none of these have. Separately,
 * some rows' NIP COLUMN has "-" or the exact same descriptive placeholder text
 * as the name column pasted into it (e.g. NIP cell literally reading "DUMMY
 * DORMAN JAKSEL+JATIM UTARA", 1,712 rows) instead of being left blank —
 * without this fix each distinct placeholder-text "NIP" became its own
 * phantom User (already caused a nip="-" User merging several unrelated
 * dormant territories' SM/ASM/MR into one bogus record before this was found
 * and cleaned up). Bare numeric NIPs with no letter prefix (e.g. "973066")
 * are untouched by this — those are real people's actual NIP in this file.
 *
 * This file covers only the KAM division ("Part KAM") — it is NOT a full
 * company roster, so unlike orgStructureSync.ts this script never deactivates
 * users absent from it (that would wrongly affect other divisions).
 *
 * Effects (in order):
 *   1. Refresh OutletStrukturBaru (wholesale replace — staging/review copy).
 *   2. Upsert Users for every resolved non-placeholder NIP + wire nipAtasan/namaAtasan.
 *   3. Upsert Outlet rows: kota, propinsi, kategori, namaGT/namaSub/namaArea/namaReg,
 *      plus coveredByNip/coveredByRole — whoever can actually act on that outlet
 *      right now (its MR, or the first active ASM/SM/NSM above a vacant MR/ASM/SM).
 *      This is what lets a manager create a POA scoped to specific vacant-covered
 *      outlets (see canCreatePoa in authz.ts) without needing their whole team
 *      to be vacant — one covered outlet is enough, regardless of the rest.
 *   4. For each outlet with a resolved MR NIP (leaf level), that NIP becomes the
 *      SOLE assignee for the current periode — replacing any other existing
 *      assignee(s) for that outlet. Outlets with NO resolved MR NIP (genuinely
 *      vacant, or a named MR who isn't a real User yet) have any pre-existing
 *      assignment CLEARED instead — the latest import is authoritative, so a
 *      stale assignment from before is removed rather than left to linger.
 *
 * Run: npx tsx scripts/importStrukturVerifiedKAM.ts [path-to-excel]
 * Default: internal/Struktur Verified Part KAM.xlsx
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";
import type { Role } from "@prisma/client";

const DATA_START = 2;
const EKA_NAME = "EKA";
const EKA_REAL_NIP = "P260205";
const DODY_NAME = "DODY ALWARDY";
const DODY_REAL_NIP = "P250442";
const NIRA_NAME = "NIRA MAYA";
const NIRA_REAL_NIP = "L260457";

const COL = {
  kodePI: 1, namaOutlet: 2, kota: 3, provinsi: 4,
  gmNama: 5, gmNip: 6,
  nsmNama: 7, nsmNip: 8, namaRegion: 9,
  smNama: 10, smNip: 11, cabangSm: 12,
  namaArea: 13,
  asmNama: 14, asmNip: 15, cabangAsm: 16,
  namaSubArea: 17,
  spvNama: 18, spvNip: 19, stationSpv: 20,
  namaGT: 21,
  mrNama: 22, mrNip: 23, stationMr: 24,
  kategoriOutlet: 25,
} as const;

function clean(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

// Matches "DUMMY ...", "VACANT ...", "(DUMMY) ...", "(VACANT) ...", and even
// "DUMMYPEKANBARU..." (no space at all after the word) — deliberately no
// trailing \b, since the file uses all of these interchangeably for the same
// "unfilled position" meaning (2026-07-21: found 25 distinct name variants
// this used to miss because of the stricter word-boundary-only check).
const PLACEHOLDER_RE = /^\(?\s*(DUMMY|VACANT)/i;

function isPlaceholder(name: string | null): boolean {
  return !name || PLACEHOLDER_RE.test(name);
}

// "NEW" marks a real (named) person still awaiting a real NIP from HR — treat
// it as unresolvable, same as blank, everywhere a NIP is used to create a User
// or wire hierarchy/coverage. See file header for the full explanation.
// Also unresolvable: "-" (a placeholder dash instead of a blank cell) and any
// value that's actually descriptive placeholder TEXT copy-pasted into the NIP
// column instead of a real NIP (e.g. nip cell literally reading "DUMMY DORMAN
// JAKSEL+JATIM UTARA", found repeated 1,712 times in the v2 file). Bare numeric
// NIPs without a P/L prefix (e.g. "973066") are real, distinct people's actual
// NIP in this file and must NOT be caught by this — only checked for the same
// DUMMY/VACANT wording as isPlaceholder(), which no legitimate NIP ever has.
function resolvableNip(nip: string | null): string | null {
  if (!nip || nip === "-") return null;
  if (/^new$/i.test(nip)) return null;
  if (PLACEHOLDER_RE.test(nip)) return null;
  return nip;
}

// A level's NIP only counts for hierarchy-skip/coverage purposes when its own
// NAME is real too — a "DUMMY ..."/"VACANT ..." position sometimes still has
// a stale leftover NIP in the column (never cleared when the name was blanked
// out to mark the position vacant), which must NOT be treated as a valid
// manager/coverage NIP just because the NIP cell itself isn't blank. Found
// 1,233 such rows in the v2 file (2026-07-21) — this is what broke "ASM
// vacant → approval/coverage skips straight to SM" (it was picking up the
// stale NIP instead of actually skipping).
function resolvableLevelNip(name: string | null, nip: string | null): string | null {
  return isPlaceholder(name) ? null : resolvableNip(nip);
}

const SHADOW_RE = /^(.+?)\s*-\s*(.+?)\s*\(SHADOW\)\s*$/i;

// "A - B (SHADOW)" name + "nipA - nipB (SHADOW)" nip → two separate holders.
// Returns null when the cell isn't a SHADOW pair (the normal case).
function parseShadowPair(nama: string | null, nip: string | null): { name: string; nip: string }[] | null {
  if (!nama || !nip) return null;
  const nameMatch = nama.match(SHADOW_RE);
  const nipMatch = nip.match(SHADOW_RE);
  if (!nameMatch || !nipMatch) return null;
  return [
    { name: nameMatch[1].trim(), nip: nipMatch[1].trim() },
    { name: nameMatch[2].trim(), nip: nipMatch[2].trim() },
  ];
}

// Everyone who actually holds this MR/SPV-leaf cell — one holder normally,
// two for a SHADOW pair, zero for blank/DUMMY/VACANT/"NEW".
function leafHolders(nama: string | null, nip: string | null): { name: string; nip: string }[] {
  const pair = parseShadowPair(nama, nip);
  if (pair) return pair;
  const resolved = resolvableNip(nip);
  if (!resolved || isPlaceholder(nama)) return [];
  return [{ name: nama!, nip: resolved }];
}

function dominant(values: string[]): string {
  const freq = new Map<string, number>();
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

interface OutletRow {
  kodePI: string; namaOutlet: string | null; kota: string | null; provinsi: string | null;
  namaRegion: string | null; namaArea: string | null; namaSubArea: string | null; namaGT: string | null;
  kategoriOutlet: string | null;
  nsmNama: string | null; nsmNip: string | null;
  smNama: string | null; smNip: string | null;
  asmNama: string | null; asmNip: string | null;
  spvNama: string | null; spvNip: string | null;
  mrNama: string | null; mrNip: string | null;
  gmNama: string | null; gmNip: string | null;
}

async function main() {
  const filePath = path.resolve(process.argv[2] ?? "internal/Struktur Verified Part KAM.xlsx");
  console.log(`Reading: ${filePath}\n`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet("ALL");
  if (!ws) { console.error("Sheet 'ALL' not found"); process.exit(1); }

  const rows: OutletRow[] = [];
  let skippedNoKode = 0;

  for (let r = DATA_START; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const kodePI = clean(row.getCell(COL.kodePI).value);
    if (!kodePI) { skippedNoKode++; continue; }

    const nsmNama = clean(row.getCell(COL.nsmNama).value);
    let nsmNip = clean(row.getCell(COL.nsmNip).value);
    if (nsmNama?.toUpperCase() === EKA_NAME) nsmNip = EKA_REAL_NIP; // data bug override
    if (nsmNama?.toUpperCase() === DODY_NAME) nsmNip = DODY_REAL_NIP; // data bug override

    const asmNama = clean(row.getCell(COL.asmNama).value);
    let asmNip = clean(row.getCell(COL.asmNip).value);
    if (asmNama?.toUpperCase() === NIRA_NAME) asmNip = NIRA_REAL_NIP; // her NIP was "NEW" (not yet issued) — now confirmed by the business owner

    rows.push({
      kodePI,
      namaOutlet: clean(row.getCell(COL.namaOutlet).value),
      kota: clean(row.getCell(COL.kota).value),
      provinsi: clean(row.getCell(COL.provinsi).value),
      namaRegion: clean(row.getCell(COL.namaRegion).value),
      namaArea: clean(row.getCell(COL.namaArea).value),
      namaSubArea: clean(row.getCell(COL.namaSubArea).value),
      namaGT: clean(row.getCell(COL.namaGT).value),
      kategoriOutlet: clean(row.getCell(COL.kategoriOutlet).value),
      gmNama: clean(row.getCell(COL.gmNama).value),
      gmNip: clean(row.getCell(COL.gmNip).value),
      nsmNama, nsmNip,
      smNama: clean(row.getCell(COL.smNama).value),
      smNip: clean(row.getCell(COL.smNip).value),
      asmNama, asmNip,
      spvNama: clean(row.getCell(COL.spvNama).value),
      spvNip: clean(row.getCell(COL.spvNip).value),
      mrNama: clean(row.getCell(COL.mrNama).value),
      mrNip: clean(row.getCell(COL.mrNip).value),
    });
  }

  console.log(`Parsed ${rows.length} outlet rows (skipped ${skippedNoKode} with no KodePI).\n`);

  // ── 1. Refresh OutletStrukturBaru staging table (wholesale replace) ──────────
  await prisma.outletStrukturBaru.deleteMany({});
  const stagingData = rows.map((r) => ({
    kodePI: r.kodePI, namaOutlet: r.namaOutlet, area: r.namaArea,
    gmNama: r.gmNama, nsmNama: r.nsmNama, smNama: r.smNama,
    asmNama: r.asmNama, spvNama: r.spvNama, psrNama: r.mrNama,
    gmNip: r.gmNip, nsmNip: r.nsmNip, smNip: r.smNip,
    asmNip: r.asmNip, spvNip: r.spvNip, psrNip: r.mrNip,
  }));
  const CHUNK = 1000;
  for (let i = 0; i < stagingData.length; i += CHUNK) {
    await prisma.outletStrukturBaru.createMany({ data: stagingData.slice(i, i + CHUNK) });
  }
  console.log(`✅ OutletStrukturBaru refreshed: ${stagingData.length} rows.\n`);

  const now = new Date();

  // ── 2. Collect per-user hierarchy (mirrors orgStructureSync.ts's collect()) ──
  const userMap = new Map<string, { name: string; role: Role; managerNips: string[] }>();

  function collect(nip: string | null, name: string | null, role: Role, managerNip: string | null) {
    if (!nip || isPlaceholder(name)) return;
    const existing = userMap.get(nip);
    if (existing) {
      if (managerNip) existing.managerNips.push(managerNip);
    } else {
      userMap.set(nip, { name: (name ?? nip).trim(), role, managerNips: managerNip ? [managerNip] : [] });
    }
  }

  // Picks the first non-blank NIP among candidates, in priority order — used to
  // skip a vacant intermediate level (e.g. ASM) and link straight to the next
  // real level up (SM, then NSM) instead of leaving nipAtasan null. This is
  // what makes "ASM/SM vacant → approval goes straight to NSM" work at all:
  // poaWorkflow.ts's resolveNextHolder() just walks whatever chain is here.
  function firstNonBlank(...candidates: (string | null)[]): string | null {
    return candidates.find((c) => !!c) ?? null;
  }

  for (const r of rows) {
    const gmNip = resolvableLevelNip(r.gmNama, r.gmNip);
    const nsmNip = resolvableLevelNip(r.nsmNama, r.nsmNip);
    const smNip = resolvableLevelNip(r.smNama, r.smNip);
    const asmNip = resolvableLevelNip(r.asmNama, r.asmNip);

    collect(gmNip, r.gmNama, "GM", null);
    collect(nsmNip, r.nsmNama, "NSM", null);
    collect(smNip, r.smNama, "SM", nsmNip);
    collect(asmNip, r.asmNama, "ASM", firstNonBlank(smNip, nsmNip));
    // SPV collapses to MR (skip-level to ASM); MR is the leaf. Both skip past
    // a vacant ASM straight to SM, then NSM, same principle as above. A SHADOW
    // pair yields two holders here — both collected as their own MR User.
    const mrManager = firstNonBlank(asmNip, smNip, nsmNip);
    for (const h of leafHolders(r.spvNama, r.spvNip)) collect(h.nip, h.name, "MR", mrManager);
    for (const h of leafHolders(r.mrNama, r.mrNip)) collect(h.nip, h.name, "MR", mrManager);
  }

  console.log(`Collected ${userMap.size} distinct real (non-placeholder) users across GM/NSM/SM/ASM/SPV/MR.\n`);

  // Pass 1: upsert users (name + role only — never touches isActive/isDummy).
  let usersUpserted = 0;
  const userErrors: string[] = [];
  for (const [nip, u] of userMap) {
    try {
      await prisma.user.upsert({
        where: { nip },
        create: { nip, name: u.name, role: u.role, syncedAt: now },
        update: { name: u.name, role: u.role, syncedAt: now },
      });
      usersUpserted++;
    } catch (e) {
      userErrors.push(`${nip} (${u.name}): ${String(e)}`);
    }
  }
  console.log(`✅ Users upserted: ${usersUpserted}${userErrors.length ? ` (${userErrors.length} errors)` : ""}\n`);

  // Pass 2: wire nipAtasan/namaAtasan (dominant manager when a user showed up under >1).
  let hierarchyWired = 0;
  const hierarchyUnresolved: string[] = [];
  for (const [nip, u] of userMap) {
    if (u.managerNips.length === 0) continue;
    const managerNip = dominant(u.managerNips);
    const manager = await prisma.user.findUnique({ where: { nip: managerNip }, select: { nip: true, name: true } });
    if (!manager) { hierarchyUnresolved.push(`${nip} (${u.name}) → manager ${managerNip} not found`); continue; }
    await prisma.user.update({ where: { nip }, data: { nipAtasan: manager.nip, namaAtasan: manager.name } });
    hierarchyWired++;
  }
  console.log(`✅ Hierarchy (nipAtasan) wired: ${hierarchyWired}${hierarchyUnresolved.length ? ` (${hierarchyUnresolved.length} unresolved)` : ""}\n`);

  const existingUserNips = new Set([...userMap.keys()]);

  // SPV IS MR — a row's SPV and MR columns are two names for the same leaf
  // level, only one filled per row (or, for a SHADOW row, two names in one).
  // Named holder(s) of this outlet's leaf position regardless of whether they
  // resolved to a real User — usually one, two for a SHADOW pair, empty if
  // genuinely vacant/blank/DUMMY/"NEW".
  function rawLeafHolders(r: OutletRow): { name: string; nip: string }[] {
    return [...leafHolders(r.spvNama, r.spvNip), ...leafHolders(r.mrNama, r.mrNip)];
  }

  // Same, filtered to holders that actually resolved to a real User.
  function resolvedLeafHolders(r: OutletRow): string[] {
    return rawLeafHolders(r).map((h) => h.nip).filter((nip) => existingUserNips.has(nip));
  }

  // Single representative holder — for Outlet.coveredByNip (a singular field
  // driving the vacant-team-coverage feature, unrelated to how many people
  // actually get a MrOutletAssignment row for this outlet).
  function effectiveMrNip(r: OutletRow): string | null {
    return resolvedLeafHolders(r)[0] ?? null;
  }

  // Whoever can actually act on this outlet right now — its own MR (or SPV,
  // same thing) if resolved, else the first active ASM/SM/NSM above it.
  // Independent per outlet, so one manager can cover outlet A (vacant MR+ASM
  // there) while outlet B down the road still has its own MR — covering one
  // vacant outlet doesn't require the manager's WHOLE team to be vacant.
  function resolveCoverage(r: OutletRow): { nip: string; role: "MR" | "ASM" | "SM" | "NSM" } | null {
    const mrNip = effectiveMrNip(r);
    if (mrNip && existingUserNips.has(mrNip)) return { nip: mrNip, role: "MR" };
    const asmNip = resolvableLevelNip(r.asmNama, r.asmNip);
    if (asmNip && existingUserNips.has(asmNip)) return { nip: asmNip, role: "ASM" };
    const smNip = resolvableLevelNip(r.smNama, r.smNip);
    if (smNip && existingUserNips.has(smNip)) return { nip: smNip, role: "SM" };
    const nsmNip = resolvableLevelNip(r.nsmNama, r.nsmNip);
    if (nsmNip && existingUserNips.has(nsmNip)) return { nip: nsmNip, role: "NSM" };
    return null;
  }

  // ── 3. Upsert Outlet territory/kategori/coveredBy fields ─────────────────────
  let outletsUpserted = 0;
  const coverageCounts: Record<string, number> = { MR: 0, ASM: 0, SM: 0, NSM: 0, none: 0 };
  for (const r of rows) {
    const coverage = resolveCoverage(r);
    coverageCounts[coverage?.role ?? "none"]++;
    await prisma.outlet.upsert({
      where: { kodePI: r.kodePI },
      create: {
        kodePI: r.kodePI, namaOutlet: r.namaOutlet ?? r.kodePI, statusOutlet: "A",
        kota: r.kota, propinsi: r.provinsi, kategori: r.kategoriOutlet,
        namaGT: r.namaGT, namaSub: r.namaSubArea, namaArea: r.namaArea, namaReg: r.namaRegion,
        coveredByNip: coverage?.nip ?? null, coveredByRole: coverage?.role ?? null,
        syncedAt: now,
      },
      update: {
        kota: r.kota ?? undefined, propinsi: r.provinsi ?? undefined, kategori: r.kategoriOutlet ?? undefined,
        namaGT: r.namaGT ?? undefined, namaSub: r.namaSubArea ?? undefined,
        namaArea: r.namaArea ?? undefined, namaReg: r.namaRegion ?? undefined,
        coveredByNip: coverage?.nip ?? null, coveredByRole: coverage?.role ?? null,
      },
    });
    outletsUpserted++;
  }
  console.log(`✅ Outlet upserted: ${outletsUpserted} rows.`);
  console.log(`   Covered by MR: ${coverageCounts.MR} · ASM (vacant MR): ${coverageCounts.ASM} · SM (vacant MR+ASM): ${coverageCounts.SM} · NSM (vacant MR+ASM+SM): ${coverageCounts.NSM} · nobody resolvable: ${coverageCounts.none}\n`);

  // ── 4. MrOutletAssignment — the latest import is authoritative ───────────────
  // If this outlet has no resolvable MR right now (genuinely vacant, or a named
  // MR who isn't a real User yet), any pre-existing assignment is CLEARED, not
  // kept — a stale assignment pointing at whoever held it before is worse than
  // no assignment, since it'd misrepresent who's actually responsible for it
  // today (2026-07-21 decision, business owner: "ikuti yang baru, yang lama buang").
  // Normally one holder per outlet, but a SHADOW pair resolves to two — both
  // get a row (nipMR+kodePI+periode is the unique key, so this isn't a conflict),
  // and only holders NOT in the current resolved set get cleared out.
  const periode = now.getFullYear() * 100 + (now.getMonth() + 1);
  let assignmentsWritten = 0, assignmentsCleared = 0, outletsNoMr = 0, outletsMrNotUser = 0;

  for (const r of rows) {
    const holders = resolvedLeafHolders(r);

    if (holders.length === 0) {
      if (rawLeafHolders(r).length === 0) outletsNoMr++; else outletsMrNotUser++;
      const cleared = await prisma.mrOutletAssignment.deleteMany({ where: { kodePI: r.kodePI, periode } });
      assignmentsCleared += cleared.count;
      continue;
    }

    const cleared = await prisma.mrOutletAssignment.deleteMany({
      where: { kodePI: r.kodePI, periode, nipMR: { notIn: holders } },
    });
    assignmentsCleared += cleared.count;
    for (const nipMR of holders) {
      await prisma.mrOutletAssignment.upsert({
        where: { nipMR_kodePI_periode: { nipMR, kodePI: r.kodePI, periode } },
        create: { nipMR, kodePI: r.kodePI, periode, syncedAt: now },
        update: { syncedAt: now },
      });
    }
    assignmentsWritten++;
  }

  console.log(`✅ MrOutletAssignment: ${assignmentsWritten} outlets assigned/overridden for periode ${periode}.`);
  console.log(`   Outlets with no resolved MR (assignment cleared if any existed): ${outletsNoMr}`);
  console.log(`   Outlets whose MR NIP failed to resolve to a User (assignment cleared if any existed): ${outletsMrNotUser}`);
  console.log(`   Stale assignment rows actually cleared: ${assignmentsCleared}\n`);

  if (userErrors.length) {
    console.log("User upsert errors:");
    userErrors.slice(0, 20).forEach((e) => console.log(`   ${e}`));
  }
  if (hierarchyUnresolved.length) {
    console.log("Unresolved manager NIPs (first 20):");
    hierarchyUnresolved.slice(0, 20).forEach((e) => console.log(`   ${e}`));
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
