import { notFound, redirect } from "next/navigation";
import type { PoaAuditLog as AuditLogType, User as UserType, PoaLineItem, PoaStatus } from "@prisma/client";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canView, canEdit, canEditDoctor, getSubordinateMRNips, NON_DRAFT_STATUSES,
  canApproveDoctor, canFastTrackApproveDoctor, canCancelApprovedDoctor,
  canRequestEditDoctor, canRespondEditRequestDoctor, getEditLockRoleLabelForDoctor, getLastApproverForDoctor } from "@/lib/authz";
import { computeMonthlyBreakdown, REJECT_CATEGORY_LABELS } from "@/lib/poaUtils";
import { computeActivePsspStats } from "@/lib/activePssp";
import {
  approveDoctorAction, rejectDoctorAction, fastTrackApproveDoctorAction, cancelApprovedByNsmDoctorAction,
  requestEditDoctorAction, grantEditRequestDoctorAction, declineEditRequestDoctorAction } from "@/app/actions/poa";
import type { PoaDoctorApproval } from "@prisma/client";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PoaDetailTabs, type DoctorActions, type DoctorEditRequestInfo, type DoctorRejectInfo } from "@/components/poa/PoaDetailTabs";
import { getActivePsspByOutlets, getPsspEverKodeCust } from "@/app/actions/customer";
import { computeKontesProductTargetsSummary } from "@/lib/targetCalculation";
import { displayRole } from "@/lib/role";
import { getMrSalesSummary } from "@/lib/salesSummary";
import { quarterToMonths } from "@/lib/quarterUtils";
import { EditQuarterControl } from "@/components/poa/EditQuarterControl";

export const metadata = { title: "Detail POA · Form POA" };

const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREATE: "membuat draft",
  UPDATE: "mengedit",
  SUBMIT: "mengajukan",
  APPROVE: "menyetujui",
  REVISE: "mengedit (kembali ke Revisi)",
  REJECT: "menolak",
  CANCEL: "membatalkan approval (kembali ke Revisi)",
  REQUEST_EDIT: "mengajukan permintaan edit",
  GRANT_EDIT: "menyetujui permintaan edit (kembali ke Revisi)",
  DECLINE_EDIT: "menolak permintaan edit",
};

const AUDIT_OP_LABELS: Record<string, string> = {
  add: "menambahkan produk",
  update: "mengedit produk",
  delete: "menghapus produk",
};

type AuditSnapshot = { notes?: string; customer?: string | null; product?: string | null; op?: string; namaCust?: string; kodePI?: string } | null;

function auditActionLabel(action: string, snapshot: AuditSnapshot) {
  if ((action === "UPDATE" || action === "REVISE") && snapshot?.op && AUDIT_OP_LABELS[snapshot.op]) {
    const base = AUDIT_OP_LABELS[snapshot.op];
    return action === "REVISE" ? `${base} (kembali ke Revisi)` : base;
  }
  return AUDIT_ACTION_LABELS[action] ?? action.toLowerCase();
}

export default async function PoaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const { id } = await params;
  const [poa, actor] = await Promise.all([
    prisma.poaForm.findUnique({
      where: { id },
      include: {
        owner: true,
        currentHolder: true,
        items: { orderBy: { createdAt: "asc" } },
        doctorApprovals: { include: { currentHolder: true } },
        auditLogs: {
          include: { actor: true },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.user.findUniqueOrThrow({ where: { nip: session.userId } }),
  ]);

  if (!poa) notFound();

  const hasAccess = await canView(actor, poa);
  if (!hasAccess) redirect("/dashboard");

  const userCanEdit = await canEdit(actor, poa);

  // Per-doctor approval (docs/poa-per-doctor-approval/, 2026-08-13) — build
  // one row per doctor in this draft (from its line items), joined with its
  // PoaDoctorApproval row if one exists (a doctor still sitting in DRAFT/
  // REVISI within an otherwise in-flight draft has no row yet — see
  // PoaDoctorApproval's doc comment in schema.prisma).
  const doctorApprovalByKey = new Map<string, PoaDoctorApproval>(
    poa.doctorApprovals.map((a: PoaDoctorApproval) => [`${a.kodePI}|${a.namaCust}`, a])
  );
  // Plain, serializable twin of doctorApprovalByKey (just the status) for the
  // "use client" DraftChecklist tree below — feeds the per-doctor "Ajukan"
  // button (docs/poa-per-doctor-approval/, OQ-2) so it only shows for a
  // doctor with no approval row yet or sitting in REVISI.
  const doctorStatuses: Record<string, PoaStatus> = Object.fromEntries(
    [...doctorApprovalByKey.entries()].map(([key, a]) => [key, a.status])
  );
  // Same twin, just the version — feeds the "Version X" chip next to each
  // doctor's own StatusBadge (per-doctor now, not one whole-draft badge —
  // see DraftChecklist's DoctorRow).
  const doctorVersions: Record<string, number> = Object.fromEntries(
    [...doctorApprovalByKey.entries()].map(([key, a]) => [key, a.version])
  );
  const doctorKeysInDraft = new Map<string, { kodePI: string; namaCust: string }>();
  for (const it of poa.items as PoaLineItem[]) {
    if (!it.kodePI) continue;
    doctorKeysInDraft.set(`${it.kodePI}|${it.namaCust}`, { kodePI: it.kodePI, namaCust: it.namaCust });
  }
  const isOwnerEarly = poa.ownerId === session.userId;
  // Audit logs grouped by doctorApprovalId (already fetched, ascending by
  // createdAt) — used below to detect each doctor's own pending edit request
  // without a fresh query per doctor.
  const auditLogsByDoctorApprovalId = new Map<string, typeof poa.auditLogs>();
  for (const log of poa.auditLogs) {
    if (!log.doctorApprovalId) continue;
    const arr = auditLogsByDoctorApprovalId.get(log.doctorApprovalId) ?? [];
    arr.push(log);
    auditLogsByDoctorApprovalId.set(log.doctorApprovalId, arr);
  }

  const doctorRows = await Promise.all(
    [...doctorKeysInDraft.values()].map(async ({ kodePI, namaCust }) => {
      const approval = doctorApprovalByKey.get(`${kodePI}|${namaCust}`) ?? null;
      const canApproveThis = approval ? canApproveDoctor(actor, approval) : false;
      const canFastTrackThis = approval ? await canFastTrackApproveDoctor(actor, poa, approval) : false;
      const canCancelThis = approval ? await canCancelApprovedDoctor(actor, poa, approval) : false;

      // Per-doctor edit request (docs/poa-per-doctor-approval/, 2026-08-18:
      // "tidak ada approval, request edit, dan revisi yang by draft" — this
      // used to be one whole-draft banner at the top of the page; now every
      // doctor has its own lock/request-edit state, same as approve/reject.
      const editLockRoleLabelThis = !canApproveThis && (["MR", "ASM", "SM", "NSM"] as string[]).includes(session.role)
        ? await getEditLockRoleLabelForDoctor(poa, approval)
        : null;
      const userCanEditThis = await canEditDoctor(actor, poa, approval);
      const canRequestEditThis = isOwnerEarly && !userCanEditThis && (await canRequestEditDoctor(actor, poa, approval));
      const logsForDoctor = approval ? auditLogsByDoctorApprovalId.get(approval.id) ?? [] : [];
      const lastLogForDoctor = logsForDoctor[logsForDoctor.length - 1];
      const pendingEditRequestThis = lastLogForDoctor?.action === "REQUEST_EDIT";
      const lastApproverThis = (canRequestEditThis || pendingEditRequestThis) && approval
        ? await getLastApproverForDoctor(approval.id)
        : null;
      const canRespondEditRequestThis = pendingEditRequestThis && approval
        ? await canRespondEditRequestDoctor(actor, approval)
        : false;

      // Rejection label (2026-08-19: "si MR bisa liat mana line yang di
      // reject") — a doctor sitting in REVISI whose most recent log is a
      // REJECT (or an atasan CANCEL of an earlier approval) came back for a
      // reason; surface that reason/category on the row itself instead of
      // making the owner dig through the collapsed whole-draft "Riwayat
      // Aktivitas" log to find which of possibly many doctors it applies to.
      // A REVISI reached via GRANT_EDIT or the owner's own edit (REVISE) has
      // no rejection behind it, so those are deliberately excluded.
      const rejectLogThis = approval?.status === "REVISI" && lastLogForDoctor
        && (lastLogForDoctor.action === "REJECT" || lastLogForDoctor.action === "CANCEL")
        ? lastLogForDoctor
        : null;

      return {
        kodePI, namaCust, approval, canApproveThis, canFastTrackThis, canCancelThis,
        editLockRoleLabelThis, canRequestEditThis, pendingEditRequestThis, lastApproverThis, canRespondEditRequestThis,
        pendingEditRequestNote: pendingEditRequestThis && lastLogForDoctor?.snapshot && typeof lastLogForDoctor.snapshot === "object" && "notes" in lastLogForDoctor.snapshot
          ? (lastLogForDoctor.snapshot as { notes?: string }).notes ?? null
          : null,
        rejectLogThis,
      };
    })
  );

  // Batch-resolve names for every doctor's last-approver, instead of one
  // findUnique per doctor (docs/PERFORMANCE.md — batch, don't query in a loop).
  const approverNips = [...new Set(doctorRows.map((d) => d.lastApproverThis?.actorId).filter((v): v is string => !!v))];
  const approverUsers = approverNips.length > 0
    ? await prisma.user.findMany({ where: { nip: { in: approverNips } }, select: { nip: true, name: true } })
    : [];
  const approverNameByNip = new Map(approverUsers.map((u: { nip: string; name: string }) => [u.nip, u.name]));

  // Atasan actions (approve/reject/fast-track/cancel), keyed the same way as
  // doctorStatuses so DraftChecklist's DoctorRow can render them inline in
  // the same row instead of a separate "Tindakan Per Dokter" list (2026-08-14
  // request: "kenapa ga dibuat menyatu di draftnya juga"). Bound server
  // actions cross the server->client boundary as props exactly like the
  // <form action={...}> bindings did before — same pattern, just handed down
  // instead of rendered right here.
  const doctorActions: Record<string, DoctorActions> = Object.fromEntries(
    doctorRows
      .filter((d) => d.canApproveThis || d.canFastTrackThis || d.canCancelThis)
      .map((d) => [`${d.kodePI}|${d.namaCust}`, {
        canApprove: d.canApproveThis,
        canFastTrack: d.canFastTrackThis,
        canCancel: d.canCancelThis,
        approveAction: approveDoctorAction.bind(null, id, d.kodePI, d.namaCust),
        rejectAction: rejectDoctorAction.bind(null, id, d.kodePI, d.namaCust),
        fastTrackAction: fastTrackApproveDoctorAction.bind(null, id, d.kodePI, d.namaCust),
        cancelAction: cancelApprovedByNsmDoctorAction.bind(null, id, d.kodePI, d.namaCust),
      }])
  );

  // Per-doctor edit-lock/request-edit info — computed for EVERY doctor (not
  // filtered like doctorActions above), since the owner needs to see their
  // own lock/request state even when they have zero atasan rights.
  const doctorEditRequests: Record<string, DoctorEditRequestInfo> = Object.fromEntries(
    doctorRows.map((d) => [`${d.kodePI}|${d.namaCust}`, {
      editLockRoleLabel: d.editLockRoleLabelThis,
      pendingEditRequest: d.pendingEditRequestThis,
      pendingEditRequestNote: d.pendingEditRequestNote,
      lastApproverLabel: d.lastApproverThis
        ? `${approverNameByNip.get(d.lastApproverThis.actorId) ?? d.lastApproverThis.actorId} (${displayRole(d.lastApproverThis.role)})`
        : null,
      canRequestEdit: d.canRequestEditThis,
      canRespondEditRequest: d.canRespondEditRequestThis,
      requestEditAction: requestEditDoctorAction.bind(null, id, d.kodePI, d.namaCust),
      grantEditRequestAction: grantEditRequestDoctorAction.bind(null, id, d.kodePI, d.namaCust),
      declineEditRequestAction: declineEditRequestDoctorAction.bind(null, id, d.kodePI, d.namaCust),
    }])
  );

  // Per-doctor rejection info — only present for a doctor currently in REVISI
  // because of a REJECT/CANCEL (see rejectLogThis above), keyed the same way
  // as doctorStatuses/doctorEditRequests for DraftChecklist's DoctorRow.
  const doctorRejectInfo: Record<string, DoctorRejectInfo> = Object.fromEntries(
    doctorRows
      .filter((d) => d.rejectLogThis)
      .map((d) => {
        const log = d.rejectLogThis!;
        const snapshot = log.snapshot as { notes?: string } | null;
        return [`${d.kodePI}|${d.namaCust}`, {
          action: log.action as "REJECT" | "CANCEL",
          category: log.rejectCategory ? (REJECT_CATEGORY_LABELS[log.rejectCategory] ?? log.rejectCategory) : null,
          reason: snapshot?.notes ?? null,
          rejectedByLabel: `${log.actor.name} (${displayRole(log.actor.role)})`,
        }];
      })
  );

  // Whoever owns this POA drives the submit/checklist UI — normally an MR, but
  // an ASM/SM/NSM can own one themselves when their team is vacant (see
  // canCreatePoa in authz.ts).
  const isOwner = isOwnerEarly;
  const isFullyApproved = poa.status === "APPROVED_BY_NSM";
  const isDraft = poa.status === "DRAFT";
  const isRevisi = poa.status === "REVISI";

  const allItems = (poa as typeof poa & { items: PoaLineItem[] }).items;
  const toNum = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

  // PSSP Aktif reflects the MR's whole assigned territory, not just the doctors
  // already drafted into this POA — dummy accounts have no real outlet
  // assignment to scope by, so the section is simply empty for them.
  let activePssp: Awaited<ReturnType<typeof getActivePsspByOutlets>> = [];
  if (!poa.owner.isDummy) {
    const now = new Date();
    const periode = now.getFullYear() * 100 + (now.getMonth() + 1);
    const assignments = await prisma.mrOutletAssignment.findMany({
      where: { nipMR: poa.ownerId, periode },
      select: { kodePI: true },
    });
    activePssp = await getActivePsspByOutlets(assignments.map((a: { kodePI: string }) => a.kodePI));
  }

  // "Informasi PSSP Outlet" dropdown per DoctorRow (2026-08-10) — per-outlet
  // jumlah user + Rencana yang SUDAH DISUBMIT (non-draft), tercacah ke
  // kuartal POA ini. Scoped ke outlet yang genuinely ada di draft ini (bukan
  // seluruh territory MR seperti activePssp di atas — dropdown ini cuma
  // pernah dirender untuk outlet yang punya baris dokter). Batched SEKALI di
  // sini (bukan per-row) — lihat docs/PERFORMANCE.md §2.4, jangan query di
  // dalam loop per item.
  const outletKodesInDraftSet = new Set<string>();
  for (const it of allItems as PoaLineItem[]) {
    if (it.kodePI) outletKodesInDraftSet.add(it.kodePI);
  }
  const outletKodesInDraft: string[] = [...outletKodesInDraftSet];
  const outletPsspInfo: Record<string, {
    userCount: number;
    rencanaTercacahEstimasi: number; rencanaTercacahNilaiPssp: number;
    aktifTercacahEstimasi: number; aktifTercacahNilaiPssp: number;
  }> = {};
  // Keyed by `${kodePI}|${namaCust}` — same doctorKey convention as DraftChecklist.tsx.
  const doctorPsspInfo: Record<string, { aktifTercacahEstimasi: number; aktifTercacahNilaiPssp: number }> = {};
  if (outletKodesInDraft.length > 0) {
    const quarterMonthsForOutletInfo = /^\d{4}-Q[1-4]$/.test(poa.period) ? quarterToMonths(poa.period) : [];

    // PSSP Aktif di sini SENGAJA di-query langsung per outlet yang ada di
    // draft ini (getActivePsspByOutlets), BUKAN reuse `activePssp` di atas —
    // `activePssp` itu scoped ke MrOutletAssignment PEMILIK POA ini untuk
    // bulan berjalan, yang bisa saja TIDAK mencakup outlet seorang dokter
    // (mis. outlet itu baru pindah assignment, atau memang dikelola MR lain
    // secara historis) padahal kontrak PSSP aktifnya genuinely ada di outlet
    // itu — bug ditemukan 2026-08-10 (dropdown "PSSP Outlet" tetap "-" walau
    // ada kontrak aktif riil). Fix: query independen dari assignment siapa
    // pun, murni berdasar outlet yang dokternya sudah masuk draft ini.
    const [userCounts, submittedItems, outletActivePsspRows] = await Promise.all([
      prisma.customerOutlet.groupBy({
        by: ["kodePI"],
        where: { kodePI: { in: outletKodesInDraft } },
        _count: { _all: true },
      }),
      prisma.poaLineItem.findMany({
        where: { kodePI: { in: outletKodesInDraft }, poa: { status: { in: NON_DRAFT_STATUSES } } },
        select: { kodePI: true, periodeAwal: true, lamaPeriode: true, rencanaTotalBiaya: true, persenPsspDokter: true, pengaliNilaiR: true },
      }),
      getActivePsspByOutlets(outletKodesInDraft),
    ]);

    const itemsByOutlet = new Map<string, typeof submittedItems>();
    for (const it of submittedItems) {
      if (!it.kodePI) continue;
      const g = itemsByOutlet.get(it.kodePI) ?? [];
      g.push(it);
      itemsByOutlet.set(it.kodePI, g);
    }

    for (const kodePI of outletKodesInDraft) {
      const userCount = userCounts.find((u: { kodePI: string; _count: { _all: number } }) => u.kodePI === kodePI)?._count._all ?? 0;

      const breakdown = computeMonthlyBreakdown(itemsByOutlet.get(kodePI) ?? []);
      let rencanaTercacahEstimasi = 0, rencanaTercacahNilaiPssp = 0;
      for (const m of quarterMonthsForOutletInfo) {
        const v = breakdown.get(m);
        if (v) { rencanaTercacahEstimasi += v.estimasi; rencanaTercacahNilaiPssp += v.nilaiPssp; }
      }

      const aktifStats = computeActivePsspStats(
        outletActivePsspRows.filter((r) => r.kdOutlet === kodePI),
        quarterMonthsForOutletInfo
      );

      outletPsspInfo[kodePI] = {
        userCount,
        rencanaTercacahEstimasi, rencanaTercacahNilaiPssp,
        aktifTercacahEstimasi: aktifStats.estBarisTercacah,
        aktifTercacahNilaiPssp: aktifStats.nilaiTercacah,
      };
    }

    // Per-dokter Estimasi Aktif (docs/TODO.md #17, 2026-08-13) — same source
    // rows as outletPsspInfo above (outlet-wide), narrowed further to just
    // THIS doctor's own kodeCust so DoctorRow can show its own active-PSSP
    // figure instead of only the outlet-wide total. Doctors without a
    // kodeCust (isManualCustomer, not yet in the synced CDB) simply have no
    // PSSP contracts to match against and get zeros — same limitation as
    // everywhere else PSSP is matched by kodeCust.
    const doctorKeysForPsspInfo = new Map<string, { kodePI: string; kodeCust: string | null }>();
    for (const it of allItems as PoaLineItem[]) {
      if (!it.kodePI) continue;
      doctorKeysForPsspInfo.set(`${it.kodePI}|${it.namaCust}`, { kodePI: it.kodePI, kodeCust: it.kodeCust });
    }
    for (const [key, { kodePI, kodeCust }] of doctorKeysForPsspInfo) {
      if (!kodeCust) continue;
      const stats = computeActivePsspStats(
        outletActivePsspRows.filter((r) => r.kdOutlet === kodePI && r.kdCust === kodeCust),
        quarterMonthsForOutletInfo
      );
      if (stats.estBarisTercacah === 0 && stats.nilaiTercacah === 0) continue;
      doctorPsspInfo[key] = { aktifTercacahEstimasi: stats.estBarisTercacah, aktifTercacahNilaiPssp: stats.nilaiTercacah };
    }
  }

  // Which of this POA's already-matched doctors (kodeCust set) have EVER had a
  // PSSP contract — see getPsspEverKodeCust's doc comment (stakeholder #11).
  const everPsspKodeCust = await getPsspEverKodeCust(
    allItems.map((it: PoaLineItem) => it.kodeCust).filter((k: string | null): k is string => !!k)
  );

  // "Data Sales" card — real figures (mkt_insight.dbo.DIR10001B, synced into
  // OutletSalesValueMonthly), scoped to this MR's own outlets. Same dummy-
  // account exception as PSSP Aktif above.
  const salesSummary = poa.owner.isDummy
    ? { historisTahunLalu: 0, historisTahunLaluLabel: String(new Date().getFullYear() - 1), salesYtd: 0, growthPct: 0 }
    : await getMrSalesSummary(poa.ownerId);

  // Quarterly unit-quantity target per kontes product for the MR's SM territory
  // (from the same engine the NSM/Admin "Simulasi Target Produk" page uses) —
  // only meaningful for a real "YYYY-Q#" period and a resolvable SM in the org chain.
  let kontesProductTargets: {
    kodeProduk: string;
    namaProduk: string;
    quarterlyTargetQty: number;
    quarterlyTargetValue: number;
    estimasiQty: number;
    estimasiValue: number;
  }[] = [];
  if (/^\d{4}-Q[1-4]$/.test(poa.period)) {
    const ownerWithChain = await prisma.user.findUnique({
      where: { nip: poa.ownerId },
      select: { reportsTo: { select: { nipAtasan: true } } },
    });
    const smNip = ownerWithChain?.reportsTo?.nipAtasan ?? null;
    if (smNip) {
      // This MR's own plan (estimasi), summed per product from their draft line items —
      // shown alongside the SM-territory target so they can compare plan vs. target directly.
      const estimasiByProduk = new Map<string, { qty: number; value: number }>();
      for (const it of allItems) {
        const cur = estimasiByProduk.get(it.kodeProduk) ?? { qty: 0, value: 0 };
        cur.qty += it.qtyProdukResep ?? 0;
        cur.value += toNum(it.rencanaTotalBiaya);
        estimasiByProduk.set(it.kodeProduk, cur);
      }

      const summary = await computeKontesProductTargetsSummary(poa.period);
      kontesProductTargets = summary.products
        .map((p) => {
          const territory = p.territories.find((t) => t.smNip === smNip);
          const estimasi = estimasiByProduk.get(p.kodeProduk);
          return {
            kodeProduk: p.kodeProduk,
            namaProduk: p.namaProduk,
            quarterlyTargetQty: territory?.quarterlyTargetQty ?? 0,
            quarterlyTargetValue: territory?.quarterlyTargetValue ?? 0,
            estimasiQty: estimasi?.qty ?? 0,
            estimasiValue: estimasi?.value ?? 0,
          };
        })
        .sort((a, b) => a.namaProduk.localeCompare(b.namaProduk, "id"));
    }
  }

  // Target Value (2026-08-03, widened same day — stakeholder item #11: label
  // "Target Area" → "Target", calculation = SUM dari Personil) — monthly
  // Rupiah sales target per GT, imported from "Target Hospital (in
  // Value).xlsx" into TargetHospitalValue, summed over the months in this
  // POA's quarter, across every MR getSubordinateMRNips resolves for the
  // owner: just the owner's own nip for a normal MR-owned POA (unchanged
  // behavior), or every subordinate MR when an ASM/SM/NSM owns the POA
  // themselves (vacant-team case) — previously that case fell back to "-"
  // entirely since only poa.ownerId (the ASM/SM's own nip, never a GT) was
  // ever queried. poa.target (manual, set by atasan) still wins if it's ever
  // populated — this only fills the gap while that field stays unused.
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
      targetValueFromGT = rows.reduce((sum: number, r: { target: { toString(): string } }) => sum + parseFloat(r.target.toString()), 0);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1>Detail POA</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            {userCanEdit && (isDraft || isRevisi)
              ? <EditQuarterControl poaId={poa.id} period={poa.period} />
              : `Periode ${poa.period}`}
            {" "}· {poa.owner.name} ({poa.owner.nip})
            {poa.currentHolder && (
              <span className="ml-2" style={{ color: "var(--color-text-faint)" }}>
                · Pemegang: {poa.currentHolder.name} ({displayRole(poa.currentHolder.role, poa.currentHolder.jabatan)})
              </span>
            )}
          </p>

          {/* Currency-unit note (2026-08-10) — formatCurrency (src/lib/format.ts)
              shows every Rupiah figure on this page scaled ÷1.000.000 with no
              suffix (e.g. "1,25" not "Rp 1.250.000"), so callers need this caption
              to not misread the scaled number as the raw Rupiah value. */}
          <p className="mt-1 text-xs" style={{ color: "var(--color-text-faint)" }}>
            Note: Satuan nilai uang di halaman ini dalam Juta (dibagi 1.000.000)
          </p>
        </div>
        <StatusBadge status={poa.status} version={poa.version} />
      </div>

      {/* Export button */}
      <div>
        <a href={`/api/poa/${id}/export`}>
          <Button size="sm" variant="ghost">↓ Export Excel</Button>
        </a>
      </div>

      {/* Edit-lock / request-edit is per-doctor now (docs/poa-per-doctor-approval/,
          2026-08-18) — rendered inline in each doctor's own row inside
          PoaDetailTabs/DraftChecklist via doctorEditRequests below, same
          pattern as the per-doctor Approval panel. Nothing to render at this
          whole-draft level anymore. */}

      {/* Drafting / Produk Kontes / History PSSP Aktif tabs */}
      <PoaDetailTabs
        items={allItems}
        poaId={id}
        poaPeriod={poa.period}
        poaStatus={poa.status}
        poaVersion={poa.version}
        showSubmit={userCanEdit && isOwner && (isDraft || isRevisi)}
        userCanEdit={userCanEdit}
        selectable={isOwner}
        doctorStatuses={doctorStatuses}
        doctorVersions={doctorVersions}
        doctorActions={doctorActions}
        doctorEditRequests={doctorEditRequests}
        doctorRejectInfo={doctorRejectInfo}
        activePssp={activePssp}
        outletPsspInfo={outletPsspInfo}
        doctorPsspInfo={doctorPsspInfo}
        everPsspKodeCust={everPsspKodeCust}
        kontesProductTargets={kontesProductTargets}
        salesSummary={salesSummary}
        targetArea={targetValueFromGT ?? undefined}
      />

      {/* Actions — approver only, per dokter (docs/poa-per-doctor-approval/,
          2026-08-13: approve/reject bergerak per dokter, bukan per draft —
          atasan bisa approve Dokter A sambil reject Dokter B di draft yang
          sama). Rendered inline in each doctor's own row inside
          PoaDetailTabs/DraftChecklist (2026-08-14: merged instead of a
          separate list here, see doctorActions above) — nothing left to
          render at this level. MR submit tetap ada di dalam DraftChecklist. */}

      {isFullyApproved && (
        <div className="rounded-md px-4 py-3 text-sm font-medium"
          style={{ background: "var(--color-green-light)", color: "var(--color-green)" }}>
          POA ini telah sepenuhnya disetujui oleh NSM.
        </div>
      )}

      {/* Audit log */}
      <details>
        <summary className="cursor-pointer select-none list-none">
          <Card>
            <div className="flex items-center justify-between">
              <p className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>Riwayat Aktivitas</p>
              <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Klik untuk lihat ▼</p>
            </div>
          </Card>
        </summary>
        <Card className="mt-2">
          {poa.auditLogs.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Belum ada aktivitas.</p>
          ) : (
            <ol className="relative space-y-4 pl-5 border-l" style={{ borderColor: "var(--color-border)" }}>
              {(poa.auditLogs as (AuditLogType & { actor: UserType })[]).map((log) => {
                const snapshot = log.snapshot as AuditSnapshot;
                const hasDetail = !!(snapshot?.customer || snapshot?.product);
                return (
                  <li key={log.id} className="relative">
                    <span className="absolute left-[-1.4rem] mt-1 h-2.5 w-2.5 rounded-full border-2 border-white"
                      style={{ background: "var(--color-blue)" }} />
                    <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                      {new Date(log.createdAt).toLocaleString("id-ID")}
                    </p>
                    <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                      {log.actor.name}
                      <span className="ml-1.5 font-normal" style={{ color: "var(--color-text-muted)" }}>
                        {auditActionLabel(log.action, snapshot)}
                      </span>
                      {snapshot?.namaCust && (
                        <span className="ml-1.5 font-normal" style={{ color: "var(--color-blue)" }}>
                          — {snapshot.namaCust}
                        </span>
                      )}
                    </p>
                    {log.toStatus && log.toStatus !== log.fromStatus && (
                      <p className="mt-0.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
                        → {log.toStatus.replace(/_/g, " ")}
                      </p>
                    )}
                    {log.rejectCategory && (
                      <p className="mt-0.5 text-xs" style={{ color: "var(--color-red)" }}>
                        Kategori: {REJECT_CATEGORY_LABELS[log.rejectCategory] ?? log.rejectCategory}
                      </p>
                    )}
                    {snapshot?.notes && (
                      <p className="mt-1 text-xs italic" style={{ color: "var(--color-text-muted)" }}>
                        &quot;{snapshot.notes}&quot;
                      </p>
                    )}
                    {hasDetail && (
                      <details className="mt-1">
                        <summary className="cursor-pointer select-none text-xs" style={{ color: "var(--color-blue)" }}>
                          Lihat Detail
                        </summary>
                        <div className="mt-1 rounded border px-2 py-1.5 text-xs space-y-0.5"
                          style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
                          {snapshot?.customer && (
                            <p><span style={{ color: "var(--color-text-faint)" }}>Customer:</span> {snapshot.customer}</p>
                          )}
                          {snapshot?.product && (
                            <p><span style={{ color: "var(--color-text-faint)" }}>Produk:</span> {snapshot.product}</p>
                          )}
                        </div>
                      </details>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </details>
    </div>
  );
}
