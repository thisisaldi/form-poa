"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { useSalesCounterDetail } from "./hooks/useSalesCounterDetail";
import { SalesCounterStatsPanel } from "./detail/SalesCounterStatsPanel";
import { SalesCounterOutletCard } from "./detail/SalesCounterOutletCard";
import { SalesCounterChecklistHeader } from "./detail/SalesCounterChecklistHeader";
import { SalesCounterSubmitPanel } from "./detail/SalesCounterSubmitPanel";
import type { ScDraftFormItem, SalesFigures } from "./types";

export function SalesCounterDraftChecklist({
  scDrafts = [],
  poaId,
  poaPeriod,
  showSubmit,
  userCanEdit,
  selectable = true,
  salesSummary,
  targetArea,
}: {
  scDrafts?: ScDraftFormItem[];
  poaId?: string;
  poaPeriod: string;
  showSubmit?: boolean;
  userCanEdit?: boolean;
  selectable?: boolean;
  salesSummary?: SalesFigures;
  targetArea?: number;
}) {
  const safeScDrafts = Array.isArray(scDrafts) ? scDrafts : [];

  const {
    checked,
    toggle,
    toggleAll,
    allSelected,
    metrics,
    quarterMonths,
    isSubmitting,
    submitNotes,
    setSubmitNotes,
  } = useSalesCounterDetail({
    scDrafts: safeScDrafts,
    poaPeriod,
    showSubmit,
  });

  const canEditNow = !!userCanEdit;

  const salesFigures: SalesFigures = salesSummary ?? {
    historisTahunLalu: 0,
    historisTahunLaluLabel: String(new Date().getFullYear() - 1),
    salesYtd: 0,
    growthPct: 0,
  };

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
    <div className="grid md:grid-cols-[3fr_2fr] gap-5 items-start">
      {/* Left Column: Checklist of SC Outlets */}
      <div className="space-y-4 min-w-0">
        {/* Mobile Stats Panel */}
        <div className="md:hidden">
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

        <Card>
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
            isSubmitting={isSubmitting}
            onSubmit={() => {
              if (checked.size === 0) return;
              alert("Rencana POA Sales Counter berhasil diajukan.");
            }}
          />
        )}
      </div>

      {/* Right Column: Desktop Sticky Stats Panel */}
      <div className="hidden md:block sticky top-5">
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
