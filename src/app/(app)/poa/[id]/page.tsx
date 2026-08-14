import { notFound, redirect } from "next/navigation";
import type { PoaAuditLog as AuditLogType, User as UserType, PoaLineItem, PoaStatus } from "@prisma/client";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canView, canEdit, canFastTrackApprove, canCancelApproved, getEditLockRoleLabel, canRequestEdit, canRespondEditRequest, getLastApprover, getSubordinateMRNips, NON_DRAFT_STATUSES,
  canApproveDoctor, canFastTrackApproveDoctor, canCancelApprovedDoctor } from "@/lib/authz";
import { computeMonthlyBreakdown, REJECT_CATEGORY_LABELS } from "@/lib/poaUtils";
import { computeActivePsspStats } from "@/lib/activePssp";
import { requestEditAction, grantEditRequestAction, declineEditRequestAction,
  approveDoctorAction, rejectDoctorAction, fastTrackApproveDoctorAction, cancelApprovedByNsmDoctorAction } from "@/app/actions/poa";
import type { PoaDoctorApproval } from "@prisma/client";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { PoaDetailTabs, type DoctorActions } from "@/components/poa/PoaDetailTabs";
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
  // Lock Edit Logic (2026-07-27): only worth explaining to roles that could
  // otherwise have edited (MR/ASM/SM/NSM) — GM/SFE/ADMIN never hit this path
  // (GM is always read-only, ADMIN always passes canEdit regardless).
  const editLockRoleLabel = !userCanEdit && (["MR", "ASM", "SM", "NSM"] as string[]).includes(session.role)
    ? await getEditLockRoleLabel(poa)
    : null;

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
  const doctorKeysInDraft = new Map<string, { kodePI: string; namaCust: string }>();
  for (const it of poa.items as PoaLineItem[]) {
    if (!it.kodePI) continue;
    doctorKeysInDraft.set(`${it.kodePI}|${it.namaCust}`, { kodePI: it.kodePI, namaCust: it.namaCust });
  }
  const doctorRows = await Promise.all(
    [...doctorKeysInDraft.values()].map(async ({ kodePI, namaCust }) => {
      const approval = doctorApprovalByKey.get(`${kodePI}|${namaCust}`) ?? null;
      const canApproveThis = approval ? canApproveDoctor(actor, approval) : false;
      const canFastTrackThis = approval ? await canFastTrackApproveDoctor(actor, poa, approval) : false;
      const canCancelThis = approval ? await canCancelApprovedDoctor(actor, poa, approval) : false;
      return { kodePI, namaCust, approval, canApproveThis, canFastTrackThis, canCancelThis };
    })
  );
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

  const isMR = session.role === "MR";
  // Whoever owns this POA drives the submit/checklist UI — normally an MR, but
  // an ASM/SM/NSM can own one themselves when their team is vacant (see
  // canCreatePoa in authz.ts). isMR alone would wrongly hide those controls.
  const isOwner = poa.ownerId === session.userId;
  const isFullyApproved = poa.status === "APPROVED_BY_NSM";
  const isDraft = poa.status === "DRAFT";
  const isRevisi = poa.status === "REVISI";

  // Edit request (2026-07-28): once locked out (someone above has already
  // approved this cycle), the owner can ask that last approver — whoever
  // approved most recently, e.g. the SM if it's already past them and
  // sitting with NSM — to unlock editing, instead of just waiting for a
  // spontaneous Reject/Cancel. The most recent audit log entry being
  // REQUEST_EDIT is the "pending" signal (no separate stored flag).
  const userCanRequestEdit = isOwner && !userCanEdit && (await canRequestEdit(actor, poa));
  const lastAuditLog = poa.auditLogs[poa.auditLogs.length - 1];
  const pendingEditRequest = lastAuditLog?.action === "REQUEST_EDIT";
  // Needed both to label the "Ajukan Edit ke X" button before a request
  // exists, and to show who a pending request is waiting on afterward.
  const lastApprover = (userCanRequestEdit || pendingEditRequest) ? await getLastApprover(poa.id) : null;
  const lastApproverUser = lastApprover
    ? await prisma.user.findUnique({ where: { nip: lastApprover.actorId } })
    : null;
  const userCanRespondEditRequest = pendingEditRequest && (await canRespondEditRequest(actor, poa));
  const requestEditWithId = requestEditAction.bind(null, id);
  const grantEditRequestWithId = grantEditRequestAction.bind(null, id);
  const declineEditRequestWithId = declineEditRequestAction.bind(null, id);

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

      {editLockRoleLabel && (
        <div className="rounded-md px-4 py-3 text-sm font-medium space-y-3"
          style={{ background: "var(--color-warning-bg, #fef3c7)", color: "var(--color-warning, #f59e0b)" }}>
          <p>
            POA ini terkunci untuk diedit - sudah ada tindakan (approve/edit) dari level {displayRole(editLockRoleLabel)} ke atas.
            {" "}
            {pendingEditRequest
              ? "Menunggu persetujuan permintaan edit di bawah ini."
              : "Tunggu sampai direject/dibatalkan, atau ajukan permintaan edit di bawah ini."}
          </p>
          {pendingEditRequest && isOwner && (
            <p className="font-normal">
              Menunggu persetujuan {lastApproverUser ? `${lastApproverUser.name} (${displayRole(lastApprover?.role ?? "")})` : "atasan"} untuk membuka kembali akses edit.
            </p>
          )}
          {userCanRequestEdit && !pendingEditRequest && (
            <form action={requestEditWithId} className="space-y-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-normal">
                  Alasan permintaan edit (opsional) — akan dikirim ke {lastApprover ? displayRole(lastApprover.role) : "atasan"} yang terakhir approve
                </span>
                <textarea
                  name="reason"
                  rows={2}
                  placeholder="mis. ada koreksi jumlah/estimasi yang perlu diperbaiki…"
                  className="input-field text-sm" />
              </label>
              <Button type="submit" size="sm" variant="secondary">
                Ajukan Edit{lastApprover ? ` ke ${displayRole(lastApprover.role)}` : ""}
              </Button>
            </form>
          )}
        </div>
      )}

      {/* Permintaan edit dari owner — hanya muncul untuk approver terakhir yang dituju */}
      {userCanRespondEditRequest && (
        <Card>
          <CardHeader>
            <CardTitle>Permintaan Edit</CardTitle>
          </CardHeader>
          <p className="text-sm mb-3" style={{ color: "var(--color-text-muted)" }}>
            {poa.owner.name} meminta izin untuk mengedit kembali POA ini yang sudah Anda setujui.
            {lastAuditLog?.snapshot && typeof lastAuditLog.snapshot === "object" && "notes" in lastAuditLog.snapshot && lastAuditLog.snapshot.notes
              ? ` Alasan: "${lastAuditLog.snapshot.notes}"`
              : ""}
          </p>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <form action={grantEditRequestWithId}>
              <Button type="submit" style={{ background: "var(--color-green, #16a34a)", color: "#fff" }}>
                Setujui Permintaan Edit (kembali ke Revisi)
              </Button>
            </form>
          </div>
          <form action={declineEditRequestWithId} className="pt-3 space-y-2" style={{ borderTop: "1px solid var(--color-border)" }}>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Alasan Menolak</span>
              <textarea
                name="reason"
                required
                rows={2}
                placeholder="Jelaskan alasan menolak permintaan edit ini…"
                className="input-field text-sm" />
            </label>
            <Button type="submit" variant="danger">
              Tolak Permintaan Edit
            </Button>
          </form>
        </Card>
      )}

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
        doctorActions={doctorActions}
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
                        "{snapshot.notes}"
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
