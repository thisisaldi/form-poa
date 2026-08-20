"use client";

import { Button } from "@/components/ui/Button";

export function SalesCounterSubmitPanel({
  selectedCount,
  totalCount,
  submitNotes,
  setSubmitNotes,
  isSubmitting,
  onSubmit,
}: {
  selectedCount: number;
  totalCount: number;
  submitNotes: string;
  setSubmitNotes: (notes: string) => void;
  isSubmitting: boolean;
  onSubmit: () => void;
}) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
      <p className="text-sm font-medium mb-1" style={{ color: "var(--color-text)" }}>
        Ajukan Rencana SC ke Atasan
      </p>
      <p className="text-xs mb-3" style={{ color: "var(--color-text-muted)" }}>
        {selectedCount === totalCount
          ? `Semua ${totalCount} outlet SC akan diajukan.`
          : selectedCount === 0
          ? "Pilih minimal 1 outlet SC untuk diajukan."
          : `${selectedCount} dari ${totalCount} outlet SC dipilih untuk diajukan.`}
      </p>

      <label className="flex flex-col gap-1 mb-3">
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Notes tambahan untuk atasan (opsional)
        </span>
        <textarea
          value={submitNotes}
          onChange={(e) => setSubmitNotes(e.target.value)}
          rows={2}
          placeholder="mis. konteks strategi insentif Sales Counter di outlet ini…"
          className="input-field text-xs"
        />
      </label>

      <Button
        type="button"
        disabled={selectedCount === 0 || isSubmitting}
        onClick={onSubmit}>
        {isSubmitting ? "Mengajukan…" : "Ajukan ke Atasan"}
      </Button>
    </div>
  );
}
