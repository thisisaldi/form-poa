"use client";

import React from "react";
import type { PosmRecord } from "@/app/(app)/sc/[id]/_services/getPosmNexus";
import { formatRpNumber as formatRp } from "./utils/formatEditUtils";

export interface PosmMobileViewProps {
  loading: boolean;
  uniqueRecords: PosmRecord[];
  totalKomisi: number;
}

export function PosmMobileView({
  loading,
  uniqueRecords,
  totalKomisi,
}: PosmMobileViewProps) {
  const formatPeriodLabel = (item: PosmRecord) => {
    const toYearMonth = (str?: string) => {
      if (!str) return "";
      const cleaned = str.replace(/[^0-9]/g, "");
      if (cleaned.length >= 6) return cleaned.slice(0, 6);
      return str;
    };

    const start = toYearMonth(item.period || item.placementDate);
    const end = toYearMonth(item.end_period);

    if (start && end) {
      return `${start} - ${end}`;
    }
    return start || end || "-";
  };

  if (loading) {
    return (
      <div
        className="rounded-xl border p-4 text-center text-xs animate-pulse"
        style={{ borderColor: "var(--color-border)", color: "var(--color-text-faint)" }}
      >
        Sedang memuat data POSM dari Nexus...
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {/* POSM Cards List */}
      <div className="space-y-2">
        {uniqueRecords.map((item, idx) => (
          <div
            key={idx}
            className="rounded-xl border p-3 flex items-center justify-between gap-3 text-xs shadow-2xs"
            style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}
          >
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-xs truncate" style={{ color: "var(--color-text)" }}>
                {item.visibilityName || item.brand || "-"}
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                Periode: {formatPeriodLabel(item)}
              </div>
            </div>

            <div className="text-right shrink-0 whitespace-nowrap">
              <div className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                Komisi:
              </div>
              <div className="font-bold text-xs" style={{ color: "var(--color-blue, #2563eb)" }}>
                Rp&nbsp;{formatRp(Number(item.value) || 0)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Total Footer Card */}
      {uniqueRecords.length > 0 && (
        <div
          className="rounded-xl border p-3 flex items-center justify-between text-xs font-bold shadow-2xs"
          style={{ background: "rgba(59, 130, 246, 0.04)", borderColor: "var(--color-border)" }}
        >
          <span style={{ color: "var(--color-text)" }}>Total Komisi POSM</span>
          <span className="text-sm whitespace-nowrap" style={{ color: "var(--color-blue, #2563eb)" }}>
            Rp&nbsp;{formatRp(totalKomisi)}
          </span>
        </div>
      )}
    </div>
  );
}
