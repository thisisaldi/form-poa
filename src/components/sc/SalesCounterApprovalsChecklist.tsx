"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SalesCounterStatsPanel } from "./detail/SalesCounterStatsPanel";
import { SalesCounterOutletCard } from "./detail/SalesCounterOutletCard";
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
  const isASM = userRole === "ASM";
  const isNSM = userRole === "NSM";

  const [selectedOutletIds, setSelectedOutletIds] = useState<Set<string>>(new Set());
  const [selectedGroupKeys, setSelectedGroupKeys] = useState<Set<string>>(new Set());
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(new Set());
  const [activeKompetitorDraftId, setActiveKompetitorDraftId] = useState<string | null>(null);

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

  // Calculations for ASM (Per Outlet)
  const allOutletIds = scDrafts.map((d) => d.id);
  const allOutletsSelected = allOutletIds.length > 0 && allOutletIds.every((id) => selectedOutletIds.has(id));
  const selectedOutletCount = selectedOutletIds.size;

  // Calculations for SM+ (Per Person / Group)
  const allGroupKeys = mrGroups.map((g) => g.groupKey);
  const allGroupsSelected = allGroupKeys.length > 0 && allGroupKeys.every((k) => selectedGroupKeys.has(k));
  const selectedGroupCount = selectedGroupKeys.size;

  const toggleOutlet = (id: string) => {
    setSelectedOutletIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOutlets = () => {
    if (allOutletsSelected) {
      setSelectedOutletIds(new Set());
    } else {
      setSelectedOutletIds(new Set(allOutletIds));
    }
  };

  const toggleGroupKey = (key: string) => {
    setSelectedGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAllGroups = () => {
    if (allGroupsSelected) {
      setSelectedGroupKeys(new Set());
    } else {
      setSelectedGroupKeys(new Set(allGroupKeys));
    }
  };

  const toggleExpandGroup = (key: string) => {
    setExpandedGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handlePeriodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    const url = val === "ALL" ? "/sc/approvals" : `/sc/approvals?period=${encodeURIComponent(val)}`;
    router.push(url);
  };

  const handleBulkApprove = () => {
    if (isPending) return;

    let poaScIdsToApprove: string[] = [];

    if (isASM) {
      if (selectedOutletCount === 0) return;
      poaScIdsToApprove = Array.from(selectedOutletIds);
    } else {
      if (selectedGroupCount === 0) return;
      for (const g of mrGroups) {
        if (selectedGroupKeys.has(g.groupKey)) {
          for (const f of g.forms) {
            poaScIdsToApprove.push(f.id);
          }
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
          if (isASM) setSelectedOutletIds(new Set());
          else setSelectedGroupKeys(new Set());
          router.refresh();
        } else {
          showToast(res.error || "Gagal menyetujui Sales Counter terpilih.", "error");
        }
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : "Terjadi kesalahan saat memproses approval.", "error");
      }
    });
  };

  const hasNoData = isASM
    ? scDrafts.length === 0 && availablePeriods.length === 0
    : mrGroups.length === 0 && availablePeriods.length === 0;

  if (hasNoData) {
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
      {/* Sisi Kiri: Daftar Outlet (ASM) atau Daftar Orang (SM+) */}
      <div className="space-y-4 min-w-0">
        {/* Panel statistik di mobile view */}
        <div className="md:hidden">
          <SalesCounterStatsPanel
            selectedOutletCount={isASM && selectedOutletCount > 0 ? selectedOutletCount : scDrafts.length}
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
                {isASM
                  ? "Daftar Outlet Menunggu Approval"
                  : isNSM
                  ? "Daftar ASM"
                  : "Daftar MR"}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                {isASM
                  ? "Pilih outlet untuk disetujui atau minta revisi secara langsung maupun massal."
                  : isNSM
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
          {((isASM && scDrafts.length > 0) || (!isASM && mrGroups.length > 0)) && (
            <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[var(--color-bg-subtle,#f8fafc)] border border-[var(--color-border)]">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isASM ? allOutletsSelected : allGroupsSelected}
                  onChange={isASM ? toggleSelectAllOutlets : toggleSelectAllGroups}
                  className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                />
                <span className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>
                  Select All
                </span>
              </label>

              <button
                type="button"
                onClick={handleBulkApprove}
                disabled={(isASM ? selectedOutletCount === 0 : selectedGroupCount === 0) || isPending}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold text-white shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                style={{
                  background:
                    (isASM ? selectedOutletCount > 0 : selectedGroupCount > 0) && !isPending
                      ? "#15803d"
                      : "#16a34a",
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
                    <span>
                      Approve Terpilih ({isASM ? selectedOutletCount : selectedGroupCount})
                    </span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Empty state under filter */}
          {((isASM && scDrafts.length === 0) || (!isASM && mrGroups.length === 0)) && (
            <div className="py-8 text-center">
              <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                Tidak ada pengajuan yang cocok dengan filter periode {selectedPeriod}.
              </p>
            </div>
          )}

          {/* LIST OF CARDS */}
          {isASM ? (
            /* ================= MODE ASM: APPROVAL PER OUTLET ================= */
            <div className="space-y-3">
              {scDrafts.map((draft) => (
                <SalesCounterOutletCard
                  key={draft.id}
                  draft={draft}
                  checked={selectedOutletIds.has(draft.id)}
                  onToggle={() => toggleOutlet(draft.id)}
                  selectable={true}
                  poaId={draft.period}
                  userCanEdit={false}
                  isOwner={false}
                  canApprove={true}
                  canFastTrack={false}
                  userRole="ASM"
                  headerFormat="pi-quarter-outlet"
                  isKompetitorOpen={activeKompetitorDraftId === draft.id}
                  onToggleKompetitor={() =>
                    setActiveKompetitorDraftId((prev) => (prev === draft.id ? null : draft.id))
                  }
                  onCloseKompetitor={() => setActiveKompetitorDraftId(null)}
                />
              ))}
            </div>
          ) : (
            /* ================= MODE SM KE ATAS: APPROVAL PER ORANG ================= */
            <div className="space-y-3">
              {mrGroups.map((g) => {
                const isSelected = selectedGroupKeys.has(g.groupKey);
                const isExpanded = expandedGroupKeys.has(g.groupKey);

                return (
                  <div
                    key={g.groupKey}
                    className="rounded-xl p-3.5 sm:p-4 space-y-2.5 transition-all shadow-xs hover:shadow-md"
                    style={{
                      background: "var(--color-bg-surface, #ffffff)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    {/* Top Section: Checkbox + Nama Orang & StatusBadge */}
                    <div className="flex items-start gap-3 justify-between">
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleGroupKey(g.groupKey)}
                          className="h-4 w-4 shrink-0 rounded mt-0.5 cursor-pointer"
                          style={{ accentColor: "var(--color-blue)" }}
                          title="Pilih untuk persetujuan massal"
                        />

                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-semibold leading-snug break-words block" style={{ color: "var(--color-text)" }}>
                            {g.ownerName}
                            <span className="font-normal text-xs font-mono ml-1.5 opacity-75">
                              ({g.ownerNip})
                            </span>
                          </span>
                          <p className="text-xs font-medium truncate mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                            Periode: {g.period}
                            {g.asmName && <span> · ASM: {g.asmName}</span>}
                            {g.mrCount != null && g.mrCount > 0 && <span> · {g.mrCount} MR</span>}
                          </p>
                        </div>
                      </div>

                      <div className="shrink-0 pt-0.5">
                        <StatusBadge status={g.status} version={g.version} />
                      </div>
                    </div>

                    {/* Metadata Row: Baris horizontal ber-bullet seperti demografi kartu outlet */}
                    <div
                      className="flex items-center justify-between sm:justify-start gap-x-2.5 sm:gap-x-4 text-xs pt-0.5 flex-wrap"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px]">
                        <span>Total Outlet:</span>
                        <strong className="font-semibold" style={{ color: "var(--color-text)" }}>
                          {g.outletCount} Outlet
                        </strong>
                      </span>
                      <span className="text-slate-300 dark:text-slate-600 select-none">•</span>
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px]">
                        <span>Variasi Produk:</span>
                        <strong className="font-semibold" style={{ color: "var(--color-text)" }}>
                          {g.variasiProdukCount ?? 0} Produk
                        </strong>
                      </span>
                      <span className="text-slate-300 dark:text-slate-600 select-none">•</span>
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px]">
                        <span>Status:</span>
                        <span style={{ color: "var(--color-status-approved, #16a34a)" }} className="font-semibold">
                          {g.approvedCount} disetujui
                        </span>
                        <span className="mx-1 opacity-40">·</span>
                        <span style={{ color: "var(--color-status-pending, #f59e0b)" }} className="font-semibold">
                          {g.belumCount} belum
                        </span>
                      </span>
                    </div>

                    {/* Metrics Minimal 4-column summary (identik dengan grid di SalesCounterOutletCard) */}
                    <div
                      className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-2 text-xs"
                      style={{ borderTop: "1px solid var(--color-border)", borderBottom: "1px solid var(--color-border)" }}
                    >
                      <div>
                        <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>Estimasi Sales</p>
                        <p className="text-sm font-semibold mt-0.5" style={{ color: "var(--color-blue)" }}>
                          {(g.totalEstimasiSales ?? 0) > 0 ? `Rp ${formatRp(g.totalEstimasiSales!, true)}` : "-"}
                        </p>
                        {g.outletCount > 1 && (g.totalEstimasiSales ?? 0) > 0 && (
                          <p className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>
                            ({formatRp(g.totalEstimasiSales! / g.outletCount, true)} / outlet)
                          </p>
                        )}
                      </div>

                      <div>
                        <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>Total Budget SC</p>
                        <p className="text-sm font-semibold mt-0.5" style={{ color: "var(--color-blue)" }}>
                          {(g.totalBudgetSc ?? 0) > 0 ? `Rp ${formatRp(g.totalBudgetSc, true)}` : "-"}
                        </p>
                      </div>

                      <div>
                        <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>Total Outlet</p>
                        <p className="text-sm font-semibold mt-0.5" style={{ color: "var(--color-text)" }}>
                          {g.outletCount} Outlet
                        </p>
                      </div>

                      <div>
                        <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>Variasi Produk</p>
                        <p className="text-sm font-semibold mt-0.5" style={{ color: "var(--color-text)" }}>
                          {g.variasiProdukCount ?? 0} Produk
                        </p>
                      </div>
                    </div>

                    {/* Footer Action Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => toggleExpandGroup(g.groupKey)}
                        className="text-xs hover:underline cursor-pointer flex items-center gap-1 font-medium"
                        style={{ color: "var(--color-text-faint)" }}
                      >
                        <span>Daftar Outlet ({g.forms.length})</span>
                        <span className="text-[10px]">{isExpanded ? "▲" : "▼"}</span>
                      </button>

                      <div className="flex items-center gap-2 ml-auto">
                        <Link
                          href={g.targetHref}
                          className="text-xs font-medium px-3 py-1 rounded-md whitespace-nowrap transition-colors"
                          style={{
                            background: "var(--color-blue-light, #eff6ff)",
                            color: "var(--color-blue, #2563eb)",
                            border: "1px solid var(--color-blue, #2563eb)",
                            textDecoration: "none",
                          }}
                        >
                          Review
                        </Link>
                      </div>
                    </div>

                    {/* Collapsible outlet preview */}
                    {isExpanded && (
                      <div className="pt-2 border-t border-[var(--color-border)] space-y-1.5 text-xs">
                        {g.forms.map((f) => {
                          const outletTitle = [f.kodePI, g.period, f.namaOutlet].filter(Boolean).join(" - ");
                          return (
                            <div
                              key={f.id}
                              className="flex items-center justify-between p-2 rounded-md bg-[var(--color-bg-subtle)] border border-[var(--color-border)] text-xs"
                            >
                              <div className="min-w-0 pr-2">
                                <span
                                  className="font-semibold text-xs truncate block"
                                  style={{ color: "var(--color-text)" }}
                                  title={outletTitle}
                                >
                                  {outletTitle}
                                </span>
                              </div>
                              <div className="shrink-0">
                                <StatusBadge status={f.status as PoaStatus} version={f.version} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Sisi Kanan: SalesCounterStatsPanel Sticky */}
      <div className="hidden md:block sticky top-8 max-h-[calc(100vh-5rem)] overflow-y-auto">
        <SalesCounterStatsPanel
          selectedOutletCount={isASM && selectedOutletCount > 0 ? selectedOutletCount : scDrafts.length}
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
