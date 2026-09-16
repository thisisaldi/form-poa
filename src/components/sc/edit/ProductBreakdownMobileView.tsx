"use client";

import React, { useState } from "react";
import { formatRp } from "../detail/SalesCounterStatsPanel";
import { formatShortMonth } from "../detail/utils/formatDateUtils";
import type { ProductDetailRowsSummary } from "../detail/types/outletTable";

export interface UnselectedProductItem {
  kodeProduk: string;
  namaProduk: string;
  avgSalesPerMonth: number;
  totalSalesPeriode: number;
}

export interface ProductBreakdownMobileViewProps {
  productDetailRows: ProductDetailRowsSummary;
  lama: number;
  b3RangeLabel?: string;
  isLoadingB3?: boolean;
  isLoadingIncentiveHistory?: boolean;
  unselectedProducts?: UnselectedProductItem[];
}

export function ProductBreakdownMobileView({
  productDetailRows,
  lama,
  b3RangeLabel,
  isLoadingB3 = false,
  isLoadingIncentiveHistory = false,
  unselectedProducts = [],
}: ProductBreakdownMobileViewProps) {
  const [showUnselected, setShowUnselected] = useState(false);

  const totalUnselectedSalesMonth = unselectedProducts.reduce((sum, p) => sum + p.avgSalesPerMonth, 0);
  const totalUnselectedSalesPeriod = totalUnselectedSalesMonth * (lama || 1);

  return (
    <div className="space-y-3">
      {/* Product Cards List */}
      {productDetailRows.rows.map((rowItem, idx) => {
        const {
          product: p,
          qty,
          totalQty,
          monthlyBreakdown,
          estSalesMonth,
          estSalesFull,
          nilaiScPerMonth,
          nilaiScFull,
          salesHistorical,
          growthPct,
          historyIncentive,
          growthIncentivePct,
          isNewIncentiveProduct,
        } = rowItem;

        const isMultiMonth = productDetailRows.distinctMonths.length > 1 && monthlyBreakdown && monthlyBreakdown.length > 1;
        const months = isMultiMonth ? monthlyBreakdown! : null;

        const lamaEffective = lama || 1;
        const histSalesPerMonth = salesHistorical > 0 ? salesHistorical / lamaEffective : 0;

        // Growth badges
        const isSalesPos = growthPct != null && growthPct >= 0;
        const isIncPos = growthIncentivePct != null && growthIncentivePct >= 0;

        return (
          <div
            key={p.id || p.kodeProduk || idx}
            className="rounded-xl border p-3 space-y-2.5 shadow-2xs text-xs"
            style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}
          >
            {/* Header: Product Name & Growth Badges */}
            <div className="space-y-1.5">
              <div className="font-bold text-xs leading-snug" style={{ color: "var(--color-text)" }}>
                {p.namaProduk}
              </div>

              {/* Growth Badges Row */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* Sales Growth */}
                {isLoadingB3 ? (
                  <span className="h-4 w-12 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                ) : salesHistorical <= 0 ? (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
                    Sales Baru
                  </span>
                ) : growthPct != null ? (
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap leading-tight"
                    style={{
                      color: isSalesPos ? "#16a34a" : "#dc2626",
                      background: isSalesPos ? "rgba(22, 163, 74, 0.1)" : "rgba(220, 38, 38, 0.1)",
                      border: isSalesPos ? "1px solid rgba(22, 163, 74, 0.2)" : "1px solid rgba(220, 38, 38, 0.2)",
                    }}
                  >
                    Sales: {isSalesPos ? "+" : ""}{growthPct.toFixed(1)}%
                  </span>
                ) : null}

                {/* Incentive Growth */}
                {isLoadingIncentiveHistory ? (
                  <span className="h-4 w-12 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                ) : isNewIncentiveProduct ? (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap">
                    Insentif Baru
                  </span>
                ) : growthIncentivePct != null ? (
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap leading-tight"
                    style={{
                      color: isIncPos ? "#16a34a" : "#dc2626",
                      background: isIncPos ? "rgba(22, 163, 74, 0.1)" : "rgba(220, 38, 38, 0.1)",
                      border: isIncPos ? "1px solid rgba(22, 163, 74, 0.2)" : "1px solid rgba(220, 38, 38, 0.2)",
                    }}
                  >
                    Insentif: {isIncPos ? "+" : ""}{growthIncentivePct.toFixed(1)}%
                  </span>
                ) : null}
              </div>
            </div>

            {/* Monthly / Data Table (table-fixed 100% width, zero horizontal scroll) */}
            <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
              <table className="w-full text-xs border-collapse table-fixed">
                <thead>
                  <tr style={{ background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
                    <th className="py-2 px-1.5 text-left font-semibold text-[11px] w-[22%]" style={{ color: "var(--color-text-muted)" }}>
                      Bulan
                    </th>
                    <th className="py-2 px-1 text-center font-semibold text-[11px] w-[14%]" style={{ color: "var(--color-text-muted)" }}>
                      Qty
                    </th>
                    <th className="py-2 px-1.5 text-right font-semibold text-[11px] w-[36%]" style={{ color: "var(--color-text-muted)" }}>
                      Est. Sales
                    </th>
                    <th className="py-2 px-1.5 text-right font-semibold text-[11px] w-[28%]" style={{ color: "var(--color-blue)" }}>
                      Insentif
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                  {months ? (
                    months.map((m, mIdx) => {
                      const mbEst = m.estSales ?? 0;
                      const mbDeltaSales = mbEst - histSalesPerMonth;
                      const mbGrowthSalesPct = histSalesPerMonth > 0 ? (mbDeltaSales / histSalesPerMonth) * 100 : null;
                      const isMbSalesPos = mbGrowthSalesPct != null && mbGrowthSalesPct >= 0;

                      return (
                        <tr key={mIdx} className="hover:bg-[var(--color-bg-subtle)] transition-colors">
                          <td className="py-2 px-1.5 font-medium text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                            {m.monthLabel || m.month}
                          </td>
                          <td className="py-2 px-1 text-center font-bold text-xs" style={{ color: "var(--color-text)" }}>
                            {m.qty}
                          </td>
                          <td className="py-2 px-1.5 text-right whitespace-nowrap">
                            <div className="font-medium text-xs leading-tight" style={{ color: "var(--color-text)" }}>
                              {mbEst > 0 ? `Rp\u00A0${formatRp(mbEst)}` : "-"}
                            </div>
                            {isLoadingB3 ? (
                              <span className="inline-block h-2.5 w-8 bg-slate-200 dark:bg-slate-700/60 rounded animate-pulse" />
                            ) : salesHistorical <= 0 ? (
                              mbEst > 0 ? (
                                <div className="text-[10px] font-semibold text-emerald-600 leading-tight">
                                  Baru
                                </div>
                              ) : null
                            ) : mbGrowthSalesPct != null ? (
                              <div className={`text-[10px] font-bold tabular-nums leading-tight mt-0.5 ${isMbSalesPos ? "text-emerald-600" : "text-rose-600"}`}>
                                {isMbSalesPos ? "+" : ""}{mbGrowthSalesPct.toFixed(1)}%
                              </div>
                            ) : null}
                          </td>
                          <td className="py-2 px-1.5 text-right font-semibold whitespace-nowrap text-xs" style={{ color: "var(--color-blue)" }}>
                            {(m.nilaiSc ?? 0) > 0 ? `Rp\u00A0${formatRp(m.nilaiSc ?? 0)}` : "-"}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td className="py-2 px-1.5 font-medium text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                        {productDetailRows.distinctMonths[0]
                          ? formatShortMonth(productDetailRows.distinctMonths[0]) || productDetailRows.distinctMonths[0]
                          : "1 Bulan"}
                      </td>
                      <td className="py-2 px-1 text-center font-bold text-xs" style={{ color: "var(--color-text)" }}>
                        {totalQty || qty || 0}
                      </td>
                      <td className="py-2 px-1.5 text-right whitespace-nowrap">
                        <div className="font-medium text-xs leading-tight" style={{ color: "var(--color-text)" }}>
                          {estSalesFull > 0 ? `Rp\u00A0${formatRp(estSalesFull)}` : "-"}
                        </div>
                        {isLoadingB3 ? (
                          <span className="inline-block h-2.5 w-8 bg-slate-200 dark:bg-slate-700/60 rounded animate-pulse" />
                        ) : salesHistorical <= 0 ? (
                          estSalesFull > 0 ? (
                            <div className="text-[10px] font-semibold text-emerald-600 leading-tight">
                              Baru
                            </div>
                          ) : null
                        ) : growthPct != null ? (
                          <div className={`text-[10px] font-bold tabular-nums leading-tight mt-0.5 ${isSalesPos ? "text-emerald-600" : "text-rose-600"}`}>
                            {isSalesPos ? "+" : ""}{growthPct.toFixed(1)}%
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2 px-1.5 text-right font-semibold whitespace-nowrap text-xs" style={{ color: "var(--color-blue)" }}>
                        {nilaiScFull > 0 ? `Rp\u00A0${formatRp(nilaiScFull)}` : "-"}
                      </td>
                    </tr>
                  )}

                  {/* Subtotal row if multi-month */}
                  {months && (
                    <tr style={{ background: "rgba(59, 130, 246, 0.04)", fontWeight: 700 }}>
                      <td className="py-2.5 px-1.5 text-left text-[11px] font-bold" style={{ color: "var(--color-text)" }}>
                        Subtotal
                      </td>
                      <td className="py-2.5 px-1 text-center text-xs font-bold" style={{ color: "var(--color-text)" }}>
                        {totalQty}
                      </td>
                      <td className="py-2.5 px-1.5 text-right whitespace-nowrap">
                        <div className="text-xs font-bold" style={{ color: "var(--color-text)" }}>
                          Rp&nbsp;{formatRp(estSalesFull)}
                        </div>
                        {isLoadingB3 ? (
                          <span className="inline-block h-2.5 w-8 bg-slate-200 dark:bg-slate-700/60 rounded animate-pulse" />
                        ) : salesHistorical <= 0 ? (
                          estSalesFull > 0 ? (
                            <div className="text-[10px] font-semibold text-emerald-600 leading-tight">
                              Baru
                            </div>
                          ) : null
                        ) : growthPct != null ? (
                          <div className={`text-[10px] font-bold tabular-nums leading-tight mt-0.5 ${isSalesPos ? "text-emerald-600" : "text-rose-600"}`}>
                            {isSalesPos ? "+" : ""}{growthPct.toFixed(1)}%
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2.5 px-1.5 text-right whitespace-nowrap text-xs font-bold" style={{ color: "var(--color-blue)" }}>
                        Rp&nbsp;{formatRp(nilaiScFull)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Historical Details Footer */}
            {(salesHistorical > 0 || (historyIncentive != null && historyIncentive > 0)) && (
              <div
                className="pt-2 border-t grid grid-cols-2 gap-2 text-[11px]"
                style={{ borderColor: "var(--color-border)" }}
              >
                <div>
                  <span className="block text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                    Historis Sales ({b3RangeLabel || "B3"}):
                  </span>
                  <strong className="font-semibold whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                    {salesHistorical > 0 ? `Rp\u00A0${formatRp(salesHistorical)}` : "-"}
                  </strong>
                </div>
                <div className="text-right">
                  <span className="block text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                    Historis Insentif:
                  </span>
                  <strong className="font-semibold whitespace-nowrap" style={{ color: "var(--color-blue)" }}>
                    {historyIncentive && historyIncentive > 0 ? `Rp\u00A0${formatRp(historyIncentive)}` : "-"}
                  </strong>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Unselected Products Accordion */}
      {unselectedProducts.length > 0 && (
        <div
          className="rounded-xl border p-3 shadow-2xs space-y-2 text-xs"
          style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}
        >
          <div
            className="flex items-center justify-between cursor-pointer select-none"
            onClick={() => setShowUnselected((prev) => !prev)}
          >
            <div>
              <div className="font-semibold text-xs" style={{ color: "var(--color-text)" }}>
                Produk Tidak Dipilih ({unselectedProducts.length})
              </div>
              <div className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                Total Historis: Rp&nbsp;{formatRp(totalUnselectedSalesPeriod)}
              </div>
            </div>
            <button
              type="button"
              className="text-blue-600 font-semibold text-xs flex items-center gap-1 cursor-pointer"
            >
              <span>{showUnselected ? "Tutup" : "Lihat"}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`w-3.5 h-3.5 transition-transform ${showUnselected ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {showUnselected && (
            <div className="space-y-1.5 pt-2 border-t" style={{ borderColor: "var(--color-border)" }}>
              {unselectedProducts.map((u, uIdx) => (
                <div key={u.kodeProduk || uIdx} className="flex justify-between items-center text-[11px] py-1 border-b last:border-b-0 border-dashed" style={{ borderColor: "var(--color-border)" }}>
                  <span className="truncate pr-2 font-medium" style={{ color: "var(--color-text-muted)" }}>
                    {u.namaProduk}
                  </span>
                  <span className="font-semibold shrink-0 whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                    Rp&nbsp;{formatRp(u.totalSalesPeriode)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Grand Total Breakdown Card */}
      <div
        className="rounded-xl border overflow-hidden shadow-xs text-xs"
        style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}
      >
        <div
          className="px-3 py-2 border-b font-semibold text-xs flex items-center justify-between"
          style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)", color: "var(--color-text)" }}
        >
          <span>Total Akumulasi Per Produk</span>
          <span className="text-[11px] font-normal" style={{ color: "var(--color-text-muted)" }}>
            {productDetailRows.rows.length} Produk ({lama} Bulan)
          </span>
        </div>

        <table className="w-full text-xs border-collapse">
          <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
            <tr className="hover:bg-[var(--color-bg-subtle)] transition-colors">
              <td className="py-2.5 px-3 font-medium" style={{ color: "var(--color-text-muted)" }}>
                Total Estimasi Sales
              </td>
              <td className="py-2.5 px-3 text-right font-bold text-sm whitespace-nowrap shrink-0" style={{ color: "var(--color-text)" }}>
                Rp&nbsp;{formatRp(productDetailRows.sumEstSales)}
              </td>
            </tr>
            <tr className="hover:bg-[var(--color-bg-subtle)] transition-colors" style={{ background: "rgba(59, 130, 246, 0.03)" }}>
              <td className="py-2.5 px-3 font-medium" style={{ color: "var(--color-blue)" }}>
                Total Estimasi Insentif SC
              </td>
              <td className="py-2.5 px-3 text-right font-bold text-sm whitespace-nowrap shrink-0" style={{ color: "var(--color-blue)" }}>
                Rp&nbsp;{formatRp(productDetailRows.sumNilaiSc)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
