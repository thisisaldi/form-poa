"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SalesCounterStatsPanel } from "./detail/SalesCounterStatsPanel";
import { useSalesCounterDetail } from "./hooks/useSalesCounterDetail";
import { formatCurrency as formatRp } from "@/lib/format";
import { approveSalesCounterFormAction } from "@/app/actions/scApprovalActions";
import { useScToast } from "./ui/ScToast";
import type { ScDraftFormItem, SalesFigures } from "./types";
import type { PoaStatus } from "@prisma/client";

export interface MrApprovalGroup {
  groupKey: string;
  groupType: "MR" | "ASM";
  ownerNip: string;
  ownerName: string;
  period: string;
  status: PoaStatus;
  version: number;
  badgeLabel?: string;
  asmName?: string | null;
  mrCount?: number;
  totalEstimasiSales?: number;
  outletCount: number;
  variasiProdukCount?: number;
  targetValue?: number | null;
  targetRatio?: number | null;
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
  userRole = "SM",
  availablePeriods = [],
  selectedPeriod = "ALL",
}: {
  mrGroups: MrApprovalGroup[];
  scDrafts?: ScDraftFormItem[];
  dominantPeriod?: string;
  userRole?: string;
  availablePeriods?: string[];
  selectedPeriod?: string;
}) {
  const router = useRouter();
  const { showToast } = useScToast();
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

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

  const isNSM = userRole === "NSM";
  const allGroupKeys = mrGroups.map((g) => g.groupKey);
  const allSelected = allGroupKeys.length > 0 && allGroupKeys.every((k) => selectedKeys.has(k));
  const selectedCount = selectedKeys.size;

  const toggleKey = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(allGroupKeys));
    }
  };

  const handlePeriodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    const url = val === "ALL" ? "/sc/approvals" : `/sc/approvals?period=${encodeURIComponent(val)}`;
    router.push(url);
  };

  const handleBulkApprove = () => {
    if (selectedCount === 0 || isPending) return;

    // Collect all pending poaSc form ids from selected groups
    const poaScIdsToApprove: string[] = [];
    for (const g of mrGroups) {
      if (selectedKeys.has(g.groupKey)) {
        for (const f of g.forms) {
          poaScIdsToApprove.push(f.id);
        }
      }
    }

    if (poaScIdsToApprove.length === 0) {
      showToast("Tidak ada outlet yang dapat disetujui pada pilihan ini.", "error");
      return;
    }

    startTransition(async () => {
      try {
        const res = await approveSalesCounterFormAction(poaScIdsToApprove);
        if (res.ok) {
          showToast(`Berhasil menyetujui ${res.count || poaScIdsToApprove.length} outlet Sales Counter.`, "success");
          setSelectedKeys(new Set());
          router.refresh();
        } else {
          showToast(res.error || "Gagal menyetujui Sales Counter terpilih.", "error");
        }
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : "Terjadi kesalahan saat memproses approval.", "error");
      }
    });
  };

  if (mrGroups.length === 0 && availablePeriods.length === 0) {
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
      {/* Sisi Kiri: Daftar MR / ASM */}
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

        <Card className="p-4 space-y-4">
          {/* Header section & Filter Kuartal */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[var(--color-border)]">
            <div>
              <p className="font-semibold text-base" style={{ color: "var(--color-text)" }}>
                {isNSM ? "Daftar ASM" : "Daftar MR"}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                {isNSM
                  ? 'Centang ASM, lalu approve sekaligus — atau klik "Review" untuk approve/reject per outlet.'
                  : 'Centang MR, lalu approve sekaligus — atau klik "Review" untuk approve/reject per outlet.'}
              </p>
            </div>

            {availablePeriods.length > 0 && (
              <div className="flex items-center gap-2 shrink-0">
                <label htmlFor="period-filter" className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                  Periode:
                </label>
                <select
                  id="period-filter"
                  value={selectedPeriod}
                  onChange={handlePeriodChange}
                  className="text-xs rounded-md border border-[var(--color-border)] px-2.5 py-1.5 bg-[var(--color-bg-surface,white)] text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="ALL">Semua Periode</option>
                  {availablePeriods.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Action Bar (Select All & Approve Terpilih) */}
          {mrGroups.length > 0 && (
            <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[var(--color-bg-subtle,#f8fafc)] border border-[var(--color-border)]">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                />
                <span className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>
                  Select All
                </span>
              </label>

              <button
                type="button"
                onClick={handleBulkApprove}
                disabled={selectedCount === 0 || isPending}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold text-white shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                style={{
                  background: selectedCount > 0 && !isPending ? "#15803d" : "#16a34a",
                }}
              >
                {isPending ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span>Memproses...</span>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-bold">✓</span>
                    <span>Approve Terpilih ({selectedCount})</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Empty state under filter */}
          {mrGroups.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                Tidak ada pengajuan yang cocok dengan filter periode {selectedPeriod}.
              </p>
            </div>
          )}

          {/* List of Cards */}
          <div className="space-y-4">
            {mrGroups.map((g) => {
              const isSelected = selectedKeys.has(g.groupKey);
              return (
                <div
                  key={g.groupKey}
                  className="rounded-xl border border-[var(--color-border)] p-4 bg-[var(--color-bg-surface,white)] shadow-sm space-y-3 transition-shadow hover:shadow-md"
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleKey(g.groupKey)}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-bold truncate" style={{ color: "var(--color-text)" }}>
                            {g.ownerName}
                          </span>
                          <span className="text-xs font-mono" style={{ color: "var(--color-text-faint)" }}>
                            ({g.ownerNip})
                          </span>
                        </div>
                        <div className="text-xs mt-0.5 flex items-center gap-1.5 flex-wrap" style={{ color: "var(--color-text-faint)" }}>
                          <span>Periode {g.period}</span>
                          {g.asmName && <span>· ASM: {g.asmName}</span>}
                          {g.mrCount != null && g.mrCount > 0 && <span>· {g.mrCount} MR</span>}
                        </div>
                      </div>
                    </div>

                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 shrink-0">
                      {g.badgeLabel || "Butuh Tindakan"}
                    </span>
                  </div>

                  {/* Card Metrics Box */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg bg-[var(--color-bg-subtle,#fcfbf9)] border border-dashed border-[var(--color-border,#e5e7eb)]">
                    <div>
                      <p className="text-[10px] font-medium tracking-wider uppercase" style={{ color: "var(--color-text-faint)" }}>
                        Total Estimasi Sales
                      </p>
                      <p className="text-xs sm:text-sm font-bold mt-1" style={{ color: "var(--color-text)" }}>
                        {(g.totalEstimasiSales ?? 0) > 0 ? `Rp ${formatRp(g.totalEstimasiSales!, true)}` : "-"}
                      </p>
                    </div>

                    <div>
                      <p className="text-[10px] font-medium tracking-wider uppercase" style={{ color: "var(--color-text-faint)" }}>
                        Total Outlet
                      </p>
                      <p className="text-xs sm:text-sm font-bold mt-1" style={{ color: "var(--color-text)" }}>
                        {g.outletCount} Outlet
                      </p>
                    </div>

                    <div>
                      <p className="text-[10px] font-medium tracking-wider uppercase" style={{ color: "var(--color-text-faint)" }}>
                        Variasi Produk
                      </p>
                      <p className="text-xs sm:text-sm font-bold mt-1" style={{ color: "var(--color-text)" }}>
                        {g.variasiProdukCount ?? 0} Produk
                      </p>
                    </div>

                    <div>
                      <p className="text-[10px] font-medium tracking-wider uppercase" style={{ color: "var(--color-text-faint)" }}>
                        Target
                      </p>
                      <p className="text-xs sm:text-sm font-bold mt-1" style={{ color: "var(--color-text)" }}>
                        {g.targetValue != null && g.targetValue > 0 ? `Rp ${formatRp(g.targetValue, true)}` : "-"}
                      </p>
                      {g.targetRatio != null && (
                        <p className="text-[10px] mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                          Ratio: {g.targetRatio.toFixed(1)}%
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Card Footer */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="text-xs">
                      <span style={{ color: "var(--color-status-approved, #16a34a)" }} className="font-semibold">
                        {g.approvedCount} disetujui
                      </span>
                      <span style={{ color: "var(--color-text-faint)" }}> · </span>
                      <span style={{ color: "var(--color-status-pending, #f59e0b)" }} className="font-semibold">
                        {g.belumCount} belum
                      </span>
                    </div>

                    <Link href={g.targetHref}>
                      <Button size="sm" variant="secondary" className="text-xs font-medium px-4">
                        Review
                      </Button>
                    </Link>
                  </div>
                </div>
              );
            })}
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
