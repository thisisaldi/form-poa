"use client";

import { useMemo, useState } from "react";
import type { PoaLineItem, PoaStatus } from "@prisma/client";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { DraftChecklist, ActivePsspListCard, formatRp } from "@/components/poa/DraftChecklist";
import { quarterToMonths, quarterLabelFromMonths } from "@/lib/quarterUtils";
import { computeActivePsspStats } from "@/lib/activePssp";
import type { ActivePsspRow } from "@/app/actions/customer";

type TabKey = "drafting" | "produkKontes" | "pssp";

interface KontesProductTarget {
  kodeProduk: string;
  namaProduk: string;
  quarterlyTargetQty: number;
  quarterlyTargetValue: number;
  estimasiQty: number;
  estimasiValue: number;
}

// Splits the Detail POA page into 3 tabs: Drafting (checklist + light summaries),
// Produk Kontes (full per-product quarterly target breakdown), History PSSP Aktif
// (full per-doctor/per-contract breakdown) — the last two used to sit inline as
// full detail on every page load; now only their summary shows in Drafting.
export interface DoctorActions {
  canApprove: boolean;
  canFastTrack: boolean;
  canCancel: boolean;
  approveAction: () => Promise<void>;
  rejectAction: (formData: FormData) => Promise<void>;
  fastTrackAction: () => Promise<void>;
  cancelAction: (formData: FormData) => Promise<void>;
}

/**
 * Per-doctor edit-lock + request-edit state (docs/poa-per-doctor-approval/,
 * 2026-08-18: "tidak ada approval, request edit, dan revisi yang by draft" —
 * this used to be one whole-draft banner at the top of poa/[id]/page.tsx;
 * every doctor now carries its own lock/request state, same granularity as
 * approve/reject in DoctorActions above). Computed for EVERY doctor in the
 * draft (not filtered like DoctorActions), since the owner needs to see
 * their own lock/request state even with zero atasan rights.
 */
export interface DoctorEditRequestInfo {
  /** Role label this doctor is locked at (e.g. "SM"), null when not locked. */
  editLockRoleLabel: string | null;
  /** True when the most recent audit entry for this doctor is a pending REQUEST_EDIT. */
  pendingEditRequest: boolean;
  pendingEditRequestNote: string | null;
  /** "Nama (Role)" of whoever a request would go to / is pending with, null if nobody has approved yet this cycle. */
  lastApproverLabel: string | null;
  /** Only true for the owner, only when locked and no request is already pending. */
  canRequestEdit: boolean;
  /** Only true for the specific person a pending request is addressed to. */
  canRespondEditRequest: boolean;
  requestEditAction: (formData: FormData) => Promise<void>;
  grantEditRequestAction: () => Promise<void>;
  declineEditRequestAction: (formData: FormData) => Promise<void>;
}

/**
 * Rejection label per doctor (2026-08-19: "si MR bisa liat mana line yang di
 * reject") — only present for a doctor currently sitting in REVISI because of
 * a REJECT (or an atasan's CANCEL of an earlier approval), so the owner can
 * see why right on that doctor's own row instead of digging through the
 * collapsed whole-draft "Riwayat Aktivitas" log to find which doctor it was
 * about. Absent key means this doctor's REVISI (if any) came from something
 * else (GRANT_EDIT, or the owner's own edit) with no rejection behind it.
 */
export interface DoctorRejectInfo {
  action: "REJECT" | "CANCEL";
  /** Localized PoaRejectCategory label, null for a CANCEL (no category on that action). */
  category: string | null;
  reason: string | null;
  rejectedByLabel: string;
}

export function PoaDetailTabs({
  items, poaId, poaPeriod, showSubmit, userCanEdit, canAddDoctor,
  selectable = true, activePssp = [], outletPsspInfo = {}, doctorPsspInfo = {}, everPsspKodeCust = [], kontesProductTargets, salesSummary, targetArea, doctorStatuses, doctorVersions, doctorActions, doctorEditRequests, doctorRejectInfo,
}: {
  items: PoaLineItem[];
  poaId?: string;
  poaPeriod: string;
  showSubmit?: boolean;
  userCanEdit?: boolean;
  /** Whether this user can add a BRAND-NEW doctor right now — deliberately
   * separate from userCanEdit, since it's not subject to the whole-draft edit
   * lock (see canAddNewDoctor in authz.ts). Controls the "+ Tambah User" entry
   * point specifically. */
  canAddDoctor?: boolean;
  selectable?: boolean;
  /** kodePI|namaCust -> that doctor's own PoaDoctorApproval.status, for the
   * per-doctor "Ajukan" button (docs/poa-per-doctor-approval/, OQ-2). A
   * doctor with no row yet (never submitted this cycle) is simply absent. */
  doctorStatuses?: Record<string, PoaStatus>;
  /** kodePI|namaCust -> that doctor's own PoaDoctorApproval.version, for the
   * "Version X" chip next to that doctor's StatusBadge. Absent key means
   * never submitted this cycle (no chip shown). */
  doctorVersions?: Record<string, number>;
  /** kodePI|namaCust -> this viewer's approve/reject/fast-track/cancel rights
   * + bound server actions for that one doctor (2026-08-14: merged into the
   * doctor row instead of a separate "Tindakan Per Dokter" list — see
   * poa/[id]/page.tsx). Absent key means no atasan action available for that
   * doctor to this viewer. */
  doctorActions?: Record<string, DoctorActions>;
  /** kodePI|namaCust -> that doctor's edit-lock/request-edit state, computed for every doctor. */
  doctorEditRequests?: Record<string, DoctorEditRequestInfo>;
  /** kodePI|namaCust -> that doctor's rejection reason/category, only present for a doctor in REVISI because of a REJECT/CANCEL. */
  doctorRejectInfo?: Record<string, DoctorRejectInfo>;
  activePssp?: ActivePsspRow[];
  /** Per-outlet stats for "Informasi PSSP Outlet" dropdown (2026-08-10) —
   * server-computed in poa/[id]/page.tsx, batched once (not per-row). */
  outletPsspInfo?: Record<string, { userCount: number; rencanaTercacahEstimasi: number; rencanaTercacahNilaiPssp: number; aktifTercacahEstimasi: number; aktifTercacahNilaiPssp: number }>;
  /** Per-doctor Estimasi Aktif (docs/TODO.md #17, 2026-08-13), keyed by
   * `${kodePI}|${namaCust}` — server-computed in poa/[id]/page.tsx. */
  doctorPsspInfo?: Record<string, { aktifTercacahEstimasi: number; aktifTercacahNilaiPssp: number }>;
  /** kodeCust values that have EVER had a PSSP contract (see getPsspEverKodeCust) — passed through to DraftChecklist. */
  everPsspKodeCust?: string[];
  kontesProductTargets: KontesProductTarget[];
  salesSummary?: { historisTahunLalu: number; historisTahunLaluLabel: string; salesYtd: number; growthPct: number };
  /** Real Target Value for this POA's MR (see poa/[id]/page.tsx's targetValueFromGT) — undefined falls back to DraftChecklist's dummy placeholder. */
  targetArea?: number;
}) {
  const [tab, setTab] = useState<TabKey>("drafting");

  const quarterMonths = useMemo(() => {
    try { return quarterToMonths(poaPeriod); } catch { return []; }
  }, [poaPeriod]);

  const aktifPsspStats = useMemo(
    () => computeActivePsspStats(activePssp, quarterMonths),
    [activePssp, quarterMonths]
  );
  const qLabel = quarterLabelFromMonths(quarterMonths);

  const kontesWithTarget = kontesProductTargets.filter((p) => p.quarterlyTargetQty > 0);
  const kontesTotalQty = kontesProductTargets.reduce((s, p) => s + p.quarterlyTargetQty, 0);
  const kontesTotalValue = kontesProductTargets.reduce((s, p) => s + p.quarterlyTargetValue, 0);
  const kontesTotalEstimasiQty = kontesProductTargets.reduce((s, p) => s + p.estimasiQty, 0);
  const kontesTotalEstimasiValue = kontesProductTargets.reduce((s, p) => s + p.estimasiValue, 0);

  const tabs: { key: TabKey; label: string }[] = [
    { key: "drafting", label: "Drafting" },
    { key: "produkKontes", label: kontesProductTargets.length > 0 ? `Produk Kontes (${kontesProductTargets.length})` : "Produk Kontes" },
    { key: "pssp", label: aktifPsspStats.kontrakTotal > 0 ? `History PSSP Aktif (${aktifPsspStats.kontrakTotal})` : "History PSSP Aktif" },
  ];

  return (
    <div className="space-y-4">
      {/* Tab switcher */}
      <div className="flex gap-1 border-b overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className="px-3 py-2 text-sm font-medium whitespace-nowrap -mb-px border-b-2 transition-colors"
            style={{
              borderColor: tab === t.key ? "var(--color-blue)" : "transparent",
              color: tab === t.key ? "var(--color-blue)" : "var(--color-text-faint)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Drafting — checklist + light summaries of the other two tabs */}
      {tab === "drafting" && (
        <div className="space-y-4">
          {kontesProductTargets.length > 0 && (
            <Card>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                    Target Produk Kontes (Kuartal {qLabel})
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                    {kontesWithTarget.length} dari {kontesProductTargets.length} produk kontes punya target · total {Math.round(kontesTotalQty).toLocaleString("id-ID")} unit ({formatRp(kontesTotalValue)}) ·
                    estimasi draft ini {Math.round(kontesTotalEstimasiQty).toLocaleString("id-ID")} unit ({formatRp(kontesTotalEstimasiValue)})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setTab("produkKontes")}
                  className="text-xs font-medium shrink-0"
                  style={{ color: "var(--color-blue)" }}
                >
                  Lihat detail →
                </button>
              </div>
            </Card>
          )}

          {items.length === 0 ? (
            <Card>
              <p className="text-sm py-4" style={{ color: "var(--color-text-muted)" }}>
                {canAddDoctor
                  ? <a href={`/poa/${poaId}/edit`} style={{ color: "var(--color-blue)" }}>+ Tambah rencana pertama</a>
                  : "Belum ada baris."}
              </p>
            </Card>
          ) : (
            <DraftChecklist
              items={items}
              poaId={poaId}
              poaPeriod={poaPeriod}
              showSubmit={showSubmit}
              userCanEdit={userCanEdit}
              canAddDoctor={canAddDoctor}
              selectable={selectable}
              activePssp={activePssp}
              outletPsspInfo={outletPsspInfo}
              doctorPsspInfo={doctorPsspInfo}
              everPsspKodeCust={everPsspKodeCust}
              salesSummary={salesSummary}
              targetArea={targetArea}
              doctorStatuses={doctorStatuses}
              doctorVersions={doctorVersions}
              doctorActions={doctorActions}
              doctorEditRequests={doctorEditRequests}
              doctorRejectInfo={doctorRejectInfo}
            />
          )}
        </div>
      )}

      {/* Produk Kontes — full per-product quarterly target detail */}
      {tab === "produkKontes" && (
        kontesProductTargets.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Target Produk Kontes (Kuartal {qLabel})</CardTitle>
            </CardHeader>
            <p className="text-xs mb-3" style={{ color: "var(--color-text-muted)" }}>
              Target kuantitas &amp; nilai per produk kontes untuk territory SM dari MR ini, {poaPeriod} -
              dari mesin simulasi target yang sama dengan halaman Admin, dibandingkan dengan estimasi
              yang sudah direncanakan MR ini di draft POA.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <th className="text-left py-1.5 pr-3 font-medium" style={{ color: "var(--color-text-faint)" }}>Produk Kontes</th>
                    <th className="text-right py-1.5 pr-3 font-medium" style={{ color: "var(--color-text-faint)" }}>Target Unit (Kuartal)</th>
                    <th className="text-right py-1.5 pr-3 font-medium" style={{ color: "var(--color-text-faint)" }}>Nilai Target</th>
                    <th className="text-right py-1.5 pr-3 font-medium" style={{ color: "var(--color-text-faint)" }}>Estimasi Unit (Draft Ini)</th>
                    <th className="text-right py-1.5 pr-3 font-medium" style={{ color: "var(--color-text-faint)" }}>Estimasi Nilai (Draft Ini)</th>
                  </tr>
                </thead>
                <tbody>
                  {kontesProductTargets.map((p) => (
                    <tr key={p.kodeProduk} style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <td className="py-1.5 pr-3" style={{ color: "var(--color-text)" }}>{p.namaProduk}</td>
                      <td className="py-1.5 pr-3 text-right" style={{ color: "var(--color-text)" }}>
                        {Math.round(p.quarterlyTargetQty).toLocaleString("id-ID")}
                      </td>
                      <td className="py-1.5 pr-3 text-right" style={{ color: "var(--color-text)" }}>
                        {formatRp(p.quarterlyTargetValue)}
                      </td>
                      <td className="py-1.5 pr-3 text-right" style={{ color: "var(--color-text-muted)" }}>
                        {p.estimasiQty > 0 ? Math.round(p.estimasiQty).toLocaleString("id-ID") : "-"}
                      </td>
                      <td className="py-1.5 pr-3 text-right" style={{ color: "var(--color-text-muted)" }}>
                        {p.estimasiValue > 0 ? formatRp(p.estimasiValue) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Card>
            <p className="text-sm py-2" style={{ color: "var(--color-text-muted)" }}>
              Tidak ada data target produk kontes untuk periode ini.
            </p>
          </Card>
        )
      )}

      {/* History PSSP Aktif — full per-doctor/per-contract detail */}
      {tab === "pssp" && (
        activePssp.length > 0 ? (
          <ActivePsspListCard rows={activePssp} quarterMonths={quarterMonths} />
        ) : (
          <Card>
            <p className="text-sm py-2" style={{ color: "var(--color-text-muted)" }}>
              Tidak ada kontrak PSSP aktif untuk dokter di outlet yang sama dengan POA ini.
            </p>
          </Card>
        )
      )}
    </div>
  );
}
