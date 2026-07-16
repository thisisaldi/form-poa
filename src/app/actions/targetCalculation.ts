"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  computeFocusProductTargetsSummary,
  setProductTargetInput,
  listFocusProducts,
  buildOrgMaps,
  type QuarterlyFocusSummary,
} from "@/lib/targetCalculation";

async function requireNsmOrAdmin() {
  const session = await getCurrentUser();
  if (!session) throw new Error("Sesi tidak valid.");
  if (session.role !== "NSM" && session.role !== "ADMIN") {
    throw new Error("Hanya NSM atau Admin yang bisa mengatur target.");
  }
  return session;
}

export async function listFocusProductsAction(): Promise<{ kodeProduk: string; namaProduk: string }[]> {
  await requireNsmOrAdmin();
  return listFocusProducts();
}

/** Focus products plus any Tambahan Target already set for this quarter (for pre-filling the form). */
export async function getFocusProductsWithRampAction(
  quarter: string
): Promise<{ kodeProduk: string; namaProduk: string; monthlyRamp: string }[]> {
  await requireNsmOrAdmin();
  const products = await listFocusProducts();
  const inputs = await prisma.productTargetInput.findMany({
    where: { quarter, kodeProduk: { in: products.map((p) => p.kodeProduk) } },
  });
  const rampByKode = new Map<string, string>(inputs.map((i: { kodeProduk: string; monthlyRamp: { toString(): string } }) => [i.kodeProduk, i.monthlyRamp.toString()]));
  return products.map((p) => ({ ...p, monthlyRamp: rampByKode.get(p.kodeProduk) ?? "" }));
}

export async function setTambahanTargetBulkAction(
  quarter: string,
  entries: { kodeProduk: string; monthlyRamp: number }[]
): Promise<{ ok: boolean; saved?: number; error?: string }> {
  try {
    const session = await requireNsmOrAdmin();
    let saved = 0;
    for (const e of entries) {
      if (isNaN(e.monthlyRamp)) continue;
      await setProductTargetInput(e.kodeProduk, quarter, e.monthlyRamp, session.userId);
      saved++;
    }
    revalidatePath("/admin/target-produk");
    return { ok: true, saved };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menyimpan." };
  }
}

export async function getFocusProductsSummaryAction(
  quarter: string
): Promise<{ ok: boolean; result?: QuarterlyFocusSummary; error?: string }> {
  try {
    await requireNsmOrAdmin();
    const result = await computeFocusProductTargetsSummary(quarter);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menghitung." };
  }
}

/**
 * Applies computed per-MR target VALUE (summed across all focus products) to
 * their DRAFT POA for the given quarter. Only touches DRAFT POAs (still fully
 * owned/mutable by the MR) — MRs without a draft yet are skipped and reported
 * back so the caller can follow up.
 */
export async function applyQuarterlyTargetsAction(
  quarter: string
): Promise<{ ok: boolean; applied?: number; skipped?: number; error?: string }> {
  try {
    await requireNsmOrAdmin();
    const summary = await computeFocusProductTargetsSummary(quarter);
    const org = await buildOrgMaps();

    // Sum each MR's share of every focus product's per-MR target value.
    const valueByMr = new Map<string, number>();
    for (const product of summary.products) {
      for (const territory of product.territories) {
        const mrNips = org.mrsBySm.get(territory.smNip) ?? [];
        for (const mrNip of mrNips) {
          valueByMr.set(mrNip, (valueByMr.get(mrNip) ?? 0) + territory.perMrTargetValue);
        }
      }
    }

    let applied = 0;
    let skipped = 0;
    for (const [mrNip, totalValue] of valueByMr) {
      const draft = await prisma.poaForm.findFirst({
        where: { ownerId: mrNip, period: quarter, status: "DRAFT" },
      });
      if (!draft) { skipped++; continue; }
      await prisma.poaForm.update({
        where: { id: draft.id },
        data: { target: totalValue.toFixed(2) },
      });
      applied++;
    }

    revalidatePath("/admin/target-produk");
    return { ok: true, applied, skipped };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menerapkan." };
  }
}
