import { prisma } from "@/lib/prisma";
import { getScProducts, getSalesCounterOutletsDirect } from "@/lib/masterData";
import { isOutletBlastIn } from "@/lib/outletBlastIn";

export async function getSalesCounterFormById(
  scId: string,
  sessionUserId: string,
  sessionRole?: string
) {
  const form = await prisma.poaScForm.findUnique({
    where: { id: scId },
    include: {
      owner: true,
      products: true,
      persons: true,
      entertainItems: true,
    },
  });

  if (!form) return null;
  const hasAccess =
    form.ownerId === sessionUserId ||
    (sessionRole != null && ["ASM", "SM", "NSM", "ADMIN", "GM", "SFE", "VIEWER"].includes(sessionRole));
  if (!hasAccess) return null;

  const [products, isBlastIn, rawOutlets] = await Promise.all([
    getScProducts(),
    isOutletBlastIn(form.kodePI),
    getSalesCounterOutletsDirect(sessionUserId),
  ]);

  const targetOutlet = rawOutlets.find((o) => o.kodePI === form.kodePI);

  const serialized = {
    id: form.id,
    period: form.period,
    status: form.status,
    version: form.version,
    ownerId: form.ownerId,
    owner: { nip: form.owner.nip, name: form.owner.name },
    kodePI: form.kodePI,
    namaOutlet: form.namaOutlet,
    is_sc: !!targetOutlet?.is_sc,
    isBlastIn,
    periodeAwal: form.periodeAwal,
    lamaPeriode: form.lamaPeriode,
    hariKerjaBulan: form.hariKerjaBulan,
    rencanaVisitMinggu: form.rencanaVisitMinggu,
    surveyPasienHarian: form.surveyPasienHarian,
    persons: form.persons.map((p: any) => ({
      id: p.id,
      nik_ktp: p.nik_ktp,
      personName: p.personName,
      positionName: p.positionName,
    })),
    products: form.products.map((p: any) => ({
      id: p.id,
      kodeProduk: p.kodeProduk,
      namaProduk: p.namaProduk,
      produkKompetitor: p.produkKompetitor,
      pembeliHari: p.pembeliHari,
      qtyCustomerBaru: p.qtyCustomerBaru,
      persenMatriksSc: Number(p.persenMatriksSc.toString()),
      persenDiskon: Number(p.persenDiskon.toString()),
      persenCashback: Number(p.persenCashback.toString()),
      rencanaTotalBiaya: Number(p.rencanaTotalBiaya.toString()),
    })),
    entertainItems: form.entertainItems.map((e: any) => ({
      id: e.id,
      periodeMonth: e.periodeMonth,
      biayaEntertain: Number(e.biayaEntertain.toString()),
    })),
  };

  return {
    userCanEdit: form.ownerId === sessionUserId && (form.status === "DRAFT" || form.status === "REVISI"),
    form: serialized,
    products,
  };
}
