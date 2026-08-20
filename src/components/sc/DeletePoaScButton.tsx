"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSalesCounterPeriodAction } from "@/app/actions/scActions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export function DeletePoaScButton({ period }: { period: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteSalesCounterPeriodAction(period);
      if (result.error) {
        setError(result.error);
        setOpen(false);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setError(null); setOpen(true); }}
        className="text-xs font-medium"
        style={{ color: "var(--color-red, #dc2626)" }}
      >
        Delete
      </button>
      {error && (
        <span className="block text-xs mt-0.5" style={{ color: "var(--color-red, #dc2626)" }}>{error}</span>
      )}
      <ConfirmDialog
        open={open}
        tone="danger"
        title="Hapus draft POA Sales Counter ini?"
        message={`Draft POA Sales Counter periode ${period} akan dihapus permanen beserta semua draf outlet dan rencana di dalamnya. Tindakan ini tidak bisa dibatalkan.`}
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        confirmPending={isPending}
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
