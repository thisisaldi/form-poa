"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import {
  searchTargetHospitalValueAction,
  updateTargetHospitalValueAction,
  type TargetHospitalRow,
} from "@/app/actions/targetHospitalValue";
import { TARGET_HOSPITAL_PERIODS } from "@/lib/targetHospitalValue";
import { formatCurrency as formatRp } from "@/lib/format";
import { formatRp as formatThousands, parseRp } from "@/lib/utils";

const PERIOD_LABEL: Record<string, string> = {
  "202607": "Jul'26", "202608": "Agu'26", "202609": "Sep'26", "202610": "Okt'26", "202611": "Nov'26", "202612": "Des'26",
};

interface RollupRow {
  name: string;
  total: number;
  byPeriode: Record<string, number>;
}

function sumBy(rows: TargetHospitalRow[], keyFn: (r: TargetHospitalRow) => string): RollupRow[] {
  const map = new Map<string, RollupRow>();
  for (const r of rows) {
    const key = keyFn(r);
    let entry = map.get(key);
    if (!entry) { entry = { name: key, total: 0, byPeriode: {} }; map.set(key, entry); }
    for (const p of TARGET_HOSPITAL_PERIODS) {
      const v = r.targets[p] ?? 0;
      entry.total += v;
      entry.byPeriode[p] = (entry.byPeriode[p] ?? 0) + v;
    }
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

/**
 * Admin/NSM edit view for TargetHospitalValue (2026-07-31 — "Target Hospital
 * (in Value).xlsx" monthly Rupiah target per GT, 202608-202612). Search
 * narrows by GT/MR/ASM/SM/NSM name; each period is an inline-editable cell,
 * committed on blur. Per-ASM/SM/NSM rollups below are a plain client-side sum
 * over whatever rows are currently loaded (i.e. respect the search filter) —
 * exactly the "tinggal disum aja" ask, no separate aggregate query needed.
 */
export function TargetHospitalValueForm() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<TargetHospitalRow[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  function load() {
    setError(null);
    startTransition(async () => {
      const result = await searchTargetHospitalValueAction(query);
      setRows(result);
    });
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function updateLocal(namaGT: string, periode: string, value: number) {
    setRows((prev) => prev?.map((r) => r.namaGT === namaGT ? { ...r, targets: { ...r.targets, [periode]: value } } : r) ?? null);
  }

  async function commit(namaGT: string, periode: string, value: number) {
    const key = `${namaGT}|${periode}`;
    setSavingKey(key);
    setError(null);
    const res = await updateTargetHospitalValueAction(namaGT, periode, value);
    setSavingKey(null);
    if (!res.ok) {
      setError(res.error ?? "Gagal menyimpan.");
      return;
    }
    setSavedKey(key);
    setTimeout(() => setSavedKey((k) => k === key ? null : k), 1500);
  }

  const byAsm = rows ? sumBy(rows, (r) => r.namaASM) : [];
  const bySm = rows ? sumBy(rows, (r) => r.namaSM) : [];
  const byNsm = rows ? sumBy(rows, (r) => r.namaNSM) : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Cari GT / MR / ASM / SM / NSM</span>
          <input
            type="text" value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") load(); }}
            placeholder="Nama GT, MR, ASM, SM, atau NSM…"
            className="input-field" style={{ minWidth: 260 }} />
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={load} disabled={isPending}>
          {isPending ? "Memuat…" : "Cari"}
        </Button>
        {rows && <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>{rows.length} GT</span>}
      </div>

      {error && (
        <p className="text-sm px-3 py-2 rounded-md" style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>
      )}

      {rows && (
        <div className="overflow-x-auto max-h-[32rem] overflow-y-auto rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
          <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
            <thead className="sticky top-0" style={{ background: "var(--color-bg-subtle)" }}>
              <tr>
                <th className="text-left py-2 px-3">GT</th>
                <th className="text-left py-2 px-3">MR</th>
                <th className="text-left py-2 px-3">ASM</th>
                <th className="text-left py-2 px-3">SM</th>
                <th className="text-left py-2 px-3">NSM</th>
                {TARGET_HOSPITAL_PERIODS.map((p) => (
                  <th key={p} className="text-right py-2 px-3 whitespace-nowrap">{PERIOD_LABEL[p]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.namaGT} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td className="py-1.5 px-3 font-medium whitespace-nowrap" style={{ color: "var(--color-text)" }}>{r.namaGT}</td>
                  <td className="py-1.5 px-3 whitespace-nowrap" style={{ color: r.nipMR ? "var(--color-text)" : "var(--color-text-faint)" }}>{r.namaMR}</td>
                  <td className="py-1.5 px-3 whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>{r.namaASM}</td>
                  <td className="py-1.5 px-3 whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>{r.namaSM}</td>
                  <td className="py-1.5 px-3 whitespace-nowrap" style={{ color: r.nipNSM ? "var(--color-text-muted)" : "var(--color-text-faint)" }}>{r.namaNSM}</td>
                  {TARGET_HOSPITAL_PERIODS.map((p) => {
                    const key = `${r.namaGT}|${p}`;
                    return (
                      <td key={p} className="py-1.5 px-2">
                        <input
                          type="text" inputMode="numeric"
                          value={formatThousands(String(r.targets[p] ?? 0))}
                          onChange={(e) => updateLocal(r.namaGT, p, parseFloat(parseRp(e.target.value)) || 0)}
                          onBlur={(e) => commit(r.namaGT, p, parseFloat(parseRp(e.target.value)) || 0)}
                          className="input-field text-right" style={{ width: 110,
                            borderColor: savedKey === key ? "var(--color-green, #16a34a)" : undefined }} />
                        {savingKey === key && <span className="text-[10px]" style={{ color: "var(--color-text-faint)" }}>Menyimpan…</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5 + TARGET_HOSPITAL_PERIODS.length} className="py-6 text-center" style={{ color: "var(--color-text-faint)" }}>Tidak ada GT yang cocok.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t" style={{ borderColor: "var(--color-border)" }}>
          {[
            { title: "Total per NSM", data: byNsm },
            { title: "Total per SM", data: bySm },
            { title: "Total per ASM", data: byAsm },
          ].map(({ title, data }) => (
            <div key={title}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-faint)" }}>{title}</p>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {data.map((d) => (
                  <div key={d.name} className="text-xs pb-1.5 border-b" style={{ borderColor: "var(--color-border)" }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium" style={{ color: "var(--color-text-muted)" }}>{d.name}</span>
                      <span className="font-semibold shrink-0" style={{ color: "var(--color-blue)" }}>{formatRp(d.total)}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 mt-1">
                      {TARGET_HOSPITAL_PERIODS.map((p) => (
                        <span key={p} className="text-[10px] whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                          {PERIOD_LABEL[p]} <span style={{ color: "var(--color-text-muted)" }}>{formatRp(d.byPeriode[p] ?? 0)}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
