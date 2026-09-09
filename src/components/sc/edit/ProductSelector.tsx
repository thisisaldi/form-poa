"use client";

import { useState, useEffect } from "react";
import type { ProductSelectorProps } from "./types/editorProps";
import { Req, InfoTooltip } from "./ui";
import { formatRpNumber as formatRp } from "./utils/formatEditUtils";
import { satuanLabel, formatHnaLabel } from "./utils/productMatcherUtils";
import { Combobox } from "@/components/ui/Combobox";
import { UnitInput } from "./UnitInput";
import { getHistorySalesAction, getLossSalesAnalysisAction, getRecommendedProCodesAction } from "@/app/actions/canvasser";
import { aggregateHistorySales } from "@/lib/historySalesUtils";
import { calculateCashbackDetails } from "./hooks/useSalesCounterCashback";

export { InfoTooltip };

export function ProductSelector({
  rows,
  onAddRow,
  onRemoveRow,
  onUpdateRow,
  productsOptions,
  canvasserProducts,
  masterProducts,
  lamaPeriode,
  periodeAwal,
  diskonPeriode,
  cashbackData,
  hideCashback = false,
  isLoading = false,
  error,
  readOnly = false,
  b3SalesMap,
  b3RangeLabel,
  kodePI,
}: ProductSelectorProps) {
  const [lossSalesItems, setLossSalesItems] = useState<any[]>([]);
  const [historySalesMap, setHistorySalesMap] = useState<
    Map<string, {
      history_sales: number;
      sales_b1: number;
      sales_b2: number;
      sales_b3: number;
    }>
  >(new Map());

  const [historyPeriodRange, setHistoryPeriodRange] = useState<string>("");
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!kodePI) {
      setHistorySalesMap(new Map());
      setHistoryPeriodRange("");
      return;
    }
    getHistorySalesAction(kodePI, false).then((res) => {
      const hMap = new Map<string, {
        history_sales: number;
        sales_b1: number;
        sales_b2: number;
        sales_b3: number;
      }>();

      if (res?.data && Array.isArray(res.data)) {
        const aggMap = aggregateHistorySales(res);
        for (const [code, item] of aggMap.entries()) {
          hMap.set(code, {
            history_sales: item.avgQty,
            sales_b1: item.sales_b1,
            sales_b2: item.sales_b2,
            sales_b3: item.sales_b3,
          });
        }
      }

      setHistorySalesMap(hMap);


      if (Array.isArray(res?.period) && res.period.length > 0) {
        const periods = [...res.period].filter(Boolean).sort();
        const minP = periods[0];
        const maxP = periods[periods.length - 1];
        setHistoryPeriodRange(`${minP}-${maxP}`);
      } else {
        setHistoryPeriodRange("");
      }
    });
  }, [kodePI]);


  useEffect(() => {
    if (!kodePI || !periodeAwal) {
      setLossSalesItems([]);
      return;
    }
    const cleanPeriod = periodeAwal.replace(/[^0-9]/g, "");
    const periodInt = parseInt(cleanPeriod.slice(0, 6), 10);
    if (!periodInt || isNaN(periodInt)) {
      setLossSalesItems([]);
      return;
    }

    let isMounted = true;
    const selectedSourceCodes = rows.map((r) => r.kodeProduk).filter(Boolean);

    if (selectedSourceCodes.length === 0) {
      setLossSalesItems([]);
      return;
    }

    const availableOptionCodes = new Set([
      ...(productsOptions || []).map((p: any) => p.value || p.kodeProduk),
      ...(canvasserProducts || []).map((p: any) => p.pro_code),
    ].filter(Boolean));

    getRecommendedProCodesAction(selectedSourceCodes)
      .then((recommendedCodes: string[]) => {
        if (!isMounted) return null;

        const validCodes: string[] = availableOptionCodes.size > 0
          ? recommendedCodes.filter((code: string) => availableOptionCodes.has(code))
          : recommendedCodes;

        if (validCodes.length === 0) {
          if (isMounted) setLossSalesItems([]);
          return null;
        }

        return getLossSalesAnalysisAction(periodInt, kodePI, validCodes);
      })
      .then((res) => {
        if (!isMounted) return;
        if (res && res.status && Array.isArray(res.data)) {
          const filtered = res.data.filter(
            (item: any) =>
              ((item.qty != null && Number(item.qty) > 0) ||
                (item.total_sales != null && Number(item.total_sales) > 0)) &&
              (availableOptionCodes.size === 0 || availableOptionCodes.has(item.code))
          );
          setLossSalesItems(filtered);
        } else {
          setLossSalesItems([]);
        }
      })
      .catch(() => {
        if (isMounted) setLossSalesItems([]);
      });

    return () => {
      isMounted = false;
    };
  }, [kodePI, periodeAwal, JSON.stringify(rows.map((r) => r.kodeProduk)), productsOptions, masterProducts]);

  const isCashbackNotFound =
    hideCashback ||
    !cashbackData ||
    cashbackData?.message === "Gudang Tidak Ditemukan" ||
    (typeof cashbackData?.message === "string" &&
      (cashbackData.message.toLowerCase().includes("tidak ditemukan") ||
        cashbackData.message.toLowerCase().includes("gudang"))) ||
    (typeof cashbackData?.data?.message === "string" &&
      (cashbackData.data.message.toLowerCase().includes("tidak ditemukan") ||
        cashbackData.data.message.toLowerCase().includes("gudang"))) ||
    cashbackData?.status === false ||
    cashbackData?.success === false;

  const toggleRowDetail = (idx: number) => {
    setExpandedRows((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  // Calculate grand totals for table footer
  let grandTotalQtyUb = 0;
  let grandTotalEstSalesBln = 0;
  let grandTotalNilaiScBln = 0;

  rows.forEach((row) => {
    const masterProduct = masterProducts.find((p) => p.kodeProduk === row.kodeProduk);
    const canvasserProduct = canvasserProducts.find(
      (p) =>
        p.pro_code === row.kodeProduk ||
        p.pro_code?.replace(/^0+/, "") === row.kodeProduk?.replace(/^0+/, "")
    );
    const hnaSJ = masterProduct ? (parseFloat(masterProduct.hna) || 0) : 0;
    const qtyUb = parseFloat(row.qtyPerBulan) || 0;
    const estSalesBln = qtyUb * hnaSJ;
    const pctMatriks = parseFloat(row.persenMatriksSc) || 0;
    const scVal = canvasserProduct?.sales_counter_value;
    const scMin = canvasserProduct?.sales_counter_minimum || 0;

    let nilaiScBln = 0;
    if (scVal != null && scVal > 0) {
      nilaiScBln = qtyUb >= scMin ? qtyUb * scVal : 0;
    } else {
      nilaiScBln = estSalesBln * (pctMatriks / 100);
    }

    grandTotalQtyUb += qtyUb;
    grandTotalEstSalesBln += estSalesBln;
    grandTotalNilaiScBln += nilaiScBln;
  });

  const cashbackDetails = calculateCashbackDetails({
    cashbackData,
    selectedProducts: rows,
    masterProducts,
    lamaPeriode,
  });

  const colProdukWidth = !readOnly ? "w-[21%] min-w-[170px]" : "w-[24%] min-w-[185px]";
  const colPotensiWidth = "w-[6%] min-w-[55px]";
  const colSwitchWidth = "w-[12%] min-w-[105px]";
  const colDiskonWidth = "w-[5%] min-w-[45px]";
  const colEstSalesWidth = "w-[15%] min-w-[120px]";
  const colNilaiScWidth = "w-[15%] min-w-[120px]";
  const colCashbackWidth = "w-[13%] min-w-[115px]";
  const colActionWidth = "w-[5%] min-w-[40px]";
  const tableMinWidth = "min-w-[770px]";

  return (
    <div className="space-y-4">
      {error && <p className="text-xs font-semibold" style={{ color: "var(--color-red)" }}>{error}</p>}

      {isCashbackNotFound && (
        <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
          <svg className="w-4 h-4 shrink-0" style={{ color: "var(--color-text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Outlet Ini Tidak Berpartisipasi Dalam Promosi Cashback</span>
        </div>
      )}

      {/* Mobile Scroll Hint */}
      <div className="flex items-center justify-between text-[11px] sm:hidden px-1" style={{ color: "var(--color-text-muted)" }}>
        <span className="inline-flex items-center gap-1">
          <span>↔</span> Geser tabel ke samping untuk melihat semua kolom
        </span>
      </div>

      {/* Main Product Table Container */}
      <div className="rounded-lg border shadow-xs overflow-hidden" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
        <div className="overflow-x-auto w-full">
          <table className={`w-full text-left text-xs border-collapse table-fixed ${tableMinWidth}`}>
            <thead>
              <tr style={{ background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
                <th className={`py-2 pl-3 pr-2 font-semibold text-[11px] text-left ${colProdukWidth}`} style={{ color: "var(--color-text-muted)" }}>
                  Produk <Req />
                </th>
                <th className={`py-2 px-1 font-semibold text-[11px] text-center ${colPotensiWidth}`} style={{ color: "var(--color-text-muted)" }}>
                  <div className="leading-tight">
                    <div>Potensi</div>
                    <div className="text-[9px] font-normal opacity-75">/ Bln</div>
                  </div>
                </th>
                <th className={`py-2 px-1 font-semibold text-[11px] text-center ${colSwitchWidth}`} style={{ color: "var(--color-text-muted)" }}>
                  <div className="leading-tight">
                    <div>Est. Switch<Req /></div>
                    <div className="text-[9px] font-normal opacity-75">/ Bln</div>
                  </div>
                </th>
                <th className={`py-2 px-1 font-semibold text-[11px] text-center ${colDiskonWidth}`} style={{ color: "var(--color-text-muted)" }}>
                  <div className="leading-tight">
                    <div>Diskon</div>
                    {diskonPeriode && (
                      <div className="text-[9px] font-normal opacity-75">
                        ({diskonPeriode})
                      </div>
                    )}
                  </div>
                </th>
                <th className={`py-2 px-1.5 font-semibold text-[11px] text-center ${colEstSalesWidth}`} style={{ color: "var(--color-text-muted)" }}>
                  <div className="leading-tight">
                    <div>Est. Sales</div>
                    <div className="text-[9px] font-normal opacity-75">/ Bln</div>
                  </div>
                </th>
                <th className={`py-2 px-1.5 font-semibold text-[11px] text-center ${colNilaiScWidth}`} style={{ color: "var(--color-text-muted)" }}>
                  <div className="leading-tight">
                    <div>Est. Insentif</div>
                    <div className="text-[9px] font-normal opacity-75">SC / Bln</div>
                  </div>
                </th>
                <th className={`py-2 px-1.5 font-semibold text-[11px] text-center ${colCashbackWidth}`} style={{ color: "var(--color-text-muted)" }}>
                  <div className="inline-flex items-center justify-center gap-1">
                    <div className="leading-tight text-center">
                      <div>Est. Cashback</div>
                      <div className="text-[9px] font-normal opacity-75">/ Bln</div>
                    </div>
                    <InfoTooltip text="Nilai Cashback akan diterima oleh outlet jika belanja lewat Pharmanet" />
                  </div>
                </th>
                {!readOnly && (
                  <th className={`py-2 px-1 text-center font-semibold text-[11px] ${colActionWidth}`} style={{ color: "var(--color-text-muted)" }}>
                    Aksi
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, sIdx) => (
                  <tr key={`skeleton-${sIdx}`} className="animate-pulse">
                    <td className="py-3 pl-4 pr-2.5">
                      <div className="h-7 bg-slate-200 dark:bg-slate-700/50 rounded w-full mb-1.5" />
                      <div className="h-3 bg-slate-200 dark:bg-slate-700/50 rounded w-2/3" />
                    </td>
                    <td className="py-3 px-1 text-center">
                      <div className="h-6 bg-slate-200 dark:bg-slate-700/50 rounded w-full" />
                    </td>
                    <td className="py-3 px-1 text-center">
                      <div className="h-6 bg-slate-200 dark:bg-slate-700/50 rounded w-full" />
                    </td>
                    <td className="py-3 px-1 text-center">
                      <div className="h-5 bg-slate-200 dark:bg-slate-700/50 rounded w-3/4 mx-auto" />
                    </td>
                    <td className="py-3 px-1.5 text-center">
                      <div className="h-5 bg-slate-200 dark:bg-slate-700/50 rounded w-4/5 mx-auto mb-1" />
                      <div className="h-3 bg-slate-200 dark:bg-slate-700/50 rounded w-1/2 mx-auto" />
                    </td>
                    <td className="py-3 px-1.5 text-center">
                      <div className="h-5 bg-slate-200 dark:bg-slate-700/50 rounded w-4/5 mx-auto mb-1" />
                      <div className="h-3 bg-slate-200 dark:bg-slate-700/50 rounded w-3/5 mx-auto" />
                    </td>
                    <td className="py-3 px-1.5 text-center">
                      <div className="h-5 bg-slate-200 dark:bg-slate-700/50 rounded w-3/4 mx-auto" />
                    </td>
                    {!readOnly && (
                      <td className="py-3 px-2 text-center">
                        <div className="h-6 w-6 bg-slate-200 dark:bg-slate-700/50 rounded mx-auto" />
                      </td>
                    )}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={readOnly ? 7 : 8} className="py-6 text-center text-xs" style={{ color: "var(--color-text-faint)" }}>
                    Belum ada produk yang ditambahkan. Klik tombol <strong>+ Tambah Produk</strong> di bawah untuk memilih produk.
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => {
                  const masterProduct = masterProducts.find((p) => p.kodeProduk === row.kodeProduk);
                  const canvasserProduct = canvasserProducts.find(
                    (p) =>
                      p.pro_code === row.kodeProduk ||
                      p.pro_code?.replace(/^0+/, "") === row.kodeProduk?.replace(/^0+/, "")
                  );

                  const hnaSJ = masterProduct ? (parseFloat(masterProduct.hna) || 0) : 0;
                  const qtyUb = parseFloat(row.qtyPerBulan) || 0;
                  const estSalesBln = qtyUb * hnaSJ;
                  const pctMatriks = parseFloat(row.persenMatriksSc) || 0;

                  const scVal = canvasserProduct?.sales_counter_value;
                  const scMin = canvasserProduct?.sales_counter_minimum != null ? Number(canvasserProduct.sales_counter_minimum) : 0;
                  const targetSellInBln = scMin * hnaSJ;

                  let nilaiScBln = 0;
                  if (scVal != null && scVal > 0) {
                    nilaiScBln = qtyUb >= scMin ? qtyUb * scVal : 0;
                  } else {
                    nilaiScBln = estSalesBln * (pctMatriks / 100);
                  }

                  return (
                    <tr key={idx} id={row.kodeProduk ? `sc-product-row-${row.kodeProduk}` : `sc-product-row-index-${idx}`} className="align-top hover:bg-slate-50/50 transition-colors">
                      {/* Column 1: Product Selection & Competitor */}
                      <td className="py-2.5 pl-4 pr-2.5 space-y-2">
                        <Combobox
                          name={`product-${idx}`}
                          options={productsOptions.filter((option: any) => {
                            const optionCode = option.value || option.kodeProduk;
                            if (optionCode === row.kodeProduk) {
                              return true;
                            }
                            return !rows.some(
                              (otherRow, otherIdx) =>
                                otherIdx !== idx &&
                                otherRow.kodeProduk === optionCode
                            );
                          })}
                          value={row.kodeProduk}
                          onChange={(val) => {
                            onUpdateRow(idx, {
                              kodeProduk: val,
                            });
                          }}
                          disabled={readOnly}
                          placeholder="Cari produk..."
                          emptyMessage="Tidak ada produk."
                        />
                        {masterProduct && (
                          <div className="text-[11px] leading-tight space-y-0.5" style={{ color: "var(--color-text-faint)" }}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span>{formatHnaLabel(masterProduct)}: <strong style={{ color: "var(--color-text-muted)" }}>Rp {formatRp(masterProduct.hna)}</strong></span>
                            </div>
                            {masterProduct.zatAktif && (
                              <div className="truncate text-[10px]" style={{ color: "var(--color-text-faint)" }}>
                                Zat: {masterProduct.zatAktif}
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Column 2: Potensi / UB */}
                      <td className="py-2 px-1 text-center align-top">
                        <div className="font-semibold text-[11px]" style={{ color: "var(--color-text)" }}>
                          0
                        </div>
                        <div className="text-[10px] space-y-0.5 mt-1 text-center" style={{ color: "var(--color-text-faint)" }}>
                          <div>produk A: <strong style={{ color: "var(--color-text-muted)" }}>0</strong></div>
                          <div>produk B: <strong style={{ color: "var(--color-text-muted)" }}>0</strong></div>
                          <div>produk C: <strong style={{ color: "var(--color-text-muted)" }}>0</strong></div>
                          <div>lainnya : <strong style={{ color: "var(--color-text-muted)" }}>0</strong></div>
                        </div>
                      </td>

                      {/* Column 3: Quantity Input (Estimasi Switching / UB) */}
                      <td className="py-2 px-1 text-center align-top">
                        <UnitInput
                          value={row.qtyPerBulan}
                          onChange={(val) => onUpdateRow(idx, { qtyPerBulan: val })}
                          unit={satuanLabel(masterProduct)}
                          placeholder="0"
                          disabled={readOnly}
                        />
                        {(() => {
                          const historyData = historySalesMap.get(row.kodeProduk);
                          const formatHistoryValue = (value: number) => {
                            if (!value) return "0";
                            return value % 1 === 0
                              ? value.toString()
                              : (Math.round(value * 10) / 10).toString();
                          };

                          const labelPrefix = historyPeriodRange
                            ? `Average History Per Bulan (${historyPeriodRange}) :`
                            : "Average History Per Bulan :";

                          return (
                            <div
                              className="text-[10px] leading-tight mt-1 space-y-0.5"
                              style={{ color: "var(--color-text-faint)" }}
                            >
                              <div>
                                {labelPrefix}{" "}
                                <strong style={{ color: "var(--color-text-muted)" }}>
                                  {formatHistoryValue(historyData?.history_sales ?? 0)}
                                </strong>
                              </div>

                              <div>
                                Sales B1:{" "}
                                <strong style={{ color: "var(--color-text-muted)" }}>
                                  {formatHistoryValue(historyData?.sales_b1 ?? 0)}
                                </strong>
                              </div>

                              <div>
                                Sales B2:{" "}
                                <strong style={{ color: "var(--color-text-muted)" }}>
                                  {formatHistoryValue(historyData?.sales_b2 ?? 0)}
                                </strong>
                              </div>

                              <div>
                                Sales B3:{" "}
                                <strong style={{ color: "var(--color-text-muted)" }}>
                                  {formatHistoryValue(historyData?.sales_b3 ?? 0)}
                                </strong>
                              </div>
                            </div>
                          );

                        })()}
                      </td>

                      {/* Column 4: Diskon */}
                      <td className="py-2 px-1 text-center align-top">
                        <div className="font-semibold text-[11px] py-1" style={{ color: "var(--color-text-muted)" }}>
                          {row.persenDiskon || 0}%
                        </div>
                      </td>

                      {/* Column 5: Est Sales / Bln */}
                      <td className="py-2 px-1.5 text-center align-top">
                        <div className="font-semibold text-[11px]" style={{ color: "var(--color-text)" }}>
                          Rp {formatRp(estSalesBln)}
                        </div>
                        {qtyUb > 0 && (
                          <div className="text-[10px] mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                            3 Bln: Rp {formatRp(estSalesBln * 3)}
                          </div>
                        )}
                        {row.kodeProduk && (
                          <div className="text-[10px] mt-1 space-y-0.5 leading-tight" style={{ color: "var(--color-text-faint)" }}>
                            <div>Target Sell-in Ins SC / bln :</div>
                            <div
                              className="font-semibold"
                              style={{ color: "var(--color-text-muted)" }}
                              title={scMin > 0 ? `${scMin} UB × Rp ${formatRp(hnaSJ)} = Rp ${formatRp(targetSellInBln)}` : undefined}
                            >
                              {targetSellInBln > 0 ? `Rp ${formatRp(targetSellInBln)}` : (canvasserProduct ? "Rp 0" : "-")}
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Column 6: Nilai SC / Bln */}
                      <td className="py-2 px-1.5 text-center align-top">
                        <div className="font-semibold text-[11px]" style={{ color: "var(--color-blue, #2563eb)" }}>
                          Rp {formatRp(nilaiScBln)}
                        </div>
                        {(() => {
                          const estSalesMonthly = estSalesBln;
                          const avgSalesBln = b3SalesMap?.get(row.kodeProduk) ?? 0;
                          let growthPct: number | null = null;
                          if (avgSalesBln > 0) {
                            growthPct = ((estSalesMonthly - avgSalesBln) / avgSalesBln) * 100;
                          }

                          return (
                            <div className="text-[10px] space-y-0.5 mt-1" style={{ color: "var(--color-text-faint)" }}>
                              <div>% Insentif: <strong style={{ color: "var(--color-text-muted)" }}>{pctMatriks}%</strong></div>

                              <div>
                                <div>Historis Insentif:</div>
                                <div><strong style={{ color: "var(--color-text-muted)" }}>Rp {formatRp(Math.round(avgSalesBln))}</strong></div>
                              </div>

                              {growthPct != null ? (
                                <div className="font-semibold" style={{ color: growthPct > 0 ? "var(--color-success, #16a34a)" : "var(--color-red, #dc2626)" }}>
                                  Growth: {growthPct >= 0 ? "+" : ""}{growthPct.toFixed(1)}%
                                </div>
                              ) : (
                                <div className="flex items-center justify-center gap-1">
                                  <span>Growth:</span>
                                  <span
                                    className="inline-block text-[9px] font-semibold px-1 py-0.2 rounded border leading-none"
                                    style={{
                                      background: "rgba(22, 163, 74, 0.12)",
                                      color: "#16a34a",
                                      borderColor: "rgba(22, 163, 74, 0.3)",
                                    }}
                                  >
                                    Baru
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </td>

                      {/* Column 7: Nilai Cashback / Bln */}
                      <td className="py-2 px-1.5 text-center align-top">
                        {isCashbackNotFound ? (
                          <div className="text-[11px] py-1" style={{ color: "var(--color-text-faint)" }}>
                            -
                          </div>
                        ) : (
                          (() => {
                            const cbMonthly = cashbackDetails.monthlyResultMap.get(row.kodeProduk) ?? 0;
                            const isEligible = cashbackDetails.itemEligibilityMap?.get(row.kodeProduk) ?? false;
                            const displayPct = isEligible && cbMonthly > 0 ? (row.persenCashback || 0) : 0;
                            return (
                              <>
                                <div className="font-semibold text-[11px]" style={{ color: "var(--color-green, #16a34a)" }}>
                                  Rp {formatRp(cbMonthly)}
                                </div>
                                <div className="text-[10px] space-y-0.5 mt-1" style={{ color: "var(--color-green, #16a34a)" }}>
                                  <div>Cashback: <strong style={{ color: "var(--color-green, #16a34a)" }}>{displayPct}%</strong></div>
                                  {cbMonthly > 0 && (
                                    <div>3 Bln: Rp {formatRp(cbMonthly * 3)}</div>
                                  )}
                                </div>
                              </>
                            );
                          })()
                        )}
                      </td>

                      {/* Column 8: Delete Action */}
                      {!readOnly && (
                        <td className="py-2 px-2 text-center align-middle">
                          <button
                            type="button"
                            onClick={() => onRemoveRow(idx)}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-red-500 hover:text-red-700 bg-red-50/70 hover:bg-red-100 border border-red-200/70 hover:border-red-300 transition-all cursor-pointer shadow-2xs"
                            title="Hapus produk"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-4 h-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* Table Summary Footer */}
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t font-semibold" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
                  <td className="py-2.5 pl-4 pr-2 text-xs whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                    Total ({rows.length} produk)
                  </td>
                  <td className="py-2.5 px-1 text-center text-xs whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                    0
                  </td>
                  <td className="py-2.5 px-1 text-center text-xs whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                    {grandTotalQtyUb} UB
                  </td>
                  <td className="py-2.5 px-1"></td>
                  <td className="py-2.5 px-1.5 text-center text-xs whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                    Rp {formatRp(grandTotalEstSalesBln)}
                  </td>
                  <td className="py-2.5 px-1.5 text-center text-xs whitespace-nowrap" style={{ color: "var(--color-blue, #2563eb)" }}>
                    Rp {formatRp(grandTotalNilaiScBln)}
                  </td>
                  <td className="py-2.5 px-1.5 text-center text-xs whitespace-nowrap" style={{ color: isCashbackNotFound ? "var(--color-text-faint)" : "var(--color-green, #16a34a)" }}>
                    {isCashbackNotFound ? "-" : `Rp ${formatRp(cashbackDetails.totalFinalCashbackMonthly)}`}
                  </td>
                  {!readOnly && <td className="py-2.5 px-2 text-center"></td>}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Add Product Button Row at Bottom of Table */}
        {!readOnly && (
          <div className="p-2.5 border-t" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
            <button
              type="button"
              onClick={onAddRow}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-1.5 py-2 px-4 rounded-md border border-dashed hover:bg-white text-xs font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                borderColor: "var(--color-border-strong)",
                color: "var(--color-text-muted)",
              }}
            >
              <span className="text-sm font-bold" style={{ color: "var(--color-blue)" }}>+</span> Tambah Produk
            </button>
          </div>
        )}
      </div>

      {/* Expanded Growth & Switching Details Panel */}
      {rows.map((row, idx) => {
        const isExpanded = expandedRows[idx] ?? false;
        if (!isExpanded || !row.kodeProduk) return null;

        const masterProduct = masterProducts.find((p) => p.kodeProduk === row.kodeProduk);
        const hnaSJ = masterProduct ? (parseFloat(masterProduct.hna) || 0) : 0;
        const qty = parseFloat(row.qtyPerBulan) || 0;
        const estSalesMonthly = qty * hnaSJ;
        const avgSalesBln = b3SalesMap?.get(row.kodeProduk) ?? 0;
        let growthPct: number | null = null;
        if (avgSalesBln > 0) {
          growthPct = ((estSalesMonthly - avgSalesBln) / avgSalesBln) * 100;
        }

        return (
          <div key={`detail-${idx}`} className="p-3 rounded-lg border space-y-3 text-xs animate-fade-in" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
            <div className="flex items-center justify-between font-semibold" style={{ color: "var(--color-text)" }}>
              <span>Detail Analisis Produk #{idx + 1}: {masterProduct?.namaProduk || row.kodeProduk}</span>
              <button type="button" onClick={() => toggleRowDetail(idx)} className="text-xs text-slate-500 hover:text-slate-700 cursor-pointer">✕ Tutup</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Growth Box */}
              <div className="p-2.5 rounded border bg-white space-y-1" style={{ borderColor: "var(--color-border)" }}>
                <div className="font-semibold text-[11px]" style={{ color: "var(--color-text-muted)" }}>Growth Estimasi Sales</div>
                {avgSalesBln > 0 ? (
                  <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                    Sales Sebelumnya: <strong style={{ color: "var(--color-text-muted)" }}>Rp {formatRp(Math.round(avgSalesBln))}/bln</strong> {b3RangeLabel ? `(${b3RangeLabel})` : ""}
                  </div>
                ) : (
                  <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Belum ada data sales sebelumnya</div>
                )}
                {growthPct != null && (
                  <div className="text-xs font-semibold" style={{ color: growthPct > 0 ? "var(--color-success, #16a34a)" : "var(--color-warning, #f59e0b)" }}>
                    Growth: {growthPct >= 0 ? "+" : ""}{growthPct.toFixed(1)}% — {growthPct > 0 ? "✓ Intensifikasi tercapai" : "⚠️ Intensifikasi kurang"}
                  </div>
                )}
              </div>

              {/* Loss Sales Recommendation Box */}
              {lossSalesItems.length > 0 && (
                <div className="p-2.5 rounded border bg-white space-y-1" style={{ borderColor: "var(--color-border)" }}>
                  <div className="font-semibold text-[11px]" style={{ color: "var(--color-blue)" }}>Rekomendasi Switching Produk</div>
                  {lossSalesItems.map((item, itemIdx) => (
                    <div key={item.code || itemIdx} className="flex items-center justify-between text-xs pt-1 border-t" style={{ borderColor: "var(--color-border)" }}>
                      <div>
                        <div className="font-medium">{item.name || item.code}</div>
                        <div className="text-[10px]" style={{ color: "var(--color-text-faint)" }}>Sales 3 Bln: {item.qty} (Total: Rp {formatRp(item.total_sales)})</div>
                      </div>
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => onUpdateRow(idx, { kodeProduk: item.code })}
                          className="text-[11px] px-2 py-1 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 cursor-pointer"
                        >
                          Ganti
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}