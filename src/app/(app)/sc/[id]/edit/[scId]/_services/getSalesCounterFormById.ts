import { prisma } from "@/lib/prisma";
import { getScProducts } from "@/lib/masterData";

export async function getSalesCounterFormById(scId: string, sessionUserId: string) {
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
  // Only owner can edit
  if (form.ownerId !== sessionUserId) return null;

  const products = await getScProducts();

  const serialized = {
    id: form.id,
    period: form.period,
    status: form.status,
    version: form.version,
    ownerId: form.ownerId,
    owner: { nip: form.owner.nip, name: form.owner.name },
    kodePI: form.kodePI,
    namaOutlet: form.namaOutlet,
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
    userCanEdit: form.status === "DRAFT" || form.status === "REVISI",
    form: serialized,
    products,
  };
}
