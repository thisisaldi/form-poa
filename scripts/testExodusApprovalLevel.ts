/**
 * Investigation script (docs/exodus-poa-usage/01-business-rules.md §11) —
 * calls Exodus's GET /promotion/v1/pssp/approval-level for a sample of real
 * PoaLineItem rows to see what `role` values actually come back. CONFIRMED
 * 2026-09-09: values are "asm"/"sm"/"nsm"/"assistant-sales-director"/
 * "sales-director" — the latter two (POA's Role enum has no equivalent)
 * showed up in 35% of a 40-row sample, NOT a rare edge case. Not wired into
 * any live route — read-only, prints results, no writes.
 *
 * pssp_type is sent as a placeholder ("reguler") — PoaLineItem.jenisPssp is
 * always null in production (dead column), real mapping still unconfirmed.
 *
 * Run: npx tsx scripts/testExodusApprovalLevel.ts [sampleSize]
 */
import { prisma } from "../src/lib/prisma";
import { getExodusApprovalLevel } from "../src/lib/exodusApi";
import { expandPeriodeMonths } from "../src/lib/poaUtils";

// "YYYYMM" -> "YYYY-MM-01" (start) or "YYYY-MM-<lastDay>" (end) — API wants
// YYYY-MM-DD (confirmed 2026-09-09 by testing: YYYYMM 500s with "invalid
// start_period, expected YYYY-MM-DD").
function toDateStr(yyyymm: string, end: boolean): string {
  const year = parseInt(yyyymm.slice(0, 4), 10);
  const month = parseInt(yyyymm.slice(4, 6), 10);
  const day = end ? new Date(year, month, 0).getDate() : 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function main() {
  const sampleSize = parseInt(process.argv[2] ?? "20", 10);

  const items = await prisma.poaLineItem.findMany({
    where: { kodeCust: { not: null }, kodePI: { not: null } },
    select: {
      id: true, kodeCust: true, kodePI: true, jenisPssp: true,
      periodeAwal: true, lamaPeriode: true, rencanaTotalBiaya: true, persenPsspDokter: true,
      poa: { select: { ownerId: true } },
    },
    take: sampleSize,
    orderBy: { createdAt: "desc" },
  });

  if (items.length === 0) {
    console.log("No PoaLineItem rows with kodeCust/kodePI/jenisPssp found.");
    return;
  }

  const rolesSeen = new Set<string>();
  for (const it of items) {
    const months = expandPeriodeMonths(it.periodeAwal, it.lamaPeriode);
    const startPeriod = toDateStr(months[0], false);
    const endPeriod = toDateStr(months[months.length - 1], true);
    const result = await getExodusApprovalLevel({
      startPeriod,
      endPeriod,
      rPercentage: it.persenPsspDokter != null ? parseFloat(it.persenPsspDokter.toString()) : 0,
      givenValue: parseFloat(it.rencanaTotalBiaya.toString()),
      // jenisPssp is always null in production data (dead column, same
      // pattern as PoaLineItem.nilaiR) — "reguler" is an UNCONFIRMED
      // placeholder just to get a 200 for this investigation, not a real
      // mapping decision.
      psspType: it.jenisPssp ?? "reguler",
      customerCode: it.kodeCust!,
      outletCode: it.kodePI!,
      nip: it.poa.ownerId,
    });
    console.log(`item ${it.id} (${it.kodePI}/${it.kodeCust}, ${it.jenisPssp}) -> `, result);
    if (result?.role) rolesSeen.add(result.role);
  }

  console.log("\nDistinct roles seen:", [...rolesSeen]);
  console.log("Includes asd/sd?", [...rolesSeen].some((r) => ["asd", "sd"].includes(r.toLowerCase())));
}

main().finally(() => prisma.$disconnect());
