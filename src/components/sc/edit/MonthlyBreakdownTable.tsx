"use client";

import React from "react";

export interface MonthlyBreakdownItem {
  month: string;
  label: string;
  estimasiSales: number;
  nilaiSc: number;
  nilaiCashback?: number;
}

export interface MonthlyBreakdownTableProps {
  monthlyBreakdown: MonthlyBreakdownItem[];
  totalMonthlyEstimasiSales: number;
  totalMonthlyNilaiSc: number;
  totalCashbackVal: number;
  lamaPeriode: number;
  isCashbackHidden: boolean;
}

export function MonthlyBreakdownTable({
  monthlyBreakdown,
  totalMonthlyEstimasiSales,
  totalMonthlyNilaiSc,
  totalCashbackVal,
  lamaPeriode,
  isCashbackHidden,
}: MonthlyBreakdownTableProps) {
  if (!monthlyBreakdown || monthlyBreakdown.length === 0) return null;

  return (
    <div
      className="rounded-xl border px-3.5 py-3 space-y-3 shadow-xs"
      style={{
        background: "var(--color-bg)",
        borderColor: "var(--color-blue)",
        borderWidth: 2,
        marginTop: "2rem",
      }}
    >
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
        {isCashbackHidden ? "Estimasi & Insentif SC per Bulan" : "Estimasi & Insentif SC/Cashback per Bulan"}
      </p>

      {/* Mobile View: Clean, responsive table that fits screen width */}
      <div className="md:hidden rounded-lg overflow-x-auto border" style={{ borderColor: "var(--color-border)" }}>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
              <th className="text-left font-semibold px-2 py-1.5 whitespace-nowrap text-[11px]">Bulan</th>
              <th className="text-right font-semibold px-1.5 py-1.5 whitespace-nowrap text-[11px]">Sales</th>
              <th className="text-right font-semibold px-1.5 py-1.5 whitespace-nowrap text-[11px]" style={{ color: "var(--color-blue)" }}>Insentif</th>
              {!isCashbackHidden && (
                <th className="text-right font-semibold px-1.5 py-1.5 whitespace-nowrap text-[11px]" style={{ color: "var(--color-green, #16a34a)" }}>Cashback</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y text-[11px]" style={{ borderColor: "var(--color-border)" }}>
            {monthlyBreakdown.map((m) => {
              const mCashback = m.nilaiCashback !== undefined ? m.nilaiCashback : totalCashbackVal / (lamaPeriode || 1);
              const shortMonthLabel = m.label.replace(/\s*20(\d\d)/, " '$1");
              return (
                <tr key={m.month} className="hover:bg-[var(--color-bg-subtle)] transition-colors">
                  <td className="px-2 py-2 font-semibold whitespace-nowrap align-middle text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                    {shortMonthLabel}
                  </td>
                  <td className="text-right px-1.5 py-2 tabular-nums whitespace-nowrap align-middle text-[11px]" style={{ color: "var(--color-text)" }}>
                    {m.estimasiSales > 0 ? `Rp\u00A0${Math.round(m.estimasiSales).toLocaleString("id-ID")}` : "-"}
                  </td>
                  <td className="text-right px-1.5 py-2 font-semibold tabular-nums whitespace-nowrap align-middle text-[11px]" style={{ color: "var(--color-blue)" }}>
                    {m.nilaiSc > 0 ? `Rp\u00A0${Math.round(m.nilaiSc).toLocaleString("id-ID")}` : "-"}
                  </td>
                  {!isCashbackHidden && (
                    <td className="text-right px-1.5 py-2 font-semibold tabular-nums whitespace-nowrap align-middle text-[11px]" style={{ color: "var(--color-green, #16a34a)" }}>
                      {mCashback > 0 ? `Rp\u00A0${Math.round(mCashback).toLocaleString("id-ID")}` : "-"}
                    </td>
                  )}
                </tr>
              );
            })}
            <tr style={{ background: "rgba(59, 130, 246, 0.04)", fontWeight: 700 }}>
              <td className="px-2 py-2 align-middle whitespace-nowrap text-[11px]" style={{ color: "var(--color-text)" }}>
                Total
              </td>
              <td className="text-right px-1.5 py-2 tabular-nums whitespace-nowrap align-middle text-[11px]" style={{ color: "var(--color-text)" }}>
                Rp&nbsp;{Math.round(totalMonthlyEstimasiSales).toLocaleString("id-ID")}
              </td>
              <td className="text-right px-1.5 py-2 font-bold tabular-nums whitespace-nowrap align-middle text-[11px]" style={{ color: "var(--color-blue)" }}>
                Rp&nbsp;{Math.round(totalMonthlyNilaiSc).toLocaleString("id-ID")}
              </td>
              {!isCashbackHidden && (
                <td className="text-right px-1.5 py-2 font-bold tabular-nums whitespace-nowrap align-middle text-[11px]" style={{ color: "var(--color-green, #16a34a)" }}>
                  Rp&nbsp;{Math.round(totalCashbackVal).toLocaleString("id-ID")}
                </td>
              )}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Desktop View: Existing Table */}
      <div className="hidden md:block rounded-lg overflow-hidden overflow-x-auto border" style={{ borderColor: "var(--color-border)" }}>
        <table className="w-full text-xs min-w-[460px]">
          <thead>
            <tr style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
              <th className="text-left font-medium px-3 py-1.5 whitespace-nowrap">Bulan</th>
              <th className="text-right font-medium px-3 py-1.5 whitespace-nowrap">Estimasi Sales</th>
              <th className="text-right font-medium px-3 py-1.5 whitespace-nowrap">Nilai Insentif SC</th>
              {!isCashbackHidden && (
                <th className="text-right font-medium px-3 py-1.5 whitespace-nowrap">Nilai Cashback</th>
              )}
            </tr>
          </thead>
          <tbody>
            {monthlyBreakdown.map((m) => {
              const mCashback = m.nilaiCashback !== undefined ? m.nilaiCashback : totalCashbackVal / (lamaPeriode || 1);
              return (
                <tr key={m.month} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td className="px-3 py-1.5 align-middle whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>{m.label}</td>
                  <td className="text-right px-3 py-1.5 tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-text)" }}>
                    {m.estimasiSales > 0 ? `Rp\u00A0${Math.round(m.estimasiSales).toLocaleString("id-ID")}` : "-"}
                  </td>
                  <td className="text-right px-3 py-1.5 font-semibold tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-blue)" }}>
                    {m.nilaiSc > 0 ? `Rp\u00A0${Math.round(m.nilaiSc).toLocaleString("id-ID")}` : "-"}
                  </td>
                  {!isCashbackHidden && (
                    <td className="text-right px-3 py-1.5 font-semibold tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-green, #16a34a)" }}>
                      {mCashback > 0 ? `Rp\u00A0${Math.round(mCashback).toLocaleString("id-ID")}` : "-"}
                    </td>
                  )}
                </tr>
              );
            })}
            <tr style={{ fontWeight: 600 }}>
              <td className="px-3 py-1.5 align-middle whitespace-nowrap" style={{ color: "var(--color-text)" }}>Total</td>
              <td className="text-right px-3 py-1.5 tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-text)" }}>
                Rp&nbsp;{Math.round(totalMonthlyEstimasiSales).toLocaleString("id-ID")}
              </td>
              <td className="text-right px-3 py-1.5 font-bold tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-blue)" }}>
                Rp&nbsp;{Math.round(totalMonthlyNilaiSc).toLocaleString("id-ID")}
              </td>
              {!isCashbackHidden && (
                <td className="text-right px-3 py-1.5 font-bold tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-green, #16a34a)" }}>
                  Rp&nbsp;{Math.round(totalCashbackVal).toLocaleString("id-ID")}
                </td>
              )}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
