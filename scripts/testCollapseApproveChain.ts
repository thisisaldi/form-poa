/**
 * Self-check for collapseApproveChain (poaWorkflow.ts, 2026-09-22) — skips a
 * pending ASD/SD-etc. level when the SAME PERSON would hold the level right
 * after it too (e.g. an NSM whose reportsTo goes straight to SD, no GM in
 * between — Alfred Patunrui's real case, see docs/exodus-poa-usage/
 * 01-business-rules.md §11). Uses fake in-memory reportsTo chains, no DB.
 *
 * Run: npx tsx scripts/testCollapseApproveChain.ts
 */
import assert from "node:assert";
import { PoaStatus } from "@prisma/client";
import { collapseApproveChain } from "../src/lib/poaWorkflow";

function fakeUser(nip: string, role: string, reportsTo: any = null) {
  return { nip, role, isActive: true, reportsTo } as any;
}

function fakePoa(ownerReportsTo: any) {
  return { owner: { reportsTo: ownerReportsTo } } as any;
}

// Case 1 (Alfred/Brian): NSM's reportsTo goes STRAIGHT to SD, no GM/ASD
// in between — ceiling SD. Old approveAtLevel alone would land on
// SUBMITTED_TO_ASD/holder=Brian, then SUBMITTED_TO_SD/holder=Brian too
// (2 separate approve clicks by the same person). Collapsed: should skip
// straight to SUBMITTED_TO_SD in one hop from the NSM-approve action.
{
  const brian = fakeUser("P200134", "SD");
  const poa = fakePoa(brian); // owner -> SD directly, no GM
  const result = collapseApproveChain(poa, "NSM", "SD");
  assert.deepStrictEqual(result, { toStatus: PoaStatus.SUBMITTED_TO_SD, nextHolderRole: "SD" });
}

// Case 2: normal chain WITH a real, distinct GM in between — must NOT
// collapse (GM and SD are different people, each gets their own step).
{
  const brian = fakeUser("P200134", "SD");
  const gm = fakeUser("P030132", "GM", brian);
  const poa = fakePoa(gm);
  const result = collapseApproveChain(poa, "NSM", "SD");
  assert.deepStrictEqual(result, { toStatus: PoaStatus.SUBMITTED_TO_ASD, nextHolderRole: "ASD" });
}

// Case 3: ceiling ASD only (not SD) — GM approves and that's terminal,
// nothing to peek past (ASD's "after" step doesn't exist for this ceiling).
{
  const brian = fakeUser("P200134", "SD");
  const gm = fakeUser("P030132", "GM", brian);
  const poa = fakePoa(gm);
  const result = collapseApproveChain(poa, "NSM", "ASD");
  assert.deepStrictEqual(result, { toStatus: PoaStatus.SUBMITTED_TO_ASD, nextHolderRole: "ASD" });
}

// Case 4: hierarchy broken (no reportsTo at all, e.g. NSM.nipAtasan null) —
// holder resolves to null, collapseApproveChain must NOT throw itself (that's
// applyDoctorTransition's job downstream); just returns the step as-is so the
// normal "cannot resolve next holder" error still fires where it always did.
{
  const poa = fakePoa(null);
  const result = collapseApproveChain(poa, "NSM", "SD");
  assert.deepStrictEqual(result, { toStatus: PoaStatus.SUBMITTED_TO_ASD, nextHolderRole: "ASD" });
}

// Case 5: ceiling ASM, same-person collapse doesn't even apply (approveAtLevel
// terminates immediately, no nextHolderRole to peek past) — unaffected.
{
  const poa = fakePoa(null);
  const result = collapseApproveChain(poa, "ASM", "ASM");
  assert.deepStrictEqual(result, { toStatus: PoaStatus.APPROVED_BY_ASM, nextHolderRole: null });
}

console.log("collapseApproveChain: all assertions passed");

// Case 6: ceiling ASD ONLY (not SD) — Brian happens to sit at the ASD slot
// too (vacant GM), but the recorded status must stay APPROVED_BY_ASD, never
// APPROVED_BY_SD — status reflects the doctor's ceiling, not the approver's
// own personal role. No collapse triggers either (nothing after ASD to
// compare against when ceiling stops at ASD).
{
  const brian = fakeUser("P200134", "SD");
  const poa = fakePoa(brian);
  const step1 = collapseApproveChain(poa, "NSM", "ASD");
  assert.deepStrictEqual(step1, { toStatus: PoaStatus.SUBMITTED_TO_ASD, nextHolderRole: "ASD" });
  const step2 = collapseApproveChain(poa, "ASD", "ASD");
  assert.deepStrictEqual(step2, { toStatus: PoaStatus.APPROVED_BY_ASD, nextHolderRole: null });
}

console.log("case 6 (ceiling ASD only, Brian at ASD slot): all assertions passed");
