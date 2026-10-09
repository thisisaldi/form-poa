"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { SC_EXPORT_DISABLED, SC_EXPORT_DISABLED_MESSAGE } from "@/lib/exportFlags";

const PAGE_SIZE = 5;

export function SalesCounterDraftChecklist({
  scDrafts = [],
  poaId,
  poaPeriod,
  owner,
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
  owner?: string;
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
  const searchParams = useSearchParams();
  const [isSubmittingState, setIsSubmittingState] = useState(false);
  const [activeKompetitorDraftId, setActiveKompetitorDraftId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
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

  // Each mounted outlet card fires its own Canvasser API calls, so only the
  // current page is rendered. Stats/selection still cover every outlet.
  const totalPages = Math.max(1, Math.ceil(filteredScDrafts.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedScDrafts = filteredScDrafts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

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

  const queryOwner = searchParams?.get("owner") || searchParams?.get("ownerId");
  const effectiveOwner =
    owner ||
    queryOwner ||
    (safeScDrafts.length > 0 ? safeScDrafts[0].ownerNip || safeScDrafts[0].ownerId : undefined);

  const exportHref = (() => {
    const base = `/api/sc/${poaId}/export`;
    const params = new URLSearchParams();

    if (effectiveOwner) {
      params.set("owner", effectiveOwner);
    }

    const queryApprovalType = searchParams?.get("approvalType") || searchParams?.get("tipeApproval");
    if (queryApprovalType) {
      params.set("approvalType", queryApprovalType);
    }

    if (checked.size > 0 && checked.size < safeScDrafts.length) {
      const ids = Array.from(checked).join(",");
      params.set("outletIds", ids);
    }

    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  })();

  return (
    <div className="space-y-4">
      <div>
        {SC_EXPORT_DISABLED ? (
          <Button size="sm" variant="ghost" disabled title={SC_EXPORT_DISABLED_MESSAGE}>
            ↓ Export Excel (dinonaktifkan sementara)
          </Button>
        ) : (
          <a href={exportHref}>
            <Button size="sm" variant="ghost">↓ Export Excel</Button>
          </a>
        )}
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
              onStatusFilterChange={(f) => {
                setPage(1);
                setStatusFilter(f);
              }}
              filterCounts={filterCounts}
            />

            <div className="space-y-2">
              {filteredScDrafts.length > 0 ? (
                pagedScDrafts.map((draft) => (
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
                    ? "Belum ada outlet yang telah disetujui (Fully Approved)."
                    : statusFilter === "PENDING"
                    ? "Tidak ada outlet yang sedang dalam proses pengajuan."
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

            {totalPages > 1 && (
              <div
                className="mt-3 flex items-center justify-between border-t pt-3 text-xs"
                style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
              >
                <span>
                  Outlet {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredScDrafts.length)} dari{" "}
                  {filteredScDrafts.length}
                </span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
                    ← Sebelumnya
                  </Button>
                  <span>
                    Hal {currentPage} / {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={currentPage >= totalPages}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    Berikutnya →
                  </Button>
                </div>
              </div>
            )}
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


