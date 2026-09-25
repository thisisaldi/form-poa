"use client";

import { useRouter } from "next/navigation";
import { periodLabel } from "./kpiUi";

/** Month picker — navigates to `basePath` (default /kpi-perpanjangan) via ?period=YYYY-MM. */
export function KpiPeriodPicker({ periods, period, basePath = "/kpi-perpanjangan" }: { periods: string[]; period: string; basePath?: string }) {
  const router = useRouter();
  return (
    <select
      value={period}
      onChange={(e) => router.push(`${basePath}?period=${e.target.value}`)}
      aria-label="Pilih periode"
      className="rounded-md border px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-1"
      style={{ borderColor: "var(--color-border)", color: "var(--color-text)", background: "var(--color-surface)" }}
    >
      {periods.map((p) => (
        <option key={p} value={p}>{periodLabel(p)}</option>
      ))}
    </select>
  );
}
