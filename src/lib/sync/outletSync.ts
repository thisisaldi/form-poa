/**
 * Nexus API → PostgreSQL outlet + MR-outlet assignment sync.
 *
 * Source: https://api-nexus.pharos.id/api/r/poa/get_outlet_by_nip?nip=..., called once per
 * active MR-role NIP already in Postgres `User` (synced separately by orgStructureSync.ts,
 * which is NOT migrated here — see docs/outlet-nexus-migration/README.md). SPV/FF collapse
 * into role "MR" in `User` already (see User.jabatan comment, schema.prisma), so a single
 * `role: "MR"` filter covers both.
 *
 * - Upserts distinct outlets returned across all NIP calls into the Outlet table. Fields
 *   not present in the Nexus response (statusOutlet, kategori, namaChannel, groupRS,
 *   outCode, coveredByNip/coveredByRole) are intentionally left out of the upsert clauses —
 *   they stay whatever scripts/importStrukturVerifiedKAM.ts last set them to
 *   (docs/outlet-nexus-migration/01-business-rules.md §3, OQ-3).
 * - Rebuilds MrOutletAssignment rows for the current periode, but with a SELECTIVE delete
 *   scoped to only the NIPs that were fetched successfully this run — NIPs that failed
 *   (network/timeout/unknown to Nexus) are left completely untouched, so a partial-failure
 *   run can never look like data loss for the NIPs it didn't reach.
 *   See docs/outlet-nexus-migration/01-business-rules.md §5 (resolution of OQ-1).
 */

import { prisma } from "@/lib/prisma";
import { nexusAuthHeaders } from "@/lib/nexusAuth";

const NEXUS_BASE = "https://api-nexus.pharos.id/api/r/poa";
const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 5000;

interface NexusOutlet {
  code: string;
  name: string;
  sector: string | null;
  city: string | null;
  province: string | null;
  area_code: string | null;
  area_name: string | null;
  region_code: string | null;
  region_name: string | null;
  subarea_code: string | null;
  subarea_name: string | null;
  territory_code: string | null;
  territory_name: string | null;
}

export interface OutletSyncResult {
  nipsIterated: number;
  nipsFailed: number;
  outletsUpserted: number;
  assignmentsReplaced: number;
  errors: string[];
}

async function fetchOutletsForNip(nip: string, attempt = 0): Promise<NexusOutlet[] | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`${NEXUS_BASE}/get_outlet_by_nip?nip=${encodeURIComponent(nip)}`, {
      signal: controller.signal,
      headers: nexusAuthHeaders(),
    });
    clearTimeout(timeout);
    if (!res.ok) {
      // Retry once for transient server errors; 4xx is a permanent failure for this NIP.
      if (res.status >= 500 && attempt < 1) return fetchOutletsForNip(nip, attempt + 1);
      return null;
    }
    const json = await res.json();
    const outlets = json?.data?.outlets;
    return Array.isArray(outlets) ? outlets : [];
  } catch {
    if (attempt < 1) return fetchOutletsForNip(nip, attempt + 1);
    return null;
  }
}

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

export async function runOutletSync(): Promise<OutletSyncResult> {
  const now = new Date();
  const periode = now.getFullYear() * 100 + (now.getMonth() + 1);
  const errors: string[] = [];

  const activeMrs = await prisma.user.findMany({
    where: { role: "MR", isActive: true },
    select: { nip: true },
  });
  const nips = activeMrs.map((u: { nip: string }) => u.nip);

  const fetched = await mapWithConcurrency(nips, CONCURRENCY, async (nip: string) => {
    const outlets = await fetchOutletsForNip(nip);
    if (outlets === null) errors.push(`NIP ${nip}: fetch failed after retry`);
    return { nip, outlets };
  });

  const succeeded = fetched.filter(
    (f): f is { nip: string; outlets: NexusOutlet[] } => f.outlets !== null
  );

  // ── Distinct outlets across all successful NIP responses ───────────────────
  const outletMap = new Map<string, NexusOutlet>();
  for (const { outlets } of succeeded) {
    for (const o of outlets) {
      if (!o.code) continue;
      if (!outletMap.has(o.code)) outletMap.set(o.code, o);
    }
  }

  let outletsUpserted = 0;
  for (const outlet of outletMap.values()) {
    const fields = {
      namaOutlet: outlet.name?.trim() || outlet.code,
      sector: outlet.sector?.trim() || null,
      kota: outlet.city?.trim() || null,
      propinsi: outlet.province?.trim() || null,
      kodeArea: outlet.area_code?.trim() || null,
      namaArea: outlet.area_name?.trim() || null,
      kodeReg: outlet.region_code?.trim() || null,
      namaReg: outlet.region_name?.trim() || null,
      kodeSub: outlet.subarea_code?.trim() || null,
      namaSub: outlet.subarea_name?.trim() || null,
      kodeGT: outlet.territory_code?.trim() || null,
      namaGT: outlet.territory_name?.trim() || null,
      syncedAt: now,
    };
    try {
      await prisma.outlet.upsert({
        where: { kodePI: outlet.code },
        create: { kodePI: outlet.code, ...fields },
        update: fields,
      });
      outletsUpserted++;
    } catch (err) {
      errors.push(`Outlet ${outlet.code}: ${String(err)}`);
    }
  }

  // ── Rebuild MrOutletAssignment — selective delete, only for NIPs fetched successfully.
  // NIPs that failed this run are left untouched (docs/outlet-nexus-migration/01-business-rules.md §5).
  const coveredNips = succeeded.map((s) => s.nip);
  let assignmentsReplaced = 0;
  if (coveredNips.length > 0) {
    await prisma.mrOutletAssignment.deleteMany({
      where: { periode, nipMR: { in: coveredNips } },
    });

    for (const { nip, outlets } of succeeded) {
      const kodePIs = new Set(outlets.map((o) => o.code).filter(Boolean));
      for (const kodePI of kodePIs) {
        try {
          await prisma.mrOutletAssignment.create({
            data: { nipMR: nip, kodePI, periode, syncedAt: now },
          });
          assignmentsReplaced++;
        } catch (err) {
          errors.push(`Assignment ${nip}→${kodePI}: ${String(err)}`);
        }
      }
    }
  }

  return {
    nipsIterated: nips.length,
    nipsFailed: nips.length - succeeded.length,
    outletsUpserted,
    assignmentsReplaced,
    errors,
  };
}
