"use client";

import { useState } from "react";
import { useScToast } from "../../ui/ScToast";
import {
  approveSalesCounterFormAction,
  reviseSalesCounterFormAction,
} from "@/app/actions/scApprovalActions";

export function useBulkApprovalActions({
  selectedCount,
  selectedIds,
  onActionComplete,
}: {
  selectedCount: number;
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

  return {
    actionNotes,
    setActionNotes,
    isSubmitting,
    approveConfirmOpen,
    setApproveConfirmOpen,
    reviseConfirmOpen,
    setReviseConfirmOpen,
    handleApproveClick,
    executeApprove,
    handleReviseClick,
    executeRevise,
  };
}
