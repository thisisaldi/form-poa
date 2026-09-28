/**
 * Fills NonHospitalMonthlyEntry.absensiHariTelat from the SIPP attendance API
 * for every active OMEGA MR/ASM/SM: hari telat = attendance records with
 * AbsTelatYN = "Y" in the month (working assumption of OQ-3 in
 * docs/evaluasi-kontrak-non-hospital/01-business-rules.md — the band itself is
 * still unconfirmed). Manually triggered (ADMIN button on
 * /evaluasi-kontrak-non-hospital), same as the Hospital sync.
 *
 * Manual wins: a row with updatedByNip set was saved by a person
 * (saveNonHospitalMonthlyEntryAction) and is left alone; sync-written rows keep
 * updatedByNip null. scMenang is never touched here.
 *
 * PTID: SIPP silently returns nothing for a wrong ptId, and OMEGA users have
 * no HR-master mapping (User.sippAbsPtId is null), so try the known ones
 * (1, 7, 20 — see SippEmployee) until one returns records.
 * ponytail: own NIP only, no alias-NIP merge like the Hospital sync — add when a PSR with a changed NIP shows up.
 */

import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { getAbsensiByNip, monthDateRange } from "@/lib/sippApi";
import { realNip } from "@/lib/nonHospitalScoring";

export interface NhAbsensiSyncResult {
  period: string;
  scanned: number;
  updated: number;
  skippedManual: number;
  noData: number;
  errors: string[];
}

const PT_IDS = [1, 7, 20];
const CONCURRENCY = 6;

export async function runNonHospitalAbsensiSync(period: string): Promise<NhAbsensiSyncResult> {
  const result: NhAbsensiSyncResult = { period, scanned: 0, updated: 0, skippedManual: 0, noData: 0, errors: [] };
  if (!env.SIPP_BASE_URL) {
    result.errors.push("SIPP not configured (SIPP_BASE_URL missing) — skipped");
    return result;
  }

  const people = (await prisma.user.findMany({
    where: { project: "OMEGA", role: { in: ["MR", "ASM", "SM"] }, isActive: true, isDummy: false },
    select: { nip: true, sippAbsPtId: true },
  })) as { nip: string; sippAbsPtId: number | null }[];
  const existing = (await prisma.nonHospitalMonthlyEntry.findMany({
    where: { nip: { in: people.map((p) => p.nip) }, period },
    select: { nip: true, updatedByNip: true },
  })) as { nip: string; updatedByNip: string | null }[];
  const manual = new Set(existing.filter((e) => e.updatedByNip != null).map((e) => e.nip));
  const { startDate, endDate } = monthDateRange(period);

  async function one(p: { nip: string; sippAbsPtId: number | null }) {
    result.scanned++;
    if (manual.has(p.nip)) return void result.skippedManual++;
    const ptIds = [...new Set([p.sippAbsPtId, ...PT_IDS].filter((x): x is number => x != null))];
    // getAbsensiByNip returns null for BOTH "Data Not Found" on a wrong ptId and a real failure — can't tell them apart, so null just moves on to the next ptId.
    // ponytail: a genuine SIPP outage therefore reads as "tanpa data" — split in sippApi if that hides real failures.
    let records: Awaited<ReturnType<typeof getAbsensiByNip>> = null;
    for (const pt of ptIds) {
      records = await getAbsensiByNip(realNip(p.nip), pt, startDate, endDate);
      if (records?.length) break;
    }
    if (!records?.length) return void result.noData++;
    const hariTelat = records.filter((r) => r.absTelatYN === "Y").length;
    await prisma.nonHospitalMonthlyEntry.upsert({
      where: { nip_period: { nip: p.nip, period } },
      create: { nip: p.nip, period, absensiHariTelat: hariTelat },
      update: { absensiHariTelat: hariTelat },
    });
    result.updated++;
  }

  for (let i = 0; i < people.length; i += CONCURRENCY) {
    await Promise.all(people.slice(i, i + CONCURRENCY).map((p) =>
      one(p).catch((err) => void result.errors.push(`${p.nip}: ${err instanceof Error ? err.message : String(err)}`))
    ));
  }
  return result;
}
