/**
 * Level approval DPL/DPF/Discount Custom (aturan bisnis dari Exodus, screenshot
 * "Syarat Level Approval" 2026-09-29): ditentukan % diskon beban Principal
 * (principal_percentage), dihitung TERPISAH per produk. Dipakai (1) info di form
 * Ajukan DPL/DPF dan (2) approval level POA Standarisasi per produk
 * (docs/poa-standarisasi-approval-level/).
 */
export const APPROVAL_LEVELS = ["ASM", "SM", "NSM", "ASD", "SD"] as const;
export type ApprovalLevel = (typeof APPROVAL_LEVELS)[number];

export function discountApprovalLevel(principalPct: number): ApprovalLevel {
  if (principalPct <= 5) return "ASM";
  if (principalPct <= 10) return "SM";
  if (principalPct <= 20) return "NSM";
  if (principalPct <= 30) return "ASD";
  return "SD";
}

/** Level yang harus disetujui berurutan: ASM sampai `top` (inklusif). */
export function levelsUpTo(top: ApprovalLevel): ApprovalLevel[] {
  return APPROVAL_LEVELS.slice(0, APPROVAL_LEVELS.indexOf(top) + 1);
}

export type ProdukApprovalRow = { produkId: string; level: ApprovalLevel; status: string };

/** Baris (produk, level) yang boleh bertindak sekarang: MENUNGGU dan semua level di bawahnya untuk produk itu sudah DISETUJUI. */
export function actionableRows<T extends ProdukApprovalRow>(rows: T[], level: ApprovalLevel): T[] {
  const idx = (l: ApprovalLevel) => APPROVAL_LEVELS.indexOf(l);
  return rows.filter(
    (r) => r.level === level && r.status === "MENUNGGU" &&
      rows.every((o) => o.produkId !== r.produkId || idx(o.level) >= idx(level) || o.status === "DISETUJUI")
  );
}
