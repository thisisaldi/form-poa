"use client";

import { useRouter } from "next/navigation";

/** Simple month picker for /kpi-perpanjangan — navigates via ?period=YYYY-MM. */
export function KpiPeriodPicker({ periods, period }: { periods: string[]; period: string }) {
  const router = useRouter();
  return (
    <select
      value={period}
      onChange={(e) => router.push(`/kpi-perpanjangan?period=${e.target.value}`)}
      className="rounded border px-3 py-2 text-sm"
      style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
    >
      {periods.map((p) => (
        <option key={p} value={p}>{p}</option>
      ))}
    </select>
  );
}
