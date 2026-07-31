/**
 * One-off: merge a duplicate NIP into the canonical one for the same person.
 * Written for IBNU SUBARDI (P070068 -> P260266, 2026-07-31 request: "P070068
 * harusnya nip nya P260266") but kept generic/reusable — see internal/TODO.md
 * #1 for the earlier precedent (Anggres Saputra L240075 -> L240076, done by
 * hand at the time).
 *
 * This script is intentionally NOT a blind "rename the primary key" — both
 * NIPs already had real POA data (see docs/ discussion 2026-07-31), including
 * two colliding periods (2026-Q2, 2026-Q3) where BOTH nips had submitted a
 * POA for the same quarter. PoaForm has no @@unique([ownerId, period]), so a
 * plain FK repoint would silently leave the merged NIP owning duplicate POAs
 * for those periods instead of resolving the conflict. Business decision
 * (confirmed by user 2026-07-31): keep P260266's POA for both Q2 and Q3,
 * discard P070068's versions entirely.
 *
 * Since P070068 has ZERO other references anywhere (verified via
 * scripts/_inspectNipMerge.ts before writing this: no MrOutletAssignment, no
 * KpiMonthlyEntry, no ProductTargetAllocation, no subordinates via
 * nipAtasan, no Outlet.coveredByNip, no CustomerPengajuan, and all 24
 * PoaAuditLog rows belong entirely to the 2 POAs being discarded), this
 * reduces to: delete the 2 duplicate POAs (audit logs first — PoaAuditLog
 * has no onDelete:Cascade from PoaForm, unlike PoaLineItem which does), then
 * delete the now-fully-empty P070068 User row.
 *
 * Run: npx tsx scripts/mergeDuplicateNip.ts
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const OLD_NIP = "P070068";
const NEW_NIP = "P260266";
const DISCARD_POA_IDS = [
  "7ee0030d-4808-43fa-b57b-e99ae2d4304d", // P070068's 2026-Q3 (SUBMITTED_TO_NSM v5) — discarded in favor of P260266's
  "9cf320fe-7ae4-4702-bcb0-c1a7cd03df9a", // P070068's 2026-Q2 (DRAFT) — discarded in favor of P260266's
];

async function main() {
  const [oldUser, newUser] = await Promise.all([
    prisma.user.findUnique({ where: { nip: OLD_NIP } }),
    prisma.user.findUnique({ where: { nip: NEW_NIP } }),
  ]);
  if (!oldUser) { console.log(`${OLD_NIP} not found — already merged?`); return; }
  if (!newUser) { console.error(`${NEW_NIP} not found — aborting.`); process.exit(1); }
  console.log(`Merging ${OLD_NIP} (${oldUser.name}) -> ${NEW_NIP} (${newUser.name})\n`);

  // Safety re-check right before mutating — refuse to proceed if reality has
  // drifted from what this script assumes (e.g. someone assigned P070068 an
  // outlet since the investigation, or the discard POAs no longer match).
  const [remainingPoas, otherRefs] = await Promise.all([
    prisma.poaForm.findMany({ where: { ownerId: OLD_NIP }, select: { id: true, period: true } }),
    Promise.all([
      prisma.mrOutletAssignment.count({ where: { nipMR: OLD_NIP } }),
      prisma.kpiMonthlyEntry.count({ where: { nip: OLD_NIP } }),
      prisma.kpiContractEvaluation.count({ where: { OR: [{ nip: OLD_NIP }, { evaluatedByNip: OLD_NIP }] } }),
      prisma.productTargetAllocation.count({ where: { nip: OLD_NIP } }),
      prisma.user.count({ where: { nipAtasan: OLD_NIP } }),
      prisma.outlet.count({ where: { coveredByNip: OLD_NIP } }),
      prisma.customerPengajuan.count({ where: { submittedBy: OLD_NIP } }),
      prisma.poaForm.count({ where: { currentHolderId: OLD_NIP } }),
    ]),
  ]);
  const unexpectedPoas = remainingPoas.filter((p) => !DISCARD_POA_IDS.includes(p.id));
  if (unexpectedPoas.length > 0) {
    console.error("Found PoaForm(s) owned by", OLD_NIP, "not accounted for by this script:", unexpectedPoas);
    process.exit(1);
  }
  const [assignCount, kpiCount, kpiEvalCount, allocCount, subCount, outletCount, custPengajuanCount, holderCount] = otherRefs;
  const otherRefCount = assignCount + kpiCount + kpiEvalCount + allocCount + subCount + outletCount + custPengajuanCount + holderCount;
  if (otherRefCount > 0) {
    console.error(`${OLD_NIP} has ${otherRefCount} other reference(s) this script doesn't handle (assign=${assignCount} kpi=${kpiCount} kpiEval=${kpiEvalCount} alloc=${allocCount} subordinates=${subCount} outletCovered=${outletCount} custPengajuan=${custPengajuanCount} currentHolder=${holderCount}) — aborting, extend the script first.`);
    process.exit(1);
  }

  await prisma.$transaction(async (tx) => {
    // PoaAuditLog has no onDelete:Cascade from PoaForm (PoaLineItem does) —
    // must clear it explicitly before the POA itself can be deleted.
    const deletedLogs = await tx.poaAuditLog.deleteMany({ where: { poaId: { in: DISCARD_POA_IDS } } });
    console.log(`Deleted ${deletedLogs.count} PoaAuditLog rows on the 2 discarded POAs.`);

    const deletedPoas = await tx.poaForm.deleteMany({ where: { id: { in: DISCARD_POA_IDS } } });
    console.log(`Deleted ${deletedPoas.count} PoaForm rows (their PoaLineItems cascaded automatically).`);

    await tx.user.delete({ where: { nip: OLD_NIP } });
    console.log(`Deleted User ${OLD_NIP} — now fully merged into ${NEW_NIP}.`);
  });

  console.log("\nDone. Verify:");
  console.log(`  - ${NEW_NIP} should show exactly 3 PoaForm: 2026-Q2 (DRAFT), 2026-Q3 (SUBMITTED_TO_NSM), 2026-Q4 (DRAFT).`);
  console.log(`  - ${OLD_NIP} should no longer exist anywhere in the app.`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
