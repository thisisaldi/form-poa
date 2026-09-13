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

async function findTargetNonHospitalValueRows(
  gts: string[],
  opts: { periode?: string; divisi?: string } = {}
): Promise<{ namaGT: string; divisi: string; nipMR: string | null; namaMR: string; target: number; periode: string }[]> {
  if (gts.length === 0) return [];
  const where: Record<string, unknown> = { namaGT: { in: gts } };
  if (opts.periode) where.periode = opts.periode;
  if (opts.divisi) where.divisi = opts.divisi;
  const rows = (await prisma.targetNonHospitalValue.findMany({
    where,
    select: { namaGT: true, divisi: true, nipMR: true, namaMR: true, periode: true, target: true },
  })) as { namaGT: string; divisi: string; nipMR: string | null; namaMR: string; periode: string; target: { toString(): string } }[];
  return rows.map((r) => ({ ...r, target: parseFloat(r.target.toString()) }));
}

/** Sums TargetNonHospitalValue.target for every GT in `gts`, one total per periode. */
export async function sumTargetNonHospitalValueForGTs(
  gts: string[],
  opts: { periode?: string; divisi?: string } = {}
): Promise<{ periode: string; target: number }[]> {
  const rows = await findTargetNonHospitalValueRows(gts, opts);
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(r.periode, (sums.get(r.periode) ?? 0) + r.target);
  return [...sums.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([periode, target]) => ({ periode, target }));
}

/** Same matching as sumTargetNonHospitalValueForGTs, raw per-GT rows instead of summed. */
export async function getTargetNonHospitalValueRowsForGTs(
  gts: string[],
  opts: { periode?: string; divisi?: string } = {}
): Promise<{ namaGT: string; divisi: string; nipMR: string | null; namaMR: string; target: number; periode: string }[]> {
  const rows = await findTargetNonHospitalValueRows(gts, opts);
  return rows.sort((a, b) => a.periode.localeCompare(b.periode) || a.namaGT.localeCompare(b.namaGT, "id"));
}

/** owner only needs nip+role (getSubordinateMRNips reads nothing else). */
export async function resolveOmegaMrNipsForOwner(owner: Pick<User, "nip" | "role">): Promise<string[]> {
  return owner.role === "MR" ? [owner.nip] : await getSubordinateMRNips(owner as User);
}

/**
 * Batch-fetch User.project for a set of NIPs (2026-09-13, cross-repo request
 * from Insentif Sales) — POA's OWN OMEGA/non-hospital source of truth is
 * this column, synced from Nexus's `get_employees?project=omega`
 * (omegaUserSync.ts), NOT mkt_insight.Struktur_Marketing_PI's `Divisi`
 * column — those two are independent pipelines that can disagree while a
 * migration is in flight (Nexus already moved someone to project OMEGA,
 * mkt_insight's own denormalized copy hasn't caught up yet). There is no
 * dedicated "in transition" flag anywhere — `project === "OMEGA"` here IS
 * the signal: it means Nexus (POA's upstream) already considers that NIP
 * OMEGA, regardless of what Struktur_Marketing_PI still says.
 */
export async function getUserProjectByNip(nips: string[]): Promise<Map<string, string | null>> {
  if (nips.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { nip: { in: [...new Set(nips)] } },
    select: { nip: true, project: true },
  });
  return new Map(users.map((u: { nip: string; project: string | null }) => [u.nip, u.project]));
}
