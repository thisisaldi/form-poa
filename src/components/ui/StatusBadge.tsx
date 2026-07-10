import { PoaStatus } from "@prisma/client";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: PoaStatus;
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
    label: "Submitted → ASM",
    colorClass: "bg-[var(--color-status-pending-bg)] text-[var(--color-status-pending)]",
  },
  APPROVED_BY_ASM: {
    label: "Approved by ASM",
    colorClass: "bg-[var(--color-status-approved-bg)] text-[var(--color-status-approved)]",
  },
  SUBMITTED_TO_SM: {
    label: "Submitted → SM",
    colorClass: "bg-[var(--color-status-pending-bg)] text-[var(--color-status-pending)]",
  },
  APPROVED_BY_SM: {
    label: "Approved by SM",
    colorClass: "bg-[var(--color-status-approved-bg)] text-[var(--color-status-approved)]",
  },
  SUBMITTED_TO_NSM: {
    label: "Submitted → NSM",
    colorClass: "bg-[var(--color-status-pending-bg)] text-[var(--color-status-pending)]",
  },
  APPROVED_BY_NSM: {
    label: "Fully Approved",
    colorClass: "bg-[var(--color-status-approved-bg)] text-[var(--color-status-approved)] font-semibold",
  },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { label, colorClass } = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-xs font-medium tracking-wide",
        colorClass,
        className
      )}
    >
      {label}
    </span>
  );
}
