"use client";

import { useState, useTransition } from "react";
import { updatePoaPeriodAction } from "@/app/actions/poa";

/**
 * Inline "Edit Quarter" control for the POA detail header (2026-08-03,
 * stakeholder item #10) — period used to only ever be set once at /poa/new.
 * Defaults to the draft's current period; only rendered by the caller when
 * editable (owner/admin + DRAFT/REVISI, see updatePoaPeriodAction). Does NOT
 * touch any line item's periodeAwal — those stay exactly as entered even if
 * they now fall outside the new period's quarter months (owner's call to
 * re-align manually, same as any other field).
 */
export function EditQuarterControl({ poaId, period }: { poaId: string; period: string }) {
  const [editing, setEditing] = useState(false);
  const [year, setYear] = useState(period.slice(0, 4));
  const [quarter, setQuarter] = useState(period.slice(5));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const currentYear = new Date().getFullYear();
  const years = [currentYear - 1, currentYear, currentYear + 1].map(String);

  function handleCancel() {
    setYear(period.slice(0, 4));
    setQuarter(period.slice(5));
    setError(null);
    setEditing(false);
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updatePoaPeriodAction(poaId, `${year}-${quarter}`);
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
    });
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        Periode {period}
        <button type="button" onClick={() => setEditing(true)}
          className="text-xs underline underline-offset-2" style={{ color: "var(--color-blue, #2563eb)" }}>
          Ubah
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <select value={year} onChange={(e) => setYear(e.target.value)} disabled={pending}
        className="input-field text-xs py-0.5">
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <select value={quarter} onChange={(e) => setQuarter(e.target.value)} disabled={pending}
        className="input-field text-xs py-0.5">
        <option value="Q1">Q1</option>
        <option value="Q2">Q2</option>
        <option value="Q3">Q3</option>
        <option value="Q4">Q4</option>
      </select>
      <button type="button" onClick={handleSave} disabled={pending}
        className="text-xs font-medium underline underline-offset-2" style={{ color: "var(--color-blue, #2563eb)" }}>
        {pending ? "Menyimpan…" : "Simpan"}
      </button>
      <button type="button" onClick={handleCancel} disabled={pending}
        className="text-xs underline underline-offset-2" style={{ color: "var(--color-text-faint)" }}>
        Batal
      </button>
      {error && <span className="text-xs w-full" style={{ color: "var(--color-red)" }}>{error}</span>}
    </span>
  );
}
