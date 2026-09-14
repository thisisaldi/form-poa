/**
 * Fills in Outlet.coveredByNip/coveredByRole for outlets whose whole
 * FF+SPV territory was NEVER FILLED at all — a gap outletCoverageSync.ts
 * (Postgres-only, driven by MrOutletAssignment) can never close: outletSync.ts
 * only ever syncs assignments for CURRENTLY ACTIVE MRs from Nexus, which has
 * no concept of a territory nobody was ever hired for (as opposed to a
 * filled-then-vacated one, which outletCoverageSync.ts's live nipAtasan walk
 * already handles fine).
 *
 * Confirmed live (2026-09-14 bug report): ASM L260217's outlet dropdown was
 * empty creating a POA — his whole area (BENGKULU KOTA + LUBUK LINGGAU) has
 * no FF/SPV ever hired (Nexus's employee list has no row for that slot at
 * all, so nothing in POA's own DB ever pointed those outlets at him).
 * mkt_insight.Struktur_Marketing_PI DOES still carry a full row per outlet
 * for a vacant slot, using literal "(VACANT) <territory name>" placeholder
 * FF_Nama/SPV_Nama (confirmed via direct query) — same "(VACANT)" convention
 * scripts/matchStrukturBaruFromMssql.ts already filters on for name
 * resolution. This syncs straight from THAT table for exactly the rows
 * where BOTH FF and SPV are vacant, rolling coverage up to ASM_NIP (the
 * next level, which the sample data confirms is always a real person).
 *
 * Wired into orgAndOutletScheduler.ts as a step after outletCoverageSync —
 * order doesn't actually matter between them (disjoint row sets: one only
 * touches outlets with a real MrOutletAssignment, this one only touches
 * genuinely-never-filled ones), kept adjacent since they update the same
 * two Outlet columns for the same underlying reason.
 */
import sql from "mssql";
import { prisma } from "@/lib/prisma";

export interface VacantTerritoryCoverageSyncResult {
  rowsConsidered: number;
  outletsUpdated: number;
  errors: string[];
}

interface StrukturRow {
  KodePI: string;
  ASM_NIP: string | null;
}

function isVacantName(nama: string | null): boolean {
  return !nama || nama.toUpperCase().startsWith("(VACANT)");
}

export async function runVacantTerritoryCoverageSync(connectionString: string): Promise<VacantTerritoryCoverageSyncResult> {
  const errors: string[] = [];

  // Same connection-string parsing as salesHistorySync.ts (this codebase's
  // established pattern for turning the ADO-style MSSQL_CONNECTION_STRING
  // into `mssql` package config).
  const csMap: Record<string, string> = {};
  for (const part of connectionString.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) csMap[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
  }
  const pool = await sql.connect({
    server: csMap["server"] ?? "",
    database: csMap["database"] ?? "mkt_insight",
    user: csMap["user id"] ?? csMap["user"] ?? "",
    password: csMap["password"] ?? "",
    requestTimeout: 120000,
    options: {
      encrypt: csMap["encrypt"]?.toLowerCase() !== "false",
      trustServerCertificate: csMap["trustservercertificate"]?.toLowerCase() === "true",
    },
  });

  let recordset: { KodePI: string; FF_Nama: string | null; SPV_Nama: string | null; ASM_NIP: string | null }[];
  try {
    ({ recordset } = await pool.request().query<{ KodePI: string; FF_Nama: string | null; SPV_Nama: string | null; ASM_NIP: string | null }>(`
      SELECT DISTINCT KodePI, FF_Nama, SPV_Nama, ASM_NIP
      FROM Struktur_Marketing_PI
      WHERE FF_Nama LIKE '(VACANT)%' AND SPV_Nama LIKE '(VACANT)%' AND ASM_NIP IS NOT NULL
    `));
  } finally {
    await pool.close();
  }

  let updated = 0;
  const CONCURRENCY = 20;
  let next = 0;
  async function worker() {
    while (next < recordset.length) {
      const i = next++;
      const r = recordset[i];
      // Belt-and-suspenders — the WHERE clause already filters this, but a
      // NULL/odd ASM_NIP would otherwise silently roll an outlet up to
      // "undefined".
      if (!r.ASM_NIP || isVacantName(r.FF_Nama) === false || isVacantName(r.SPV_Nama) === false) continue;
      try {
        await prisma.outlet.update({
          where: { kodePI: r.KodePI },
          data: { coveredByNip: r.ASM_NIP, coveredByRole: "ASM" },
        });
        updated++;
      } catch (err) {
        // Outlet row doesn't exist in Postgres yet (outletSync.ts hasn't
        // upserted it — same benign race outletCoverageSync.ts already notes).
        errors.push(`KodePI ${r.KodePI}: ${String(err)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, recordset.length) }, worker));

  return { rowsConsidered: recordset.length, outletsUpdated: updated, errors };
}
