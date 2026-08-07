"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FilterIcon } from "@/components/ui/icons";

// `SummaryFilterModal` (the from/to period RANGE picker every non-Ringkasan
// tab used to render) was deleted on 2026-08-07 — all six /summary tabs now
// show single-quarter-scoped metrics, so `RingkasanQuarterFilter` below is the
// page's only period filter. The file keeps its name so the import path stays
// stable. Monitoring has its own separate range filter (MonitoringFilterModal),
// which is unaffected.

const QUARTER_OPTIONS = ["1", "2", "3", "4"];

/**
 * The /summary page's period filter — restricted to exactly ONE quarter
 * ("Q-Berjalan", docs/summary-ringkasan spec §1). Introduced 2026-08-05 for
 * the Ringkasan tab only; since 2026-08-07 it serves EVERY tab (non-blocking
 * assumption #2 in docs/summary-ringkasan/01-business-rules.md §"Open
 * questions" — "tab-only vs whole-page" — resolved as whole-page, now that
 * every tab shows the same single-quarter metrics and the range picker has
 * no consumer left). Submits two separate query params, `qYear`/`qQuarter`
 * (2026-08-06 follow-up: "filter periodenya buat dropdown aja yang isinya
 * Q1, q2 dst, dan tahunnya" — replaced the single "YYYY-QN" select with a
 * Quarter dropdown + Year dropdown); `tab` is carried through so applying the
 * filter keeps you on the tab you were looking at.
 */
export function RingkasanQuarterFilter({
  tab, years, year, quarterNum, quarterLabel,
}: {
  tab: string;
  years: string[];
  year: string;
  quarterNum: string;
  quarterLabel: string;
}) {
  const [open, setOpen] = useState(false);

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
        Kuartal: {quarterLabel}
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ringkasan-filter-title"
            className="relative w-full max-w-sm rounded-lg shadow-xl"
            style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
          >
            <form method="get" className="p-5 space-y-4">
              <input type="hidden" name="tab" value={tab} />
              <p id="ringkasan-filter-title" className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>
                Pilih Kuartal (Q-Berjalan)
              </p>
              <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                Seluruh tab Summary menampilkan satu kuartal sekaligus.
              </p>

              <div className="flex items-center gap-1.5">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium" style={{ color: "var(--color-text-faint)" }}>Kuartal</label>
                  <select name="qQuarter" defaultValue={quarterNum} className="input-field text-xs">
                    {QUARTER_OPTIONS.map((q) => <option key={q} value={q}>{`Q${q}`}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium" style={{ color: "var(--color-text-faint)" }}>Tahun</label>
                  <select name="qYear" defaultValue={year} className="input-field text-xs">
                    {years.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
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
