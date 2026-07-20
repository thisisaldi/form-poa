/**
 * Promotes OutletStrukturBaru (the staging import of the new/August restructure,
 * see importStrukturBaru.ts) into the real MrOutletAssignment table — MERGED
 * with the existing (July-structure-based) assignments, not a wholesale replace:
 *
 *   - For an outlet where the new structure has a resolved PSR, that PSR
 *     becomes the SOLE assignee for that outlet (overrides whatever was there).
 *   - For an outlet the new structure has no PSR for (~80% of rows — a real
 *     gap in that source file, most rows have a blank PSR cell), the old
 *     July-structure assignment(s) for that outlet are kept as-is.
 *
 * This avoids the failure mode of a plain delete+recreate: since most outlets
 * in the new file have no PSR yet, replacing wholesale would leave most MRs
 * with zero assigned outlets. The old baseline comes from
 * src/lib/mock/generated-data.json's mrAssignments (produced by mock:generate),
 * so this only makes sense to run after that's been generated/seeded.
 *
 * PSR is treated as the outlet-holding MR (the new structure's equivalent of
 * the old structure's SPV/FF, both of which already map to the MR role — see
 * orgStructureSync.ts). The new structure's extra "GM" level has no equivalent
 * in this app's Role model and is intentionally ignored here.
 *
 * Rows with no resolved PSR NIP, or a PSR NIP that isn't an existing User,
 * are skipped and counted (not silently guessed at). Outlets referenced by
 * kodePI that don't exist yet are created with minimal fields so the
 * assignment can be written; existing Outlet rows are left untouched.
 *
 * Run: npx tsx scripts/promoteStrukturBaruOutletMapping.ts
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { prisma } from "../src/lib/prisma";

async function main() {
  const now = new Date();
  const periode = now.getFullYear() * 100 + (now.getMonth() + 1);

  // ── Old (July-structure) baseline — may assign more than one MR per outlet
  // (e.g. Supervisor + Field Force both hold the same outlet). ──────────────
  const genPath = path.resolve("src/lib/mock/generated-data.json");
  if (!fs.existsSync(genPath)) {
    console.error(`generated-data.json not found at ${genPath} — run: npm run mock:generate`);
    process.exit(1);
  }
  const gen = JSON.parse(fs.readFileSync(genPath, "utf-8")) as {
    mrAssignments: { nipMR: string; kodePI: string }[];
  };
  const oldByOutlet = new Map<string, Set<string>>();
  for (const a of gen.mrAssignments) {
    const set = oldByOutlet.get(a.kodePI) ?? new Set<string>();
    set.add(a.nipMR);
    oldByOutlet.set(a.kodePI, set);
  }
  console.log(`Loaded ${gen.mrAssignments.length} old (July) assignments across ${oldByOutlet.size} outlets\n`);

  // ── New (August restructure) staging data ────────────────────────────────
  const rows = await prisma.outletStrukturBaru.findMany();
  console.log(`Loaded ${rows.length} rows from OutletStrukturBaru`);

  const existingOutlets = new Set(
    (await prisma.outlet.findMany({ select: { kodePI: true } })).map((o: { kodePI: string }) => o.kodePI)
  );
  const existingUsers = new Set(
    (await prisma.user.findMany({ select: { nip: true } })).map((u: { nip: string }) => u.nip)
  );

  let skippedNoNip = 0;
  let skippedNoUser = 0;
  let outletsCreated = 0;
  const newPsrByOutlet = new Map<string, string>();

  for (const row of rows as { kodePI: string; namaOutlet: string | null; psrNip: string | null }[]) {
    if (!row.psrNip) { skippedNoNip++; continue; }
    if (!existingUsers.has(row.psrNip)) { skippedNoUser++; continue; }

    if (!existingOutlets.has(row.kodePI)) {
      await prisma.outlet.create({
        data: { kodePI: row.kodePI, namaOutlet: row.namaOutlet ?? row.kodePI, statusOutlet: "A", syncedAt: now },
      });
      existingOutlets.add(row.kodePI);
      outletsCreated++;
    }

    newPsrByOutlet.set(row.kodePI, row.psrNip);
  }

  console.log(`Skipped (no resolved PSR NIP)         : ${skippedNoNip}`);
  console.log(`Skipped (PSR NIP not an existing User): ${skippedNoUser}`);
  console.log(`Outlets created (were missing)        : ${outletsCreated}`);
  console.log(`Outlets with a new-structure PSR       : ${newPsrByOutlet.size}\n`);

  // ── Merge: new PSR overrides; otherwise keep the old assignment(s) ───────
  const merged = new Map<string, { nipMR: string; kodePI: string }>();
  const allOutlets = new Set([...oldByOutlet.keys(), ...newPsrByOutlet.keys()]);
  let outletsFromNew = 0, outletsFromOld = 0;
  for (const kodePI of allOutlets) {
    const newNip = newPsrByOutlet.get(kodePI);
    if (newNip) {
      merged.set(`${newNip}|${kodePI}`, { nipMR: newNip, kodePI });
      outletsFromNew++;
    } else {
      const oldNips = oldByOutlet.get(kodePI);
      if (oldNips) {
        for (const nip of oldNips) merged.set(`${nip}|${kodePI}`, { nipMR: nip, kodePI });
        outletsFromOld++;
      }
    }
  }
  console.log(`Merged coverage: ${outletsFromNew} outlets from new structure, ${outletsFromOld} outlets kept from old`);
  console.log(`Total unique MR<->outlet assignments to write: ${merged.size}\n`);

  await prisma.mrOutletAssignment.deleteMany({ where: { periode } });

  const data = [...merged.values()].map((a) => ({ ...a, periode, syncedAt: now }));
  const CHUNK = 1000;
  for (let i = 0; i < data.length; i += CHUNK) {
    await prisma.mrOutletAssignment.createMany({ data: data.slice(i, i + CHUNK), skipDuplicates: true });
  }

  console.log(`✅ Done. MrOutletAssignment rebuilt for periode ${periode}: ${data.length} rows.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
