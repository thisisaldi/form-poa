/** Run: npx tsx scripts/testCensorName.ts */
import assert from "node:assert";
import { censorName, VISIBLE_LETTERS } from "../src/lib/censorName";
import { censorActivityDetail } from "../src/lib/poaStandarisasiActivity";

assert.strictEqual(VISIBLE_LETTERS, 2, "skema uji coba: 2 huruf depan");

// 2 huruf depan + 4 bintang tetap per kata.
assert.strictEqual(censorName("Lina Kartika"), "LI**** KA****");
assert.strictEqual(censorName("  budi   santoso  "), "BU**** SA****");
assert.strictEqual(censorName("Alexandria"), "AL****"); // panjang tidak terbaca
assert.strictEqual(censorName("Al"), "AL****");
assert.strictEqual(censorName("A"), "A****"); // kata 1 huruf tidak melebihi hurufnya
assert.strictEqual(censorName(null), "");

// Gelar dibuang, cuma nama orang yang disensor (pola dari data Customer).
for (const [raw, want] of [
  ["dr. Ahmad Fauzi", "AH**** FA****"],
  ["DR LUSIANA J CITOYUWONO", "LU**** J**** CI****"],
  ["Dr.dr. Khairul Putra Surbakti, Sp.S(K)", "KH**** PU**** SU****"],
  ["LUSIANA J CITOYUWONO SpKJ, DR", "LU**** J**** CI****"],
  ["dr.Fakhri Widyanto, M.Ked(Ped), Sp.A", "FA**** WI****"],
  ["drg. Budi Santoso", "BU**** SA****"],
  ["Ahmad Fauzi, Sp.PD", "AH**** FA****"],
  ["dr Edwin Chandra sp jp", "ED**** CH****"],
  ["DIAN ANGGRAENI DR", "DI**** AN****"],
  ["dr, arif nur widodo,Sp. PD-KGEH", "AR**** NU**** WI****"],
  ["M. Hanif", "M**** HA****"], // "M." = inisial, bukan gelar
  ["dr.", "DR****"], // semuanya gelar: jangan jadi kosong
] as const) assert.strictEqual(censorName(raw), want, raw);

// Detail riwayat aktivitas (format dari poaStandarisasi.ts).
assert.strictEqual(censorActivityDetail("TTD_DOKTER", "Lina Kartika — Paracetamol"), "LI**** KA**** — Paracetamol");
assert.strictEqual(censorActivityDetail("GANTI_DOKTER", "Lina Kartika → Budi Santoso (cuti)"), "LI**** KA**** → BU**** SA**** (cuti)");
assert.strictEqual(censorActivityDetail("DPL_DPF_DIKIRIM", "DPL — D01 — Obat"), "DPL — D01 — Obat");
assert.strictEqual(censorActivityDetail("TTD_DOKTER", null), "");

console.log("testCensorName: ok");
