/**
 * Fills NonHospitalMonthlyEntry.scMenang: per MR (PoaScForm.ownerId) and month,
 * the number of OUTLETS "menang" — an outlet wins when at least one product of
 * its APPROVED_BY_NSM SC form reached its monthly target (PoaScProductItem.qtyPerBulan,
 * smallest unit) in that month's actual sales, so the SC gets incentive.
 * Actual = SUM(DIR10001B."Qty Sales") for DIVISI 'OMG1', matched on
 * Procode = kodeProduk + KodePI + Periode ("Qty Sales" = smallest unit; "Qty Sales UB"
 * is per box). Definition confirmed by the user 2026-09-28.
 *
 * An owner with an approved SC form that month gets a count (0 = had SC, none
 * won); an owner without one stays null (no SC = no data, not "0 menang").
 * Manual wins: rows with updatedByNip set (saved by a person) are left alone.
 * Manually triggered along with the absensi sync (syncNonHospitalAction).
 */

import sql from "mssql";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

export interface NhScMenangSyncResult {
  period: string;
  owners: number;
  updated: number;
  skippedManual: number;
  errors: string[];
}

const safe = (v: string) => /^[A-Za-z0-9]+$/.test(v);

export async function runNonHospitalScMenangSync(period: string): Promise<NhScMenangSyncResult> {
  const result: NhScMenangSyncResult = { period, owners: 0, updated: 0, skippedManual: 0, errors: [] };
  if (!env.MSSQL_CONNECTION_STRING) {
    result.errors.push("MSSQL not configured — skipped");
    return result;
  }
  const pcode = period.replace("-", "");

  const forms = (await prisma.poaScForm.findMany({
    where: { status: "APPROVED_BY_NSM", products: { some: { periodeMonth: pcode } } },
    select: { kodePI: true, ownerId: true, products: { where: { periodeMonth: pcode }, select: { kodeProduk: true, qtyPerBulan: true } } },
  })) as { kodePI: string; ownerId: string; products: { kodeProduk: string; qtyPerBulan: number }[] }[];
  if (forms.length === 0) return result;

  const pis = [...new Set(forms.map((f) => f.kodePI))].filter(safe);
  const pcs = [...new Set(forms.flatMap((f) => f.products.map((x) => x.kodeProduk)))].filter(safe);
  if (pis.length === 0 || pcs.length === 0) return result;

  const actual = new Map<string, number>();
  const pool = new sql.ConnectionPool(env.MSSQL_CONNECTION_STRING);
  await pool.connect();
  try {
    const { recordset } = await pool.request().query<{ k: string; pc: string; q: number }>(`
      SELECT KodePI AS k, RTRIM(Procode) AS pc, SUM([Qty Sales]) AS q
      FROM mkt_insight.dbo.DIR10001B
      WHERE Periode = ${Number(pcode)} AND DIVISI LIKE 'OMG1%'
        AND KodePI IN (${pis.map((n) => `'${n}'`).join(",")})
        AND Procode IN (${pcs.map((n) => `'${n}'`).join(",")})
      GROUP BY KodePI, Procode`);
    for (const r of recordset) actual.set(`${r.k}|${r.pc}`, r.q);
  } finally {
    await pool.close();
  }

  const winsByOwner = new Map<string, Set<string>>();
  for (const f of forms) {
    const wins = winsByOwner.get(f.ownerId) ?? new Set<string>();
    winsByOwner.set(f.ownerId, wins);
    if (f.products.some((x) => x.qtyPerBulan > 0 && (actual.get(`${f.kodePI}|${x.kodeProduk}`) ?? 0) >= x.qtyPerBulan)) wins.add(f.kodePI);
  }
  result.owners = winsByOwner.size;

  const existing = (await prisma.nonHospitalMonthlyEntry.findMany({
    where: { nip: { in: [...winsByOwner.keys()] }, period },
    select: { nip: true, updatedByNip: true },
  })) as { nip: string; updatedByNip: string | null }[];
  const manual = new Set(existing.filter((e) => e.updatedByNip != null).map((e) => e.nip));

  for (const [nip, wins] of winsByOwner) {
    if (manual.has(nip)) { result.skippedManual++; continue; }
    try {
      await prisma.nonHospitalMonthlyEntry.upsert({
        where: { nip_period: { nip, period } },
        create: { nip, period, scMenang: wins.size },
        update: { scMenang: wins.size },
      });
      result.updated++;
    } catch (err) {
      result.errors.push(`${nip}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}
