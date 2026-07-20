/**
 * MSSQL → PostgreSQL org-structure sync.
 *
 * Source: Struktur_Marketing_PI (one row per outlet assignment, latest Periode, Divisi KAM1 + HPH*).
 * Maps MSSQL roles to app roles:
 *   NSM → NSM,  SM → SM,  ASM → ASM,  SPV → MR,  FF → MR
 *
 * Both SPV and FF are MR in this system. Their atasan is set to their ASM
 * (skipping the SPV level for FF, so the approval chain MR→ASM→SM→NSM is correct).
 *
 * VACANT entries (NIP starting with "V") are skipped.
 * When a user appears under multiple superiors (6 SPVs span 2 ASMs), the most
 * frequent superior is used.
 */

import sql from "mssql";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";

// ─── Source Schema Interface ──────────────────────────────────────────────────

export interface OrgRecord {
  nip: string;
  name: string;
  email: string | null;
  role: Role;
  reportsToNip: string | null;
  isActive: boolean;
}

// ─── MSSQL Query Layer ────────────────────────────────────────────────────────

function isVacant(nip: string | null | undefined): boolean {
  return !nip || nip.startsWith("V");
}

/**
 * Pick the most-frequent value from an array of strings.
 * Ties broken by natural sort of the value.
 */
function dominant(values: string[]): string {
  const freq = new Map<string, number>();
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

interface RawRow {
  NSM_NIP: string; NSM_Nama: string;
  SM_NIP:  string; SM_Nama:  string;
  ASM_NIP: string; ASM_Nama: string;
  SPV_NIP: string; SPV_Nama: string;
  FF_NIP:  string; FF_Nama:  string;
}

async function fetchOrgFromMssql(connectionString: string): Promise<OrgRecord[]> {
  const pool = await sql.connect(connectionString);

  const now = new Date();
  const periode = now.getFullYear() * 100 + (now.getMonth() + 1); // e.g. 202607

  const { recordset } = await pool.request().query<RawRow>(`
    SELECT DISTINCT
      NSM_NIP, NSM_Nama,
      SM_NIP,  SM_Nama,
      ASM_NIP, ASM_Nama,
      SPV_NIP, SPV_Nama,
      FF_NIP,  FF_Nama
    FROM Struktur_Marketing_PI
    WHERE Periode = ${periode}
      AND (Divisi = 'KAM1' OR Divisi LIKE 'HPH%')
  `);

  await pool.close();

  // ── Collect per-user: role + all observed manager NIPs ──────────────────────
  const userMap = new Map<string, { name: string; role: Role; managerNips: string[] }>();

  function collect(
    nip: string | null,
    name: string | null,
    role: Role,
    managerNip: string | null
  ) {
    if (isVacant(nip)) return;
    const key = nip!;
    const existing = userMap.get(key);
    if (existing) {
      if (!isVacant(managerNip)) existing.managerNips.push(managerNip!);
    } else {
      userMap.set(key, {
        name: (name ?? key).trim(),
        role,
        managerNips: isVacant(managerNip) ? [] : [managerNip!],
      });
    }
  }

  for (const row of recordset) {
    collect(row.NSM_NIP, row.NSM_Nama, "NSM", null);
    collect(row.SM_NIP,  row.SM_Nama,  "SM",  row.NSM_NIP);
    collect(row.ASM_NIP, row.ASM_Nama, "ASM", row.SM_NIP);
    // SPV → MR, reports to ASM
    collect(row.SPV_NIP, row.SPV_Nama, "MR",  row.ASM_NIP);
    // FF  → MR, also reports directly to ASM (skip SPV level for approval chain)
    collect(row.FF_NIP,  row.FF_Nama,  "MR",  row.ASM_NIP);
  }

  return [...userMap.entries()].map(([nip, { name, role, managerNips }]) => ({
    nip,
    name,
    email: null,
    role,
    reportsToNip: managerNips.length > 0 ? dominant(managerNips) : null,
    isActive: true,
  }));
}

// ─── Sync Logic ───────────────────────────────────────────────────────────────

export interface SyncResult {
  upserted: number;
  deactivated: number;
  errors: string[];
}

/**
 * Run the full org sync. Safe to run repeatedly (idempotent upserts).
 * Deactivates users not present in the source by setting isActive = false.
 */
export async function runOrgSync(connectionString: string): Promise<SyncResult> {
  const now = new Date();
  const records = await fetchOrgFromMssql(connectionString);
  const errors: string[] = [];
  let upserted = 0;

  // Pass 1: upsert all users without atasan (IDs not yet known)
  for (const rec of records) {
    try {
      await prisma.user.upsert({
        where: { nip: rec.nip },
        create: {
          nip: rec.nip,
          name: rec.name,
          email: rec.email,
          role: rec.role,
          isActive: rec.isActive,
          syncedAt: now,
        },
        update: {
          name: rec.name,
          email: rec.email,
          role: rec.role,
          isActive: rec.isActive,
          syncedAt: now,
        },
      });
      upserted++;
    } catch (err) {
      errors.push(`NIP ${rec.nip}: ${String(err)}`);
    }
  }

  // Pass 2: wire up atasan (stores manager NIP directly, since nip is the PK)
  for (const rec of records) {
    if (!rec.reportsToNip) continue;
    try {
      const manager = await prisma.user.findUnique({
        where: { nip: rec.reportsToNip },
        select: { nip: true, name: true },
      });
      if (!manager) {
        errors.push(`NIP ${rec.nip}: manager NIP ${rec.reportsToNip} not found`);
        continue;
      }
      await prisma.user.update({
        where: { nip: rec.nip },
        data: { nipAtasan: manager.nip, namaAtasan: manager.name },
      });
    } catch (err) {
      errors.push(`NIP ${rec.nip} (hierarchy): ${String(err)}`);
    }
  }

  // Pass 3: deactivate users no longer in the source
  const activeNips = records.map((r) => r.nip);
  const deactivated = await prisma.user.updateMany({
    where: { nip: { notIn: activeNips }, isActive: true },
    data: { isActive: false },
  });

  return { upserted, deactivated: deactivated.count, errors };
}
