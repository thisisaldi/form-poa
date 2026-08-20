"use client";

import Link from "next/link";

export function SalesCounterChecklistHeader({
  poaId,
  canEditNow,
  selectable,
  allChecked,
  onToggleAll,
}: {
  poaId?: string;
  canEditNow: boolean;
  selectable: boolean;
  allChecked: boolean;
  onToggleAll: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div>
        <p className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>
          Daftar Outlet SC
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
          {selectable
            ? "Centang outlet SC yang ingin dihitung statistiknya"
            : "Ringkasan seluruh rencana SC"}
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
            className="text-xs px-2.5 py-1 rounded-md font-medium"
            style={{ background: "var(--color-bg-subtle)", color: "var(--color-blue)", border: "1px solid var(--color-border)" }}
            onClick={onToggleAll}>
            {allChecked ? "Unselect All" : "Select All"}
          </button>
        )}
      </div>
    </div>
  );
}
