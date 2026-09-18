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
  statusFilter = "ALL",
  onStatusFilterChange,
  filterCounts,
}: {
  poaId?: string;
  canEditNow: boolean;
  selectable: boolean;
  canApprove?: boolean;
  showSubmit?: boolean;
  allChecked: boolean;
  onToggleAll: () => void;
  poaVersion?: number;
  statusFilter?: "ALL" | "ACTIONABLE" | "APPROVED" | "DRAFT_REVISI";
  onStatusFilterChange?: (filter: "ALL" | "ACTIONABLE" | "APPROVED" | "DRAFT_REVISI") => void;
  filterCounts?: { all: number; actionable: number; approved: number; draftRevisi: number };
}) {
  const subtitle = canApprove
    ? "Pilih outlet untuk disetujui atau minta revisi secara massal"
    : selectable
    ? showSubmit
      ? "Pilih outlet untuk export atau pengajuan massal ke atasan"
      : "Pilih outlet untuk export atau melihat statistik"
    : "Ringkasan seluruh rencana SC";

  return (
    <div className="space-y-3 mb-3">
      <div className="flex items-center justify-between">
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
              className="text-xs px-2.5 py-1 rounded-md font-medium cursor-pointer transition-colors"
              style={{ background: "var(--color-bg-subtle)", color: "var(--color-blue)", border: "1px solid var(--color-border)" }}
              onClick={onToggleAll}>
              {allChecked ? "Unselect All" : "Select All"}
            </button>
          )}
        </div>
      </div>

      {/* Status Filter Pills */}
      {filterCounts && onStatusFilterChange && (
        <div
          className="flex items-center gap-1.5 flex-wrap pt-2.5 border-t"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            type="button"
            onClick={() => onStatusFilterChange("ALL")}
            className="text-xs px-3 py-1 rounded-full font-medium transition-all cursor-pointer flex items-center gap-1.5"
            style={{
              background: statusFilter === "ALL" ? "var(--color-blue, #0063a0)" : "var(--color-bg-subtle)",
              color: statusFilter === "ALL" ? "#ffffff" : "var(--color-text-muted)",
              border: `1px solid ${statusFilter === "ALL" ? "transparent" : "var(--color-border)"}`,
            }}
          >
            <span>Semua</span>
            <span
              className="text-[10px] px-1.5 py-0.2 rounded-full font-semibold"
              style={{
                background: statusFilter === "ALL" ? "rgba(255,255,255,0.25)" : "var(--color-border)",
                color: statusFilter === "ALL" ? "#ffffff" : "var(--color-text-muted)",
              }}
            >
              {filterCounts.all}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onStatusFilterChange("ACTIONABLE")}
            className="text-xs px-3 py-1 rounded-full font-medium transition-all cursor-pointer flex items-center gap-1.5"
            style={{
              background: statusFilter === "ACTIONABLE" ? "#d97706" : "var(--color-bg-subtle)",
              color: statusFilter === "ACTIONABLE" ? "#ffffff" : "var(--color-text-muted)",
              border: `1px solid ${statusFilter === "ACTIONABLE" ? "transparent" : "var(--color-border)"}`,
            }}
          >
            <span>{canApprove ? "Perlu Approval" : "Siap Diajukan"}</span>
            <span
              className="text-[10px] px-1.5 py-0.2 rounded-full font-semibold"
              style={{
                background:
                  statusFilter === "ACTIONABLE"
                    ? "rgba(255,255,255,0.25)"
                    : filterCounts.actionable > 0
                    ? "#fef3c7"
                    : "var(--color-border)",
                color:
                  statusFilter === "ACTIONABLE"
                    ? "#ffffff"
                    : filterCounts.actionable > 0
                    ? "#b45309"
                    : "var(--color-text-muted)",
              }}
            >
              {filterCounts.actionable}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onStatusFilterChange("APPROVED")}
            className="text-xs px-3 py-1 rounded-full font-medium transition-all cursor-pointer flex items-center gap-1.5"
            style={{
              background: statusFilter === "APPROVED" ? "#16a34a" : "var(--color-bg-subtle)",
              color: statusFilter === "APPROVED" ? "#ffffff" : "var(--color-text-muted)",
              border: `1px solid ${statusFilter === "APPROVED" ? "transparent" : "var(--color-border)"}`,
            }}
          >
            <span>Sudah Diapprove</span>
            <span
              className="text-[10px] px-1.5 py-0.2 rounded-full font-semibold"
              style={{
                background:
                  statusFilter === "APPROVED"
                    ? "rgba(255,255,255,0.25)"
                    : filterCounts.approved > 0
                    ? "#dcfce7"
                    : "var(--color-border)",
                color:
                  statusFilter === "APPROVED"
                    ? "#ffffff"
                    : filterCounts.approved > 0
                    ? "#15803d"
                    : "var(--color-text-muted)",
              }}
            >
              {filterCounts.approved}
            </span>
          </button>

          {filterCounts.draftRevisi > 0 && !showSubmit && (
            <button
              type="button"
              onClick={() => onStatusFilterChange("DRAFT_REVISI")}
              className="text-xs px-3 py-1 rounded-full font-medium transition-all cursor-pointer flex items-center gap-1.5"
              style={{
                background: statusFilter === "DRAFT_REVISI" ? "#64748b" : "var(--color-bg-subtle)",
                color: statusFilter === "DRAFT_REVISI" ? "#ffffff" : "var(--color-text-muted)",
                border: `1px solid ${statusFilter === "DRAFT_REVISI" ? "transparent" : "var(--color-border)"}`,
              }}
            >
              <span>Draft / Revisi</span>
              <span
                className="text-[10px] px-1.5 py-0.2 rounded-full font-semibold"
                style={{
                  background: statusFilter === "DRAFT_REVISI" ? "rgba(255,255,255,0.25)" : "var(--color-border)",
                  color: statusFilter === "DRAFT_REVISI" ? "#ffffff" : "var(--color-text-muted)",
                }}
              >
                {filterCounts.draftRevisi}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
