"use client";

import React from "react";

interface BlastInTableProps {
  poaPeriod?: string;
  quarter?: number;
}

export function BlastInTable({ poaPeriod = "2026-Q3", quarter }: BlastInTableProps) {
  let qNum = quarter;

  if (!qNum) {
    const m = poaPeriod.match(/^(\d{4})-Q([1-4])$/);
    if (m) {
      qNum = parseInt(m[2], 10);
    }
  }
  if (!qNum) qNum = 3;

  const actualHeader =
    qNum === 1
      ? "ACTUAL SALES"
      : qNum === 2
      ? "ACTUAL SALES (Q1)"
      : qNum === 3
      ? "ACTUAL SALES (Q1-Q2)"
      : "ACTUAL SALES (Q1-Q3)";

  const estimasiHeader = `ESTIMASI Q${qNum}`;
  const sumHeader = `ACTUAL + ESTIMASI Q${qNum}`;
  const targetHeader = `TARGET BLAST-IN Q${qNum}`;
  const hadiahHeader = `HADIAH Q${qNum}`;

  return (
    <div className="space-y-2 mt-4">
      <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>BLAST-IN</span>
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
        <table className="w-full text-xs text-center border-collapse min-w-[500px]">
          <thead>
            <tr style={{ background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: "var(--color-text-muted)", width: "20%" }}>
                {actualHeader}
              </th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: "var(--color-text-muted)", width: "20%" }}>
                {estimasiHeader}
              </th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: "var(--color-text-muted)", width: "20%" }}>
                {sumHeader}
              </th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: "var(--color-text-muted)", width: "20%" }}>
                {targetHeader}
              </th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: "var(--color-text-muted)", width: "20%" }}>
                {hadiahHeader}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
              <td className="px-4 py-3 text-center font-medium" style={{ color: "var(--color-text)" }}>Rp 100.000</td>
              <td className="px-4 py-3 text-center font-medium" style={{ color: "var(--color-text)" }}>Rp 50.000</td>
              <td className="px-4 py-3 text-center font-medium" style={{ color: "var(--color-text)" }}>Rp 150.000</td>
              <td className="px-4 py-3 text-center font-medium" style={{ color: "var(--color-text)" }}>Rp 50.000</td>
              <td className="px-4 py-3 text-center font-medium" style={{ color: "var(--color-text)" }}>Rp 5.000</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
