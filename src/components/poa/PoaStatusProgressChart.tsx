import type { PoaStatus } from "@prisma/client";
import { NON_DRAFT_STATUSES } from "@/lib/authz";

/**
 * Progress-per-status bar chart (2026-08-10) — "chart untuk tau progress
 * approval nya... bar draft, bar submitted ke ASM, bar submitted ke SM,
 * dst". Dipakai di 2 tempat: Dashboard (`dashboard/page.tsx`, scoped ke
 * subtree actor via getVisiblePoaFilter — ASM lihat progress MR-nya, SM
 * lihat progress ASM+MR di bawahnya, dst) dan tab Ringkasan Summary
 * (`summary/page.tsx`, antara "Estimasi PSSP per Bulan" dan "Varian Produk
 * Kontes"). Satu komponen chart, data-fetching beda di tiap caller.
 *
 * Horizontal bar (bukan SVG) — label kiri (lebar tetap), track+fill di
 * tengah, angka di kanan (text token, bukan warna fill — "text wears text
 * tokens, never the series color"). HTML/CSS flexbox dipilih alih-alih SVG
 * fixed-width (pola RingkasanCharts.tsx) karena 8 kategori dengan label
 * beda panjang lebih natural sebagai baris responsif daripada canvas SVG
 * tetap.
 */

// Warna SAMA PERSIS dengan StatusBadge.tsx (bukan palet baru) — status
// sudah punya bahasa visual established di app ini (draft/pending/approved/
// revisi), dipakai ulang di sini supaya konsisten, bukan diciptakan lagi.
// Hex hardcode (bukan var(--...)) mengikuti pola RENCANA_COLOR/AKTIF_COLOR
// di RingkasanCharts.tsx — lihat globals.css untuk nilai aslinya.
const DRAFT_COLOR = "#9C948A";    // var(--color-status-draft)
const PENDING_COLOR = "#C99A3D";  // var(--color-status-pending)
const APPROVED_COLOR = "#008f42"; // var(--color-status-approved)
const REVISI_COLOR = "#C0392B";   // var(--color-status-revisi)

export const POA_STATUS_FLOW_ORDER: PoaStatus[] = [
  "DRAFT",
  "SUBMITTED_TO_ASM",
  "APPROVED_BY_ASM",
  "SUBMITTED_TO_SM",
  "APPROVED_BY_SM",
  "SUBMITTED_TO_NSM",
  "APPROVED_BY_NSM",
  "REVISI",
];

const STATUS_META: Record<PoaStatus, { label: string; color: string }> = {
  DRAFT: { label: "Draft", color: DRAFT_COLOR },
  SUBMITTED_TO_ASM: { label: "Submitted ke ASM", color: PENDING_COLOR },
  APPROVED_BY_ASM: { label: "Approved ASM", color: APPROVED_COLOR },
  SUBMITTED_TO_SM: { label: "Submitted ke SM", color: PENDING_COLOR },
  APPROVED_BY_SM: { label: "Approved SM", color: APPROVED_COLOR },
  SUBMITTED_TO_NSM: { label: "Submitted ke NSM", color: PENDING_COLOR },
  APPROVED_BY_NSM: { label: "Fully Approved", color: APPROVED_COLOR },
  REVISI: { label: "Revisi", color: REVISI_COLOR },
};

export function PoaStatusProgressChart({ counts }: { counts: Partial<Record<PoaStatus, number>> }) {
  const rows = POA_STATUS_FLOW_ORDER.map((status) => ({
    status,
    count: counts[status] ?? 0,
    ...STATUS_META[status],
  }));
  const max = Math.max(...rows.map((r) => r.count), 1);
  // Total — DRAFT/REVISI excluded (2026-08-10 follow-up, task #13 "berapa
  // pengajuan vs approved": "mending yang draft dan revisi tidak usah di
  // hitung, yang dihitung itu hanya yang submitted dan approved"). Draft
  // rows are still shown below for context (not yet submitted at all), just
  // not folded into this figure — same NON_DRAFT_STATUSES definition
  // `poas`/`getVisiblePoaFilter` already use elsewhere for "submitted, not
  // DRAFT/REVISI", so this always agrees with any other count derived from
  // that same filter (e.g. the Ringkasan counts line's POA figure).
  const total = rows.reduce((s, r) => s + (NON_DRAFT_STATUSES.includes(r.status) ? r.count : 0), 0);

  return (
    <div className="space-y-2">
      {/* Same label/track/count columns as the rows below (2026-08-10
          follow-up: "total nya buat align sama angka di kanan dong") so the
          Total figure lines up with the per-status counts under it instead
          of floating as its own differently-shaped line. */}
      <div className="flex items-center gap-2.5 pb-2 mb-1" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <span className="text-xs w-32 shrink-0 truncate font-semibold" style={{ color: "var(--color-text-muted)" }}>
          Total
        </span>
        <div className="flex-1" />
        <span className="text-xs w-6 text-right shrink-0 font-bold" style={{ color: "var(--color-text)", fontVariantNumeric: "tabular-nums" }}>
          {total.toLocaleString("id-ID")}
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.status} className="flex items-center gap-2.5" title={`${r.label}: ${r.count}`}>
          <span className="text-xs w-32 shrink-0 truncate" style={{ color: "var(--color-text-muted)" }}>
            {r.label}
          </span>
          <div className="flex-1 h-4 rounded-full overflow-hidden" style={{ background: "var(--color-bg-subtle)" }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${(r.count / max) * 100}%`, background: r.color }}
            />
          </div>
          <span className="text-xs w-6 text-right shrink-0 font-medium" style={{ color: "var(--color-text)", fontVariantNumeric: "tabular-nums" }}>
            {r.count}
          </span>
        </div>
      ))}
    </div>
  );
}
