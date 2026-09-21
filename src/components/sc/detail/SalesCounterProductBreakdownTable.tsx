"use client";

import React, { useState, useMemo } from "react";
import { formatRp } from "./SalesCounterStatsPanel";
import { formatShortMonth } from "./utils/formatDateUtils";
import type { ProductDetailRowsSummary } from "./types/outletTable";
import { ProductBreakdownMobileView } from "../edit/ProductBreakdownMobileView";

export interface UnselectedProductItem {
  kodeProduk: string;
  namaProduk: string;
  avgSalesPerMonth: number;
  totalSalesPeriode: number;
}

export interface SalesCounterProductBreakdownTableProps {
  productDetailRows: ProductDetailRowsSummary;
  lama: number;
  b3RangeLabel?: string;
  isLoadingB3?: boolean;
  isLoadingIncentiveHistory?: boolean;
  unselectedProducts?: UnselectedProductItem[];
  showHintMobile?: boolean;
  isForm?: boolean;
}

export function SalesCounterProductBreakdownTable({
  productDetailRows,
  lama,
  b3RangeLabel,
  isLoadingB3 = false,
  isLoadingIncentiveHistory = false,
  unselectedProducts = [],
  showHintMobile = true,
  isForm = false,
}: SalesCounterProductBreakdownTableProps) {
  const [showAllUnselected, setShowAllUnselected] = useState(isForm);

  const fontSizeBase = isForm ? "text-xs" : "text-[11px]";
  const fontSizeHeader = isForm ? "text-xs font-semibold" : "font-semibold";
  const fontSizeSubtotal = isForm ? "text-xs" : "text-[11px]";
  const fontSizeTotal = isForm ? "text-xs font-bold sm:text-[13px]" : "text-[11px] font-bold";
  const fontSizeBadge = isForm ? "text-[10px] sm:text-[11px] font-semibold px-1.5 py-0.5" : "text-[10px] font-semibold px-1.5 py-0.5";
  const fontSizeGrowthPct = isForm ? "text-xs font-bold" : "text-[11px] font-bold";
  const fontSizeGrowthDelta = isForm ? "text-[10px] sm:text-[11px] font-medium mt-0.5" : "text-[10px] tabular-nums font-medium mt-0.5";
  const prodNameMaxWidth = isForm ? "max-w-[180px] sm:max-w-[240px]" : "max-w-[160px] sm:max-w-[200px]";
  const cellPadding = "px-3 py-2";

  const totalUnselectedSalesMonth = useMemo(() => {
    return unselectedProducts.reduce((sum, p) => sum + p.avgSalesPerMonth, 0);
  }, [unselectedProducts]);

  const totalUnselectedSalesPeriod = totalUnselectedSalesMonth * (lama || 1);

  const renderGrowthCell = (
    growthPct: number | null | undefined,
    delta: number,
    isNew?: boolean,
    isLoading?: boolean,
    emptyFallback = "-"
  ) => {
    if (isLoading) {
      return <span className="inline-block h-3.5 w-10 bg-slate-200 dark:bg-slate-700/60 rounded animate-pulse" />;
    }
    if (isNew) {
      return (
        <span
          className={`inline-block rounded border ${fontSizeBadge}`}
          style={{
            background: "rgba(22,163,74,0.12)",
            color: "#16a34a",
            borderColor: "rgba(22,163,74,0.3)",
          }}
        >
          Baru
        </span>
      );
    }
    if (growthPct == null) {
      return <span style={{ color: "var(--color-text-muted)" }}>{emptyFallback}</span>;
    }

    const isPos = growthPct >= 0;
    const isDeltaPos = delta >= 0;

    return (
      <div className="flex flex-col items-center py-0.5 leading-tight">
        <span className={`tabular-nums ${fontSizeGrowthPct} ${isPos ? "text-emerald-600" : "text-rose-600"}`}>
          {isPos ? `+${growthPct.toFixed(1)}%` : `${growthPct.toFixed(1)}%`}
        </span>
        <span
          className={`tabular-nums ${fontSizeGrowthDelta} ${
            isDeltaPos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
          }`}
        >
          {delta > 0 ? `+${formatRp(delta)}` : delta < 0 ? `-${formatRp(Math.abs(delta))}` : "0"}
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Mobile View: Phone-friendly cards with zero horizontal scroll */}
      <div className="md:hidden">
        <ProductBreakdownMobileView
          productDetailRows={productDetailRows}
          lama={lama}
          b3RangeLabel={b3RangeLabel}
          isLoadingB3={isLoadingB3}
          isLoadingIncentiveHistory={isLoadingIncentiveHistory}
          unselectedProducts={unselectedProducts}
          isForm={isForm}
        />
      </div>

      {/* Desktop View: Existing Table */}
      <div className="hidden md:block space-y-4">
        {/* Hint geser untuk mobile */}
        {showHintMobile && (
          <div className={`sm:hidden -mt-1 flex items-center gap-1 ${isForm ? "text-xs" : "text-[11px]"}`} style={{ color: "var(--color-text-faint)" }}>
            <span>↔</span> Geser tabel untuk melihat rincian angka &amp; growth
          </div>
        )}

        {/* Products table container */}
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
            <thead>
              <tr style={{ background: "var(--color-bg-subtle)" }}>
                <th
                  className={`text-left ${cellPadding} sticky left-0 z-10 border-r border-b ${fontSizeHeader}`}
                  style={{
                    color: "var(--color-text-muted)",
                    background: "var(--color-bg-subtle)",
                    borderColor: "var(--color-border)",
                  }}
                >
                  Produk SC
                </th>
                {productDetailRows.distinctMonths.length > 0 && (
                  <th
                    className={`text-left ${cellPadding} border-r border-b ${fontSizeHeader}`}
                    style={{ color: "var(--color-text-muted)", borderColor: "var(--color-border)" }}
                  >
                    Bulan
                  </th>
                )}
                <th
                  className={`text-right ${cellPadding} border-b whitespace-nowrap ${fontSizeHeader}`}
                  style={{ color: "var(--color-text-muted)", borderColor: "var(--color-border)" }}
                >
                  Qty
                </th>
                <th
                  className={`text-right ${cellPadding} border-b ${fontSizeHeader}`}
                  style={{ color: "var(--color-text-muted)", borderColor: "var(--color-border)" }}
                >
                  <div className="leading-tight text-center">
                    <div>Estimasi</div>
                    <div>Sales</div>
                  </div>
                </th>
                <th
                  className={`text-center ${cellPadding} border-b ${fontSizeHeader}`}
                  style={{ color: "var(--color-text-muted)", borderColor: "var(--color-border)" }}
                >
                  <div className="leading-tight">
                    <div>Growth</div>
                    <div>Sales</div>
                  </div>
                </th>
                <th
                  className={`text-right ${cellPadding} border-b ${fontSizeHeader}`}
                  style={{ color: "var(--color-text-muted)", borderColor: "var(--color-border)" }}
                >
                  <div className="leading-tight text-center">
                    <div>Insentif</div>
                    <div>SC</div>
                  </div>
                </th>
                <th
                  className={`text-center ${cellPadding} border-b ${fontSizeHeader}`}
                  style={{ color: "var(--color-text-muted)", borderColor: "var(--color-border)" }}
                >
                  <div className="leading-tight">
                    <div>Growth</div>
                    <div>Insentif SC</div>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {productDetailRows.rows.map(
                (
                  {
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
                  },
                  rowIdx
                ) => {
                  const isMultiMonth =
                    productDetailRows.distinctMonths.length > 1 && monthlyBreakdown && monthlyBreakdown.length > 1;
                  const months = isMultiMonth ? monthlyBreakdown! : null;
                  const numSubRows = months ? months.length + 1 : 1;

                  const lamaEffective = lama || 1;
                  const histSalesPerMonth = salesHistorical > 0 ? salesHistorical / lamaEffective : 0;
                  const histIncPerMonth = (historyIncentive || 0) > 0 ? (historyIncentive || 0) / lamaEffective : 0;

                  // Total / single-row growth cells
                  const totDeltaSales = estSalesFull - salesHistorical;
                  const totGrowthSalesCell = renderGrowthCell(
                    salesHistorical > 0 ? growthPct : null,
                    totDeltaSales,
                    salesHistorical <= 0,
                    isLoadingB3
                  );

                  const totDeltaInc = (nilaiScFull || 0) - (historyIncentive || 0);
                  const totGrowthInsentifCell = renderGrowthCell(
                    historyIncentive && historyIncentive > 0 ? growthIncentivePct : null,
                    totDeltaInc,
                    isNewIncentiveProduct,
                    isLoadingIncentiveHistory
                  );

                  if (!months) {
                    // Single-month (or flat) row
                    const singleMonthLabel =
                      monthlyBreakdown?.[0]?.monthLabel ||
                      (productDetailRows.distinctMonths[0]
                        ? formatShortMonth(productDetailRows.distinctMonths[0]) || productDetailRows.distinctMonths[0]
                        : "");

                    return (
                      <tr key={p.id} className="align-middle" style={{ borderTop: "1px solid var(--color-border)" }}>
                        <td
                          className={`${cellPadding} sticky left-0 z-10 border-r font-semibold ${fontSizeBase}`}
                          style={{
                            color: "var(--color-text)",
                            background: "var(--color-surface)",
                            borderColor: "var(--color-border)",
                          }}
                        >
                          <div className={`${prodNameMaxWidth} whitespace-normal leading-snug`}>
                            {p.namaProduk}
                          </div>
                        </td>
                        {productDetailRows.distinctMonths.length > 0 && (
                          <td
                            className={`${cellPadding} border-r whitespace-nowrap font-medium ${fontSizeBase}`}
                            style={{ color: "var(--color-text-muted)", borderColor: "var(--color-border)" }}
                          >
                            {singleMonthLabel || "-"}
                          </td>
                        )}
                        <td
                          className={`${cellPadding} text-right tabular-nums font-mono whitespace-nowrap ${fontSizeBase}`}
                          style={{ color: "var(--color-text)" }}
                        >
                          {totalQty || qty || 0}
                        </td>
                        <td
                          className={`${cellPadding} text-right whitespace-nowrap ${fontSizeBase}`}
                          style={{ color: "var(--color-text)" }}
                        >
                          {estSalesFull > 0 ? (
                            <span className="tabular-nums">{formatRp(estSalesFull)}</span>
                          ) : (
                            <span style={{ color: "var(--color-text-faint)" }}>-</span>
                          )}
                        </td>
                        <td className={`${cellPadding} text-center whitespace-nowrap ${fontSizeBase}`}>{totGrowthSalesCell}</td>
                        <td
                          className={`${cellPadding} text-right whitespace-nowrap font-semibold ${fontSizeBase}`}
                          style={{ color: nilaiScFull > 0 ? "var(--color-blue)" : "var(--color-text-faint)" }}
                        >
                          {nilaiScFull > 0 ? <span className="tabular-nums">{formatRp(nilaiScFull)}</span> : "-"}
                        </td>
                        <td className={`${cellPadding} text-center whitespace-nowrap ${fontSizeBase}`}>{totGrowthInsentifCell}</td>
                      </tr>
                    );
                  }

                  // Multi-month: product name rowspans all sub-rows
                  return months
                    .map((mb, mIdx) => {
                      const isFirstRow = mIdx === 0;
                      const borderTop = isFirstRow ? "2px solid var(--color-border)" : "1px solid var(--color-border)";

                      const mbEst = mb.estSales ?? 0;
                      const mbDeltaSales = mbEst - histSalesPerMonth;
                      const mbGrowthSalesPct =
                        histSalesPerMonth > 0 ? (mbDeltaSales / histSalesPerMonth) * 100 : null;
                      const monthGrowthSalesCell = renderGrowthCell(
                        salesHistorical > 0 ? mbGrowthSalesPct : null,
                        mbDeltaSales,
                        salesHistorical <= 0,
                        isLoadingB3
                      );

                      const mbSc = mb.nilaiSc ?? 0;
                      const mbDeltaInc = mbSc - histIncPerMonth;
                      const mbGrowthIncPct = histIncPerMonth > 0 ? (mbDeltaInc / histIncPerMonth) * 100 : null;
                      const monthGrowthInsentifCell = renderGrowthCell(
                        historyIncentive && historyIncentive > 0 ? mbGrowthIncPct : null,
                        mbDeltaInc,
                        isNewIncentiveProduct,
                        isLoadingIncentiveHistory
                      );

                      return (
                        <tr key={`${p.id}-${mb.month}`} className="align-middle">
                          {isFirstRow && (
                            <td
                              rowSpan={numSubRows}
                              className={`${cellPadding} sticky left-0 z-10 border-r font-semibold align-top ${fontSizeBase}`}
                              style={{
                                color: "var(--color-text)",
                                background: "var(--color-surface)",
                                borderColor: "var(--color-border)",
                                borderTop,
                                paddingTop: isForm ? "10px" : "8px",
                              }}
                            >
                              <div className={`${prodNameMaxWidth} whitespace-normal leading-snug`}>
                                {p.namaProduk}
                              </div>
                            </td>
                          )}
                          {/* Month label */}
                          <td
                            className={`${cellPadding} border-r whitespace-nowrap font-medium ${fontSizeBase}`}
                            style={{ color: "var(--color-text-muted)", borderColor: "var(--color-border)", borderTop }}
                          >
                            {mb.monthLabel}
                          </td>
                          {/* Qty */}
                          <td
                            className={`${cellPadding} text-right tabular-nums font-mono whitespace-nowrap ${fontSizeBase}`}
                            style={{ color: "var(--color-text)", borderTop }}
                          >
                            {mb.qty > 0 ? mb.qty : <span style={{ color: "var(--color-text-faint)" }}>-</span>}
                          </td>
                          {/* Est Sales */}
                          <td
                            className={`${cellPadding} text-right tabular-nums whitespace-nowrap ${fontSizeBase}`}
                            style={{ color: "var(--color-text)", borderTop }}
                          >
                            {(mb.estSales ?? 0) > 0 ? (
                              formatRp(mb.estSales!)
                            ) : (
                              <span style={{ color: "var(--color-text-faint)" }}>-</span>
                            )}
                          </td>
                          {/* Growth Sales — broken down per month */}
                          <td className={`${cellPadding} text-center whitespace-nowrap ${fontSizeBase}`} style={{ borderTop }}>
                            {monthGrowthSalesCell}
                          </td>
                          {/* Insentif SC */}
                          <td
                            className={`${cellPadding} text-right tabular-nums whitespace-nowrap font-semibold ${fontSizeBase}`}
                            style={{
                              color: (mb.nilaiSc ?? 0) > 0 ? "var(--color-blue)" : "var(--color-text-faint)",
                              borderTop,
                            }}
                          >
                            {(mb.nilaiSc ?? 0) > 0 ? formatRp(mb.nilaiSc!) : "-"}
                          </td>
                          {/* Growth Insentif — broken down per month */}
                          <td className={`${cellPadding} text-center whitespace-nowrap ${fontSizeBase}`} style={{ borderTop }}>
                            {monthGrowthInsentifCell}
                          </td>
                        </tr>
                      );
                    })
                    .concat(
                      // "Subtotal" summary sub-row
                      <tr
                        key={`${p.id}-tot`}
                        className="align-middle font-semibold"
                        style={{ background: "var(--color-bg)" }}
                      >
                        <td
                          className={`${cellPadding} border-r border-t whitespace-nowrap font-semibold ${fontSizeSubtotal}`}
                          style={{ color: "var(--color-text)", borderColor: "var(--color-border)" }}
                        >
                          Subtotal
                        </td>
                        <td
                          className={`${cellPadding} text-right tabular-nums font-mono whitespace-nowrap border-t ${fontSizeSubtotal}`}
                          style={{ color: "var(--color-text)", borderColor: "var(--color-border)" }}
                        >
                          {totalQty}
                        </td>
                        <td
                          className={`${cellPadding} text-right whitespace-nowrap border-t ${fontSizeSubtotal}`}
                          style={{ color: "var(--color-text)", borderColor: "var(--color-border)" }}
                        >
                          {estSalesFull > 0 ? (
                            <span className="tabular-nums">{formatRp(estSalesFull)}</span>
                          ) : (
                            <span style={{ color: "var(--color-text-muted)" }}>-</span>
                          )}
                        </td>
                        <td className={`${cellPadding} text-center whitespace-nowrap border-t ${fontSizeSubtotal}`} style={{ borderColor: "var(--color-border)" }}>
                          {totGrowthSalesCell}
                        </td>
                        <td
                          className={`${cellPadding} text-right whitespace-nowrap border-t font-semibold ${fontSizeSubtotal}`}
                          style={{
                            color: nilaiScFull > 0 ? "var(--color-blue)" : "var(--color-text-muted)",
                            borderColor: "var(--color-border)",
                          }}
                        >
                          {nilaiScFull > 0 ? (
                            <span className="tabular-nums">{formatRp(nilaiScFull)}</span>
                          ) : (
                            <span style={{ color: "var(--color-text-muted)" }}>-</span>
                          )}
                        </td>
                        <td className={`${cellPadding} text-center whitespace-nowrap border-t ${fontSizeSubtotal}`} style={{ borderColor: "var(--color-border)" }}>
                          {totGrowthInsentifCell}
                        </td>
                      </tr>
                    );
                }
              )}
            </tbody>
            <tfoot>
              {/* Grand total — same month-row pattern */}
              {productDetailRows.distinctMonths.length > 1 &&
                productDetailRows.monthlyTotalBreakdown?.map((mb, mIdx) => {
                  const mEst = productDetailRows.rows.reduce(
                    (s, r) => s + (r.monthlyBreakdown?.find((x) => x.month === mb.month)?.estSales ?? 0),
                    0
                  );
                  const mSc = productDetailRows.rows.reduce(
                    (s, r) => s + (r.monthlyBreakdown?.find((x) => x.month === mb.month)?.nilaiSc ?? 0),
                    0
                  );
                  const isFirst = mIdx === 0;
                  const borderTop = isFirst ? "2px solid var(--color-border)" : "1px solid var(--color-border)";

                  const lamaEffective = lama || 1;
                  const outletHistMonth =
                    productDetailRows.effectiveOutletSalesPerMonth > 0
                      ? productDetailRows.effectiveOutletSalesPerMonth
                      : lamaEffective > 0
                      ? productDetailRows.sumSalesHistorical / lamaEffective
                      : 0;

                  const mDeltaSales = mEst - outletHistMonth;
                  const mGrowthSalesPct = outletHistMonth > 0 ? (mDeltaSales / outletHistMonth) * 100 : null;
                  const mGrowthSalesCell = renderGrowthCell(
                    outletHistMonth > 0 ? mGrowthSalesPct : null,
                    mDeltaSales,
                    outletHistMonth <= 0 && productDetailRows.sumSalesHistorical <= 0,
                    isLoadingB3
                  );

                  const outletHistIncMonth =
                    lamaEffective > 0 ? (productDetailRows.sumHistoryIncentive || 0) / lamaEffective : 0;
                  const mDeltaInc = mSc - outletHistIncMonth;
                  const mGrowthIncPct = outletHistIncMonth > 0 ? (mDeltaInc / outletHistIncMonth) * 100 : null;
                  const mGrowthIncCell = renderGrowthCell(
                    outletHistIncMonth > 0 ? mGrowthIncPct : null,
                    mDeltaInc,
                    productDetailRows.isNewIncentiveTotal,
                    isLoadingIncentiveHistory
                  );

                  return (
                    <tr
                      key={`grand-${mb.month}`}
                      className="align-middle font-semibold"
                      style={{ background: "var(--color-bg-subtle)" }}
                    >
                      {isFirst && (
                        <td
                          rowSpan={(productDetailRows.monthlyTotalBreakdown?.length ?? 0) + 1}
                          className={`${cellPadding} sticky left-0 z-10 border-r align-top font-bold ${fontSizeBase}`}
                          style={{
                            color: "var(--color-text)",
                            background: "var(--color-bg-subtle)",
                            borderColor: "var(--color-border)",
                            borderTop: "2px solid var(--color-border-strong)",
                            paddingTop: isForm ? "10px" : "8px",
                          }}
                        >
                          Total
                        </td>
                      )}
                      <td
                        className={`${cellPadding} border-r whitespace-nowrap font-medium ${fontSizeBase}`}
                        style={{
                          color: "var(--color-text-muted)",
                          borderColor: "var(--color-border)",
                          borderTop: isFirst ? "2px solid var(--color-border-strong)" : "1px solid var(--color-border)",
                        }}
                      >
                        {mb.monthLabel}
                      </td>
                      <td
                        className={`${cellPadding} text-right tabular-nums font-mono whitespace-nowrap ${fontSizeBase}`}
                        style={{
                          color: "var(--color-text)",
                          borderTop: isFirst ? "2px solid var(--color-border-strong)" : "1px solid var(--color-border)",
                        }}
                      >
                        {mb.qty > 0 ? mb.qty : <span style={{ color: "var(--color-text-faint)" }}>-</span>}
                      </td>
                      <td
                        className={`${cellPadding} text-right tabular-nums whitespace-nowrap ${fontSizeBase}`}
                        style={{
                          color: "var(--color-text)",
                          borderTop: isFirst ? "2px solid var(--color-border-strong)" : "1px solid var(--color-border)",
                        }}
                      >
                        {mEst > 0 ? formatRp(mEst) : <span style={{ color: "var(--color-text-faint)" }}>-</span>}
                      </td>
                      <td
                        className={`${cellPadding} text-center whitespace-nowrap ${fontSizeBase}`}
                        style={{ borderTop: isFirst ? "2px solid var(--color-border-strong)" : "1px solid var(--color-border)" }}
                      >
                        {mGrowthSalesCell}
                      </td>
                      <td
                        className={`${cellPadding} text-right tabular-nums whitespace-nowrap font-semibold ${fontSizeBase}`}
                        style={{
                          color: mSc > 0 ? "var(--color-blue)" : "var(--color-text-faint)",
                          borderTop: isFirst ? "2px solid var(--color-border-strong)" : "1px solid var(--color-border)",
                        }}
                      >
                        {mSc > 0 ? formatRp(mSc) : "-"}
                      </td>
                      <td
                        className={`${cellPadding} text-center whitespace-nowrap ${fontSizeBase}`}
                        style={{ borderTop: isFirst ? "2px solid var(--color-border-strong)" : "1px solid var(--color-border)" }}
                      >
                        {mGrowthIncCell}
                      </td>
                    </tr>
                  );
                })}
              {/* Grand total summary row */}
              <tr
                className="align-middle font-semibold"
                style={{
                  background: "var(--color-bg-subtle)",
                  borderTop: "2px solid var(--color-border-strong)",
                }}
              >
                {productDetailRows.distinctMonths.length <= 1 && (
                  <td
                    className={`${cellPadding} sticky left-0 z-10 border-r font-bold ${fontSizeTotal}`}
                    style={{
                      color: "var(--color-text)",
                      background: "var(--color-bg-subtle)",
                      borderColor: "var(--color-border)",
                    }}
                  >
                    Total
                  </td>
                )}
                {productDetailRows.distinctMonths.length > 1 ? (
                  <td
                    className={`${cellPadding} border-r whitespace-nowrap font-bold ${fontSizeTotal}`}
                    style={{ color: "var(--color-text)", borderColor: "var(--color-border)" }}
                  >
                    Total Periode
                  </td>
                ) : productDetailRows.distinctMonths.length === 1 ? (
                  <td
                    className={`${cellPadding} border-r whitespace-nowrap font-semibold ${fontSizeTotal}`}
                    style={{ color: "var(--color-text)", borderColor: "var(--color-border)" }}
                  >
                    {productDetailRows.monthlyTotalBreakdown?.[0]?.monthLabel ||
                      (productDetailRows.distinctMonths[0]
                        ? formatShortMonth(productDetailRows.distinctMonths[0]) || productDetailRows.distinctMonths[0]
                        : "Total")}
                  </td>
                ) : null}
                <td
                  className={`${cellPadding} text-right tabular-nums font-mono whitespace-nowrap font-bold ${fontSizeTotal}`}
                  style={{ color: "var(--color-text)" }}
                >
                  {productDetailRows.sumTotalQty}
                </td>
                <td className={`${cellPadding} text-right whitespace-nowrap ${fontSizeTotal}`} style={{ color: "var(--color-text)" }}>
                  {productDetailRows.sumEstSales > 0 ? (
                    <span className="tabular-nums font-bold">{formatRp(productDetailRows.sumEstSales)}</span>
                  ) : (
                    "-"
                  )}
                </td>
                <td className={`${cellPadding} text-center whitespace-nowrap ${fontSizeTotal}`}>
                  {renderGrowthCell(
                    productDetailRows.effectiveOutletSalesFull > 0 || productDetailRows.sumSalesHistorical > 0
                      ? productDetailRows.overallGrowthPct
                      : null,
                    productDetailRows.sumEstSales -
                      (productDetailRows.effectiveOutletSalesFull > 0
                        ? productDetailRows.effectiveOutletSalesFull
                        : productDetailRows.sumSalesHistorical),
                    productDetailRows.effectiveOutletSalesFull <= 0 && productDetailRows.sumSalesHistorical <= 0,
                    isLoadingB3
                  )}
                </td>
                <td
                  className={`${cellPadding} text-right whitespace-nowrap ${fontSizeTotal}`}
                  style={{ color: productDetailRows.sumNilaiSc > 0 ? "var(--color-blue)" : "var(--color-text-muted)" }}
                >
                  {productDetailRows.sumNilaiSc > 0 ? (
                    <span className="tabular-nums font-bold">{formatRp(productDetailRows.sumNilaiSc)}</span>
                  ) : (
                    "-"
                  )}
                </td>
                <td className={`${cellPadding} text-center whitespace-nowrap ${fontSizeTotal}`}>
                  {renderGrowthCell(
                    productDetailRows.sumHistoryIncentive &&
                      productDetailRows.sumHistoryIncentive > 0 &&
                      productDetailRows.overallIncentiveGrowthPct != null
                      ? productDetailRows.overallIncentiveGrowthPct
                      : null,
                    productDetailRows.sumNilaiSc - (productDetailRows.sumHistoryIncentive || 0),
                    productDetailRows.isNewIncentiveTotal,
                    isLoadingIncentiveHistory
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {b3RangeLabel && (
          <p
            className={`px-3 py-2 border-t ${isForm ? "text-xs" : "text-[11px]"}`}
            style={{
              color: "var(--color-text-faint)",
              borderColor: "var(--color-border)",
              background: "var(--color-bg-subtle)",
            }}
          >
            * Growth Sales &amp; Insentif SC Dihitung dari Histori Quarter ({b3RangeLabel})
          </p>
        )}
      </div>

      {/* Tabel Produk SC yang Tidak Diajukan */}
      {unselectedProducts.length > 0 && (
        <div className="space-y-2 mt-4">
          <div
            onClick={() => setShowAllUnselected((prev) => !prev)}
            className="flex items-center justify-between flex-wrap gap-2 cursor-pointer select-none py-1 group"
          >
            <div className="flex items-center gap-2">
              <svg
                className={`w-3.5 h-3.5 transition-transform duration-200 ${
                  showAllUnselected ? "rotate-0" : "-rotate-90"
                }`}
                style={{ color: "var(--color-red)" }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
              </svg>
              <span
                className={`font-semibold uppercase tracking-wider group-hover:opacity-80 transition-opacity ${isForm ? "text-xs sm:text-sm" : "text-xs"}`}
                style={{ color: "var(--color-red)" }}
              >
                Produk SC dengan Sales yang Tidak Diajukan ({unselectedProducts.length})
              </span>
            </div>
            <span className={`font-medium ${isForm ? "text-xs sm:text-sm" : "text-[11px]"}`} style={{ color: "var(--color-text-muted)" }}>
              {showAllUnselected ? "Tutup" : "Lihat Rincian"}
            </span>
          </div>

          {showAllUnselected && (
            <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr style={{ background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
                    <th
                      className={`text-left ${cellPadding} font-semibold ${fontSizeHeader}`}
                      style={{ color: "var(--color-text-muted)", width: 44 }}
                    >
                      No
                    </th>
                    <th className={`text-left ${cellPadding} font-semibold ${fontSizeHeader}`} style={{ color: "var(--color-text-muted)" }}>
                      Produk SC
                    </th>
                    <th className={`text-right ${cellPadding} font-semibold ${fontSizeHeader}`} style={{ color: "var(--color-text-muted)" }}>
                      Histori Rata-rata
                    </th>
                    <th className={`text-right ${cellPadding} font-semibold ${fontSizeHeader}`} style={{ color: "var(--color-text-muted)" }}>
                      Potensi Periode ({lama || 1} bln)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {unselectedProducts.map((p, idx) => (
                    <tr
                      key={p.kodeProduk}
                      className="align-middle transition-colors"
                      style={{ borderBottom: "1px solid var(--color-border)" }}
                    >
                      <td
                        className={`${cellPadding} text-left tabular-nums ${fontSizeBase}`}
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {idx + 1}
                      </td>
                      <td className={`${cellPadding} font-medium ${fontSizeBase}`} style={{ color: "var(--color-text)" }}>
                        {p.namaProduk}
                      </td>
                      <td
                        className={`${cellPadding} text-right tabular-nums font-mono ${fontSizeBase}`}
                        style={{ color: "var(--color-text)" }}
                      >
                        {formatRp(p.avgSalesPerMonth)}
                      </td>
                      <td
                        className={`${cellPadding} text-right tabular-nums font-mono font-medium ${fontSizeBase}`}
                        style={{ color: "var(--color-text)" }}
                      >
                        {formatRp(p.totalSalesPeriode)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="align-middle font-semibold" style={{ background: "var(--color-bg-subtle)" }}>
                    <td colSpan={2} className={`${cellPadding} text-left ${fontSizeBase}`} style={{ color: "var(--color-text)" }}>
                      Total ({unselectedProducts.length} Produk)
                    </td>
                    <td
                      className={`${cellPadding} text-right tabular-nums font-mono font-bold ${fontSizeBase}`}
                      style={{ color: "var(--color-text)" }}
                    >
                      {formatRp(totalUnselectedSalesMonth)}
                    </td>
                    <td
                      className={`${cellPadding} text-right tabular-nums font-mono font-bold ${fontSizeBase}`}
                      style={{ color: "var(--color-text)" }}
                    >
                      {formatRp(totalUnselectedSalesPeriod)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
