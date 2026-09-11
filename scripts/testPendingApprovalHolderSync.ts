/**
 * Self-check for resolveLivePendingHolder (pendingApprovalHolderSync.ts) —
 * the chain-walk that re-resolves a stale PoaDoctorApproval.currentHolderId
 * from CURRENT org structure (2026-09-11 bug fix).
 *
 * Run: npx tsx scripts/testPendingApprovalHolderSync.ts
 */
import assert from "node:assert";
import { resolveLivePendingHolder } from "../src/lib/sync/pendingApprovalHolderSync";

type U = { nip: string; role: string; isActive: boolean; nipAtasan: string | null };

const users = new Map<string, U>([
  ["MR1", { nip: "MR1", role: "MR", isActive: true, nipAtasan: "ASM_OLD" }],
  // Old ASM still active elsewhere, but no longer this MR's manager.
  ["ASM_OLD", { nip: "ASM_OLD", role: "ASM", isActive: true, nipAtasan: "SM1" }],
  ["ASM_NEW", { nip: "ASM_NEW", role: "ASM", isActive: true, nipAtasan: "SM1" }],
  ["SM1", { nip: "SM1", role: "SM", isActive: true, nipAtasan: "NSM1" }],
  ["NSM1", { nip: "NSM1", role: "NSM", isActive: true, nipAtasan: null }],
  ["ASM_INACTIVE", { nip: "ASM_INACTIVE", role: "ASM", isActive: false, nipAtasan: "SM1" }],
]);

// Reassigned structure: MR's manager changed from ASM_OLD to ASM_NEW —
// resolveLivePendingHolder must follow the CURRENT chain (start at
// ASM_NEW, not ASM_OLD).
assert.strictEqual(resolveLivePendingHolder("ASM_NEW", 1 /* ASM level */, users), "ASM_NEW");

// Vacant level (inactive ASM) — skips up to SM, same "vacant just gets
// skipped" behavior as resolveNextHolder in poaWorkflow.ts.
assert.strictEqual(resolveLivePendingHolder("ASM_INACTIVE", 1, users), "SM1");

// Dead-end chain (unknown nip) -> null, not a throw.
assert.strictEqual(resolveLivePendingHolder("GHOST_NIP", 1, users), null);

// null start (no atasan at all) -> null.
assert.strictEqual(resolveLivePendingHolder(null, 1, users), null);

// Target level ASD (4) with nobody above SM (level 2) in this fixture -> null.
assert.strictEqual(resolveLivePendingHolder("ASM_NEW", 4, users), null);

console.log("resolveLivePendingHolder: all assertions passed");
