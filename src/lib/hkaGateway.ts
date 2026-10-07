import { prisma } from "@/lib/prisma";
import { getDiskonByOutlets } from "@/app/actions/customer";

/**
 * Gateway standarisasi cabang (docs/poa-standarisasi-pusat/01-business-rules.md §2).
 * Produk P di outlet O (yang punya Outlet.hkaGroup) hanya boleh diajukan kalau
 * (b) ada pengajuan pusat final untuk (grup, P), atau (c) salah satu outlet di
 * grup itu sudah "sudah standarisasi" untuk P (sales 3 bulan penuh terakhir DAN
 * DPL aktif bulan berjalan — definisi sama dengan computeStatusPengajuanMap).
 * Outlet tanpa hkaGroup: tidak ada gateway. Gagal baca data -> fail-open + log
 * (asumsi Q3: degrade, jangan blok).
 *
 * Batched (docs/PERFORMANCE.md §2.4): satu query per sumber untuk seluruh grup
 * (maks ~56 outlet), getDiskonByOutlets DB-only — bukan HTTP per outlet.
 */
export async function assertHkaGateway(kodePI: string, kodeProdukList: string[]): Promise<void> {
  if (!kodePI || kodeProdukList.length === 0) return;
  try {
    const outlet = await prisma.outlet.findUnique({ where: { kodePI }, select: { hkaGroup: true } });
    const group = outlet?.hkaGroup;
    if (!group) return;

    const wanted = [...new Set(kodeProdukList)];

    const pusat = await prisma.poaStandarisasiPusat.findMany({
      where: { hkaGroup: group, submittedAt: { not: null }, produk: { some: { kodeProduk: { in: wanted } } } },
      select: { produk: { select: { kodeProduk: true } } },
    });
    const ok = new Set(pusat.flatMap((p: (typeof pusat)[number]) => p.produk.map((x: (typeof p.produk)[number]) => x.kodeProduk)));

    const remaining = wanted.filter((k) => !ok.has(k));
    if (remaining.length > 0) {
      const groupOutlets = (await prisma.outlet.findMany({ where: { hkaGroup: group }, select: { kodePI: true } })).map((o: { kodePI: string }) => o.kodePI);

      const now = new Date();
      const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
      const last3 = [1, 2, 3].map((i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
      });

      const [sales, dplByOutlet] = await Promise.all([
        prisma.outletSalesMonthly.findMany({
          where: { kodePI: { in: groupOutlets }, itemKode: { in: remaining }, periode: { in: last3 }, qty: { gt: 0 } },
          select: { kodePI: true, itemKode: true },
        }),
        getDiskonByOutlets(groupOutlets),
      ]);
      const salesPairs = new Set(sales.map((s: (typeof sales)[number]) => `${s.itemKode}|${s.kodePI}`));
      for (const [outletKode, contracts] of dplByOutlet) {
        for (const c of contracts) {
          if (c.prdAwal <= ym && ym <= c.prdAkhir && salesPairs.has(`${c.kodeProduk}|${outletKode}`)) ok.add(c.kodeProduk);
        }
      }
    }

    const blocked = wanted.filter((k) => !ok.has(k));
    if (blocked.length === 0) return;
    const names = await prisma.product.findMany({ where: { kodeProduk: { in: blocked } }, select: { kodeProduk: true, namaProduk: true } });
    const label = names.length > 0 ? names.map((p: (typeof names)[number]) => p.namaProduk).join(", ") : blocked.join(", ");
    throw new GatewayError(`Produk ${label} belum pernah distandarisasi di grup ${group}. Ajukan standarisasi pusat lewat tim HKA dulu.`);
  } catch (e) {
    if (e instanceof GatewayError) throw e;
    console.error("[hkaGateway] gagal cek gateway, fail-open:", e);
  }
}

class GatewayError extends Error {}
