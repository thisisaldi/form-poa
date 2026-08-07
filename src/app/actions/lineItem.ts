"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canEdit } from "@/lib/authz";
import { flagRevisionOnEdit } from "@/lib/poaWorkflow";
import { getProductByKode } from "@/lib/masterData";
import { isWriteBlocked } from "@/lib/maintenance";
import { StatusStandarisasi, JenisPssp, PihakPssp, PsSp, BentukPssp, Prisma } from "@prisma/client";

async function requireEditorOnPoa(poaId: string) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (await isWriteBlocked(session.role)) redirect(`/poa/${poaId}?error=` + encodeURIComponent("Sistem sedang mode view-only untuk maintenance. Coba lagi nanti."));

  const [poa, actor] = await Promise.all([
    prisma.poaForm.findUnique({ where: { id: poaId } }),
    prisma.user.findUniqueOrThrow({ where: { nip: session.userId } }),
  ]);

  if (!poa) redirect("/dashboard");
  if (!(await canEdit(actor, poa))) redirect(`/poa/${poaId}`);

  return { poa, actor };
}

export async function addLineItemAction(poaId: string, formData: FormData): Promise<void> {
  const { actor } = await requireEditorOnPoa(poaId);

  const customerId = (formData.get("customerId") as string | null)?.trim() ?? "";
  const kodePI = (formData.get("kodePI") as string | null)?.trim() ?? "";
  const kodeProduk = (formData.get("kodeProduk") as string | null)?.trim() ?? "";
  const lamaPeriodeRaw = parseInt(formData.get("lamaPeriode") as string, 10);
  const periodeAwal = (formData.get("periodeAwal") as string | null)?.trim() ?? "";
  const rencanaTotalBiayaRaw = (formData.get("rencanaTotalBiaya") as string | null)?.trim() ?? "0";
  const rencanaVisitMinggu = parseInt(formData.get("rencanaVisitMinggu") as string, 10) || 0;
  const surveyPasienHarian = parseInt(formData.get("surveyPasienHarian") as string, 10) || 0;
  const produkKompetitor = (formData.get("produkKompetitor") as string | null)?.trim() || null;
  const labelCustomer = (formData.get("labelCustomer") as string | null)?.trim() || null;
  const statusStandarisasiRaw = formData.get("statusStandarisasi") as string | null;
  const jenisPsspRaw = formData.get("jenisPssp") as string | null;
  const pihakPsspRaw = formData.get("pihakPssp") as string | null;
  const jenisPsSpRaw = formData.get("jenisPsSp") as string | null;
  const bentukPsspRaw = formData.get("bentukPssp") as string | null;
  const hariKerjaBulan = parseInt(formData.get("hariKerjaBulan") as string, 10) || null;
  const jumlahResepHari = parseInt(formData.get("jumlahResepHari") as string, 10) || null;
  const qtyProdukResep = parseInt(formData.get("qtyProdukResep") as string, 10) || null;

  function parsePct(key: string) {
    const v = parseFloat(formData.get(key) as string);
    return isNaN(v) || v === 0 ? null : new Prisma.Decimal((v / 100).toFixed(4));
  }
  const rasioEstimasiGrowth = (() => {
    const v = parseFloat(formData.get("rasioEstimasiGrowth") as string);
    return isNaN(v) || v === 0 ? null : new Prisma.Decimal(v.toFixed(4));
  })();
  const pengaliNilaiR = (() => {
    // 0 is a valid, intentional multiplier here (not "unset") — only NaN maps to null.
    const v = parseFloat(formData.get("pengaliNilaiR") as string);
    return isNaN(v) ? null : new Prisma.Decimal(v.toFixed(4));
  })();
  const persenPsspDokter = parsePct("persenPsspDokter");
  const persenPsspKpdm   = parsePct("persenPsspKpdm");
  const persenDiskon     = parsePct("persenDiskon");
  const persenDp         = parsePct("persenDp");
  const persenListingFee = parsePct("persenListingFee");
  const persenEntertain  = parsePct("persenEntertain");

  // Direct mode: caller already knows dokter info (e.g. adding a product to an existing doctor row)
  const directNamaCust = (formData.get("directNamaCust") as string | null)?.trim() ?? "";
  const directSpesialisasi = (formData.get("directSpesialisasi") as string | null)?.trim() ?? "";
  const directKodeCust = (formData.get("directKodeCust") as string | null)?.trim() || null;

  const isDirect = !customerId && !!directNamaCust && !!directSpesialisasi;

  if (!kodePI || !kodeProduk || !periodeAwal || isNaN(lamaPeriodeRaw)) {
    redirect(`/poa/${poaId}/edit?error=` + encodeURIComponent("Field wajib belum lengkap."));
  }
  if (!isDirect && !customerId) {
    redirect(`/poa/${poaId}/edit?error=` + encodeURIComponent("Field wajib belum lengkap."));
  }

  const itemKode = kodeProduk; // itemKode matches kodeProduk in our schema

  const [customerResult, outlet, product, salesHistory, diskonKontrak] = await Promise.all([
    isDirect
      ? Promise.resolve(null)
      : prisma.customer.findUnique({ where: { id: customerId } }),
    prisma.outlet.findUnique({ where: { kodePI } }),
    getProductByKode(kodeProduk),
    prisma.outletSalesHistory.findUnique({
      where: { kodePI_itemKode: { kodePI, itemKode } },
    }),
    // Active DPL contract for this outlet+product whose period covers periodeAwal.
    // When more than one contract matches (a duplicate for the same outlet+product+
    // period), take the one with the largest newOnPi.
    prisma.diskonKontrak.findFirst({
      where: { kodePI, kodeProduk: itemKode, prdAwal: { lte: periodeAwal }, prdAkhir: { gte: periodeAwal } },
      orderBy: { newOnPi: "desc" },
    }),
  ]);

  if (!outlet || !product) {
    redirect(`/poa/${poaId}/edit?error=` + encodeURIComponent("Outlet atau produk tidak ditemukan."));
  }
  if (!isDirect && !customerResult) {
    redirect(`/poa/${poaId}/edit?error=` + encodeURIComponent("Customer tidak ditemukan."));
  }

  const namaCust = isDirect ? directNamaCust : customerResult!.namaCustomer;
  const kodeCust = isDirect ? directKodeCust : customerResult!.kodeCustomer;
  const spesialisasi = isDirect ? directSpesialisasi : customerResult!.spesialisasi;

  // Same doctor (outlet + name) can't have the same product added twice.
  const existingForDoctor: { kodeProduk: string; isManualCustomer: boolean }[] = await prisma.poaLineItem.findMany({
    where: { poaId, kodePI, namaCust },
    select: { kodeProduk: true, isManualCustomer: true },
  });
  if (existingForDoctor.some((i) => i.kodeProduk === kodeProduk)) {
    redirect(`/poa/${poaId}/edit?error=` + encodeURIComponent(`${product!.namaProduk} sudah ada untuk dokter ini.`));
  }

  // Manual (unsynced) doctor — Customer.syncedAt is only ever null for doctors
  // registered via "Daftar User Baru", never for ones synced from the CDB.
  // Direct mode has no customerId to check, so it inherits the flag from
  // this doctor's other line item already in the POA (same doctor either way).
  const isManualCustomer = isDirect
    ? existingForDoctor[0]?.isManualCustomer ?? false
    : customerResult!.syncedAt === null;

  const statusStandarisasi =
    statusStandarisasiRaw && Object.values(StatusStandarisasi).includes(statusStandarisasiRaw as StatusStandarisasi)
      ? (statusStandarisasiRaw as StatusStandarisasi)
      : null;
  const jenisPssp =
    jenisPsspRaw && Object.values(JenisPssp).includes(jenisPsspRaw as JenisPssp)
      ? (jenisPsspRaw as JenisPssp)
      : null;
  const pihakPssp =
    pihakPsspRaw && Object.values(PihakPssp).includes(pihakPsspRaw as PihakPssp)
      ? (pihakPsspRaw as PihakPssp)
      : PihakPssp.USER;
  const jenisPsSp =
    jenisPsSpRaw && Object.values(PsSp).includes(jenisPsSpRaw as PsSp)
      ? (jenisPsSpRaw as PsSp)
      : null;
  const bentukPssp =
    bentukPsspRaw && Object.values(BentukPssp).includes(bentukPsspRaw as BentukPssp)
      ? (bentukPsspRaw as BentukPssp)
      : null;

  // Editing a POA that already left DRAFT bounces it back to REVISI — must be resubmitted.
  await flagRevisionOnEdit(poaId, actor.nip, { customer: namaCust, product: product!.namaProduk, op: "add" });

  await prisma.poaLineItem.create({
    data: {
      poaId,
      kodeRequest: null,
      kodeCust,
      namaCust,
      role: spesialisasi?.toLowerCase().includes("spesialis") ? "Dokter Spesialis" : "Dokter Umum",
      spesialisasi,
      isManualCustomer,
      historisPSSP: null,
      kodePI: outlet.kodePI,
      namaOutlet: outlet.namaOutlet,
      kodeProduk: product.kodeProduk,
      namaProduk: product.namaProduk,
      kategoriProdukFokus: product.namaGroupBrand,
      itemKode: product.kodeProduk,
      satuanTerkecil: product.satuanTerkecil ?? product.satuan,
      hargaSatuanTerkecil: (() => {
        const hna = parseFloat(product.hna);
        const konversi = parseFloat(product.konversiPembagi ?? "1") || 1;
        return new Prisma.Decimal((hna / konversi).toFixed(2));
      })(),
      historySales3Bln: salesHistory?.totalSales12Bln ?? null,
      avgDiskon: diskonKontrak?.newOnPi != null ? diskonKontrak.newOnPi.dividedBy(100) : null,
      produkKompetitor,
      labelCustomer,
      statusStandarisasi,
      jenisPssp,
      pihakPssp,
      jenisPsSp,
      bentukPssp,
      lamaPeriode: lamaPeriodeRaw,
      periodeAwal,
      rencanaTotalBiaya: new Prisma.Decimal(rencanaTotalBiayaRaw),
      rencanaVisitMinggu,
      surveyPasienHarian,
      hariKerjaBulan,
      jumlahResepHari,
      qtyProdukResep,
      rasioEstimasiGrowth,
      pengaliNilaiR,
      persenPsspDokter,
      persenPsspKpdm,
      persenDiskon,
      persenDp,
      persenListingFee,
      persenEntertain,
    },
  });

  revalidatePath(`/poa/${poaId}/edit`);
}

export async function updateLineItemAction(
  poaId: string,
  lineItemId: string,
  formData: FormData
): Promise<void> {
  const { actor } = await requireEditorOnPoa(poaId);

  const kodeProduk = (formData.get("kodeProduk") as string | null)?.trim() ?? "";
  const rencanaTotalBiayaRaw = (formData.get("rencanaTotalBiaya") as string | null)?.trim() ?? "0";
  const rencanaVisitMinggu = parseInt(formData.get("rencanaVisitMinggu") as string, 10) || 0;
  const surveyPasienHarian = parseInt(formData.get("surveyPasienHarian") as string, 10) || 0;
  const produkKompetitor = (formData.get("produkKompetitor") as string | null)?.trim() || null;
  const statusStandarisasiRaw = formData.get("statusStandarisasi") as string | null;
  const jenisPsspRaw = formData.get("jenisPssp") as string | null;
  const pihakPsspRaw = formData.get("pihakPssp") as string | null;
  const jenisPsSpRaw = formData.get("jenisPsSp") as string | null;
  const bentukPsspRaw = formData.get("bentukPssp") as string | null;
  const lamaPeriodeRaw = parseInt(formData.get("lamaPeriode") as string, 10);
  const periodeAwal = (formData.get("periodeAwal") as string | null)?.trim() ?? "";
  const hariKerjaBulan = parseInt(formData.get("hariKerjaBulan") as string, 10) || null;
  const jumlahResepHari = parseInt(formData.get("jumlahResepHari") as string, 10) || null;
  const qtyProdukResep = parseInt(formData.get("qtyProdukResep") as string, 10) || null;

  const [product, current] = await Promise.all([
    kodeProduk ? getProductByKode(kodeProduk) : Promise.resolve(null),
    prisma.poaLineItem.findUnique({ where: { id: lineItemId } }),
  ]);

  if (product && current) {
    const duplicate = await prisma.poaLineItem.findFirst({
      where: { poaId, kodePI: current.kodePI, namaCust: current.namaCust, kodeProduk, id: { not: lineItemId } },
    });
    if (duplicate) {
      redirect(`/poa/${poaId}/edit?error=` + encodeURIComponent(`${product.namaProduk} sudah ada untuk dokter ini.`));
    }
  }

  // Editing a POA that already left DRAFT bounces it back to REVISI — must be resubmitted.
  await flagRevisionOnEdit(poaId, actor.nip, {
    customer: current?.namaCust,
    product: product?.namaProduk ?? current?.namaProduk,
    op: "update",
  });

  function parsePctU(key: string) {
    const v = parseFloat(formData.get(key) as string);
    return isNaN(v) || v === 0 ? null : new Prisma.Decimal((v / 100).toFixed(4));
  }
  const rasioEstimasiGrowthU = (() => {
    const v = parseFloat(formData.get("rasioEstimasiGrowth") as string);
    return isNaN(v) || v === 0 ? null : new Prisma.Decimal(v.toFixed(4));
  })();
  const pengaliNilaiRU = (() => {
    // 0 is a valid, intentional multiplier here (not "unset") — only NaN maps to null.
    const v = parseFloat(formData.get("pengaliNilaiR") as string);
    return isNaN(v) ? null : new Prisma.Decimal(v.toFixed(4));
  })();
  const persenPsspDokterU = parsePctU("persenPsspDokter");
  const persenPsspKpdmU   = parsePctU("persenPsspKpdm");
  const persenDiskonU     = parsePctU("persenDiskon");
  const persenDpU         = parsePctU("persenDp");
  const persenListingFeeU = parsePctU("persenListingFee");
  const persenEntertainU  = parsePctU("persenEntertain");

  const statusStandarisasi =
    statusStandarisasiRaw && Object.values(StatusStandarisasi).includes(statusStandarisasiRaw as StatusStandarisasi)
      ? (statusStandarisasiRaw as StatusStandarisasi)
      : null;
  const jenisPssp =
    jenisPsspRaw && Object.values(JenisPssp).includes(jenisPsspRaw as JenisPssp)
      ? (jenisPsspRaw as JenisPssp)
      : null;
  // Falls back to `undefined` (leave existing value untouched), not a forced
  // default — unlike create, pihakPssp already has a real value here that an
  // unparseable/missing raw value shouldn't clobber.
  const pihakPssp =
    pihakPsspRaw && Object.values(PihakPssp).includes(pihakPsspRaw as PihakPssp)
      ? (pihakPsspRaw as PihakPssp)
      : undefined;
  const jenisPsSp =
    jenisPsSpRaw && Object.values(PsSp).includes(jenisPsSpRaw as PsSp)
      ? (jenisPsSpRaw as PsSp)
      : null;
  const bentukPssp =
    bentukPsspRaw && Object.values(BentukPssp).includes(bentukPsspRaw as BentukPssp)
      ? (bentukPsspRaw as BentukPssp)
      : null;

  await prisma.poaLineItem.update({
    where: { id: lineItemId },
    data: {
      ...(product ? {
        kodeProduk: product.kodeProduk,
        namaProduk: product.namaProduk,
        kategoriProdukFokus: product.namaGroupBrand,
        itemKode: product.kodeProduk,
        satuanTerkecil: product.satuanTerkecil ?? product.satuan,
        hargaSatuanTerkecil: (() => {
          const hna = parseFloat(product.hna);
          const konversi = parseFloat(product.konversiPembagi ?? "1") || 1;
          return new Prisma.Decimal((hna / konversi).toFixed(2));
        })(),
      } : {}),
      produkKompetitor,
      statusStandarisasi,
      jenisPssp,
      pihakPssp,
      jenisPsSp,
      bentukPssp,
      lamaPeriode: isNaN(lamaPeriodeRaw) ? undefined : lamaPeriodeRaw,
      periodeAwal: periodeAwal || undefined,
      rencanaTotalBiaya: new Prisma.Decimal(rencanaTotalBiayaRaw),
      rencanaVisitMinggu,
      surveyPasienHarian,
      hariKerjaBulan,
      jumlahResepHari,
      qtyProdukResep,
      rasioEstimasiGrowth: rasioEstimasiGrowthU,
      pengaliNilaiR: pengaliNilaiRU,
      persenPsspDokter: persenPsspDokterU,
      persenPsspKpdm: persenPsspKpdmU,
      persenDiskon: persenDiskonU,
      persenDp: persenDpU,
      persenListingFee: persenListingFeeU,
      persenEntertain: persenEntertainU,
    },
  });

  revalidatePath(`/poa/${poaId}/edit`);
}

export async function deleteLineItemAction(poaId: string, lineItemId: string): Promise<void> {
  const { actor } = await requireEditorOnPoa(poaId);

  const item = await prisma.poaLineItem.findUnique({ where: { id: lineItemId } });

  // Editing a POA that already left DRAFT bounces it back to REVISI — must be resubmitted.
  await flagRevisionOnEdit(poaId, actor.nip, { customer: item?.namaCust, product: item?.namaProduk, op: "delete" });

  await prisma.poaLineItem.delete({ where: { id: lineItemId } });

  revalidatePath(`/poa/${poaId}/edit`);
}
