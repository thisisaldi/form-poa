"use client";

import { formatQtySales, formatUb } from "../utils/competitorAnalysisUtils";
import { useCompetitorAnalysis } from "./hooks/useCompetitorAnalysis";
import { COMPETITOR_FILTER_TABS } from "./constants/competitorFilterTabs";

interface ProdukKompetitorSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  outletName?: string;
  products: Array<any>;
  selectedCodes?: Set<string>;
  salesOnlineData?: any;
  isLoadingSalesOnline?: boolean;
  periodLabel?: string;
  surveyNexusData?: any;
  healthyOneData?: any[];
}

export function ProdukKompetitorSidebar({
  isOpen,
  onClose,
  outletName,
  products = [],
  selectedCodes = new Set<string>(),
  salesOnlineData,
  isLoadingSalesOnline = false,
  periodLabel,
  surveyNexusData,
  healthyOneData = [],
}: ProdukKompetitorSidebarProps) {
  const {
    kompetitorFilter,
    setKompetitorFilter,
    searchQuery,
    setSearchQuery,
    page,
    setPage,
    paginatedCards,
    totalPages,
    counts,
  } = useCompetitorAnalysis({
    products,
    salesOnlineData,
    selectedCodes,
    surveyNexusData,
    healthyOneData,
  });

  if (!isOpen) return null;

  return (
    <>
      {/* Mobile-only backdrop so on desktop the main page is not dimmed or blurred */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-xs z-40 transition-opacity md:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className="fixed right-0 top-0 bottom-0 z-50 w-[92vw] sm:w-[380px] max-w-[420px] flex flex-col shadow-2xl border-l transition-transform"
        style={{
          background: "var(--color-bg)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Sidebar Header */}
        <div
          className="p-3 sm:px-4 sm:py-3.5 border-b flex items-center justify-between gap-3 shrink-0"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg-subtle)",
          }}
        >
          <div className="min-w-0 flex-1">
            <h3
              className="text-xs font-bold uppercase tracking-wider truncate"
              style={{ color: "var(--color-text)" }}
            >
              Analisis Produk Kompetitor
            </h3>
            {outletName && (
              <p
                className="truncate text-xs font-medium mt-0.5"
                style={{ color: "var(--color-text)" }}
              >
                {outletName}
              </p>
            )}
            <p className="text-[10px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>
              Sumber: Survey, HealthyOne &amp; B2B
            </p>
            {periodLabel && (
              <p className="text-[10px] mt-0.5 font-medium" style={{ color: "var(--color-text-muted)" }}>
                Periode: {periodLabel}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg border text-slate-500 hover:text-slate-800 hover:bg-[var(--color-bg-subtle)] transition-colors cursor-pointer shrink-0 shadow-2xs flex items-center justify-center"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-surface)",
            }}
            title="Tutup panel"
            aria-label="Tutup panel"
          >
            <span className="text-sm font-bold leading-none">✕</span>
          </button>
        </div>

        {/* Filter & Search Bar */}
        <div
          className="p-3 border-b space-y-2.5 shrink-0"
          style={{
            background: "var(--color-bg)",
            borderColor: "var(--color-border)",
          }}
        >
          {/* Search Input */}
          <div className="relative">
            <input
              type="text"
              placeholder="Cari produk SC / zat aktif..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-1.5 pr-7 rounded-lg border outline-none transition-colors text-xs"
              style={{
                background: "var(--color-surface)",
                borderColor: "var(--color-border)",
                color: "var(--color-text)",
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setPage(1);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* Pill Filter Tabs */}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 text-[11px] no-scrollbar">
            {COMPETITOR_FILTER_TABS.map((f) => {
              const isActive = kompetitorFilter === f.id;
              const count = f.id === "b2b" && isLoadingSalesOnline ? "..." : counts[f.id];
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setKompetitorFilter(f.id);
                    setPage(1);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] font-medium transition-all cursor-pointer whitespace-nowrap shadow-2xs"
                  style={{
                    background: isActive ? f.activeBg : "var(--color-surface)",
                    color: isActive ? f.activeText : f.inactiveText,
                    borderColor: isActive ? f.activeBorder : f.inactiveBorder,
                    fontWeight: isActive ? 700 : 500,
                  }}
                >
                  <span>{f.label}</span>
                  <span
                    className="text-[9px] px-1.5 py-0.2 rounded-full font-bold leading-tight"
                    style={{
                      background: isActive ? "rgba(255,255,255,0.25)" : "var(--color-bg-subtle)",
                      color: isActive ? "#ffffff" : f.inactiveText,
                    }}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Cards List (Scrollable) */}
        <div
          className="flex-1 overflow-y-auto p-3 space-y-2.5"
          style={{ background: "var(--color-bg)" }}
        >
          {paginatedCards.length === 0 ? (
            isLoadingSalesOnline && kompetitorFilter === "b2b" ? (
              <div
                className="rounded-lg border p-6 text-center text-xs space-y-2"
                style={{
                  color: "var(--color-text-muted)",
                  borderColor: "var(--color-border)",
                  background: "var(--color-surface)",
                }}
              >
                <div className="inline-block w-5 h-5 border-2 border-[#028CD5] border-t-transparent rounded-full animate-spin" />
                <p>Memuat data Sell In (B2B)...</p>
              </div>
            ) : (
              <div
                className="rounded-lg border p-4 text-center text-xs"
                style={{
                  color: "var(--color-text-faint)",
                  borderColor: "var(--color-border)",
                  background: "var(--color-surface)",
                }}
              >
                Tidak ada produk yang cocok dengan pencarian atau filter ini.
              </div>
            )
          ) : (
          paginatedCards.map((item, idx) => {
            const showSurvey = kompetitorFilter === "semua" || kompetitorFilter === "survey";
            const showHealthyOne =
              kompetitorFilter === "semua" || kompetitorFilter === "healthyone";
            const showB2B = kompetitorFilter === "semua" || kompetitorFilter === "b2b";

            return (
              <div
                key={item.kodeProduk || idx}
                className="rounded-lg border overflow-hidden text-xs flex flex-col justify-between"
                style={{
                  borderColor: item.isSelected
                    ? "rgba(22, 163, 74, 0.4)"
                    : "var(--color-border)",
                  background: "var(--color-surface)",
                  boxShadow: item.isSelected
                    ? "0 0 0 1px rgba(22, 163, 74, 0.25)"
                    : "none",
                }}
              >
                {/* Header Card */}
                <div
                  className="p-2 border-b flex items-start justify-between gap-1.5"
                  style={{
                    background: item.isSelected
                      ? "var(--color-success-bg, #dcfce7)"
                      : "var(--color-bg-subtle)",
                    borderColor: item.isSelected
                      ? "rgba(22, 163, 74, 0.3)"
                      : "var(--color-border)",
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <span
                      className="font-semibold text-[11px] leading-tight block truncate"
                      style={{ color: "var(--color-text)" }}
                      title={item.namaProduk}
                    >
                      {item.namaProduk}
                    </span>
                    <span
                      className="text-[9px] block truncate mt-0.5"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {item.subtitel}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {item.isSelected && (
                      <span
                        className="px-1.5 py-0.5 rounded font-semibold text-[8px] uppercase border"
                        style={{
                          background: "#16a34a",
                          color: "#ffffff",
                          borderColor: "#16a34a",
                        }}
                      >
                        ✓ Diajukan
                      </span>
                    )}
                    <span
                      className="text-[9px] font-bold shrink-0 px-1.5 py-0.5 rounded border"
                      style={{
                        background: item.isSelected ? "#ffffff" : "var(--color-surface)",
                        color: item.isSelected ? "#15803d" : "var(--color-text)",
                        borderColor: item.isSelected
                          ? "#86efac"
                          : "var(--color-border-strong)",
                      }}
                    >
                      Potensi: {item.totalPotensi} UB
                    </span>
                  </div>
                </div>

                {/* Card Body */}
                <div
                  className="p-2 space-y-2 flex-1"
                  style={{ background: "var(--color-surface)" }}
                >
                  {/* 1. SELL OUT */}
                  {(showSurvey || (showHealthyOne && item.healthyOneUb > 0)) && (
                    <div className="space-y-1">
                      <div
                        className="text-[9px] font-bold uppercase tracking-wider"
                        style={{ color: "var(--color-text-faint)" }}
                      >
                        Sell Out
                      </div>
                      <div className="space-y-1 text-[10px]">
                        {/* Survey */}
                        {showSurvey && (
                          item.hasSurvey && item.surveyCompetitors?.length > 0 ? (
                            item.surveyCompetitors.map((sc, scIdx) => (
                              <div
                                key={`${sc.namaKompetitor}-${scIdx}`}
                                className="p-1.5 rounded border flex items-center justify-between gap-1.5"
                                style={{
                                  borderColor: "var(--color-border)",
                                  background: "var(--color-bg)",
                                }}
                              >
                                <div className="flex items-center gap-1.5 min-w-0 flex-1">
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
                                  <span
                                    className="truncate font-medium text-[10px]"
                                    style={{ color: "var(--color-text)" }}
                                    title={sc.namaKompetitor}
                                  >
                                    {sc.namaKompetitor}
                                  </span>
                                </div>
                                <span
                                  className="font-bold shrink-0 text-[10px]"
                                  style={{ color: "var(--color-text)" }}
                                >
                                  {formatUb(sc.salesForecast)} UB
                                </span>
                              </div>
                            ))
                          ) : (
                            <div
                              className="p-1.5 rounded border text-[10px] text-center"
                              style={{
                                borderColor: "var(--color-border)",
                                color: "var(--color-text-muted)",
                                background: "var(--color-bg)",
                              }}
                            >
                              Tidak ada data survey kompetitor.
                            </div>
                          )
                        )}

                        {/* HealthyOne */}
                        {showHealthyOne && item.healthyOneUb > 0 && (
                          <div
                            className="p-1.5 rounded border flex items-center justify-between gap-1.5"
                            style={{
                              borderColor: "var(--color-border)",
                              background: "var(--color-bg)",
                            }}
                          >
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
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
                              <span
                                className="truncate font-medium text-[10px]"
                                style={{ color: "var(--color-text)" }}
                              >
                                HealthyOne Sell Out
                              </span>
                            </div>
                            <span
                              className="font-bold shrink-0 text-[10px]"
                              style={{ color: "var(--color-text)" }}
                            >
                              {formatUb(item.healthyOneUb)} UB
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 2. SELL IN */}
                  {showB2B && (
                    <div
                      className="space-y-1 pt-1.5 border-t"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      <div
                        className="text-[9px] font-bold uppercase tracking-wider"
                        style={{ color: "var(--color-text-faint)" }}
                      >
                        Sell In (B2B)
                      </div>
                      {item.b2bProducts.length === 0 ? (
                        <div
                          className="p-1.5 rounded border text-[10px] text-center"
                          style={{
                            borderColor: "var(--color-border)",
                            color: "var(--color-text-muted)",
                            background: "var(--color-bg)",
                          }}
                        >
                          Tidak ada produk lain dengan zat aktif serupa.
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {item.b2bProducts.map((bp: any, bpIdx: number) => (
                            <div
                              key={`${bp.code || bp.kode || "b2b"}-${bpIdx}`}
                              className="p-1.5 rounded border flex items-center justify-between gap-1.5 text-[10px]"
                              style={{
                                borderColor: "var(--color-border)",
                                background: "var(--color-bg)",
                              }}
                            >
                              <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-1">
                                <span
                                  className="shrink-0 px-1.5 py-0.5 rounded font-semibold text-[8px] uppercase border"
                                  style={{
                                    background: "#e0f2fe",
                                    color: "#028CD5",
                                    borderColor: "#bae6fd",
                                  }}
                                >
                                  B2B
                                </span>
                                <span
                                  className="font-medium truncate text-[10px]"
                                  style={{ color: "var(--color-text)" }}
                                  title={bp.namaProduk}
                                >
                                  {bp.namaProduk}
                                </span>
                              </div>
                              <span
                                className="font-bold shrink-0 text-[10px]"
                                style={{ color: "var(--color-text)" }}
                              >
                                {formatQtySales(bp.qty_sales)} UB
                              </span>
                            </div>
                          ))}
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

      {/* Sidebar Footer Pagination */}
      {totalPages > 1 && (
        <div
          className="p-2.5 px-3 border-t flex items-center justify-between gap-2 shrink-0 text-[11px]"
          style={{
            background: "var(--color-bg-subtle)",
            borderColor: "var(--color-border)",
          }}
        >
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-2 py-0.5 rounded border disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors cursor-pointer text-[10px]"
            style={{
              background: "var(--color-surface)",
              borderColor: "var(--color-border)",
              color: "var(--color-text)",
            }}
          >
            &larr; Prev
          </button>
          <span style={{ color: "var(--color-text-muted)" }}>
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-2 py-0.5 rounded border disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors cursor-pointer text-[10px]"
            style={{
              background: "var(--color-surface)",
              borderColor: "var(--color-border)",
              color: "var(--color-text)",
            }}
          >
            Next &rarr;
          </button>
        </div>
      )}
      </aside>
    </>
  );
}
