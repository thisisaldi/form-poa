"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useSalesCounterDetail } from "./hooks/useSalesCounterDetail";
import { SalesCounterStatsPanel } from "./detail/SalesCounterStatsPanel";
import { SalesCounterOutletCard } from "./detail/SalesCounterOutletCard";
import { SalesCounterChecklistHeader } from "./detail/SalesCounterChecklistHeader";
import { SalesCounterSubmitPanel } from "./detail/SalesCounterSubmitPanel";
import { SalesCounterApprovePanel } from "./detail/SalesCounterApprovePanel";
import type { ScDraftFormItem, SalesFigures } from "./types";

import { submitSalesCounterFormAction } from "@/app/actions/scApprovalActions";
import { useScToast } from "./ui/ScToast";

export function SalesCounterDraftChecklist({
  scDrafts = [],
  poaId,
  poaPeriod,
  showSubmit,
  userCanEdit,
  canApprove,
  canFastTrack,
  userRole,
  selectable = true,
  salesSummary,
  targetArea,
  totalCoverageScOutlets,
  historyQuarterLabel,
}: {
  scDrafts?: ScDraftFormItem[];
  poaId?: string;
  poaPeriod: string;
  showSubmit?: boolean;
  userCanEdit?: boolean;
  canApprove?: boolean;
  canFastTrack?: boolean;
  userRole?: string;
  selectable?: boolean;
  salesSummary?: SalesFigures;
  targetArea?: number;
  totalCoverageScOutlets?: number;
  historyQuarterLabel?: string;
}) {
  const router = useRouter();
  const [isSubmittingState, setIsSubmittingState] = useState(false);
  const [activeKompetitorDraftId, setActiveKompetitorDraftId] = useState<string | null>(null);
  const safeScDrafts = Array.isArray(scDrafts) ? scDrafts : [];

  const {
    checked,
    toggle,
    toggleAll,
    allSelected,
    metrics,
    quarterMonths,
    submitNotes,
    setSubmitNotes,
    actionableIds,
    actionableCount,
    selectedActionableCount,
    submittableIds,
    statusFilter,
    setStatusFilter,
    filterCounts,
    filteredScDrafts,
  } = useSalesCounterDetail({
    scDrafts: safeScDrafts,
    poaPeriod,
    showSubmit,
    userRole,
    canApprove,
    canFastTrack,
  });

  const canEditNow = userCanEdit ?? false;

  const salesFigures: SalesFigures = salesSummary ?? {
    historisTahunLalu: 0,
    historisTahunLaluLabel: String(new Date().getFullYear() - 1),
    salesYtd: 0,
    growthPct: 0,
  };

  const { showToast } = useScToast();

  async function handleSubmitAction() {
    // Submit only the submittable (DRAFT/REVISI) ones from the selection
    const toSubmit = submittableIds;
    if (toSubmit.length === 0 || isSubmittingState) return;
    setIsSubmittingState(true);
    try {
      const res = await submitSalesCounterFormAction(toSubmit, submitNotes);
      if (res.ok) {
        showToast("Rencana POA Sales Counter berhasil diajukan ke atasan.", "success");
        setTimeout(() => window.location.reload(), 800);
      } else {
        showToast(res.error || "Gagal mengajukan POA Sales Counter.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Terjadi kesalahan saat mengajukan.", "error");
    } finally {
      setIsSubmittingState(false);
    }
  }

  if (safeScDrafts.length === 0) {
    return (
      <Card>
        <p className="text-sm py-4" style={{ color: "var(--color-text-muted)" }}>
          {canEditNow ? (
            <Link href={`/sc/${poaId}/edit`} style={{ color: "var(--color-blue)" }}>
              + Tambah outlet SC pertama
            </Link>
          ) : (
            "Belum ada outlet Sales Counter."
          )}
        </p>
      </Card>
    );
  }

  const exportHref = (() => {
    const base = `/api/sc/${poaId}/export`;
    if (checked.size === 0 || checked.size === safeScDrafts.length) return base;
    const ids = Array.from(checked).join(",");
    return `${base}?outletIds=${encodeURIComponent(ids)}`;
  })();

  return (
    <div className="space-y-4">
      <div>
        <a href={exportHref}>
          <Button size="sm" variant="ghost">↓ Export Excel</Button>
        </a>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Mobile Stats Panel (Ringkasan Target & Estimasi SC) */}
        <div className="block md:hidden">
          <details
            open
            className="group rounded-xl border overflow-hidden shadow-xs"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          >
            <summary
              className="cursor-pointer select-none list-none p-3.5 flex items-center justify-between font-semibold text-xs uppercase tracking-wide [&::-webkit-details-marker]:hidden [&::marker]:hidden"
              style={{ background: "var(--color-bg-subtle)", color: "var(--color-text)" }}
            >
              <span>Ringkasan Target &amp; Estimasi SC</span>
              <span
                className="text-xs transition-transform duration-200 group-open:rotate-180"
                style={{ color: "var(--color-text-muted)" }}
              >
                ▼
              </span>
            </summary>
            <div className="border-t" style={{ borderColor: "var(--color-border)" }}>
              <SalesCounterStatsPanel
                selectedOutletCount={checked.size}
                totalOutletCount={safeScDrafts.length}
                metrics={metrics}
                targetArea={targetArea ?? 0}
                targetAreaIsReal={targetArea != null}
                salesFigures={salesFigures}
                salesIsReal={!!salesSummary}
                quarterMonths={quarterMonths}
                totalCoverageScOutlets={totalCoverageScOutlets}
                historyQuarterLabel={historyQuarterLabel}
              />
            </div>
          </details>
        </div>

        {/* Left Column: Checklist & Cards */}
        <div className="space-y-4 md:col-span-2">
          <Card className="p-4">
            <SalesCounterChecklistHeader
              poaId={poaId}
              canEditNow={canEditNow}
              selectable={selectable}
              canApprove={canApprove}
              showSubmit={showSubmit}
              allChecked={allSelected}
              onToggleAll={toggleAll}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              filterCounts={filterCounts}
            />

            <div className="space-y-2">
              {filteredScDrafts.length > 0 ? (
                filteredScDrafts.map((draft) => (
                  <SalesCounterOutletCard
                    key={draft.id}
                    draft={draft}
                    checked={checked.has(draft.id)}
                    onToggle={() => toggle(draft.id)}
                    selectable={selectable}
                    poaId={poaId || ""}
                    userCanEdit={canEditNow}
                    isOwner={showSubmit ?? canEditNow}
                    canApprove={canApprove ?? false}
                    canFastTrack={canFastTrack}
                    userRole={userRole}
                    isKompetitorOpen={activeKompetitorDraftId === draft.id}
                    onToggleKompetitor={() =>
                      setActiveKompetitorDraftId((prev) => (prev === draft.id ? null : draft.id))
                    }
                    onCloseKompetitor={() => setActiveKompetitorDraftId(null)}
                  />
                ))
              ) : (
                <div
                  className="rounded-lg border p-6 text-center text-xs"
                  style={{
                    borderColor: "var(--color-border)",
                    color: "var(--color-text-muted)",
                    background: "var(--color-bg-subtle)",
                  }}
                >
                  {statusFilter === "APPROVED"
                    ? "Belum ada outlet yang telah disetujui (Approved)."
                    : statusFilter === "ACTIONABLE"
                    ? canApprove
                      ? "Tidak ada outlet yang sedang menunggu persetujuan Anda."
                      : "Tidak ada outlet yang siap diajukan."
                    : statusFilter === "DRAFT_REVISI"
                    ? "Tidak ada outlet berstatus Draft atau Revisi."
                    : "Belum ada outlet Sales Counter."}
                </div>
              )}
            </div>
          </Card>

          {showSubmit && poaId && (
            <SalesCounterSubmitPanel
              selectedCount={checked.size}
              submittableCount={submittableIds.length}
              totalCount={safeScDrafts.length}
              submitNotes={submitNotes}
              setSubmitNotes={setSubmitNotes}
              isSubmitting={isSubmittingState}
              onSubmit={handleSubmitAction}
            />
          )}

          {!showSubmit && canApprove && poaId && (
            <SalesCounterApprovePanel
              selectedCount={selectedActionableCount}
              actionableCount={actionableCount}
              totalCount={safeScDrafts.length}
              selectedIds={actionableIds.filter((id) => checked.has(id))}
              onActionComplete={() => router.refresh()}
            />
          )}
        </div>

        {/* Right Column: Desktop Sticky Stats Panel */}
        <div className="hidden md:block sticky top-5 h-fit">
          <SalesCounterStatsPanel
            selectedOutletCount={checked.size}
            totalOutletCount={safeScDrafts.length}
            metrics={metrics}
            targetArea={targetArea ?? 0}
            targetAreaIsReal={targetArea != null}
            salesFigures={salesFigures}
            salesIsReal={!!salesSummary}
            quarterMonths={quarterMonths}
            totalCoverageScOutlets={totalCoverageScOutlets}
            historyQuarterLabel={historyQuarterLabel}
          />
        </div>
      </div>
    </div>
  );
}


