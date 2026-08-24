"use client";

import { useState, useMemo } from "react";

function formatRp(val: number) {
  return "Rp " + Math.round(val).toLocaleString("id-ID");
}

function formatMonthKey(key: string) {
  if (key.length !== 6) return key;
  const year = key.slice(0, 4);
  const month = parseInt(key.slice(4, 6), 10);
  const MONTH_NAMES = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

const SIDEBAR_ORANGE = "var(--color-orange, #ea580c)";
const SIDEBAR_BLUE = "var(--color-blue, #0063a0)";
const SIDEBAR_GREEN = "var(--color-success, #16a34a)";
const SIDEBAR_PURPLE = "#7c3aed";

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

type SidebarTab = "survey" | "rekomendasi" | "loss_sales" | "history";

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
        onClick={() => onChange("survey")}
        style={pillStyle(SIDEBAR_ORANGE, activeTab === "survey")}
      >
        Data Survey
      </button>
      <button
        type="button"
        onClick={() => onChange("rekomendasi")}
        style={pillStyle(SIDEBAR_GREEN, activeTab === "rekomendasi")}
      >
        Produk Rekomendasi
      </button>
      <button
        type="button"
        onClick={() => onChange("loss_sales")}
        style={pillStyle(SIDEBAR_PURPLE, activeTab === "loss_sales")}
      >
        Potensi Sales
      </button>
      <button
        type="button"
        onClick={() => onChange("history")}
        style={pillStyle(SIDEBAR_BLUE, activeTab === "history")}
      >
        Histori SC
      </button>
    </div>
  );
}

function getHnaForProduct(code: string, masterProducts: any[]): number {
  if (!code || !Array.isArray(masterProducts) || masterProducts.length === 0) return 0;
  const cleanCode = String(code).trim();
  const strippedCode = cleanCode.replace(/^0+/, "");

  const item = masterProducts.find((p: any) => {
    const pCode = String(p.kodeProduk || p.pro_code || p.product_code || "").trim();
    if (pCode === cleanCode) return true;
    if (pCode.replace(/^0+/, "") === strippedCode) return true;
    return false;
  });

  if (!item) return 0;
  const rawHna = item.hna;
  const num = typeof rawHna === "number" ? rawHna : parseFloat(String(rawHna || "0"));
  return isNaN(num) ? 0 : num;
}

export function ScSidebar({
  doctorName,
  productsMenang = [],
  productsInsentif = [],
  insentifHistory,
  rekomendasiProduk = [],
  masterProducts = [],
  selectedProductCodes = new Set<string>(),
  onSelectProduct,
}: {
  doctorName?: string;
  productsMenang?: any[];
  productsInsentif?: any[];
  insentifHistory?: any;
  rekomendasiProduk?: any[];
  masterProducts?: any[];
  selectedProductCodes?: Set<string>;
  onSelectProduct?: (code: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<SidebarTab | null>(null);

  const recommendationList = useMemo(() => {
    const map = new Map<
      string,
      {
        code: string;
        name: string;
        insentifValue?: number;
        avgInsentif?: number;
        avgSellout?: number;
        totalSellout?: number;
        activePeriods?: number[];
        pct?: string;
        period?: string;
      }
    >();

    const processItem = (item: any) => {
      if (!item) return;
      const code = typeof item === "string"
        ? item
        : String(item.pro_code || item.kode_item || item.kodeProduk || item.code || "").trim();
      const name = typeof item === "string"
        ? item
        : (item.pro_name || item.namaProduk || item.nama_produk || item.name || code);
      const insentif = typeof item === "object"
        ? (item.total_insentif ?? item.insentif ?? item.sales_counter_value)
        : undefined;
      const avgInsentif = typeof item === "object" ? item.average_insentif : undefined;
      const avgSellout = typeof item === "object" ? item.average_sellout : undefined;
      const totalSellout = typeof item === "object" ? item.total_sellout : undefined;
      const activePeriods = typeof item === "object" ? item.active_periods : undefined;
      const pct = typeof item === "object" ? (item.pct || item.pelunasan) : undefined;
      const period = typeof item === "object" ? (item.period || item.periode) : undefined;

      const key = code || name;
      if (key && !map.has(key)) {
        map.set(key, {
          code,
          name,
          insentifValue: insentif != null ? Number(insentif) : undefined,
          avgInsentif: avgInsentif != null ? Number(avgInsentif) : undefined,
          avgSellout: avgSellout != null ? Number(avgSellout) : undefined,
          totalSellout: totalSellout != null ? Number(totalSellout) : undefined,
          activePeriods: Array.isArray(activePeriods) ? activePeriods : undefined,
          pct,
          period,
        });
      }
    };

    for (const item of productsMenang) {
      processItem(item);
    }
    for (const item of productsInsentif) {
      processItem(item);
    }

    return Array.from(map.values());
  }, [productsMenang, productsInsentif]);

  const sortedLossSalesProducts = useMemo(() => {
    if (!Array.isArray(rekomendasiProduk)) return [];
    return [...rekomendasiProduk]
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
      <div
        style={{
          position: "fixed",
          right: 0,
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: 40,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab("survey")}
          style={sidebarEdgeTabStyle(SIDEBAR_ORANGE)}
        >
          Data Survey
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("rekomendasi")}
          style={sidebarEdgeTabStyle(SIDEBAR_GREEN)}
        >
          Produk Rekomendasi
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("loss_sales")}
          style={sidebarEdgeTabStyle(SIDEBAR_PURPLE)}
        >
          Potensi Sales
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("history")}
          style={sidebarEdgeTabStyle(SIDEBAR_BLUE)}
        >
          Histori SC
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        right: 0,
        top: 0,
        bottom: 0,
        zIndex: 40,
        width: 300,
        background: "var(--color-bg)",
        borderLeft: "1px solid var(--color-border)",
        display: "flex",
        flexDirection: "column",
        boxShadow: "-4px 0 16px rgba(0,0,0,0.06)",
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
          style={{
            color: "var(--color-text-faint)",
            fontSize: 18,
            lineHeight: 1,
            padding: "0 2px",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          ›
        </button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 14 }} className="space-y-4">
        {activeTab === "survey" ? (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-faint)" }}>
              Data Survey Nexus
            </p>
            <div className="rounded-lg border p-4 text-center text-xs" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
              Belum ada data survey untuk outlet ini.
            </div>
          </div>
        ) : activeTab === "rekomendasi" ? (
          <div className="space-y-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                PERNAH SC ({recommendationList.length})
              </p>
            </div>
            {recommendationList.length > 0 ? (
              <div className="space-y-1.5">
                {recommendationList.map((item, i) => {
                  const targetCode = item.code || item.name;
                  const isSelected = (item.code && selectedProductCodes.has(item.code)) || (item.name && selectedProductCodes.has(item.name));
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
                            {item.name}
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

                      <div className="flex items-center gap-1.5 text-[9px] flex-wrap pt-0.5">
                        {item.avgSellout != null && (
                          <span
                            className="font-medium px-1.5 py-0.5 rounded"
                            style={{ background: "var(--color-blue-light, #eff6ff)", color: "var(--color-blue, #2563eb)" }}
                          >
                            Avg Sellout: {item.avgSellout}
                          </span>
                        )}
                        {item.avgInsentif != null && (
                          <span
                            className="font-medium px-1.5 py-0.5 rounded"
                            style={{ background: "var(--color-success-bg, #dcfce7)", color: "var(--color-success, #16a34a)" }}
                          >
                            Avg Insentif: {formatRp(item.avgInsentif)}
                          </span>
                        )}
                        {item.insentifValue != null && item.avgInsentif == null && (
                          <span
                            className="font-medium px-1.5 py-0.5 rounded"
                            style={{ background: "var(--color-success-bg, #dcfce7)", color: "var(--color-success, #16a34a)" }}
                          >
                            Insentif: {formatRp(item.insentifValue)}
                          </span>
                        )}
                        {item.activePeriods && item.activePeriods.length > 0 && (
                          <span className="text-[9px]" style={{ color: "var(--color-text-faint)" }}>
                            Periode: {item.activePeriods.join(", ")}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border p-4 text-center text-xs" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
                Tidak ada produk rekomendasi untuk outlet ini.
              </div>
            )}
          </div>
        ) : activeTab === "loss_sales" ? (
          <div className="space-y-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                POTENSI SALES ({sortedLossSalesProducts.length})
              </p>
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
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "var(--color-blue-light, #eff6ff)", color: "var(--color-blue, #2563eb)" }}>
                        SC Active
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
  );
}
