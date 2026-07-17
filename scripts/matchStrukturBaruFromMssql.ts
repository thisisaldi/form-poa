/**
 * Second-pass name matching for OutletStrukturBaru against MSSQL
 * Struktur_Marketing_PI (mkt_insight) — the org-structure source of truth
 * that already has GM/NSM/SM/ASM/SPV/FF name↔NIP pairs, independent of
 * whether that person has a Postgres User account yet.
 *
 * Matches PER ROLE LEVEL (PSR only against FF_Nama/FF_NIP, SPV only against
 * SPV_Nama/SPV_NIP, etc.) — pooling all levels together caused false
 * "ambiguous" hits for people who share a name but hold different roles
 * (e.g. one SUPRIYANTO is an ASM, a different SUPRIYANTO is an FF/PSR).
 *
 * Tries an exact name match first, then falls back to a same-role fuzzy
 * match: the CSV name's words must appear, in order, as a subsequence of an
 * MSSQL name's words (handles MSSQL's fuller names, e.g. CSV "TIMBUL SINAGA"
 * vs MSSQL "TIMBUL SINAGA SP.", or "KLARA TAMBUNAN" vs "KLARA NURLELA
 * TAMBUNAN"). If more than one MSSQL name fuzzy-matches, it's left as
 * ambiguous for manual review rather than guessed at.
 *
 * Only fills in *Nip columns that are still null. Skips "(VACANT) ..." names.
 *
 * Run: npx tsx scripts/matchStrukturBaruFromMssql.ts
 */

import "dotenv/config";
import sql from "mssql";
import { prisma } from "../src/lib/prisma";

const ROLES = [
  { level: "GM", nama: "gmNama", nip: "gmNip", mssqlNip: "GM_NIP", mssqlNama: "GM_Nama" },
  { level: "NSM", nama: "nsmNama", nip: "nsmNip", mssqlNip: "NSM_NIP", mssqlNama: "NSM_Nama" },
  { level: "SM", nama: "smNama", nip: "smNip", mssqlNip: "SM_NIP", mssqlNama: "SM_Nama" },
  { level: "ASM", nama: "asmNama", nip: "asmNip", mssqlNip: "ASM_NIP", mssqlNama: "ASM_Nama" },
  { level: "SPV", nama: "spvNama", nip: "spvNip", mssqlNip: "SPV_NIP", mssqlNama: "SPV_Nama" },
  { level: "PSR", nama: "psrNama", nip: "psrNip", mssqlNip: "FF_NIP", mssqlNama: "FF_Nama" },
] as const;

function words(name: string): string[] {
  return name.trim().toUpperCase().split(/\s+/).filter(Boolean);
}

// True if `short` words appear, in order, as a (not necessarily contiguous) subsequence of `long` words.
function isWordSubsequence(short: string[], long: string[]): boolean {
  let i = 0;
  for (const w of long) {
    if (i < short.length && w === short[i]) i++;
  }
  return i === short.length;
}

async function main() {
  const pool = await sql.connect(process.env.MSSQL_CONNECTION_STRING!);

  let totalMatched = 0;
  let totalFuzzyMatched = 0;
  const stillUnmatched: { level: string; name: string; count: number }[] = [];
  const ambiguous: { level: string; name: string; count: number; candidates: string[] }[] = [];

  for (const { level, nama, nip, mssqlNip, mssqlNama } of ROLES) {
    const { recordset } = await pool.request().query<{ nip: string; nama: string }>(`
      SELECT DISTINCT ${mssqlNip} nip, ${mssqlNama} nama FROM Struktur_Marketing_PI
      WHERE ${mssqlNip} IS NOT NULL AND ${mssqlNama} IS NOT NULL
    `);

    const exactMap = new Map<string, string>(); // exact NAME -> nip (only when unambiguous)
    const exactAmbiguous = new Map<string, Set<string>>();
    const allMssqlNames: { name: string; nip: string }[] = [];
    for (const r of recordset) {
      const key = (r.nama ?? "").trim().toUpperCase();
      if (!key || key.includes("VACANT")) continue;
      allMssqlNames.push({ name: key, nip: r.nip });
      const set = exactAmbiguous.get(key) ?? new Set<string>();
      set.add(r.nip);
      exactAmbiguous.set(key, set);
    }
    for (const [name, nips] of exactAmbiguous) {
      if (nips.size === 1) exactMap.set(name, [...nips][0]);
    }

    const rows = await prisma.outletStrukturBaru.findMany({
      where: { [nip]: null, [nama]: { not: null } },
      select: { [nama]: true } as never,
    });
    const byUnmatchedName = new Map<string, number>();
    for (const r of rows as unknown as Record<string, string>[]) {
      const name = r[nama];
      byUnmatchedName.set(name, (byUnmatchedName.get(name) ?? 0) + 1);
    }

    for (const [name, count] of byUnmatchedName) {
      const key = name.trim().toUpperCase();
      let resolvedNip = exactMap.get(key);
      let isFuzzy = false;

      if (!resolvedNip) {
        const shortWords = words(name);
        const candidates = new Map<string, string>(); // distinct nip -> a matching mssql name (for logging)
        for (const { name: mssqlName, nip: mssqlNipVal } of allMssqlNames) {
          if (isWordSubsequence(shortWords, words(mssqlName))) candidates.set(mssqlNipVal, mssqlName);
        }
        if (candidates.size === 1) {
          resolvedNip = [...candidates.keys()][0];
          isFuzzy = true;
        } else if (candidates.size > 1) {
          ambiguous.push({ level, name, count, candidates: [...candidates.values()] });
          continue;
        }
      }

      if (!resolvedNip) {
        stillUnmatched.push({ level, name, count });
        continue;
      }

      const result = await prisma.outletStrukturBaru.updateMany({
        where: { [nama]: name, [nip]: null },
        data: { [nip]: resolvedNip },
      });
      totalMatched += result.count;
      if (isFuzzy) totalFuzzyMatched += result.count;
      console.log(`  ${level} · ${name} → ${resolvedNip}${isFuzzy ? " (fuzzy)" : ""} (${result.count} outlet rows)`);
    }
  }

  await pool.close();

  console.log(`\n✅ Done. Newly matched: ${totalMatched} outlet rows (${totalFuzzyMatched} via fuzzy match).`);

  console.log(`\nAmbiguous (${ambiguous.length} distinct names, multiple MSSQL candidates — needs manual pick):`);
  for (const { level, name, count, candidates } of ambiguous.sort((a, b) => b.count - a.count)) {
    console.log(`   [${level}] ${name} — ${count}x → ${candidates.join(" | ")}`);
  }

  console.log(`\nStill unmatched (${stillUnmatched.length} distinct names, no MSSQL match at all):`);
  for (const { level, name, count } of stillUnmatched.sort((a, b) => b.count - a.count)) {
    console.log(`   [${level}] ${name} — ${count}x`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
