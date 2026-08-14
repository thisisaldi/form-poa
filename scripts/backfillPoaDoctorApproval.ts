/**
 * One-time backfill for docs/poa-per-doctor-approval/ (2026-08-13) — every
 * PoaForm that was ever submitted (status != DRAFT) before this migration
 * has no PoaDoctorApproval rows yet. Without this, approveDoctor/rejectDoctor
 * etc. (which require an existing row per doctor — see canApproveDoctor in
 * authz.ts) would have nothing to act on for already-in-flight POAs, leaving
 * ASM/SM/NSM unable to approve/reject anything submitted before this deploy.
 *
 * For each such PoaForm, creates ONE PoaDoctorApproval per distinct doctor
 * (kodePI, namaCust) among its line items, copying the PARENT PoaForm's own
 * status/currentHolderId/version — this is the correct starting point since,
 * before this migration, every doctor in a draft always shared exactly one
 * status (the whole-draft model this feature replaces). From this point
 * forward each doctor's status can diverge independently.
 *
 * Idempotent: skips any PoaForm that already has ≥1 PoaDoctorApproval row
 * (either a prior partial run, or a POA that already went through the new
 * per-doctor submit flow) — safe to re-run.
 *
 * Run: npx tsx scripts/backfillPoaDoctorApproval.ts
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { PoaStatus } from "@prisma/client";

async function main() {
  const candidates = await prisma.poaForm.findMany({
    where: { status: { not: PoaStatus.DRAFT } },
    select: {
      id: true, status: true, currentHolderId: true, version: true,
      items: { select: { kodePI: true, namaCust: true } },
      doctorApprovals: { select: { id: true }, take: 1 },
    },
  });

  let poasBackfilled = 0;
  let rowsCreated = 0;
  let poasSkippedAlreadyBackfilled = 0;
  let poasSkippedNoDoctors = 0;

  for (const poa of candidates) {
    if (poa.doctorApprovals.length > 0) { poasSkippedAlreadyBackfilled++; continue; }

    const doctorKeys = new Map<string, { kodePI: string; namaCust: string }>();
    for (const it of poa.items) {
      if (!it.kodePI) continue;
      doctorKeys.set(`${it.kodePI}|${it.namaCust}`, { kodePI: it.kodePI, namaCust: it.namaCust });
    }
    if (doctorKeys.size === 0) { poasSkippedNoDoctors++; continue; }

    await prisma.poaDoctorApproval.createMany({
      data: [...doctorKeys.values()].map(({ kodePI, namaCust }) => ({
        poaId: poa.id,
        kodePI,
        namaCust,
        status: poa.status,
        currentHolderId: poa.currentHolderId,
        version: poa.version,
      })),
    });
    poasBackfilled++;
    rowsCreated += doctorKeys.size;
  }

  console.log(`Backfilled ${poasBackfilled} POA(s), created ${rowsCreated} PoaDoctorApproval row(s).`);
  console.log(`Skipped ${poasSkippedAlreadyBackfilled} already-backfilled, ${poasSkippedNoDoctors} with no doctors (no kodePI on any line item).`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
