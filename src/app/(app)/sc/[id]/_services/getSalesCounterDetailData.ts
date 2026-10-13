import { PoaStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getScSubordinateIdsUnder } from "@/lib/authz";
import { getMrSalesSummary } from "@/lib/salesSummary";
import { resolveTargetHospitalValueFallback } from "@/lib/targetHospitalValue";
import type { ScDraftFormItem } from "@/components/sc/types";
import { getBlastInOutletSet } from "@/lib/outletBlastIn";
import { getSalesCounterOutletsDirect } from "@/lib/masterData";
import { b3RangeLabelFromEnd, getB3RollingPeriodInfo } from "@/lib/b3Utils";
import { SC_DRAFT_FORM_INCLUDE, loadScLiveOutletData, loadScMasterProducts, toScDraftItem } from "../../_services/scDraftItems";

export async function getSalesCounterDetailData(
  id: string,
  sessionUserId: string,
  sessionRole: string,
  ownerNip?: string,
  approvalType?: string
) {
  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: sessionUserId } });

  let targetOwnerId = sessionUserId;
  let targetPeriod = id;

  // Check if id is a specific PoaScForm.id
  const formById = await prisma.poaScForm.findUnique({
    where: { id },
    select: { ownerId: true, period: true, currentHolderId: true },
  });

  if (formById) {
    targetOwnerId = formById.ownerId;
    targetPeriod = formById.period;
  } else if (ownerNip) {
    targetOwnerId = ownerNip;
    targetPeriod = id;
  }

  const targetUser = targetOwnerId === sessionUserId
    ? actor
    : await prisma.user.findUnique({ where: { nip: targetOwnerId } });

  const isAsmApproval = approvalType?.toUpperCase() === "ASM";
  const subordinateMrIds = isAsmApproval
    ? await getScSubordinateIdsUnder(targetOwnerId, 1)
    : [];
  const targetOwnerIds = isAsmApproval
    ? Array.from(new Set([targetOwnerId, ...subordinateMrIds]))
    : [targetOwnerId];

  // Fast-path access check
  let hasAccess = false;
  const isSelf = targetOwnerId === sessionUserId;
  const isSpecialRole = ["ADMIN", "GM", "SFE", "VIEWER", "SD"].includes(sessionRole);
  const isEditRole = ["ADMIN", "ASM", "SM", "NSM"].includes(sessionRole);

  if (isSelf || isSpecialRole) {
    hasAccess = true;
  } else {
    const depthByRole: Record<string, number> = { ASM: 1, SM: 2, NSM: 3 };
    const depth = depthByRole[sessionRole] ?? 1;
    const subIds = await getScSubordinateIdsUnder(sessionUserId, depth);
    const isSubordinate = subIds.includes(targetOwnerId) || targetOwnerIds.some((uid) => subIds.includes(uid));

    if (isSubordinate) {
      const submittedCount = await prisma.poaScForm.count({
        where: {
          ownerId: { in: targetOwnerIds },
          period: targetPeriod,
          status: { not: PoaStatus.DRAFT },
        },
      });
      hasAccess = submittedCount > 0;
    } else {
      const holderCount = await prisma.poaScForm.count({
        where: {
          ownerId: { in: targetOwnerIds },
          period: targetPeriod,
          currentHolderId: sessionUserId,
          status: { not: PoaStatus.DRAFT },
        },
      });
      hasAccess = holderCount > 0;
    }
  }

  if (!hasAccess) return { hasAccess: false };

  const draftsWhere: any = {
    ownerId: { in: targetOwnerIds },
    period: targetPeriod,
  };
  if (!isSelf && !isSpecialRole) {
    draftsWhere.status = { not: PoaStatus.DRAFT };
  }

  const drafts = await prisma.poaScForm.findMany({
    where: draftsWhere,
    // Audit logs: the per-outlet cards only need them for revision / edit-request
    // info; the Riwayat Aktivitas section loads its logs on demand (getScActivityLogsAction).
    include: { ...SC_DRAFT_FORM_INCLUDE, owner: true, currentHolder: true },
  });

  let poa: any = null;
  if (drafts.length > 0) {
    const first = drafts[0];
    poa = {
      id: targetPeriod,
      period: targetPeriod,
      status: first.status,
      version: first.version,
      ownerId: isAsmApproval ? targetOwnerId : first.ownerId,
      owner: isAsmApproval ? (targetUser || first.owner) : first.owner,
      currentHolderId: first.currentHolderId,
      currentHolder: first.currentHolder,
      entertainItems: drafts
        .flatMap((d: any) => d.entertainItems)
        .map((e: any) => ({
          ...e,
          biayaEntertain: Number(e.biayaEntertain.toString()),
        })),
    };
  } else {
    poa = {
      id: targetPeriod,
      period: targetPeriod,
      status: "DRAFT" as PoaStatus,
      version: 1,
      ownerId: targetOwnerId,
      owner: targetUser || actor,
      currentHolderId: null,
      currentHolder: null,
      entertainItems: [],
    };
  }

  const isOwner = poa.ownerId === sessionUserId;
  // Owner can always add new outlets and manage their DRAFT/REVISI outlets.
  // Each outlet card enforces individual lock status (DRAFT/REVISI vs APPROVED).
  const userCanEdit = isOwner || isEditRole;

  const b3Info = getB3RollingPeriodInfo(targetPeriod);

  // Forms with a stored summary are rendered from their own columns. Canvasser
  // is only asked about outlets that still have a form without one.
  const liveOutletCodes = drafts.filter((d: any) => d.summaryVersion == null).map((d: any) => d.kodePI);

  const [master, blastInSet, rawOutlets, liveByOutlet] = await Promise.all([
    loadScMasterProducts(drafts.flatMap((d: any) => d.products.map((p: any) => p.kodeProduk))),
    getBlastInOutletSet(),
    getSalesCounterOutletsDirect(targetOwnerId || actor.nip).catch(() => []),
    loadScLiveOutletData(liveOutletCodes, poa.period, b3Info.targetPeriods),
  ]);

  const outletByCode = new Map(rawOutlets.map((o) => [o.kodePI, o]));
  const totalCoverageScOutlets = rawOutlets.filter((o) => !!o.is_sc).length;

  const scDrafts: ScDraftFormItem[] = drafts.map((d: any) =>
    toScDraftItem(d, {
      master,
      outlet: outletByCode.get(d.kodePI),
      isBlastIn: blastInSet.has(d.kodePI),
      live: liveByOutlet.get(d.kodePI),
    })
  );

  // One label for the panel: the window the stored history was taken from when
  // every form agrees on it, otherwise today's window like before.
  const storedEnds = new Set(scDrafts.filter((d) => d.hasSummary && d.historyPeriodEnd).map((d) => d.historyPeriodEnd as number));
  const historyQuarterLabel =
    storedEnds.size === 1 && scDrafts.every((d) => d.hasSummary)
      ? b3RangeLabelFromEnd(Array.from(storedEnds)[0])
      : b3Info.rangeLabel;

  const salesSummary = poa.owner?.isDummy
    ? { historisTahunLalu: 0, historisTahunLaluLabel: String(new Date().getFullYear() - 1), salesYtd: 0, growthPct: 0 }
    : await getMrSalesSummary(poa.ownerId).catch(() => ({
        historisTahunLalu: 0,
        historisTahunLaluLabel: String(new Date().getFullYear() - 1),
        salesYtd: 0,
        growthPct: 0,
      }));

  // Live via resolveTargetHospitalValueFallback (2026-09-14 — TargetHospitalValue
  // no longer has a nipMR column, see that function's doc comment).
  const targetValueFromGT = /^\d{4}-Q[1-4]$/.test(poa.period) && poa.owner
    ? (await resolveTargetHospitalValueFallback([{ owner: poa.owner, quarter: poa.period }])).get(`${poa.ownerId}|${poa.period}`) ?? null
    : null;

  return {
    hasAccess: true,
    poa,
    actor,
    userCanEdit,
    isOwner,
    scDrafts,
    salesSummary,
    targetValueFromGT,
    totalCoverageScOutlets,
    historyQuarterLabel,
  };
}