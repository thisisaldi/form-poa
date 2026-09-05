"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SalesCounterStatsPanel } from "./detail/SalesCounterStatsPanel";
import { useSalesCounterDetail } from "./hooks/useSalesCounterDetail";
import { formatCurrency as formatRp } from "@/lib/format";
import type { ScDraftFormItem, SalesFigures } from "./types";
import type { PoaStatus } from "@prisma/client";

export interface MrApprovalGroup {
  ownerNip: string;
  ownerName: string;
  period: string;
  status: PoaStatus;
  version: number;
  outletCount: number;
  approvedCount: number;
  belumCount: number;
  totalBudgetSc: number;
  targetHref: string;
  forms: {
    id: string;
    kodePI: string;
    namaOutlet: string;
    status: string;
    version: number;
  }[];
}

export function SalesCounterApprovalsChecklist({
  mrGroups,
  scDrafts = [],
  dominantPeriod = "",
}: {
  mrGroups: MrApprovalGroup[];
  scDrafts?: ScDraftFormItem[];
  dominantPeriod?: string;
}) {
  const { metrics, quarterMonths } = useSalesCounterDetail({
    scDrafts,
    poaPeriod: dominantPeriod,
  });

  const salesFigures: SalesFigures = {
    historisTahunLalu: 0,
    historisTahunLaluLabel: String(new Date().getFullYear() - 1),
    salesYtd: 0,
    growthPct: 0,
  };

  if (mrGroups.length === 0) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          Tidak ada pengajuan Sales Counter yang menunggu persetujuan Anda saat ini.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[3fr_2fr] gap-5 items-start">
      {/* Sisi Kiri: Daftar MR */}
      <div className="space-y-4 min-w-0">
        {/* Panel statistik di mobile view */}
        <div className="md:hidden">
          <SalesCounterStatsPanel
            selectedOutletCount={scDrafts.length}
            totalOutletCount={scDrafts.length}
            metrics={metrics}
            targetArea={0}
            salesFigures={salesFigures}
            quarterMonths={quarterMonths}
            historyQuarterLabel={metrics.historyQuarterLabel}
          />
        </div>

        <Card className="p-4">
          <div className="mb-3">
            <p className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>
              Daftar MR
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
              Klik &quot;Review&quot; untuk approve/reject per outlet.
            </p>
          </div>

          <div className="space-y-0.5 divide-y divide-[var(--color-border)]">
            {mrGroups.map((g) => (
              <div
                key={`${g.period}_${g.ownerNip}`}
                className="flex items-center gap-3 py-3 px-2 rounded-lg transition-colors hover:bg-[var(--color-bg-subtle)]"
              >
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                      {g.ownerName}
                    </span>
                    <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                      ({g.ownerNip})
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                    Periode {g.period}
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <StatusBadge status={g.status} version={g.version} />
                    <p className="text-xs mt-1" style={{ color: "var(--color-text-faint)" }}>
                      {g.outletCount} outlet · {g.totalBudgetSc > 0 ? formatRp(g.totalBudgetSc) : "-"}
                    </p>
                    <p className="text-xs mt-0.5">
                      <span style={{ color: "var(--color-status-approved, #16a34a)" }}>
                        {g.approvedCount} disetujui
                      </span>
                      <span style={{ color: "var(--color-text-faint)" }}> · </span>
                      <span style={{ color: "var(--color-status-pending, #f59e0b)" }}>
                        {g.belumCount} belum
                      </span>
                    </p>
                  </div>
                  <Link href={g.targetHref}>
                    <Button size="sm" variant="secondary">
                      Review
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Sisi Kanan: SalesCounterStatsPanel Sticky */}
      <div className="hidden md:block sticky top-8 max-h-[calc(100vh-5rem)] overflow-y-auto">
        <SalesCounterStatsPanel
          selectedOutletCount={scDrafts.length}
          totalOutletCount={scDrafts.length}
          metrics={metrics}
          targetArea={0}
          salesFigures={salesFigures}
          quarterMonths={quarterMonths}
          historyQuarterLabel={metrics.historyQuarterLabel}
        />
      </div>
    </div>
  );
}
