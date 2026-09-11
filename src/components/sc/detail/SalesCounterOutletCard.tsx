import { useMemo } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatRp } from "./SalesCounterStatsPanel";
import { BlastInTable } from "../edit/BlastInTable";
import { PosmTable } from "../edit/PosmTable";
import { ProdukKompetitorSidebar } from "./ProdukKompetitorSidebar";
import { InfoTooltip } from "../edit/ProductSelector";
import { REJECT_CATEGORY_LABELS, REJECT_CATEGORY_OPTIONS } from "./constants/rejectCategories";
import { useSalesCounterOutletActions } from "./hooks/useSalesCounterOutletActions";
import { useSalesCounterOutletData } from "./hooks/useSalesCounterOutletData";
import { formatMonthLabel } from "./utils/formatDateUtils";
import type { SalesCounterOutletCardProps } from "./types";

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
  isKompetitorOpen = false,
  onToggleKompetitor,
  onCloseKompetitor,
}: SalesCounterOutletCardProps) {
  const actions = useSalesCounterOutletActions({
    draft,
    userRole,
    isOwner,
    parentCanApprove,
    parentCanFastTrack,
  });

  const {
    canApproveOutlet,
    canFastTrackOutlet,
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
  } = actions;

  const outletData = useSalesCounterOutletData({
    draft,
    poaId,
    isExpanded: detailOpen,
  });

  const {
    allScProducts,
    scProducts,
    selectedProductCodes,
    totalScCount,
    validScCount,
    lama,
    b3RangeLabel,
    b3TotalCount,
    isLoadingB3,
    isCashbackNotFound,
    outletEstSales,
    outletNilaiSc,
    totalEntertain,
    canvasserNames,
    historyInsentifInfo,
    insentifGrowthPct,
    salesOnlineData,
    isLoadingSalesOnline,
    surveyNexusData,
    productDetailRows,
  } = outletData;

  const strategyCounts = useMemo(() => {
    let intensifikasi = 0;
    let ekstensifikasi = 0;
    let penurunan = 0;
    let tetap = 0;

    for (const row of productDetailRows.rows) {
      if (row.salesHistorical <= 0) {
        ekstensifikasi++;
      } else if (row.growthPct > 0) {
        intensifikasi++;
      } else if (row.growthPct < 0) {
        penurunan++;
      } else {
        tetap++;
      }
    }
    return { intensifikasi, ekstensifikasi, penurunan, tetap };
  }, [productDetailRows.rows]);

  return (
    <div
      className="py-3 px-3.5 rounded-lg space-y-2.5"
      style={{
        opacity: checked || !selectable ? 1 : 0.65,
        border: "1px solid var(--color-border)",
      }}
    >
      {/* Top Section: Checkbox + Outlet Name & Status */}
      <div className="flex items-start gap-3 justify-between">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {selectable && (
            <input
              type="checkbox"
              checked={checked}
              onChange={onToggle}
              className="h-4 w-4 shrink-0 rounded mt-0.5 cursor-pointer"
              style={{ accentColor: "var(--color-blue)" }}
              title="Pilih outlet untuk statistik, export, atau pengajuan"
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
          {draft.lamaPeriode && draft.lamaPeriode > 1 && outletEstSales > 0 && (
            <p className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>
              ({formatRp(outletEstSales / draft.lamaPeriode)} / bln)
            </p>
          )}
        </div>

        <div>
          <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>Insentif SC</p>
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
              `${scProducts.length} produk SC`
            )}
          </p>
          {isLoadingB3 ? (
            <div className="flex items-center gap-1.5 mt-1">
              <span className="inline-block h-4 w-20 bg-slate-200 dark:bg-slate-700/60 rounded-full animate-pulse" />
            </div>
          ) : (
            (strategyCounts.intensifikasi > 0 || strategyCounts.ekstensifikasi > 0 || strategyCounts.penurunan > 0) && (
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {strategyCounts.intensifikasi > 0 && (
                  <span
                    className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      background: "rgba(147, 51, 234, 0.12)",
                      color: "#7e22ce",
                      border: "1px solid rgba(147, 51, 234, 0.28)",
                    }}
                  >
                    {strategyCounts.intensifikasi} Intensifikasi
                  </span>
                )}
                {strategyCounts.ekstensifikasi > 0 && (
                  <span
                    className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      background: "rgba(37, 99, 235, 0.12)",
                      color: "#1d4ed8",
                      border: "1px solid rgba(37, 99, 235, 0.28)",
                    }}
                  >
                    {strategyCounts.ekstensifikasi} Ekstensifikasi
                  </span>
                )}
                {strategyCounts.penurunan > 0 && (
                  <span
                    className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      background: "rgba(225, 29, 72, 0.12)",
                      color: "#be123c",
                      border: "1px solid rgba(225, 29, 72, 0.28)",
                    }}
                  >
                    {strategyCounts.penurunan} Penurunan
                  </span>
                )}
              </div>
            )
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
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => {
              if (detailOpen && isKompetitorOpen) {
                onCloseKompetitor?.();
              }
              setDetailOpen((v) => !v);
            }}
            className="text-xs hover:underline cursor-pointer"
            style={{ color: "var(--color-text-faint)" }}
          >
            Detail Produk {detailOpen ? "▲" : "▼"}
          </button>

          {draft.updatedAt && (
            <span className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>
              Terakhir diperbarui: {new Date(draft.updatedAt).toLocaleString("id-ID", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap ml-auto">
          <Link
            href={`/sc/${poaId}/edit/${draft.id}`}
            className="text-xs font-medium px-2.5 py-1 rounded-md whitespace-nowrap"
            style={{
              background: "var(--color-blue-light, #eff6ff)",
              color: "var(--color-blue)",
              border: "1px solid var(--color-blue)",
            }}
          >
            Lihat
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

      {draft.status === "REVISI" && (() => {
        const categoryLabel = revisionInfo?.category
          ? (REJECT_CATEGORY_LABELS[revisionInfo.category] || revisionInfo.category)
          : "";
        return (
          <div className="mt-2.5 p-3 rounded-lg border text-xs space-y-1.5" style={{ background: "#fef2f2", borderColor: "#fca5a5", color: "#991b1b" }}>
            <div className="flex items-center gap-1.5 font-semibold">
              <span>
                {revisionInfo?.action === "REJECT" ? (
                  <>Ditolak{revisionInfo.actorLabel ? ` oleh ${revisionInfo.actorLabel}` : ""}{categoryLabel ? ` — Kategori: ${categoryLabel}` : ""}:</>
                ) : revisionInfo?.action === "GRANT_EDIT" ? (
                  <>Permohonan Edit Disetujui{revisionInfo.actorLabel ? ` oleh ${revisionInfo.actorLabel}` : ""}:</>
                ) : (
                  <>Diminta Revisi{revisionInfo?.actorLabel ? ` oleh ${revisionInfo.actorLabel}` : " dari Atasan"}:</>
                )}
              </span>
            </div>
            {revisionInfo?.notes ? (
              <p className="text-xs leading-relaxed font-normal" style={{ color: "#7f1d1d" }}>
                {revisionInfo.notes}
              </p>
            ) : (
              <p className="text-xs leading-relaxed font-normal" style={{ color: "#7f1d1d" }}>
                Atasan meminta revisi pada outlet ini. Silakan perbaiki data lalu klik Ajukan kembali.
              </p>
            )}
            {revisionInfo?.action === "GRANT_EDIT" && revisionInfo.requestEditReasonText && (
              <p className="text-[11px] leading-relaxed font-normal opacity-85 pt-1 border-t" style={{ borderColor: "#fca5a5", color: "#7f1d1d" }}>
                Alasan pengajuan edit dari MR: {revisionInfo.requestEditReasonText}
              </p>
            )}
          </div>
        );
      })()}

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
                onClick={handleFastTrackOutlet}
                style={{ borderColor: "var(--color-warning, #C99A3D)", color: "var(--color-warning, #C99A3D)" }}
              >
                {isSubmittingAction ? "Memproses…" : "Approve Langsung (Lewati ASM/SM)"}
              </Button>
            ) : canApproveOutlet ? (
              <Button
                type="button"
                size="sm"
                disabled={isSubmittingAction}
                onClick={handleApproveOutlet}
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
                {REJECT_CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
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
              onClick={() => setRejectConfirmOpen(true)}
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
          {/* Summary / Comparison Metrics: History vs Estimation Nilai Insentif SC, Growth, Variasi Produk */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3 rounded-lg border" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
            {/* Tile 1: Nilai Insentif SC */}
            <div className="p-2.5 rounded-md border space-y-1" style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
                  Nilai Insentif SC
                </span>
                {insentifGrowthPct != null ? (
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.2 rounded"
                    style={{
                      background: insentifGrowthPct >= 0 ? "var(--color-success-bg, #dcfce7)" : "#fee2e2",
                      color: insentifGrowthPct >= 0 ? "var(--color-success, #16a34a)" : "#dc2626",
                    }}
                  >
                    {insentifGrowthPct >= 0 ? `+${insentifGrowthPct.toFixed(1)}%` : `${insentifGrowthPct.toFixed(1)}%`}
                  </span>
                ) : null}
              </div>
              <div className="text-sm font-bold" style={{ color: "var(--color-blue)" }}>
                {productDetailRows.sumNilaiScPerMonth > 0 ? (
                  <>
                    {formatRp(productDetailRows.sumNilaiScPerMonth)}
                    <span className="text-xs font-semibold ml-1" style={{ color: "var(--color-blue)" }}>
                      / bln
                    </span>
                    <span className="text-[10px] font-normal ml-1" style={{ color: "var(--color-text-faint)" }}>
                      (Estimasi)
                    </span>
                  </>
                ) : (
                  "-"
                )}
              </div>
              <div className="pt-1.5 border-t text-[11px] space-y-0.5" style={{ borderColor: "var(--color-border)" }}>
                <div style={{ color: "var(--color-text-muted)" }}>
                  Histori Insentif (B-3):
                </div>
                <div className="font-semibold text-xs" style={{ color: "var(--color-text)" }}>
                  {historyInsentifInfo && historyInsentifInfo.avgB3Insentif > 0 ? (
                    <>
                      {formatRp(historyInsentifInfo.avgB3Insentif)}
                      <span className="font-normal text-[11px] ml-1" style={{ color: "var(--color-text-muted)" }}>
                        / bln
                      </span>
                      {b3RangeLabel && (
                        <span className="font-normal text-[10px] ml-1.5" style={{ color: "var(--color-text-muted)" }}>
                          ({b3RangeLabel})
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      Belum ada data
                      {b3RangeLabel && (
                        <span className="font-normal text-[10px] ml-1.5" style={{ color: "var(--color-text-muted)" }}>
                          ({b3RangeLabel})
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Tile 2: Total Sales & Growth */}
            <div className="p-2.5 rounded-md border space-y-1" style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
                  Sales &amp; Growth Total
                </span>
                {isLoadingB3 ? (
                  <span className="inline-block h-4 w-16 bg-slate-200 dark:bg-slate-700/60 rounded animate-pulse" />
                ) : (
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.2 rounded"
                    style={{
                      background:
                        productDetailRows.effectiveOutletSalesFull > 0
                          ? productDetailRows.overallGrowthPct >= 0
                            ? "var(--color-success-bg, #dcfce7)"
                            : "#fee2e2"
                          : "var(--color-bg-subtle)",
                      color:
                        productDetailRows.effectiveOutletSalesFull > 0
                          ? productDetailRows.overallGrowthPct >= 0
                            ? "var(--color-success, #16a34a)"
                            : "#dc2626"
                          : "var(--color-text-faint)",
                    }}
                  >
                    {productDetailRows.effectiveOutletSalesFull > 0
                      ? `${productDetailRows.overallGrowthPct >= 0 ? "+" : ""}${productDetailRows.overallGrowthPct.toFixed(1)}% Growth`
                      : "Produk Baru"}
                  </span>
                )}
              </div>
              <div className="text-sm font-bold" style={{ color: "var(--color-text)" }}>
                {productDetailRows.sumEstSalesPerMonth > 0 ? (
                  <>
                    {formatRp(productDetailRows.sumEstSalesPerMonth)}
                    <span className="text-xs font-semibold ml-1" style={{ color: "var(--color-text)" }}>
                      / bln
                    </span>
                    <span className="text-[10px] font-normal ml-1" style={{ color: "var(--color-text-faint)" }}>
                      (Estimasi)
                    </span>
                  </>
                ) : (
                  "-"
                )}
              </div>
              <div className="pt-1.5 border-t text-[11px] space-y-0.5" style={{ borderColor: "var(--color-border)" }}>
                <div style={{ color: "var(--color-text-muted)" }}>
                  Histori Sales (B-3):
                </div>
                <div className="font-semibold text-xs" style={{ color: "var(--color-text)" }}>
                  {isLoadingB3 ? (
                    <span className="inline-block h-3.5 w-24 bg-slate-200 dark:bg-slate-700/60 rounded animate-pulse mt-0.5" />
                  ) : productDetailRows.effectiveOutletSalesPerMonth > 0 ? (
                    <>
                      {formatRp(productDetailRows.effectiveOutletSalesPerMonth)}
                      <span className="font-normal text-[11px] ml-1" style={{ color: "var(--color-text-muted)" }}>
                        / bln
                      </span>
                      {b3RangeLabel && (
                        <span className="font-normal text-[10px] ml-1.5" style={{ color: "var(--color-text-muted)" }}>
                          ({b3RangeLabel})
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      -
                      {b3RangeLabel && (
                        <span className="font-normal text-[10px] ml-1.5" style={{ color: "var(--color-text-muted)" }}>
                          ({b3RangeLabel})
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Tile 3: Variasi Produk */}
            <div className="p-2.5 rounded-md border space-y-1" style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
                  Variasi Produk
                </span>
              </div>
              <div className="text-sm font-bold" style={{ color: "var(--color-text)" }}>
                {draft.products.length} <span className="text-xs font-normal" style={{ color: "var(--color-text-muted)" }}>Produk Diajukan</span>
              </div>
              <div className="pt-1.5 border-t text-[11px] space-y-1" style={{ borderColor: "var(--color-border)" }}>
                <div className="flex items-center justify-between">
                  <span style={{ color: "var(--color-text-muted)" }}>Komposisi:</span>
                  <span className="font-semibold" style={{ color: "var(--color-text)" }}>
                    {isLoadingB3 ? (
                      <span className="inline-block h-3.5 w-20 bg-slate-200 dark:bg-slate-700/60 rounded animate-pulse" />
                    ) : (
                      `${productDetailRows.repeatCount} Repeat · ${productDetailRows.newCount} Baru`
                    )}
                  </span>
                </div>
                <div className="space-y-0.5">
                  <div style={{ color: "var(--color-text-muted)" }}>
                    Total Variasi B-3 Outlet:
                  </div>
                  <div className="font-semibold text-xs" style={{ color: "var(--color-text)" }}>
                    {isLoadingB3 ? (
                      <span className="inline-block h-3.5 w-16 bg-slate-200 dark:bg-slate-700/60 rounded animate-pulse mt-0.5" />
                    ) : (
                      <>
                        {b3TotalCount != null ? `${b3TotalCount} Produk` : "-"}
                        {b3RangeLabel && (
                          <span className="font-normal text-[10px] ml-1.5" style={{ color: "var(--color-text-muted)" }}>
                            ({b3RangeLabel})
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Header Bar Produk SC & Tombol Analisis Produk Kompetitor */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>
              Daftar Produk SC ({scProducts.length})
            </span>
            <button
              type="button"
              onClick={() => onToggleKompetitor?.()}
              className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md border transition-all hover:opacity-80 cursor-pointer shadow-xs"
              style={{
                background: isKompetitorOpen ? "var(--color-blue, #0063a0)" : "var(--color-surface)",
                borderColor: isKompetitorOpen ? "var(--color-blue, #0063a0)" : "var(--color-border)",
                color: isKompetitorOpen ? "#ffffff" : "var(--color-text)",
              }}
            >
              Analisis Produk Kompetitor
            </button>
          </div>

          {/* Hint geser untuk mobile */}
          <div className="sm:hidden -mt-1 text-[11px] flex items-center gap-1" style={{ color: "var(--color-text-faint)" }}>
            <span>↔</span> Geser tabel untuk melihat rincian angka &amp; growth
          </div>

          {/* Products table container */}
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: "var(--color-bg-subtle)" }}>
                    <th className="text-left px-2.5 py-2 font-medium sticky left-0 z-10 border-r" style={{ color: "var(--color-text-muted)", background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>Produk SC</th>
                    <th className="text-right px-2 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>
                      <div className="leading-tight">
                        <div>Qty ST</div>
                        <div className="text-[10px] font-normal opacity-75">/ Bln</div>
                      </div>
                    </th>
                    <th className="text-right px-2 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>
                      <div className="leading-tight">
                        <div>Estimasi</div>
                        <div>Sales</div>
                      </div>
                    </th>
                    <th className="text-right px-2 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>
                      <div className="leading-tight">
                        <div>Insentif</div>
                        <div>SC</div>
                      </div>
                    </th>
                    {!isCashbackNotFound && (
                      <th className="text-right px-2 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>
                        <div className="inline-flex items-center justify-end gap-1">
                          <div className="leading-tight text-right">
                            <div>Value</div>
                            <div>Cashback</div>
                          </div>
                          <InfoTooltip text="Nilai Cashback akan diterima oleh outlet jika belanja lewat Pharmanet" />
                        </div>
                      </th>
                    )}
                    <th className="text-right px-2 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>Growth</th>
                  </tr>
                </thead>
                <tbody>
                  {productDetailRows.rows.map(({ product: p, estSalesMonth, estSalesFull, nilaiScPerMonth, nilaiScFull, valCashbackFull, salesHistorical, growthPct }) => (
                    <tr key={p.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                      <td className="px-2.5 py-2 font-medium sticky left-0 z-10 border-r" style={{ color: "var(--color-text)", background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
                        <div className="max-w-[150px] sm:max-w-none truncate sm:whitespace-normal font-semibold">
                          {p.namaProduk}
                        </div>
                      </td>
                      <td className="px-2.5 py-2 text-right whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>{p.qtyPerBulan || 0}</td>
                      <td className="px-2.5 py-2 text-right whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                        {estSalesFull > 0 ? (
                          <div>
                            <span>{formatRp(estSalesFull)}</span>
                            {lama > 1 && (
                              <span className="block text-[10px] font-normal" style={{ color: "var(--color-text-faint)" }}>
                                ({formatRp(estSalesMonth)}/bln)
                              </span>
                            )}
                          </div>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-2.5 py-2 text-right whitespace-nowrap font-semibold" style={{ color: "var(--color-blue)" }}>
                        {nilaiScFull > 0 ? (
                          <div>
                            <span>{formatRp(nilaiScFull)}</span>
                            {lama > 1 && (
                              <span className="block text-[10px] font-normal" style={{ color: "var(--color-text-faint)" }}>
                                ({formatRp(nilaiScPerMonth)}/bln)
                              </span>
                            )}
                          </div>
                        ) : (
                          "-"
                        )}
                      </td>
                      {!isCashbackNotFound && (
                        <td className="px-2.5 py-2 text-right whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                          {valCashbackFull > 0 ? formatRp(valCashbackFull) : "-"}
                        </td>
                      )}
                      <td className="px-2.5 py-2 text-right whitespace-nowrap">
                        {isLoadingB3 ? (
                          <span className="inline-block h-3.5 w-10 bg-slate-200 dark:bg-slate-700/60 rounded animate-pulse" />
                        ) : salesHistorical > 0 ? (
                          <span className={growthPct >= 0 ? "text-emerald-600 font-semibold" : "text-rose-600 font-semibold"}>
                            {growthPct >= 0 ? `+${growthPct.toFixed(1)}%` : `${growthPct.toFixed(1)}%`}
                          </span>
                        ) : (
                          <span
                            className="inline-block text-[10px] font-semibold px-1.5 py-0.2 rounded border"
                            style={{
                              background: "rgba(22, 163, 74, 0.12)",
                              color: "#16a34a",
                              borderColor: "rgba(22, 163, 74, 0.3)",
                            }}
                          >
                            Baru
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold border-t" style={{ borderColor: "var(--color-border)", background: "var(--color-bg-subtle)" }}>
                    <td className="px-2.5 py-2 sticky left-0 z-10 border-r" style={{ color: "var(--color-text)", background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>Total</td>
                    <td className="px-2.5 py-2 text-right whitespace-nowrap" style={{ color: "var(--color-text)" }}>{productDetailRows.sumQtyPerBulan}</td>
                    <td className="px-2.5 py-2 text-right whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                      {productDetailRows.sumEstSales > 0 ? (
                        <div>
                          <span>{formatRp(productDetailRows.sumEstSales)}</span>
                          {lama > 1 && (
                            <span className="block text-[10px] font-normal" style={{ color: "var(--color-text-faint)" }}>
                              ({formatRp(productDetailRows.sumEstSalesPerMonth)}/bln)
                            </span>
                          )}
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-2.5 py-2 text-right whitespace-nowrap" style={{ color: "var(--color-blue)" }}>
                      {productDetailRows.sumNilaiSc > 0 ? (
                        <div>
                          <span>{formatRp(productDetailRows.sumNilaiSc)}</span>
                          {lama > 1 && (
                            <span className="block text-[10px] font-normal" style={{ color: "var(--color-text-faint)" }}>
                              ({formatRp(productDetailRows.sumNilaiScPerMonth)}/bln)
                            </span>
                          )}
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    {!isCashbackNotFound && (
                      <td className="px-2.5 py-2 text-right whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                        {productDetailRows.sumCashback > 0 ? formatRp(productDetailRows.sumCashback) : "-"}
                      </td>
                    )}
                    <td className="px-2.5 py-2 text-right whitespace-nowrap">
                      {isLoadingB3 ? (
                        <span className="inline-block h-3.5 w-12 bg-slate-200 dark:bg-slate-700/60 rounded animate-pulse" />
                      ) : productDetailRows.sumSalesHistorical > 0 ? (
                        <span className={productDetailRows.overallGrowthPct >= 0 ? "text-emerald-600 font-bold" : "text-rose-600 font-bold"}>
                          {productDetailRows.overallGrowthPct >= 0 ? `+${productDetailRows.overallGrowthPct.toFixed(1)}%` : `${productDetailRows.overallGrowthPct.toFixed(1)}%`}
                        </span>
                      ) : (
                        <span
                          className="inline-block text-[10px] font-semibold px-1.5 py-0.2 rounded border"
                          style={{
                            background: "rgba(22, 163, 74, 0.12)",
                            color: "#16a34a",
                            borderColor: "rgba(22, 163, 74, 0.3)",
                          }}
                        >
                          Baru
                        </span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {b3RangeLabel && (
              <p className="text-[11px] px-3 py-2 border-t" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)", background: "var(--color-bg-subtle)" }}>
                * Growth Dihitung dari Histori Rata-Rata Penjualan Quarter ({b3RangeLabel})
              </p>
            )}
          </div>

          {/* Helper Sidebar: Analisis Produk Kompetitor */}
          <ProdukKompetitorSidebar
            isOpen={isKompetitorOpen}
            onClose={() => onCloseKompetitor?.()}
            outletName={draft.namaOutlet}
            products={allScProducts.length > 0 ? allScProducts : draft.products}
            selectedCodes={selectedProductCodes}
            salesOnlineData={salesOnlineData}
            isLoadingSalesOnline={isLoadingSalesOnline}
            periodLabel={b3RangeLabel}
            surveyNexusData={surveyNexusData}
          />

          {/* Entertain items breakdown if present */}
          {draft.entertainItems.length > 0 && (
            <div className="space-y-2 mt-4">
              <span className="text-xs font-semibold tracking-wide" style={{ color: "var(--color-text)" }}>
                Rencana Entertain SC Bulanan
              </span>
              <div className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)", background: "var(--color-bg-subtle)" }}>
                <div className="flex gap-4 flex-wrap">
                  {draft.entertainItems.map((e) => (
                    <span key={e.id} className="text-xs" style={{ color: "var(--color-text)" }}>
                      {formatMonthLabel(e.periodeMonth)}: <strong>{formatRp(e.biayaEntertain)}</strong>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Tabel BLAST-IN & POSM (Autofill data) */}
          {draft.isBlastIn && (
            <BlastInTable
              poaPeriod={draft.period || poaId}
              outletId={draft.kodePI}
              estimasiSales={outletEstSales}
            />
          )}
          {draft.kodePI && (
            <PosmTable
              poaPeriod={draft.period || poaId}
              outletId={draft.kodePI}
            />
          )}
        </div>
      )}
      {/* Dialog Konfirmasi Custom */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        tone="danger"
        title="Hapus Rencana Outlet?"
        message={`Hapus rencana POA SC untuk ${draft.namaOutlet}?`}
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        confirmPending={isDeleting}
        onConfirm={executeDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />

      <ConfirmDialog
        open={rejectConfirmOpen}
        tone="danger"
        title="Tolak Sales Counter?"
        message={`Tolak Sales Counter ${draft.namaOutlet}?`}
        confirmLabel="Tolak"
        cancelLabel="Batal"
        confirmPending={isSubmittingAction}
        onConfirm={handleRejectSubmit}
        onCancel={() => setRejectConfirmOpen(false)}
      />
    </div>
  );
}
