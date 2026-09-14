/**
 * One-time cleanup (2026-09-14): rewrite TargetHospitalValue.namaGT to the
 * live Outlet.namaGT spelling + backfill kodeGT, for rows ALREADY in the DB
 * (covers every periode, including 202607 which importTargetHospitalValue.ts
 * itself never re-derives — that one was a one-off backfill via
 * importTargetHospitalValueJuli.ts, see that script's doc comment).
 *
 * Rerunning the fixed importTargetHospitalValue.ts (which now canonicalizes
 * on every future import — see its doc comment) does NOT retroactively fix
 * already-imported rows, since the upsert key (namaGT, periode) changes when
 * the spelling changes — it would INSERT a new clean-named row and leave the
 * old dirty-named row behind as an orphan, not update it in place. This
 * script instead UPDATEs existing rows by id, preserving them.
 *
 * Matching: same normalizeGTName (src/lib/targetHospitalValue.ts) used
 * everywhere else in this table's read/import path — punctuation/spacing
 * noise and "DUMMY " prefixes bridge automatically; confirmed 2026-09-14
 * zero collisions (no 2 distinct raw namaGT values in this table map to the
 * same live Outlet GT), so a plain per-row UPDATE is safe — still guarded
 * below in case that ever stops being true for a future re-run.
 *
 * ~60 of 315 distinct namaGT (confirmed 2026-09-14) have NO live Outlet
 * match at all (normalizeGTName included) — left untouched (namaGT
 * unchanged, kodeGT stays null). Not a bug: these are GTs with no current
 * live counterpart (retired/renamed beyond what normalization can bridge,
 * same class of gap GT_NAME_ALIASES exists for at import time).
 *
 * Run: npx tsx scripts/cleanTargetHospitalValueGT.ts
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { normalizeGTName } from "../src/lib/targetHospitalValue";

async function main() {
  const liveOutlets = await prisma.outlet.findMany({
    where: { namaGT: { not: null } },
    select: { namaGT: true, kodeGT: true },
    distinct: ["namaGT"],
  });
  const canonicalByNorm = new Map<string, { namaGT: string; kodeGT: string | null }>();
  for (const o of liveOutlets) {
    if (!o.namaGT) continue;
    const n = normalizeGTName(o.namaGT);
    if (!canonicalByNorm.has(n)) canonicalByNorm.set(n, { namaGT: o.namaGT, kodeGT: o.kodeGT });
  }

  const distinctRows = await prisma.targetHospitalValue.findMany({ select: { namaGT: true }, distinct: ["namaGT"] });
  console.log(`${distinctRows.length} distinct namaGT in TargetHospitalValue.`);

  let renamed = 0, kodeGTOnly = 0, noMatch = 0, skippedCollision = 0;
  for (const { namaGT } of distinctRows) {
    const canon = canonicalByNorm.get(normalizeGTName(namaGT));
    if (!canon) { noMatch++; continue; }

    if (canon.namaGT !== namaGT) {
      // Guard against the canonical target colliding with a DIFFERENT
      // existing namaGT (would violate the (namaGT, periode) unique index) —
      // confirmed not to happen currently, but check defensively rather
      // than let the DB throw mid-run.
      const clash = await prisma.targetHospitalValue.findFirst({ where: { namaGT: canon.namaGT } });
      if (clash) { skippedCollision++; console.log(`  SKIP (collision) "${namaGT}" -> "${canon.namaGT}" already exists`); continue; }

      await prisma.targetHospitalValue.updateMany({
        where: { namaGT },
        data: { namaGT: canon.namaGT, kodeGT: canon.kodeGT },
      });
      renamed++;
    } else if (canon.kodeGT) {
      await prisma.targetHospitalValue.updateMany({ where: { namaGT }, data: { kodeGT: canon.kodeGT } });
      kodeGTOnly++;
    }
  }

  console.log(`\n✅ Renamed to canonical spelling: ${renamed}`);
  console.log(`✅ kodeGT backfilled (spelling already canonical): ${kodeGTOnly}`);
  console.log(`⬜ No live Outlet match (left untouched): ${noMatch}`);
  if (skippedCollision) console.log(`⚠️ Skipped due to collision: ${skippedCollision}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
