"use client";

import React from "react";

interface BlastInTableProps {
  poaPeriod?: string;
  quarter?: number;
}

export function BlastInTable({ poaPeriod = "2026-Q3", quarter }: BlastInTableProps) {
  let qNum = quarter;
  let yearNum = 2026;

  const m = poaPeriod.match(/^(\d{4})-Q([1-4])$/);
  if (m) {
    yearNum = parseInt(m[1], 10);
    if (!qNum) qNum = parseInt(m[2], 10);
  }
  if (!qNum) qNum = 3;

  // Sesuai instruksi: Sembunyikan tabel BLAST-IN untuk Q1 & Q2 pada tahun 2026
  if (yearNum === 2026 && (qNum === 1 || qNum === 2)) {
    return null;
  }

  const estimasiHeader = qNum === 4 ? "ESTIMASI Q3 + Q4" : "ESTIMASI Q3";
  const targetHeader = `TARGET BLAST-IN Q${qNum >= 4 ? 4 : 3}`;
  const hadiahHeader = `HADIAH Q${qNum >= 4 ? 4 : 3}`;

  return (
    <div className="space-y-2 mt-4">
      <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>BLAST-IN</span>
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
        <table className="w-full text-xs text-center border-collapse">
          <thead>
            <tr style={{ background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
              <th className="px-4 py-2.5 font-medium" style={{ color: "var(--color-text-muted)", width: "25%" }}>
                ACTUAL SALES (Q1-Q2)
              </th>
              <th className="px-4 py-2.5 font-medium" style={{ color: "var(--color-text-muted)", width: "25%" }}>
                {estimasiHeader}
              </th>
              <th className="px-4 py-2.5 font-medium" style={{ color: "var(--color-text-muted)", width: "25%" }}>
                {targetHeader}
              </th>
              <th className="px-4 py-2.5 font-medium" style={{ color: "var(--color-text-muted)", width: "25%" }}>
                {hadiahHeader}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
              <td className="px-4 py-3 text-center font-medium" style={{ color: "var(--color-text)" }}>Rp 0</td>
              <td className="px-4 py-3 text-center font-medium" style={{ color: "var(--color-text)" }}>Rp 0</td>
              <td className="px-4 py-3 text-center font-medium" style={{ color: "var(--color-text)" }}>Rp 0</td>
              <td className="px-4 py-3 text-center font-medium" style={{ color: "var(--color-text)" }}>Rp 0</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
