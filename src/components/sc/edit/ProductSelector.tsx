"use client";

import { useState, useEffect } from "react";
import type { SalesCounterProduct } from "@/app/(app)/sc/[id]/_models/SalesCounterProductModel";
import type { SelectedProductRow } from "./hooks/useSalesCounterEditor";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { UnitInput } from "./UnitInput";
import type { Product } from "@/lib/masterData";
import { getHistorySalesAction, getLossSalesAnalysisAction, getRecommendedProCodesAction, getScOutletB3SalesAction } from "@/app/actions/canvasser";
import { calculateCashbackDetails } from "./hooks/useSalesCounterCashback";

interface ProductSelectorProps {
  rows: SelectedProductRow[];
  onAddRow: () => void;
  onRemoveRow: (index: number) => void;
  onUpdateRow: (index: number, fields: Partial<SelectedProductRow>) => void;
  productsOptions: any[];
  canvasserProducts: SalesCounterProduct[];
  masterProducts: Product[];
  lamaPeriode: number;
  periodeAwal?: string;
  diskonPeriode?: string;
  cashbackPeriode?: string;
  cashbackData?: any;
  hideCashback?: boolean;
  error?: string;
  readOnly?: boolean;
  b3SalesMap?: Map<string, number>;
  b3QtyMap?: Map<string, number>;
  b3RangeLabel?: string;
  kodePI?: string;
}

function Req() {
  return <span style={{ color: "var(--color-red)", marginLeft: 2 }}>*</span>;
}

function formatRp(val: string | number | null | undefined) {
  if (val == null) return "-";
  const n = typeof val === "number" ? val : parseFloat(val.toString());
  if (isNaN(n)) return "-";
  return Math.round(n).toLocaleString("id-ID");
}

function satuanLabel(product: Product | null | undefined): string {
  const s = product?.satuan?.trim();
  return s && !/^[-—–]$/.test(s) ? s : "SJ";
}

function formatPeriodeDiskonLabel(p?: string) {
  if (!p || p.length !== 6) return null;
  const year = p.slice(0, 4);
  const monthIdx = parseInt(p.slice(4, 6), 10) - 1;
  const MONTH_NAMES = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];
  if (isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11) return p;
  return `${p} (${MONTH_NAMES[monthIdx]} ${year})`;
}

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
  cashbackPeriode,
  cashbackData,
  hideCashback = false,
  error,
  readOnly = false,
  b3SalesMap,
  b3QtyMap,
  b3RangeLabel,
  kodePI,
}: ProductSelectorProps) {
  const [lossSalesItems, setLossSalesItems] = useState<any[]>([]);
  const [internalB3QtyMap, setInternalB3QtyMap] = useState<Map<string, number>>(new Map());
  const [historySalesMap, setHistorySalesMap] = useState<Map<string, number>>(new Map());
  const [historyPeriodRange, setHistoryPeriodRange] = useState<string>("");
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!kodePI) {
      setHistorySalesMap(new Map());
      setHistoryPeriodRange("");
      return;
    }
    getHistorySalesAction(kodePI).then((res) => {
      const hMap = new Map<string, number>();
      if (res?.data && Array.isArray(res.data)) {
        for (const item of res.data) {
          if (item.code) {
            hMap.set(item.code, Number(item.history_sales) || 0);
          }
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
    if (!kodePI || !periodeAwal) return;
    const cleanPeriod = periodeAwal.replace(/[^0-9]/g, "");
    const periodInt = parseInt(cleanPeriod.slice(0, 6), 10);
    const selectedCodes = rows.map((r) => r.kodeProduk).filter(Boolean);
    if (!periodInt || isNaN(periodInt) || selectedCodes.length === 0) return;

    getScOutletB3SalesAction(periodInt, kodePI, selectedCodes).then((res) => {
      const qMap = new Map<string, number>();
      if (res?.data && Array.isArray(res.data)) {
        for (const item of res.data) {
          if (item.pro_code) {
            qMap.set(item.pro_code, item.average_qty || 0);
          }
        }
      }
      setInternalB3QtyMap(qMap);
    });
  }, [kodePI, periodeAwal, rows]);

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
      ...(masterProducts || []).map((p: any) => p.kodeProduk),
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
  let grandTotalQtySt = 0;
  let grandTotalEstSalesBln = 0;
  let grandTotalNilaiScBln = 0;

  rows.forEach((row) => {
    const masterProduct = masterProducts.find((p) => p.kodeProduk === row.kodeProduk);
    const canvasserProduct = canvasserProducts.find((p) => p.pro_code === row.kodeProduk);
    const hnaSJ = masterProduct ? (parseFloat(masterProduct.hna) || 0) : 0;
    const konv = masterProduct ? (parseInt(masterProduct.konversiPembagi || "1", 10) || 1) : 1;
    const qtyUb = parseFloat(row.qtyPerBulan) || 0;
    const qtyST = qtyUb * konv;
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
    grandTotalQtySt += qtyST;
    grandTotalEstSalesBln += estSalesBln;
    grandTotalNilaiScBln += nilaiScBln;
  });

  const cashbackDetails = calculateCashbackDetails({
    cashbackData,
    selectedProducts: rows,
    masterProducts,
    lamaPeriode,
  });

  return (
    <div className="space-y-4">
      {error && <p className="text-xs font-semibold" style={{ color: "var(--color-red)" }}>{error}</p>}

      {/* Main Product Table Container */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
        <div className="w-full">
          <table className="w-full text-left text-xs border-collapse table-fixed">
            <thead>
              <tr style={{ background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
                <th className="py-2 px-1.5 font-semibold text-[11px] text-left w-[28%]" style={{ color: "var(--color-text-muted)" }}>
                  Produk <Req />
                </th>
                <th className="py-2 px-1 font-semibold text-[11px] text-center w-[8%]" style={{ color: "var(--color-text-muted)" }}>
                  Potensi
                </th>
                <th className="py-2 px-1 font-semibold text-[11px] text-center w-[13%]" style={{ color: "var(--color-text-muted)" }}>
                  Est. Switch <Req />
                </th>
                <th className="py-2 px-1 font-semibold text-[11px] text-center w-[8%]" style={{ color: "var(--color-text-muted)" }}>
                  Diskon
                </th>
                <th className="py-2 px-1.5 font-semibold text-[11px] text-right w-[14%]" style={{ color: "var(--color-text-muted)" }}>
                  Est. Sales
                </th>
                <th className="py-2 px-1.5 font-semibold text-[11px] text-right w-[14%]" style={{ color: "var(--color-text-muted)" }}>
                  Nilai SC
                </th>
                <th className="py-2 px-1.5 font-semibold text-[11px] text-right w-[14%]" style={{ color: "var(--color-text-muted)" }}>
                  Cashback
                </th>
                {!readOnly && (
                  <th className="py-2 px-1 text-center font-semibold text-[11px] w-[3%]" style={{ color: "var(--color-text-muted)" }}>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={readOnly ? 7 : 8} className="py-6 text-center text-xs" style={{ color: "var(--color-text-faint)" }}>
                    Belum ada produk yang ditambahkan. Klik tombol <strong>+ Tambah Produk</strong> di bawah untuk memilih produk.
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => {
                  const masterProduct = masterProducts.find((p) => p.kodeProduk === row.kodeProduk);
                  const canvasserProduct = canvasserProducts.find((p) => p.pro_code === row.kodeProduk);

                  const hnaSJ = masterProduct ? (parseFloat(masterProduct.hna) || 0) : 0;
                  const konv = masterProduct ? (parseInt(masterProduct.konversiPembagi || "1", 10) || 1) : 1;
                  const hnaST = hnaSJ / konv;
                  const qtyUb = parseFloat(row.qtyPerBulan) || 0;
                  const qtyST = qtyUb * konv;
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

                  const isExpanded = expandedRows[idx] ?? false;

                  return (
                    <tr key={idx} id={row.kodeProduk ? `sc-product-row-${row.kodeProduk}` : `sc-product-row-index-${idx}`} className="align-top hover:bg-slate-50/50 transition-colors">
                      {/* Column 1: Product Selection & Competitor */}
                      <td className="py-2.5 px-2 space-y-2">
                        <Combobox
                          name={`product-${idx}`}
                          options={productsOptions}
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
                              <span>HNA SJ: <strong style={{ color: "var(--color-text-muted)" }}>Rp {formatRp(masterProduct.hna)}</strong></span>
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
                        <div className="text-[10px] space-y-0.5 mt-1 text-left" style={{ color: "var(--color-text-faint)" }}>
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
                          const targetUb = historySalesMap.get(row.kodeProduk) ?? 0;
                          const formattedTarget = targetUb > 0 ? (targetUb % 1 === 0 ? targetUb.toString() : (Math.round(targetUb * 10) / 10).toString()) : "0";
                          const labelPrefix = historyPeriodRange ? `History (${historyPeriodRange}) :` : "History :";
                          return (
                            <div className="text-[10px] leading-tight mt-1" style={{ color: "var(--color-text-faint)" }}>
                              <div>{labelPrefix} <strong style={{ color: "var(--color-text-muted)" }}>{formattedTarget}</strong></div>
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
                      <td className="py-2 px-1.5 text-right align-top">
                        <div className="font-semibold text-[11px]" style={{ color: "var(--color-text)" }}>
                          Rp {formatRp(estSalesBln)}
                        </div>
                        {qtyUb > 0 && (
                          <div className="text-[10px] mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                            3 Bln: Rp {formatRp(estSalesBln * 3)}
                          </div>
                        )}
                      </td>

                      {/* Column 6: Nilai SC / Bln */}
                      <td className="py-2 px-1.5 text-right align-top">
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
                              <div>Matriks SC: <strong style={{ color: "var(--color-text-muted)" }}>{pctMatriks}%</strong></div>

                              <div>
                                <div>Historis Insentif:</div>
                                <div><strong style={{ color: "var(--color-text-muted)" }}>Rp {formatRp(Math.round(avgSalesBln))}</strong></div>
                              </div>

                              {growthPct != null ? (
                                <div className="font-semibold" style={{ color: growthPct > 0 ? "var(--color-success, #16a34a)" : "var(--color-red, #dc2626)" }}>
                                  Growth: {growthPct >= 0 ? "+" : ""}{growthPct.toFixed(1)}%
                                </div>
                              ) : (
                                <div>Growth: 0%</div>
                              )}
                            </div>
                          );
                        })()}
                      </td>

                      {/* Column 7: Nilai Cashback / Bln */}
                      <td className="py-2 px-1.5 text-right align-top">
                        {isCashbackNotFound ? (
                          <div className="text-[11px] py-1" style={{ color: "var(--color-text-faint)" }}>
                            0
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
                        <td className="py-2 px-1 text-center align-top">
                          <button
                            type="button"
                            onClick={() => onRemoveRow(idx)}
                            className="p-1.5 rounded hover:bg-red-50 transition-colors cursor-pointer text-red-500 hover:text-red-700"
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
                  <td className="py-2.5 px-3 text-xs" style={{ color: "var(--color-text)" }}>
                    Total ({rows.length} produk)
                  </td>
                  <td className="py-2.5 px-3 text-center text-xs" style={{ color: "var(--color-text-faint)" }}>
                    0
                  </td>
                  <td className="py-2.5 px-3 text-center text-xs" style={{ color: "var(--color-text)" }}>
                    {grandTotalQtyUb} UB
                  </td>
                  <td className="py-2.5 px-3"></td>
                  <td className="py-2.5 px-3 text-right text-xs" style={{ color: "var(--color-text)" }}>
                    Rp {formatRp(grandTotalEstSalesBln)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-xs" style={{ color: "var(--color-blue, #2563eb)" }}>
                    Rp {formatRp(grandTotalNilaiScBln)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-xs" style={{ color: "var(--color-green, #16a34a)" }}>
                    {isCashbackNotFound ? "0" : `Rp ${formatRp(cashbackDetails.totalFinalCashbackMonthly)}`}
                  </td>
                  {!readOnly && <td></td>}
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
              className="w-full flex items-center justify-center gap-1.5 py-2 px-4 rounded-md border border-dashed hover:bg-white text-xs font-medium transition-all cursor-pointer"
              style={{
                borderColor: "var(--color-border-strong)",
                color: "var(--color-text-muted)",
              }}
            >
              <span className="text-sm font-bold" style={{ color: "var(--color-blue)" }}>+</span> Tambah produk user...
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
                    SC Sebelumnya: <strong style={{ color: "var(--color-text-muted)" }}>Rp {formatRp(Math.round(avgSalesBln))}/bln</strong> {b3RangeLabel ? `(${b3RangeLabel})` : ""}
                  </div>
                ) : (
                  <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Belum ada data SC sebelumnya</div>
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