"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { assertWritable } from "@/lib/maintenance";
import { TARGET_HOSPITAL_PERIODS, resolveLiveGTHolderChain } from "@/lib/targetHospitalValue";

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
  kodeGT: string | null;
  namaMR: string | null;
  nipMR: string | null;
  namaASM: string | null;
  namaSM: string | null;
  namaNSM: string | null;
  nipNSM: string | null;
  targets: Record<string, number>; // periode -> target
}

/**
 * Search Target Hospital Value rows by GT/MR/ASM/SM/NSM name (case-insensitive
 * contains, blank = everyone in scope), pivoted to one row per GT with every
 * period's target as a column.
 *
 * 2026-09-14 rewrite: TargetHospitalValue no longer stores namaMR/namaASM/.../
 * nipNSM (dropped, see schema/migration) — "who holds this GT" is resolved
 * LIVE via resolveLiveGTHolderChain (batched, ≤6 queries total regardless of
 * how many GTs this returns, see that function's doc comment), not read from
 * a stored snapshot column. Same for NSM scoping: previously `nipNSM = session
 * .userId` on the stored column, now `chain.nipNSM === session.userId` on the
 * LIVE-resolved chain — a GT with no live holder anywhere in the chain is
 * ADMIN-only (matches the old behavior's "rows whose NSM name never resolved
 * to a nip are Admin-only", same reasoning: NSM can't be scoped to something
 * unresolvable).
 *
 * MR/ASM/SM/NSM name search now runs AFTER live-resolving every candidate row
 * (in-memory `.includes()`, not a DB `WHERE...contains`) — necessary since the
 * name to search against no longer exists as a column. Dataset here is the
 * whole TargetHospitalValue table (~1500 rows), cheap in memory.
 */
export async function searchTargetHospitalValueAction(query: string): Promise<TargetHospitalRow[]> {
  const session = await requireNsmOrAdmin();
  const q = query.trim().toUpperCase();

  const rows = await prisma.targetHospitalValue.findMany({
    where: { periode: { in: TARGET_HOSPITAL_PERIODS as unknown as string[] } },
    select: { namaGT: true, kodeGT: true, periode: true, target: true },
  });

  const byGT = new Map<string, TargetHospitalRow>();
  for (const r of rows) {
    let g = byGT.get(r.namaGT);
    if (!g) {
      g = { namaGT: r.namaGT, kodeGT: r.kodeGT, namaMR: null, nipMR: null, namaASM: null, namaSM: null, namaNSM: null, nipNSM: null, targets: {} };
      byGT.set(r.namaGT, g);
    }
    g.targets[r.periode] = parseFloat(r.target.toString());
  }
  let allRows = [...byGT.values()];

  const chains = await resolveLiveGTHolderChain(allRows.map((r) => r.namaGT));
  for (const r of allRows) {
    const c = chains.get(r.namaGT);
    if (c) Object.assign(r, c);
  }

  if (session.role === "NSM") allRows = allRows.filter((r) => r.nipNSM === session.userId);

  if (q) {
    allRows = allRows.filter((r) =>
      r.namaGT.toUpperCase().includes(q) ||
      (r.namaMR?.toUpperCase().includes(q) ?? false) ||
      (r.namaASM?.toUpperCase().includes(q) ?? false) ||
      (r.namaSM?.toUpperCase().includes(q) ?? false) ||
      (r.namaNSM?.toUpperCase().includes(q) ?? false)
    );
  }

  return allRows.sort((a, b) => a.namaGT.localeCompare(b.namaGT, "id"));
}

export interface TargetHospitalActionResult {
  ok: boolean;
  error?: string;
}

/** Updates a single (namaGT, periode) cell's target value. */
export async function updateTargetHospitalValueAction(namaGT: string, periode: string, target: number): Promise<TargetHospitalActionResult> {
  try {
    const session = await requireNsmOrAdmin();
    await assertWritable(session.role);
    if (isNaN(target) || target < 0) return { ok: false, error: "Nilai target tidak valid." };
    if (!(TARGET_HOSPITAL_PERIODS as readonly string[]).includes(periode)) return { ok: false, error: "Periode tidak valid." };

    const existing = await prisma.targetHospitalValue.findUnique({ where: { namaGT_periode: { namaGT, periode } } });
    if (!existing) return { ok: false, error: "Baris GT/periode tidak ditemukan." };
    if (session.role === "NSM") {
      // Live scope check (2026-09-14) — see searchTargetHospitalValueAction's doc comment.
      const chain = (await resolveLiveGTHolderChain([namaGT])).get(namaGT);
      if (chain?.nipNSM !== session.userId) {
        return { ok: false, error: "GT ini bukan bagian dari struktur Anda." };
      }
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
