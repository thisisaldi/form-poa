"use client";

import { useMemo } from "react";
import { HeaderInfo } from "@/components/ui/HeaderInfo";

import { formatRp, formatQtySales } from "./utils/formatEditUtils";
import { formatUb } from "../utils/competitorAnalysisUtils";
import { formatMonthKey } from "./utils/periodUtils";
import { getHnaForProduct } from "./utils/productMatcherUtils";
import { SIDEBAR_BLUE, SIDEBAR_GREEN, SIDEBAR_RED } from "./constants/sidebarColors";
import { PROMILAN_KEYWORDS } from "./constants/promilanKeywords";
import type { SidebarTab, ScSidebarProps } from "./types/sidebarTypes";
import { useScSidebar } from "./hooks/useScSidebar";

function sidebarEdgeTabStyle(color: string): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "18px 10px",
    gap: 2,
    background: color,
    border: `1px solid ${color}`,
    borderRight: "none",
    borderRadius: "8px 0 0 8px",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    writingMode: "vertical-rl",
    letterSpacing: "0.05em",
  };
}


function SidebarTabSwitcher({
  activeTab,
  onChange,
}: {
  activeTab: SidebarTab;
  onChange: (tab: SidebarTab) => void;
}) {
  function pillStyle(color: string, active: boolean): React.CSSProperties {
    return {
      fontSize: 11,
      fontWeight: 700,
      padding: "3px 9px",
      borderRadius: 999,
      cursor: "pointer",
      letterSpacing: "0.01em",
      border: `1px solid ${color}`,
      background: active ? color : "transparent",
      color: active ? "#fff" : color,
    };
  }
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={() => onChange("rekomendasi")}
        style={pillStyle(SIDEBAR_GREEN, activeTab === "rekomendasi")}
      >
        Produk Rekomendasi
      </button>
      <button
        type="button"
        onClick={() => onChange("history")}
        style={pillStyle(SIDEBAR_BLUE, activeTab === "history")}
      >
        Histori SC
      </button>
      <button
        type="button"
        onClick={() => onChange("analisis_kompetitor")}
        style={pillStyle(SIDEBAR_RED, activeTab === "analisis_kompetitor")}
      >
        Analisis Kompetitor
      </button>
    </div>
  );
}

export function ScSidebar({
  poaPeriod,
  doctorName,
  insentifHistory,
  historySalesData,
  salesOnlineData,
  surveyData = [],
  surveyNexusData,
  rekomendasiProduk = [],
  masterProducts = [],
  canvasserProducts = [],
  healthyOneData = [],
  selectedProductCodes = new Set<string>(),
  onSelectProduct,
}: ScSidebarProps) {
  const {
    activeTab,
    setActiveTab,
    kompetitorFilter,
    setKompetitorFilter,
    kompetitorSearch,
    setKompetitorSearch,
    kompetitorPage,
    setKompetitorPage,
    prevQuarterInfo,
    canvasserScCodes,
    effectiveSurveyData,
    historyPeriodSubtext,
    filteredCards,
    paginatedCards,
    totalKompetitorPages,
    historySalesList,
  } = useScSidebar({
    poaPeriod,
    canvasserProducts,
    masterProducts,
    salesOnlineData,
    surveyData,
    surveyNexusData,
    historySalesData,
    healthyOneData,
    selectedProductCodes,
  });

  // Set of codes already placed in Category 2 (Pernah diorder)
  const orderedScCodesSet = useMemo(() => {
    const set = new Set<string>();
    for (const entry of historySalesList) {
      set.add(entry.code);
      set.add(entry.code.replace(/^0+/, ""));
    }
    return set;
  }, [historySalesList]);

  // SC Products from canvasserProducts that HAVE NO sales history
  const noSalesScProducts = useMemo(() => {
    if (!Array.isArray(canvasserProducts)) return [];
    return canvasserProducts.filter((cp: any) => {
      const code = String(cp.pro_code || cp.kode_item || cp.kodeProduk || "").trim();
      const strippedCode = code.replace(/^0+/, "");
      return !orderedScCodesSet.has(code) && !orderedScCodesSet.has(strippedCode);
    });
  }, [canvasserProducts, orderedScCodesSet]);

  // Category 3: PRODUK PROMILAN SC (SC products with NO sales history matching Promilan keywords)
  const promilanProducts = useMemo(() => {
    return noSalesScProducts.filter((item: any) => {
      const name = String(item.pro_name || item.namaProduk || item.name || "").toUpperCase();
      return PROMILAN_KEYWORDS.some((kw) => name.includes(kw));
    });
  }, [noSalesScProducts]);

  // Category 4: PRODUK SC (SC products with NO sales history that are NOT Promilan)
  const scNoSalesProducts = useMemo(() => {
    return noSalesScProducts.filter((item: any) => {
      const name = String(item.pro_name || item.namaProduk || item.name || "").toUpperCase();
      return !PROMILAN_KEYWORDS.some((kw) => name.includes(kw));
    });
  }, [noSalesScProducts]);

  const sortedLossSalesProducts = useMemo(() => {
    if (!Array.isArray(rekomendasiProduk)) return [];
    return [...rekomendasiProduk]
      .filter((item) => {
        if (canvasserScCodes.size === 0) return false;
        const code = String(item.product_code || item.code || "").trim();
        return canvasserScCodes.has(code) || canvasserScCodes.has(code.replace(/^0+/, ""));
      })
      .map((item) => {
        const code = String(item.product_code || item.code || "").trim();
        const hna = getHnaForProduct(code, masterProducts);
        const salesPotential = Number(item.sales_potential) || 0;
        const qty = hna > 0 ? Math.ceil(salesPotential / hna) : 0;
        return {
          ...item,
          _computedQty: qty,
          _salesPotentialNum: salesPotential,
        };
      })
      .sort((a, b) => {
        if (b._computedQty !== a._computedQty) {
          return b._computedQty - a._computedQty;
        }
        return b._salesPotentialNum - a._salesPotentialNum;
      });
  }, [rekomendasiProduk, masterProducts]);

  if (activeTab === null) {
    return (
      <>
        {/* Desktop Vertical Tabs */}
        <div
          className="hidden md:flex flex-col gap-1 fixed right-0 top-1/2 -translate-y-1/2 z-40"
        >
          <button
            type="button"
            onClick={() => setActiveTab("rekomendasi")}
            style={sidebarEdgeTabStyle(SIDEBAR_GREEN)}
          >
            Produk Rekomendasi
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("history")}
            style={sidebarEdgeTabStyle(SIDEBAR_BLUE)}
          >
            Histori SC
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("analisis_kompetitor")}
            style={sidebarEdgeTabStyle(SIDEBAR_RED)}
          >
            Analisis Kompetitor
          </button>
        </div>

        {/* Mobile Floating Action Button (Clean Circular FAB, doesn't block card numbers or bottom action buttons) */}
        <div className="flex md:hidden fixed bottom-20 right-4 z-30">
          <button
            type="button"
            onClick={() => setActiveTab("rekomendasi")}
            className="w-11 h-11 rounded-full shadow-xl flex items-center justify-center text-white transition-all active:scale-90 cursor-pointer"
            style={{
              background: "var(--color-blue, #0063a0)",
              boxShadow: "0 4px 14px rgba(0, 99, 160, 0.4)",
            }}
            title="Buka Data Rekomendasi & Histori SC"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Mobile Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-xs z-40 md:hidden"
        onClick={() => setActiveTab(null)}
      />

      <div
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col shadow-2xl transition-all duration-300 w-[88vw] sm:w-[320px] max-w-[360px]"
        style={{
          background: "var(--color-bg)",
          borderLeft: "1px solid var(--color-border)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <SidebarTabSwitcher activeTab={activeTab} onChange={setActiveTab} />
            {doctorName && (
              <p className="truncate" style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)", marginTop: 1 }}>
                {doctorName}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setActiveTab(null)}
            className="p-1 rounded text-gray-500 hover:text-gray-800 text-sm font-bold flex items-center gap-1 cursor-pointer"
            title="Tutup"
          >
            <span>✕</span>
            <span className="text-xs md:hidden">Tutup</span>
          </button>
        </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 14 }} className="space-y-4">
        {activeTab === "rekomendasi" ? (
          <div className="space-y-4 animate-fade-in">
            {/* 1. SURVEY KOMPETITOR */}
            <div className="space-y-1.5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                  SURVEY KOMPETITOR ({effectiveSurveyData.length})
                </p>
                <p className="text-[9px] font-medium" style={{ color: "var(--color-text-faint)", marginTop: 1 }}>
                  ( NEXUS )
                </p>
              </div>
              {effectiveSurveyData.length > 0 ? (
                <div className="space-y-1.5">
                  {effectiveSurveyData.map((item: any, i: number) => {
                    const targetCode = String(item.kodeProduk || item.targetCode || "").trim();
                    const name = item.namaProdukRekomendasi || item.name || targetCode;
                    const isSelected = targetCode
                      ? selectedProductCodes.has(targetCode) || selectedProductCodes.has(targetCode.replace(/^0+/, ""))
                      : false;

                    const cp =
                      canvasserProducts?.find((p: any) => {
                        const pc = String(p.pro_code || p.kode_item || p.kodeProduk || "").trim();
                        return pc === targetCode || pc.replace(/^0+/, "") === targetCode.replace(/^0+/, "");
                      }) || item.item;

                    const minTarget =
                      cp?.sales_counter_minimum != null
                        ? Number(cp.sales_counter_minimum)
                        : item.sales_counter_minimum != null
                        ? Number(item.sales_counter_minimum)
                        : null;

                    const insentif =
                      cp?.sales_counter_value != null
                        ? Number(cp.sales_counter_value)
                        : item.sales_counter_value != null
                        ? Number(item.sales_counter_value)
                        : null;

                    const totalPotensi =
                      item.totalPotensiBulan != null ? Number(item.totalPotensiBulan) : null;

                    const formattedPotensi =
                      totalPotensi != null
                        ? totalPotensi % 1 === 0
                          ? totalPotensi.toString()
                          : (Math.round(totalPotensi * 10) / 10).toString()
                        : null;

                    const kompetitorList =
                      Array.isArray(item.kompetitor) && item.kompetitor.length > 0
                        ? item.kompetitor
                        : [];

                    return (
                      <div
                        key={i}
                        onClick={() => targetCode && onSelectProduct?.(targetCode)}
                        className={`p-2 rounded-lg border text-[11px] space-y-1.5 transition-all ${
                          onSelectProduct && targetCode ? "cursor-pointer hover:border-emerald-500" : ""
                        }`}
                        style={{
                          background: isSelected ? "var(--color-success-bg, #dcfce7)" : "var(--color-bg-subtle)",
                          borderColor: isSelected ? "var(--color-success, #16a34a)" : "var(--color-border)",
                        }}
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="min-w-0 flex-1">
                            <span className="font-semibold leading-tight block truncate" style={{ color: "var(--color-text)" }}>
                              {name}
                            </span>
                          </div>
                          {isSelected && (
                            <span
                              className="inline-flex items-center gap-1 text-[9px] font-bold shrink-0 px-1.5 py-0.5 rounded-full"
                              style={{ background: "var(--color-success, #16a34a)", color: "#ffffff" }}
                            >
                              ✓ Terpilih
                            </span>
                          )}
                        </div>

                        <div className="space-y-1 pt-0.5 text-[9.5px]">
                          <div className="flex items-center">
                            <span
                              className="font-medium px-1.5 py-0.5 rounded"
                              style={{ background: "#f3e8ff", color: "#6b21a8" }}
                            >
                              Produk Survey{formattedPotensi ? `: ${formattedPotensi} UB` : ""}
                            </span>
                          </div>

                          {kompetitorList.length > 0 && (
                            <div className="space-y-0.5 pl-1 py-0.5">
                              {kompetitorList.map((k: any, kIdx: number) => {
                                const kName = typeof k === "string" ? k : (k?.namaKompetitor || k?.nama || "");
                                const kForecast = typeof k === "object" && k?.salesForecast != null && k.salesForecast > 0
                                  ? `${k.salesForecast} UB`
                                  : null;
                                if (!kName) return null;
                                return (
                                  <div
                                    key={kIdx}
                                    className="flex items-center justify-between text-[9px] leading-tight"
                                    style={{ color: "var(--color-text-muted, #64748b)" }}
                                  >
                                    <span className="truncate">• {kName}</span>
                                    {kForecast && (
                                      <span className="shrink-0 text-[8.5px] ml-1 opacity-75">
                                        {kForecast}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {minTarget != null && !isNaN(minTarget) && minTarget > 0 && (
                            <div className="flex items-center">
                              <span
                                className="font-semibold px-2 py-0.5 rounded text-[9.5px] inline-flex items-center"
                                style={{
                                  background: isSelected ? "rgba(255, 255, 255, 0.85)" : "var(--color-success-bg, #dcfce7)",
                                  color: "var(--color-success, #16a34a)",
                                  border: "1px solid rgba(22, 163, 74, 0.25)",
                                }}
                              >
                                Target: {minTarget} UB
                              </span>
                            </div>
                          )}

                          {insentif != null && !isNaN(insentif) && (
                            <div className="flex items-center">
                              <span
                                className="font-semibold px-2 py-0.5 rounded text-[9.5px] inline-flex items-center"
                                style={{
                                  background: isSelected ? "rgba(255, 255, 255, 0.85)" : "var(--color-success-bg, #dcfce7)",
                                  color: "var(--color-success, #16a34a)",
                                  border: "1px solid rgba(22, 163, 74, 0.25)",
                                }}
                              >
                                Nilai Insentif SC: {formatRp(insentif)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border p-3 text-center text-xs" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
                  Belum ada data survey.
                </div>
              )}
            </div>

            {/* 2. PRODUK PERNAH DI ORDER */}
            <div className="space-y-1.5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                  PRODUK PERNAH DI ORDER ({historySalesList.length})
                </p>
                {historyPeriodSubtext && (
                  <p className="text-[9px] font-medium" style={{ color: "var(--color-text-faint)", marginTop: 1 }}>
                    ( {historyPeriodSubtext} )
                  </p>
                )}
              </div>
              {historySalesList.length > 0 ? (
                <div className="space-y-1.5">
                  {historySalesList.map((entry, i) => {
                    const isSelected = entry.targetCode ? selectedProductCodes.has(entry.targetCode) || selectedProductCodes.has(entry.code) : false;

                    return (
                      <div
                        key={i}
                        onClick={() => entry.targetCode && onSelectProduct?.(entry.targetCode)}
                        className={`p-2 rounded-lg border text-[11px] space-y-1.5 transition-all ${
                          onSelectProduct && entry.targetCode ? "cursor-pointer hover:border-emerald-500" : ""
                        }`}
                        style={{
                          background: isSelected ? "var(--color-success-bg, #dcfce7)" : "var(--color-bg-subtle)",
                          borderColor: isSelected ? "var(--color-success, #16a34a)" : "var(--color-border)",
                        }}
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="min-w-0 flex-1">
                            <span className="font-semibold leading-tight block truncate" style={{ color: "var(--color-text)" }}>
                              {entry.name}
                            </span>
                          </div>
                          {isSelected && (
                            <span
                              className="inline-flex items-center gap-1 text-[9px] font-bold shrink-0 px-1.5 py-0.5 rounded-full"
                              style={{ background: "var(--color-success, #16a34a)", color: "#ffffff" }}
                            >
                              ✓ Terpilih
                            </span>
                          )}
                        </div>

                        {(() => {
                          const cp = canvasserProducts?.find(
                            (p: any) =>
                              p.pro_code === entry.code ||
                              p.pro_code?.replace(/^0+/, "") === entry.code.replace(/^0+/, "")
                          ) || entry.item;

                          const hna = getHnaForProduct(entry.code, masterProducts) || parseFloat(String(cp?.hna || cp?.pro_hna || 0)) || 0;
                          const salesVal = entry.salesVal > 0 ? entry.salesVal : entry.salesQty * hna;
                          const formattedQty = entry.salesQty % 1 === 0 ? entry.salesQty.toString() : (Math.round(entry.salesQty * 10) / 10).toString();
                          const minTarget = cp?.sales_counter_minimum != null ? Number(cp.sales_counter_minimum) : null;
                          const insentif = cp?.sales_counter_value != null ? Number(cp.sales_counter_value) : null;

                          return (
                            <div className="space-y-1 pt-0.5 text-[9.5px]">
                              <div className="flex items-center">
                                <span
                                  className="font-medium px-1.5 py-0.5 rounded"
                                  style={{ background: "var(--color-blue-light, #eff6ff)", color: "var(--color-blue, #2563eb)" }}
                                >
                                  Average History Per Bulan: {salesVal > 0 ? `Rp ${Math.round(salesVal).toLocaleString("id-ID")} (${formattedQty} UB)` : `${formattedQty} UB`}
                                </span>
                              </div>
                              {minTarget != null && !isNaN(minTarget) && minTarget > 0 && (
                                <div className="flex items-center">
                                  <span
                                    className="font-semibold px-2 py-0.5 rounded text-[9.5px] inline-flex items-center"
                                    style={{
                                      background: isSelected ? "rgba(255, 255, 255, 0.85)" : "var(--color-success-bg, #dcfce7)",
                                      color: "var(--color-success, #16a34a)",
                                      border: "1px solid rgba(22, 163, 74, 0.25)",
                                    }}
                                  >
                                    Target: {minTarget} UB
                                  </span>
                                </div>
                              )}
                              {insentif != null && !isNaN(insentif) && (
                                <div className="flex items-center">
                                  <span
                                    className="font-semibold px-2 py-0.5 rounded text-[9.5px] inline-flex items-center"
                                    style={{
                                      background: isSelected ? "rgba(255, 255, 255, 0.85)" : "var(--color-success-bg, #dcfce7)",
                                      color: "var(--color-success, #16a34a)",
                                      border: "1px solid rgba(22, 163, 74, 0.25)",
                                    }}
                                  >
                                    Nilai Insentif SC: {formatRp(insentif)}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border p-3 text-center text-xs" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
                  Belum ada data order.
                </div>
              )}
            </div>

            {/* 3. PRODUK PROMILAN SC */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                PRODUK PROMILAN SC ({promilanProducts.length})
              </p>
              {promilanProducts.length > 0 ? (
                <div className="space-y-1.5">
                  {promilanProducts.map((item: any, i: number) => {
                    const targetCode = String(item.pro_code || item.kode_item || "").trim();
                    const name = item.pro_name || item.namaProduk || item.name || targetCode;
                    const isSelected = targetCode ? selectedProductCodes.has(targetCode) : false;
                    const insentif = item.sales_counter_value != null ? Number(item.sales_counter_value) : null;
                    const minTarget = item.sales_counter_minimum != null ? Number(item.sales_counter_minimum) : null;

                    return (
                      <div
                        key={i}
                        onClick={() => targetCode && onSelectProduct?.(targetCode)}
                        className={`p-2 rounded-lg border text-[11px] space-y-1.5 transition-all ${
                          onSelectProduct && targetCode ? "cursor-pointer hover:border-emerald-500" : ""
                        }`}
                        style={{
                          background: isSelected ? "var(--color-success-bg, #dcfce7)" : "var(--color-bg-subtle)",
                          borderColor: isSelected ? "var(--color-success, #16a34a)" : "var(--color-border)",
                        }}
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="min-w-0 flex-1">
                            <span className="font-semibold leading-tight block truncate" style={{ color: "var(--color-text)" }}>
                              {name}
                            </span>
                          </div>
                          {isSelected && (
                            <span
                              className="inline-flex items-center gap-1 text-[9px] font-bold shrink-0 px-1.5 py-0.5 rounded-full"
                              style={{ background: "var(--color-success, #16a34a)", color: "#ffffff" }}
                            >
                              ✓ Terpilih
                            </span>
                          )}
                        </div>

                        <div className="space-y-1 pt-0.5 text-[9.5px]">
                          {minTarget != null && !isNaN(minTarget) && minTarget > 0 && (
                            <div className="flex items-center">
                              <span
                                className="font-semibold px-2 py-0.5 rounded text-[9.5px] inline-flex items-center"
                                style={{
                                  background: isSelected ? "rgba(255, 255, 255, 0.85)" : "var(--color-success-bg, #dcfce7)",
                                  color: "var(--color-success, #16a34a)",
                                  border: "1px solid rgba(22, 163, 74, 0.25)",
                                }}
                              >
                                Target: {minTarget} UB
                              </span>
                            </div>
                          )}
                          {insentif != null && !isNaN(insentif) && (
                            <div className="flex items-center">
                              <span
                                className="font-semibold px-2 py-0.5 rounded text-[9.5px] inline-flex items-center"
                                style={{
                                  background: isSelected ? "rgba(255, 255, 255, 0.85)" : "var(--color-success-bg, #dcfce7)",
                                  color: "var(--color-success, #16a34a)",
                                  border: "1px solid rgba(22, 163, 74, 0.25)",
                                }}
                              >
                                Nilai Insentif SC: {formatRp(insentif)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border p-3 text-center text-xs" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
                  Tidak ada produk Promilan SC.
                </div>
              )}
            </div>

            {/* 4. PRODUK SC */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                PRODUK SC ({scNoSalesProducts.length})
              </p>
              {scNoSalesProducts.length > 0 ? (
                <div className="space-y-1.5">
                  {scNoSalesProducts.map((item: any, i: number) => {
                    const targetCode = String(item.pro_code || item.kode_item || "").trim();
                    const name = item.pro_name || item.namaProduk || item.name || targetCode;
                    const isSelected = targetCode ? selectedProductCodes.has(targetCode) : false;
                    const insentif = item.sales_counter_value != null ? Number(item.sales_counter_value) : null;
                    const minTarget = item.sales_counter_minimum != null ? Number(item.sales_counter_minimum) : null;

                    return (
                      <div
                        key={i}
                        onClick={() => targetCode && onSelectProduct?.(targetCode)}
                        className={`p-2 rounded-lg border text-[11px] space-y-1.5 transition-all ${
                          onSelectProduct && targetCode ? "cursor-pointer hover:border-emerald-500" : ""
                        }`}
                        style={{
                          background: isSelected ? "var(--color-success-bg, #dcfce7)" : "var(--color-bg-subtle)",
                          borderColor: isSelected ? "var(--color-success, #16a34a)" : "var(--color-border)",
                        }}
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="min-w-0 flex-1">
                            <span className="font-semibold leading-tight block truncate" style={{ color: "var(--color-text)" }}>
                              {name}
                            </span>
                          </div>
                          {isSelected && (
                            <span
                              className="inline-flex items-center gap-1 text-[9px] font-bold shrink-0 px-1.5 py-0.5 rounded-full"
                              style={{ background: "var(--color-success, #16a34a)", color: "#ffffff" }}
                            >
                              ✓ Terpilih
                            </span>
                          )}
                        </div>

                        <div className="space-y-1 pt-0.5 text-[9.5px]">
                          {minTarget != null && !isNaN(minTarget) && minTarget > 0 && (
                            <div className="flex items-center">
                              <span
                                className="font-semibold px-2 py-0.5 rounded text-[9.5px] inline-flex items-center"
                                style={{
                                  background: isSelected ? "rgba(255, 255, 255, 0.85)" : "var(--color-success-bg, #dcfce7)",
                                  color: "var(--color-success, #16a34a)",
                                  border: "1px solid rgba(22, 163, 74, 0.25)",
                                }}
                              >
                                Target: {minTarget} UB
                              </span>
                            </div>
                          )}
                          {insentif != null && !isNaN(insentif) && (
                            <div className="flex items-center">
                              <span
                                className="font-semibold px-2 py-0.5 rounded text-[9.5px] inline-flex items-center"
                                style={{
                                  background: isSelected ? "rgba(255, 255, 255, 0.85)" : "var(--color-success-bg, #dcfce7)",
                                  color: "var(--color-success, #16a34a)",
                                  border: "1px solid rgba(22, 163, 74, 0.25)",
                                }}
                              >
                                Nilai Insentif SC: {formatRp(insentif)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border p-3 text-center text-xs" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
                  Tidak ada produk SC.
                </div>
              )}
            </div>
          </div>
        ) : activeTab === "loss_sales" ? (
          <div className="space-y-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                  POTENSI SALES ({sortedLossSalesProducts.length})
                </p>
                <HeaderInfo text="Angka potensi sales didapatkan dari penjualan B-1 sampai B-6" />
              </div>
            </div>
            {sortedLossSalesProducts.length > 0 ? (
              <div className="space-y-1.5">
                {sortedLossSalesProducts.map((item, i) => {
                  const code = String(item.product_code || item.code || "").trim();
                  const name = item.product_name || item.name || code;
                  const isSelected = selectedProductCodes.has(code);
                  const hna = getHnaForProduct(code, masterProducts);
                  const salesPotential = Number(item.sales_potential) || 0;
                  const qty = hna > 0 ? Math.ceil(salesPotential / hna) : 0;

                  return (
                    <div
                      key={i}
                      onClick={() => code && onSelectProduct?.(code)}
                      className={`p-2 rounded-lg border text-[11px] space-y-1.5 transition-all ${
                        onSelectProduct && code ? "cursor-pointer hover:border-purple-500" : ""
                      }`}
                      style={{
                        background: isSelected ? "var(--color-purple-light, #f3e8ff)" : "var(--color-bg-subtle)",
                        borderColor: isSelected ? "var(--color-purple, #7c3aed)" : "var(--color-border)",
                      }}
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="min-w-0 flex-1">
                          <span className="font-semibold leading-tight block truncate" style={{ color: "var(--color-text)" }}>
                            {name}
                          </span>
                          <span className="text-[10px]" style={{ color: "var(--color-text-faint)" }}>
                            Kode: {code}
                          </span>
                        </div>
                        {isSelected && (
                          <span
                            className="inline-flex items-center gap-1 text-[9px] font-bold shrink-0 px-1.5 py-0.5 rounded-full"
                            style={{ background: "#7c3aed", color: "#ffffff" }}
                          >
                            ✓ Terpilih
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 text-[9px] flex-wrap pt-0.5">
                        <span
                          className="font-medium px-1.5 py-0.5 rounded"
                          style={{ background: "var(--color-blue-light, #eff6ff)", color: "var(--color-blue, #2563eb)" }}
                        >
                          Sales Potential: {formatRp(salesPotential)}
                        </span>
                        <span
                          className="font-medium px-1.5 py-0.5 rounded"
                          style={{ background: "var(--color-success-bg, #dcfce7)", color: "var(--color-success, #16a34a)" }}
                        >
                          Qty: {qty}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border p-4 text-center text-xs" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
                Tidak ada data potensi sales untuk outlet ini.
              </div>
            )}
          </div>
        ) : activeTab === "analisis_kompetitor" ? (
          <div className="space-y-3 animate-fade-in">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                Analisis Kompetitor &amp; Survey ({filteredCards.length} Produk)
              </p>
              <p className="text-[9px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                Sumber: Survey, HealthyOne &amp; B2B
              </p>
              {prevQuarterInfo.label && (
                <p className="text-[9px] mt-0.5 font-medium" style={{ color: "var(--color-text-muted)" }}>
                  Periode: {prevQuarterInfo.label}
                </p>
              )}
            </div>

            {/* Search Input */}
            <div className="relative">
              <input
                type="text"
                placeholder="Cari produk SC / zat aktif..."
                value={kompetitorSearch}
                onChange={(e) => {
                  setKompetitorSearch(e.target.value);
                  setKompetitorPage(1);
                }}
                className="w-full px-2.5 py-1.5 rounded-lg border outline-none transition-colors"
                style={{
                  background: "var(--color-surface)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text)",
                  fontSize: "11px",
                  fontFamily: "inherit",
                }}
              />
              {kompetitorSearch && (
                <button
                  type="button"
                  onClick={() => {
                    setKompetitorSearch("");
                    setKompetitorPage(1);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Source Filter Pills */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 text-[10px]">
              {[
                {
                  id: "semua",
                  label: "Semua",
                  activeBg: "#7c3aed", // Ungu sedang (tidak terlalu gelap/bold)
                  activeText: "#ffffff",
                  activeBorder: "#7c3aed",
                  inactiveText: "#7c3aed",
                  inactiveBorder: "#ddd6fe",
                },
                {
                  id: "survey",
                  label: "Survey",
                  activeBg: "#dc2626", // Merah
                  activeText: "#ffffff",
                  activeBorder: "#dc2626",
                  inactiveText: "#dc2626",
                  inactiveBorder: "#fca5a5",
                },
                {
                  id: "healthyone",
                  label: "HealthyOne",
                  activeBg: "#026D77", // Warna gambar 3
                  activeText: "#ffffff",
                  activeBorder: "#026D77",
                  inactiveText: "#026D77",
                  inactiveBorder: "#80ced4",
                },
                {
                  id: "b2b",
                  label: "B2B",
                  activeBg: "#028CD5", // HospiNet
                  activeText: "#ffffff",
                  activeBorder: "#028CD5",
                  inactiveText: "#028CD5",
                  inactiveBorder: "#7dd3fc",
                },
              ].map((f) => {
                const isActive = kompetitorFilter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setKompetitorFilter(f.id);
                      setKompetitorPage(1);
                    }}
                    className="px-2.5 py-0.5 rounded-full border transition-all cursor-pointer whitespace-nowrap text-[9px]"
                    style={{
                      background: isActive ? f.activeBg : "var(--color-surface)",
                      color: isActive ? f.activeText : f.inactiveText,
                      borderColor: isActive ? f.activeBorder : f.inactiveBorder,
                      fontWeight: isActive ? 700 : 500,
                    }}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>

            {/* Product Competitor Cards */}
            <div className="space-y-2.5">
              {paginatedCards.length === 0 ? (
                <div
                  className="rounded-lg border p-4 text-center text-xs"
                  style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}
                >
                  Tidak ada produk yang cocok dengan pencarian atau filter ini.
                </div>
              ) : (
                paginatedCards.map((item, idx) => {
                  const showSurvey = kompetitorFilter === "semua" || kompetitorFilter === "survey";
                  const showHealthyOne = kompetitorFilter === "semua" || kompetitorFilter === "healthyone";
                  const showB2B = kompetitorFilter === "semua" || kompetitorFilter === "b2b";

                  return (
                    <div
                      key={item.kodeProduk || idx}
                      onClick={() => item.kodeProduk && onSelectProduct?.(item.kodeProduk)}
                      className={`rounded-lg border overflow-hidden text-xs transition-all ${
                        onSelectProduct ? "cursor-pointer hover:border-[var(--color-border-strong)]" : ""
                      }`}
                      style={{
                        borderColor: item.isSelected ? "var(--color-success, #16a34a)" : "var(--color-border)",
                        background: "var(--color-surface)",
                        boxShadow: item.isSelected ? "0 0 0 1px rgba(22, 163, 74, 0.2)" : undefined,
                      }}
                    >
                      {/* Header Card */}
                      <div
                        className="p-2.5 border-b flex items-start justify-between gap-1.5 transition-colors"
                        style={{
                          background: item.isSelected ? "var(--color-success-bg, #dcfce7)" : "var(--color-bg-subtle)",
                          borderColor: item.isSelected ? "rgba(22, 163, 74, 0.3)" : "var(--color-border)",
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <span className="font-semibold text-[11px] leading-tight block truncate" style={{ color: "var(--color-text)" }}>
                            {item.namaProduk}
                          </span>
                          <span className="text-[9px] block truncate" style={{ color: "var(--color-text-muted)" }}>
                            {item.subtitel}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {item.isSelected && (
                            <span
                              className="shrink-0 px-1.5 py-0.5 rounded font-semibold text-[8px] uppercase border"
                              style={{
                                background: "#16a34a",
                                color: "#ffffff",
                                borderColor: "#16a34a",
                              }}
                            >
                              ✓ Terpilih
                            </span>
                          )}
                          <span
                            className="text-[9px] font-bold shrink-0 px-2 py-0.5 rounded border"
                            style={{
                              background: item.isSelected ? "#ffffff" : "var(--color-surface)",
                              color: item.isSelected ? "#15803d" : "var(--color-text)",
                              borderColor: item.isSelected ? "#86efac" : "var(--color-border-strong)",
                            }}
                          >
                            Potensi: {item.totalPotensi} UB
                          </span>
                        </div>
                      </div>

                      {/* Card Body */}
                      <div className="p-2 space-y-2.5">
                        {/* 1. SELL OUT (Survey, HealthyOne) */}
                        {((showSurvey && item.hasSurvey) || (showHealthyOne && item.healthyOneUb > 0)) && (
                          <div className="space-y-1">
                            <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                              Sell Out
                            </div>
                            <div className="space-y-1 text-[10px]">
                              {/* Survey (External Competitor Survey) */}
                              {showSurvey && item.hasSurvey && item.surveyCompetitors?.map((sc: any, scIdx: number) => (
                                <div
                                  key={`${sc.namaKompetitor}-${scIdx}`}
                                  className="p-1.5 rounded border flex items-center justify-between"
                                  style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                                >
                                  <div className="flex items-center gap-2 min-w-0 flex-1 mr-1">
                                    <span
                                      className="shrink-0 px-1.5 py-0.5 rounded font-semibold text-[8px] uppercase border"
                                      style={{
                                        background: "#fef2f2",
                                        color: "#dc2626",
                                        borderColor: "#fecaca",
                                      }}
                                    >
                                      Survey
                                    </span>
                                    <span className="truncate font-medium" style={{ color: "var(--color-text)" }} title={sc.namaKompetitor}>
                                      {sc.namaKompetitor}
                                    </span>
                                  </div>
                                  <span className="font-bold shrink-0" style={{ color: "var(--color-text)" }}>
                                    {formatUb(sc.salesForecast)} UB
                                  </span>
                                </div>
                              ))}

                              {/* HealthyOne (Internal Sell Out) */}
                              {showHealthyOne && item.healthyOneUb > 0 && (
                                <div
                                  className="p-1.5 rounded border flex items-center justify-between"
                                  style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                                >
                                  <div className="flex items-center gap-2 min-w-0 flex-1 mr-1">
                                    <span
                                      className="shrink-0 px-1.5 py-0.5 rounded font-semibold text-[8px] uppercase border"
                                      style={{
                                        background: "#e6f4f5",
                                        color: "#026D77",
                                        borderColor: "#a0d7db",
                                      }}
                                    >
                                      HealthyOne
                                    </span>
                                    <span className="truncate font-medium" style={{ color: "var(--color-text)" }}>
                                      HealthyOne Sell Out
                                    </span>
                                  </div>
                                  <span className="font-bold shrink-0" style={{ color: "var(--color-text)" }}>
                                    {formatUb(item.healthyOneUb)} UB
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* 2. SELL IN (All matching B2B products by zat_aktif, excluding this product) */}
                        {showB2B && (
                          <div className="space-y-1 pt-1.5 border-t" style={{ borderColor: "var(--color-border)" }}>
                            <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                              Sell In
                            </div>

                            {item.b2bProducts.length === 0 ? (
                              <div className="p-1.5 rounded border text-[10px] text-center" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>
                                Tidak ada produk lain dengan zat aktif serupa.
                              </div>
                            ) : (
                              <div className="space-y-1">
                                {item.b2bProducts.map((bp: any, bpIdx: number) => {
                                  const formattedQty = formatQtySales(bp.qty_sales ?? bp.qtyUb);
                                  const b2bCode = bp.code || bp.kode || "";
                                  return (
                                    <div
                                      key={`${b2bCode || "b2b"}-${bpIdx}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (b2bCode) onSelectProduct?.(b2bCode);
                                      }}
                                      className="p-1.5 rounded border flex items-center justify-between text-[10px] transition-all cursor-pointer"
                                      style={{
                                        borderColor: bp.isSelected ? "var(--color-success, #16a34a)" : "var(--color-border)",
                                        background: bp.isSelected ? "var(--color-success-bg, #dcfce7)" : "var(--color-bg)",
                                      }}
                                      title={bp.isSelected ? "Sudah dipilih di rencana produk" : "Klik untuk menambahkan produk ini"}
                                    >
                                      <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                                        <span
                                          className="shrink-0 px-1.5 py-0.5 rounded font-semibold text-[8px] uppercase border"
                                          style={{
                                            background: bp.isSelected ? "#16a34a" : "#e0f2fe",
                                            color: bp.isSelected ? "#ffffff" : "#028CD5",
                                            borderColor: bp.isSelected ? "#16a34a" : "#bae6fd",
                                          }}
                                        >
                                          {bp.isSelected ? "✓ Terpilih" : "B2B"}
                                        </span>
                                        <span className="font-medium truncate" style={{ color: "var(--color-text)" }}>
                                          {bp.namaProduk}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <span className="font-bold" style={{ color: "var(--color-text)" }}>
                                          {formattedQty} UB
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Pagination Controls */}
            {totalKompetitorPages > 1 && (
              <div className="flex items-center justify-between pt-2 border-t text-[10px]" style={{ borderColor: "var(--color-border)" }}>
                <button
                  type="button"
                  disabled={kompetitorPage <= 1}
                  onClick={() => setKompetitorPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1 rounded border disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors"
                  style={{ background: "var(--color-surface)", borderColor: "var(--color-border)", color: "var(--color-text)" }}
                >
                  &larr; Prev
                </button>
                <span style={{ color: "var(--color-text-muted)" }}>
                  Halaman {kompetitorPage} dari {totalKompetitorPages}
                </span>
                <button
                  type="button"
                  disabled={kompetitorPage >= totalKompetitorPages}
                  onClick={() => setKompetitorPage((p) => Math.min(totalKompetitorPages, p + 1))}
                  className="px-2.5 py-1 rounded border disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors"
                  style={{ background: "var(--color-surface)", borderColor: "var(--color-border)", color: "var(--color-text)" }}
                >
                  Next &rarr;
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                Histori Sales Counter (SC)
              </p>
            </div>

            {(() => {
              const historyMap = insentifHistory?.data
                ? insentifHistory.data
                : (insentifHistory && typeof insentifHistory === "object" ? insentifHistory : null);
              const entries = historyMap ? Object.entries(historyMap) : [];

              if (entries.length === 0) {
                return (
                  <div className="rounded-lg border p-4 text-center text-xs" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
                    Tidak ada data histori insentif untuk outlet ini.
                  </div>
                );
              }

              return entries.map(([monthKey, items]: [string, any]) => {
                const itemList = Array.isArray(items) ? items : [];
                const monthLabel = formatMonthKey(monthKey);
                const totalTarget = itemList.reduce((sum: number, it: any) => sum + (parseFloat(it.target_sell_in_value ?? it.target ?? it.target_sales ?? 0) || 0), 0);
                const totalActual = itemList.reduce((sum: number, it: any) => sum + (parseFloat(it.realisasi_sell_in_value ?? it.actual ?? it.actual_sales ?? 0) || 0), 0);
                const totalInsentif = itemList.reduce((sum: number, it: any) => sum + (parseFloat(it.total_insentif ?? it.insentif ?? 0) || 0), 0);

                return (
                  <div key={monthKey} className="rounded-lg border space-y-2 p-2.5" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
                    <div className="flex items-center justify-between border-b pb-1.5" style={{ borderColor: "var(--color-border)" }}>
                      <span className="text-[11px] font-bold" style={{ color: "var(--color-text)" }}>
                        {monthLabel}
                      </span>
                    </div>

                    {/* Metric Summary Header Card: Target / Realisasi / Insentif */}
                    <div className="grid grid-cols-3 gap-1 rounded-md p-1.5 text-center" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
                      <div>
                        <div className="text-[8px] uppercase font-semibold" style={{ color: "var(--color-text-faint)" }}>Target</div>
                        <div className="text-[10px] font-bold" style={{ color: "var(--color-text)" }}>
                          {totalTarget > 0 ? formatRp(totalTarget) : "-"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[8px] uppercase font-semibold" style={{ color: "var(--color-text-faint)" }}>Realisasi</div>
                        <div className="text-[10px] font-bold" style={{ color: "var(--color-blue, #2563eb)" }}>
                          {totalActual > 0 ? formatRp(totalActual) : "-"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[8px] uppercase font-semibold" style={{ color: "var(--color-text-faint)" }}>Insentif</div>
                        <div className="text-[10px] font-bold" style={{ color: "var(--color-success, #16a34a)" }}>
                          {totalInsentif > 0 ? formatRp(totalInsentif) : "-"}
                        </div>
                      </div>
                    </div>

                    {/* History Product Items List */}
                    <div className="space-y-1 pt-0.5">
                      {itemList.map((item: any, idx: number) => {
                        const targetVal = parseFloat(item.target_sell_in_value ?? item.target ?? 0) || 0;
                        const realisasiVal = parseFloat(item.realisasi_sell_in_value ?? item.actual ?? 0) || 0;
                        const insentifVal = parseFloat(item.total_insentif ?? item.insentif ?? 0) || 0;
                        return (
                          <div
                            key={idx}
                            className="p-1.5 rounded border text-[10px] leading-tight space-y-0.5"
                            style={{
                              background: "var(--color-bg)",
                              borderColor: "var(--color-border)",
                            }}
                          >
                            <div className="flex justify-between font-medium items-baseline gap-1">
                              <span className="truncate" style={{ color: "var(--color-text)" }}>{item.pro_name || item.namaProduk}</span>
                              <div className="flex items-center gap-1 shrink-0">
                                <span className="font-semibold" style={{ color: "var(--color-success, #16a34a)" }}>{formatRp(insentifVal)}</span>
                              </div>
                            </div>
                            {targetVal > 0 || realisasiVal > 0 ? (
                              <div className="text-[9px]" style={{ color: "var(--color-text-faint)" }}>
                                Target: {formatRp(targetVal)} | Realisasi: {formatRp(realisasiVal)}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>
    </div>
  </>
);
}
