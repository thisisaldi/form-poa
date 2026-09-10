"use client";

import React, { useState, useEffect, useMemo } from "react";
import { getPosmNexusAction } from "@/app/actions/canvasser";
import type { PosmResponse, PosmRecord } from "@/app/(app)/sc/[id]/_services/getPosmNexus";
import type { PosmTableProps } from "./types/widgetTypes";
import { parseBlastInPeriod, getQuarterPeriodMonths } from "./utils/periodUtils";
import { formatRpNumber as formatRp } from "./utils/formatEditUtils";

export function PosmTable({
  poaPeriod = "2026-Q3",
  quarter,
  outletId,
  onTotalValueChange,
}: PosmTableProps) {
  const { qNum, yearNum } = parseBlastInPeriod(poaPeriod, quarter);
  const periods = useMemo(() => getQuarterPeriodMonths(yearNum, qNum), [yearNum, qNum]);

  const [loading, setLoading] = useState(false);
  const [posmData, setPosmData] = useState<PosmResponse | null>(null);

  useEffect(() => {
    if (!outletId) {
      setPosmData(null);
      if (onTotalValueChange) onTotalValueChange(0);
      return;
    }

    let isMounted = true;
    setLoading(true);

    getPosmNexusAction(outletId, periods)
      .then((res) => {
        if (!isMounted) return;
        setPosmData(res || null);
      })
      .catch((err) => {
        console.error("Error fetching POSM data in PosmTable:", err);
        if (isMounted) setPosmData(null);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [outletId, JSON.stringify(periods)]);

  // Deduplicate records across months
  const uniqueRecords = useMemo(() => {
    if (!posmData?.data || !Array.isArray(posmData.data)) return [];

    const map = new Map<string, PosmRecord>();

    for (const list of posmData.data) {
      if (!Array.isArray(list.records)) continue;
      for (const rec of list.records) {
        // Unique key by brand, visibilityName, placementDate, end_period
        const key = `${rec.brand || ""}|${rec.visibilityName || ""}|${rec.placementDate || ""}|${rec.end_period || ""}`;
        if (!map.has(key)) {
          map.set(key, rec);
        }
      }
    }

    return Array.from(map.values());
  }, [posmData]);

  const totalKomisi = useMemo(() => {
    return uniqueRecords.reduce((sum, r) => sum + (Number(r.value) || 0), 0);
  }, [uniqueRecords]);

  useEffect(() => {
    if (onTotalValueChange) {
      onTotalValueChange(totalKomisi);
    }
  }, [totalKomisi, onTotalValueChange]);

  // Jika sudah selesai loading dan tidak ada data penempatan POSM, sembunyikan seluruh komponen POSM
  if (!loading && uniqueRecords.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 mt-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-wide" style={{ color: "var(--color-text)" }}>
            POSM (Q{qNum} {yearNum})
          </span>
          {loading && (
            <span className="text-[10px] animate-pulse" style={{ color: "var(--color-text-faint)" }}>
              Memuat data POSM...
            </span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
        <table className="w-full text-xs text-center border-collapse min-w-[360px]">
          <thead>
            <tr style={{ background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap text-left" style={{ color: "var(--color-text-muted)", width: "40%" }}>
                NAMA POSM
              </th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: "var(--color-text-muted)", width: "35%" }}>
                PERIODE
              </th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap text-right" style={{ color: "var(--color-text-muted)", width: "25%" }}>
                KOMISI
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} className="px-4 py-4 text-center" style={{ color: "var(--color-text-faint)" }}>
                  <span className="animate-pulse">Sedang memuat data POSM dari Nexus...</span>
                </td>
              </tr>
            ) : (
              uniqueRecords.map((item, idx) => {
                const formatPeriodLabel = () => {
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

                return (
                  <tr key={idx} style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <td className="px-4 py-3 text-left font-medium" style={{ color: "var(--color-text)" }}>
                      <div>{item.visibilityName || item.brand || "-"}</div>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
                      {formatPeriodLabel()}
                    </td>
                    <td className="px-4 py-3 text-right font-medium whitespace-nowrap" style={{ color: "var(--color-blue, #2563eb)" }}>
                      Rp {formatRp(Number(item.value) || 0)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {uniqueRecords.length > 0 && (
            <tfoot>
              <tr style={{ background: "var(--color-bg-subtle)", borderTop: "1px solid var(--color-border)" }}>
                <td colSpan={2} className="px-4 py-2 text-left font-semibold text-[11px]" style={{ color: "var(--color-text)" }}>
                  Total Komisi POSM
                </td>
                <td className="px-4 py-2 text-right font-bold text-xs" style={{ color: "var(--color-blue, #2563eb)" }}>
                  Rp {formatRp(totalKomisi)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
