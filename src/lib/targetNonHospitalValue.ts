// docs/target-non-hospital-value/ — see 01-business-rules.md for the full spec.
export const TARGET_NON_HOSPITAL_PERIODS = ["202608", "202609"] as const;

import { prisma } from "@/lib/prisma";
import { getSubordinateMRNips } from "@/lib/authz";
import type { User } from "@prisma/client";

/**
 * Live "who holds this GT now" for the non-hospital (OMEGA) team — simpler
 * than hospital's getCurrentGTsForMrNips because there's no separate
 * assignment table here: User.namaWilayah itself IS the live territory
 * assignment (synced by omegaUserSync.ts), so no join/fuzzy-name-matching
 * needed (docs/target-non-hospital-value/01-business-rules.md, confirmed by
 * DB sampling 2026-09-11 that namaWilayah matches the target sheet's "Nama
 * GT" spelling literally).
 */
export async function getCurrentGTsForOmegaMrNips(mrNips: string[]): Promise<string[]> {
  if (mrNips.length === 0) return [];
  const users = (await prisma.user.findMany({
    where: { nip: { in: mrNips }, project: "OMEGA", role: "MR", isActive: true, namaWilayah: { not: null } },
    select: { namaWilayah: true },
  })) as { namaWilayah: string | null }[];
  return [...new Set(users.map((u) => u.namaWilayah).filter((g): g is string => !!g))];
}

/**
 * Per-GT rows for `gts` (as returned by getCurrentGTsForOmegaMrNips) — used
 * for NSM session scoping (2026-09-14: GT-based query only, no more `?nip=`
 * rollup, see docs/API.md). `gts.length === 0` means unrestricted
 * (ADMIN/Basic Auth). No personnel columns (2026-09-14: nipMR/namaMR/nipSM/
 * namaSM dropped from the table entirely — GT-based only, "who holds this
 * GT now" is `gts` itself, resolved live by the caller before calling this).
 */
export async function getTargetNonHospitalValueRowsForGTs(
  gts: string[],
  opts: { periode?: string; divisi?: string } = {}
): Promise<{ namaGT: string; kodeGT: string | null; divisi: string; target: number; periode: string }[]> {
  if (gts.length === 0) return [];
  const where: Record<string, unknown> = { namaGT: { in: gts } };
  if (opts.periode) where.periode = opts.periode;
  if (opts.divisi) where.divisi = opts.divisi;
  const rows = (await prisma.targetNonHospitalValue.findMany({
    where,
    select: { namaGT: true, kodeGT: true, divisi: true, periode: true, target: true },
  })) as { namaGT: string; kodeGT: string | null; divisi: string; periode: string; target: { toString(): string } }[];
  return rows
    .map((r) => ({ ...r, target: parseFloat(r.target.toString()) }))
    .sort((a, b) => a.periode.localeCompare(b.periode) || a.namaGT.localeCompare(b.namaGT, "id"));
}

/** owner only needs nip+role (getSubordinateMRNips reads nothing else). */
export async function resolveOmegaMrNipsForOwner(owner: Pick<User, "nip" | "role">): Promise<string[]> {
  return owner.role === "MR" ? [owner.nip] : await getSubordinateMRNips(owner as User);
}
