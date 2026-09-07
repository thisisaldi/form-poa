"use client";

import React from "react";

interface BlastInPosmTablesProps {
  poaPeriod?: string;
  quarter?: number;
  isBlastIn?: boolean;
  isPosm?: boolean;
}

export function BlastInPosmTables({
  poaPeriod = "2026-Q3",
  quarter,
  isBlastIn = true,
  isPosm = false,
}: BlastInPosmTablesProps) {
  // Determine current quarter (Q3 or Q4 for 2026)
  let qNum = quarter;
  if (!qNum) {
    const m = poaPeriod.match(/-Q([1-4])/);
    qNum = m ? parseInt(m[1], 10) : 3;
  }

  const actualHeader =
    qNum === 1
      ? "ACTUAL SALES"
      : qNum === 2
      ? "ACTUAL SALES (Q1)"
      : qNum === 3
      ? "ACTUAL SALES (Q1-Q2)"
      : "ACTUAL SALES (Q1-Q3)";

  const estimasiHeader = qNum === 4 ? "ESTIMASI Q3 + Q4" : `ESTIMASI Q${qNum}`;
  const targetHeader = `TARGET BLAST-IN Q${qNum}`;
  const hadiahHeader = `HADIAH Q${qNum}`;

  return (
    <div className="space-y-6 my-4">
      {/* 1. TABEL BLAST-IN */}
      {isBlastIn && (
        <div className="space-y-1">
        <div className="overflow-x-auto rounded-lg border shadow-sm" style={{ borderColor: "var(--color-border)" }}>
          <table className="w-full text-xs text-center border-collapse min-w-[480px]">
            <thead>
              {/* Header Title Bar */}
              <tr style={{ background: "#18181b", color: "#ffffff" }}>
                <th colSpan={4} className="py-2 px-4 font-bold text-xs uppercase tracking-wider text-center">
                  BLAST-IN
                </th>
              </tr>
              {/* Column Headers */}
              <tr className="border-b" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
                <th className="py-2.5 px-3 font-semibold text-xs border-r whitespace-nowrap" style={{ color: "var(--color-text-muted)", width: "25%", borderColor: "var(--color-border)" }}>
                  {actualHeader}
                </th>
                <th className="py-2.5 px-3 font-semibold text-xs border-r whitespace-nowrap" style={{ color: "var(--color-text-muted)", width: "25%", borderColor: "var(--color-border)" }}>
                  {estimasiHeader}
                </th>
                <th className="py-2.5 px-3 font-semibold text-xs border-r whitespace-nowrap" style={{ color: "var(--color-text-muted)", width: "25%", borderColor: "var(--color-border)" }}>
                  {targetHeader}
                </th>
                <th className="py-2.5 px-3 font-semibold text-xs whitespace-nowrap" style={{ color: "var(--color-text-muted)", width: "25%" }}>
                  {hadiahHeader}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b hover:bg-slate-50/50" style={{ borderColor: "var(--color-border)" }}>
                <td className="py-3 px-3 border-r" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
                  0
                </td>
                <td className="py-3 px-3 border-r" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
                  0
                </td>
                <td className="py-3 px-3 border-r" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
                  0
                </td>
                <td className="py-3 px-3" style={{ color: "var(--color-text-faint)" }}>
                  0
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* 2. TABEL POSM */}
      {isPosm && (
        <div className="space-y-1">
          <div className="overflow-x-auto rounded-lg border shadow-sm" style={{ borderColor: "var(--color-border)" }}>
            <table className="w-full text-xs text-center border-collapse min-w-[360px]">
              <thead>
                {/* Header Title Bar */}
                <tr style={{ background: "#18181b", color: "#ffffff" }}>
                  <th colSpan={3} className="py-2 px-4 font-bold text-xs uppercase tracking-wider text-center">
                    POSM
                  </th>
                </tr>
                {/* Column Headers */}
                <tr className="border-b" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
                  <th className="py-2.5 px-3 font-semibold text-xs border-r whitespace-nowrap" style={{ color: "var(--color-text-muted)", width: "34%", borderColor: "var(--color-border)" }}>
                    NAMA POSM
                  </th>
                  <th className="py-2.5 px-3 font-semibold text-xs border-r whitespace-nowrap" style={{ color: "var(--color-text-muted)", width: "33%", borderColor: "var(--color-border)" }}>
                    PERIODE
                  </th>
                  <th className="py-2.5 px-3 font-semibold text-xs whitespace-nowrap" style={{ color: "var(--color-text-muted)", width: "33%" }}>
                    KOMISI
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b hover:bg-slate-50/50" style={{ borderColor: "var(--color-border)" }}>
                  <td className="py-3 px-3 border-r" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
                    -
                  </td>
                  <td className="py-3 px-3 border-r" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
                    -
                  </td>
                  <td className="py-3 px-3" style={{ color: "var(--color-text-faint)" }}>
                    0
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
