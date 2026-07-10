"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canEdit } from "@/lib/authz";
import { getProductByKode } from "@/lib/masterData";
import { StatusStandarisasi, Prisma } from "@prisma/client";

async function requireEditorOnPoa(poaId: string) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const [poa, actor] = await Promise.all([
    prisma.poaForm.findUnique({ where: { id: poaId } }),
    prisma.user.findUniqueOrThrow({ where: { nip: session.userId } }),
  ]);

  if (!poa) redirect("/dashboard");
  if (!canEdit(actor, poa)) redirect(`/poa/${poaId}`);

  return { poa, actor };
}

export async function addLineItemAction(poaId: string, formData: FormData): Promise<void> {
  await requireEditorOnPoa(poaId);

  const customerId = (formData.get("customerId") as string | null)?.trim() ?? "";
  const kodePI = (formData.get("kodePI") as string | null)?.trim() ?? "";
  const kodeProduk = (formData.get("kodeProduk") as string | null)?.trim() ?? "";
  const lamaPeriodeRaw = parseInt(formData.get("lamaPeriode") as string, 10);
  const periodeAwal = (formData.get("periodeAwal") as string | null)?.trim() ?? "";
  const rencanaTotalBiayaRaw = (formData.get("rencanaTotalBiaya") as string | null)?.trim() ?? "0";
  const rencanaVisitMinggu = parseInt(formData.get("rencanaVisitMinggu") as string, 10) || 0;
  const produkKompetitor = (formData.get("produkKompetitor") as string | null)?.trim() || null;
  const statusStandarisasiRaw = formData.get("statusStandarisasi") as string | null;
  const hariKerjaBulan = parseInt(formData.get("hariKerjaBulan") as string, 10) || null;
  const jumlahPasienHari = parseInt(formData.get("jumlahPasienHari") as string, 10) || null;
  const jumlahResepHari = parseInt(formData.get("jumlahResepHari") as string, 10) || null;
  const qtyProdukResep = parseInt(formData.get("qtyProdukResep") as string, 10) || null;

  if (!customerId || !kodePI || !kodeProduk || !periodeAwal || isNaN(lamaPeriodeRaw)) {
    redirect(`/poa/${poaId}/edit?error=` + encodeURIComponent("Field wajib belum lengkap."));
  }

  const [customer, outlet, product] = await Promise.all([
    prisma.customer.findUnique({ where: { id: customerId } }),
    prisma.outlet.findUnique({ where: { kodePI } }),
    getProductByKode(kodeProduk),
  ]);

  if (!customer || !outlet || !product) {
    redirect(`/poa/${poaId}/edit?error=` + encodeURIComponent("Customer, outlet, atau produk tidak ditemukan."));
  }

  const statusStandarisasi =
    statusStandarisasiRaw && Object.values(StatusStandarisasi).includes(statusStandarisasiRaw as StatusStandarisasi)
      ? (statusStandarisasiRaw as StatusStandarisasi)
      : null;

  await prisma.poaLineItem.create({
    data: {
      poaId,
      kodeRequest: null,
      kodeCust: customer.kodeCustomer,
      namaCust: customer.namaCustomer,
      role: "Dokter Spesialis",
      spesialisasi: customer.spesialisasi,
      historisPSSP: null,
      kodePI: outlet.kodePI,
      namaOutlet: outlet.namaOutlet,
      kodeProduk: product.kodeProduk,
      namaProduk: product.namaProduk,
      kategoriProdukFokus: product.namaGroupBrand,
      itemKode: product.kodeProduk,
      satuanTerkecil: product.satuan,
      hargaSatuanTerkecil: new Prisma.Decimal(product.hna.toString()),
      produkKompetitor,
      statusStandarisasi,
      lamaPeriode: lamaPeriodeRaw,
      periodeAwal,
      rencanaTotalBiaya: new Prisma.Decimal(rencanaTotalBiayaRaw),
      rencanaVisitMinggu,
      hariKerjaBulan,
      jumlahPasienHari,
      jumlahResepHari,
      qtyProdukResep,
    },
  });

  revalidatePath(`/poa/${poaId}/edit`);
}

export async function updateLineItemAction(
  poaId: string,
  lineItemId: string,
  formData: FormData
): Promise<void> {
  await requireEditorOnPoa(poaId);

  const rencanaTotalBiayaRaw = (formData.get("rencanaTotalBiaya") as string | null)?.trim() ?? "0";
  const rencanaVisitMinggu = parseInt(formData.get("rencanaVisitMinggu") as string, 10) || 0;
  const produkKompetitor = (formData.get("produkKompetitor") as string | null)?.trim() || null;
  const statusStandarisasiRaw = formData.get("statusStandarisasi") as string | null;
  const lamaPeriodeRaw = parseInt(formData.get("lamaPeriode") as string, 10);
  const periodeAwal = (formData.get("periodeAwal") as string | null)?.trim() ?? "";
  const hariKerjaBulan = parseInt(formData.get("hariKerjaBulan") as string, 10) || null;
  const jumlahPasienHari = parseInt(formData.get("jumlahPasienHari") as string, 10) || null;
  const jumlahResepHari = parseInt(formData.get("jumlahResepHari") as string, 10) || null;
  const qtyProdukResep = parseInt(formData.get("qtyProdukResep") as string, 10) || null;

  const statusStandarisasi =
    statusStandarisasiRaw && Object.values(StatusStandarisasi).includes(statusStandarisasiRaw as StatusStandarisasi)
      ? (statusStandarisasiRaw as StatusStandarisasi)
      : null;

  await prisma.poaLineItem.update({
    where: { id: lineItemId },
    data: {
      produkKompetitor,
      statusStandarisasi,
      lamaPeriode: isNaN(lamaPeriodeRaw) ? undefined : lamaPeriodeRaw,
      periodeAwal: periodeAwal || undefined,
      rencanaTotalBiaya: new Prisma.Decimal(rencanaTotalBiayaRaw),
      rencanaVisitMinggu,
      hariKerjaBulan,
      jumlahPasienHari,
      jumlahResepHari,
      qtyProdukResep,
    },
  });

  revalidatePath(`/poa/${poaId}/edit`);
}

export async function deleteLineItemAction(poaId: string, lineItemId: string): Promise<void> {
  await requireEditorOnPoa(poaId);

  await prisma.poaLineItem.delete({ where: { id: lineItemId } });

  revalidatePath(`/poa/${poaId}/edit`);
}
