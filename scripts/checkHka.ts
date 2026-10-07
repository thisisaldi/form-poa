/** Cek cepat logika approval HKA (docs/poa-standarisasi-pusat/01-business-rules.md §4): npx tsx scripts/checkHka.ts */
import assert from "node:assert/strict";
import { canApprovePusatLevel, hkaCreatorLevel, isAutoApprovedLevel } from "../src/lib/hka";
import { discountApprovalLevel, levelsUpTo } from "../src/lib/discountApprovalLevel";

const auto = (role: string, pct: number) => {
  const c = hkaCreatorLevel(role);
  return levelsUpTo(discountApprovalLevel(pct)).filter((l) => !isAutoApprovedLevel(l, c));
};

assert.deepEqual(auto("NSM", 20), []); // NSM: sampai 20% langsung approved
assert.deepEqual(auto("NSM", 25), ["ASD"]); // >20% butuh ASD
assert.deepEqual(auto("NSM", 35), ["ASD", "SD"]);
assert.deepEqual(auto("GM", 30), []); // ASD: sampai 30% langsung approved
assert.deepEqual(auto("GM", 31), ["SD"]);
assert.deepEqual(auto("MR", 0), ["ASM"]); // tanpa level pembuat: tidak ada auto

assert.equal(canApprovePusatLevel({ nip: "972977", role: "GM" }, "ASD"), true);
assert.equal(canApprovePusatLevel({ nip: "P240249", role: "NSM" }, "ASD"), false); // Widodo tak bisa approve level ASD
assert.equal(canApprovePusatLevel({ nip: "P200134", role: "SD" }, "SD"), true);
console.log("checkHka OK");
