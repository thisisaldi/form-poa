/**
 * Exodus API → PostgreSQL outlet + MR-outlet assignment sync.
 *
 * Cutover 2026-09-02: source moved from Nexus (get_outlet_by_nip) to Exodus,
 * per user decision ("gapake nexus lagi"). Originally implemented as a
 * full-outlet-list + territory-NAME-join hack (core/v1/outlets/users with no
 * params was assumed to have no per-nip filter — its 500 error
 * "GetOutletByUserNIP: user projects not found" seemed to confirm that).
 * Corrected same day: that endpoint DOES take a `nip` query param and
 * returns exactly that NIP's own outlets directly — the earlier 500 was
 * simply the param being missing (see exodusApi.ts's getExodusOutletsByNip).
 * No join/matching needed anymore, one call per NIP.
 *
 * Two calls per NIP (both in src/lib/exodusApi.ts):
 *   - getExodusOutletsByNip(nip) — that NIP's own outlets, code/name/sector/
 *     city + a human-readable TerritoryName. No territory CODE.
 *   - getExodusNipZoneHierarchy(nip) — that NIP's own zone + ancestor chain
 *     (territory/subarea/area/region), gives the real zone codes. Only
 *     Field Force NIPs resolve a territory (a Supervisor acting as MR has
 *     own zone = subarea, no territory of their own) — when it doesn't
 *     resolve, kodeGT/namaGT/kodeSub.../kodeReg... are just left null on
 *     that NIP's outlets rather than skipping the NIP entirely (unlike the
 *     original hack, outlet<->NIP here no longer DEPENDS on resolving a
 *     territory — it's already given directly by getExodusOutletsByNip).
 *
 * Fields with no Exodus equivalent at all (province, outCode, statusOutlet,
 * namaChannel, groupRS, kategori, coveredByNip/coveredByRole) are left out
 * of the upsert `update` clause — same as the Nexus version, they stay
 * whatever scripts/importStrukturVerifiedKAM.ts last set them to.
 */

import { prisma } from "@/lib/prisma";
import { getExodusOutletsByNip, getExodusNipZoneHierarchy, type ExodusOutletMaster, type NipZoneHierarchy } from "@/lib/exodusApi";

const CONCURRENCY = 10;

export interface OutletSyncResult {
  nipsIterated: number;
  nipsFailed: number; // outlet list fetch failed for this NIP — excluded from upsert AND assignment delete/replace
  nipsSkippedNoTerritory: number; // outlets fetched fine, but zone hierarchy didn't resolve a territory — outlets/assignments still synced, just missing kodeGT/namaGT/kodeSub.../kodeReg...
  outletsUpserted: number;
  assignmentsReplaced: number;
  errors: string[];
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
    const [outlets, hierarchy] = await Promise.all([
      getExodusOutletsByNip(nip),
      getExodusNipZoneHierarchy(nip),
    ]);
    if (outlets === null) errors.push(`NIP ${nip}: outlet fetch failed`);
    return { nip, outlets, hierarchy };
  });

  const resolved = fetched.filter(
    (f): f is { nip: string; outlets: ExodusOutletMaster[]; hierarchy: NipZoneHierarchy | null } => f.outlets !== null
  );

  let outletsUpserted = 0;
  const touchedOutletCodes = new Set<string>();
  for (const { outlets, hierarchy } of resolved) {
    for (const outlet of outlets) {
      if (touchedOutletCodes.has(outlet.code)) continue;
      touchedOutletCodes.add(outlet.code);
      const fields = {
        namaOutlet: outlet.name,
        sector: outlet.sector,
        kota: outlet.city,
        kodeSub: hierarchy?.subarea?.code ?? null,
        namaSub: hierarchy?.subarea?.name ?? null,
        kodeArea: hierarchy?.area?.code ?? null,
        namaArea: hierarchy?.area?.name ?? null,
        kodeReg: hierarchy?.region?.code ?? null,
        namaReg: hierarchy?.region?.name ?? null,
        kodeGT: hierarchy?.territory?.code ?? null,
        namaGT: hierarchy?.territory?.name ?? outlet.territoryName,
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
  }

  const coveredNips = resolved.map((r) => r.nip);
  let assignmentsReplaced = 0;
  if (coveredNips.length > 0) {
    await prisma.mrOutletAssignment.deleteMany({
      where: { periode, nipMR: { in: coveredNips } },
    });

    for (const { nip, outlets } of resolved) {
      for (const outlet of outlets) {
        try {
          await prisma.mrOutletAssignment.create({
            data: { nipMR: nip, kodePI: outlet.code, periode, syncedAt: now },
          });
          assignmentsReplaced++;
        } catch (err) {
          errors.push(`Assignment ${nip}→${outlet.code}: ${String(err)}`);
        }
      }
    }
  }

  const nipsFailed = fetched.length - resolved.length;
  const nipsSkippedNoTerritory = resolved.filter((r) => !r.hierarchy?.territory).length;

  return {
    nipsIterated: nips.length,
    nipsFailed,
    nipsSkippedNoTerritory,
    outletsUpserted,
    assignmentsReplaced,
    errors,
  };
}
