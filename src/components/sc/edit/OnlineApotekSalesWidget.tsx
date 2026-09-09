"use client";

import React, { useState, useEffect, useMemo } from "react";
import { getPreviousQuarterInfo } from "@/lib/quarterUtils";
import { getSalesApotekOnlineAction } from "@/app/actions/canvasser";
import type { SalesApotekOnlineItem } from "@/app/(app)/sc/[id]/_services/getSalesApotekOnline";

import type { OnlineApotekSalesWidgetProps } from "./types/widgetTypes";
import { formatRp } from "./utils/formatEditUtils";
import { resolveApotekOnlinePeriod } from "./utils/periodUtils";

export function OnlineApotekSalesWidget({
  poaPeriod,
  outletCode = "",
  isOnline,
  className = "",
}: OnlineApotekSalesWidgetProps) {
  if (isOnline === false) {
    return null;
  }

  const { periodParam, prevQuarterInfo } = useMemo(() => {
    return resolveApotekOnlinePeriod(poaPeriod);
  }, [poaPeriod]);

  const [loading, setLoading] = useState(false);
  const [salesItems, setSalesItems] = useState<SalesApotekOnlineItem[] | null>(null);

  useEffect(() => {
    if (!outletCode) {
      setSalesItems(null);
      return;
    }
    let isMounted = true;
    setLoading(true);

    getSalesApotekOnlineAction(periodParam, outletCode)
      .then((res) => {
        if (isMounted) {
          setSalesItems(res?.data || []);
        }
      })
      .catch((err) => {
        console.error("Error fetching sales apotek online:", err);
        if (isMounted) setSalesItems([]);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [outletCode, periodParam]);

function formatPlatformName(platform: string): { key: string; name: string; labelPrefix: string } {
  const upper = platform.trim().toUpperCase();
  let labelPrefix = upper.charAt(0) + upper.slice(1).toLowerCase();
  if (upper === "SHOPEE") labelPrefix = "Shopee";
  else if (upper === "TIKTOK") labelPrefix = "Tiktok";
  else if (upper === "TOKOPEDIA") labelPrefix = "Tokopedia";
  return { key: upper, name: upper, labelPrefix };
}

  const { platforms, totalPiSales, totalAllSales } = useMemo(() => {
    if (!salesItems || salesItems.length === 0) {
      return { platforms: [], totalPiSales: 0, totalAllSales: 0 };
    }

    const platformMap = new Map<string, { pi: number; nonPi: number }>();

    for (const item of salesItems) {
      const rawPlatform = (item.FlagServicedBy || "").trim().toUpperCase();
      if (!rawPlatform) continue;

      if (!platformMap.has(rawPlatform)) {
        platformMap.set(rawPlatform, { pi: 0, nonPi: 0 });
      }

      const current = platformMap.get(rawPlatform)!;
      const isNonPi = (item.type || "").trim().toUpperCase() === "NON_PI";
      const val = Number(item.total) || 0;

      if (isNonPi) {
        current.nonPi += val;
      } else {
        current.pi += val;
      }
    }

    let sumPi = 0;
    let sumAll = 0;

    const STANDARD_ORDER = ["SHOPEE", "TIKTOK", "TOKOPEDIA"];

    const list = Array.from(platformMap.entries())
      .map(([key, data]) => {
        const { name, labelPrefix } = formatPlatformName(key);
        const total = data.pi + data.nonPi;
        sumPi += data.pi;
        sumAll += total;

        return {
          id: key,
          name,
          labelPrefix,
          pi: data.pi,
          nonPi: data.nonPi,
          total,
        };
      })
      .filter((p) => p.total > 0)
      .sort((a, b) => {
        const idxA = STANDARD_ORDER.indexOf(a.name);
        const idxB = STANDARD_ORDER.indexOf(b.name);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.name.localeCompare(b.name);
      });

    return { platforms: list, totalPiSales: sumPi, totalAllSales: sumAll };
  }, [salesItems]);

  return (
    <div
      className={`rounded-lg border p-3 transition-all ${className}`}
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-surface)",
      }}
    >
      {/* Header matching form section titles */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2.5 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-text-muted)" }}
          >
            Sales Apotek Online
          </span>
          <span
            className="text-[11px] font-medium px-2 py-0.5 rounded border"
            style={{
              background: "var(--color-bg-subtle)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-muted)",
            }}
          >
            Periode: {prevQuarterInfo.label}
          </span>
          {loading && (
            <span className="text-[10px] animate-pulse" style={{ color: "var(--color-text-faint)" }}>
              Memuat data...
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs flex-wrap">
          <div className="flex items-center gap-1.5">
            <span style={{ color: "var(--color-text-muted)" }}>Total All (B2B + PI) / Bln:</span>
            <span className="font-bold" style={{ color: "var(--color-text)" }}>
              {formatRp(totalAllSales)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span style={{ color: "var(--color-text-muted)" }}>Total PI / Bln:</span>
            <span className="font-bold" style={{ color: "var(--color-text)" }}>
              {formatRp(totalPiSales)}
            </span>
          </div>
        </div>
      </div>

      {/* Loading indicator */}
      {loading && !salesItems && (
        <div className="text-center py-4 text-xs" style={{ color: "var(--color-text-faint)" }}>
          Mengambil data sales apotek online...
        </div>
      )}

      {/* Empty State */}
      {!loading && (!salesItems || salesItems.length === 0) && (
        <div
          className="rounded-md border p-3 text-center text-xs"
          style={{ borderColor: "var(--color-border)", color: "var(--color-text-faint)" }}
        >
          Tidak ada data penjualan apotek online untuk outlet ini pada periode {prevQuarterInfo.shortLabel}.
        </div>
      )}

      {/* Platform Cards: hanya muncul platform yang memiliki data */}
      {platforms.length > 0 && (
        <div
          className={`grid gap-2.5 ${
            platforms.length === 1
              ? "grid-cols-1 max-w-sm"
              : platforms.length === 2
              ? "grid-cols-1 md:grid-cols-2"
              : "grid-cols-1 md:grid-cols-3"
          }`}
        >
          {platforms.map((platform) => (
            <div
              key={platform.id}
              className="rounded-md border overflow-hidden"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-bg-subtle)",
              }}
            >
              {/* Platform Header */}
              <div
                className="px-2.5 py-1.5 border-b flex items-center justify-between"
                style={{
                  borderColor: "var(--color-border)",
                  background: "rgba(0,0,0,0.02)",
                }}
              >
                <span
                  className="text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "var(--color-text)" }}
                >
                  {platform.name}
                </span>
                <span
                  className="text-xs font-bold"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {formatRp(platform.total)}
                </span>
              </div>

              {/* Platform Rows: PI & Non PI */}
              <div className="p-2 space-y-1.5 text-xs">
                <div className="flex items-center justify-between py-0.5">
                  <span
                    className="text-xs font-medium"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {platform.labelPrefix} PI
                  </span>
                  <span
                    className="text-xs font-bold"
                    style={{ color: "var(--color-text)" }}
                  >
                    {formatRp(platform.pi)}
                  </span>
                </div>

                <div className="flex items-center justify-between py-0.5">
                  <span
                    className="text-xs font-medium"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {platform.labelPrefix} Non PI
                  </span>
                  <span
                    className="text-xs font-bold"
                    style={{ color: "var(--color-text)" }}
                  >
                    {formatRp(platform.nonPi)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
