import type { PoaStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSalesCounterOutletsDirect, getScProducts } from "@/lib/masterData";

export async function getSalesCounterEditData(id: string, periodParam: string | undefined, sessionUserId: string) {
  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: sessionUserId } });

  // id is the period, e.g. "2026-Q2"
  const poa = {
    id,
    period: id,
    status: "DRAFT" as PoaStatus,
    version: 1,
    ownerId: actor.nip,
    owner: actor,
  };

  const savedDrafts = await prisma.poaScForm.findMany({
    where: { ownerId: sessionUserId, period: id },
    include: {
      products: true,
      persons: true,
      entertainItems: true,
    },
  });

  if (savedDrafts.length > 0) {
    poa.status = savedDrafts[0].status;
    poa.version = savedDrafts[0].version;
  }

  const [rawOutlets, products] = await Promise.all([
    getSalesCounterOutletsDirect(sessionUserId),
    getScProducts(),
  ]);

  const outlets = rawOutlets
    .filter((o) => o.kodePI != null)
    .map((o) => ({ kodePI: o.kodePI as string, namaOutlet: o.namaOutlet, groupRS: o.groupRS ?? null }));

  const serializedDrafts = savedDrafts.map((draft: any) => ({
    ...draft,
    products: draft.products.map((p: any) => ({
      ...p,
      persenMatriksSc: Number(p.persenMatriksSc.toString()),
      persenDiskon: Number(p.persenDiskon.toString()),
      persenCashback: Number(p.persenCashback.toString()),
      rencanaTotalBiaya: Number(p.rencanaTotalBiaya.toString()),
    })),
    entertainItems: draft.entertainItems.map((e: any) => ({
      ...e,
      biayaEntertain: Number(e.biayaEntertain.toString()),
    })),
  }));

  return {
    userCanEdit: true,
    poa,
    actor,
    outlets,
    products,
    savedDrafts: serializedDrafts,
  };
}