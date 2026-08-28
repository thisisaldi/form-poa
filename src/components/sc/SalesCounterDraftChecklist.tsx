"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { useSalesCounterDetail } from "./hooks/useSalesCounterDetail";
import { SalesCounterStatsPanel } from "./detail/SalesCounterStatsPanel";
import { SalesCounterOutletCard } from "./detail/SalesCounterOutletCard";
import { SalesCounterChecklistHeader } from "./detail/SalesCounterChecklistHeader";
import { SalesCounterSubmitPanel } from "./detail/SalesCounterSubmitPanel";
import type { ScDraftFormItem, SalesFigures } from "./types";

import { submitSalesCounterFormAction } from "@/app/actions/scApprovalActions";

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
}) {
  const router = useRouter();
  const [isSubmittingState, setIsSubmittingState] = useState(false);
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
  } = useSalesCounterDetail({
    scDrafts: safeScDrafts,
    poaPeriod,
  });

  const canEditNow = userCanEdit ?? false;

  const salesFigures: SalesFigures = salesSummary ?? {
    historisTahunLalu: 0,
    historisTahunLaluLabel: String(new Date().getFullYear() - 1),
    salesYtd: 0,
    growthPct: 0,
  };

  async function handleSubmitAction() {
    if (checked.size === 0 || isSubmittingState) return;
    setIsSubmittingState(true);
    try {
      const selectedIds = Array.from(checked);
      const res = await submitSalesCounterFormAction(selectedIds, submitNotes);
      if (res.ok) {
        alert("Rencana POA Sales Counter berhasil diajukan ke atasan.");
        window.location.reload();
      } else {
        alert(res.error || "Gagal mengajukan POA Sales Counter.");
      }
    } catch (err: any) {
      alert(err?.message || "Terjadi kesalahan saat mengajukan.");
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

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      {/* Left Column: Checklist & Cards */}
      <div className="space-y-4 md:col-span-2">
        <Card className="p-4">
          <SalesCounterChecklistHeader
            poaId={poaId}
            canEditNow={canEditNow}
            selectable={selectable}
            allChecked={allSelected}
            onToggleAll={toggleAll}
          />

          <div className="space-y-2">
            {safeScDrafts.map((draft) => (
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
              />
            ))}
          </div>
        </Card>

        {showSubmit && poaId && (
          <SalesCounterSubmitPanel
            selectedCount={checked.size}
            totalCount={safeScDrafts.length}
            submitNotes={submitNotes}
            setSubmitNotes={setSubmitNotes}
            isSubmitting={isSubmittingState}
            onSubmit={handleSubmitAction}
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
        />
      </div>
    </div>
  );
}
