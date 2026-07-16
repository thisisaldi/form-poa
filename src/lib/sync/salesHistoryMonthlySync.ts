/**
 * Syncs MONTHLY outlet-level sales QUANTITY from mkt_insight.dbo.DIR10001B into
 * OutletSalesMonthly (one row per outlet × product × month). This is the
 * granular counterpart to salesHistorySync.ts's rolling 12-month Rupiah total —
 * it feeds the quarterly target calculation engine (src/lib/targetCalculation.ts),
 * which needs month-by-month QUANTITY figures to compute Ratio and Productivity
 * (targets in this scheme are unit-quantity based, not Rupiah).
 */

import sql from "mssql";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export interface SalesHistoryMonthlySyncResult {
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

export async function runSalesHistoryMonthlySync(
  connectionString: string
): Promise<SalesHistoryMonthlySyncResult> {
  const now = new Date();
  const currentPeriode = toYYYYMM(now.getFullYear(), now.getMonth() + 1);
  const periodeTo   = subtractMonths(currentPeriode, 1);   // last completed month
  const periodeFrom = subtractMonths(currentPeriode, 12);  // 12 months back

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
    ItemKode: string;
    Periode: string | number;
    TotalQty: number;
  }>(`
    SELECT
      KodePI,
      [Item Kode] AS ItemKode,
      Periode,
      SUM([Qty Sales]) AS TotalQty
    FROM mkt_insight.dbo.DIR10001B
    WHERE Periode >= '${periodeFrom}'
      AND Periode <= '${periodeTo}'
      AND KodePI IS NOT NULL
      AND [Item Kode] IS NOT NULL
      AND DIVISI = 'KAM1'
    GROUP BY KodePI, [Item Kode], Periode
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
          return prisma.outletSalesMonthly.upsert({
            where: { kodePI_itemKode_periode: { kodePI: row.KodePI, itemKode: row.ItemKode, periode } },
            create: {
              kodePI: row.KodePI,
              itemKode: row.ItemKode,
              periode,
              qty: new Prisma.Decimal(row.TotalQty ?? 0),
              syncedAt,
            },
            update: {
              qty: new Prisma.Decimal(row.TotalQty ?? 0),
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
