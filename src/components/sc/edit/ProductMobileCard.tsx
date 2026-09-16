"use client";

import { useState } from "react";
import { Req, InfoTooltip } from "./ui";
import { formatRpNumber as formatRp } from "./utils/formatEditUtils";
import { satuanLabel, formatHnaLabel } from "./utils/productMatcherUtils";
import { Combobox } from "@/components/ui/Combobox";

export interface ProductMobileCardProps {
  row: any;
  idx: number;
  readOnly?: boolean;
  masterProducts: any[];
  canvasserProducts: any[];
  productsOptions: any[];
  rows: any[];
  onUpdateRow: (index: number, updatedFields: any) => void;
  onRemoveRow: (index: number) => void;
  setDeleteIndex: (index: number) => void;
  numMonths: number;
  monthLabels: string[];
  diskonPeriode?: string | number;
  b3RangeLabel?: string;
  historyPeriodRange?: string;
  b1Label?: string;
  b2Label?: string;
  b3Label?: string;
  b3SalesMap?: Map<string, number>;
  b3QtyMap?: Map<string, number>;
  historySalesMap: Map<string, any>;
  historyIncentiveMap: Map<string, any>;
  cashbackDetails: any;
  isCashbackNotFound: boolean;
  getCompetitorsForRow: (kodeProduk: string) => any[];
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export function ProductMobileCard({
  row,
  idx,
  readOnly = false,
  masterProducts,
  canvasserProducts,
  productsOptions,
  rows,
  onUpdateRow,
  onRemoveRow,
  setDeleteIndex,
  numMonths,
  monthLabels,
  diskonPeriode,
  b3RangeLabel,
  historyPeriodRange,
  b1Label,
  b2Label,
  b3Label,
  b3SalesMap,
  b3QtyMap,
  historySalesMap,
  historyIncentiveMap,
  cashbackDetails,
  isCashbackNotFound,
  getCompetitorsForRow,
  isExpanded: controlledExpanded,
  onToggleExpand,
}: ProductMobileCardProps) {
  const [internalExpanded, setInternalExpanded] = useState(true);
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  const toggleExpand = () => {
    if (onToggleExpand) {
      onToggleExpand();
    } else {
      setInternalExpanded((prev) => !prev);
    }
  };

  const masterProduct = masterProducts.find((p) => p.kodeProduk === row.kodeProduk);
  const canvasserProduct = canvasserProducts.find(
    (p) =>
      p.pro_code === row.kodeProduk ||
      p.pro_code?.replace(/^0+/, "") === row.kodeProduk?.replace(/^0+/, "")
  );

  const hnaSJ = masterProduct ? (parseFloat(masterProduct.hna) || 0) : 0;
  const currentMonthly: string[] = Array.isArray(row.monthlyQty) && row.monthlyQty.length === numMonths
    ? row.monthlyQty.map((val: any) => String(val).replace(/^0+(?=\d)/, ""))
    : Array.from({ length: numMonths }, (_, mIdx) => {
        if (Array.isArray(row.monthlyQty) && row.monthlyQty[mIdx] !== undefined) {
          return String(row.monthlyQty[mIdx]).replace(/^0+(?=\d)/, "");
        }
        return row.qtyPerBulan ? String(row.qtyPerBulan).replace(/^0+(?=\d)/, "") : "0";
      });

  let totalQtySwitch = 0;
  let hasAnyMonthlyVal = false;
  for (const v of currentMonthly) {
    if (v !== "" && !isNaN(parseFloat(v))) {
      totalQtySwitch += parseFloat(v);
      hasAnyMonthlyVal = true;
    }
  }

  const effectiveQtyUb = hasAnyMonthlyVal
    ? (numMonths > 0 ? totalQtySwitch / numMonths : 0)
    : (parseFloat(row.qtyPerBulan) || 0);

  const qtyUb = effectiveQtyUb;
  const estSalesBln = qtyUb * hnaSJ;
  const pctMatriks = parseFloat(row.persenMatriksSc) || 0;

  const scVal = canvasserProduct?.sales_counter_value;
  const scMin = canvasserProduct?.sales_counter_minimum != null ? Number(canvasserProduct.sales_counter_minimum) : 0;
  const targetSellInBln = scMin * hnaSJ;

  const monthlyEstSales = Array.from({ length: numMonths }, (_, mIdx) => {
    const mQty = parseFloat(currentMonthly[mIdx]) || 0;
    return mQty * hnaSJ;
  });

  const underTargetMonths = Array.from({ length: numMonths }, (_, mIdx) => {
    const mSales = monthlyEstSales[mIdx];
    return targetSellInBln > 0 && mSales < targetSellInBln ? monthLabels[mIdx] : null;
  }).filter(Boolean) as string[];

  const totalEstSalesRow = monthlyEstSales.reduce((s, v) => s + v, 0);

  const cleanKode = (row.kodeProduk || "").trim();
  const historyData = historySalesMap.get(cleanKode) ?? historySalesMap.get(cleanKode.replace(/^0+/, ""));
  const rawB3Sales = b3SalesMap?.get(cleanKode) ?? b3SalesMap?.get(cleanKode.replace(/^0+/, "")) ?? 0;
  const b1 = Number(historyData?.sales_b1) || 0;
  const b2 = Number(historyData?.sales_b2) || 0;
  const b3 = Number(historyData?.sales_b3) || 0;
  const totalQtyB3 = b1 + b2 + b3;
  const avgQtyB3 = historyData ? (totalQtyB3 / 3) : 0;
  const postB3Qty = b3QtyMap?.get(cleanKode) ?? b3QtyMap?.get(cleanKode.replace(/^0+/, ""));
  const historyDisplayVal = postB3Qty != null ? postB3Qty : (avgQtyB3 || 0);

  let avgSalesBln = 0;
  if (historyData != null && hnaSJ > 0) {
    avgSalesBln = avgQtyB3 * hnaSJ;
  } else if (rawB3Sales > 0) {
    avgSalesBln = rawB3Sales;
  }

  let growthSalesPct: number | null = null;
  if (avgSalesBln > 0) {
    growthSalesPct = ((estSalesBln - avgSalesBln) / avgSalesBln) * 100;
  }

  const monthlyNilaiSc = Array.from({ length: numMonths }, (_, mIdx) => {
    const mQty = parseFloat(currentMonthly[mIdx]) || 0;
    const mEstSales = mQty * hnaSJ;
    if (scVal != null && scVal > 0) {
      return mQty >= scMin ? mQty * scVal : 0;
    }
    return mEstSales * (pctMatriks / 100);
  });

  const totalNilaiScPeriode = monthlyNilaiSc.reduce((s, v) => s + v, 0);
  const avgNilaiScBln = numMonths > 0 ? (totalNilaiScPeriode / numMonths) : 0;

  const strippedCode = cleanKode.replace(/^0+/, "");
  const historyIncentiveEntry = historyIncentiveMap.get(cleanKode) || (strippedCode ? historyIncentiveMap.get(strippedCode) : undefined);
  const historyIncentiveVal = historyIncentiveEntry != null ? Number(historyIncentiveEntry.win_incentive) || 0 : 0;
  const overallIncentiveGrowthPct = historyIncentiveVal > 0 ? ((avgNilaiScBln - historyIncentiveVal) / historyIncentiveVal) * 100 : null;

  const monthlyCashback = cashbackDetails.monthlyBreakdownMap?.get(row.kodeProduk) ?? Array(numMonths).fill(0);
  const totalCashbackPeriode = cashbackDetails.resultMap.get(row.kodeProduk) ?? monthlyCashback.reduce((s: number, v: number) => s + v, 0);

  const handleMonthChange = (mIdx: number, newVal: string) => {
    const cleanVal = newVal === "" ? "" : newVal.replace(/^0+(?=\d)/, "");
    const nextMonthly = [...currentMonthly];
    nextMonthly[mIdx] = cleanVal;

    let totalQty = 0;
    let hasAnyValue = false;
    for (const v of nextMonthly) {
      if (v !== "" && !isNaN(parseFloat(v))) {
        totalQty += parseFloat(v);
        hasAnyValue = true;
      }
    }
    const avgQty = numMonths > 0 ? totalQty / numMonths : 0;
    const formattedAvg = hasAnyValue
      ? (avgQty % 1 === 0 ? avgQty.toString() : parseFloat(avgQty.toFixed(2)).toString())
      : "";

    onUpdateRow(idx, {
      monthlyQty: nextMonthly,
      qtyPerBulan: formattedAvg,
    });
  };

  const unitStr = satuanLabel(masterProduct);

  const formatHistoryValue = (value: number) => {
    if (!value) return "0";
    return value % 1 === 0
      ? value.toString()
      : (Math.round(value * 10) / 10).toString();
  };

  const periodLabel = b3RangeLabel || historyPeriodRange || "B3";

  const handleDelete = () => {
    const hasQty =
      (parseFloat(row.qtyPerBulan) || 0) > 0 ||
      (Array.isArray(row.monthlyQty) && row.monthlyQty.some((q: any) => (parseFloat(q) || 0) > 0));
    if (!row.kodeProduk && !hasQty) {
      onRemoveRow(idx);
    } else {
      setDeleteIndex(idx);
    }
  };

  // Render compact view when collapsed
  if (!isExpanded) {
    const selectedOption = productsOptions.find(
      (o: any) => (o.value || o.kodeProduk) === row.kodeProduk
    );
    const productName = selectedOption?.label || masterProduct?.namaProduk || row.kodeProduk || `Produk #${idx + 1}`;

    return (
      <div
        className="rounded-xl border p-3 shadow-2xs transition-all cursor-pointer hover:border-blue-400"
        style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}
        onClick={toggleExpand}
      >
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex-1 min-w-0">
            {/* Product Name (Enlarged, no number badge) */}
            <div className="text-sm font-bold truncate leading-snug" style={{ color: "var(--color-text)" }}>
              {productName}
            </div>

            {/* Qty, Sales, and Growth */}
            <div className="flex items-center gap-1.5 mt-1 text-xs flex-wrap">
              {totalQtySwitch > 0 ? (
                <>
                  <span className="font-semibold text-slate-700">
                    {totalQtySwitch}&nbsp;{unitStr}
                  </span>
                  <span className="text-slate-300">•</span>
                  <span className="font-bold whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                    Rp&nbsp;{formatRp(totalEstSalesRow)}
                  </span>
                  {growthSalesPct != null ? (
                    <span
                      className="font-bold text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap leading-tight"
                      style={{
                        color: growthSalesPct >= 0 ? "#16a34a" : "#dc2626",
                        background: growthSalesPct >= 0 ? "rgba(22, 163, 74, 0.1)" : "rgba(220, 38, 38, 0.1)",
                        border: growthSalesPct >= 0 ? "1px solid rgba(22, 163, 74, 0.2)" : "1px solid rgba(220, 38, 38, 0.2)",
                      }}
                    >
                      {growthSalesPct >= 0 ? "+" : ""}{growthSalesPct.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="font-semibold text-[10px] px-1.5 py-0.5 rounded text-emerald-700 bg-emerald-50 border border-emerald-200 whitespace-nowrap leading-tight">
                      Baru
                    </span>
                  )}
                </>
              ) : (
                <span className="italic text-slate-400 text-xs">
                  {row.kodeProduk ? "Belum ada estimasi switch" : "Ketuk untuk memilih produk"}
                </span>
              )}
            </div>

            {/* Incentive Info */}
            {totalNilaiScPeriode > 0 && (
              <div className="text-xs font-semibold text-blue-600 mt-0.5">
                Insentif: Rp&nbsp;{formatRp(totalNilaiScPeriode)}
              </div>
            )}

            {underTargetMonths.length > 0 && (
              <div className="text-[10px] text-red-600 font-semibold mt-1 flex items-center gap-1">
                <span>⚠</span>
                <span>Di bawah target ({underTargetMonths.length} bln)</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={toggleExpand}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-600 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 border border-slate-200 transition-colors cursor-pointer"
              title="Buka rincian produk"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={handleDelete}
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 shrink-0 transition-all cursor-pointer"
                title="Hapus produk"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border p-3.5 space-y-3 shadow-xs transition-shadow"
      style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}
    >
      {/* Top: Product Combobox directly + Collapse Toggle + Delete Button */}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <Combobox
            name={`product-mob-${idx}`}
            options={productsOptions.filter((option: any) => {
              const optionCode = option.value || option.kodeProduk;
              if (optionCode === row.kodeProduk) return true;
              return !rows.some((otherRow, otherIdx) => otherIdx !== idx && otherRow.kodeProduk === optionCode);
            })}
            value={row.kodeProduk}
            onChange={(val) => {
              const comps = getCompetitorsForRow(val);
              const compNames = comps.map((c) => c.namaKompetitor).join(", ");
              onUpdateRow(idx, {
                kodeProduk: val,
                ...(compNames ? { produkKompetitor: compNames } : {}),
              });
            }}
            disabled={readOnly}
            placeholder="Pilih produk..."
            emptyMessage="Tidak ada produk."
          />
        </div>
        <button
          type="button"
          onClick={toggleExpand}
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-600 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 shrink-0 transition-all cursor-pointer"
          title="Tutup rincian produk"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
        {!readOnly && (
          <button
            type="button"
            onClick={handleDelete}
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 shrink-0 transition-all cursor-pointer"
            title="Hapus produk"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>

      {/* Product Metadata Info (Clean light styling, NOT dark) */}
      {row.kodeProduk && (
        <div
          className="rounded-lg p-2.5 space-y-1.5 text-xs border"
          style={{
            background: "var(--color-bg-subtle, #fbfaf8)",
            borderColor: "var(--color-border, #e2e8f0)",
          }}
        >
          {masterProduct && (
            <div className="flex items-center justify-between flex-wrap gap-1">
              <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                {formatHnaLabel(masterProduct)}:
              </span>
              <strong className="font-semibold text-xs whitespace-nowrap shrink-0" style={{ color: "var(--color-text)" }}>
                Rp&nbsp;{formatRp(masterProduct.hna)}
              </strong>
            </div>
          )}
          {masterProduct?.zatAktif && (
            <div className="flex items-center justify-between text-[11px] gap-2">
              <span className="shrink-0" style={{ color: "var(--color-text-muted)" }}>Zat Aktif:</span>
              <span className="font-medium truncate max-w-[200px]" style={{ color: "var(--color-text)" }}>
                {masterProduct.zatAktif}
              </span>
            </div>
          )}
          <div
            className="flex items-center justify-between flex-wrap gap-1 text-[11px] pt-1.5 border-t border-dashed"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="flex items-center gap-1.5">
              <span style={{ color: "var(--color-text-muted)" }}>Diskon:</span>
              <strong style={{ color: "var(--color-text)" }}>
                {row.persenDiskon ? `${row.persenDiskon}%` : (diskonPeriode ? `${diskonPeriode}%` : "-")}
              </strong>
            </div>
            {(() => {
              const comps = getCompetitorsForRow(row.kodeProduk);
              const totalPotensi = comps.reduce((sum: number, c: any) => sum + c.salesForecast, 0);
              return (
                <div className="flex items-center gap-1.5">
                  <span style={{ color: "var(--color-text-muted)" }}>Potensi:</span>
                  <strong style={{ color: "var(--color-text)" }}>{totalPotensi}</strong>
                  {comps.length > 0 && (
                    <InfoTooltip
                      align="left"
                      width={260}
                      trigger={
                        <span
                          className="w-3.5 h-3.5 text-[9px] inline-flex items-center justify-center rounded-full font-bold border shrink-0 cursor-pointer"
                          style={{
                            borderColor: "var(--color-border)",
                            background: "var(--color-bg)",
                            color: "var(--color-text-muted)",
                          }}
                        >
                          i
                        </span>
                      }
                      content={
                        <div className="space-y-1.5 text-xs">
                          <div className="font-semibold text-white border-b border-slate-700/80 pb-1 flex justify-between">
                            <span>Rincian Produk Kompetitor</span>
                            <span className="text-slate-300 text-[10px]">Total: {totalPotensi}</span>
                          </div>
                          <div className="space-y-1 text-[11px] pt-0.5">
                            {comps.map((c: any, cIdx: number) => (
                              <div key={cIdx} className="flex justify-between items-center gap-3">
                                <span className="text-slate-300">{c.namaKompetitor}:</span>
                                <strong className="text-white font-semibold">{c.salesForecast}</strong>
                              </div>
                            ))}
                          </div>
                        </div>
                      }
                    />
                  )}
                </div>
              );
            })()}
          </div>

          {underTargetMonths.length > 0 && (
            <div
              className="text-[10px] leading-tight font-semibold px-2 py-1 rounded flex items-center gap-1"
              style={{
                color: "var(--color-red, #dc2626)",
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
              }}
            >
              <span>⚠</span>
              <span>Di bawah target: {underTargetMonths.join(", ")}</span>
            </div>
          )}
        </div>
      )}

      {/* Monthly Est. Switch Inputs */}
      <div className="space-y-2 pt-1 border-t" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>
              Estimasi Switch <Req />
            </span>
            <span className="text-[11px] font-medium" style={{ color: "var(--color-text-muted)" }}>
              ({unitStr})
            </span>
          </div>
          <span
            className="text-xs font-bold px-2 py-0.5 rounded"
            style={{
              border: "1px solid var(--color-blue-light, #c8e1f5)",
              background: "var(--color-blue-light, #E6F0F8)",
              color: "var(--color-blue)",
            }}
          >
            Total: {totalQtySwitch} {unitStr}
          </span>
        </div>

        {/* Merged Monthly Box with | divider and clear input box affordance */}
        <div
          className="rounded-xl border overflow-hidden shadow-2xs"
          style={{ borderColor: "var(--color-border-strong, #B8AF9E)", background: "var(--color-bg)" }}
        >
          {/* Header row with month names separated by | */}
          <div
            className={`grid ${numMonths <= 2 ? "grid-cols-2" : "grid-cols-3"} divide-x text-center border-b`}
            style={{
              borderColor: "var(--color-border-strong, #B8AF9E)",
              background: "var(--color-bg-subtle)",
            }}
          >
            {Array.from({ length: numMonths }, (_, mIdx) => (
              <div
                key={mIdx}
                className="py-1 text-[11px] font-semibold select-none"
                style={{ color: "var(--color-text-muted)" }}
              >
                {monthLabels[mIdx]}
              </div>
            ))}
          </div>

          {/* Input row separated by | with clear input affordance */}
          <div
            className={`grid ${numMonths <= 2 ? "grid-cols-2" : "grid-cols-3"} divide-x text-center`}
            style={{
              borderColor: "var(--color-border-strong, #B8AF9E)",
              background: "var(--color-bg-subtle)",
            }}
          >
            {Array.from({ length: numMonths }, (_, mIdx) => (
              <div key={mIdx} className="p-1.5 flex items-center justify-center">
                <input
                  type="text"
                  inputMode="numeric"
                  value={currentMonthly[mIdx] ?? ""}
                  onChange={(e) => handleMonthChange(mIdx, e.target.value)}
                  placeholder="0"
                  disabled={readOnly}
                  className="w-full text-center py-1.5 px-1 text-sm font-bold rounded-md border shadow-2xs outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
                  style={{
                    background: "var(--color-bg)",
                    borderColor: "var(--color-border-strong, #cbd5e1)",
                    color: "var(--color-text)",
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Avg History & Sales with (i) Tooltip */}
        {row.kodeProduk && (
          <div className="text-[11px] flex items-center justify-between pt-0.5 px-0.5" style={{ color: "var(--color-text-muted)" }}>
            <InfoTooltip
              align="left"
              trigger={
                <span className="inline-flex items-center gap-1 hover:underline font-medium text-[11px] cursor-pointer leading-tight">
                  <span>Avg History ({periodLabel}):</span>
                  <span
                    className="w-3.5 h-3.5 text-[9px] inline-flex items-center justify-center rounded-full font-bold border shrink-0"
                    style={{
                      borderColor: "var(--color-border)",
                      background: "var(--color-bg)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    i
                  </span>
                </span>
              }
              content={
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between items-center gap-3 border-b border-slate-700/80 pb-1">
                    <span className="font-semibold text-white">Avg. History & Sales</span>
                    <span className="text-slate-300 text-[10px]">({periodLabel})</span>
                  </div>
                  <div className="flex justify-between items-center gap-3 pt-0.5">
                    <span className="text-slate-300">Avg. History ({periodLabel}):</span>
                    <strong className="text-white font-semibold">
                      {formatHistoryValue(historyDisplayVal)} {unitStr}
                    </strong>
                  </div>
                  <div className="flex justify-between items-center gap-3">
                    <span className="text-slate-300">Sales {b1Label}:</span>
                    <strong className="text-white font-semibold">
                      {formatHistoryValue(b1)} {unitStr}
                    </strong>
                  </div>
                  <div className="flex justify-between items-center gap-3">
                    <span className="text-slate-300">Sales {b2Label}:</span>
                    <strong className="text-white font-semibold">
                      {formatHistoryValue(b2)} {unitStr}
                    </strong>
                  </div>
                  <div className="flex justify-between items-center gap-3">
                    <span className="text-slate-300">Sales {b3Label}:</span>
                    <strong className="text-white font-semibold">
                      {formatHistoryValue(b3)} {unitStr}
                    </strong>
                  </div>
                </div>
              }
            />
            <span className="font-semibold text-xs" style={{ color: "var(--color-text)" }}>
              {formatHistoryValue(historyDisplayVal)} {unitStr}
            </span>
          </div>
        )}
      </div>

      {/* Financial Summary Table (Clean table layout, NO horizontal scroll, full numbers without truncation) */}
      <div
        className="rounded-lg border overflow-hidden shadow-2xs"
        style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
      >
        <table className="w-full text-xs border-collapse">
          <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
            {/* Est Sales Row */}
            <tr className="hover:bg-[var(--color-bg-subtle)] transition-colors">
              <td className="py-2.5 px-3">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-xs whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
                    Est. Sales
                  </span>
                  {row.kodeProduk && (
                    <InfoTooltip
                      align="left"
                      width={280}
                      trigger={
                        <span
                          className="w-3.5 h-3.5 text-[9px] inline-flex items-center justify-center rounded-full font-bold border shrink-0 cursor-pointer"
                          style={{
                            borderColor: "var(--color-border)",
                            background: "var(--color-bg)",
                            color: "var(--color-text-muted)",
                          }}
                        >
                          i
                        </span>
                      }
                      content={
                        <div className="space-y-2 text-xs">
                          <div className="font-semibold text-white border-b border-slate-700/80 pb-1 flex items-center justify-between gap-2">
                            <span>Rincian Estimasi Sales</span>
                            <span className="text-slate-300 text-[10px]">({numMonths} Bulan)</span>
                          </div>
                          <div className="space-y-1 text-[11px]">
                            <div className="flex justify-between items-center gap-3">
                              <span className="text-slate-300">Total Periode:</span>
                              <strong className="text-white font-semibold whitespace-nowrap">
                                Rp&nbsp;{formatRp(totalEstSalesRow)}
                              </strong>
                            </div>
                            <div className="flex justify-between items-center gap-3">
                              <span className="text-slate-300">Rata-rata / Bulan:</span>
                              <strong className="text-white font-semibold whitespace-nowrap">
                                Rp&nbsp;{formatRp(numMonths > 0 ? totalEstSalesRow / numMonths : 0)}
                              </strong>
                            </div>
                            <div className="flex justify-between items-center gap-3">
                              <span className="text-slate-300">Sales Sebelumnya:</span>
                              <strong className="text-white font-semibold whitespace-nowrap">
                                {avgSalesBln > 0 ? `Rp\u00A0${formatRp(Math.round(avgSalesBln))}` : "-"}
                              </strong>
                            </div>
                            {growthSalesPct != null && (
                              <div className="flex justify-between items-center gap-3">
                                <span className="text-slate-300">Total Growth vs Historis:</span>
                                <strong
                                  className="font-semibold whitespace-nowrap"
                                  style={{ color: growthSalesPct >= 0 ? "#4ade80" : "#f87171" }}
                                >
                                  {growthSalesPct >= 0 ? "+" : ""}{growthSalesPct.toFixed(1)}%
                                </strong>
                              </div>
                            )}
                          </div>
                          <div className="pt-1.5 border-t border-slate-700/80 space-y-1">
                            <div className="text-[10px] font-semibold text-slate-300 uppercase tracking-wider">
                              Growth per Bulan:
                            </div>
                            <div className="space-y-1 text-[11px]">
                              {Array.from({ length: numMonths }, (_, mIdx) => {
                                const mQty = parseFloat(currentMonthly[mIdx]) || 0;
                                const mSales = monthlyEstSales[mIdx];
                                const mGrowth = avgSalesBln > 0 ? ((mSales - avgSalesBln) / avgSalesBln) * 100 : null;
                                return (
                                  <div key={mIdx} className="flex items-center justify-between gap-2 bg-slate-800/70 px-2 py-1 rounded border border-slate-700/40">
                                    <div className="flex items-center gap-1.5">
                                      <span className="w-7 font-semibold text-slate-200">{monthLabels[mIdx]}</span>
                                      <span className="text-white font-medium whitespace-nowrap">Rp&nbsp;{formatRp(mSales)}</span>
                                    </div>
                                    <div className="text-right whitespace-nowrap">
                                      {mGrowth != null ? (
                                        <span
                                          className="font-bold text-[10px] px-1 py-0.5 rounded"
                                          style={{
                                            color: mGrowth >= 0 ? "#4ade80" : "#f87171",
                                            background: mGrowth >= 0 ? "rgba(74, 222, 128, 0.12)" : "rgba(248, 113, 113, 0.12)",
                                          }}
                                        >
                                          {mGrowth >= 0 ? "+" : ""}{mGrowth.toFixed(1)}%
                                        </span>
                                      ) : (
                                        <span className="text-[9px] text-emerald-400 font-semibold px-1 py-0.5 rounded bg-emerald-950/40">
                                          Baru
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      }
                    />
                  )}
                </div>
                <div className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                  Total Periode ({numMonths} Bulan)
                </div>
              </td>
              <td className="py-2.5 px-3 text-right whitespace-nowrap shrink-0">
                <div className="font-bold text-sm whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                  Rp&nbsp;{formatRp(totalEstSalesRow)}
                </div>
                {numMonths > 1 && (
                  <div className="text-[10px] whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
                    Rp&nbsp;{formatRp(Math.round(totalEstSalesRow / numMonths))}/bln
                  </div>
                )}
              </td>
            </tr>

            {/* Est Insentif Row */}
            <tr className="hover:bg-[var(--color-bg-subtle)] transition-colors" style={{ background: "rgba(59, 130, 246, 0.03)" }}>
              <td className="py-2.5 px-3">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold text-xs whitespace-nowrap" style={{ color: "var(--color-blue)" }}>
                    Est. Insentif
                  </span>
                  {row.kodeProduk && (
                    <InfoTooltip
                      align="left"
                      width={280}
                      trigger={
                        <span
                          className="w-3.5 h-3.5 text-[9px] inline-flex items-center justify-center rounded-full font-bold border shrink-0 cursor-pointer"
                          style={{
                            borderColor: "rgba(59, 130, 246, 0.4)",
                            background: "var(--color-bg)",
                            color: "var(--color-blue)",
                          }}
                        >
                          i
                        </span>
                      }
                      content={
                        <div className="space-y-2 text-xs">
                          <div className="font-semibold text-white border-b border-slate-700/80 pb-1 flex items-center justify-between gap-2">
                            <span>Rincian Estimasi Insentif</span>
                            <span className="text-slate-300 text-[10px]">({numMonths} Bulan)</span>
                          </div>
                          <div className="space-y-1 text-[11px]">
                            <div className="flex justify-between items-center gap-3">
                              <span className="text-slate-300">Total Periode:</span>
                              <strong className="text-white font-semibold whitespace-nowrap">
                                Rp&nbsp;{formatRp(totalNilaiScPeriode)}
                              </strong>
                            </div>
                            <div className="flex justify-between items-center gap-3 text-slate-400 text-[10px]">
                              <span>Skema:</span>
                              <span className="whitespace-nowrap font-mono">
                                {scVal != null && scVal > 0 ? `Rp ${formatRp(scVal)} / UB (Min ${scMin})` : `${pctMatriks}% Matriks`}
                              </span>
                            </div>
                            <div className="flex justify-between items-center gap-3">
                              <span className="text-slate-300">Rata-rata / Bulan:</span>
                              <strong className="text-white font-semibold whitespace-nowrap">
                                Rp&nbsp;{formatRp(avgNilaiScBln)}
                              </strong>
                            </div>
                            <div className="flex justify-between items-center gap-3">
                              <span className="text-slate-300">Historis Insentif:</span>
                              <strong className="text-white font-semibold whitespace-nowrap">
                                {historyIncentiveVal > 0 ? `Rp\u00A0${formatRp(historyIncentiveVal)}` : "-"}
                              </strong>
                            </div>
                            {overallIncentiveGrowthPct != null && (
                              <div className="flex justify-between items-center gap-3">
                                <span className="text-slate-300">Total Growth vs Historis:</span>
                                <strong
                                  className="font-semibold whitespace-nowrap"
                                  style={{ color: overallIncentiveGrowthPct >= 0 ? "#4ade80" : "#f87171" }}
                                >
                                  {overallIncentiveGrowthPct >= 0 ? "+" : ""}{overallIncentiveGrowthPct.toFixed(1)}%
                                </strong>
                              </div>
                            )}
                          </div>
                        </div>
                      }
                    />
                  )}
                  <span
                    className="text-[10px] px-1.5 py-0.2 rounded font-mono whitespace-nowrap"
                    style={{
                      background: "rgba(59, 130, 246, 0.08)",
                      border: "1px solid rgba(59, 130, 246, 0.25)",
                      color: "var(--color-blue)",
                    }}
                  >
                    {scVal != null && scVal > 0 ? `Rp ${formatRp(scVal)}/UB` : `${pctMatriks}% Matriks`}
                  </span>
                </div>
                <div className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                  Total Periode ({numMonths} Bulan)
                </div>
              </td>
              <td className="py-2.5 px-3 text-right whitespace-nowrap shrink-0">
                <div className="font-bold text-sm whitespace-nowrap" style={{ color: "var(--color-blue)" }}>
                  Rp&nbsp;{formatRp(totalNilaiScPeriode)}
                </div>
                {numMonths > 1 && (
                  <div className="text-[10px] whitespace-nowrap" style={{ color: "var(--color-blue)", opacity: 0.85 }}>
                    Rp&nbsp;{formatRp(Math.round(avgNilaiScBln))}/bln
                  </div>
                )}
              </td>
            </tr>

            {/* Est Cashback Row */}
            <tr className="hover:bg-[var(--color-bg-subtle)] transition-colors" style={{ background: "rgba(34, 197, 94, 0.03)" }}>
              <td className="py-2.5 px-3">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-xs whitespace-nowrap" style={{ color: "var(--color-green)" }}>
                    Est. Cashback
                  </span>
                  <InfoTooltip
                    align="left"
                    trigger={
                      <span
                        className="w-3.5 h-3.5 text-[9px] inline-flex items-center justify-center rounded-full font-bold border shrink-0 cursor-pointer"
                        style={{
                          borderColor: "rgba(34, 197, 94, 0.4)",
                          background: "var(--color-bg)",
                          color: "var(--color-green)",
                        }}
                      >
                        i
                      </span>
                    }
                    text="Nilai Cashback akan diterima oleh outlet jika belanja lewat Pharmanet"
                  />
                </div>
                <div className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                  {isCashbackNotFound ? "Tidak ada promosi cashback" : `Total Periode (${numMonths} Bulan)`}
                </div>
              </td>
              <td className="py-2.5 px-3 text-right whitespace-nowrap shrink-0">
                <div className="font-bold text-sm whitespace-nowrap" style={{ color: isCashbackNotFound ? "var(--color-text-muted)" : "var(--color-green)" }}>
                  {isCashbackNotFound ? "-" : `Rp\u00A0${formatRp(totalCashbackPeriode)}`}
                </div>
                {!isCashbackNotFound && numMonths > 1 && (
                  <div className="text-[10px] whitespace-nowrap" style={{ color: "var(--color-green)", opacity: 0.85 }}>
                    Rp&nbsp;{formatRp(Math.round(totalCashbackPeriode / numMonths))}/bln
                  </div>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export interface ProductMobileGrandTotalProps {
  rowCount: number;
  grandTotalEstSalesPeriode: number;
  grandTotalNilaiScPeriode: number;
  totalFinalCashback: number;
  isCashbackNotFound: boolean;
  numMonths: number;
}

export function ProductMobileGrandTotal({
  rowCount,
  grandTotalEstSalesPeriode,
  grandTotalNilaiScPeriode,
  totalFinalCashback,
  isCashbackNotFound,
  numMonths,
}: ProductMobileGrandTotalProps) {
  return (
    <div
      className="rounded-xl border overflow-hidden shadow-xs"
      style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}
    >
      <div
        className="px-3 py-2 border-b font-semibold text-xs flex items-center justify-between"
        style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)", color: "var(--color-text)" }}
      >
        <span>Ringkasan Total</span>
        <span className="text-[11px] font-normal" style={{ color: "var(--color-text-muted)" }}>
          {rowCount} Produk ({numMonths} Bulan)
        </span>
      </div>

      <table className="w-full text-xs border-collapse">
        <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
          <tr className="hover:bg-[var(--color-bg-subtle)] transition-colors">
            <td className="py-2.5 px-3 font-medium" style={{ color: "var(--color-text-muted)" }}>
              Total Estimasi Sales
            </td>
            <td className="py-2.5 px-3 text-right font-bold text-sm whitespace-nowrap shrink-0" style={{ color: "var(--color-text)" }}>
              Rp&nbsp;{formatRp(grandTotalEstSalesPeriode)}
            </td>
          </tr>
          <tr className="hover:bg-[var(--color-bg-subtle)] transition-colors" style={{ background: "rgba(59, 130, 246, 0.03)" }}>
            <td className="py-2.5 px-3 font-medium" style={{ color: "var(--color-blue)" }}>
              Total Estimasi Insentif
            </td>
            <td className="py-2.5 px-3 text-right font-bold text-sm whitespace-nowrap shrink-0" style={{ color: "var(--color-blue)" }}>
              Rp&nbsp;{formatRp(grandTotalNilaiScPeriode)}
            </td>
          </tr>
          <tr className="hover:bg-[var(--color-bg-subtle)] transition-colors" style={{ background: "rgba(34, 197, 94, 0.03)" }}>
            <td className="py-2.5 px-3 font-medium" style={{ color: "var(--color-green)" }}>
              Total Estimasi Cashback
            </td>
            <td className="py-2.5 px-3 text-right font-bold text-sm whitespace-nowrap shrink-0" style={{ color: isCashbackNotFound ? "var(--color-text-muted)" : "var(--color-green)" }}>
              {isCashbackNotFound ? "-" : `Rp\u00A0${formatRp(totalFinalCashback)}`}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export interface ProductMobileToolbarProps {
  totalProducts: number;
  allExpanded: boolean;
  onToggleAll: () => void;
}

export function ProductMobileToolbar({
  totalProducts,
  allExpanded,
  onToggleAll,
}: ProductMobileToolbarProps) {
  if (totalProducts <= 1) return null;
  return (
    <div className="flex items-center justify-between px-1 text-xs">
      <span className="font-semibold text-[11px]" style={{ color: "var(--color-text-muted)" }}>
        Daftar Produk ({totalProducts})
      </span>
      <button
        type="button"
        onClick={onToggleAll}
        className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer transition-colors"
      >
        <span>{allExpanded ? "Tutup Semua" : "Buka Semua"}</span>
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          {allExpanded ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          )}
        </svg>
      </button>
    </div>
  );
}

