"use client";

import type { PoaStatus } from "@prisma/client";
import { SalesCounterDraftChecklist } from "./SalesCounterDraftChecklist";
import type { ScDraftFormItem, SalesFigures } from "./types";
import { ScToastProvider } from "./ui/ScToast";

export function SalesCounterDetailTabs({
  scDrafts = [],
  poaId,
  poaPeriod,
  poaStatus,
  poaVersion,
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
  poaStatus?: PoaStatus;
  poaVersion?: number;
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
  const safeScDrafts = Array.isArray(scDrafts) ? scDrafts : [];

  return (
    <ScToastProvider>
      <div className="space-y-4">
        <SalesCounterDraftChecklist
          scDrafts={safeScDrafts}
          poaId={poaId}
          poaPeriod={poaPeriod}
          showSubmit={showSubmit}
          userCanEdit={userCanEdit}
          canApprove={canApprove}
          canFastTrack={canFastTrack}
          userRole={userRole}
          selectable={selectable}
          salesSummary={salesSummary}
          targetArea={targetArea}
          totalCoverageScOutlets={totalCoverageScOutlets}
          historyQuarterLabel={historyQuarterLabel}
        />
      </div>
    </ScToastProvider>
  );
}
