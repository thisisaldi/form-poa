/**
 * Investigation script — calls Exodus's core/v1/users/zone-summary/parent
 * and /child against the real API to see whether /child's empty-nip rows
 * genuinely signal a vacant zone, and how zone_type/zone_code map to
 * Outlet's territory/subarea/area/region columns. Read-only, no writes, not
 * wired into any live flow. See getExodusZoneSummaryParent/Child in
 * src/lib/exodusApi.ts and docs/outlet-nexus-migration/01-business-rules.md
 * OQ-1/OQ-3 for the gap this might close.
 *
 * Run: npx tsx scripts/testExodusZoneSummary.ts [nip] [childKeyword]
 */
import { prisma } from "../src/lib/prisma";
import { getExodusZoneSummaryParent, getExodusZoneSummaryChild } from "../src/lib/exodusApi";

async function main() {
  const nipArg = process.argv[2];
  const childKeyword = process.argv[3];

  const sampleNip =
    nipArg ??
    (await prisma.user.findFirst({ where: { role: "ASM", isActive: true }, select: { nip: true } }))?.nip;

  if (sampleNip) {
    console.log(`\n=== zone-summary/parent?nip=${sampleNip} ===`);
    const parentResult = await getExodusZoneSummaryParent({ nip: sampleNip });
    console.log(JSON.stringify(parentResult, null, 2));
  } else {
    console.log("No sample NIP found/given, skipping zone-summary/parent.");
  }

  console.log(`\n=== zone-summary/child?keyword=${childKeyword ?? "(none)"} ===`);
  const childResult = await getExodusZoneSummaryChild({ keyword: childKeyword, limit: 50 });
  if (!childResult) {
    console.log("null (unconfigured, error, or non-2xx — see stderr above)");
    return;
  }
  console.log(`${childResult.length} rows returned`);

  const vacant = childResult.filter((r) => !r.nip);
  console.log(`${vacant.length} row(s) with empty nip (candidate vacant signal):`);
  for (const r of vacant) {
    console.log(`  zone_id=${r.zone_id} zone_code=${r.zone_code} zone_type=${r.zone_type} zone_name=${r.zone_name} name=${r.name}`);
  }

  const distinctTypes = [...new Set(childResult.map((r) => r.zone_type))];
  console.log("Distinct zone_type seen:", distinctTypes);
}

main().finally(() => prisma.$disconnect());
