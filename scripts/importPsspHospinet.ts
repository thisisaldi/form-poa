/**
 * Import "internal/customer_pssp_hospinet.xlsx" — customer roster + a
 * customer-level PSSP snapshot for the Hospinet division, which the KAM
 * struktur/PsspKontrak imports never covered (see docs/TODO.md #40/#42).
 *
 * Source shape is flat (one row per customer×outlet): Kode Customer, Nama
 * Customer, Spesialisasi, Status Customer (active-repeat/inactive-new),
 * Terakhir PSSP ("-"/"Berjalan"), Kode Outlet, Nama Outlet, City, Periode
 * Awal, Periode Akhir, Value PSSP, Pelunasan, RR. No contract number, no
 * product, no monthly breakdown — deliberately does NOT go into PsspKontrak
 * (see PsspHospinetSnapshot doc comment in schema).
 *
 * "Kode Customer" (2026-07-21 addition) is Hospinet's OWN internal numbering
 * (e.g. 168002) — "0" means the row genuinely has none, not a real code — and
 * it is a completely different namespace than Customer.kodeCustomer (the main
 * CDB code, alphanumeric like "F1045097"; confirmed zero overlap against the
 * DB). So it's stored only on PsspHospinetSnapshot for reference, and customer
 * identity here is still resolved by name, same as before this addition —
 * writing it into Customer.kodeCustomer would corrupt that field's meaning.
 *
 * "Periode Awal"/"Periode Akhir" (2026-07-21 addition): YYYYMM of the
 * customer's current/last PSSP period, "-" when not applicable → stored null.
 *
 * Effects:
 *   1. Customer: for each distinct (name, spesialisasi) not already matching
 *      an existing Customer by name (case-insensitive), create a new
 *      code-less Customer row — mirrors scripts/syncCustomers.ts Pass 1's
 *      "customers without code" path.
 *   2. CustomerOutlet: junction row per (customer, outlet) from the file.
 *   3. PsspHospinetSnapshot: one row per (customer, outlet) with the
 *      kodeCustomer/periode/status/value/pelunasan/rr figures.
 * Rows are skipped (and counted) when: name blank, spesialisasi blank/"NULL",
 * kodeOutlet blank/"NULL", or kodeOutlet doesn't resolve to an existing
 * Outlet (that outlet genuinely isn't in our data yet — logged, not guessed).
 *
 * Run: npx tsx scripts/importPsspHospinet.ts [path-to-excel]
 * Default: internal/customer_pssp_hospinet.xlsx
 */

import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { randomUUID } from "crypto";
import { prisma } from "../src/lib/prisma";

const BATCH = 500;

function norm(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, " ");
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function sqlNullableStr(s: string | null): string {
  return s == null ? "NULL" : `'${esc(s)}'`;
}

function isBlankOrNull(s: string): boolean {
  const t = s.trim();
  return t === "" || t.toUpperCase() === "NULL" || t === "-";
}

// "0" is this source's convention for "no Hospinet customer code" — not a real code.
function cleanKodeCustomer(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s === "" || s === "0" ? null : s;
}

// "-" is this source's convention for "no periode" (e.g. never had a PSSP contract).
function cleanPeriode(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s === "" || s === "-" ? null : s;
}

// Only spesialisasi values with an unambiguous 1:1 curated-category match are
// normalized — everything else (non-doctor stakeholder roles like "Perawat"/
// "Bagian Pembelian", or genuinely ambiguous catch-alls like "Lainnya") is
// left as its raw source value rather than force-mapped into an inaccurate
// category. "UMUM (GP)" now exists in the curated list (2026-07-22, see
// spesialisasi.ts) so "Dokter Umum" — 53% of this file — normalizes to it too.
const SPEC_NORMALIZE: Record<string, string> = {
  "SPESIALIS ANAK": "ANAK (PEDIATRIC)",
  "SPESIALIS OBSTETRI DAN GINEKOLOGI (KANDUNGAN)": "KANDUNGAN (OBSGYN)",
  "SPESIALIS PENYAKIT DALAM": "INTERNIST UMUM",
  "SPESIALIS SARAF": "SYARAF (NEUROLOGI)",
  "SPESIALIS PARU": "PARU (PULMONOLOGI)",
  "SPESIALIS PSIKIATRI (KESEHATAN JIWA)": "JIWA (PSIKIATER)",
  "SPESIALIS ORTOPEDI DAN TRAUMATOLOGI": "BEDAH TULANG (ORTHOPEDI)",
  "SPESIALIS BEDAH UMUM": "BEDAH",
  "SPESIALIS ANESTESIOLOGI DAN TERAPI INTENSIF": "ANESTESI",
  "DOKTER UMUM": "UMUM (GP)",
  "SPESIALIS KONSERVASI GIGI": "GIGI (DENTIST)",
  "SPESIALIS KULIT DAN KELAMIN": "KULIT KELAMIN (DV)",
  "SPESIALIS TELINGA HIDUNG TENGGOROK DAN BEDAH KEPALA LEHER": "THT & BEDAH KEPALA LEHER",
  "SPESIALIS GIZI KLINIK": "GIZI KLINIK",
  "SPESIALIS KARDIOLOGI DAN PEMBULUH DARAH": "JANTUNG (KARDIOLOGI)",
  "SPESIALIS RADIOLOGI KEDOKTERAN GIGI": "RADIOLOGI",
  "SPESIALIS BEDAH MULUT DAN MAKSILOFASIAL": "BEDAH MULUT",
  "SPESIALIS PERIODONSIA (GUSI DAN JARINGAN PENYANGGA GIGI)": "GIGI (DENTIST)",
  "SPESIALIS PATOLOGI KLINIK": "PATOLOGI KLINIK",
  "SPESIALIS MATA": "MATA (OPTAL)",
};

function normalizeSpesialisasi(raw: string): string {
  return SPEC_NORMALIZE[raw.toUpperCase()] ?? raw;
}

interface SourceRow {
  kodeCustomer: string | null;
  nama: string;
  spesialisasi: string;
  statusCustomer: string;
  psspBerjalan: boolean;
  kodeOutlet: string;
  periodeAwal: string | null;
  periodeAkhir: string | null;
  valuePssp: number;
  pelunasan: number;
  rr: number | null;
}

async function main() {
  const filePath = path.resolve(process.argv[2] ?? "internal/customer_pssp_hospinet.xlsx");
  console.log(`Reading: ${filePath}\n`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet("Sheet1");
  if (!ws) { console.error('Sheet "Sheet1" not found'); process.exit(1); }

  const now = new Date();

  // ── Self-heal previously-imported rows whose raw text is now normalizable ──
  // A prior run may have already created a Customer under the old raw spesialisasi
  // (e.g. "Dokter Umum") before it had a SPEC_NORMALIZE entry. New-vs-existing
  // customer resolution below only matches by name, so it never revisits their
  // spesialisasi — this pass corrects it in place, scoped to customers that
  // actually came from THIS file (have a PsspHospinetSnapshot) so it can never
  // touch an unrelated CDB category that happens to share raw text.
  console.log("Correcting previously-imported rows with outdated raw spesialisasi...");
  let correctedTotal = 0;
  for (const [rawUpper, canonical] of Object.entries(SPEC_NORMALIZE)) {
    const result = await prisma.customer.updateMany({
      where: {
        spesialisasi: { equals: rawUpper, mode: "insensitive" },
        psspHospinetSnapshots: { some: {} },
      },
      data: { spesialisasi: canonical },
    });
    if (result.count > 0) {
      console.log(`  ${result.count} customer(s): "${rawUpper}" → "${canonical}"`);
      correctedTotal += result.count;
    }
  }
  console.log(`✅ Corrected ${correctedTotal} existing Customer rows.\n`);

  const rows: SourceRow[] = [];
  let skippedBlankName = 0, skippedBlankSpec = 0, skippedBlankOutlet = 0;

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const kodeCustomer = cleanKodeCustomer(row.getCell(1).value);
    const nama = String(row.getCell(2).value ?? "").trim();
    const spesialisasi = String(row.getCell(3).value ?? "").trim();
    const statusCustomer = String(row.getCell(4).value ?? "").trim();
    const terakhirPssp = String(row.getCell(5).value ?? "").trim();
    const kodeOutlet = String(row.getCell(6).value ?? "").trim();
    const periodeAwal = cleanPeriode(row.getCell(9).value);
    const periodeAkhir = cleanPeriode(row.getCell(10).value);
    const valuePsspRaw = row.getCell(11).value;
    const pelunasanRaw = row.getCell(12).value;
    const rrCell = row.getCell(13).value;

    if (!nama) { skippedBlankName++; continue; }
    if (isBlankOrNull(spesialisasi)) { skippedBlankSpec++; continue; }
    if (isBlankOrNull(kodeOutlet)) { skippedBlankOutlet++; continue; }

    const valuePssp = typeof valuePsspRaw === "number" ? valuePsspRaw : parseFloat(String(valuePsspRaw ?? "0")) || 0;
    const pelunasan = typeof pelunasanRaw === "number" ? pelunasanRaw : parseFloat(String(pelunasanRaw ?? "0")) || 0;
    let rr: number | null = null;
    if (rrCell && typeof rrCell === "object" && "result" in rrCell && typeof rrCell.result === "number") {
      rr = rrCell.result;
    } else if (typeof rrCell === "number") {
      rr = rrCell;
    } else {
      rr = valuePssp === 0 ? 0 : pelunasan / valuePssp; // recompute — formula cell had no cached result
    }

    rows.push({
      kodeCustomer, nama, spesialisasi: normalizeSpesialisasi(spesialisasi), statusCustomer,
      psspBerjalan: terakhirPssp === "Berjalan",
      kodeOutlet, periodeAwal, periodeAkhir, valuePssp, pelunasan, rr,
    });
  }

  console.log(`Parsed ${rows.length} usable rows (skipped ${skippedBlankName} blank name, ${skippedBlankSpec} blank/NULL spesialisasi, ${skippedBlankOutlet} blank/NULL kodeOutlet).\n`);

  // ── Filter to outlets that actually exist ─────────────────────────────────
  const outletRows = await prisma.outlet.findMany({ select: { kodePI: true } });
  const validOutlets = new Set(outletRows.map((o: { kodePI: string }) => o.kodePI));
  const beforeOutletFilter = rows.length;
  const filteredRows = rows.filter((r) => validOutlets.has(r.kodeOutlet));
  console.log(`${filteredRows.length}/${beforeOutletFilter} rows have a kodeOutlet that exists in our Outlet table (rest skipped — outlet genuinely missing).\n`);

  // ── Dedupe exact (name, outlet) duplicate rows — keep last ────────────────
  const dedupedMap = new Map<string, SourceRow>();
  for (const r of filteredRows) dedupedMap.set(`${norm(r.nama)}|${r.kodeOutlet}`, r);
  const deduped = [...dedupedMap.values()];
  console.log(`${deduped.length} rows after deduping exact (name, outlet) duplicates.\n`);

  // ── Resolve customer identity: match existing Customer by name first ──────
  const existingCustomers = await prisma.customer.findMany({ select: { id: true, namaCustomer: true } });
  const existingByName = new Map(existingCustomers.map((c: { id: string; namaCustomer: string }) => [norm(c.namaCustomer), c.id]));

  const newCustomerKeys = new Map<string, { nama: string; spesialisasi: string }>(); // key: name|spec
  for (const r of deduped) {
    if (existingByName.has(norm(r.nama))) continue;
    newCustomerKeys.set(`${norm(r.nama)}|${r.spesialisasi}`, { nama: r.nama, spesialisasi: r.spesialisasi });
  }
  const newCustomerList = [...newCustomerKeys.values()];
  console.log(`${newCustomerList.length} new Customer rows to create (${deduped.length - newCustomerList.length /* approx, some rows share names */} rows matched an existing Customer by name).\n`);

  console.log("Creating new Customer rows...");
  for (let i = 0; i < newCustomerList.length; i += BATCH) {
    const chunk = newCustomerList.slice(i, i + BATCH);
    const values = chunk.map((c) =>
      `('${randomUUID()}', '${esc(c.nama)}', '${esc(c.spesialisasi)}', '${now.toISOString()}', '${now.toISOString()}', '${now.toISOString()}')`
    ).join(",\n");
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Customer" ("id","namaCustomer","spesialisasi","syncedAt","createdAt","updatedAt")
      VALUES ${values}
      ON CONFLICT DO NOTHING
    `);
    process.stdout.write(`  ${Math.min(i + BATCH, newCustomerList.length)}/${newCustomerList.length}\r`);
  }
  console.log(`\n✅ Customer rows created.\n`);

  // Reload full customer id map (existing + newly created), keyed by norm(name)
  const allCustomers = await prisma.customer.findMany({ select: { id: true, namaCustomer: true } });
  const customerIdByName = new Map<string, string>();
  for (const c of allCustomers as { id: string; namaCustomer: string }[]) {
    if (!customerIdByName.has(norm(c.namaCustomer))) customerIdByName.set(norm(c.namaCustomer), c.id);
  }

  // ── CustomerOutlet junction rows ───────────────────────────────────────────
  type Resolved = SourceRow & { customerId: string };
  const resolved: Resolved[] = [];
  let unresolvedCustomer = 0;
  for (const r of deduped) {
    const customerId = customerIdByName.get(norm(r.nama));
    if (!customerId) { unresolvedCustomer++; continue; }
    resolved.push({ ...r, customerId });
  }
  if (unresolvedCustomer > 0) console.log(`⚠️  ${unresolvedCustomer} rows had no resolvable customerId (unexpected) — skipped.\n`);

  console.log(`Upserting ${resolved.length} CustomerOutlet rows...`);
  for (let i = 0; i < resolved.length; i += BATCH) {
    const chunk = resolved.slice(i, i + BATCH);
    const values = chunk.map((r) =>
      `('${randomUUID()}', '${r.customerId}', '${esc(r.kodeOutlet)}', false, '${now.toISOString()}')`
    ).join(",\n");
    await prisma.$executeRawUnsafe(`
      INSERT INTO "CustomerOutlet" ("id","customerId","kodePI","isFokus","syncedAt")
      VALUES ${values}
      ON CONFLICT ("customerId","kodePI") DO UPDATE SET "syncedAt" = EXCLUDED."syncedAt"
    `);
    process.stdout.write(`  ${Math.min(i + BATCH, resolved.length)}/${resolved.length}\r`);
  }
  console.log(`\n✅ CustomerOutlet upserted.\n`);

  // ── PsspHospinetSnapshot rows ──────────────────────────────────────────────
  console.log(`Upserting ${resolved.length} PsspHospinetSnapshot rows...`);
  for (let i = 0; i < resolved.length; i += BATCH) {
    const chunk = resolved.slice(i, i + BATCH);
    const values = chunk.map((r) =>
      `('${randomUUID()}', '${r.customerId}', '${esc(r.kodeOutlet)}', ${sqlNullableStr(r.kodeCustomer)}, '${esc(r.statusCustomer)}', ${r.psspBerjalan}, ${sqlNullableStr(r.periodeAwal)}, ${sqlNullableStr(r.periodeAkhir)}, ${r.valuePssp}, ${r.pelunasan}, ${r.rr ?? "NULL"}, '${now.toISOString()}')`
    ).join(",\n");
    await prisma.$executeRawUnsafe(`
      INSERT INTO "PsspHospinetSnapshot" ("id","customerId","kodePI","kodeCustomer","statusCustomer","psspBerjalan","periodeAwal","periodeAkhir","valuePssp","pelunasan","rr","syncedAt")
      VALUES ${values}
      ON CONFLICT ("customerId","kodePI") DO UPDATE SET
        "kodeCustomer" = EXCLUDED."kodeCustomer",
        "statusCustomer" = EXCLUDED."statusCustomer",
        "psspBerjalan" = EXCLUDED."psspBerjalan",
        "periodeAwal" = EXCLUDED."periodeAwal",
        "periodeAkhir" = EXCLUDED."periodeAkhir",
        "valuePssp" = EXCLUDED."valuePssp",
        "pelunasan" = EXCLUDED."pelunasan",
        "rr" = EXCLUDED."rr",
        "syncedAt" = EXCLUDED."syncedAt"
    `);
    process.stdout.write(`  ${Math.min(i + BATCH, resolved.length)}/${resolved.length}\r`);
  }
  console.log(`\n✅ PsspHospinetSnapshot upserted: ${resolved.length} rows.\n`);

  console.log("✅ Import complete.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
