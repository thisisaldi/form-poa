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
  selectable = true,
  salesSummary,
  targetArea,
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
  selectable?: boolean;
  salesSummary?: SalesFigures;
  targetArea?: number;
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
          selectable={selectable}
          salesSummary={salesSummary}
          targetArea={targetArea}
        />
      </div>
    </ScToastProvider>
  );
}
