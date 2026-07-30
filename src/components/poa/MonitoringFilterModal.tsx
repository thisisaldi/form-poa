"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FilterIcon } from "@/components/ui/icons";

export interface MonitoringFilterOption {
  nip: string;
  name: string;
}

/**
 * Popup filter for the Monitoring page — period range, Area (SM), and MR,
 * applied across whichever tab is active (2026-07-30 request: "ada filter
 * juga untuk kayak popup gitu"). A plain GET form under the hood (same
 * mechanism the inline period selector already used elsewhere in this app),
 * just presented as an overlay instead of inline so it doesn't crowd the
 * header on every tab.
 */
export function MonitoringFilterModal({
  tab, periods, areas, mrs, periodFrom, periodTo, areaNip, mrNip,
}: {
  tab: string;
  periods: string[];
  areas: MonitoringFilterOption[];
  mrs: MonitoringFilterOption[];
  periodFrom: string | null;
  periodTo: string | null;
  areaNip: string | null;
  mrNip: string | null;
}) {
  const [open, setOpen] = useState(false);
  const activeCount = [periodFrom, periodTo, areaNip, mrNip].filter(Boolean).length;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <FilterIcon />
        Filter
        {activeCount > 0 && (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold"
            style={{ background: "var(--color-blue)", color: "#fff" }}>
            {activeCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="monitoring-filter-title"
            className="relative w-full max-w-sm rounded-lg shadow-xl"
            style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
          >
            <form method="get" className="p-5 space-y-4">
              <input type="hidden" name="tab" value={tab} />
              <p id="monitoring-filter-title" className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>
                Filter Monitoring
              </p>

              <div className="space-y-1.5">
                <label className="text-xs font-medium" style={{ color: "var(--color-text-faint)" }}>Periode</label>
                <div className="flex items-center gap-1.5">
                  <select name="periodFrom" defaultValue={periodFrom ?? ""} className="input-field text-xs">
                    <option value="">Dari (awal)</option>
                    {periods.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>–</span>
                  <select name="periodTo" defaultValue={periodTo ?? ""} className="input-field text-xs">
                    <option value="">Sampai (akhir)</option>
                    {periods.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>

              {areas.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium" style={{ color: "var(--color-text-faint)" }}>Area (SM)</label>
                  <select name="area" defaultValue={areaNip ?? ""} className="input-field text-xs w-full">
                    <option value="">Semua Area</option>
                    {areas.map((a) => <option key={a.nip} value={a.nip}>{a.name}</option>)}
                  </select>
                </div>
              )}

              {mrs.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium" style={{ color: "var(--color-text-faint)" }}>MR</label>
                  <select name="mr" defaultValue={mrNip ?? ""} className="input-field text-xs w-full">
                    <option value="">Semua MR</option>
                    {mrs.map((m) => <option key={m.nip} value={m.nip}>{m.name}</option>)}
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-2 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
                {activeCount > 0 && (
                  <a href={`/monitoring?tab=${tab}`} className="rounded px-2.5 py-1.5 text-xs font-medium border"
                    style={{ color: "var(--color-text-muted)", borderColor: "var(--color-border)" }}>
                    Reset
                  </a>
                )}
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Batal</Button>
                <Button type="submit" size="sm">Terapkan</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
