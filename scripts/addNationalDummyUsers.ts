/**
 * Creates a self-contained MR → ASM → SM → NSM dummy account chain for each
 * named person below (2026-07-28 request) — same convention as
 * generateDummyAccounts.ts (prefix + digit-suffix from their given NIP,
 * isDummy=true so they bypass outlet-assignment restrictions and can plan
 * against any outlet nationally), but scoped to just these people instead of
 * every real employee's NIP.
 *
 * Run: npx tsx scripts/addNationalDummyUsers.ts
 */

import "dotenv/config";
import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();

const PEOPLE: { nip: string; name: string }[] = [
  { nip: "P090282", name: "Fita Ariyati" },
  { nip: "P240410", name: "dr Citra Anggreini" },
  { nip: "P250169", name: "Nila Metta" },
];

const ROLE_PREFIXES: { prefix: string; role: Role }[] = [
  { prefix: "NSM", role: Role.NSM },
  { prefix: "SM", role: Role.SM },
  { prefix: "ASM", role: Role.ASM },
  { prefix: "MR", role: Role.MR },
];

async function main() {
  let created = 0, skipped = 0;

  for (const person of PEOPLE) {
    const digits = person.nip.replace(/^[A-Za-z]+/, "");
    if (!/^\d{4,}$/.test(digits)) {
      console.error(`Skipping ${person.name} (${person.nip}) — NIP doesn't reduce to a plain digit suffix.`);
      continue;
    }

    console.log(`\n${person.name} (digits: ${digits})`);
    let prevNip: string | null = null;
    for (const { prefix, role } of ROLE_PREFIXES) {
      const nip = `${prefix}${digits}`;
      const result = await prisma.user.upsert({
        where: { nip },
        create: {
          nip,
          name: person.name,
          role,
          nipAtasan: prevNip,
          isActive: true,
          isDummy: true,
        },
        update: {
          name: person.name,
          role,
          nipAtasan: prevNip,
          isActive: true,
          isDummy: true,
        },
      });
      console.log(`  ${prefix}: ${nip} (${result.role}, reports to ${result.nipAtasan ?? "-"})`);
      prevNip = nip;
      created++;
    }
  }

  console.log(`\n✅ Done. Upserted ${created} accounts, skipped ${skipped}.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
