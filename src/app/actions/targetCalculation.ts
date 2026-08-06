"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { assertWritable } from "@/lib/maintenance";
import {
  computeKontesProductTargetsSummary,
  setProductTargetInput,
  listKontesProducts,
  buildOrgMaps,
  getOrgChildren,
  type QuarterlyKontesSummary,
  type OrgLevel,
  type OrgUnit,
} from "@/lib/targetCalculation";

async function requireNsmOrAdmin() {
  const session = await getCurrentUser();
  if (!session) throw new Error("Sesi tidak valid.");
  if (session.role !== "NSM" && session.role !== "ADMIN") {
    throw new Error("Hanya NSM atau Admin yang bisa mengatur target.");
  }
  return session;
}

export async function listKontesProductsAction(): Promise<{ kodeProduk: string; namaProduk: string }[]> {
  await requireNsmOrAdmin();
  return listKontesProducts();
}

/** Kontes products plus any Tambahan Target already set for this quarter (for pre-filling the form). */
export async function getKontesProductsWithRampAction(
  quarter: string
): Promise<{ kodeProduk: string; namaProduk: string; monthlyRamp: string }[]> {
  await requireNsmOrAdmin();
  const products = await listKontesProducts();
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
    await assertWritable(session.role);
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

export async function getKontesProductsSummaryAction(
  quarter: string
): Promise<{ ok: boolean; result?: QuarterlyKontesSummary; error?: string }> {
  try {
    await requireNsmOrAdmin();
    const result = await computeKontesProductTargetsSummary(quarter);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menghitung." };
  }
}

/**
 * Applies computed per-MR target VALUE (summed across all kontes products) to
 * their DRAFT POA for the given quarter. Only touches DRAFT POAs (still fully
 * owned/mutable by the MR) — MRs without a draft yet are skipped and reported
 * back so the caller can follow up.
 */
export async function applyQuarterlyTargetsAction(
  quarter: string
): Promise<{ ok: boolean; applied?: number; skipped?: number; error?: string }> {
  try {
    const session = await requireNsmOrAdmin();
    await assertWritable(session.role);
    const summary = await computeKontesProductTargetsSummary(quarter);
    const org = await buildOrgMaps();

    // Sum each MR's share of every kontes product's per-MR target value.
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

// ─── Manual cascading allocation (NSM → SM/Area → ASM → MR) ─────────────────
// Replaces the ratio+productivity algorithm above as the primary way targets
// get set: an admin/NSM sets an NSM's total for a product+quarter by hand,
// then allocates it across that NSM's SMs, then each SM's total across its
// ASMs, then each ASM's total across its MRs.

export interface TargetChildRow extends OrgUnit {
  qty: number;
}

export interface TargetLevelResult {
  parentQty: number | null; // the selected parent's own allocated qty; null at the NSM root (no parent)
  children: TargetChildRow[];
}

/** One level's rows (with their currently-saved qty) plus the parent's own total, for the drilldown UI. */
export async function getTargetChildrenAction(
  kodeProduk: string,
  quarter: string,
  level: OrgLevel,
  parentNip: string | null
): Promise<TargetLevelResult> {
  await requireNsmOrAdmin();

  const children = await getOrgChildren(level, parentNip);
  const nips = children.map((c) => c.nip);

  const rows = await prisma.productTargetAllocation.findMany({ where: { kodeProduk, quarter, nip: { in: nips } } });
  const parentRow = parentNip
    ? await prisma.productTargetAllocation.findUnique({ where: { kodeProduk_quarter_nip: { kodeProduk, quarter, nip: parentNip } } })
    : null;

  const qtyByNip = new Map<string, number>(
    rows.map((r: { nip: string; qty: { toString(): string } }) => [r.nip, parseFloat(r.qty.toString()) || 0])
  );

  return {
    parentQty: parentRow ? parseFloat(parentRow.qty.toString()) || 0 : null,
    children: children.map((c) => ({ ...c, qty: qtyByNip.get(c.nip) ?? 0 })),
  };
}

/** Removes a single NIP's allocation for a product+quarter — distinct from saving qty=0,
 * this makes the row "never set" again rather than "explicitly zero". */
export async function deleteTargetAllocationAction(
  kodeProduk: string,
  quarter: string,
  nip: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireNsmOrAdmin();
    await assertWritable(session.role);
    await prisma.productTargetAllocation.deleteMany({ where: { kodeProduk, quarter, nip } });
    revalidatePath("/admin/target-produk");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menghapus." };
  }
}

/** Bulk-saves qty for a set of NIPs at whatever level the caller is currently viewing. */
export async function setTargetAllocationsAction(
  kodeProduk: string,
  quarter: string,
  entries: { nip: string; qty: number }[]
): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireNsmOrAdmin();
    await assertWritable(session.role);
    for (const e of entries) {
      if (isNaN(e.qty)) continue;
      await prisma.productTargetAllocation.upsert({
        where: { kodeProduk_quarter_nip: { kodeProduk, quarter, nip: e.nip } },
        create: { kodeProduk, quarter, nip: e.nip, qty: e.qty, setBy: session.userId },
        update: { qty: e.qty, setBy: session.userId },
      });
    }
    revalidatePath("/admin/target-produk");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menyimpan." };
  }
}

/**
 * Applies manual MR-level allocations to their DRAFT POA for the quarter —
 * sums each MR's qty across every kontes product (qty × HNA = value), same
 * PoaForm.target destination applyQuarterlyTargetsAction (the algorithmic
 * path) writes to. NSM/SM/ASM rows are cascading subtotals only, not applied
 * directly — only leaf MR rows represent an actual person's POA target.
 */
export async function applyManualTargetsAction(
  quarter: string
): Promise<{ ok: boolean; applied?: number; skipped?: number; error?: string }> {
  try {
    const session = await requireNsmOrAdmin();
    await assertWritable(session.role);

    const { getProducts } = await import("@/lib/masterData");
    const allProducts = await getProducts();
    const hnaByKode = new Map(allProducts.map((p: { kodeProduk: string; hna: string }) => [p.kodeProduk, parseFloat(p.hna) || 0]));

    const allocations = await prisma.productTargetAllocation.findMany({ where: { quarter } });
    const candidateNips = [...new Set(allocations.map((a: { nip: string }) => a.nip))];
    const mrUsers = candidateNips.length > 0
      ? await prisma.user.findMany({ where: { nip: { in: candidateNips }, role: "MR" }, select: { nip: true } })
      : [];
    const mrNipSet = new Set(mrUsers.map((u: { nip: string }) => u.nip));

    const valueByMr = new Map<string, number>();
    for (const a of allocations as { nip: string; kodeProduk: string; qty: { toString(): string } }[]) {
      if (!mrNipSet.has(a.nip)) continue; // NSM/SM/ASM subtotal rows — not applied directly
      const hna = hnaByKode.get(a.kodeProduk) ?? 0;
      const qty = parseFloat(a.qty.toString()) || 0;
      valueByMr.set(a.nip, (valueByMr.get(a.nip) ?? 0) + qty * hna);
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
