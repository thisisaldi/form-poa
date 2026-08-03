"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { TARGET_HOSPITAL_PERIODS } from "@/lib/targetHospitalValue";

interface Session { userId: string; role: string }

async function requireNsmOrAdmin(): Promise<Session> {
  const session = await getCurrentUser();
  if (!session) throw new Error("Sesi tidak valid.");
  if (session.role !== "NSM" && session.role !== "ADMIN") {
    throw new Error("Hanya NSM atau Admin yang bisa mengatur target value.");
  }
  return session;
}

export interface TargetHospitalRow {
  namaGT: string;
  namaMR: string;
  nipMR: string | null;
  namaASM: string;
  namaSM: string;
  namaNSM: string;
  nipNSM: string | null;
  targets: Record<string, number>; // periode -> target
}

function pivotRows(rows: { namaGT: string; periode: string; target: { toString(): string }; namaMR: string; nipMR: string | null; namaASM: string; namaSM: string; namaNSM: string; nipNSM: string | null }[]): TargetHospitalRow[] {
  const byGT = new Map<string, TargetHospitalRow>();
  for (const r of rows) {
    let g = byGT.get(r.namaGT);
    if (!g) {
      g = { namaGT: r.namaGT, namaMR: r.namaMR, nipMR: r.nipMR, namaASM: r.namaASM, namaSM: r.namaSM, namaNSM: r.namaNSM, nipNSM: r.nipNSM, targets: {} };
      byGT.set(r.namaGT, g);
    }
    g.targets[r.periode] = parseFloat(r.target.toString());
  }
  return [...byGT.values()].sort((a, b) => a.namaGT.localeCompare(b.namaGT, "id"));
}

/**
 * Search Target Hospital Value rows by GT/MR/ASM/SM/NSM name (case-insensitive
 * contains, blank = everyone in scope), pivoted to one row per GT with every
 * period's target as a column. An NSM only sees/edits their own subtree
 * (nipNSM = their own nip) — rows whose NSM name never resolved to a nip at
 * import time (VACANT/SHADOW placeholders) are Admin-only for that reason.
 */
export async function searchTargetHospitalValueAction(query: string): Promise<TargetHospitalRow[]> {
  const session = await requireNsmOrAdmin();
  const q = query.trim();
  const where: Record<string, unknown> = {
    periode: { in: TARGET_HOSPITAL_PERIODS as unknown as string[] },
  };
  if (session.role === "NSM") where.nipNSM = session.userId;
  if (q) {
    where.OR = [
      { namaGT: { contains: q, mode: "insensitive" } },
      { namaMR: { contains: q, mode: "insensitive" } },
      { namaASM: { contains: q, mode: "insensitive" } },
      { namaSM: { contains: q, mode: "insensitive" } },
      { namaNSM: { contains: q, mode: "insensitive" } },
    ];
  }
  const rows = await prisma.targetHospitalValue.findMany({
    where,
    orderBy: [{ namaGT: "asc" }, { periode: "asc" }],
    select: { namaGT: true, periode: true, target: true, namaMR: true, nipMR: true, namaASM: true, namaSM: true, namaNSM: true, nipNSM: true },
  });
  return pivotRows(rows as unknown as Parameters<typeof pivotRows>[0]);
}

export interface TargetHospitalActionResult {
  ok: boolean;
  error?: string;
}

/** Updates a single (namaGT, periode) cell's target value. */
export async function updateTargetHospitalValueAction(namaGT: string, periode: string, target: number): Promise<TargetHospitalActionResult> {
  try {
    const session = await requireNsmOrAdmin();
    if (isNaN(target) || target < 0) return { ok: false, error: "Nilai target tidak valid." };
    if (!(TARGET_HOSPITAL_PERIODS as readonly string[]).includes(periode)) return { ok: false, error: "Periode tidak valid." };

    const existing = await prisma.targetHospitalValue.findUnique({ where: { namaGT_periode: { namaGT, periode } } });
    if (!existing) return { ok: false, error: "Baris GT/periode tidak ditemukan." };
    if (session.role === "NSM" && existing.nipNSM !== session.userId) {
      return { ok: false, error: "GT ini bukan bagian dari struktur Anda." };
    }

    await prisma.targetHospitalValue.update({
      where: { namaGT_periode: { namaGT, periode } },
      data: { target },
    });
    revalidatePath("/admin/target-value");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menyimpan." };
  }
}
