/**
 * Self-check for the ASD/SD conditional escalation logic in poaWorkflow.ts
 * (docs/exodus-poa-usage/01-business-rules.md §11) — approvalCeiling() and
 * approveNsmOrAsd(). Most important invariant: null/unrecognized
 * exodusRequiredRole MUST behave exactly like before this feature existed
 * (chain terminates at NSM) — 100% of pre-existing PoaDoctorApproval rows
 * have this field null, so a regression here breaks approval for every POA
 * in production, not just Exodus-relevant ones.
 *
 * Run: npx tsx scripts/testApprovalCeilingChain.ts
 */
import assert from "node:assert";
import { PoaStatus } from "@prisma/client";
import { approvalCeiling, approveAtLevel } from "../src/lib/poaWorkflow";

// Backward-compat: null/unrecognized -> ceiling NSM, terminates at NSM.
assert.strictEqual(approvalCeiling(null), "NSM");
assert.strictEqual(approvalCeiling("something-unrecognized"), "NSM");
assert.strictEqual(approvalCeiling("nsm"), "NSM");
assert.deepStrictEqual(approveAtLevel("NSM", approvalCeiling(null)), {
  toStatus: PoaStatus.APPROVED_BY_NSM,
  nextHolderRole: null,
});

// Exodus's real role slugs escalate correctly.
assert.strictEqual(approvalCeiling("assistant-sales-director"), "ASD");
assert.strictEqual(approvalCeiling("sales-director"), "SD");

// ceiling ASD: NSM approve -> continues to ASD; ASD approve -> terminates.
assert.deepStrictEqual(approveAtLevel("NSM", "ASD"), {
  toStatus: PoaStatus.SUBMITTED_TO_ASD,
  nextHolderRole: "ASD",
});
assert.deepStrictEqual(approveAtLevel("ASD", "ASD"), {
  toStatus: PoaStatus.APPROVED_BY_ASD,
  nextHolderRole: null,
});

// ceiling SD: NSM approve -> ASD; ASD approve -> continues to SD (not terminal).
assert.deepStrictEqual(approveAtLevel("NSM", "SD"), {
  toStatus: PoaStatus.SUBMITTED_TO_ASD,
  nextHolderRole: "ASD",
});
assert.deepStrictEqual(approveAtLevel("ASD", "SD"), {
  toStatus: PoaStatus.SUBMITTED_TO_SD,
  nextHolderRole: "SD",
});

// 2026-09-22: ceiling can now be ASM or SM too — Exodus saying "asm"/"sm"
// means fully approved as soon as THAT level signs off, no forced climb to
// NSM. approvalCeiling mapping:
assert.strictEqual(approvalCeiling("asm"), "ASM");
assert.strictEqual(approvalCeiling("sm"), "SM");
// ceiling ASM: ASM approve terminates immediately (never reaches SM/NSM).
assert.deepStrictEqual(approveAtLevel("ASM", "ASM"), {
  toStatus: PoaStatus.APPROVED_BY_ASM,
  nextHolderRole: null,
});
// ceiling SM: ASM approve still continues to SM (ASM < SM); SM approve terminates.
assert.deepStrictEqual(approveAtLevel("ASM", "SM"), {
  toStatus: PoaStatus.SUBMITTED_TO_SM,
  nextHolderRole: "SM",
});
assert.deepStrictEqual(approveAtLevel("SM", "SM"), {
  toStatus: PoaStatus.APPROVED_BY_SM,
  nextHolderRole: null,
});

console.log("approvalCeiling/approveAtLevel: all assertions passed");
