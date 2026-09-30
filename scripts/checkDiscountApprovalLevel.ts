/** Run: npx tsx scripts/checkDiscountApprovalLevel.ts — batas persen level approval DPL/DPF. */
import assert from "node:assert/strict";
import { discountApprovalLevel as lv } from "../src/lib/discountApprovalLevel";

assert.equal(lv(0), "ASM");
assert.equal(lv(5), "ASM");
assert.equal(lv(5.01), "SM");
assert.equal(lv(10), "SM");
assert.equal(lv(10.01), "NSM");
assert.equal(lv(20), "NSM");
assert.equal(lv(20.01), "ASD");
assert.equal(lv(30), "ASD");
assert.equal(lv(30.01), "SD");
console.log("ok");
