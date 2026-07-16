import { PoaStatus } from "@prisma/client";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: PoaStatus;
  /** Shown as a "Version X" chip alongside the badge — only rendered while status is Revisi. */
  version?: number;
  className?: string;
}

const STATUS_CONFIG: Record<
  PoaStatus,
  { label: string; colorClass: string }
> = {
  DRAFT: {
    label: "Draft",
    colorClass: "bg-[var(--color-status-draft-bg)] text-[var(--color-status-draft)]",
  },
  SUBMITTED_TO_ASM: {
    label: "Butuh Approval ASM",
    colorClass: "bg-[var(--color-status-pending-bg)] text-[var(--color-status-pending)]",
  },
  APPROVED_BY_ASM: {
    label: "Approved by ASM",
    colorClass: "bg-[var(--color-status-approved-bg)] text-[var(--color-status-approved)]",
  },
  SUBMITTED_TO_SM: {
    label: "Butuh Approval SM",
    colorClass: "bg-[var(--color-status-pending-bg)] text-[var(--color-status-pending)]",
  },
  APPROVED_BY_SM: {
    label: "Approved by SM",
    colorClass: "bg-[var(--color-status-approved-bg)] text-[var(--color-status-approved)]",
  },
  SUBMITTED_TO_NSM: {
    label: "Butuh Approval NSM",
    colorClass: "bg-[var(--color-status-pending-bg)] text-[var(--color-status-pending)]",
  },
  APPROVED_BY_NSM: {
    label: "Fully Approved",
    colorClass: "bg-[var(--color-status-approved-bg)] text-[var(--color-status-approved)] font-semibold",
  },
  REVISI: {
    label: "Revisi",
    colorClass: "bg-[var(--color-status-revisi-bg)] text-[var(--color-status-revisi)] font-semibold",
  },
};

export function StatusBadge({ status, version, className }: StatusBadgeProps) {
  const { label, colorClass } = STATUS_CONFIG[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        className={cn(
          "inline-flex items-center rounded px-2 py-0.5 text-xs font-medium tracking-wide",
          colorClass
        )}
      >
        {label}
      </span>
      {status === "REVISI" && version != null && (
        <span
          className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium tracking-wide"
          style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-faint)" }}
        >
          Version {version}
        </span>
      )}
    </span>
  );
}
