/**
 * Syncs OUTLET-LEVEL (not per-product) monthly Rupiah sales value from
 * mkt_insight.dbo.DIR10001B into OutletSalesValueMonthly. Covers a much
 * wider window than the per-product syncs in this same directory (full
 * previous year through the current year's last completed month, not a
 * rolling 12 months) — feeds the Detail POA page's "Data Sales" card
 * (Historis [tahun lalu] / Sales YTD / Growth YTD).
 */

import sql from "mssql";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export interface OutletSalesValueMonthlySyncResult {
  upserted: number;
  periodeFrom: string;
  periodeTo: string;
  errors: string[];
}

function toYYYYMM(year: number, month: number): string {
  return `${year}${String(month).padStart(2, "0")}`;
}

function subtractMonths(yyyymm: string, n: number): string {
  const year = parseInt(yyyymm.slice(0, 4));
  const month = parseInt(yyyymm.slice(4, 6));
  const date = new Date(year, month - 1 - n, 1);
  return toYYYYMM(date.getFullYear(), date.getMonth() + 1);
}

export async function runOutletSalesValueMonthlySync(
  connectionString: string
): Promise<OutletSalesValueMonthlySyncResult> {
  const now = new Date();
  const currentPeriode = toYYYYMM(now.getFullYear(), now.getMonth() + 1);
  const periodeTo   = subtractMonths(currentPeriode, 1); // last completed month
  const periodeFrom = `${now.getFullYear() - 1}01`;      // Jan of the previous year

  const errors: string[] = [];

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
  const { recordset } = await pool.request().query<{
    KodePI: string;
    Periode: string | number;
    TotalValue: number;
  }>(`
    SELECT
      KodePI,
      Periode,
      SUM([Value Sales]) AS TotalValue
    FROM mkt_insight.dbo.DIR10001B
    WHERE Periode >= '${periodeFrom}'
      AND Periode <= '${periodeTo}'
      AND KodePI IS NOT NULL
      AND DIVISI = 'KAM1'
    GROUP BY KodePI, Periode
  `);
  await pool.close();

  const syncedAt = new Date();
  let upserted = 0;

  const CHUNK = 500;
  for (let i = 0; i < recordset.length; i += CHUNK) {
    const chunk = recordset.slice(i, i + CHUNK);
    try {
      await prisma.$transaction(
        chunk.map((row) => {
          const periode = String(row.Periode);
          return prisma.outletSalesValueMonthly.upsert({
            where: { kodePI_periode: { kodePI: row.KodePI, periode } },
            create: {
              kodePI: row.KodePI,
              periode,
              valueSales: new Prisma.Decimal(row.TotalValue ?? 0),
              syncedAt,
            },
            update: {
              valueSales: new Prisma.Decimal(row.TotalValue ?? 0),
              syncedAt,
            },
          });
        })
      );
      upserted += chunk.length;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { upserted, periodeFrom, periodeTo, errors };
}
