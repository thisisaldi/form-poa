export function getScEditLockLevel(status: string): number {
  if (status === "DRAFT" || status === "REVISI") return -1;
  if (status === "SUBMITTED_TO_ASM") return 0;
  if (status === "APPROVED_BY_ASM" || status === "SUBMITTED_TO_SM") return 1;
  if (status === "APPROVED_BY_SM" || status === "SUBMITTED_TO_NSM") return 2;
  if (status === "APPROVED_BY_NSM") return 3;
  return 3;
}

export function canEditScOutletByLockLevel({
  userRole,
  status,
  isOwner,
}: {
  userRole?: string;
  status?: string;
  isOwner?: boolean;
}): boolean {
  if (!status) return false;
  if (userRole === "ADMIN") return true;

  // Status final fully approved terkunci untuk semua role kecuali ADMIN
  if (
    status === "APPROVED_BY_NSM" ||
    status === "APPROVED_BY_ASD" ||
    status === "APPROVED_BY_SD"
  ) {
    return false;
  }

  const roleLevel: Record<string, number> = {
    MR: 0,
    ASM: 1,
    SM: 2,
    NSM: 3,
    ADMIN: 4,
  };

  const effectiveRole = userRole || (isOwner ? "MR" : "");
  const userLevel = roleLevel[effectiveRole] ?? (isOwner ? 0 : -1);
  if (userLevel < 0) return false;

  const lockLevel = getScEditLockLevel(status);
  return userLevel >= lockLevel;
}
