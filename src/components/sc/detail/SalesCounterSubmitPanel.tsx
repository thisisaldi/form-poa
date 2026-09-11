"use client";

import { Button } from "@/components/ui/Button";

export function SalesCounterSubmitPanel({
  selectedCount,
  submittableCount,
  totalCount,
  submitNotes,
  setSubmitNotes,
  isSubmitting,
  onSubmit,
}: {
  selectedCount: number;
  submittableCount: number;
  totalCount: number;
  submitNotes: string;
  setSubmitNotes: (notes: string) => void;
  isSubmitting: boolean;
  onSubmit: () => void;
}) {
  const nonSubmittable = selectedCount - submittableCount;

  let statusText: string;
  if (selectedCount === 0) {
    statusText = "Pilih minimal 1 outlet SC untuk diajukan.";
  } else if (submittableCount === 0) {
    statusText = `${selectedCount} outlet dipilih, namun tidak ada yang bisa diajukan (sudah diajukan / selesai).`;
  } else if (nonSubmittable > 0) {
    statusText = `${submittableCount} dari ${selectedCount} outlet yang dipilih akan diajukan. ${nonSubmittable} lainnya dilewati (sudah diajukan/selesai).`;
  } else if (submittableCount === totalCount) {
    statusText = `Semua ${totalCount} outlet SC yang dipilih akan diajukan.`;
  } else {
    statusText = `${submittableCount} outlet SC dipilih untuk diajukan.`;
  }

  return (
    <div
      className="rounded-lg border p-4"
      style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
      <p className="text-sm font-medium mb-1" style={{ color: "var(--color-text)" }}>
        Ajukan Rencana SC ke Atasan
      </p>
      <p className="text-xs mb-3" style={{ color: "var(--color-text-muted)" }}>
        {statusText}
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
        disabled={submittableCount === 0 || isSubmitting}
        onClick={onSubmit}>
        {isSubmitting ? "Mengajukan…" : submittableCount > 0 ? `Ajukan ${submittableCount} Outlet ke Atasan` : "Ajukan ke Atasan"}
      </Button>
    </div>
  );
}

