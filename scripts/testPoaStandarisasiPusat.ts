/**
 * Uji end-to-end alur Standarisasi Pusat (docs/poa-standarisasi-pusat/) langsung ke DB di .env,
 * dengan session di-stub (tanpa browser). Membuat 1 pengajuan uji lalu menghapusnya.
 *   npx tsx scripts/testPoaStandarisasiPusat.ts [grup=Mitra]
 */
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";

let currentNip = "";
const stub = (id: string, exports: Record<string, unknown>) => {
  const p = require.resolve(id);
  require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
};
stub("../src/lib/session", {
  getCurrentUser: async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { nip: currentNip } });
    return { userId: u.nip, nip: u.nip, name: u.name, role: u.role, isLoggedIn: true };
  },
});
stub("next/cache", { revalidatePath: () => {}, revalidateTag: () => {} });

const MASRIL = "P240245", AHSANUL = "972977";

async function main() {
  const grup = process.argv[2] ?? "Mitra";
  const A = await import("../src/app/actions/poaStandarisasiPusat");
  const { assertHkaGateway } = await import("../src/lib/hkaGateway");

  const prods = await prisma.product.findMany({ take: 3, select: { kodeProduk: true } });
  const [pBawah, pAtas, pLain] = prods.map((p) => p.kodeProduk);
  const mk = (kode: string, pct: string) => ({ kodeProduk: kode, skemaPembayaran: "DISKON" as const, estimasiDiskonPct: pct, estimasiDiskonDistributorPct: null, estimasiValueDpRp: null, catatan: "uji otomatis" });

  // 1. Non-HKA ditolak
  const nonHka = await prisma.user.findFirstOrThrow({ where: { isHka: false, role: "MR", isActive: true }, select: { nip: true } });
  currentNip = nonHka.nip;
  const denied = await A.createPusatAction({ hkaGroup: grup, tipeStandarisasi: "PERMANEN", periodeBulan: null, produk: [mk(pBawah, "5")] });
  assert.ok(denied.error, "non-HKA harus ditolak");
  console.log("1 OK non-HKA ditolak:", denied.error);

  // 2. Masril (NSM) buat: 15% (auto sampai NSM), 25% (butuh ASD)
  currentNip = MASRIL;
  const created = await A.createPusatAction({ hkaGroup: grup, tipeStandarisasi: "PERMANEN", periodeBulan: null, produk: [mk(pBawah, "15"), mk(pAtas, "25")] });
  assert.ok(created.id, `create gagal: ${created.error}`);
  const id = created.id!;
  try {
    let d = await A.getPusatDetail(id);
    assert.equal(d!.currentPhase, "APPROVAL_ATASAN");
    const lv = (kode: string) => d!.produk.find((p) => p.kodeProduk === kode)!.approvals.map((a) => `${a.level}:${a.status}${a.autoApproved ? "*" : ""}`).join(",");
    console.log("2 OK create. 15% ->", lv(pBawah), "| 25% ->", lv(pAtas));
    assert.equal(lv(pBawah), "ASM:DISETUJUI*,SM:DISETUJUI*,NSM:DISETUJUI*");
    assert.equal(lv(pAtas), "ASM:DISETUJUI*,SM:DISETUJUI*,NSM:DISETUJUI*,ASD:MENUNGGU");

    // 3. Masril tidak boleh approve ASD; Ahsanul boleh
    const r1 = await A.approvePusatAction(id, "ASD", "DISETUJUI");
    assert.ok(r1.error, "Masril tidak boleh approve ASD");
    console.log("3a OK Masril ditolak approve ASD:", r1.error);
    currentNip = AHSANUL;
    const r2 = await A.approvePusatAction(id, "ASD", "DISETUJUI");
    assert.ok(!r2.error, r2.error);
    d = await A.getPusatDetail(id);
    assert.equal(d!.currentPhase, "APPROVAL_USER_DOKTER");
    console.log("3b OK Ahsanul approve ASD -> fase", d!.currentPhase);

    // 4. Fase dokter (Masril owner)
    currentNip = MASRIL;
    const prodId = d!.produk[0].id;
    const outsider = await prisma.customer.findFirst({ where: { outlets: { none: { outlet: { hkaGroup: grup } } } }, select: { id: true } });
    const rOut = await A.addPusatDokterAction(prodId, outsider!.id);
    assert.ok(rOut.error, "dokter di luar grup harus ditolak");
    console.log("4a OK dokter luar grup ditolak:", rOut.error);
    const early = await A.advancePusatToFinalisasiAction(id);
    assert.ok(early.error, "tanpa dokter tidak boleh lanjut");

    const inGroup = await prisma.customer.findMany({ where: { outlets: { some: { outlet: { hkaGroup: grup } } } }, select: { id: true, namaCustomer: true }, take: 2 });
    assert.ok(inGroup.length >= 2, `butuh >=2 dokter di grup ${grup}`);
    for (let i = 0; i < d!.produk.length; i++) {
      const pid = d!.produk[i].id;
      const add = await A.addPusatDokterAction(pid, inGroup[i].id);
      assert.ok(!add.error, add.error);
    }
    const noTtd = await A.advancePusatToFinalisasiAction(id);
    assert.ok(noTtd.error, "belum TTD tidak boleh lanjut");
    console.log("4b OK belum TTD ditolak:", noTtd.error);
    for (let i = 0; i < d!.produk.length; i++) await A.setPusatDokterTtdAction(d!.produk[i].id, inGroup[i].id, true);
    const adv = await A.advancePusatToFinalisasiAction(id);
    assert.ok(!adv.error, adv.error);

    // 5. Submit final
    const sub = await A.submitPusatAction(id);
    assert.ok(!sub.error, sub.error);
    d = await A.getPusatDetail(id);
    assert.ok(d!.submittedAt);
    console.log("5 OK submit final");

    // 6. Gateway terbuka untuk 2 produk itu, tertutup untuk produk lain
    const outlet = await prisma.outlet.findFirstOrThrow({ where: { hkaGroup: grup }, select: { kodePI: true } });
    await assertHkaGateway(outlet.kodePI, [pBawah, pAtas]);
    await assert.rejects(() => assertHkaGateway(outlet.kodePI, [pLain]), /belum pernah distandarisasi/);
    console.log("6 OK gateway: produk pusat lolos, produk lain diblok");
  } finally {
    await prisma.poaStandarisasiPusat.delete({ where: { id } });
    console.log("pengajuan uji dihapus");
  }
  console.log("SEMUA OK");
}

main().catch((e) => { console.error("GAGAL:", e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
