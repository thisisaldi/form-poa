/**
 * Format raw discount percentage to a display-ready string.
 * Handles decimal values (0.1 -> 10) and numbers.
 */
export function formatDiskonPct(rawVal: number | string | undefined | null): string {
  if (rawVal == null) return "0";
  const num = typeof rawVal === "number" ? rawVal : parseFloat(String(rawVal));
  if (isNaN(num)) return "0";
  const pct = num > 0 && num <= 1 ? num * 100 : num;
  return String(Number(pct.toFixed(2)));
}

/**
 * Format raw cashback percentage to a display-ready string.
 */
export function formatCashbackPct(rawVal: number | string | undefined | null): string {
  if (rawVal == null) return "0";
  const num = typeof rawVal === "number" ? rawVal : parseFloat(String(rawVal));
  if (isNaN(num)) return "0";
  const pct = num > 0 && num <= 1 ? num * 100 : num;
  return String(Number(pct.toFixed(2)));
}

/**
 * Convert backend status string into readable Indonesian label.
 */
export function formatHumanStatus(status?: string): string {
  if (!status) return "";
  switch (status) {
    case "SUBMITTED_TO_ASM":
      return "Submitted to ASM";
    case "SUBMITTED_TO_SM":
      return "Submitted to SM";
    case "SUBMITTED_TO_NSM":
      return "Submitted to NSM";
    case "APPROVED_BY_ASM":
      return "Disetujui ASM";
    case "APPROVED_BY_SM":
      return "Disetujui SM";
    case "APPROVED_BY_NSM":
    case "APPROVED":
      return "Disetujui (Approved)";
    case "REVISI":
      return "Revisi";
    default:
      return status.replace(/_/g, " ");
  }
}

/**
 * Format quantity number for sales display (clean integer or 2 decimal places).
 */
export function formatQtySales(qty: number): string {
  if (qty == null || isNaN(qty)) return "0";
  if (Number.isInteger(qty)) return String(qty);
  return qty.toFixed(2);
}

/**
 * Format number to Indonesian rupiah string (without 'Rp ' prefix by default).
 */
export function formatRpNumber(val: number | string | null | undefined): string {
  if (val == null) return "0";
  const n = typeof val === "number" ? val : parseFloat(String(val));
  if (isNaN(n)) return "0";
  return new Intl.NumberFormat("id-ID").format(Math.round(n));
}

/**
 * Format number with 'Rp ' prefix for display.
 */
export function formatRp(val: number | string | null | undefined): string {
  if (val == null) return "-";
  const n = typeof val === "number" ? val : parseFloat(String(val));
  if (isNaN(n)) return "-";
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}
