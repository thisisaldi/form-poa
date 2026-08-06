"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FilterIcon } from "@/components/ui/icons";

/**
 * Popup filter for the Summary page — period range only (the one filter
 * dimension this page has). Same overlay treatment as Monitoring's filter
 * (2026-07-30 request: "tombol sort dan filter semenarik mungkin, ini juga
 * berlaku untuk summary") instead of the old inline row of selects, which
 * doesn't scale well next to the tab bar.
 */
export function SummaryFilterModal({
  tab, periods, periodFrom, periodTo,
}: {
  tab: string;
  periods: string[];
  periodFrom: string | null;
  periodTo: string | null;
}) {
  const [open, setOpen] = useState(false);
  const activeCount = [periodFrom, periodTo].filter(Boolean).length;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (periods.length === 0) return null;

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <FilterIcon />
        Filter Periode
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
            aria-labelledby="summary-filter-title"
            className="relative w-full max-w-sm rounded-lg shadow-xl"
            style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
          >
            <form method="get" className="p-5 space-y-4">
              <input type="hidden" name="tab" value={tab} />
              <p id="summary-filter-title" className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>
                Filter Periode
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

              {/* Default view (no filter) is bounded to current + 1 previous
                  quarter for performance (2026-07-31) — this is the explicit
                  opt-in back to unbounded history: sets periodFrom to the
                  earliest period that exists, which makes it a real filter
                  (hasPeriodFilter) rather than "no filter". */}
              {periods.length > 0 && periodFrom !== periods[0] && (
                <a href={`/summary?tab=${tab}&periodFrom=${periods[0]}`}
                  className="block text-xs" style={{ color: "var(--color-blue)" }}>
                  Lihat semua periode (dari {periods[0]})
                </a>
              )}

              <div className="flex justify-end gap-2 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
                {activeCount > 0 && (
                  <a href={`/summary?tab=${tab}`} className="rounded px-2.5 py-1.5 text-xs font-medium border"
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

const QUARTER_OPTIONS = ["1", "2", "3", "4"];

/**
 * Period filter for the Ringkasan tab specifically (docs/summary-ringkasan
 * spec, 2026-08-05 implementation) — restricted to exactly ONE quarter
 * ("Q-Berjalan"), unlike SummaryFilterModal's from/to range used by every
 * other tab. Scoped to the Ringkasan tab only (non-blocking assumption #2 in
 * docs/summary-ringkasan/01-business-rules.md §"Open questions": the spec
 * left "tab-only vs whole-page" undecided — tab-scoped is the safer choice
 * since it doesn't touch the range-filter behavior every other tab already
 * depends on). Submits two separate query params, `qYear`/`qQuarter`
 * (2026-08-06 follow-up: "filter periodenya buat dropdown aja yang isinya
 * Q1, q2 dst, dan tahunnya" — replaced the single "YYYY-QN" select with a
 * Quarter dropdown + Year dropdown), independent of periodFrom/periodTo so
 * switching back to another tab doesn't carry a stale selection into the
 * range filter.
 */
export function RingkasanQuarterFilter({
  years, year, quarterNum, quarterLabel,
}: {
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
              <input type="hidden" name="tab" value="ringkasan" />
              <p id="ringkasan-filter-title" className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>
                Pilih Kuartal (Q-Berjalan)
              </p>
              <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                Tab Ringkasan hanya menampilkan satu kuartal sekaligus — beda dari filter rentang periode di tab lain.
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
