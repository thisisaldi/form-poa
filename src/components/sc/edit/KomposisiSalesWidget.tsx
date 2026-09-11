"use client";

import React from "react";

interface KomposisiSalesWidgetProps {
  onlinePct?: number;
  offlinePct?: number;
  className?: string;
}

export function KomposisiSalesWidget({
  onlinePct = 50,
  offlinePct = 50,
  className = "",
}: KomposisiSalesWidgetProps) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 flex items-center justify-between gap-3 shadow-xs ${className}`}
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-surface)",
      }}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--color-text)" }}>
        <span>Komposisi Sales</span>
      </div>

      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold"
          style={{
            background: "rgba(59, 130, 246, 0.12)",
            color: "#2563eb",
            border: "1px solid rgba(59, 130, 246, 0.25)",
          }}
        >
          Online: {onlinePct}%
        </span>
        <span
          className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold"
          style={{
            background: "rgba(100, 116, 139, 0.12)",
            color: "#475569",
            border: "1px solid rgba(100, 116, 139, 0.25)",
          }}
        >
          Offline: {offlinePct}%
        </span>
      </div>
    </div>
  );
}
