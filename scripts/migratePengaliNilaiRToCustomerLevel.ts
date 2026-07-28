/**
 * One-off migration: Pengali Nilai R moves from per-product to per-customer
 * (2026-07-28 request) — every PoaLineItem for the same doctor (poaId +
 * kodePI + namaCust) must end up sharing one value going forward.
 *
 * Existing drafts already have a DIFFERENT pengaliNilaiR per product row, so
 * collapsing to one value naively (e.g. always 1, or the first row's value)
 * would change each doctor's total Nilai PSSP (rencanaTotalBiaya *
 * persenPsspDokter * pengaliNilaiR, summed across their products) — the
 * requirement is that this total must NOT change.
 *
 * Fix: for each doctor group, replace every row's pengaliNilaiR with the
 * weighted average
 *
 *   P = Σ(rencanaTotalBiaya_i * persenPsspDokter_i * pengaliNilaiR_i)
 *       ─────────────────────────────────────────────────────────────
 *       Σ(rencanaTotalBiaya_i * persenPsspDokter_i)
 *
 * Applying this single P uniformly across the group reproduces the exact
 * same Σ(rencanaTotalBiaya_i * persenPsspDokter_i * P) as before, by
 * construction. Groups with no PSSP weight at all (denominator 0 — every
 * row's persenPsspDokter is 0/null) are left at P = 1 (the standard
 * default, see resolvePengaliNilaiR in LineItemEditor.tsx) since no PSSP
 * value depends on the multiplier there anyway.
 *
 * Run (dry run, no writes):
 *   npx tsx scripts/migratePengaliNilaiRToCustomerLevel.ts
 * Run for real:
 *   npx tsx scripts/migratePengaliNilaiRToCustomerLevel.ts --apply
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");

function toNum(v: { toString(): string } | null | undefined): number {
  return parseFloat((v ?? "0").toString()) || 0;
}

async function main() {
  const items = await prisma.poaLineItem.findMany({
    select: {
      id: true, poaId: true, kodePI: true, namaCust: true,
      rencanaTotalBiaya: true, persenPsspDokter: true, pengaliNilaiR: true,
    },
  });

  const groups = new Map<string, typeof items>();
  for (const it of items) {
    const key = `${it.poaId}|${it.kodePI ?? ""}|${it.namaCust}`;
    const list = groups.get(key) ?? [];
    list.push(it);
    groups.set(key, list);
  }

  let groupsChanged = 0, rowsChanged = 0;
  const updates: { id: string; from: number | null; to: number }[] = [];

  for (const [key, rows] of groups) {
    const pengaliValues = new Set(rows.map((r) => (r.pengaliNilaiR != null ? toNum(r.pengaliNilaiR) : 1)));
    if (pengaliValues.size <= 1) continue; // already uniform — nothing to reconcile

    let weightedSum = 0, weightTotal = 0;
    for (const r of rows) {
      const weight = toNum(r.rencanaTotalBiaya) * toNum(r.persenPsspDokter);
      const pengali = r.pengaliNilaiR != null ? toNum(r.pengaliNilaiR) : 1;
      weightedSum += weight * pengali;
      weightTotal += weight;
    }
    const pNew = weightTotal > 0 ? weightedSum / weightTotal : 1;
    const pNewRounded = Math.round(pNew * 10000) / 10000;

    groupsChanged++;
    console.log(`${key}: ${rows.length} produk, nilai lama {${[...pengaliValues].join(", ")}} → ${pNewRounded}`);
    for (const r of rows) {
      const current = r.pengaliNilaiR != null ? toNum(r.pengaliNilaiR) : null;
      if (current === pNewRounded) continue;
      rowsChanged++;
      updates.push({ id: r.id, from: current, to: pNewRounded });
    }
  }

  console.log(`\n${groupsChanged} grup dokter perlu direkonsiliasi, ${rowsChanged} baris akan diubah.`);

  if (!APPLY) {
    console.log("Dry run — jalankan ulang dengan --apply untuk benar-benar menyimpan perubahan.");
    await prisma.$disconnect();
    return;
  }

  for (const u of updates) {
    await prisma.poaLineItem.update({ where: { id: u.id }, data: { pengaliNilaiR: u.to } });
  }
  console.log(`Selesai — ${updates.length} baris diupdate.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
