"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { formatCurrency } from "@/lib/format";
import { quarterLabelFromMonths } from "@/lib/quarterUtils";
import type { SalesFigures } from "../types";

export const formatRp = formatCurrency;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest mb-3 pt-1" style={{ color: "var(--color-text-faint)", borderTop: "1px solid var(--color-border)" }}>
      {children}
    </p>
  );
}

function formatPeriode(periode: string) {
  if (periode.length !== 6) return periode;
  const year = periode.slice(0, 4);
  const month = parseInt(periode.slice(4, 6), 10) - 1;
  return new Date(parseInt(year), month).toLocaleString("id-ID", { month: "short", year: "numeric" });
}

export function SalesCounterStatsPanel({
  selectedOutletCount,
  totalOutletCount,
  metrics,
  targetArea = 0,
  targetAreaIsReal = false,
  salesFigures,
  salesIsReal = false,
  quarterMonths,
  totalCoverageScOutlets,
  historyQuarterLabel,
}: {
  selectedOutletCount: number;
  totalOutletCount: number;
  metrics: {
    totalEstimasiSales: number;
    totalHistorySalesQuarter?: number;
    historyQuarterLabel?: string;
    totalNilaiSc: number;
    totalDiskon: number;
    totalCashback: number;
    totalEntertain: number;
    totalBudgetSc: number;
    tercacahEstimasiSales: number;
    tercacahNilaiSc: number;
    monthlyBreakdownMap: Map<string, { estimasiSales: number; nilaiSc: number }>;
    productCount: number;
    personCount: number;
    totalProductEntries: number;
  };
  targetArea?: number;
  targetAreaIsReal?: boolean;
  salesFigures?: SalesFigures;
  salesIsReal?: boolean;
  quarterMonths?: string[];
  totalCoverageScOutlets?: number;
  historyQuarterLabel?: string;
}) {
  const historySalesTotal = metrics.totalHistorySalesQuarter ?? 0;
  const qHistoryLabel = historyQuarterLabel || metrics.historyQuarterLabel || "Kuartal Sebelumnya";

  const MUTED = "var(--color-text-muted)";
  const FAINT = "var(--color-text-faint)";
  const TEXT = "var(--color-text)";
  const BORDER = "var(--color-border)";
  const BG = "var(--color-bg-subtle)";
  const PRIMARY = "var(--color-blue, #2563eb)";

  const monthlySorted = [...metrics.monthlyBreakdownMap.keys()].sort();

  return (
    <Card>
      <div className="flex items-center justify-between mb-5">
        <p className="font-semibold text-base" style={{ color: TEXT }}>Ringkasan POA Sales Counter</p>
        <span className="text-xs px-2 py-0.5 rounded" style={{ background: BG, color: FAINT }}>
          {selectedOutletCount === totalOutletCount
            ? `${totalOutletCount} outlet dipilih`
            : `${selectedOutletCount} dari ${totalOutletCount} outlet`}
        </span>
      </div>

      {/* 2 Kotak Paling Atas: Estimasi Sales Total & History Sales Total */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="rounded-lg p-3 space-y-0.5" style={{ background: BG, border: `1px solid ${BORDER}` }}>
          <p className="text-xs" style={{ color: MUTED }}>Estimasi Sales Total</p>
          <p className="text-xl font-bold leading-tight" style={{ color: TEXT }}>
            {metrics.totalEstimasiSales > 0 ? formatRp(metrics.totalEstimasiSales) : "-"}
          </p>
          <p className="text-[11px]" style={{ color: FAINT }}>Total Estimasi POA</p>
        </div>
        <div className="rounded-lg p-3 space-y-0.5" style={{ background: BG, border: `1px solid ${BORDER}` }}>
          <p className="text-xs" style={{ color: MUTED }}>History Sales Total</p>
          <p className="text-xl font-bold leading-tight" style={{ color: TEXT }}>
            {historySalesTotal > 0 ? formatRp(historySalesTotal) : "-"}
          </p>
          <p className="text-[11px]" style={{ color: FAINT }}>
            {qHistoryLabel ? `Kuartal Lalu (${qHistoryLabel})` : "Kuartal Lalu"}
          </p>
        </div>
      </div>

      {monthlySorted.length > 0 && (
        <div className="mb-5">
          <SectionTitle>Estimasi &amp; Insentif SC per Bulan</SectionTitle>
          <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: FAINT, background: BG }}>
                  <th className="text-left font-medium px-2.5 py-1.5 whitespace-nowrap">Bulan</th>
                  <th className="text-right font-medium px-2 py-1.5 whitespace-nowrap">Estimasi</th>
                  <th className="text-right font-medium px-2.5 py-1.5 whitespace-nowrap">Insentif SC</th>
                </tr>
              </thead>
              <tbody>
                {monthlySorted.map((m) => {
                  const v = metrics.monthlyBreakdownMap.get(m)!;
                  return (
                    <tr key={m} style={{ borderTop: `1px solid ${BORDER}` }}>
                      <td className="px-2.5 py-1.5 whitespace-nowrap" style={{ color: MUTED }}>{formatPeriode(m)}</td>
                      <td className="text-right px-2 py-1.5 tabular-nums whitespace-nowrap" style={{ color: TEXT }}>{v.estimasiSales > 0 ? formatRp(v.estimasiSales) : "-"}</td>
                      <td className="text-right px-2.5 py-1.5 font-semibold tabular-nums whitespace-nowrap" style={{ color: PRIMARY }}>{v.nilaiSc > 0 ? formatRp(v.nilaiSc) : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <SectionTitle>Cakupan Sales Counter</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg p-3 space-y-0.5" style={{ background: BG, border: `1px solid ${BORDER}` }}>
          <p className="text-xs" style={{ color: MUTED }}>Outlet SC</p>
          <p className="text-xl font-bold" style={{ color: TEXT }}>
            {selectedOutletCount}
            <span className="text-xs font-normal ml-1" style={{ color: FAINT }}>Outlet</span>
          </p>
          <p className="text-[11px]" style={{ color: FAINT }}>
            {totalOutletCount > 0 && selectedOutletCount !== totalOutletCount
              ? `${selectedOutletCount} dari ${totalOutletCount} dipilih`
              : "Dari POA diajukan"}
          </p>
        </div>
        <div className="rounded-lg p-3 space-y-0.5" style={{ background: BG, border: `1px solid ${BORDER}` }}>
          <p className="text-xs" style={{ color: MUTED }}>Customer</p>
          <p className="text-xl font-bold" style={{ color: TEXT }}>
            {metrics.personCount}
            <span className="text-xs font-normal ml-1" style={{ color: FAINT }}>Orang</span>
          </p>
          <p className="text-[11px]" style={{ color: FAINT }}>
            Sales Counter
          </p>
        </div>
      </div>
    </Card>
  );
}
