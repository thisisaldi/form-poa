/**
 * Import "internal/Struktur Verified Part KAM.xlsx" (sheet "ALL") — a manually
 * verified outlet↔org-structure mapping for the KAM division, superseding the
 * old draft (see importStrukturBaru.ts) which mapped by name only. This file
 * gives NIPs directly for every role level (GM/NSM/SM/ASM/SPV/MR), which
 * sidesteps most of the old name-resolution ambiguity.
 *
 * Known data bug (confirmed with the business owner 2026-07-20): the "NIP NSM"
 * column for NSM "EKA" is corrupted — instead of repeating her one real NIP,
 * it contains a distinct sequential code per row (P260205, P260206, ...).
 * Her correct NIP is P260205 — hardcoded as an override below. All other 11
 * NSMs have a single consistent NIP across their rows (verified before this
 * script was written) so no other override is needed.
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
 * This file covers only the KAM division ("Part KAM") — it is NOT a full
 * company roster, so unlike orgStructureSync.ts this script never deactivates
 * users absent from it (that would wrongly affect other divisions).
 *
 * Effects (in order):
 *   1. Refresh OutletStrukturBaru (wholesale replace — staging/review copy).
 *   2. Upsert Outlet rows: kota, propinsi, kategori, namaGT/namaSub/namaArea/namaReg.
 *   3. Upsert Users for every resolved non-placeholder NIP + wire nipAtasan/namaAtasan.
 *   4. For each outlet with a resolved MR NIP (leaf level), that NIP becomes the
 *      SOLE assignee for the current periode — replacing any other existing
 *      assignee(s) for that outlet. Outlets with no resolved MR NIP are left
 *      completely untouched (existing assignments, if any, are kept as-is).
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

function isPlaceholder(name: string | null): boolean {
  return !name || /^(DUMMY|VACANT)\b/i.test(name);
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

  // ── 2. Upsert Outlet territory/kategori fields ───────────────────────────────
  const now = new Date();
  let outletsUpserted = 0;
  for (const r of rows) {
    await prisma.outlet.upsert({
      where: { kodePI: r.kodePI },
      create: {
        kodePI: r.kodePI, namaOutlet: r.namaOutlet ?? r.kodePI, statusOutlet: "A",
        kota: r.kota, propinsi: r.provinsi, kategori: r.kategoriOutlet,
        namaGT: r.namaGT, namaSub: r.namaSubArea, namaArea: r.namaArea, namaReg: r.namaRegion,
        syncedAt: now,
      },
      update: {
        kota: r.kota ?? undefined, propinsi: r.provinsi ?? undefined, kategori: r.kategoriOutlet ?? undefined,
        namaGT: r.namaGT ?? undefined, namaSub: r.namaSubArea ?? undefined,
        namaArea: r.namaArea ?? undefined, namaReg: r.namaRegion ?? undefined,
      },
    });
    outletsUpserted++;
  }
  console.log(`✅ Outlet upserted: ${outletsUpserted} rows.\n`);

  // ── 3. Collect per-user hierarchy (mirrors orgStructureSync.ts's collect()) ──
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

  for (const r of rows) {
    collect(r.gmNip, r.gmNama, "GM", null);
    collect(r.nsmNip, r.nsmNama, "NSM", null);
    collect(r.smNip, r.smNama, "SM", r.nsmNip);
    collect(r.asmNip, r.asmNama, "ASM", r.smNip);
    collect(r.spvNip, r.spvNama, "MR", r.asmNip); // SPV collapses to MR, skip-level to ASM
    collect(r.mrNip, r.mrNama, "MR", r.asmNip);   // leaf MR, skip-level to ASM
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

  // ── 4. MrOutletAssignment — additive/targeted, never a blanket delete ────────
  const periode = now.getFullYear() * 100 + (now.getMonth() + 1);
  const existingUserNips = new Set([...userMap.keys()]);
  let assignmentsWritten = 0, outletsNoMr = 0, outletsMrNotUser = 0;

  for (const r of rows) {
    if (!r.mrNip) { outletsNoMr++; continue; }
    if (!existingUserNips.has(r.mrNip)) { outletsMrNotUser++; continue; }

    await prisma.mrOutletAssignment.deleteMany({
      where: { kodePI: r.kodePI, periode, nipMR: { not: r.mrNip } },
    });
    await prisma.mrOutletAssignment.upsert({
      where: { nipMR_kodePI_periode: { nipMR: r.mrNip, kodePI: r.kodePI, periode } },
      create: { nipMR: r.mrNip, kodePI: r.kodePI, periode, syncedAt: now },
      update: { syncedAt: now },
    });
    assignmentsWritten++;
  }

  console.log(`✅ MrOutletAssignment: ${assignmentsWritten} outlets assigned/overridden for periode ${periode}.`);
  console.log(`   Outlets with no resolved MR (left untouched): ${outletsNoMr}`);
  console.log(`   Outlets whose MR NIP failed to resolve to a User (left untouched): ${outletsMrNotUser}\n`);

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
