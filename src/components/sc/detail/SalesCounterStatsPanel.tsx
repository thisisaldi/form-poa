"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { formatCurrency } from "@/lib/format";
import { quarterLabelFromMonths } from "@/lib/quarterUtils";
import type { SalesFigures } from "../types";

export const formatRp = formatCurrency;

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
    </div>
  );
}

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
  targetArea,
  targetAreaIsReal = false,
  salesFigures,
  salesIsReal = false,
  quarterMonths,
}: {
  selectedOutletCount: number;
  totalOutletCount: number;
  metrics: {
    totalEstimasiSales: number;
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
  targetArea: number;
  targetAreaIsReal?: boolean;
  salesFigures: SalesFigures;
  salesIsReal?: boolean;
  quarterMonths: string[];
}) {
  const [salesOpen, setSalesOpen] = useState(false);
  const qLabel = quarterLabelFromMonths(quarterMonths);

  const ratioEst = targetArea > 0 ? (metrics.tercacahEstimasiSales / targetArea) * 100 : 0;
  const salesPlusEst = salesFigures.salesYtd + metrics.totalEstimasiSales;
  const achievePct = targetArea > 0 ? (salesPlusEst / targetArea) * 100 : 0;

  const DANGER = "var(--color-danger, #dc2626)";
  const MUTED = "var(--color-text-muted)";
  const FAINT = "var(--color-text-faint)";
  const TEXT = "var(--color-text)";
  const BORDER = "var(--color-border)";
  const BG = "var(--color-bg-subtle)";
  const PRIMARY = "var(--color-blue, #2563eb)";

  const monthlySorted = [...metrics.monthlyBreakdownMap.keys()].sort();

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <p className="font-semibold text-base" style={{ color: TEXT }}>Ringkasan POA Sales Counter</p>
        <span className="text-xs px-2 py-0.5 rounded" style={{ background: BG, color: FAINT }}>
          {selectedOutletCount === totalOutletCount
            ? `${totalOutletCount} outlet dipilih`
            : `${selectedOutletCount} dari ${totalOutletCount} outlet`}
        </span>
      </div>

      {/* 1. Full Periode vs Tercacah */}
      <div className="mb-5 space-y-3">
        {[
          {
            title: "Full Periode SC",
            rows: [{ label: "Total Rencana SC", estimasi: metrics.totalEstimasiSales, nilai: metrics.totalNilaiSc, bold: true }],
          },
          {
            title: `Tercacah SC (Kuartal ${qLabel})`,
            rows: [{ label: `Tercacah Kuartal ${qLabel}`, estimasi: metrics.tercacahEstimasiSales, nilai: metrics.tercacahNilaiSc, bold: true }],
          },
        ].map(({ title, rows }) => (
          <div key={title} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
            <p className="text-xs font-semibold px-3 py-1.5" style={{ background: BG, color: MUTED }}>{title}</p>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: FAINT }}>
                  <th className="text-left font-medium px-3 py-1.5"></th>
                  <th className="text-right font-medium px-3 py-1.5">Estimasi Sales</th>
                  <th className="text-right font-medium px-3 py-1.5">Nilai SC (Insentif)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <td className={`px-3 py-1.5 ${r.bold ? "font-semibold" : ""}`} style={{ color: r.bold ? TEXT : MUTED }}>{r.label}</td>
                    <td className="text-right px-3 py-1.5 font-semibold" style={{ color: TEXT }}>
                      {r.estimasi > 0 ? formatRp(r.estimasi) : "-"}
                    </td>
                    <td className="text-right px-3 py-1.5 font-semibold" style={{ color: PRIMARY }}>
                      {r.nilai > 0 ? formatRp(r.nilai) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* 2. Monthly Breakdown */}
      {monthlySorted.length > 0 && (
        <div className="mb-5">
          <SectionTitle>Estimasi &amp; Nilai SC per Bulan</SectionTitle>
          <div className="rounded-lg overflow-hidden overflow-x-auto" style={{ border: `1px solid ${BORDER}` }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: FAINT, background: BG }}>
                  <th className="text-left font-medium px-3 py-1.5">Bulan</th>
                  <th className="text-right font-medium px-3 py-1.5">Estimasi Sales</th>
                  <th className="text-right font-medium px-3 py-1.5">Nilai SC (Insentif)</th>
                </tr>
              </thead>
              <tbody>
                {monthlySorted.map((m) => {
                  const v = metrics.monthlyBreakdownMap.get(m)!;
                  return (
                    <tr key={m} style={{ borderTop: `1px solid ${BORDER}` }}>
                      <td className="px-3 py-1.5" style={{ color: MUTED }}>{formatPeriode(m)}</td>
                      <td className="text-right px-3 py-1.5" style={{ color: TEXT }}>{v.estimasiSales > 0 ? formatRp(v.estimasiSales) : "-"}</td>
                      <td className="text-right px-3 py-1.5 font-semibold" style={{ color: PRIMARY }}>{v.nilaiSc > 0 ? formatRp(v.nilaiSc) : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. Estimasi vs Target */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        {[
          { label: "Estimasi Sales SC (Tercacah)", value: metrics.tercacahEstimasiSales > 0 ? formatRp(metrics.tercacahEstimasiSales) : "-", span: false },
          { label: targetAreaIsReal ? "Target Area" : "Target Area ★", value: formatRp(targetArea), span: false },
          { label: "Rasio Estimasi", value: ratioEst > 0 ? `${ratioEst.toFixed(0)}%` : "-", span: true },
        ].map(({ label, value, span }) => (
          <div key={label} className={`rounded-lg p-3 space-y-0.5${span ? " col-span-2" : ""}`} style={{ background: BG, border: `1px solid ${BORDER}` }}>
            <p className="text-xs" style={{ color: MUTED }}>{label}</p>
            <p className={`font-bold leading-tight ${span ? "text-lg" : "text-base"}`} style={{ color: TEXT }}>{value}</p>
          </div>
        ))}
      </div>

      {/* 4. Anggaran SC */}
      <SectionTitle>Anggaran SC</SectionTitle>
      <div className="space-y-2.5 mb-5">
        {[
          { label: "Insentif SC (Matriks)", value: metrics.totalNilaiSc },
          { label: "Diskon SC", value: metrics.totalDiskon },
          { label: "Cashback SC", value: metrics.totalCashback },
          { label: "Entertain SC", value: metrics.totalEntertain },
        ].map(({ label, value }) => {
          const pct = metrics.totalEstimasiSales > 0 ? (value / metrics.totalEstimasiSales) * 100 : 0;
          return (
            <div key={label}>
              <div className="flex justify-between text-xs mb-1">
                <span style={{ color: MUTED }}>{label}</span>
                <span style={{ color: TEXT }}>
                  {value > 0 ? formatRp(value) : "-"}
                  {pct > 0 && <span style={{ color: FAINT }}> · {pct.toFixed(1)}%</span>}
                </span>
              </div>
              <Bar pct={pct} color={PRIMARY} />
            </div>
          );
        })}
        <div className="flex justify-between pt-2 text-sm font-semibold" style={{ borderTop: `1px solid ${BORDER}`, color: TEXT }}>
          <span>Total Rencana Biaya SC</span>
          <span style={{ color: PRIMARY }}>{formatRp(metrics.totalBudgetSc)}</span>
        </div>
      </div>

      {/* 5. Cakupan SC */}
      <SectionTitle>Cakupan Sales Counter</SectionTitle>
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="rounded-lg p-3" style={{ background: BG, border: `1px solid ${BORDER}` }}>
          <p className="text-xs mb-0.5" style={{ color: MUTED }}>Outlet SC</p>
          <p className="text-xl font-bold" style={{ color: TEXT }}>{selectedOutletCount}</p>
        </div>
        <div className="rounded-lg p-3" style={{ background: BG, border: `1px solid ${BORDER}` }}>
          <p className="text-xs mb-0.5" style={{ color: MUTED }}>Sales Counter</p>
          <p className="text-xl font-bold" style={{ color: TEXT }}>{metrics.personCount}</p>
        </div>
        <div className="col-span-2 flex justify-between items-center rounded-lg px-3 py-2" style={{ background: BG, border: `1px solid ${BORDER}` }}>
          <p className="text-xs" style={{ color: MUTED }}>Variasi Produk SC / Total Pengajuan</p>
          <p className="text-sm font-bold" style={{ color: TEXT }}>{metrics.productCount} produk ({metrics.totalProductEntries} pengajuan)</p>
        </div>
      </div>

      {/* 6. Data Sales */}
      <button
        type="button"
        onClick={() => setSalesOpen((v) => !v)}
        className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-left"
        style={{ background: BG, border: `1px solid ${BORDER}` }}>
        <span className="text-xs" style={{ color: MUTED }}>
          Data Sales {!salesIsReal && <span style={{ color: FAINT }}>★ data sementara</span>}
        </span>
        <span className="text-xs" style={{ color: FAINT }}>{salesOpen ? "▲" : "▼"}</span>
      </button>

      {salesOpen && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            { label: `Historis ${salesFigures.historisTahunLaluLabel}`, value: formatRp(salesFigures.historisTahunLalu) },
            { label: `Sales YTD ${new Date().getFullYear()}`, value: formatRp(salesFigures.salesYtd) },
            { label: "Sales YTD + Estimasi SC", value: formatRp(salesPlusEst) },
            { label: "Growth YTD", value: `${salesFigures.growthPct >= 0 ? "+" : ""}${salesFigures.growthPct.toFixed(1)}%`, danger: salesFigures.growthPct < 0 },
          ].map(({ label, value, danger }) => (
            <div key={label} className="rounded-lg p-2.5" style={{ background: BG, border: `1px solid ${BORDER}` }}>
              <p className="text-xs mb-0.5" style={{ color: FAINT }}>{label}</p>
              <p className="text-sm font-semibold" style={{ color: danger ? DANGER : TEXT }}>{value}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
