/**
 * Syncs OUTLET-LEVEL monthly Rupiah sales of the Non-Hospital (OMEGA) team
 * from mkt_insight.dbo.DIR10001B, DIVISI = 'OMG1', into
 * OutletSalesValueMonthlyOmega. Twin of outletSalesValueMonthlySync.ts
 * (which only carries DIVISI 'KAM1' = Hospital). Feeds Evaluasi Kontrak
 * Non-Hospital's Sales Achievement (docs/evaluasi-kontrak-non-hospital/).
 * Querying DIR10001B live per page load took ~36s, hence this table.
 *
 * Window: the last NH_SYNC_MONTHS completed months (enough for a 6-month
 * evaluation window plus slack). Upserts via one INSERT ... ON CONFLICT per
 * chunk — ~13k outlets × 13 months is too many rows for per-row upserts.
 */

import sql from "mssql";
import { prisma } from "@/lib/prisma";

const NH_SYNC_MONTHS = 13;

export interface OmegaSalesSyncResult {
  upserted: number;
  periodeFrom: string;
  periodeTo: string;
}

function yyyymmAgo(now: Date, monthsAgo: number): string {
  const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function runOmegaSalesValueMonthlySync(connectionString: string): Promise<OmegaSalesSyncResult> {
  const now = new Date();
  const periodeTo = yyyymmAgo(now, 1); // last completed month
  const periodeFrom = yyyymmAgo(now, NH_SYNC_MONTHS);

  const csMap: Record<string, string> = {};
  for (const part of connectionString.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) csMap[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
  }
  const pool = new sql.ConnectionPool({
    server: csMap["server"] ?? "",
    database: csMap["database"] ?? "mkt_insight",
    user: csMap["user id"] ?? csMap["user"] ?? "",
    password: csMap["password"] ?? "",
    requestTimeout: 300_000,
    options: {
      encrypt: csMap["encrypt"]?.toLowerCase() !== "false",
      trustServerCertificate: csMap["trustservercertificate"]?.toLowerCase() === "true",
    },
  });
  await pool.connect();
  let rows: { KodePI: string; Periode: string | number; Total: number }[];
  try {
    ({ recordset: rows } = await pool
      .request()
      .input("from", sql.VarChar, periodeFrom)
      .input("to", sql.VarChar, periodeTo)
      .query<{ KodePI: string; Periode: string | number; Total: number }>(`
        SELECT KodePI, Periode, SUM([Value Sales]) AS Total
        FROM mkt_insight.dbo.DIR10001B
        WHERE DIVISI LIKE 'OMG1%' AND Periode >= @from AND Periode <= @to AND KodePI IS NOT NULL
        GROUP BY KodePI, Periode`));
  } finally {
    await pool.close();
  }

  const syncedAt = new Date();
  const CHUNK = 5000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const kodePIs = chunk.map((r) => r.KodePI);
    const periodes = chunk.map((r) => String(r.Periode));
    const values = chunk.map((r) => String(r.Total ?? 0));
    await prisma.$executeRaw`
      INSERT INTO "OutletSalesValueMonthlyOmega" ("id", "kodePI", "periode", "valueSales", "syncedAt")
      SELECT gen_random_uuid()::text, t.k, t.p, t.v, ${syncedAt}
      FROM unnest(${kodePIs}::text[], ${periodes}::text[], ${values}::numeric[]) AS t(k, p, v)
      ON CONFLICT ("kodePI", "periode") DO UPDATE SET "valueSales" = EXCLUDED."valueSales", "syncedAt" = EXCLUDED."syncedAt"`;
  }
  return { upserted: rows.length, periodeFrom, periodeTo };
}
