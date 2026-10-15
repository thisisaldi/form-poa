/** Run: npx tsx scripts/testCensorName.ts */
import assert from "node:assert";
import { censorName } from "../src/lib/censorName";

assert.strictEqual(censorName("Lina Kartika"), "L**** K****");
assert.strictEqual(censorName("  budi   santoso  "), "B**** S****");
assert.strictEqual(censorName("A"), "A****"); // 1 huruf tidak bocor jadi nama pendek
assert.strictEqual(censorName("Al"), censorName("Alexandria")); // panjang tidak terbaca
assert.strictEqual(censorName(null), "");
console.log("testCensorName: ok");

import { censorActivityDetail } from "../src/lib/poaStandarisasiActivity";
assert.strictEqual(censorActivityDetail("TTD_DOKTER", "Lina Kartika — Paracetamol"), "L**** K**** — Paracetamol");
assert.strictEqual(censorActivityDetail("GANTI_DOKTER", "Lina Kartika → Budi Santoso (cuti)"), "L**** K**** → B**** S**** (cuti)");
assert.strictEqual(censorActivityDetail("DPL_DPF_DIKIRIM", "DPL — D01 — Obat"), "DPL — D01 — Obat");
assert.strictEqual(censorActivityDetail("TTD_DOKTER", null), "");
console.log("testCensorActivityDetail: ok");
