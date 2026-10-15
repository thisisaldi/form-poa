/** Run: npx tsx scripts/testCensorName.ts */
import assert from "node:assert";
import { censorName } from "../src/lib/censorName";

assert.strictEqual(censorName("Lina Kartika"), "L**** K****");
assert.strictEqual(censorName("  budi   santoso  "), "B**** S****");
assert.strictEqual(censorName("A"), "A****"); // 1 huruf tidak bocor jadi nama pendek
assert.strictEqual(censorName("Al"), censorName("Alexandria")); // panjang tidak terbaca
assert.strictEqual(censorName(null), "");
// Gelar dibuang, cuma nama orang yang disensor (pola dari data Customer).
for (const [raw, want] of [
  ["dr. Ahmad Fauzi", "A**** F****"],
  ["DR LUSIANA J CITOYUWONO", "L**** J**** C****"],
  ["Dr.dr. Khairul Putra Surbakti, Sp.S(K)", "K**** P**** S****"],
  ["LUSIANA J CITOYUWONO SpKJ, DR", "L**** J**** C****"],
  ["dr.Fakhri Widyanto, M.Ked(Ped), Sp.A", "F**** W****"],
  ["drg. Budi Santoso", "B**** S****"],
  ["Ahmad Fauzi, Sp.PD", "A**** F****"],
  ["dr Edwin Chandra sp jp", "E**** C****"],
  ["DIAN ANGGRAENI DR", "D**** A****"],
  ["dr, arif nur widodo,Sp. PD-KGEH", "A**** N**** W****"],
  ["M. Hanif", "M**** H****"], // "M." = inisial, bukan gelar
  ["dr.", "D****"], // semuanya gelar: jangan jadi kosong
] as const) assert.strictEqual(censorName(raw), want, raw);
console.log("testCensorName: ok");

import { censorActivityDetail } from "../src/lib/poaStandarisasiActivity";
assert.strictEqual(censorActivityDetail("TTD_DOKTER", "Lina Kartika — Paracetamol"), "L**** K**** — Paracetamol");
assert.strictEqual(censorActivityDetail("GANTI_DOKTER", "Lina Kartika → Budi Santoso (cuti)"), "L**** K**** → B**** S**** (cuti)");
assert.strictEqual(censorActivityDetail("DPL_DPF_DIKIRIM", "DPL — D01 — Obat"), "DPL — D01 — Obat");
assert.strictEqual(censorActivityDetail("TTD_DOKTER", null), "");
console.log("testCensorActivityDetail: ok");
