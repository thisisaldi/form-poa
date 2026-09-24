/**
 * KPI Monitoring identity = person, not NIP. NIPs change (e.g. P→L when moving
 * to PML) and the same normalized name across NIPs is the same person
 * (confirmed 2026-09-24), so every NIP the HR master (SippEmployee) lists
 * under that name is an alias of the same personil. Callers (Call Activity /
 * Absensi sync, the monitoring listing) use this to gather data across all of
 * a person's NIPs and to show each person once.
 *
 * Name is normalized on the HR side only (HR name ↔ HR name) — never compared
 * to User.name, since Nexus and HR may spell a name differently. A NIP not in
 * the HR master simply has no aliases.
 */

import { prisma } from "@/lib/prisma";

export function normalizeName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
}

export interface AliasNip {
  nip: string;
  ptid: number;
  tglMasuk: Date | null;
  tglKeluar: Date | null;
}

export interface PersonIdentity {
  /** Same for every personil row that is the same person. */
  key: string;
  /** Every NIP of this person in the HR master, including the personil's own. */
  nips: AliasNip[];
}

/** Identity per given (current) NIP. NIPs absent from the HR master get `{ key: nip, nips: [] }`. */
export async function loadIdentities(currentNips: string[]): Promise<Map<string, PersonIdentity>> {
  const result = new Map<string, PersonIdentity>();
  if (currentNips.length === 0) return result;

  const own = (await prisma.sippEmployee.findMany({
    where: { nip: { in: currentNips } },
    select: { nip: true, namaNormalized: true },
  })) as { nip: string; namaNormalized: string }[];
  const keyByNip = new Map(own.map((r) => [r.nip, r.namaNormalized]));

  const keys = [...new Set(own.map((r) => r.namaNormalized).filter(Boolean))];
  const all = keys.length
    ? ((await prisma.sippEmployee.findMany({
        where: { namaNormalized: { in: keys } },
        select: { nip: true, namaNormalized: true, ptid: true, tglMasuk: true, tglKeluar: true },
      })) as { nip: string; namaNormalized: string; ptid: number; tglMasuk: Date | null; tglKeluar: Date | null }[])
    : [];
  const byKey = new Map<string, AliasNip[]>();
  for (const r of all) {
    byKey.set(r.namaNormalized, [...(byKey.get(r.namaNormalized) ?? []), { nip: r.nip, ptid: r.ptid, tglMasuk: r.tglMasuk, tglKeluar: r.tglKeluar }]);
  }

  for (const nip of currentNips) {
    const key = keyByNip.get(nip);
    result.set(nip, key && key.length > 0 ? { key, nips: byKey.get(key) ?? [] } : { key: nip, nips: [] });
  }
  return result;
}

/**
 * One personil row per person: when several current rows are the same person
 * (both NIPs still active in User), keep the one with the latest HR start date
 * (its NIP is the newest); ties keep the first.
 */
export function dedupeByIdentity<T extends { nip: string }>(personnel: T[], identities: Map<string, PersonIdentity>): T[] {
  const startOf = (nip: string) =>
    identities.get(nip)?.nips.find((a) => a.nip === nip)?.tglMasuk?.getTime() ?? 0;
  const best = new Map<string, T>();
  for (const p of personnel) {
    const key = identities.get(p.nip)?.key ?? p.nip;
    const cur = best.get(key);
    if (!cur || startOf(p.nip) > startOf(cur.nip)) best.set(key, p);
  }
  const keep = new Set([...best.values()].map((p) => p.nip));
  return personnel.filter((p) => keep.has(p.nip));
}

/** All NIPs to look up for a person: own NIP first, then aliases. */
export function allNips(nip: string, identity: PersonIdentity | undefined): string[] {
  return [nip, ...(identity?.nips.map((a) => a.nip).filter((n) => n !== nip) ?? [])];
}
