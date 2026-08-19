/**
 * Diagnostic (read-only, writes nothing): validates the concern raised in
 * docs/doctor-add-lockdown/01-business-rules.md OQ-3 — if getCustomersByOutlet()
 * stops merging local CustomerOutlet rows and relies 100% on the live Exodus/Nexus
 * API (get_customer_by_outlet), how many currently-searchable local doctors would
 * disappear from the dropdown?
 *
 * For every outlet that has local CustomerOutlet rows, fetches the same API
 * (api-nexus.pharos.id/api/r/poa/get_customer_by_outlet) the app already calls,
 * and applies the SAME match logic as getCustomersByOutlet() (customer.ts:591-599:
 * match by kodeCustomer/vbCode uppercase, OR by name uppercase) to find local
 * customers with no matching API result — i.e. customers that would vanish from
 * search once the DB side of the merge is removed.
 *
 * Run: npx tsx scripts/checkCustomerFullApiGap.ts
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { nexusAuthHeaders } from "../src/lib/nexusAuth";

const NEXUS_BASE = "https://api-nexus.pharos.id/api/r/poa";
const CONCURRENCY = 10;
const TIMEOUT_MS = 5000;

interface NexusCustomer {
  vbCode: string | null;
  namaCustomer: string;
}

// Tells apart "API returned empty" vs "API call failed" (the app's own
// fetchNexusCustomersByOutlet in customer.ts conflates both into [] on purpose —
// for this diagnostic we want to know which, since a failed call shouldn't count
// as a genuine search gap).
async function fetchNexusWithStatus(kodePI: string): Promise<{ ok: boolean; list: NexusCustomer[] }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(
      `${NEXUS_BASE}/get_customer_by_outlet?outlet_code=${encodeURIComponent(kodePI)}`,
      { signal: controller.signal, headers: nexusAuthHeaders() }
    );
    clearTimeout(timeout);
    if (!res.ok) return { ok: false, list: [] };
    const json = await res.json();
    const customers = json?.data?.customers;
    if (!Array.isArray(customers)) return { ok: false, list: [] };
    const list = customers
      .filter((c): c is { vb_code?: string; customer_name?: string } =>
        !!c && typeof c.customer_name === "string")
      .map((c) => ({
        vbCode: typeof c.vb_code === "string" && c.vb_code.trim() ? c.vb_code.trim() : null,
        namaCustomer: c.customer_name!.trim(),
      }));
    return { ok: true, list };
  } catch {
    return { ok: false, list: [] };
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  console.log("Loading local CustomerOutlet rows grouped by outlet...");
  const rows = await prisma.customerOutlet.findMany({
    include: { customer: { select: { kodeCustomer: true, namaCustomer: true } } },
  });
  console.log(`  ${rows.length} local CustomerOutlet rows total.\n`);

  const byOutlet = new Map<string, { kodeCustomer: string | null; namaCustomer: string }[]>();
  for (const r of rows) {
    const list = byOutlet.get(r.kodePI) ?? [];
    list.push({ kodeCustomer: r.customer.kodeCustomer, namaCustomer: r.customer.namaCustomer });
    byOutlet.set(r.kodePI, list);
  }
  const outletCodes = [...byOutlet.keys()];
  console.log(`Distinct outlets with local customer data: ${outletCodes.length}`);
  console.log(`Querying Exodus/Nexus API per outlet (concurrency ${CONCURRENCY}, timeout ${TIMEOUT_MS}ms)...\n`);

  let done = 0;
  let apiFailed = 0;
  let totalLocal = 0;
  let totalGap = 0;
  let outletsWithGap = 0;
  const worstOffenders: { kodePI: string; localCount: number; gapCount: number; gapPct: number }[] = [];

  await mapWithConcurrency(outletCodes, CONCURRENCY, async (kodePI) => {
    const local = byOutlet.get(kodePI)!;
    const { ok, list: nexusCustomers } = await fetchNexusWithStatus(kodePI);
    done++;
    if (done % 50 === 0) console.log(`  ...${done}/${outletCodes.length}`);

    if (!ok) {
      apiFailed++;
      return; // don't count failed calls as "gap" — can't tell real gap from API being down
    }

    const nexusKodeSet = new Set(nexusCustomers.map((c) => c.vbCode?.toUpperCase()).filter(Boolean));
    const nexusNameSet = new Set(nexusCustomers.map((c) => c.namaCustomer.toUpperCase()));

    let outletGap = 0;
    for (const c of local) {
      totalLocal++;
      const matched =
        (c.kodeCustomer && nexusKodeSet.has(c.kodeCustomer.toUpperCase())) ||
        nexusNameSet.has(c.namaCustomer.trim().toUpperCase());
      if (!matched) {
        outletGap++;
        totalGap++;
      }
    }
    if (outletGap > 0) {
      outletsWithGap++;
      worstOffenders.push({
        kodePI,
        localCount: local.length,
        gapCount: outletGap,
        gapPct: (outletGap / local.length) * 100,
      });
    }
  });

  console.log(`\nDone. ${apiFailed} outlet(s) had failed/unusable API calls (excluded from gap count, not treated as gap).\n`);

  console.log("── Hasil ──");
  console.log(`Total customer lokal (semua outlet yang dicek) : ${totalLocal}`);
  console.log(`Total customer lokal yang TIDAK match hasil API (akan hilang dari pencarian) : ${totalGap} (${totalLocal > 0 ? ((totalGap / totalLocal) * 100).toFixed(1) : "0"}%)`);
  console.log(`Outlet yang punya minimal 1 customer hilang : ${outletsWithGap} / ${outletCodes.length - apiFailed} outlet yang berhasil dicek\n`);

  worstOffenders.sort((a, b) => b.gapCount - a.gapCount);
  console.log("── 20 outlet dengan gap terbesar (jumlah absolut) ──");
  for (const o of worstOffenders.slice(0, 20)) {
    console.log(`  ${o.kodePI}: ${o.gapCount}/${o.localCount} customer lokal tidak match API (${o.gapPct.toFixed(0)}%)`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
