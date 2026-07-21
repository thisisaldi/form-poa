/**
 * Syncs customer (doctor) data from two Excel files:
 *
 * Pass 1 — Customer_Database (CDB):
 *   Imports all doctor × outlet rows. Creates Customer records (with kodeCustomer)
 *   and CustomerOutlet junction records (isFokus = false by default).
 *
 * Pass 2 — RS GROUP "Dokter RS NON CHAIN" sheet:
 *   This sheet is the ONLY source of truth for "Rekomendasi PM" (isFokus) —
 *   it's never settable by hand anywhere in the app (see createCustomerAction /
 *   updateCustomerAction). So every run starts by resetting isFokus = false on
 *   every CustomerOutlet row, THEN re-marks true from the current sheet — a
 *   doctor removed from the sheet since the last sync correctly loses the flag
 *   instead of it lingering (2026-07-21 fix, found stale + manually-set rows
 *   still flagged after their entry had disappeared/never existed in the file).
 *   For each focused doctor listed per outlet+specialty:
 *   - Try to find existing Customer at that outlet by normalized name match.
 *   - If found → set isFokus = true.
 *   - If not found → create Customer (no kodeCustomer) + CustomerOutlet (isFokus = true).
 *
 * Usage:
 *   npx tsx scripts/syncCustomers.ts \
 *     "Customer_Database_20260710.xlsx" \
 *     "RS GROUP - PHAROS INDONESIA.xlsx"
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";

// Use a higher connection limit for this long-running script
const url = new URL(process.env.DATABASE_URL!);
url.searchParams.set("connection_limit", "5");
url.searchParams.set("pool_timeout", "60");
const prisma = new PrismaClient({ datasourceUrl: url.toString() });

const BATCH = 500;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseTemplate(raw: string): string | null {
  const m = raw.match(/\{\{(.+?)\s+true\}\}/);
  return m ? m[1].trim() : null;
}

function isEmptyCell(val: string): boolean {
  return !val || val === "-" || val.trim() === "";
}

// ─── Pass 1: Customer Database ────────────────────────────────────────────────

async function syncCDB(filePath: string, now: Date) {
  console.log(`\n[Pass 1] Reading CDB: ${filePath}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheet = wb.getWorksheet("Sheet1");
  if (!sheet) throw new Error('Sheet "Sheet1" not found in CDB file');

  const DATA_START_ROW = 9;

  // Load all valid outlet kodePI into a Set to avoid repeated DB lookups
  console.log("  Loading outlet list...");
  const outletRows = await prisma.outlet.findMany({ select: { kodePI: true } });
  const validOutlets = new Set(outletRows.map((o: { kodePI: string }) => o.kodePI));
  console.log(`  ${validOutlets.size} outlets loaded.`);

  // Collect rows from Excel
  type CDBRow = {
    kodeCustomer: string | null;
    namaCustomer: string;
    spesialisasi: string;
    kodeOutlet: string;
  };
  const rows: CDBRow[] = [];
  for (let r = DATA_START_ROW; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const kodeRaw = String(row.getCell(2).value ?? "");
    const namaRaw = String(row.getCell(3).value ?? "").trim();
    const specRaw = String(row.getCell(4).value ?? "");
    const kodeOutlet = String(row.getCell(7).value ?? "").trim();
    const kodeCustomer = parseTemplate(kodeRaw);
    const spesialisasi = parseTemplate(specRaw);
    if (!namaRaw || !spesialisasi || !kodeOutlet) continue;
    if (!validOutlets.has(kodeOutlet)) continue;
    rows.push({ kodeCustomer, namaCustomer: namaRaw, spesialisasi, kodeOutlet });
  }
  console.log(`  ${rows.length} valid rows parsed from Excel.`);

  // Deduplicate by kodeCustomer (keep last occurrence) before batching
  const uniqueByKode = new Map<string, CDBRow>();
  const withoutCode: CDBRow[] = [];
  for (const r of rows) {
    if (r.kodeCustomer) {
      uniqueByKode.set(r.kodeCustomer, r);
    } else {
      withoutCode.push(r);
    }
  }
  const withCode = [...uniqueByKode.values()];

  console.log(`  Upserting ${withCode.length} unique customers with code...`);
  for (let i = 0; i < withCode.length; i += BATCH) {
    const chunk = withCode.slice(i, i + BATCH);
    const values = chunk.map((r) =>
      `('${randomUUID()}', '${esc(r.kodeCustomer!)}', '${esc(r.namaCustomer)}', '${esc(r.spesialisasi)}', '${now.toISOString()}', '${now.toISOString()}', '${now.toISOString()}')`
    ).join(",\n");
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Customer" ("id","kodeCustomer","namaCustomer","spesialisasi","syncedAt","createdAt","updatedAt")
      VALUES ${values}
      ON CONFLICT ("kodeCustomer") DO UPDATE SET
        "namaCustomer" = EXCLUDED."namaCustomer",
        "spesialisasi" = EXCLUDED."spesialisasi",
        "syncedAt" = EXCLUDED."syncedAt",
        "updatedAt" = EXCLUDED."updatedAt"
    `);
    process.stdout.write(`  ${Math.min(i + BATCH, withCode.length)}/${withCode.length}\r`);
  }

  // Customers without code: insert only, skip if name+spesialisasi already exists
  // Deduplicate within batch too
  const uniqueNoCode = new Map<string, CDBRow>();
  for (const r of withoutCode) uniqueNoCode.set(`${r.namaCustomer}|${r.spesialisasi}`, r);
  const noCodeList = [...uniqueNoCode.values()];

  console.log(`\n  Inserting ${noCodeList.length} customers without code...`);
  for (let i = 0; i < noCodeList.length; i += BATCH) {
    const chunk = noCodeList.slice(i, i + BATCH);
    const values = chunk.map((r) =>
      `('${randomUUID()}', '${esc(r.namaCustomer)}', '${esc(r.spesialisasi)}', '${now.toISOString()}', '${now.toISOString()}', '${now.toISOString()}')`
    ).join(",\n");
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Customer" ("id","namaCustomer","spesialisasi","syncedAt","createdAt","updatedAt")
      VALUES ${values}
      ON CONFLICT DO NOTHING
    `);
    process.stdout.write(`  ${Math.min(i + BATCH, noCodeList.length)}/${noCodeList.length}\r`);
  }

  // Now build CustomerOutlet — need customer IDs
  // Load all customers keyed by kodeCustomer or namaCustomer
  console.log("\n  Loading customer IDs for junction table...");
  const allCustomers = await prisma.customer.findMany({
    select: { id: true, kodeCustomer: true, namaCustomer: true, spesialisasi: true },
  });
  const byKode = new Map(
    (allCustomers as { id: string; kodeCustomer: string | null; namaCustomer: string; spesialisasi: string }[])
      .filter((c) => c.kodeCustomer)
      .map((c) => [c.kodeCustomer!, c.id])
  );
  const byName = new Map(
    (allCustomers as { id: string; kodeCustomer: string | null; namaCustomer: string; spesialisasi: string }[])
      .map((c) => [`${c.namaCustomer}|${c.spesialisasi}`, c.id])
  );

  // Resolve customerId for each row
  type JunctionRow = { customerId: string; kodePI: string };
  const junctions: JunctionRow[] = [];
  for (const r of rows) {
    const customerId = r.kodeCustomer
      ? byKode.get(r.kodeCustomer)
      : byName.get(`${r.namaCustomer}|${r.spesialisasi}`);
    if (!customerId) continue;
    junctions.push({ customerId, kodePI: r.kodeOutlet });
  }

  // Deduplicate
  const seen = new Set<string>();
  const uniqueJunctions = junctions.filter(({ customerId, kodePI }) => {
    const key = `${customerId}|${kodePI}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`  Upserting ${uniqueJunctions.length} CustomerOutlet rows...`);
  for (let i = 0; i < uniqueJunctions.length; i += BATCH) {
    const chunk = uniqueJunctions.slice(i, i + BATCH);
    const values = chunk.map((r) =>
      `('${randomUUID()}', '${r.customerId}', '${r.kodePI}', false, '${now.toISOString()}')`
    ).join(",\n");
    await prisma.$executeRawUnsafe(`
      INSERT INTO "CustomerOutlet" ("id","customerId","kodePI","isFokus","syncedAt")
      VALUES ${values}
      ON CONFLICT ("customerId","kodePI") DO UPDATE SET "syncedAt" = EXCLUDED."syncedAt"
    `);
    process.stdout.write(`  ${Math.min(i + BATCH, uniqueJunctions.length)}/${uniqueJunctions.length}\r`);
  }

  console.log(`\n  ✓ Pass 1 done. ${uniqueJunctions.length} CustomerOutlet rows processed.`);
}

// ─── Pass 2: RS GROUP Focus Labels ───────────────────────────────────────────

async function syncRSGroup(filePath: string, now: Date) {
  console.log(`\n[Pass 2] Reading RS GROUP: ${filePath}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheet = wb.getWorksheet("Dokter RS NON CHAIN");
  if (!sheet) throw new Error('"Dokter RS NON CHAIN" sheet not found');

  // Build column → spesialisasi map from row 2
  const colToSpec = new Map<number, string>();
  const headerRow = sheet.getRow(2);
  headerRow.eachCell((cell, col) => {
    if (col < 7) return;
    const raw = String(cell.value ?? "").trim();
    if (!raw || raw === " " || raw.startsWith("Total")) return;
    const m = raw.match(/^(.+?)\s+\d+$/);
    colToSpec.set(col, m ? m[1].trim() : raw);
  });

  // Load valid outlets
  const outletRows = await prisma.outlet.findMany({ select: { kodePI: true } });
  const validOutlets = new Set(outletRows.map((o: { kodePI: string }) => o.kodePI));

  // Collect all doctor entries from Excel
  type FocusEntry = { kodePI: string; doctorName: string; spesialisasi: string };
  const entries: FocusEntry[] = [];
  for (let r = 3; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const kodePI = String(row.getCell(5).value ?? "").trim();
    if (!kodePI || !validOutlets.has(kodePI)) continue;
    for (const [col, spesialisasi] of colToSpec) {
      const doctorName = String(row.getCell(col).value ?? "").trim();
      if (isEmptyCell(doctorName)) continue;
      entries.push({ kodePI, doctorName, spesialisasi });
    }
  }
  console.log(`  ${entries.length} focus doctor entries parsed.`);

  // Load all existing CustomerOutlet rows with doctor names for matching
  console.log("  Loading existing CustomerOutlet records...");
  const existingJunctions = await prisma.customerOutlet.findMany({
    select: { id: true, kodePI: true, customer: { select: { namaCustomer: true } } },
  }) as { id: string; kodePI: string; customer: { namaCustomer: string } }[];

  // Build lookup: "kodePI|NAMANORMALIZED" → junction id
  const junctionByNameOutlet = new Map<string, string>();
  for (const j of existingJunctions) {
    const key = `${j.kodePI}|${j.customer.namaCustomer.toUpperCase().trim()}`;
    junctionByNameOutlet.set(key, j.id);
  }

  // Separate: entries that match existing vs need new Customer
  const idsToMarkFokus: string[] = [];
  type NewEntry = { kodePI: string; doctorName: string; spesialisasi: string };
  const toCreateRaw: NewEntry[] = [];

  for (const e of entries) {
    const key = `${e.kodePI}|${e.doctorName.toUpperCase().trim()}`;
    const existingId = junctionByNameOutlet.get(key);
    if (existingId) {
      idsToMarkFokus.push(existingId);
    } else {
      toCreateRaw.push(e);
    }
  }

  // Reset first — this sheet is the sole source of truth for isFokus, so a
  // doctor no longer in it (or one some manual flow flagged true directly in
  // the DB, which the app itself never allows) must lose the flag here.
  const resetResult = await prisma.customerOutlet.updateMany({
    where: { isFokus: true },
    data: { isFokus: false },
  });
  console.log(`  Reset ${resetResult.count} CustomerOutlet rows to isFokus=false before re-marking.`);

  // Bulk mark isFokus = true for matched junctions
  console.log(`  Marking ${idsToMarkFokus.length} existing CustomerOutlet rows as fokus...`);
  for (let i = 0; i < idsToMarkFokus.length; i += BATCH) {
    const chunk = idsToMarkFokus.slice(i, i + BATCH);
    const ids = chunk.map((id) => `'${id}'`).join(",");
    await prisma.$executeRawUnsafe(`
      UPDATE "CustomerOutlet" SET "isFokus" = true, "syncedAt" = '${now.toISOString()}'
      WHERE "id" IN (${ids})
    `);
    process.stdout.write(`  ${Math.min(i + BATCH, idsToMarkFokus.length)}/${idsToMarkFokus.length}\r`);
  }

  // Deduplicate toCreate by doctorName+kodePI
  const toCreateSeen = new Set<string>();
  const toCreate = toCreateRaw.filter((e) => {
    const k = `${e.doctorName.toUpperCase().trim()}|${e.kodePI}`;
    if (toCreateSeen.has(k)) return false;
    toCreateSeen.add(k);
    return true;
  });

  // Create new Customers + CustomerOutlet for unmatched entries
  console.log(`\n  Creating ${toCreate.length} new focus doctors...`);
  for (let i = 0; i < toCreate.length; i += BATCH) {
    const chunk = toCreate.slice(i, i + BATCH);
    // Insert customers
    const custValues = chunk.map((e) =>
      `('${randomUUID()}', '${esc(e.doctorName)}', '${esc(e.spesialisasi)}', '${now.toISOString()}', '${now.toISOString()}', '${now.toISOString()}')`
    ).join(",\n");
    const newCustomers = await prisma.$queryRawUnsafe<{ id: string; namaCustomer: string }[]>(`
      INSERT INTO "Customer" ("id","namaCustomer","spesialisasi","syncedAt","createdAt","updatedAt")
      VALUES ${custValues}
      ON CONFLICT DO NOTHING
      RETURNING "id", "namaCustomer"
    `);

    // Map new customer IDs back to entries
    const nameToId = new Map(newCustomers.map((c) => [c.namaCustomer.toUpperCase().trim(), c.id]));

    const coEntriesRaw = chunk
      .map((e) => ({ id: nameToId.get(e.doctorName.toUpperCase().trim()), kodePI: e.kodePI }))
      .filter((x): x is { id: string; kodePI: string } => !!x.id);
    // Deduplicate by customerId+kodePI within batch
    const coSeen = new Set<string>();
    const coEntries = coEntriesRaw.filter(({ id, kodePI }) => {
      const k = `${id}|${kodePI}`;
      if (coSeen.has(k)) return false;
      coSeen.add(k);
      return true;
    });

    if (coEntries.length > 0) {
      const coValues = coEntries.map((x) =>
        `('${randomUUID()}', '${x.id}', '${x.kodePI}', true, '${now.toISOString()}')`
      ).join(",\n");
      await prisma.$executeRawUnsafe(`
        INSERT INTO "CustomerOutlet" ("id","customerId","kodePI","isFokus","syncedAt")
        VALUES ${coValues}
        ON CONFLICT ("customerId","kodePI") DO UPDATE SET "isFokus" = true, "syncedAt" = EXCLUDED."syncedAt"
      `);
    }
    process.stdout.write(`  ${Math.min(i + BATCH, toCreate.length)}/${toCreate.length}\r`);
  }

  console.log(`\n  ✓ Pass 2 done.`);
}

// SQL escape helper (single-quote escape only — inputs are from trusted Excel files)
function esc(s: string): string {
  return s.replace(/'/g, "''");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const cdbPath = process.argv[2];
  const rsGroupPath = process.argv[3];

  if (!cdbPath || !rsGroupPath) {
    console.error(
      'Usage: npx tsx scripts/syncCustomers.ts "Customer_Database.xlsx" "RS GROUP.xlsx"'
    );
    process.exit(1);
  }

  const now = new Date();
  await syncCDB(path.resolve(cdbPath), now);
  await syncRSGroup(path.resolve(rsGroupPath), now);

  console.log("\n✅ Customer sync complete.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
