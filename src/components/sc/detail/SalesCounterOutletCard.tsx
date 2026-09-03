import { useState, useTransition, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { BlastInBadge, InsScBadge } from "@/components/ui/BlastInBadge";
import { deleteSalesCounterFormAction } from "@/app/actions/scActions";
import {
  submitSalesCounterFormAction,
  approveSalesCounterFormAction,
  reviseSalesCounterFormAction,
  rejectSalesCounterFormAction,
  requestEditSalesCounterFormAction,
  grantEditSalesCounterFormAction,
  declineEditSalesCounterFormAction,
} from "@/app/actions/scApprovalActions";
import { formatRp } from "./SalesCounterStatsPanel";
import type { ScDraftFormItem } from "../types";
import { getB3PeriodInfo } from "@/lib/b3Utils";
import { getScOutletB3SalesAction, getScCashbackPoaAction, getSalesCounterProductsAction } from "@/app/actions/canvasser";
import { calculateCashbackDetails } from "../edit/hooks/useSalesCounterCashback";
import { useScToast } from "../ui/ScToast";
import { BlastInTable } from "../edit/BlastInTable";
import { PosmTable } from "../edit/PosmTable";


function formatMonthLabel(m: string) {
  if (m.length !== 6) return m;
  const year = m.slice(0, 4);
  const monthIndex = parseInt(m.slice(4, 6), 10) - 1;
  return new Date(parseInt(year), monthIndex).toLocaleString("id-ID", { month: "short", year: "numeric" });
}

export function SalesCounterOutletCard({
  draft,
  checked,
  onToggle,
  selectable = true,
  poaId,
  userCanEdit,
  isOwner,
  canApprove: parentCanApprove,
  canFastTrack: parentCanFastTrack,
  userRole,
}: {
  draft: ScDraftFormItem;
  checked: boolean;
  onToggle: () => void;
  selectable?: boolean;
  poaId: string;
  userCanEdit?: boolean;
  isOwner?: boolean;
  canApprove?: boolean;
  canFastTrack?: boolean;
  userRole?: string;
}) {
  const router = useRouter();
  const { showToast } = useScToast();

  const canApproveOutlet = useMemo(() => {
    if (draft.status === "DRAFT" || draft.status === "REVISI" || draft.status === "APPROVED_BY_NSM") {
      return false;
    }
    if (userRole === "ADMIN") {
      return ["SUBMITTED_TO_ASM", "SUBMITTED_TO_SM", "SUBMITTED_TO_NSM"].includes(draft.status);
    }
    if (userRole === "ASM") {
      return draft.status === "SUBMITTED_TO_ASM";
    }
    if (userRole === "SM") {
      return draft.status === "SUBMITTED_TO_SM";
    }
    if (userRole === "NSM") {
      return draft.status === "SUBMITTED_TO_NSM";
    }
    if (parentCanApprove) {
      if (draft.status === "SUBMITTED_TO_ASM" || draft.status === "SUBMITTED_TO_SM" || draft.status === "SUBMITTED_TO_NSM") {
        return true;
      }
    }
    return false;
  }, [userRole, draft.status, parentCanApprove]);

  const canFastTrackOutlet = useMemo(() => {
    if (draft.status === "DRAFT" || draft.status === "REVISI" || draft.status === "APPROVED_BY_NSM") {
      return false;
    }
    if (userRole === "NSM" || userRole === "ADMIN" || parentCanFastTrack) {
      return ["SUBMITTED_TO_ASM", "APPROVED_BY_ASM", "SUBMITTED_TO_SM", "APPROVED_BY_SM"].includes(draft.status);
    }
    return false;
  }, [userRole, draft.status, parentCanFastTrack]);

  const canEditThisDraft = useMemo(() => {
    if (userRole === "ADMIN") return true;

    const roleLevel: Record<string, number> = {
      MR: 0,
      ASM: 1,
      SM: 2,
      NSM: 3,
      ADMIN: 4,
    };

    const userLevel = roleLevel[userRole || "MR"] ?? -1;
    let lockLevel = 3;
    if (draft.status === "DRAFT" || draft.status === "REVISI") lockLevel = -1;
    else if (draft.status === "SUBMITTED_TO_ASM") lockLevel = 0;
    else if (draft.status === "APPROVED_BY_ASM" || draft.status === "SUBMITTED_TO_SM") lockLevel = 1;
    else if (draft.status === "APPROVED_BY_SM" || draft.status === "SUBMITTED_TO_NSM") lockLevel = 2;
    else if (draft.status === "APPROVED_BY_NSM") lockLevel = 3;

    if (isOwner) {
      if (userRole === "MR") {
        return (
          draft.status === "DRAFT" ||
          draft.status === "REVISI" ||
          draft.status === "SUBMITTED_TO_ASM"
        );
      }
      if (
        draft.status === "DRAFT" ||
        draft.status === "REVISI" ||
        draft.status === "SUBMITTED_TO_ASM"
      ) return true;
    }

    if (userLevel >= 0 && lockLevel >= 0) {
      if (draft.status === "APPROVED_BY_NSM") return false;
      return userLevel >= lockLevel;
    }

    return false;
  }, [userRole, isOwner, draft.status]);

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

  const [isDeleting, startDelete] = useTransition();

  const lastLog = draft.auditLogs && draft.auditLogs.length > 0 ? draft.auditLogs[draft.auditLogs.length - 1] : null;
  const hasPendingEditRequest = lastLog?.action === "REQUEST_EDIT";
  const pendingEditRequestNotes = hasPendingEditRequest ? (lastLog?.snapshot?.notes || "") : "";

  const lastRevisionLog = useMemo(() => {
    if (!draft.auditLogs || draft.auditLogs.length === 0) return null;
    return [...draft.auditLogs].reverse().find(
      (log) => log.action === "REVISE" || log.action === "REJECT"
    ) || null;
  }, [draft.auditLogs]);

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
    if (!actionNotes.trim()) {
      showToast("Harap isi alasan penolakan permohonan edit.", "error");
      return;
    }
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
        showToast(`Sales Counter ${draft.namaOutlet} telah berhasil diajukan!`, "success");
        setSubmitBoxOpen(false);
        router.refresh();
      } else {
        showToast(res.error || "Gagal mengajukan Sales Counter.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Terjadi kesalahan saat mengajukan.", "error");
    } finally {
      setIsSubmittingOutlet(false);
    }
  }

  async function handleApprove() {
    if (isSubmittingAction) return;
    setIsSubmittingAction(true);
    try {
      const res = await approveSalesCounterFormAction([draft.id], actionNotes);
      if (res.ok) {
        showToast(`Sales Counter ${draft.namaOutlet} telah berhasil disetujui!`, "success");
        setAtasanPanelOpen(false);
        router.refresh();
      } else {
        showToast(res.error || "Gagal menyetujui Sales Counter.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Terjadi kesalahan saat menyetujui.", "error");
    } finally {
      setIsSubmittingAction(false);
    }
  }

  async function handleRevise() {
    if (isSubmittingAction) return;
    if (!confirm(`Minta revisi untuk Sales Counter ${draft.namaOutlet}?`)) return;
    setIsSubmittingAction(true);
    try {
      const res = await reviseSalesCounterFormAction([draft.id], actionNotes);
      if (res.ok) {
        showToast(`Sales Counter ${draft.namaOutlet} dikembalikan ke MR untuk revisi.`, "info");
        setAtasanPanelOpen(false);
        router.refresh();
      } else {
        showToast(res.error || "Gagal meminta revisi.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Terjadi kesalahan saat meminta revisi.", "error");
    } finally {
      setIsSubmittingAction(false);
    }
  }

  async function handleReject() {
    if (isSubmittingAction) return;
    if (!confirm(`Tolak Sales Counter ${draft.namaOutlet}?`)) return;
    setIsSubmittingAction(true);
    try {
      const res = await rejectSalesCounterFormAction([draft.id], actionNotes);
      if (res.ok) {
        showToast(`Sales Counter ${draft.namaOutlet} telah ditolak.`, "error");
        setAtasanPanelOpen(false);
        router.refresh();
      } else {
        showToast(res.error || "Gagal menolak.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Terjadi kesalahan saat menolak.", "error");
    } finally {
      setIsSubmittingAction(false);
    }
  }

  const [b3SalesMap, setB3SalesMap] = useState<Map<string, number>>(new Map());
  const [cashbackData, setCashbackData] = useState<any>(null);
  const [clientScData, setClientScData] = useState<{ codes: Set<string>; total: number } | null>(null);

  useEffect(() => {
    if (draft.kodePI) {
      getScCashbackPoaAction(draft.kodePI).then((res) => setCashbackData(res));
    }
  }, [draft.kodePI]);

  useEffect(() => {
    if (draft.totalScProducts != null) return;
    if (!draft.kodePI) return;
    getSalesCounterProductsAction(draft.kodePI).then((res) => {
      if (res?.data && Array.isArray(res.data)) {
        const scCodes = new Set(res.data.map((cp) => cp.pro_code));
        setClientScData({ codes: scCodes, total: res.data.length });
      }
    });
  }, [draft.totalScProducts, draft.kodePI]);

  const totalScCount = draft.totalScProducts ?? clientScData?.total ?? 0;
  const validScCount = draft.validScProductsCount ?? (
    clientScData
      ? draft.products.filter((p) => clientScData.codes.has(p.kodeProduk)).length
      : draft.products.filter((p) => p.isScProduct).length || draft.products.length
  );
  const [b3RangeLabel, setB3RangeLabel] = useState<string>("");

  const isExpanded = detailOpen;

  useEffect(() => {
    if (!isExpanded || !draft.kodePI) return;
    const proCodes = draft.products.map((p) => p.kodeProduk).filter(Boolean);
    if (proCodes.length === 0) return;

    const b3Info = getB3PeriodInfo(draft.periodeAwal || draft.period || poaId);
    setB3RangeLabel(b3Info.rangeLabel);

    getScOutletB3SalesAction(b3Info.period, draft.kodePI, proCodes).then((res) => {
      const map = new Map<string, number>();
      if (res?.data && Array.isArray(res.data)) {
        for (const item of res.data) {
          if (item.pro_code) map.set(item.pro_code, item.average_sales || 0);
        }
      }
      setB3SalesMap(map);
    });
  }, [isExpanded, draft.kodePI, draft.products, poaId]);

  const lama = draft.lamaPeriode || 3;

  const cbDetails = useMemo(() => {
    return calculateCashbackDetails({
      cashbackData,
      selectedProducts: draft.products.map((p) => ({
        kodeProduk: p.kodeProduk,
        qtyPerBulan: String(p.qtyPerBulan || 0),
        persenCashback: String(p.persenCashback || 0),
      })),
      masterProducts: draft.products.map((p) => ({
        kodeProduk: p.kodeProduk,
        hna: String(p.hnaSJ || 0),
        konversiPembagi: String(p.konversiPembagi || 1),
      })),
      lamaPeriode: draft.lamaPeriode,
    });
  }, [cashbackData, draft]);

  const isCashbackNotFound =
    !cashbackData ||
    cashbackData?.message === "Gudang Tidak Ditemukan" ||
    (typeof cashbackData?.message === "string" &&
      (cashbackData.message.toLowerCase().includes("tidak ditemukan") ||
        cashbackData.message.toLowerCase().includes("gudang"))) ||
    (typeof cashbackData?.data?.message === "string" &&
      (cashbackData.data.message.toLowerCase().includes("tidak ditemukan") ||
        cashbackData.data.message.toLowerCase().includes("gudang"))) ||
    cashbackData?.status === false ||
    cashbackData?.success === false;

  // Compute stats per outlet draft
  let outletEstSales = 0;
  let outletNilaiSc = 0;
  let totalWeightedMatriks = 0;

  for (const p of draft.products) {
    const hnaSJ = p.hnaSJ || 0;
    const qty = p.qtyPerBulan || 0;

    const estMonth = qty * hnaSJ;
    const estFull = estMonth * lama;
    
    const scVal = p.salesCounterValue;
    const scMin = p.salesCounterMinimum || 0;

    let valScPerMonth = 0;
    if (scVal != null && scVal > 0) {
      valScPerMonth = qty >= scMin ? qty * scVal : 0;
    } else {
      valScPerMonth = estMonth * ((p.persenMatriksSc || 0) / 100);
    }
    const valScFull = valScPerMonth * lama;

    outletEstSales += estFull;
    outletNilaiSc += valScFull;
    totalWeightedMatriks += estFull * (p.persenMatriksSc || 0);
  }

  const avgMatriks = outletEstSales > 0 ? totalWeightedMatriks / outletEstSales : 0;
  const totalEntertain = draft.entertainItems.reduce((s, e) => s + (e.biayaEntertain || 0), 0);
  const canvasserNames = draft.persons.map((p) => `${p.personName} (${p.positionName})`).join(", ");

  function handleDelete() {
    if (!confirm(`Hapus rencana POA SC untuk ${draft.namaOutlet}?`)) return;
    startDelete(async () => {
      await deleteSalesCounterFormAction(draft.id);
    });
  }

  return (
    <div
      className="py-3 px-3.5 rounded-lg space-y-2.5"
      style={{ opacity: checked ? 1 : 0.5, border: "1px solid var(--color-border)" }}
    >
      {/* Top Section: Checkbox + Outlet Name & Status */}
      <div className="flex items-start gap-3 justify-between">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {selectable && (
            <input
              type="checkbox"
              checked={checked}
              onChange={onToggle}
              className="h-4 w-4 shrink-0 rounded mt-0.5"
              style={{ accentColor: "var(--color-blue)" }}
            />
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                {draft.kodePI ? `${draft.kodePI} · ` : ""}{draft.namaOutlet}
              </span>
            </div>

            <p className="text-xs font-medium truncate mt-0.5" style={{ color: "var(--color-text-muted)" }}>
              SC: {canvasserNames || "Tidak ada SC"}
            </p>
            <p className="text-[11px] truncate flex items-center gap-2 flex-wrap mt-0.5" style={{ color: "var(--color-text-faint)" }}>
              <span>Karyawan: <strong style={{ color: "var(--color-text-muted)" }}>{draft.jumlahKaryawan ?? 0}</strong></span>
              <span>· Pasien: <strong style={{ color: "var(--color-text-muted)" }}>{draft.jumlahPasien ?? 0}</strong></span>
              <span>· Resep: <strong style={{ color: "var(--color-text-muted)" }}>{draft.jumlahPasienResep ?? 0}</strong></span>
              <span>· Non-Resep: <strong style={{ color: "var(--color-text-muted)" }}>{draft.jumlahPasienNonResep ?? (draft.jumlahPasien != null && draft.jumlahPasienResep != null ? Math.max(0, draft.jumlahPasien - draft.jumlahPasienResep) : 0)}</strong></span>
            </p>
          </div>
        </div>

        <div className="shrink-0">
          <StatusBadge status={draft.status} version={draft.version} />
        </div>
      </div>

      {/* Metrics: minimal, modern 4-column summary */}
      <div
        className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-2 text-xs"
        style={{ borderTop: "1px solid var(--color-border)", borderBottom: "1px solid var(--color-border)" }}
      >
        <div>
          <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>Estimasi Sales</p>
          <p className="text-sm font-semibold mt-0.5" style={{ color: "var(--color-blue)" }}>
            {outletEstSales > 0 ? formatRp(outletEstSales) : "-"}
          </p>
        </div>

        <div>
          <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>Nilai SC (Insentif)</p>
          <p className="text-sm font-semibold mt-0.5" style={{ color: "var(--color-blue)" }}>
            {outletNilaiSc > 0 ? formatRp(outletNilaiSc) : "-"}
          </p>
          {draft.persons.length > 0 && outletNilaiSc > 0 && (
            <p className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>
              ({formatRp(outletNilaiSc / draft.persons.length)} / org)
            </p>
          )}
        </div>

        <div>
          <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>Variasi Produk</p>
          <p className="text-sm font-semibold mt-0.5" style={{ color: "var(--color-text)" }}>
            {totalScCount > 0 ? (
              <span className="whitespace-nowrap">
                <strong style={{ color: "var(--color-text)" }}>{validScCount} / {totalScCount}</strong> produk SC
              </span>
            ) : (
              `${draft.products.length} produk`
            )}
          </p>
          {totalScCount > 0 && validScCount < draft.products.length ? (
            <p className="text-[11px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>
              Total {draft.products.length} produk{" "}
              <span style={{ color: "var(--color-red, #dc2626)" }}>
                ({draft.products.length - validScCount} non-SC)
              </span>
            </p>
          ) : (
            <p className="text-[11px] mt-0.5" style={{ color: "var(--color-text-faint)" }}>
              Total {draft.products.length} produk (semua SC)
            </p>
          )}
        </div>

        <div>
          <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>Entertain SC</p>
          <p className="text-sm font-semibold mt-0.5" style={{ color: "var(--color-text)" }}>
            {totalEntertain > 0 ? formatRp(totalEntertain) : "-"}
          </p>
        </div>
      </div>

      {/* Footer Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <button
          type="button"
          onClick={() => setDetailOpen((v) => !v)}
          className="text-xs hover:underline cursor-pointer"
          style={{ color: "var(--color-text-faint)" }}
        >
          Detail Produk {detailOpen ? "▲" : "▼"}
        </button>

        <div className="flex items-center gap-2 flex-wrap ml-auto">
          <Link
            href={`/sc/${poaId}/edit/${draft.id}`}
            className="text-xs font-medium px-2.5 py-1 rounded-md whitespace-nowrap"
            style={canEditThisDraft ? { background: "var(--color-blue)", color: "#fff" } : { background: "var(--color-blue-light, #eff6ff)", color: "var(--color-blue)", border: "1px solid var(--color-blue)" }}
          >
            {canEditThisDraft ? "Edit" : "Lihat"}
          </Link>

          {userCanEdit && (draft.status === "DRAFT" || draft.status === "REVISI") && (
            <button
              type="button"
              onClick={() => setSubmitBoxOpen((v) => !v)}
              className="text-xs font-semibold px-3 py-1.5 rounded-md whitespace-nowrap text-white transition-opacity hover:opacity-90 cursor-pointer"
              style={{ background: "var(--color-primary-orange, #ea580c)" }}
            >
              Ajukan outlet ini
            </button>
          )}

          {isOwner && !canEditThisDraft && draft.status !== "DRAFT" && draft.status !== "REVISI" && draft.status !== "APPROVED_BY_NSM" && (
            <button
              type="button"
              onClick={() => setRequestEditBoxOpen((v) => !v)}
              className="text-xs font-medium px-2.5 py-1 rounded-md whitespace-nowrap transition-opacity hover:opacity-90 cursor-pointer"
              style={{ background: "var(--color-blue)", color: "#ffffff" }}
            >
              Ajukan Edit
            </button>
          )}

          {(canApproveOutlet || canFastTrackOutlet) && (
            <button
              type="button"
              onClick={() => setAtasanPanelOpen((v) => !v)}
              className="text-xs font-medium px-2.5 py-1 rounded-md whitespace-nowrap transition-opacity hover:opacity-90 cursor-pointer"
              style={{ background: "var(--color-warning, #C99A3D)", color: "#fff" }}
            >
              Approval
            </button>
          )}

          {userCanEdit && (
            <button
              type="button"
              disabled={isDeleting}
              onClick={handleDelete}
              className="text-xs hover:underline cursor-pointer"
              style={{ color: "var(--color-red)" }}
            >
              Hapus
            </button>
          )}
        </div>
      </div>

      {draft.status === "REVISI" && (
        <div className="mt-2.5 p-2.5 rounded-md border text-xs space-y-1" style={{ background: "#fef2f2", borderColor: "#fca5a5", color: "#991b1b" }}>
          <div className="flex items-center gap-1.5 font-semibold">
            <span>📝 Catatan Revisi / Penolakan dari Atasan:</span>
          </div>
          <p className="text-xs leading-relaxed font-normal" style={{ color: "#7f1d1d" }}>
            {lastRevisionLog?.snapshot?.notes || "Atasan meminta revisi pada outlet ini. Silakan perbaiki data lalu klik Ajukan kembali."}
          </p>
        </div>
      )}

      {hasPendingEditRequest && (
        <div className="mt-2.5 p-2.5 rounded-md border text-xs flex items-center justify-between" style={{ background: "var(--color-warning-light, #fef3c7)", borderColor: "var(--color-warning, #f59e0b)", color: "var(--color-warning-dark, #92400e)" }}>
          <span>
            ⚠️ <strong>Permohonan Edit Aktif dari MR:</strong> {pendingEditRequestNotes || "Pemilik draf mengajukan permohonan edit."}
          </span>
        </div>
      )}

      {requestEditBoxOpen && (
        <div
          className="mt-2.5 rounded-lg px-3 py-2.5 text-xs font-medium space-y-2"
          style={{
            background: "var(--color-warning-bg, #fef3c7)",
            color: "var(--color-warning, #f59e0b)",
          }}
        >
          <p>
            Outlet ini terkunci untuk diedit — sudah ada tindakan (approve/edit) dari level ASM ke atas.{" "}
            {hasPendingEditRequest
              ? "Menunggu persetujuan permintaan edit di bawah ini."
              : "Tunggu sampai direject/dibatalkan, atau ajukan permintaan edit di bawah ini."}
          </p>
          {hasPendingEditRequest ? (
            <p className="font-normal">
              Menunggu persetujuan Atasan untuk membuka kembali akses edit.
              {pendingEditRequestNotes ? ` Alasan: "${pendingEditRequestNotes}"` : ""}
            </p>
          ) : (
            <div className="space-y-2 pt-1">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-normal">
                  Alasan permintaan edit (opsional) — akan dikirim ke Atasan yang terakhir approve
                </span>
                <textarea
                  value={requestEditReason}
                  onChange={(e) => setRequestEditReason(e.target.value)}
                  rows={2}
                  placeholder="mis. ada koreksi jumlah/estimasi yang perlu diperbaiki…"
                  className="input-field text-xs"
                />
              </label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={isRequestingEdit}
                  onClick={handleRequestEditSubmit}
                >
                  {isRequestingEdit ? "Mengirim…" : "Ajukan Edit ke Atasan"}
                </Button>
                <button
                  type="button"
                  onClick={() => setRequestEditBoxOpen(false)}
                  className="text-xs font-normal cursor-pointer opacity-70 hover:opacity-100"
                >
                  Batal
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {submitBoxOpen && userCanEdit && (
        <div className="mt-2.5 rounded-lg border p-3 space-y-3" style={{ borderColor: "var(--color-primary-orange, #ea580c)" }}>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
              Notes tambahan (opsional)
            </span>
            <textarea
              value={submitNotes}
              onChange={(e) => setSubmitNotes(e.target.value)}
              rows={2}
              placeholder="mis. konteks tambahan…"
              className="input-field text-xs rounded border p-2"
              style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}
            />
          </label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={isSubmittingOutlet}
              onClick={handleSubmitOutlet}
              style={{ background: "var(--color-primary-orange, #ea580c)", color: "#fff" }}
            >
              {isSubmittingOutlet ? "Memproses…" : `Ajukan ${draft.namaOutlet}`}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSubmitBoxOpen(false)}>
              Batal
            </Button>
          </div>
        </div>
      )}

      {atasanPanelOpen && (canApproveOutlet || canFastTrackOutlet) && (
        <div className="mt-2.5 rounded-lg border p-3 space-y-3" style={{ borderColor: "var(--color-blue)" }}>
          {hasPendingEditRequest && (
            <div className="mt-1 rounded-lg border p-3 space-y-3 mb-2" style={{ borderColor: "var(--color-blue)" }}>
              <p className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>Permintaan Edit</p>
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                {draft.namaOutlet} — MR meminta izin untuk mengedit kembali outlet ini yang sudah disetujui.
                {pendingEditRequestNotes ? ` Alasan: "${pendingEditRequestNotes}"` : ""}
              </p>
              <div>
                <Button
                  type="button"
                  size="sm"
                  disabled={isSubmittingAction}
                  onClick={handleGrantEdit}
                  style={{ background: "var(--color-green, #16a34a)", color: "#fff" }}
                >
                  Setujui Permintaan Edit (kembali ke Revisi)
                </Button>
              </div>
              <div className="pt-2 space-y-2" style={{ borderTop: "1px solid var(--color-border)" }}>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Alasan Menolak</span>
                  <textarea
                    value={actionNotes}
                    onChange={(e) => setActionNotes(e.target.value)}
                    rows={2}
                    placeholder="Jelaskan alasan menolak permintaan edit ini…"
                    className="input-field text-xs"
                  />
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  disabled={isSubmittingAction}
                  onClick={handleDeclineEdit}
                >
                  Tolak Permintaan Edit
                </Button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {canFastTrackOutlet ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={isSubmittingAction}
                onClick={handleApprove}
                style={{ borderColor: "var(--color-warning, #C99A3D)", color: "var(--color-warning, #C99A3D)" }}
              >
                {isSubmittingAction ? "Memproses…" : "Approve Langsung (Lewati ASM/SM)"}
              </Button>
            ) : canApproveOutlet ? (
              <Button
                type="button"
                size="sm"
                disabled={isSubmittingAction}
                onClick={handleApprove}
                style={{ background: "var(--color-green, #16a34a)", color: "#fff" }}
              >
                {isSubmittingAction ? "Memproses…" : "Approve & Teruskan"}
              </Button>
            ) : null}
          </div>

          {canFastTrackOutlet && (
            <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
              Sebagai NSM, Anda bisa langsung menyetujui outlet ini sampai final tanpa menunggu approval ASM/SM.
            </p>
          )}

          <div className="space-y-2 pt-2" style={{ borderTop: "1px solid var(--color-border)" }}>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Kategori Reject</span>
              <select
                value={rejectCategory}
                onChange={(e) => setRejectCategory(e.target.value)}
                className="input-field text-xs rounded border p-2"
                style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}
              >
                <option value="">Pilih kategori…</option>
                <option value="PRODUK">Produk</option>
                <option value="OUTLET">Outlet</option>
                <option value="USER">User / SC</option>
                <option value="PERIODE">Periode</option>
                <option value="KALKULASI_PSSP">Kalkulasi Sales Counter</option>
                <option value="ALASAN_LAIN">Alasan Lain</option>
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Alasan Reject</span>
              <textarea
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                rows={2}
                placeholder={`Jelaskan alasan reject outlet ${draft.namaOutlet} - MR akan melihat catatan ini di Riwayat Aktivitas…`}
                className="input-field text-xs rounded border p-2"
                style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}
              />
            </label>

            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={isSubmittingAction}
              onClick={handleReject}
            >
              {isSubmittingAction ? "Memproses…" : "Tolak Outlet Ini (kembali ke Revisi)"}
            </Button>
          </div>

          <Button type="button" size="sm" variant="ghost" onClick={() => setAtasanPanelOpen(false)}>
            Tutup
          </Button>
        </div>
      )}

      {/* Expanded detail */}
      {detailOpen && (
        <div className="mt-3 space-y-3 pt-2" style={{ borderTop: "1px solid var(--color-border)" }}>
          {/* Products table */}
          <div className="rounded-lg border overflow-hidden overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: "var(--color-bg-subtle)" }}>
                  <th className="text-left px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>Produk SC</th>
                  <th className="text-right px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>Qty ST / Bln</th>
                  <th className="text-right px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>Estimasi Sales</th>
                  <th className="text-right px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>Nilai SC</th>
                  {!isCashbackNotFound && (
                    <th className="text-right px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>Value Cashback</th>
                  )}
                  <th className="text-right px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>
                    <div>Growth Sebelumnya</div>
                    {b3RangeLabel && (
                      <div className="text-[10px] font-normal normal-case opacity-75">
                        ({b3RangeLabel})
                      </div>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {draft.products.map((p) => {
                  const hnaSJ = p.hnaSJ || 0;
                  const qty = p.qtyPerBulan || 0;

                  const estSalesFull = qty * hnaSJ * lama;
                  const scVal = p.salesCounterValue;
                  const scMin = p.salesCounterMinimum || 0;

                  let nilaiScPerMonth = 0;
                  if (scVal != null && scVal > 0) {
                    nilaiScPerMonth = qty >= scMin ? qty * scVal : 0;
                  } else {
                    nilaiScPerMonth = (qty * hnaSJ) * ((p.persenMatriksSc || 0) / 100);
                  }
                  const nilaiScFull = nilaiScPerMonth * lama;
                  const valCashbackFull = cashbackData
                    ? (cbDetails.resultMap.get(p.kodeProduk) ?? 0)
                    : estSalesFull * ((p.persenCashback || 0) / 100);

                  const avgSales = b3SalesMap.get(p.kodeProduk) ?? 0;
                  const salesHistorical = avgSales * lama;
                  let growthPct = 0;
                  if (salesHistorical > 0 && estSalesFull > 0) {
                    growthPct = ((estSalesFull - salesHistorical) / salesHistorical) * 100;
                  }

                  return (
                    <tr key={p.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                      <td className="px-2.5 py-2 font-medium" style={{ color: "var(--color-text)" }}>
                        {p.namaProduk}
                        {totalScCount > 0 && (p.isScProduct === false || (clientScData && !clientScData.codes.has(p.kodeProduk))) && (
                          <span
                            className="text-[10px] font-normal ml-1.5 px-1.5 py-0.5 rounded"
                            style={{ background: "#fef2f2", color: "#b91c1c", border: "1px solid #fca5a5" }}
                          >
                            Non-SC
                          </span>
                        )}
                      </td>
                      <td className="px-2.5 py-2 text-right" style={{ color: "var(--color-text-muted)" }}>{p.qtyPerBulan || 0}</td>
                      <td className="px-2.5 py-2 text-right" style={{ color: "var(--color-text)" }}>{estSalesFull > 0 ? formatRp(estSalesFull) : "-"}</td>
                      <td className="px-2.5 py-2 text-right font-semibold" style={{ color: "var(--color-blue)" }}>{nilaiScFull > 0 ? formatRp(nilaiScFull) : "-"}</td>
                      {!isCashbackNotFound && (
                        <td className="px-2.5 py-2 text-right" style={{ color: "var(--color-text-muted)" }}>{valCashbackFull > 0 ? formatRp(valCashbackFull) : "-"}</td>
                      )}
                      <td className="px-2.5 py-2 text-right" style={{ color: "var(--color-text-muted)" }}>
                        {salesHistorical > 0 ? (
                          <span className={growthPct > 0 ? "text-emerald-600 font-semibold" : growthPct < 0 ? "text-rose-600 font-semibold" : ""}>
                            {growthPct > 0 ? `+${growthPct.toFixed(1)}%` : `${growthPct.toFixed(1)}%`}
                          </span>
                        ) : (
                          "0%"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {b3RangeLabel && (
              <p className="text-[11px] px-3 py-1.5 border-t" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)", background: "var(--color-bg-subtle)" }}>
                * Growth Sebelumnya dihitung dari histori rata-rata penjualan B3 ({b3RangeLabel})
              </p>
            )}
          </div>

          {/* Entertain items breakdown if present */}
          {draft.entertainItems.length > 0 && (
            <div className="rounded-lg border p-2.5" style={{ borderColor: "var(--color-border)", background: "var(--color-bg-subtle)" }}>
              <p className="text-xs font-semibold mb-1" style={{ color: "var(--color-text-muted)" }}>Rencana Entertain SC Bulanan</p>
              <div className="flex gap-4 flex-wrap">
                {draft.entertainItems.map((e) => (
                  <span key={e.id} className="text-xs" style={{ color: "var(--color-text)" }}>
                    {formatMonthLabel(e.periodeMonth)}: <strong>{formatRp(e.biayaEntertain)}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tabel BLAST-IN & POSM (Autofill data) */}
          {draft.isBlastIn && <BlastInTable poaPeriod={draft.period} />}
          {(draft.isPosm || draft.kodePI === "F4002441") && <PosmTable />}
        </div>
      )}
    </div>
  );
}
