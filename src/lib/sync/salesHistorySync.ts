/**
 * Syncs outlet-level sales history from mkt_insight.dbo.DIR10001B into
 * OutletSalesHistory table. One row per (kodePI × itemKode), holding the
 * SUM([Value Sales]) for the 12 completed months before the current period.
 */

import sql from "mssql";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export interface SalesHistorySyncResult {
  upserted: number;
  periodeFrom: string;
  periodeTo: string;
  errors: string[];
}

/** Returns YYYYMM string for (year, month). Month is 1-based. */
function toYYYYMM(year: number, month: number): string {
  return `${year}${String(month).padStart(2, "0")}`;
}

/** Subtracts n months from a YYYYMM string. */
function subtractMonths(yyyymm: string, n: number): string {
  const year = parseInt(yyyymm.slice(0, 4));
  const month = parseInt(yyyymm.slice(4, 6));
  const date = new Date(year, month - 1 - n, 1);
  return toYYYYMM(date.getFullYear(), date.getMonth() + 1);
}

export async function runSalesHistorySync(
  connectionString: string
): Promise<SalesHistorySyncResult> {
  const now = new Date();
  const currentPeriode = toYYYYMM(now.getFullYear(), now.getMonth() + 1);
  // B-1 to B-12: exclude current month (still running), go back 12 completed months
  const periodeTo   = subtractMonths(currentPeriode, 1);   // last completed month
  const periodeFrom = subtractMonths(currentPeriode, 12);  // 12 months back

  const errors: string[] = [];

  // Parse connection string into config so we can set requestTimeout
  const csMap: Record<string, string> = {};
  for (const part of connectionString.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) csMap[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
  }
  const pool = await sql.connect({
    server:   csMap["server"] ?? "",
    database: csMap["database"] ?? "mkt_insight",
    user:     csMap["user id"] ?? csMap["user"] ?? "",
    password: csMap["password"] ?? "",
    requestTimeout: 120000,
    options: {
      encrypt:                csMap["encrypt"]?.toLowerCase() !== "false",
      trustServerCertificate: csMap["trustservercertificate"]?.toLowerCase() === "true",
    },
  });
  // try/finally (2026-08-04 audit) — see orgStructureSync.ts for why a bare
  // pool.close() after the query leaks the pool on query failure.
  let recordset: { KodePI: string; ItemKode: string; TotalSales: number }[];
  try {
    ({ recordset } = await pool.request().query<{
      KodePI: string;
      ItemKode: string;
      TotalSales: number;
    }>(`
      SELECT
        KodePI,
        [Item Kode] AS ItemKode,
        SUM([Value Sales]) AS TotalSales
      FROM mkt_insight.dbo.DIR10001B
      WHERE Periode >= '${periodeFrom}'
        AND Periode <= '${periodeTo}'
        AND KodePI IS NOT NULL
        AND [Item Kode] IS NOT NULL
        AND DIVISI = 'KAM1'
      GROUP BY KodePI, [Item Kode]
    `));
  } finally {
    await pool.close();
  }

  const syncedAt = new Date();
  let upserted = 0;

  // Batch upsert in chunks of 500
  const CHUNK = 500;
  for (let i = 0; i < recordset.length; i += CHUNK) {
    const chunk = recordset.slice(i, i + CHUNK);
    try {
      await prisma.$transaction(
        chunk.map((row) =>
          prisma.outletSalesHistory.upsert({
            where: { kodePI_itemKode: { kodePI: row.KodePI, itemKode: row.ItemKode } },
            create: {
              kodePI: row.KodePI,
              itemKode: row.ItemKode,
              totalSales12Bln: new Prisma.Decimal(row.TotalSales ?? 0),
              periodeFrom,
              periodeTo,
              syncedAt,
            },
            update: {
              totalSales12Bln: new Prisma.Decimal(row.TotalSales ?? 0),
              periodeFrom,
              periodeTo,
              syncedAt,
            },
          })
        )
      );
      upserted += chunk.length;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { upserted, periodeFrom, periodeTo, errors };
}
