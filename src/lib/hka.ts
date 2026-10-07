/**
 * Hospital Key Account (HKA) — docs/poa-standarisasi-pusat/. Kapabilitas
 * `User.isHka` terpisah dari `role` (Widodo/Masril tetap NSM, Ahsanul role GM =
 * level ASD dengan label jabatan "DIR"). Pure helpers, aman diimpor dari client.
 */
import { APPROVAL_LEVELS, type ApprovalLevel } from "@/lib/discountApprovalLevel";

/** NIP approver tetap (pusat tidak punya rantai nipAtasan dari MR). Level SD = user ber-role SD (Brian P200134), sama dengan cabang. */
export const HKA_APPROVER_NIP = { ASD: "972977" } as const;

/** Level tertinggi yang otomatis `DISETUJUI` kalau pembuatnya `role` ini; null = tidak ada auto-approve. */
export function hkaCreatorLevel(role: string): ApprovalLevel | null {
  if (role === "NSM") return "NSM";
  if (role === "GM") return "ASD";
  if (role === "SD") return "SD";
  return null;
}

/** True kalau `level` setara atau di bawah level pembuat (otomatis disetujui). */
export function isAutoApprovedLevel(level: ApprovalLevel, creatorLevel: ApprovalLevel | null): boolean {
  if (!creatorLevel) return false;
  return APPROVAL_LEVELS.indexOf(level) <= APPROVAL_LEVELS.indexOf(creatorLevel);
}

/** Boleh bertindak di `level` pada pengajuan pusat? ADMIN selalu; ASD = NIP tetap; SD = role SD; level lain hanya ADMIN (pembuat HKA sudah >= NSM). */
export function canApprovePusatLevel(user: { nip: string; role: string }, level: ApprovalLevel): boolean {
  if (user.role === "ADMIN") return true;
  if (level === "ASD") return user.nip === HKA_APPROVER_NIP.ASD;
  if (level === "SD") return user.role === "SD";
  return false;
}

/** Siapa yang boleh MELIHAT pengajuan pusat: HKA + oversight read-only. */
export function canViewPusat(user: { isHka: boolean; role: string }): boolean {
  return user.isHka || ["ADMIN", "GM", "SD", "VIEWER"].includes(user.role);
}
