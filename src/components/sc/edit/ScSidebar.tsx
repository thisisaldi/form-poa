"use client";

import { useState } from "react";

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

type SidebarTab = "survey" | "rekomendasi" | "history";

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
        onClick={() => onChange("history")}
        style={pillStyle(SIDEBAR_BLUE, activeTab === "history")}
      >
        Histori SC
      </button>
    </div>
  );
}

export function ScSidebar({
  doctorName,
  productsMenang = [],
  productsInsentif = [],
  insentifHistory,
}: {
  doctorName?: string;
  productsMenang?: any[];
  productsInsentif?: any[];
  insentifHistory?: any;
}) {
  const [activeTab, setActiveTab] = useState<SidebarTab | null>(null);

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
          <div className="space-y-4 animate-fade-in">
            {/* Pernah SC & Menang */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-faint)" }}>
                Pernah SC &amp; Menang
              </p>
              <div className="rounded-lg border p-3 text-xs space-y-2" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
                {productsMenang.length > 0 ? (
                  productsMenang.map((p, i) => {
                    const label = typeof p === "string" ? p : (p.namaProduk || p.pro_name || p.nama_produk || p.name || p.kodeProduk || "Produk");
                    return (
                      <div key={i} className="flex justify-between font-medium">
                        <span>{label}</span>
                        <span style={{ color: "var(--color-success, #16a34a)" }}>★ Menang</span>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-[11px] text-center" style={{ color: "var(--color-text-faint)" }}>
                    Tidak ada produk pernah SC &amp; menang.
                  </p>
                )}
              </div>
            </div>



            {/* Ada Sales & Insentif SC */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-faint)" }}>
                Ada Sales &amp; Insentif SC
              </p>
              <div className="rounded-lg border p-3 text-xs space-y-2" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
                {productsInsentif.length > 0 ? (
                  productsInsentif.map((p, i) => {
                    const label = typeof p === "string" ? p : (p.namaProduk || p.pro_name || p.nama_produk || p.name || p.kodeProduk || "Produk");
                    return (
                      <div key={i} className="flex justify-between font-medium">
                        <span>{label}</span>
                        <span style={{ color: "var(--color-text-muted)" }}>Insentif</span>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-[11px] text-center" style={{ color: "var(--color-text-faint)" }}>
                    Tidak ada produk sales &amp; insentif.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 animate-fade-in">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
              Histori Sales Counter (SC)
            </p>
            {insentifHistory && Object.keys(insentifHistory.data || {}).length > 0 ? (
              Object.entries(insentifHistory.data || {}).map(([monthKey, items]: [string, any]) => (
                <div key={monthKey} className="space-y-2">
                  <div className="text-[11px] font-semibold" style={{ color: "var(--color-text)" }}>
                    {formatMonthKey(monthKey)}
                  </div>
                  <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
                    <table className="w-full text-[11px] text-left" style={{ borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
                          <th className="px-2 py-1.5 font-medium" style={{ color: "var(--color-text-muted)" }}>Produk</th>
                          <th className="px-2 py-1.5 font-medium text-right" style={{ color: "var(--color-text-muted)" }}>Total Insentif</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item: any, idx: number) => (
                          <tr key={idx} style={{ borderBottom: "1px solid var(--color-border)" }}>
                            <td className="px-2 py-2" style={{ color: "var(--color-text)" }}>
                              <div className="font-medium">{item.pro_name}</div>
                              <div className="text-[9px]" style={{ color: "var(--color-text-faint)" }}>{item.pro_code}</div>
                            </td>
                            <td className="px-2 py-2 text-right font-semibold" style={{ color: "var(--color-success, #16a34a)" }}>
                              {formatRp(item.total_insentif)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border p-4 text-center text-xs" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
                Tidak ada data histori insentif untuk outlet ini.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
