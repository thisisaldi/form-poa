"use client";

import React from "react";

export function PosmTable() {
  return (
    <div className="space-y-2 mt-4">
      <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>POSM</span>
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
        <table className="w-full text-xs text-center border-collapse">
          <thead>
            <tr style={{ background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
              <th className="px-4 py-2.5 font-medium" style={{ color: "var(--color-text-muted)", width: "34%" }}>
                NAMA POSM
              </th>
              <th className="px-4 py-2.5 font-medium" style={{ color: "var(--color-text-muted)", width: "33%" }}>
                PERIODE
              </th>
              <th className="px-4 py-2.5 font-medium" style={{ color: "var(--color-text-muted)", width: "33%" }}>
                KOMISI
              </th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
              <td className="px-4 py-3 text-center font-medium" style={{ color: "var(--color-text)" }}>Polysilane</td>
              <td className="px-4 py-3 text-center" style={{ color: "var(--color-text)" }}>202608</td>
              <td className="px-4 py-3 text-center font-medium" style={{ color: "var(--color-text)" }}>Rp 100.000</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
