/**
 * Generates src/lib/mock/generated-data.json from the real Excel source files.
 * Run this once (or when Excel files are updated) to refresh offline mock data.
 *
 * Usage:
 *   npx tsx scripts/generateMockData.ts \
 *     "Customer_Database_20260710.xlsx" \
 *     "RS GROUP - PHAROS INDONESIA.xlsx" \
 *     "LIST PRODUK PI update 15 Juni 2026.xlsx"
 *
 * Output: src/lib/mock/generated-data.json
 *
 * The mock client loads this file when USE_MOCK_DB=true, giving you realistic
 * offline data that mirrors production without a DB connection.
 */

import "dotenv/config";
import path from "path";
import fs from "fs";
import ExcelJS from "exceljs";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MockOutlet {
  kodePI: string;
  namaOutlet: string;
  sector: string | null;
  subSektor: string | null;
  statusOutlet: string;
}

interface MockCustomerRecord {
  id: string;
  kodeCustomer: string | null;
  namaCustomer: string;
  spesialisasi: string;
}

interface MockCustomerOutlet {
  id: string;
  customerId: string;
  kodePI: string;
  isFokus: boolean;
}

interface MockProduct {
  kodeProduk: string;
  namaGroupBrand: string;
  namaProduk: string;
  zatAktif: string | null;
  satuan: string;
  hna: string;
}

interface MockData {
  outlets: MockOutlet[];
  customers: MockCustomerRecord[];
  customerOutlets: MockCustomerOutlet[];
  products: MockProduct[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseTemplate(raw: string): string | null {
  const m = raw.match(/\{\{(.+?)\s+true\}\}/);
  return m ? m[1].trim() : null;
}

function isEmptyCell(val: string): boolean {
  return !val || val === "-" || val.trim() === "";
}

let _idCounter = 1;
function nextId(prefix: string) {
  return `${prefix}-${String(_idCounter++).padStart(6, "0")}`;
}

// ─── Parse CDB ───────────────────────────────────────────────────────────────

async function parseCDB(filePath: string, validOutletCodes: Set<string>) {
  console.log(`Reading CDB: ${filePath}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheet = wb.getWorksheet("Sheet1");
  if (!sheet) throw new Error('Sheet "Sheet1" not found in CDB file');

  const customers = new Map<string, MockCustomerRecord>();
  const noCodeCustomers: MockCustomerRecord[] = [];
  const junctions: { customerId: string; kodePI: string }[] = [];

  for (let r = 9; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const kodeRaw = String(row.getCell(2).value ?? "");
    const namaRaw = String(row.getCell(3).value ?? "").trim();
    const specRaw = String(row.getCell(4).value ?? "");
    const kodeOutlet = String(row.getCell(7).value ?? "").trim();
    const kodeCustomer = parseTemplate(kodeRaw);
    const spesialisasi = parseTemplate(specRaw);

    if (!namaRaw || !spesialisasi || !kodeOutlet) continue;
    if (!validOutletCodes.has(kodeOutlet)) continue;

    let cust: MockCustomerRecord;
    if (kodeCustomer) {
      if (!customers.has(kodeCustomer)) {
        customers.set(kodeCustomer, { id: nextId("cust"), kodeCustomer, namaCustomer: namaRaw, spesialisasi });
      }
      cust = customers.get(kodeCustomer)!;
    } else {
      cust = { id: nextId("cust"), kodeCustomer: null, namaCustomer: namaRaw, spesialisasi };
      noCodeCustomers.push(cust);
    }

    junctions.push({ customerId: cust.id, kodePI: kodeOutlet });
  }

  return { customers: [...customers.values(), ...noCodeCustomers], junctions };
}

// ─── Parse RS GROUP ───────────────────────────────────────────────────────────

async function parseRSGroup(
  filePath: string,
  existingCustomers: MockCustomerRecord[],
  existingJunctions: { customerId: string; kodePI: string }[],
  validOutletCodes: Set<string>
) {
  console.log(`Reading RS GROUP: ${filePath}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheet = wb.getWorksheet("Dokter RS NON CHAIN");
  if (!sheet) throw new Error('"Dokter RS NON CHAIN" sheet not found');

  const colToSpec = new Map<number, string>();
  const headerRow = sheet.getRow(2);
  headerRow.eachCell((cell, col) => {
    if (col < 7) return;
    const raw = String(cell.value ?? "").trim();
    if (!raw || raw.startsWith("Total")) return;
    const m = raw.match(/^(.+?)\s+\d+$/);
    colToSpec.set(col, m ? m[1].trim() : raw);
  });

  // Build lookup: "kodePI|NAMANORMALIZED" → customerId
  const junctionLookup = new Map<string, string>();
  for (const j of existingJunctions) {
    const cust = existingCustomers.find((c) => c.id === j.customerId);
    if (cust) junctionLookup.set(`${j.kodePI}|${cust.namaCustomer.toUpperCase().trim()}`, j.customerId);
  }

  const newCustomers: MockCustomerRecord[] = [];
  const fokusJunctionIds = new Set<string>(); // junction keys to mark isFokus

  for (let r = 3; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const kodePI = String(row.getCell(5).value ?? "").trim();
    if (!kodePI || !validOutletCodes.has(kodePI)) continue;

    for (const [col, spesialisasi] of colToSpec) {
      const doctorName = String(row.getCell(col).value ?? "").trim();
      if (isEmptyCell(doctorName)) continue;

      const key = `${kodePI}|${doctorName.toUpperCase().trim()}`;
      const existingCustomerId = junctionLookup.get(key);

      if (existingCustomerId) {
        fokusJunctionIds.add(`${existingCustomerId}|${kodePI}`);
      } else {
        const newCust: MockCustomerRecord = {
          id: nextId("cust"),
          kodeCustomer: null,
          namaCustomer: doctorName,
          spesialisasi,
        };
        newCustomers.push(newCust);
        existingJunctions.push({ customerId: newCust.id, kodePI });
        fokusJunctionIds.add(`${newCust.id}|${kodePI}`);
        junctionLookup.set(key, newCust.id);
      }
    }
  }

  return { newCustomers, fokusJunctionIds };
}

// ─── Parse Products ───────────────────────────────────────────────────────────

async function parseProducts(filePath: string): Promise<MockProduct[]> {
  console.log(`Reading products: ${filePath}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  // Try to find the right sheet
  const sheetNames = wb.worksheets.map((s) => s.name);
  const sheet =
    wb.getWorksheet("Update 15 JUNI (Generik)") ??
    wb.getWorksheet(sheetNames[0]);
  if (!sheet) throw new Error("No product sheet found");

  const products = new Map<string, MockProduct>();
  for (let r = 4; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const kodeProduk = String(row.getCell(3).value ?? "").trim();
    const namaGroupBrand = String(row.getCell(4).value ?? "").trim();
    const namaProduk = String(row.getCell(5).value ?? "").trim();
    const zatAktif = String(row.getCell(6).value ?? "").trim() || null;
    const satuan = String(row.getCell(7).value ?? "").trim();
    const hnaRaw = row.getCell(8).value;
    const hna = hnaRaw != null ? String(hnaRaw) : null;

    if (!kodeProduk || !hna || isNaN(parseFloat(hna))) continue;
    products.set(kodeProduk, { kodeProduk, namaGroupBrand, namaProduk, zatAktif, satuan, hna });
  }

  return [...products.values()];
}

// ─── Hardcoded outlets (from Outlet table — not in Excel) ────────────────────
// We use a small curated set as mock outlets. The full set would come from DB.
const SAMPLE_OUTLETS: MockOutlet[] = [
  { kodePI: "A1000004", namaOutlet: "MARTHA FRISKA, RS/KARYA UTAMA SEHAT SEJAHTERA, PT", sector: "RS", subSektor: null, statusOutlet: "A" },
  { kodePI: "A1000826", namaOutlet: "HAJI ADAM MALIK, RSUP", sector: "RS", subSektor: null, statusOutlet: "A" },
  { kodePI: "F1000929", namaOutlet: "CIPTO MANGUNKUSUMO, RSUPN", sector: "RS", subSektor: null, statusOutlet: "A" },
  { kodePI: "I1003000", namaOutlet: "DR. SOETOMO, RSUD", sector: "RS", subSektor: null, statusOutlet: "A" },
  { kodePI: "H2002894", namaOutlet: "WAHIDIN SUDIROHUSODO, RSUP", sector: "RS", subSektor: null, statusOutlet: "A" },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const cdbPath = process.argv[2];
  const rsGroupPath = process.argv[3];
  const productsPath = process.argv[4];

  if (!cdbPath || !rsGroupPath) {
    console.error(
      'Usage: npx tsx scripts/generateMockData.ts "Customer_Database.xlsx" "RS GROUP.xlsx" ["LIST PRODUK PI.xlsx"]'
    );
    process.exit(1);
  }

  const validOutletCodes = new Set(SAMPLE_OUTLETS.map((o) => o.kodePI));

  // Parse CDB
  const { customers: cdbCustomers, junctions } = await parseCDB(
    path.resolve(cdbPath),
    validOutletCodes
  );

  // Parse RS GROUP
  const { newCustomers: fokusCustomers, fokusJunctionIds } = await parseRSGroup(
    path.resolve(rsGroupPath),
    cdbCustomers,
    junctions,
    validOutletCodes
  );

  const allCustomers = [...cdbCustomers, ...fokusCustomers];

  // Deduplicate junctions
  const seen = new Set<string>();
  const uniqueJunctions = junctions.filter(({ customerId, kodePI }) => {
    const k = `${customerId}|${kodePI}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Build CustomerOutlet with isFokus
  const customerOutlets: MockCustomerOutlet[] = uniqueJunctions.map(({ customerId, kodePI }, i) => ({
    id: `co-${String(i + 1).padStart(6, "0")}`,
    customerId,
    kodePI,
    isFokus: fokusJunctionIds.has(`${customerId}|${kodePI}`),
  }));

  // Parse products (optional)
  const products = productsPath ? await parseProducts(path.resolve(productsPath)) : [];

  const data: MockData = {
    outlets: SAMPLE_OUTLETS,
    customers: allCustomers,
    customerOutlets,
    products,
  };

  const outPath = path.resolve("src/lib/mock/generated-data.json");
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf-8");

  console.log(`\n✅ Mock data generated: ${outPath}`);
  console.log(`   Outlets:         ${data.outlets.length}`);
  console.log(`   Customers:       ${data.customers.length}`);
  console.log(`   CustomerOutlets: ${data.customerOutlets.length} (fokus: ${customerOutlets.filter((c) => c.isFokus).length})`);
  console.log(`   Products:        ${data.products.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
