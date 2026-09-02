/**
 * Backfills Customer.customerCodeExodus from Exodus
 * (core/v1/customers/users/{nip}, getExodusCustomersForMr — same call the
 * dokter picker already uses), matched onto existing Customer rows by
 * kodeCustomer == CustomerCode.
 *
 * Not run per-request from /api/poa-doctors — that endpoint reads this
 * column DB-only (getCustomerCodeExodusByKodeCust in poaDoctorsRows.ts).
 * Doing the live per-NIP fetch there would mean one external call per
 * distinct PoaForm owner on the company-wide (no `?nip=`) path, which
 * docs/PERFORMANCE.md §2.4 forbids (query/call-in-loop). This script is the
 * batch alternative — same per-active-MR loop shape as
 * src/lib/sync/outletSync.ts, run on a schedule or by hand.
 *
 * Usage: npx tsx scripts/syncCustomerCodeExodus.ts
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getExodusCustomersForMr } from "../src/lib/exodusApi";

const CONCURRENCY = 10;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  const activeMrs = await prisma.user.findMany({ where: { role: "MR", isActive: true }, select: { nip: true } });
  console.log(`Fetching Exodus customer roster for ${activeMrs.length} active MR(s)...`);

  let nipsFailed = 0;
  const seenCodes = new Map<string, string | null>();
  await mapWithConcurrency(activeMrs, CONCURRENCY, async ({ nip }: { nip: string }) => {
    const list = await getExodusCustomersForMr(nip);
    if (!list) { nipsFailed++; return; }
    for (const c of list) {
      if (c.customerCode && c.customerCodeExodus != null) {
        seenCodes.set(c.customerCode, c.customerCodeExodus);
      }
    }
  });

  console.log(`Resolved ${seenCodes.size} distinct customer code(s) with a CustomerCodeExodus. NIP fetch failures: ${nipsFailed}.`);

  let updated = 0;
  for (const [kodeCustomer, customerCodeExodus] of seenCodes) {
    const res = await prisma.customer.updateMany({
      where: { kodeCustomer },
      data: { customerCodeExodus },
    });
    updated += res.count;
  }

  console.log(`Done. Customer rows updated: ${updated}.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
