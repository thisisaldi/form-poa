"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteDoctorAction } from "@/app/actions/poa";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export function DeleteDoctorButton({ poaId, kodePI, namaCust }: { poaId: string; kodePI: string; namaCust: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteDoctorAction(poaId, kodePI, namaCust);
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
        Hapus
      </button>
      {error && (
        <span className="block text-xs mt-0.5" style={{ color: "var(--color-red, #dc2626)" }}>{error}</span>
      )}
      <ConfirmDialog
        open={open}
        tone="danger"
        title="Hapus dokter ini?"
        message={`${namaCust} beserta semua baris produk, riwayat approval, dan audit trail-nya (khusus dokter ini) akan dihapus permanen — termasuk kalau sudah fully approved. Tindakan ini tidak bisa dibatalkan.`}
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        confirmPending={isPending}
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
