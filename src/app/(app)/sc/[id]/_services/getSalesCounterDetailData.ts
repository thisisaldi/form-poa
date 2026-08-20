import type { PoaStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSubordinateMRNips } from "@/lib/authz";
import { getMrSalesSummary } from "@/lib/salesSummary";
import { quarterToMonths } from "@/lib/quarterUtils";
import type { ScDraftFormItem } from "@/components/sc/types";

interface MasterProductItem {
  kodeProduk: string;
  namaProduk: string;
  hna: any;
  konversiPembagi: any;
  satuanTerkecil: string | null;
  satuan: string;
}

export async function getSalesCounterDetailData(
  id: string,
  periodParam: string | undefined,
  sessionUserId: string,
  sessionRole: string
) {
  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: sessionUserId } });

  // id is the period, e.g. "2026-Q2"
  const drafts = await prisma.poaScForm.findMany({
    where: { ownerId: sessionUserId, period: id },
    include: {
      owner: true,
      currentHolder: true,
      products: true,
      persons: true,
      entertainItems: true,
      auditLogs: {
        include: { actor: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  let poa: any = null;
  if (drafts.length > 0) {
    const first = drafts[0];
    poa = {
      id,
      period: id,
      status: first.status,
      version: first.version,
      ownerId: first.ownerId,
      owner: first.owner,
      currentHolderId: first.currentHolderId,
      currentHolder: first.currentHolder,
      auditLogs: drafts
        .flatMap((d: any) => d.auditLogs)
        .sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime()),
      entertainItems: drafts
        .flatMap((d: any) => d.entertainItems)
        .map((e: any) => ({
          ...e,
          biayaEntertain: Number(e.biayaEntertain.toString()),
        })),
    };
  } else {
    poa = {
      id,
      period: id,
      status: "DRAFT" as PoaStatus,
      version: 1,
      ownerId: actor.nip,
      owner: actor,
      currentHolderId: null,
      currentHolder: null,
      auditLogs: [],
      entertainItems: [],
    };
  }

  const hasAccess = poa.ownerId === sessionUserId || (["ASM", "SM", "NSM"] as string[]).includes(sessionRole);
  if (!hasAccess) return { hasAccess: false };

  const userCanEdit = poa.ownerId === sessionUserId && (poa.status === "DRAFT" || poa.status === "REVISI");
  const isOwner = poa.ownerId === sessionUserId;

  // Collect all product codes across drafts to fetch master Product information
  const allProductCodes = Array.from(
    new Set(drafts.flatMap((d: any) => d.products.map((p: any) => p.kodeProduk)).filter(Boolean))
  );

  const masterProducts: MasterProductItem[] = await prisma.product.findMany({
    where: { kodeProduk: { in: allProductCodes } },
    select: {
      kodeProduk: true,
      namaProduk: true,
      hna: true,
      konversiPembagi: true,
      satuanTerkecil: true,
      satuan: true,
    },
  });

  const masterProductMap = new Map<string, MasterProductItem>(
    masterProducts.map((p: MasterProductItem) => [p.kodeProduk, p])
  );

  // Build clean SC Draft Form items
  const scDrafts: ScDraftFormItem[] = drafts.map((d: any) => ({
    id: d.id,
    period: d.period,
    periodeAwal: d.periodeAwal,
    lamaPeriode: d.lamaPeriode,
    status: d.status,
    version: d.version,
    kodePI: d.kodePI,
    namaOutlet: d.namaOutlet || `Outlet ${d.kodePI}`,
    hariKerjaBulan: d.hariKerjaBulan,
    rencanaVisitMinggu: d.rencanaVisitMinggu,
    surveyPasienHarian: d.surveyPasienHarian,
    ownerId: d.ownerId,
    persons: d.persons.map((p: any) => ({
      id: p.id,
      nik_ktp: p.nik_ktp,
      personName: p.personName,
      positionName: p.positionName,
    })),
    products: d.products.map((p: any) => {
      const mp = masterProductMap.get(p.kodeProduk);
      return {
        id: p.id,
        kodeProduk: p.kodeProduk,
        namaProduk: p.namaProduk,
        produkKompetitor: p.produkKompetitor || null,
        pembeliHari: p.pembeliHari,
        qtyCustomerBaru: p.qtyCustomerBaru,
        persenMatriksSc: Number(p.persenMatriksSc.toString()),
        persenDiskon: Number(p.persenDiskon.toString()),
        persenCashback: Number(p.persenCashback.toString()),
        rencanaTotalBiaya: Number(p.rencanaTotalBiaya.toString()),
        hnaSJ: mp ? Number(mp.hna.toString()) : 0,
        konversiPembagi: mp?.konversiPembagi ? Number(mp.konversiPembagi.toString()) : 1,
        satuanTerkecil: mp?.satuanTerkecil || "ST",
        satuanSJ: mp?.satuan || "SJ",
      };
    }),
    entertainItems: d.entertainItems.map((e: any) => ({
      id: e.id,
      periodeMonth: e.periodeMonth,
      biayaEntertain: Number(e.biayaEntertain.toString()),
    })),
  }));

  const salesSummary = poa.owner.isDummy
    ? { historisTahunLalu: 0, historisTahunLaluLabel: String(new Date().getFullYear() - 1), salesYtd: 0, growthPct: 0 }
    : await getMrSalesSummary(poa.ownerId);

  let targetValueFromGT: number | null = null;
  if (/^\d{4}-Q[1-4]$/.test(poa.period)) {
    const months = quarterToMonths(poa.period);
    const targetNips = await getSubordinateMRNips(poa.owner);
    const rows = targetNips.length > 0
      ? await prisma.targetHospitalValue.findMany({
          where: { nipMR: { in: targetNips }, periode: { in: months } },
          select: { target: true },
        })
      : [];
    if (rows.length > 0) {
      targetValueFromGT = rows.reduce((sum: number, r: any) => sum + parseFloat(r.target.toString()), 0);
    }
  }

  return {
    hasAccess: true,
    poa,
    actor,
    userCanEdit,
    isOwner,
    scDrafts,
    salesSummary,
    targetValueFromGT,
  };
}