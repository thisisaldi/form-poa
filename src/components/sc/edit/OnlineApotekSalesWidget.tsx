"use client";

import React, { useMemo } from "react";
import { getPreviousQuarterInfo } from "@/lib/quarterUtils";

interface OnlineApotekSalesWidgetProps {
  poaPeriod?: string | null;
  outletCode?: string | null;
  outletName?: string | null;
  className?: string;
}

function formatRp(val: number): string {
  return "Rp " + Math.round(val || 0).toLocaleString("id-ID");
}

export function OnlineApotekSalesWidget({
  poaPeriod,
  outletCode = "",
  outletName = "",
  className = "",
}: OnlineApotekSalesWidgetProps) {
  const prevQuarter = useMemo(() => {
    return getPreviousQuarterInfo(poaPeriod);
  }, [poaPeriod]);

  // Deterministic dummy values based on outletCode/outletName matching the screenshot
  const salesData = useMemo(() => {
    const seedStr = `${outletCode || ""}_${outletName || ""}`;
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
      hash = (hash << 5) - hash + seedStr.charCodeAt(i);
      hash |= 0;
    }
    const abs = Math.abs(hash);

    const shopeePi = 17900000;
    const shopeeNonPi = 4850000;

    const tiktokPi = 13250000;
    const tiktokNonPi = 3250000;

    const tokopediaPi = 15800000;
    const tokopediaNonPi = 9200000;

    const total =
      shopeePi + shopeeNonPi + tiktokPi + tiktokNonPi + tokopediaPi + tokopediaNonPi;

    return {
      total,
      platforms: [
        {
          id: "shopee",
          name: "SHOPEE",
          total: shopeePi + shopeeNonPi,
          items: [
            { label: "Shopee PI", value: shopeePi },
            { label: "Shopee Non PI", value: shopeeNonPi },
          ],
        },
        {
          id: "tiktok",
          name: "TIKTOK",
          total: tiktokPi + tiktokNonPi,
          items: [
            { label: "TikTok PI", value: tiktokPi },
            { label: "TikTok Non PI", value: tiktokNonPi },
          ],
        },
        {
          id: "tokopedia",
          name: "TOKOPEDIA",
          total: tokopediaPi + tokopediaNonPi,
          items: [
            { label: "Tokopedia PI", value: tokopediaPi },
            { label: "Tokopedia Non PI", value: tokopediaNonPi },
          ],
        },
      ],
    };
  }, [outletCode, outletName]);

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
            className="text-[10px] font-bold px-1.5 py-0.5 rounded tracking-wide"
            style={{
              background: "rgba(245, 158, 11, 0.12)",
              color: "#d97706",
              border: "1px solid rgba(245, 158, 11, 0.3)",
            }}
          >
            (DUMMY)
          </span>
          <span
            className="text-[11px] font-medium px-2 py-0.5 rounded border"
            style={{
              background: "var(--color-bg-subtle)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-muted)",
            }}
          >
            Periode: {prevQuarter.label}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span style={{ color: "var(--color-text-muted)" }}>Total PI Online:</span>
          <span className="font-bold" style={{ color: "var(--color-text)" }}>
            {formatRp(salesData.total)}
          </span>
        </div>
      </div>

      {/* 3 Columns matching form font & styling */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        {salesData.platforms.map((platform) => (
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

            {/* Platform Rows */}
            <div className="p-2 space-y-1.5 text-xs">
              {platform.items.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between py-0.5"
                >
                  <span
                    className="text-xs font-medium"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {item.label}
                  </span>
                  <span
                    className="text-xs font-bold"
                    style={{ color: "var(--color-text)" }}
                  >
                    {formatRp(item.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
