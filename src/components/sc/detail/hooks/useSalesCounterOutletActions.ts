"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { deleteSalesCounterFormAction } from "@/app/actions/scActions";
import {
  submitSalesCounterFormAction,
  approveSalesCounterFormAction,
  rejectSalesCounterFormAction,
  requestEditSalesCounterFormAction,
  grantEditSalesCounterFormAction,
  declineEditSalesCounterFormAction,
} from "@/app/actions/scApprovalActions";
import { useScToast } from "../../ui/ScToast";
import {
  ROLE_ACTIONABLE_STATUSES,
  FAST_TRACK_STATUSES,
  NON_ACTIONABLE_STATUSES,
} from "../constants/approvalRoles";
import {
  extractPendingEditRequest,
  extractLastRevisionLog,
  extractRevisionInfo,
} from "../utils/auditLogUtils";
import type { ScDraftFormItem } from "../../types";

export function useSalesCounterOutletActions({
  draft,
  userRole,
  isOwner,
  parentCanApprove,
  parentCanFastTrack,
}: {
  draft: ScDraftFormItem;
  userRole?: string;
  isOwner?: boolean;
  parentCanApprove?: boolean;
  parentCanFastTrack?: boolean;
}) {
  const router = useRouter();
  const { showToast } = useScToast();

  const [detailOpen, setDetailOpen] = useState(false);
  const [atasanPanelOpen, setAtasanPanelOpen] = useState(false);
  const [submitBoxOpen, setSubmitBoxOpen] = useState(false);
  const [requestEditBoxOpen, setRequestEditBoxOpen] = useState(false);
  const [requestEditReason, setRequestEditReason] = useState("");
  const [isRequestingEdit, setIsRequestingEdit] = useState(false);
  const [submitNotes, setSubmitNotes] = useState("");
  const [actionNotes, setActionNotes] = useState("");
  const [rejectCategory, setRejectCategory] = useState("");
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [isSubmittingOutlet, setIsSubmittingOutlet] = useState(false);
  const [declineBoxOpen, setDeclineBoxOpen] = useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false);

  const [isDeleting, startDelete] = useTransition();

  const canApproveOutlet = useMemo(() => {
    if (isOwner && userRole !== "ADMIN") return false;
    if (NON_ACTIONABLE_STATUSES.includes(draft.status)) {
      return false;
    }
    if (userRole && ROLE_ACTIONABLE_STATUSES[userRole]) {
      return ROLE_ACTIONABLE_STATUSES[userRole].includes(draft.status);
    }
    if (parentCanApprove) {
      return ["SUBMITTED_TO_ASM", "SUBMITTED_TO_SM", "SUBMITTED_TO_NSM"].includes(draft.status);
    }
    return false;
  }, [userRole, draft.status, parentCanApprove, isOwner]);

  const canFastTrackOutlet = useMemo(() => {
    if (NON_ACTIONABLE_STATUSES.includes(draft.status)) {
      return false;
    }
    if (userRole === "NSM" || userRole === "ADMIN" || parentCanFastTrack) {
      return FAST_TRACK_STATUSES.includes(draft.status);
    }
    return false;
  }, [userRole, draft.status, parentCanFastTrack]);

  const isSelectableForThisUser = useMemo(() => {
    if (isOwner) {
      return draft.status === "DRAFT" || draft.status === "REVISI";
    }
    if (parentCanApprove) {
      return canApproveOutlet;
    }
    return true;
  }, [isOwner, parentCanApprove, canApproveOutlet, draft.status]);

  const canRespondEdit = useMemo(() => {
    return !isOwner && ["ASM", "SM", "NSM", "ADMIN"].includes(userRole || "");
  }, [isOwner, userRole]);

  const { hasPendingEditRequest, pendingEditRequestNotes } = useMemo(() => {
    return extractPendingEditRequest(draft.auditLogs);
  }, [draft.auditLogs]);

  const lastRevisionLog = useMemo(() => {
    return extractLastRevisionLog(draft.auditLogs);
  }, [draft.auditLogs]);

  const revisionInfo = useMemo(() => {
    return extractRevisionInfo(draft.auditLogs, lastRevisionLog);
  }, [lastRevisionLog, draft.auditLogs]);

  async function handleRequestEditSubmit() {
    if (isRequestingEdit) return;
    setIsRequestingEdit(true);
    try {
      const res = await requestEditSalesCounterFormAction([draft.id], requestEditReason);
      if (res.ok) {
        showToast("Permohonan edit berhasil dikirim ke Atasan.", "success");
        setRequestEditBoxOpen(false);
        router.refresh();
      } else {
        showToast(res.error || "Gagal mengajukan permohonan edit.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Terjadi kesalahan saat mengajukan permohonan edit.", "error");
    } finally {
      setIsRequestingEdit(false);
    }
  }

  async function handleGrantEdit() {
    if (isSubmittingAction) return;
    setIsSubmittingAction(true);
    try {
      const res = await grantEditSalesCounterFormAction([draft.id], actionNotes);
      if (res.ok) {
        showToast("Permohonan edit disetujui. Dokumen dikembalikan ke status Revisi.", "success");
        setAtasanPanelOpen(false);
        router.refresh();
      } else {
        showToast(res.error || "Gagal menyetujui izin edit.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Terjadi kesalahan.", "error");
    } finally {
      setIsSubmittingAction(false);
    }
  }

  async function handleDeclineEdit() {
    if (isSubmittingAction) return;
    setIsSubmittingAction(true);
    try {
      const res = await declineEditSalesCounterFormAction([draft.id], actionNotes);
      if (res.ok) {
        showToast("Permohonan edit ditolak.", "info");
        setAtasanPanelOpen(false);
        router.refresh();
      } else {
        showToast(res.error || "Gagal menolak izin edit.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Terjadi kesalahan.", "error");
    } finally {
      setIsSubmittingAction(false);
    }
  }

  async function handleSubmitOutlet() {
    if (isSubmittingOutlet) return;
    setIsSubmittingOutlet(true);
    try {
      const res = await submitSalesCounterFormAction([draft.id], submitNotes);
      if (res.ok) {
        showToast(`Outlet ${draft.namaOutlet || draft.kodePI} berhasil diajukan.`, "success");
        setSubmitBoxOpen(false);
        router.refresh();
      } else {
        showToast(res.error || "Gagal mengajukan outlet.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Terjadi kesalahan saat mengajukan.", "error");
    } finally {
      setIsSubmittingOutlet(false);
    }
  }

  async function handleApproveOutlet() {
    if (isSubmittingAction) return;
    setIsSubmittingAction(true);
    try {
      const res = await approveSalesCounterFormAction([draft.id], actionNotes);
      if (res.ok) {
        showToast(`Outlet ${draft.namaOutlet || draft.kodePI} berhasil disetujui.`, "success");
        setAtasanPanelOpen(false);
        router.refresh();
      } else {
        showToast(res.error || "Gagal menyetujui outlet.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Terjadi kesalahan saat menyetujui.", "error");
    } finally {
      setIsSubmittingAction(false);
    }
  }

  async function handleFastTrackOutlet() {
    if (isSubmittingAction) return;
    setIsSubmittingAction(true);
    try {
      const res = await approveSalesCounterFormAction([draft.id], actionNotes);
      if (res.ok) {
        showToast(`Outlet ${draft.namaOutlet || draft.kodePI} berhasil disetujui (Fast-Track).`, "success");
        setAtasanPanelOpen(false);
        router.refresh();
      } else {
        showToast(res.error || "Gagal menyetujui outlet.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Terjadi kesalahan saat menyetujui.", "error");
    } finally {
      setIsSubmittingAction(false);
    }
  }

  async function handleRejectSubmit() {
    if (isSubmittingAction) return;
    if (!actionNotes.trim()) {
      showToast("Harap isi catatan revisi/penolakan.", "error");
      return;
    }
    setIsSubmittingAction(true);
    try {
      const res = await rejectSalesCounterFormAction(
        [draft.id],
        actionNotes,
        rejectCategory || "ALASAN_LAIN"
      );
      setRejectConfirmOpen(false);
      if (res.ok) {
        showToast(`Outlet ${draft.namaOutlet || draft.kodePI} dikembalikan ke MR untuk revisi.`, "info");
        setAtasanPanelOpen(false);
        router.refresh();
      } else {
        showToast(res.error || "Gagal menolak.", "error");
      }
    } catch (err: any) {
      setRejectConfirmOpen(false);
      showToast(err?.message || "Terjadi kesalahan saat menolak.", "error");
    } finally {
      setIsSubmittingAction(false);
    }
  }

  function handleDelete() {
    setDeleteConfirmOpen(true);
  }

  async function executeDelete() {
    startDelete(async () => {
      try {
        const res = await deleteSalesCounterFormAction(draft.id);
        setDeleteConfirmOpen(false);
        if (res.ok) {
          showToast("Rencana POA outlet berhasil dihapus.", "success");
          router.refresh();
        } else {
          showToast(res.error || "Gagal menghapus rencana POA.", "error");
        }
      } catch (err: any) {
        setDeleteConfirmOpen(false);
        showToast(err?.message || "Terjadi kesalahan saat menghapus.", "error");
      }
    });
  }

  return {
    canApproveOutlet,
    canFastTrackOutlet,
    isSelectableForThisUser,
    detailOpen,
    setDetailOpen,
    atasanPanelOpen,
    setAtasanPanelOpen,
    submitBoxOpen,
    setSubmitBoxOpen,
    requestEditBoxOpen,
    setRequestEditBoxOpen,
    requestEditReason,
    setRequestEditReason,
    isRequestingEdit,
    submitNotes,
    setSubmitNotes,
    actionNotes,
    setActionNotes,
    rejectCategory,
    setRejectCategory,
    isSubmittingAction,
    isSubmittingOutlet,
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    rejectConfirmOpen,
    setRejectConfirmOpen,
    isDeleting,
    hasPendingEditRequest,
    pendingEditRequestNotes,
    canRespondEdit,
    declineBoxOpen,
    setDeclineBoxOpen,
    lastRevisionLog,
    revisionInfo,
    handleRequestEditSubmit,
    handleGrantEdit,
    handleDeclineEdit,
    handleSubmitOutlet,
    handleApproveOutlet,
    handleFastTrackOutlet,
    handleRejectSubmit,
    handleDelete,
    executeDelete,
  };
}
