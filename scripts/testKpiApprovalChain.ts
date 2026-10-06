/** Run: npx tsx scripts/testKpiApprovalChain.ts — self-check for src/lib/kpiApproval.ts */
import assert from "node:assert/strict";
import { actionFor, chainFor, evaluatorFor, isFullyApproved, statusText } from "../src/lib/kpiApproval";

assert.deepEqual(chainFor("MR"), ["ASM", "SM", "NSM"]);
assert.deepEqual(chainFor("ASM"), ["SM", "NSM"]);
assert.deepEqual(chainFor("SM"), ["NSM"]);
assert.equal(evaluatorFor("MR"), "SM");
assert.equal(evaluatorFor("SM"), "NSM");

// not evaluated: only the evaluator (or ADMIN) may evaluate; SD / ASM / MR may not
assert.deepEqual(actionFor("SM", "MR", null), { kind: "evaluasi", step: "SM" });
assert.equal(actionFor("ASM", "MR", null), null);
assert.equal(actionFor("SD", "MR", null), null);
assert.equal(actionFor("NSM", "MR", null), null);
assert.deepEqual(actionFor("NSM", "SM", null), { kind: "evaluasi", step: "NSM" });
assert.deepEqual(actionFor("ADMIN", "MR", null), { kind: "evaluasi", step: "SM" });

// evaluated by SM for an MR → ASM and NSM still pending; SM cannot approve twice
const afterSm = { SM: 1 };
assert.equal(statusText("MR", null), "Belum dievaluasi");
assert.equal(statusText("MR", afterSm), "Disetujui SM, menunggu ASM & NSM");
assert.equal(actionFor("SM", "MR", afterSm), null);
assert.deepEqual(actionFor("ASM", "MR", afterSm), { kind: "approve", step: "ASM" });
assert.deepEqual(actionFor("NSM", "MR", afterSm), { kind: "approve", step: "NSM" }); // no forced order
assert.equal(actionFor("SD", "MR", afterSm), null);
assert.deepEqual(actionFor("ADMIN", "MR", afterSm), { kind: "approve", step: "ASM" });

// complete
const full = { SM: 1, ASM: 1, NSM: 1 };
assert.equal(isFullyApproved(chainFor("MR"), full), true);
assert.equal(isFullyApproved(chainFor("MR"), afterSm), false);
assert.equal(isFullyApproved(chainFor("MR"), null), false);
assert.equal(statusText("MR", full), "Disetujui lengkap");
assert.equal(actionFor("ADMIN", "MR", full), null);
// SM evaluated by NSM → done in one step
assert.equal(isFullyApproved(chainFor("SM"), { NSM: 1 }), true);

// vacant levels: SM absent above an MR (real case in staging: MR → ASM → NSM)
const noSm = new Set(["ASM", "NSM"]);
assert.deepEqual(chainFor("MR", noSm), ["ASM", "NSM"]);
assert.equal(evaluatorFor("MR", noSm), "NSM"); // NSM fills in for the vacant SM
assert.deepEqual(actionFor("NSM", "MR", null, noSm), { kind: "evaluasi", step: "NSM" });
assert.equal(actionFor("SM", "MR", null, noSm), null);
assert.equal(statusText("MR", { NSM: 1 }, noSm), "Disetujui NSM, menunggu ASM");
assert.equal(isFullyApproved(chainFor("MR", noSm), { NSM: 1, ASM: 1 }), true); // no SM step to wait for
assert.equal(evaluatorFor("SM", new Set()), null); // nobody above an SM
assert.equal(actionFor("NSM", "SM", null, new Set()), null);
assert.deepEqual(actionFor("ADMIN", "SM", null, new Set()), { kind: "evaluasi", step: null });
console.log("kpiApproval: all checks passed");
