/**
 * Plain (non-"use client") module for PHASES — needs to be importable from
 * server code (e.g. the /poa-standarisasi list page) directly. Importing a
 * value export from a "use client" file breaks when used server-side (same
 * class of bug as hargaST in masterData.ts, 2026-08-19): every export from a
 * client-directive module becomes a client reference, which for functions
 * throws "not a function" when called server-side.
 */
// "Menunggu Meeting KFT" dihapus dari flow (2026-09-08, user request) — Phase
// 3 (Approval User/Dokter) lompat langsung ke Finalisasi. Nilai enum
// PoaStandarisasiPhase.MENUNGGU_MEETING_KFT tetap ada di schema (data
// historis lama), tapi tidak lagi diproduksi/ditampilkan — lihat
// advanceToFinalisasiAction (poaStandarisasi.ts) dan migration
// 20260908020000_poasc_drop_menunggu_meeting_kft_phase.
export const PHASES = [
  { id: "PLANNING", label: "Planning Standarisasi" },
  { id: "APPROVAL_ATASAN", label: "Approval Atasan" },
  { id: "APPROVAL_USER_DOKTER", label: "Approval User / Dokter" },
  { id: "FINALISASI", label: "Finalisasi" },
] as const;

function fmtTanggalProgress(d: Date | string | null | undefined): string {
  return d ? new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "";
}

const STATUS_APPROVAL_ATASAN_LABELS: Record<string, string> = { MENUNGGU: "Menunggu", DISETUJUI: "Disetujui", DITOLAK: "Ditolak" };

/**
 * Per-phase progress breakdown, buat export Excel (dan opsional listing web)
 * yang belum nampilin step mana yang sudah/belum lewat, padahal datanya
 * sudah ada di kolom header `PoaStandarisasi` (currentPhase/submittedAt/
 * statusApprovalAsm+Sm/tanggalApprovalAsm+Sm). Approval ASM/SM dibaca
 * langsung dari field itu (independen dari posisi currentPhase), fase
 * lainnya dari posisi currentPhase di array PHASES di atas.
 */
export function buildPhaseProgress(pengajuan: {
  currentPhase: string;
  submittedAt: Date | string | null;
  createdAt: Date | string;
  statusApprovalAsm: string;
  statusApprovalSm: string;
  tanggalApprovalAsm: Date | string | null;
  tanggalApprovalSm: Date | string | null;
  // Jalur baru (level dinamis per produk): header statusApprovalAsm/Sm TIDAK
  // pernah diupdate untuk pengajuan yang punya baris ini, jadi harus dibaca dari sini.
  produk?: { approvals: { level: string; status: string; decidedAt: Date | string | null }[] }[];
}): { planning: string; approvalAsm: string; approvalSm: string; approvalUserDokter: string; finalisasi: string } {
  const currentIdx = PHASES.findIndex((p) => p.id === pengajuan.currentPhase);
  const statusByPhaseId = (phaseId: string): "Selesai" | "Sedang Berjalan" | "Belum" => {
    if (pengajuan.submittedAt) return "Selesai";
    const phaseIdx = PHASES.findIndex((p) => p.id === phaseId);
    if (phaseIdx < currentIdx) return "Selesai";
    if (phaseIdx === currentIdx) return "Sedang Berjalan";
    return "Belum";
  };

  const planningStatus = statusByPhaseId("PLANNING");
  const planning = planningStatus === "Selesai" ? `Selesai (${fmtTanggalProgress(pengajuan.createdAt)})` : planningStatus;

  const allRows = (pengajuan.produk ?? []).flatMap((p) => p.approvals);
  const levelLabel = (level: "ASM" | "SM", legacyStatus: string, legacyTanggal: Date | string | null): string => {
    if (allRows.length === 0) {
      const label = STATUS_APPROVAL_ATASAN_LABELS[legacyStatus] ?? legacyStatus;
      return legacyTanggal ? `${label} (${fmtTanggalProgress(legacyTanggal)})` : label;
    }
    const rows = allRows.filter((r) => r.level === level);
    if (rows.length === 0) return "Tidak diperlukan";
    if (rows.some((r) => r.status === "DITOLAK")) return "Ditolak";
    const approved = rows.filter((r) => r.status === "DISETUJUI");
    if (approved.length === 0) return "Menunggu";
    if (approved.length < rows.length) return `Sebagian (${approved.length}/${rows.length} produk)`;
    const latest = approved.map((r) => r.decidedAt).filter((d): d is Date | string => !!d).map((d) => new Date(d).getTime()).sort((a, b) => b - a)[0];
    return latest ? `Disetujui (${fmtTanggalProgress(new Date(latest))})` : "Disetujui";
  };
  const approvalAsm = levelLabel("ASM", pengajuan.statusApprovalAsm, pengajuan.tanggalApprovalAsm);
  const approvalSm = levelLabel("SM", pengajuan.statusApprovalSm, pengajuan.tanggalApprovalSm);

  const approvalUserDokter = statusByPhaseId("APPROVAL_USER_DOKTER");
  const finalisasi = pengajuan.submittedAt ? `Selesai (${fmtTanggalProgress(pengajuan.submittedAt)})` : statusByPhaseId("FINALISASI");

  return { planning, approvalAsm, approvalSm, approvalUserDokter, finalisasi };
}
