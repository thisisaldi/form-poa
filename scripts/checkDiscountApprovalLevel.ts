/** Run: npx tsx scripts/checkDiscountApprovalLevel.ts — batas persen level approval + urutan approval per produk. */
import assert from "node:assert/strict";
import { actionableRows, discountApprovalLevel as lv, levelsUpTo, type ProdukApprovalRow } from "../src/lib/discountApprovalLevel";

assert.equal(lv(0), "ASM");
assert.equal(lv(5), "ASM");
assert.equal(lv(5.01), "SM");
assert.equal(lv(10), "SM");
assert.equal(lv(10.01), "NSM");
assert.equal(lv(20), "NSM");
assert.equal(lv(20.01), "ASD");
assert.equal(lv(30), "ASD");
assert.equal(lv(30.01), "SD");
assert.deepEqual(levelsUpTo("ASM"), ["ASM"]);
assert.deepEqual(levelsUpTo("NSM"), ["ASM", "SM", "NSM"]);
assert.deepEqual(levelsUpTo("SD"), ["ASM", "SM", "NSM", "ASD", "SD"]);

// Urutan per produk: A butuh sampai SM, B sampai ASD. Level N hanya setelah N-1 DISETUJUI.
const rows: ProdukApprovalRow[] = [
  ...levelsUpTo("SM").map((level) => ({ produkId: "A", level, status: "MENUNGGU" })),
  ...levelsUpTo("ASD").map((level) => ({ produkId: "B", level, status: "MENUNGGU" })),
];
assert.deepEqual(actionableRows(rows, "ASM").map((r) => r.produkId), ["A", "B"]);
assert.deepEqual(actionableRows(rows, "SM"), []); // ASM belum
for (const r of rows) if (r.level === "ASM") r.status = "DISETUJUI";
assert.deepEqual(actionableRows(rows, "SM").map((r) => r.produkId), ["A", "B"]);
assert.deepEqual(actionableRows(rows, "NSM"), []);
for (const r of rows) if (r.level === "SM") r.status = "DISETUJUI";
assert.deepEqual(actionableRows(rows, "NSM").map((r) => r.produkId), ["B"]); // A sudah selesai di SM
assert.deepEqual(actionableRows(rows, "ASD"), []);
rows.find((r) => r.produkId === "B" && r.level === "NSM")!.status = "DITOLAK";
assert.deepEqual(actionableRows(rows, "ASD"), []); // ditolak menahan level di atasnya
console.log("ok");
