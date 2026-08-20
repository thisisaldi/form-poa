"use client";

import type { PoaStatus } from "@prisma/client";
import { SalesCounterDraftChecklist } from "./SalesCounterDraftChecklist";
import type { ScDraftFormItem, SalesFigures } from "./types";

export function SalesCounterDetailTabs({
  scDrafts = [],
  poaId,
  poaPeriod,
  poaStatus,
  poaVersion,
  showSubmit,
  userCanEdit,
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
  selectable?: boolean;
  salesSummary?: SalesFigures;
  targetArea?: number;
}) {
  const safeScDrafts = Array.isArray(scDrafts) ? scDrafts : [];

  return (
    <div className="space-y-4">
      <SalesCounterDraftChecklist
        scDrafts={safeScDrafts}
        poaId={poaId}
        poaPeriod={poaPeriod}
        showSubmit={showSubmit}
        userCanEdit={userCanEdit}
        selectable={selectable}
        salesSummary={salesSummary}
        targetArea={targetArea}
      />
    </div>
  );
}
