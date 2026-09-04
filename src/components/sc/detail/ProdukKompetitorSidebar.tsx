"use client";

import { useState, useMemo } from "react";
import {
  getProductPotensiDetail,
  formatQtySales,
  type ProductPotensiDetail,
} from "../utils/competitorAnalysisUtils";

interface ProdukKompetitorSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  outletName?: string;
  products: Array<any>;
  selectedCodes?: Set<string>;
  salesOnlineData?: any;
  periodLabel?: string;
}

export function ProdukKompetitorSidebar({
  isOpen,
  onClose,
  outletName,
  products = [],
  selectedCodes = new Set<string>(),
  salesOnlineData,
  periodLabel,
}: ProdukKompetitorSidebarProps) {
  const [kompetitorFilter, setKompetitorFilter] = useState<string>("semua");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [page, setPage] = useState<number>(1);

  const salesOnlineItems = useMemo(() => {
    if (Array.isArray(salesOnlineData?.data)) return salesOnlineData.data;
    if (Array.isArray(salesOnlineData)) return salesOnlineData;
    return [];
  }, [salesOnlineData]);

  // Build card details for all products (from get-sales-counter-product)
  const cards: Array<
    ProductPotensiDetail & {
      subtitel: string;
      surveyDisplay: string;
      hasSurvey: boolean;
      hasHealthyOne: boolean;
      hasB2b: boolean;
      isSelected: boolean;
    }
  > = useMemo(() => {
    return products.map((p) => {
      const detail = getProductPotensiDetail(p, salesOnlineItems);
      const code = detail.kodeProduk;
      const stripped = code.replace(/^0+/, "");
      const isSelected = selectedCodes.has(code) || selectedCodes.has(stripped);
      const subtitel = `${code} · ${detail.zatAktif || detail.namaProduk}`;
      const surveyDisplay = `${detail.surveyQty} UB`;
      return {
        ...detail,
        subtitel,
        surveyDisplay,
        hasSurvey: Boolean(detail.surveyName),
        hasHealthyOne: detail.healthyOneUb > 0,
        hasB2b: detail.b2bProducts.length > 0,
        isSelected,
      };
    });
  }, [products, salesOnlineItems, selectedCodes]);

  // Filter cards by pill tabs and search query
  const filteredCards = useMemo(() => {
    let list = cards;
    if (kompetitorFilter === "survey") {
      list = list.filter((c) => c.hasSurvey);
    } else if (kompetitorFilter === "healthyone") {
      list = list.filter((c) => c.hasHealthyOne);
    } else if (kompetitorFilter === "b2b") {
      list = list.filter((c) => c.hasB2b);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (c) =>
          c.namaProduk.toLowerCase().includes(q) ||
          c.kodeProduk.toLowerCase().includes(q) ||
          c.zatAktif.toLowerCase().includes(q) ||
          (c.surveyName || "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [cards, kompetitorFilter, searchQuery]);

  const ITEMS_PER_PAGE = 4;
  const totalPages = Math.max(1, Math.ceil(filteredCards.length / ITEMS_PER_PAGE));
  const paginatedCards = useMemo(() => {
    const start = (page - 1) * ITEMS_PER_PAGE;
    return filteredCards.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredCards, page]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: 0,
        top: 0,
        bottom: 0,
        zIndex: 50,
        width: 320,
        background: "var(--color-bg)",
        borderLeft: "1px solid var(--color-border)",
        display: "flex",
        flexDirection: "column",
        boxShadow: "-4px 0 20px rgba(0,0,0,0.08)",
      }}
    >
      {/* Sidebar Header */}
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexShrink: 0,
          background: "var(--color-bg-subtle)",
        }}
      >
        <div className="min-w-0 flex-1">
          <h3
            className="text-[11px] font-bold uppercase tracking-wider truncate"
            style={{ color: "var(--color-text)" }}
          >
            Analisis Produk Kompetitor
          </h3>
          {outletName && (
            <p
              className="truncate text-xs font-semibold mt-0.5"
              style={{ color: "var(--color-text)" }}
            >
              {outletName}
            </p>
          )}
          <p className="text-[10px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>
            Sumber: Survey, HealthyOne &amp; B2B {periodLabel ? `· Periode: ${periodLabel}` : ""}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            color: "var(--color-text-faint)",
            fontSize: 18,
            lineHeight: 1,
            padding: "3px 6px",
            cursor: "pointer",
            flexShrink: 0,
            borderRadius: 6,
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
          }}
          title="Tutup helper"
        >
          ›
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div
        className="p-3 border-b space-y-2 shrink-0"
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
            className="w-full px-2.5 py-1.5 rounded-lg border outline-none transition-colors text-xs"
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
        <div className="flex gap-1 overflow-x-auto pb-0.5 text-[11px]">
          {[
            { id: "semua", label: "Semua", activeBg: "#7c3aed" },
            { id: "survey", label: "Survey", activeBg: "#dc2626" },
            { id: "healthyone", label: "HealthyOne", activeBg: "#026D77" },
            { id: "b2b", label: "B2B", activeBg: "#028CD5" },
          ].map((f) => {
            const isActive = kompetitorFilter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setKompetitorFilter(f.id);
                  setPage(1);
                }}
                className="px-2.5 py-0.5 rounded-full border transition-all cursor-pointer whitespace-nowrap text-[10px] font-semibold"
                style={{
                  background: isActive ? f.activeBg : "var(--color-surface)",
                  color: isActive ? "#ffffff" : "var(--color-text-muted)",
                  borderColor: isActive ? f.activeBg : "var(--color-border)",
                }}
              >
                {f.label}
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
                  {((showSurvey && item.hasSurvey) || (showHealthyOne && item.healthyOneUb > 0)) && (
                    <div className="space-y-1">
                      <div
                        className="text-[9px] font-bold uppercase tracking-wider"
                        style={{ color: "var(--color-text-faint)" }}
                      >
                        Sell Out
                      </div>
                      <div className="space-y-1 text-[10px]">
                        {/* Survey */}
                        {showSurvey && item.hasSurvey && (
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
                                title={item.surveyName}
                              >
                                {item.surveyName}
                              </span>
                            </div>
                            <span
                              className="font-bold shrink-0 text-[10px]"
                              style={{ color: "var(--color-text)" }}
                            >
                              {item.surveyDisplay}
                            </span>
                          </div>
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
                              {item.healthyOneUb} UB
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
                          {item.b2bProducts.map((bp: any) => (
                            <div
                              key={bp.code}
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
    </div>
  );
}
