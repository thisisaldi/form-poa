/**
 * Level approval DPL/DPF/Discount Custom (aturan bisnis dari Exodus, screenshot
 * "Syarat Level Approval" 2026-09-29): ditentukan % diskon beban Principal
 * (principal_percentage), dihitung TERPISAH per produk. Hanya info di form —
 * approval-nya sendiri diproses Exodus, bukan di app ini.
 */
export function discountApprovalLevel(principalPct: number): "ASM" | "SM" | "NSM" | "ASD" | "SD" {
  if (principalPct <= 5) return "ASM";
  if (principalPct <= 10) return "SM";
  if (principalPct <= 20) return "NSM";
  if (principalPct <= 30) return "ASD";
  return "SD";
}
