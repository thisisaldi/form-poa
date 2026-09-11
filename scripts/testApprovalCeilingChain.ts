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
import { approvalCeiling, approveNsmOrAsd } from "../src/lib/poaWorkflow";

// Backward-compat: null/unrecognized -> ceiling NSM, terminates at NSM.
assert.strictEqual(approvalCeiling(null), "NSM");
assert.strictEqual(approvalCeiling("something-unrecognized"), "NSM");
assert.strictEqual(approvalCeiling("nsm"), "NSM");
assert.deepStrictEqual(approveNsmOrAsd("NSM", approvalCeiling(null)), {
  toStatus: PoaStatus.APPROVED_BY_NSM,
  nextHolderRole: null,
});

// Exodus's real role slugs escalate correctly.
assert.strictEqual(approvalCeiling("assistant-sales-director"), "ASD");
assert.strictEqual(approvalCeiling("sales-director"), "SD");

// ceiling ASD: NSM approve -> continues to ASD; ASD approve -> terminates.
assert.deepStrictEqual(approveNsmOrAsd("NSM", "ASD"), {
  toStatus: PoaStatus.SUBMITTED_TO_ASD,
  nextHolderRole: "ASD",
});
assert.deepStrictEqual(approveNsmOrAsd("ASD", "ASD"), {
  toStatus: PoaStatus.APPROVED_BY_ASD,
  nextHolderRole: null,
});

// ceiling SD: NSM approve -> ASD; ASD approve -> continues to SD (not terminal).
assert.deepStrictEqual(approveNsmOrAsd("NSM", "SD"), {
  toStatus: PoaStatus.SUBMITTED_TO_ASD,
  nextHolderRole: "ASD",
});
assert.deepStrictEqual(approveNsmOrAsd("ASD", "SD"), {
  toStatus: PoaStatus.SUBMITTED_TO_SD,
  nextHolderRole: "SD",
});

console.log("approvalCeiling/approveNsmOrAsd: all assertions passed");
