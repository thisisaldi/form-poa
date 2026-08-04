/**
 * MSSQL → PostgreSQL outlet + MR-outlet assignment sync.
 *
 * Source: Struktur_Marketing_PI (Divisi KAM1 + HPH*, current Periode YYYYMM).
 * - Upserts distinct active outlets into the Outlet table.
 * - Rebuilds MrOutletAssignment rows for current periode:
 *   - If FF_NIP is not vacant → assign FF only (skip SPV)
 *   - If FF_NIP is vacant but SPV_NIP is not → assign SPV
 *   Deletes old assignments for this periode before recreating.
 */

import sql from "mssql";
import { prisma } from "@/lib/prisma";

interface OutletRow {
  KodePI: string;
  NamaOutlet: string;
  Out_Code: string | null;
  StatusOutlet: string | null;
  Nama_Channel: string | null;
  Sector: string | null;
  Sub_Sektor: string | null;
  Kota: string | null;
  Propinsi: string | null;
  SPV_NIP: string;
  FF_NIP: string;
}

function isVacant(nip: string | null | undefined): boolean {
  return !nip || nip.startsWith("V");
}

export interface OutletSyncResult {
  outletsUpserted: number;
  assignmentsReplaced: number;
  errors: string[];
}

export async function runOutletSync(connectionString: string): Promise<OutletSyncResult> {
  const now = new Date();
  const errors: string[] = [];

  const periode = now.getFullYear() * 100 + (now.getMonth() + 1);

  const pool = await sql.connect(connectionString);
  // try/finally (2026-08-04 audit) — see orgStructureSync.ts for why a bare
  // pool.close() after the query leaks the pool on query failure.
  let recordset: OutletRow[];
  try {
    ({ recordset } = await pool.request().query<OutletRow>(`
      SELECT DISTINCT
        KodePI, NamaOutlet, Out_Code, StatusOutlet,
        Nama_Channel, Sector, Sub_Sektor, Kota, Propinsi,
        SPV_NIP, FF_NIP
      FROM Struktur_Marketing_PI
      WHERE Periode = ${periode}
        AND (Divisi = 'KAM1' OR Divisi LIKE 'HPH%')
        AND KodePI IS NOT NULL
    `));
  } finally {
    await pool.close();
  }

  // ── Distinct outlets ─────────────────────────────────────────────────────────
  const outletMap = new Map<string, Omit<OutletRow, "SPV_NIP" | "FF_NIP">>();
  for (const row of recordset) {
    if (!row.KodePI) continue;
    if (!outletMap.has(row.KodePI)) {
      outletMap.set(row.KodePI, {
        KodePI: row.KodePI,
        NamaOutlet: row.NamaOutlet?.trim() ?? row.KodePI,
        Out_Code: row.Out_Code?.trim() || null,
        StatusOutlet: row.StatusOutlet?.trim() || null,
        Nama_Channel: row.Nama_Channel?.trim() || null,
        Sector: row.Sector?.trim() || null,
        Sub_Sektor: row.Sub_Sektor?.trim() || null,
        Kota: row.Kota?.trim() || null,
        Propinsi: row.Propinsi?.trim() || null,
      });
    }
  }

  // Pass 1: upsert outlets
  let outletsUpserted = 0;
  for (const outlet of outletMap.values()) {
    try {
      await prisma.outlet.upsert({
        where: { kodePI: outlet.KodePI },
        create: {
          kodePI: outlet.KodePI,
          namaOutlet: outlet.NamaOutlet,
          outCode: outlet.Out_Code,
          statusOutlet: outlet.StatusOutlet,
          namaChannel: outlet.Nama_Channel,
          sector: outlet.Sector,
          subSektor: outlet.Sub_Sektor,
          kota: outlet.Kota,
          propinsi: outlet.Propinsi,
          syncedAt: now,
        },
        update: {
          namaOutlet: outlet.NamaOutlet,
          outCode: outlet.Out_Code,
          statusOutlet: outlet.StatusOutlet,
          namaChannel: outlet.Nama_Channel,
          sector: outlet.Sector,
          subSektor: outlet.Sub_Sektor,
          kota: outlet.Kota,
          propinsi: outlet.Propinsi,
          syncedAt: now,
        },
      });
      outletsUpserted++;
    } catch (err) {
      errors.push(`Outlet ${outlet.KodePI}: ${String(err)}`);
    }
  }

  // Pass 2: rebuild MR-outlet assignments for this periode
  // Rule: if FF_NIP is not vacant → use FF only; else use SPV if not vacant
  const assignments = new Map<string, Set<string>>();
  for (const row of recordset) {
    if (!row.KodePI) continue;
    const nipMR = !isVacant(row.FF_NIP) ? row.FF_NIP : !isVacant(row.SPV_NIP) ? row.SPV_NIP : null;
    if (!nipMR) continue;
    const set = assignments.get(nipMR) ?? new Set();
    set.add(row.KodePI);
    assignments.set(nipMR, set);
  }

  // Verify which NIPs exist in the users table
  const allNips = [...assignments.keys()];
  const existingUsers = await prisma.user.findMany({
    where: { nip: { in: allNips } },
    select: { nip: true },
  });
  const knownNips = new Set(existingUsers.map((u: { nip: string }) => u.nip));

  // Delete assignments for this periode only (keeps history of past periodes)
  await prisma.mrOutletAssignment.deleteMany({
    where: { periode },
  });

  let assignmentsReplaced = 0;
  for (const [nip, kodePIs] of assignments.entries()) {
    if (!knownNips.has(nip)) {
      errors.push(`Assignment: NIP ${nip} not found in users table — run org sync first`);
      continue;
    }
    for (const kodePI of kodePIs) {
      if (!outletMap.has(kodePI)) continue;
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

  return { outletsUpserted, assignmentsReplaced, errors };
}
