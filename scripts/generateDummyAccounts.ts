/**
 * Generates workshop/demo accounts: for every unique digit-suffix found across
 * real employee NIPs (e.g. "P260054" → "260054"), creates 4 dummy accounts —
 * MR{digits}, ASM{digits}, SM{digits}, NSM{digits} — each isDummy=true, each
 * with a self-contained approval chain (MR → ASM → SM → NSM) so one person
 * can walk the entire submit/approve flow solo using their own 4 accounts.
 *
 * Dummy accounts bypass outlet-assignment restrictions entirely (see
 * getOutletsByUser / canCreatePoa in src/lib) — they can plan against any outlet.
 *
 * Run: npx tsx scripts/generateDummyAccounts.ts
 */

import "dotenv/config";
import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();

const ROLE_PREFIXES: { prefix: string; role: Role }[] = [
  { prefix: "MR", role: Role.MR },
  { prefix: "ASM", role: Role.ASM },
  { prefix: "SM", role: Role.SM },
  { prefix: "NSM", role: Role.NSM },
];

async function main() {
  const realUsers = await prisma.user.findMany({
    where: { isDummy: false },
    select: { nip: true, name: true },
    orderBy: { nip: "asc" },
  });

  // Dedupe by digit-suffix — first-seen name wins for collisions.
  const groups = new Map<string, string>(); // digits -> name
  const collisions: string[] = [];
  for (const u of realUsers) {
    const digits = u.nip.replace(/^[A-Za-z]+/, "");
    if (!/^\d{4,}$/.test(digits)) continue; // skip anything that doesn't reduce to a plain number
    if (groups.has(digits)) {
      collisions.push(`${digits}: kept "${groups.get(digits)}", skipped "${u.name}" (${u.nip})`);
      continue;
    }
    groups.set(digits, u.name);
  }

  console.log(`${realUsers.length} real users → ${groups.size} unique digit-suffixes.`);
  if (collisions.length > 0) {
    console.log(`\n${collisions.length} collisions (kept first-seen name):`);
    collisions.forEach((c) => console.log(`  ${c}`));
  }

  // Build rows per role level so we can insert in FK-safe order: NSM, SM, ASM, MR.
  const rowsByPrefix: Record<string, { nip: string; name: string; role: Role; nipAtasan: string | null }[]> = {
    NSM: [], SM: [], ASM: [], MR: [],
  };

  for (const [digits, name] of groups) {
    rowsByPrefix.NSM.push({ nip: `NSM${digits}`, name, role: Role.NSM, nipAtasan: null });
    rowsByPrefix.SM.push({ nip: `SM${digits}`, name, role: Role.SM, nipAtasan: `NSM${digits}` });
    rowsByPrefix.ASM.push({ nip: `ASM${digits}`, name, role: Role.ASM, nipAtasan: `SM${digits}` });
    rowsByPrefix.MR.push({ nip: `MR${digits}`, name, role: Role.MR, nipAtasan: `ASM${digits}` });
  }

  let created = 0, skipped = 0;
  for (const prefix of ["NSM", "SM", "ASM", "MR"]) {
    const rows = rowsByPrefix[prefix];
    const result = await prisma.user.createMany({
      data: rows.map((r) => ({
        nip: r.nip,
        name: r.name,
        role: r.role,
        nipAtasan: r.nipAtasan,
        isActive: true,
        isDummy: true,
      })),
      skipDuplicates: true,
    });
    console.log(`  ${prefix}: ${result.count} created (${rows.length - result.count} already existed)`);
    created += result.count;
    skipped += rows.length - result.count;
  }

  console.log(`\n✅ Done. Created ${created} dummy accounts, skipped ${skipped} already present.`);
  console.log(`Sample logins: MR${[...groups.keys()][0]}, ASM${[...groups.keys()][0]}, SM${[...groups.keys()][0]}, NSM${[...groups.keys()][0]}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
