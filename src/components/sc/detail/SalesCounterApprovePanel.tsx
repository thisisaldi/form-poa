"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useScToast } from "../ui/ScToast";
import {
  approveSalesCounterFormAction,
  reviseSalesCounterFormAction,
} from "@/app/actions/scApprovalActions";

export function SalesCounterApprovePanel({
  selectedCount,
  actionableCount,
  totalCount,
  selectedIds,
  onActionComplete,
}: {
  selectedCount: number;
  actionableCount: number;
  totalCount: number;
  selectedIds: string[];
  onActionComplete?: () => void;
}) {
  const [actionNotes, setActionNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);
  const [reviseConfirmOpen, setReviseConfirmOpen] = useState(false);
  const { showToast } = useScToast();

  function handleApproveClick() {
    if (selectedCount === 0 || isSubmitting) return;
    setApproveConfirmOpen(true);
  }

  async function executeApprove() {
    if (selectedIds.length === 0) return;
    setIsSubmitting(true);
    try {
      const res = await approveSalesCounterFormAction(selectedIds, actionNotes);
      setApproveConfirmOpen(false);
      if (res.ok) {
        showToast(
          `Berhasil menyetujui ${res.count ?? selectedCount} outlet Sales Counter.`,
          "success"
        );
        if (onActionComplete) {
          onActionComplete();
        } else {
          setTimeout(() => window.location.reload(), 800);
        }
      } else {
        showToast(res.error || "Gagal menyetujui Sales Counter.", "error");
      }
    } catch (err: any) {
      setApproveConfirmOpen(false);
      showToast(err?.message || "Terjadi kesalahan saat menyetujui.", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleReviseClick() {
    if (selectedCount === 0 || isSubmitting) return;
    if (!actionNotes.trim()) {
      showToast(
        "Harap isi catatan atasan terlebih dahulu agar MR memahami perbaikan yang perlu dilakukan.",
        "error"
      );
      return;
    }
    setReviseConfirmOpen(true);
  }

  async function executeRevise() {
    if (selectedIds.length === 0) return;
    setIsSubmitting(true);
    try {
      const res = await reviseSalesCounterFormAction(selectedIds, actionNotes);
      setReviseConfirmOpen(false);
      if (res.ok) {
        showToast(
          `${selectedCount} outlet Sales Counter telah dikembalikan ke MR untuk perbaikan.`,
          "info"
        );
        if (onActionComplete) {
          onActionComplete();
        } else {
          setTimeout(() => window.location.reload(), 800);
        }
      } else {
        showToast(res.error || "Gagal meminta revisi.", "error");
      }
    } catch (err: any) {
      setReviseConfirmOpen(false);
      showToast(err?.message || "Terjadi kesalahan saat meminta revisi.", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className="rounded-lg border p-4 shadow-xs"
      style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}
    >
      <div className="flex items-center justify-between mb-1 gap-2">
        <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
          Persetujuan Massal (Bulk Approval)
        </p>
        <span
          className="text-xs px-2.5 py-0.5 rounded-full font-medium shrink-0"
          style={{
            background: selectedCount > 0 ? "var(--color-blue-subtle, #eff6ff)" : "var(--color-bg-subtle)",
            color: selectedCount > 0 ? "var(--color-blue)" : "var(--color-text-muted)",
          }}
        >
          {selectedCount} dari {actionableCount} dipilih
        </span>
      </div>

      <p className="text-xs mb-3" style={{ color: "var(--color-text-muted)" }}>
        {actionableCount === 0
          ? "Seluruh outlet sudah disetujui atau sedang dalam proses perbaikan (Revisi)."
          : selectedCount === 0
          ? `Terdapat ${actionableCount} outlet yang menunggu persetujuan Anda. Centang outlet yang ingin diproses.`
          : `${selectedCount} outlet terpilih siap disetujui atau dikembalikan untuk revisi.`}
      </p>

      <label className="flex flex-col gap-1 mb-3">
        <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
          Catatan Atasan (opsional untuk setujui, wajib untuk minta revisi)
        </span>
        <textarea
          value={actionNotes}
          onChange={(e) => setActionNotes(e.target.value)}
          rows={2}
          placeholder="Tuliskan arahan persetujuan atau poin catatan yang harus diperbaiki MR..."
          className="input-field text-xs"
        />
      </label>

      <div className="flex items-center gap-2.5 flex-wrap">
        <Button
          type="button"
          size="sm"
          disabled={selectedCount === 0 || isSubmitting}
          onClick={handleApproveClick}
          style={{
            background: selectedCount > 0 ? "var(--color-green, #16a34a)" : undefined,
            color: selectedCount > 0 ? "#fff" : undefined,
            borderColor: selectedCount > 0 ? "var(--color-green, #16a34a)" : undefined,
          }}
        >
          ✓ Setujui {selectedCount > 0 ? `(${selectedCount})` : ""} Outlet Terpilih
        </Button>

        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={selectedCount === 0 || isSubmitting}
          onClick={handleReviseClick}
          style={{
            color: selectedCount > 0 ? "var(--color-warning, #f59e0b)" : undefined,
            borderColor: selectedCount > 0 ? "var(--color-warning, #f59e0b)" : undefined,
          }}
        >
          ↺ Minta Revisi {selectedCount > 0 ? `(${selectedCount})` : ""}
        </Button>
      </div>

      <ConfirmDialog
        open={approveConfirmOpen}
        tone="success"
        title="Setujui Outlet Terpilih?"
        message={`Apakah Anda yakin ingin menyetujui ${selectedCount} outlet Sales Counter yang dipilih? Dokumen akan diteruskan ke jenjang berikutnya.`}
        confirmLabel="Ya, Setujui"
        cancelLabel="Batal"
        confirmPending={isSubmitting}
        onConfirm={executeApprove}
        onCancel={() => setApproveConfirmOpen(false)}
      />

      <ConfirmDialog
        open={reviseConfirmOpen}
        tone="warning"
        title="Minta Revisi Outlet Terpilih?"
        message={`Kembalikan ${selectedCount} outlet Sales Counter yang dipilih ke MR untuk revisi? MR akan dapat memperbaiki dan mengajukan ulang dokumen ini.`}
        confirmLabel="Minta Revisi"
        cancelLabel="Batal"
        confirmPending={isSubmitting}
        onConfirm={executeRevise}
        onCancel={() => setReviseConfirmOpen(false)}
      />
    </div>
  );
}
