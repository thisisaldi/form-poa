/**
 * One-off: merge duplicate NIP for ALFRED PATUNRUI (2026-09-22 request) —
 * his NIP changed at the Nexus/HR source from 973066 (old) to L260498 (new,
 * already active and correctly wired via the daily org sync: currentHolder
 * on 16 PoaForm + 101 PoaDoctorApproval, 3 subordinates report to it,
 * nipAtasan already P200134/SD). 973066 was left behind as an orphaned
 * duplicate — confirmed via _inspectAlfredNipMerge-style check (see chat)
 * to have ZERO references anywhere EXCEPT 277 PoaAuditLog rows (actorId),
 * his genuine historical activity log under the old NIP.
 *
 * Unlike scripts/mergeDuplicateNip.ts (which discarded conflicting POA
 * data), there's no conflict to resolve here — just repoint the audit log
 * rows to the live NIP, then delete the now-fully-empty old User row. User
 * explicitly asked NOT to delete the original data (the audit history),
 * only the empty duplicate shell.
 *
 * Run: npx tsx scripts/mergeAlfredPatunruiNip.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const OLD_NIP = "973066";
const NEW_NIP = "L260498";

async function main() {
  const [oldUser, newUser] = await Promise.all([
    prisma.user.findUnique({ where: { nip: OLD_NIP } }),
    prisma.user.findUnique({ where: { nip: NEW_NIP } }),
  ]);
  if (!oldUser) { console.log(`${OLD_NIP} not found — already merged?`); return; }
  if (!newUser) { console.error(`${NEW_NIP} not found — aborting.`); process.exit(1); }
  console.log(`Merging ${OLD_NIP} (${oldUser.name}) -> ${NEW_NIP} (${newUser.name})`);

  // Safety re-check right before mutating — refuse if anything besides the
  // expected audit-log rows has appeared under the old NIP since investigation.
  const [poaOwned, poaHolder, doctorApprovalHolder, subordinates, auditLogCount] = await Promise.all([
    prisma.poaForm.count({ where: { ownerId: OLD_NIP } }),
    prisma.poaForm.count({ where: { currentHolderId: OLD_NIP } }),
    prisma.poaDoctorApproval.count({ where: { currentHolderId: OLD_NIP } }),
    prisma.user.count({ where: { nipAtasan: OLD_NIP } }),
    prisma.poaAuditLog.count({ where: { actorId: OLD_NIP } }),
  ]);
  if (poaOwned || poaHolder || doctorApprovalHolder || subordinates) {
    console.error("Unexpected references beyond PoaAuditLog — aborting, investigate manually.", {
      poaOwned, poaHolder, doctorApprovalHolder, subordinates,
    });
    process.exit(1);
  }
  console.log(`PoaAuditLog rows to repoint: ${auditLogCount}`);

  await prisma.$transaction([
    prisma.poaAuditLog.updateMany({ where: { actorId: OLD_NIP }, data: { actorId: NEW_NIP } }),
    prisma.user.delete({ where: { nip: OLD_NIP } }),
  ]);

  console.log(`Done — ${OLD_NIP} deleted, ${auditLogCount} PoaAuditLog rows now under ${NEW_NIP}.`);
}

main().finally(() => prisma.$disconnect());
