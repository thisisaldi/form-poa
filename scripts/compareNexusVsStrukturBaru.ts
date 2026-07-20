/**
 * Diagnostic (read-only, writes nothing): how much of the OutletStrukturBaru
 * gap (~80% of rows have no resolved PSR NIP — see promoteStrukturBaruOutletMapping.ts)
 * could the Nexus API (api-nexus.pharos.id) actually resolve?
 *
 * Pulls every "ethical"-project Supervisor/Field Force's current outlet list from
 * Nexus's get_outlet_by_nip, and cross-references against:
 *   - OutletStrukturBaru rows that DO have a resolved psrNip (sanity check: does
 *     Nexus already agree, i.e. has the new structure been rolled out live yet?)
 *   - OutletStrukturBaru rows that DON'T have a resolved psrNip (the actual gap:
 *     does Nexus have ANY current holder for that outlet at all?)
 *
 * Run: npx tsx scripts/compareNexusVsStrukturBaru.ts
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { prisma } from "../src/lib/prisma";

const NEXUS_BASE = "https://api-nexus.pharos.id/api/r/poa";
const CONCURRENCY = 10;

interface NexusOutlet { code: string; name: string }
interface NexusEmployee { nip: string; nama: string; position: string }

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  console.log("Fetching ethical-project employee roster from Nexus...");
  const empResp = await fetchJson<{ data: { employees: NexusEmployee[] } }>(
    `${NEXUS_BASE}/get_employees?project=ethical`
  );
  const outletHolders = empResp.data.employees.filter(
    (e) => e.position === "Supervisor" || e.position === "Field Force"
  );
  console.log(`  ${empResp.data.employees.length} total employees, ${outletHolders.length} are outlet-holding (Supervisor/Field Force)\n`);

  console.log(`Fetching current outlet list per NIP from Nexus (concurrency ${CONCURRENCY})...`);
  const nexusByOutlet = new Map<string, Set<string>>(); // kodePI -> Set<nip>
  let done = 0;
  let failed = 0;
  await mapWithConcurrency(outletHolders, CONCURRENCY, async (emp) => {
    try {
      const resp = await fetchJson<{ data: { outlets: NexusOutlet[] } }>(
        `${NEXUS_BASE}/get_outlet_by_nip?nip=${encodeURIComponent(emp.nip)}`
      );
      for (const o of resp.data.outlets) {
        const set = nexusByOutlet.get(o.code) ?? new Set<string>();
        set.add(emp.nip);
        nexusByOutlet.set(o.code, set);
      }
    } catch (e) {
      failed++;
      console.error(`  failed for ${emp.nip}: ${(e as Error).message}`);
    }
    done++;
    if (done % 25 === 0) console.log(`  ...${done}/${outletHolders.length}`);
  });
  console.log(`Done. ${nexusByOutlet.size} distinct outlets known to Nexus (ethical), ${failed} NIP lookups failed.\n`);

  // ── Compare against OutletStrukturBaru ──────────────────────────────────────
  const rows = await prisma.outletStrukturBaru.findMany({
    select: { kodePI: true, psrNip: true, psrNama: true },
  });
  const resolved = rows.filter((r) => r.psrNip);
  const unresolved = rows.filter((r) => !r.psrNip);
  console.log(`OutletStrukturBaru: ${rows.length} rows total, ${resolved.length} with resolved PSR, ${unresolved.length} without.\n`);

  // 1) For rows WITH a resolved new-structure PSR: does Nexus already agree?
  let agree = 0, disagreeButNexusHasOutlet = 0, nexusHasNoData = 0;
  for (const r of resolved) {
    const holders = nexusByOutlet.get(r.kodePI);
    if (!holders) { nexusHasNoData++; continue; }
    if (holders.has(r.psrNip!)) agree++;
    else disagreeButNexusHasOutlet++;
  }
  console.log("── Rows WITH a resolved new-structure PSR (sanity check — has Nexus already rolled this out?) ──");
  console.log(`  Nexus already agrees (same NIP holds it today) : ${agree} (${(agree / resolved.length * 100).toFixed(1)}%)`);
  console.log(`  Nexus knows the outlet but assigns someone else : ${disagreeButNexusHasOutlet} (${(disagreeButNexusHasOutlet / resolved.length * 100).toFixed(1)}%)`);
  console.log(`  Nexus has no data for that outlet at all         : ${nexusHasNoData} (${(nexusHasNoData / resolved.length * 100).toFixed(1)}%)\n`);

  // 2) For rows WITHOUT a resolved PSR (the actual gap): does Nexus have ANY current holder?
  const distinctUnresolvedOutlets = new Set(unresolved.map((r) => r.kodePI));
  let nexusCanFillGap = 0;
  for (const kodePI of distinctUnresolvedOutlets) {
    if (nexusByOutlet.has(kodePI)) nexusCanFillGap++;
  }
  console.log("── Rows WITHOUT a resolved PSR — the actual ~80% gap ──");
  console.log(`  Distinct outlets with no new-structure PSR : ${distinctUnresolvedOutlets.size}`);
  console.log(`  Of those, Nexus has a CURRENT holder for   : ${nexusCanFillGap} (${(nexusCanFillGap / distinctUnresolvedOutlets.size * 100).toFixed(1)}%)`);
  console.log(`  Of those, Nexus has NOTHING for            : ${distinctUnresolvedOutlets.size - nexusCanFillGap}\n`);

  // 3) Does Nexus actually add anything beyond the old July baseline (generated-data.json),
  // which the promote script already falls back to for unresolved rows?
  const genPath = path.resolve("src/lib/mock/generated-data.json");
  if (fs.existsSync(genPath)) {
    const gen = JSON.parse(fs.readFileSync(genPath, "utf-8")) as { mrAssignments: { nipMR: string; kodePI: string }[] };
    const oldOutlets = new Set(gen.mrAssignments.map((a) => a.kodePI));

    let oldHasIt = 0, nexusOnly = 0, oldOnly = 0, neitherHasIt = 0, bothHaveIt = 0;
    for (const kodePI of distinctUnresolvedOutlets) {
      const inOld = oldOutlets.has(kodePI);
      const inNexus = nexusByOutlet.has(kodePI);
      if (inOld) oldHasIt++;
      if (inNexus && !inOld) nexusOnly++;
      if (inOld && !inNexus) oldOnly++;
      if (inOld && inNexus) bothHaveIt++;
      if (!inOld && !inNexus) neitherHasIt++;
    }
    console.log("── Of the gap outlets: does Nexus add anything beyond the old July baseline already used as fallback? ──");
    console.log(`  Old baseline already covers  : ${oldHasIt} (${(oldHasIt / distinctUnresolvedOutlets.size * 100).toFixed(1)}%)`);
    console.log(`  Covered by BOTH old & Nexus  : ${bothHaveIt}`);
    console.log(`  Nexus-ONLY (old baseline missed, Nexus has it) : ${nexusOnly} (${(nexusOnly / distinctUnresolvedOutlets.size * 100).toFixed(1)}%) <- this is Nexus's real added value`);
    console.log(`  Old-ONLY (Nexus missed, old baseline has it)   : ${oldOnly}`);
    console.log(`  Neither has it (genuinely unresolvable gap)    : ${neitherHasIt} (${(neitherHasIt / distinctUnresolvedOutlets.size * 100).toFixed(1)}%)\n`);
  } else {
    console.log("(generated-data.json not found — skipping old-baseline comparison)\n");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
