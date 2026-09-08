import type { PoaStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSalesCounterOutletsDirect, getScProducts } from "@/lib/masterData";
import { getBlastInOutletSet } from "@/lib/outletBlastIn";

import { canUserEditScForm } from "@/lib/authz";

export async function getSalesCounterEditData(id: string, periodParam: string | undefined, sessionUserId: string, sessionRole?: string) {
  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: sessionUserId } });

  let targetPeriod = id;
  let targetOwnerId = sessionUserId;

  // Check if id is a form ID (cuid / uuid)
  const formById = await prisma.poaScForm.findUnique({
    where: { id },
    select: { period: true, ownerId: true, status: true, version: true },
  });

  if (formById) {
    targetPeriod = formById.period;
    targetOwnerId = formById.ownerId;
  }

  const poa = {
    id: targetPeriod,
    period: targetPeriod,
    status: formById?.status || ("DRAFT" as PoaStatus),
    version: formById?.version || 1,
    ownerId: targetOwnerId,
    owner: actor,
  };

  const isSelf = targetOwnerId === sessionUserId;
  const isSpecialRole = sessionRole != null && ["ADMIN", "GM", "SFE", "VIEWER"].includes(sessionRole);
  const draftsWhere: any = { ownerId: targetOwnerId, period: targetPeriod };
  if (!isSelf && !isSpecialRole) {
    draftsWhere.status = { not: "DRAFT" as PoaStatus };
  }

  const savedDrafts = await prisma.poaScForm.findMany({
    where: draftsWhere,
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

  const [rawOutlets, products, blastInSet] = await Promise.all([
    getSalesCounterOutletsDirect(sessionUserId),
    getScProducts(),
    getBlastInOutletSet(),
  ]);

  const outlets = rawOutlets
    .filter((o) => o.kodePI != null)
    .map((o) => ({
      kodePI: o.kodePI as string,
      namaOutlet: o.namaOutlet,
      groupRS: o.groupRS ?? null,
      sector: (o as any).sector ?? (o as any).sektor ?? null,
      subSektor: (o as any).subSektor ?? (o as any).subsektor ?? null,
      is_sc: !!(o as any).is_sc,
      jumlah_sc: (o as any).jumlah_sc ?? null,
      isBlastIn: blastInSet.has(o.kodePI as string),
      isOnline: !!(o as any).isOnline,
      created: (o as any).created ?? (o as any).created_at ?? null,
    }));

  const outletScMap = new Map(rawOutlets.map((o) => [o.kodePI, !!(o as any).is_sc]));

  const serializedDrafts = savedDrafts.map((draft: any) => ({
    ...draft,
    is_sc: outletScMap.get(draft.kodePI) ?? false,
    isBlastIn: blastInSet.has(draft.kodePI),
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

  // Owner (isSelf) can always access the editor to add new outlets or edit unapproved drafts.
  // Existing approved outlets are guarded as read-only per-outlet inside the editor.
  const userCanEdit = isSelf
    ? true
    : canUserEditScForm(sessionRole || "MR", sessionUserId, targetOwnerId, poa.status);

  return {
    userCanEdit,
    poa,
    actor,
    outlets,
    products,
    savedDrafts: serializedDrafts,
  };
}