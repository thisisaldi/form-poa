"use client";

import Link from "next/link";

export function SalesCounterChecklistHeader({
  poaId,
  canEditNow,
  selectable,
  canApprove,
  showSubmit,
  allChecked,
  onToggleAll,
}: {
  poaId?: string;
  canEditNow: boolean;
  selectable: boolean;
  canApprove?: boolean;
  showSubmit?: boolean;
  allChecked: boolean;
  onToggleAll: () => void;
  poaVersion?: number;
}) {
  const subtitle = canApprove
    ? "Pilih outlet untuk disetujui atau minta revisi secara massal"
    : selectable
    ? showSubmit
      ? "Pilih outlet untuk export atau pengajuan massal ke atasan"
      : "Pilih outlet untuk export atau melihat statistik"
    : "Ringkasan seluruh rencana SC";

  return (
    <div className="flex items-center justify-between mb-3">
      <div>
        <p className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>
          Daftar Outlet SC
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
          {subtitle}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {canEditNow && poaId && (
          <Link
            href={`/sc/${poaId}/edit`}
            className="text-xs px-2.5 py-1 rounded-md font-medium"
            style={{ background: "var(--color-blue)", color: "#fff" }}>
            + Tambah Outlet
          </Link>
        )}
        {selectable && (
          <button
            type="button"
            className="text-xs px-2.5 py-1 rounded-md font-medium cursor-pointer"
            style={{ background: "var(--color-bg-subtle)", color: "var(--color-blue)", border: "1px solid var(--color-border)" }}
            onClick={onToggleAll}>
            {allChecked ? "Unselect All" : "Select All"}
          </button>
        )}
      </div>
    </div>
  );
}
