/**
 * Import the draft 2026 org restructure from
 * "excel/Simulasi Hospital Struktur 2026 New.xlsx - Master.csv" into
 * OutletStrukturBaru — a staging table for review, NOT wired into
 * Outlet/MrOutletAssignment or the approval workflow.
 *
 * The file maps outlets to a GM > NSM > SM > ASM > SPV > PSR hierarchy by
 * person NAME (not NIP). Names are matched first against non-dummy Users
 * (exact name, case-insensitive, trimmed — real accounts only have one name
 * each, so this is unambiguous), then against "excel/STRUKTUR JULI.csv" (the
 * prior month's full org export, which has real NIPs per name) as a fallback
 * for anyone not currently in the Users table. Names still unmatched after
 * both lookups are reported at the end for manual review — never silently
 * guessed at or auto-created.
 *
 * Run: npx tsx scripts/importStrukturBaru.ts [path-to-csv]
 * Default: excel/Simulasi Hospital Struktur 2026 New.xlsx - Master.csv
 */

import "dotenv/config";
import path from "path";
import fs from "fs";
import { prisma } from "../src/lib/prisma";

const COL = {
  kodePI: 0, namaOutlet: 1, gm: 2, nsm: 3, sm: 4, asm: 5, spv: 6, psr: 7, area: 8,
} as const;

// Column pairs (nip, nama) for each role in STRUKTUR JULI.csv's semicolon-delimited export.
const JULI_ROLE_COLS: [number, number][] = [
  [5, 6],   // GM
  [7, 8],   // NSM
  [9, 10],  // SM
  [13, 14], // ASM
  [17, 18], // SPV
  [21, 22], // FF
];

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function clean(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  return s || null;
}

function isVacant(nip: string | null): boolean {
  return !nip || nip.toUpperCase().startsWith("V");
}

/** Name → NIP map built from STRUKTUR JULI.csv's GM/NSM/SM/ASM/SPV/FF columns. */
function loadJuliNameNipMap(filePath: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(filePath)) {
    console.log(`(no fallback: ${filePath} not found)\n`);
    return map;
  }
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const f = lines[i].split(";");
    // The August restructure merges KAM1 + HPH (Hospinet) — scope the fallback
    // to those divisions so it lines up with who's actually being onboarded.
    const divisi = f[4] ?? "";
    if (divisi !== "KAM1" && !divisi.startsWith("HPH")) continue;
    for (const [nipCol, namaCol] of JULI_ROLE_COLS) {
      const nip = clean(f[nipCol]);
      const nama = clean(f[namaCol]);
      if (!nama || isVacant(nip)) continue;
      const key = nama.toUpperCase();
      if (!map.has(key)) map.set(key, nip!);
    }
  }
  console.log(`Loaded ${map.size} name→NIP pairs from ${filePath}\n`);
  return map;
}

async function main() {
  const filePath = path.resolve(process.argv[2] ?? "excel/Simulasi Hospital Struktur 2026 New.xlsx - Master.csv");
  console.log(`Reading: ${filePath}\n`);

  const lines = fs.readFileSync(filePath, "utf8").split("\n");

  // Name → NIP map, real (non-dummy) accounts only — one name maps to exactly one NIP.
  const users = await prisma.user.findMany({ where: { isDummy: false }, select: { nip: true, name: true } });
  const nipByName = new Map<string, string>();
  for (const u of users) nipByName.set(u.name.trim().toUpperCase(), u.nip);

  const juliNipByName = loadJuliNameNipMap(path.resolve("excel/STRUKTUR JULI.csv"));

  const unmatched = new Map<string, number>(); // name -> occurrence count, across all role columns
  let resolvedViaJuli = 0;

  function resolveNip(nama: string | null): string | null {
    if (!nama) return null;
    const key = nama.trim().toUpperCase();
    const nip = nipByName.get(key);
    if (nip) return nip;
    const juliNip = juliNipByName.get(key);
    if (juliNip) { resolvedViaJuli++; return juliNip; }
    unmatched.set(nama, (unmatched.get(nama) ?? 0) + 1);
    return null;
  }

  const rows: {
    kodePI: string; namaOutlet: string | null; area: string | null;
    gmNama: string | null; nsmNama: string | null; smNama: string | null;
    asmNama: string | null; spvNama: string | null; psrNama: string | null;
    gmNip: string | null; nsmNip: string | null; smNip: string | null;
    asmNip: string | null; spvNip: string | null; psrNip: string | null;
  }[] = [];

  let skipped = 0;
  for (let i = 2; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const f = parseCsvLine(lines[i]);
    const kodePI = clean(f[COL.kodePI]);
    if (!kodePI) { skipped++; continue; }

    const gmNama = clean(f[COL.gm]);
    const nsmNama = clean(f[COL.nsm]);
    const smNama = clean(f[COL.sm]);
    const asmNama = clean(f[COL.asm]);
    const spvNama = clean(f[COL.spv]);
    const psrNama = clean(f[COL.psr]);

    rows.push({
      kodePI,
      namaOutlet: clean(f[COL.namaOutlet]),
      area: clean(f[COL.area]),
      gmNama, nsmNama, smNama, asmNama, spvNama, psrNama,
      gmNip: resolveNip(gmNama),
      nsmNip: resolveNip(nsmNama),
      smNip: resolveNip(smNama),
      asmNip: resolveNip(asmNama),
      spvNip: resolveNip(spvNama),
      psrNip: resolveNip(psrNama),
    });
  }

  // Fresh import each run — this is draft/staging data, always replaced wholesale.
  await prisma.outletStrukturBaru.deleteMany({});

  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.outletStrukturBaru.createMany({ data: rows.slice(i, i + CHUNK) });
  }

  console.log(`✅ Done.`);
  console.log(`   Imported: ${rows.length} rows`);
  console.log(`   Skipped : ${skipped} (missing KodePI)`);
  console.log(`   Resolved via STRUKTUR JULI fallback: ${resolvedViaJuli} name occurrences`);
  console.log(`\nUnmatched names (${unmatched.size} distinct, not found among non-dummy Users or STRUKTUR JULI):`);
  for (const [name, count] of [...unmatched.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${name} — ${count}x`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
