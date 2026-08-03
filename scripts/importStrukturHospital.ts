/**
 * Import "internal/Struktur Hospital NIP Perso Check.xlsx" (sheet "ALL") —
 * supersedes scripts/importStrukturVerifiedKAM.ts (2026-07-22). Same 25-column
 * shape (KodePI..KATEGORI OUTLET, GM/NSM/SM/ASM/SPV/MR name+NIP per outlet),
 * but this file now covers BOTH the KAM-1 and HOSPINET divisions combined in
 * one roster (verified via the "NIP Perso" sheet: 255 KAM-1 + 121 HOSPINET),
 * closing the gap noted in docs/TODO.md #40 ("Hospinet masih belum
 * ke-cover di struktur org"). The business owner confirmed the OLD KAM-only
 * file had errors this one fixes — verified directly against this file
 * (2026-07-22) before writing this script:
 *   - EKA (P260205) and DODY ALWARDY (P250442), previously hardcoded overrides
 *     for corrupted/blank NIP columns in the old file, now have a single
 *     consistent correct NIP on every row here — no override needed anymore.
 *   - The RUDI RUSDIANSYAH / JONATHAN SAMOSIR SHADOW pair, previously
 *     colliding on the same NIP in the old file (JONATHAN's real NIP was
 *     unknown), now resolves to two distinct NIPs (P250275 / P250189).
 *   - Zero occurrences of: "NEW" placeholder NIPs, "-" placeholder NIPs,
 *     descriptive placeholder TEXT pasted into a NIP cell, or a stale real
 *     NIP left behind on a DUMMY/VACANT-named (vacant) position — all data
 *     bugs that required extra handling in the old file. That handling
 *     (resolvableNip/resolvableLevelNip) is kept here regardless, since it's
 *     harmless when the source is already clean and guards against the same
 *     bug classes reappearing in a future month's file.
 *   - 64 SHADOW pairs (jointly-held outlets) remain, same "A - B (SHADOW)"
 *     format as before — same parseShadowPair() handling applies unchanged.
 *
 * Role mapping (unchanged from the KAM script):
 *   GM → GM (top, no manager tracked here) · NSM → NSM (no manager tracked
 *   here) · SM → SM, reports to NSM · ASM → ASM, reports to SM · SPV → MR,
 *   reports to ASM (skip-level) · MR → MR, reports to ASM (skip-level, leaf).
 * Names starting with "DUMMY "/"VACANT " (or "(DUMMY)"/"(VACANT)"/no-space
 * variants) are placeholders for an unfilled position — never created as Users.
 *
 * SPV display-only title (2026-07-22, business owner: "yang SPV tampilkan di
 * web nya SPV, walaupun level permissionnya sama kayak MR"): SPV is still
 * role="MR" for every permission/approval/outlet-holding purpose (unchanged —
 * see SPV-IS-MR note below), but every NIP seen in the SPV column at least
 * once gets User.jabatan="SPV" so the UI can show "SPV" instead of "MR" as
 * their title without touching how the app treats them functionally.
 *
 * SPV IS MR for outlet-ownership purposes: a row's SPV and MR columns are two
 * names for the same leaf level — only one is filled per row. Every place that
 * resolves "who owns/covers this outlet" (resolveCoverage, MrOutletAssignment)
 * must use `mrNip ?? spvNip`, not `mrNip` alone, or rows where only the SPV
 * column is filled get wrongly treated as vacant-MR.
 *
 * POA SAFETY: this script only ever upserts Users by NIP (create or update
 * name/role/jabatan/nipAtasan) and never renames or deletes a NIP — every FK
 * that references User.nip (PoaForm.ownerId/currentHolderId, PoaAuditLog,
 * MrOutletAssignment.nipMR, etc.) stays valid, and PoaLineItem doesn't even
 * hold a live FK to Customer/User (it's a denormalized snapshot). Existing
 * POAs — draft or already approved — are unaffected by this import.
 *
 * Effects (in order):
 *   1. Refresh OutletStrukturBaru (wholesale replace — staging/review copy).
 *   2. Upsert Users for every resolved non-placeholder NIP + wire nipAtasan/
 *      namaAtasan + jabatan.
 *   3. Upsert Outlet rows: kota, propinsi, kategori, namaGT/namaSub/namaArea/
 *      namaReg, plus coveredByNip/coveredByRole (vacant-team coverage).
 *   4. MrOutletAssignment — latest import is authoritative for the current
 *      periode (stale assignments cleared, not left to linger — same
 *      "ikuti yang baru, yang lama buang" principle as the KAM script).
 *   5. Upsert the single OrgStrukturMeta row so the Admin page can show which
 *      month's structure is currently loaded.
 *
 * Run: npx tsx scripts/importStrukturHospital.ts [path-to-excel] [periode YYYYMM]
 * Default: internal/Struktur Hospital NIP Perso Check.xlsx, periode = today's month
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";
import type { Role } from "@prisma/client";

const DATA_START = 2;
const SOURCE_FILE_DEFAULT = "internal/Struktur Hospital NIP Perso Check.xlsx";

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

// See file header — kept unchanged from the KAM script even though this
// source is currently clean of the bugs it guards against.
const PLACEHOLDER_RE = /^\(?\s*(DUMMY|VACANT)/i;

function isPlaceholder(name: string | null): boolean {
  return !name || PLACEHOLDER_RE.test(name);
}

function resolvableNip(nip: string | null): string | null {
  if (!nip || nip === "-") return null;
  if (/^new$/i.test(nip)) return null;
  if (PLACEHOLDER_RE.test(nip)) return null;
  return nip;
}

function resolvableLevelNip(name: string | null, nip: string | null): string | null {
  return isPlaceholder(name) ? null : resolvableNip(nip);
}

const SHADOW_RE = /^(.+?)\s*-\s*(.+?)\s*\(SHADOW\)\s*$/i;

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
  const filePath = path.resolve(process.argv[2] ?? SOURCE_FILE_DEFAULT);
  const now = new Date();
  const periode = process.argv[3]?.trim() || `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (!/^\d{6}$/.test(periode)) { console.error(`Invalid periode "${periode}" — expected YYYYMM.`); process.exit(1); }
  // MrOutletAssignment.periode is Int (YYYYMM) — same source-of-truth string as
  // above, parsed once, so both OrgStrukturMeta and MrOutletAssignment always
  // agree on which month this import is FOR (2026-07-30 fix: this used to
  // silently use today's real-world date for assignments regardless of the
  // periode arg, so importing e.g. August's file in July tagged the
  // assignments 202607 instead of 202608 while OrgStrukturMeta correctly said
  // 202608 — the two tables disagreed about which period had just been loaded).
  const periodeInt = parseInt(periode, 10);
  console.log(`Reading: ${filePath} (struktur periode ${periode})\n`);

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
      nsmNama: clean(row.getCell(COL.nsmNama).value),
      nsmNip: clean(row.getCell(COL.nsmNip).value),
      smNama: clean(row.getCell(COL.smNama).value),
      smNip: clean(row.getCell(COL.smNip).value),
      asmNama: clean(row.getCell(COL.asmNama).value),
      asmNip: clean(row.getCell(COL.asmNip).value),
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

  // ── 2. Collect per-user hierarchy (mirrors importStrukturVerifiedKAM.ts) ─────
  const userMap = new Map<string, { name: string; role: Role; managerNips: string[] }>();
  const spvNips = new Set<string>(); // any NIP ever seen in the SPV column → jabatan="SPV"

  function collect(nip: string | null, name: string | null, role: Role, managerNip: string | null) {
    if (!nip || isPlaceholder(name)) return;
    const existing = userMap.get(nip);
    if (existing) {
      if (managerNip) existing.managerNips.push(managerNip);
    } else {
      userMap.set(nip, { name: (name ?? nip).trim(), role, managerNips: managerNip ? [managerNip] : [] });
    }
  }

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

    const mrManager = firstNonBlank(asmNip, smNip, nsmNip);
    for (const h of leafHolders(r.spvNama, r.spvNip)) {
      collect(h.nip, h.name, "MR", mrManager);
      spvNips.add(h.nip);
    }
    for (const h of leafHolders(r.mrNama, r.mrNip)) collect(h.nip, h.name, "MR", mrManager);
  }

  console.log(`Collected ${userMap.size} distinct real (non-placeholder) users across GM/NSM/SM/ASM/SPV/MR (${spvNips.size} tagged jabatan=SPV).\n`);

  // Pass 1: upsert users (name + role + jabatan only — never touches isActive/isDummy).
  let usersUpserted = 0;
  const userErrors: string[] = [];
  for (const [nip, u] of userMap) {
    const jabatan = spvNips.has(nip) ? "SPV" : null;
    try {
      await prisma.user.upsert({
        where: { nip },
        create: { nip, name: u.name, role: u.role, jabatan, syncedAt: now },
        update: { name: u.name, role: u.role, jabatan, syncedAt: now },
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

  function rawLeafHolders(r: OutletRow): { name: string; nip: string }[] {
    return [...leafHolders(r.spvNama, r.spvNip), ...leafHolders(r.mrNama, r.mrNip)];
  }

  function resolvedLeafHolders(r: OutletRow): string[] {
    return rawLeafHolders(r).map((h) => h.nip).filter((nip) => existingUserNips.has(nip));
  }

  function effectiveMrNip(r: OutletRow): string | null {
    return resolvedLeafHolders(r)[0] ?? null;
  }

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
  const assignPeriode = periodeInt;
  let assignmentsWritten = 0, assignmentsCleared = 0, outletsNoMr = 0, outletsMrNotUser = 0;

  for (const r of rows) {
    const holders = resolvedLeafHolders(r);

    if (holders.length === 0) {
      if (rawLeafHolders(r).length === 0) outletsNoMr++; else outletsMrNotUser++;
      const cleared = await prisma.mrOutletAssignment.deleteMany({ where: { kodePI: r.kodePI, periode: assignPeriode } });
      assignmentsCleared += cleared.count;
      continue;
    }

    const cleared = await prisma.mrOutletAssignment.deleteMany({
      where: { kodePI: r.kodePI, periode: assignPeriode, nipMR: { notIn: holders } },
    });
    assignmentsCleared += cleared.count;
    for (const nipMR of holders) {
      await prisma.mrOutletAssignment.upsert({
        where: { nipMR_kodePI_periode: { nipMR, kodePI: r.kodePI, periode: assignPeriode } },
        create: { nipMR, kodePI: r.kodePI, periode: assignPeriode, syncedAt: now },
        update: { syncedAt: now },
      });
    }
    assignmentsWritten++;
  }

  console.log(`✅ MrOutletAssignment: ${assignmentsWritten} outlets assigned/overridden for periode ${assignPeriode}.`);
  console.log(`   Outlets with no resolved MR (assignment cleared if any existed): ${outletsNoMr}`);
  console.log(`   Outlets whose MR NIP failed to resolve to a User (assignment cleared if any existed): ${outletsMrNotUser}`);
  console.log(`   Stale assignment rows actually cleared: ${assignmentsCleared}\n`);

  // ── 5. Record which month's structure this is ────────────────────────────────
  await prisma.orgStrukturMeta.upsert({
    where: { id: 1 },
    create: { id: 1, periode, sourceFile: path.basename(filePath), importedAt: now },
    update: { periode, sourceFile: path.basename(filePath), importedAt: now },
  });
  console.log(`✅ OrgStrukturMeta recorded: periode ${periode}, source "${path.basename(filePath)}".\n`);

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
