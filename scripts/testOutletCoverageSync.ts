/**
 * Self-check for outletCoverageSync.ts's resolveLiveCoverage — the
 * walk-up-until-active-ancestor logic behind Outlet.coveredByNip/coveredByRole.
 * Run: npx tsx scripts/testOutletCoverageSync.ts
 */
import assert from "node:assert";
import { resolveLiveCoverage } from "../src/lib/sync/outletCoverageSync";

type U = { nip: string; role: string; isActive: boolean; nipAtasan: string | null };

const users = new Map<string, U>([
  ["MR1", { nip: "MR1", role: "MR", isActive: true, nipAtasan: "ASM1" }],
  ["ASM1", { nip: "ASM1", role: "ASM", isActive: true, nipAtasan: "SM1" }],
  ["SM1", { nip: "SM1", role: "SM", isActive: true, nipAtasan: "NSM1" }],
  ["NSM1", { nip: "NSM1", role: "NSM", isActive: true, nipAtasan: null }],

  // Real case this was built for: vacant MR under an active ASM.
  ["MRvacant", { nip: "MRvacant", role: "MR", isActive: false, nipAtasan: "ASM1" }],

  // Cascading vacancy: MR and ASM both vacant — SM should cover.
  ["MRvacant2", { nip: "MRvacant2", role: "MR", isActive: false, nipAtasan: "ASMvacant" }],
  ["ASMvacant", { nip: "ASMvacant", role: "ASM", isActive: false, nipAtasan: "SM1" }],

  // Self-referencing loop must not hang.
  ["Loopy", { nip: "Loopy", role: "MR", isActive: false, nipAtasan: "Loopy" }],
]);

// Active MR covers their own outlet.
assert.deepStrictEqual(resolveLiveCoverage("MR1", users), { nip: "MR1", role: "MR" });

// Vacant MR — cascades up to their active ASM.
assert.deepStrictEqual(resolveLiveCoverage("MRvacant", users), { nip: "ASM1", role: "ASM" });

// Vacant MR AND vacant ASM — cascades past both, up to the active SM.
assert.deepStrictEqual(resolveLiveCoverage("MRvacant2", users), { nip: "SM1", role: "SM" });

// Unknown nip (not in the map at all) — unresolvable.
assert.strictEqual(resolveLiveCoverage("NoSuchNip", users), null);

// Self-referencing chain never terminates on an active user — unresolvable, must not hang.
assert.strictEqual(resolveLiveCoverage("Loopy", users), null);

console.log("resolveLiveCoverage: all assertions passed");
