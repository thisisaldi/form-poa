/**
 * Generates src/lib/mock/generated-data.json from real source files.
 * Run once (or when files are updated) to refresh offline mock data.
 *
 * Usage:
 *   npx tsx scripts/generateMockData.ts \
 *     "excel/STRUKTUR JULI.csv" \
 *     "excel/Customer_Database_20260710.xlsx" \
 *     "excel/RS GROUP - PHAROS INDONESIA.xlsx" \
 *     ["excel/LIST PRODUK PI update 15 Juni 2026.xlsx"]
 */

import "dotenv/config";
import path from "path";
import fs from "fs";
import ExcelJS from "exceljs";
import type { Role } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MockUser {
  nip: string;
  name: string;
  email: string | null;
  role: Role;
  nipAtasan: string | null;
  namaAtasan: string | null;
  kodeWilayah: string | null;
  namaWilayah: string | null;
  isActive: boolean;
}

interface MockOutlet {
  kodePI: string;
  namaOutlet: string;
  sector: string | null;
  subSektor: string | null;
  statusOutlet: string;
  kodeGT: string | null;
  namaGT: string | null;
  kodeSub: string | null;
  namaSub: string | null;
  kodeArea: string | null;
  namaArea: string | null;
  kodeReg: string | null;
  namaReg: string | null;
}

interface MockMrAssignment {
  id: string;
  nipMR: string;
  kodePI: string;
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
  users: MockUser[];
  outlets: MockOutlet[];
  mrAssignments: MockMrAssignment[];
  customers: MockCustomerRecord[];
  customerOutlets: MockCustomerOutlet[];
  products: MockProduct[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isVacant(nip: string): boolean {
  return !nip || nip.startsWith("V");
}

function dominant(values: string[]): string {
  const freq = new Map<string, number>();
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

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

// ─── Parse Struktur CSV ───────────────────────────────────────────────────────

function parseStrukturCSV(filePath: string): {
  users: MockUser[];
  outlets: MockOutlet[];
  mrAssignments: MockMrAssignment[];
} {
  console.log(`Reading struktur CSV: ${filePath}`);
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split(";");

  function col(row: string[], name: string): string {
    return (row[headers.indexOf(name)] ?? "").trim();
  }

  // Collect per-user role + observed manager NIPs + territory codes
  const userMap = new Map<string, { name: string; role: Role; managerNips: string[]; kodeWilayahs: string[]; namaWilayahs: string[] }>();
  const outletMap = new Map<string, MockOutlet>();
  const assignmentSet = new Set<string>(); // "nipMR|kodePI"

  function collect(nip: string, name: string, role: Role, managerNip: string | null, kodeWilayah: string | null, namaWilayah: string | null) {
    if (isVacant(nip)) return;
    const existing = userMap.get(nip);
    if (existing) {
      if (managerNip && !isVacant(managerNip)) existing.managerNips.push(managerNip);
      if (kodeWilayah) { existing.kodeWilayahs.push(kodeWilayah); existing.namaWilayahs.push(namaWilayah ?? kodeWilayah); }
    } else {
      userMap.set(nip, {
        name: name.trim(),
        role,
        managerNips: managerNip && !isVacant(managerNip) ? [managerNip] : [],
        kodeWilayahs: kodeWilayah ? [kodeWilayah] : [],
        namaWilayahs: kodeWilayah ? [namaWilayah ?? kodeWilayah] : [],
      });
    }
  }

  for (const line of lines.slice(1)) {
    const row = line.split(";");
    const divisi = col(row, "Divisi");
    if (divisi !== "KAM1") continue;

    const kodePI       = col(row, "KodePI");
    const namaOutlet   = col(row, "NamaOutlet");
    const statusOutlet = col(row, "StatusOutlet");
    const sector       = col(row, "Sector") || null;
    const subSektor    = col(row, "Sub_Sektor") || null;
    const nsmNip       = col(row, "NSM_NIP");
    const nsmNama      = col(row, "NSM_Nama");
    const smNip        = col(row, "SM_NIP");
    const smNama       = col(row, "SM_Nama");
    const kdReg        = col(row, "KD_REG") || null;
    const nmReg        = col(row, "NM_REG") || null;
    const asmNip       = col(row, "ASM_NIP");
    const asmNama      = col(row, "ASM_Nama");
    const kdArea       = col(row, "KD_AREA") || null;
    const nmArea       = col(row, "NM_AREA") || null;
    const spvNip       = col(row, "SPV_NIP");
    const spvNama      = col(row, "SPV_Nama");
    const kdSub        = col(row, "KD_SUB") || null;
    const nmSub        = col(row, "NM_SUB") || null;
    const ffNip        = col(row, "FF_NIP");
    const ffNama       = col(row, "FF_Nama");
    const kdGT         = col(row, "KD_GT") || null;
    const nmGT         = col(row, "NM_GT") || null;

    // Users (with territory)
    collect(nsmNip, nsmNama, "NSM", null,   null,  null);
    collect(smNip,  smNama,  "SM",  nsmNip, kdReg, nmReg);
    collect(asmNip, asmNama, "ASM", smNip,  kdArea, nmArea);
    collect(spvNip, spvNama, "MR",  asmNip, kdSub, nmSub);
    collect(ffNip,  ffNama,  "MR",  asmNip, kdGT,  nmGT);

    // Outlet (with full territory hierarchy)
    if (kodePI && !outletMap.has(kodePI)) {
      outletMap.set(kodePI, {
        kodePI, namaOutlet, sector, subSektor, statusOutlet: statusOutlet || "A",
        kodeGT: kdGT, namaGT: nmGT,
        kodeSub: kdSub, namaSub: nmSub,
        kodeArea: kdArea, namaArea: nmArea,
        kodeReg: kdReg, namaReg: nmReg,
      });
    }

    // MR assignment: FF → outlet; if FF is vacant, fall back to SPV
    const assigneeNip = !isVacant(ffNip) ? ffNip : !isVacant(spvNip) ? spvNip : null;
    if (assigneeNip && kodePI) {
      assignmentSet.add(`${assigneeNip}|${kodePI}`);
    }
  }

  // Build users with hierarchy and dominant territory
  const userNipToName = new Map([...userMap.entries()].map(([nip, u]) => [nip, u.name]));
  const users: MockUser[] = [...userMap.entries()].map(([nip, { name, role, managerNips, kodeWilayahs, namaWilayahs }]) => {
    const nipAtasan = managerNips.length > 0 ? dominant(managerNips) : null;
    const kodeWilayah = kodeWilayahs.length > 0 ? dominant(kodeWilayahs) : null;
    const namaWilayah = namaWilayahs.length > 0 ? dominant(namaWilayahs) : null;
    return {
      nip,
      name,
      email: null,
      role,
      nipAtasan,
      namaAtasan: nipAtasan ? (userNipToName.get(nipAtasan) ?? null) : null,
      kodeWilayah,
      namaWilayah,
      isActive: true,
    };
  });

  const outlets = [...outletMap.values()];
  const mrAssignments: MockMrAssignment[] = [...assignmentSet].map((key, i) => {
    const [nipMR, kodePI] = key.split("|");
    return { id: `asgn-${String(i + 1).padStart(6, "0")}`, nipMR, kodePI };
  });

  console.log(`  Users: ${users.length} | Outlets: ${outlets.length} | MR assignments: ${mrAssignments.length}`);
  return { users, outlets, mrAssignments };
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
    const kodeRaw     = String(row.getCell(2).value ?? "");
    const namaRaw     = String(row.getCell(3).value ?? "").trim();
    const specRaw     = String(row.getCell(4).value ?? "");
    const kodeOutlet  = String(row.getCell(7).value ?? "").trim();
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
  sheet.getRow(2).eachCell((cell, col) => {
    if (col < 7) return;
    const raw = String(cell.value ?? "").trim();
    if (!raw || raw.startsWith("Total")) return;
    const m = raw.match(/^(.+?)\s+\d+$/);
    colToSpec.set(col, m ? m[1].trim() : raw);
  });

  const junctionLookup = new Map<string, string>();
  for (const j of existingJunctions) {
    const cust = existingCustomers.find((c) => c.id === j.customerId);
    if (cust) junctionLookup.set(`${j.kodePI}|${cust.namaCustomer.toUpperCase().trim()}`, j.customerId);
  }

  const newCustomers: MockCustomerRecord[] = [];
  const fokusJunctionIds = new Set<string>();

  for (let r = 3; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const kodePI = String(row.getCell(5).value ?? "").trim();
    if (!kodePI || !validOutletCodes.has(kodePI)) continue;

    for (const [col, spesialisasi] of colToSpec) {
      const doctorName = String(row.getCell(col).value ?? "").trim();
      if (isEmptyCell(doctorName)) continue;

      const key = `${kodePI}|${doctorName.toUpperCase().trim()}`;
      const existingId = junctionLookup.get(key);
      if (existingId) {
        fokusJunctionIds.add(`${existingId}|${kodePI}`);
      } else {
        const newCust: MockCustomerRecord = { id: nextId("cust"), kodeCustomer: null, namaCustomer: doctorName, spesialisasi };
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
  const sheet = wb.getWorksheet("Update 15 JUNI (Generik)") ?? wb.worksheets[0];
  if (!sheet) throw new Error("No product sheet found");

  const products = new Map<string, MockProduct>();
  for (let r = 4; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const kodeProduk     = String(row.getCell(3).value ?? "").trim();
    const namaGroupBrand = String(row.getCell(4).value ?? "").trim();
    const namaProduk     = String(row.getCell(5).value ?? "").trim();
    const zatAktif       = String(row.getCell(6).value ?? "").trim() || null;
    const satuan         = String(row.getCell(7).value ?? "").trim();
    const hnaRaw         = row.getCell(8).value;
    const hna            = hnaRaw != null ? String(hnaRaw) : null;
    if (!kodeProduk || !hna || isNaN(parseFloat(hna))) continue;
    products.set(kodeProduk, { kodeProduk, namaGroupBrand, namaProduk, zatAktif, satuan, hna });
  }
  return [...products.values()];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const strukturPath = process.argv[2];
  const cdbPath      = process.argv[3];
  const rsGroupPath  = process.argv[4];
  const productsPath = process.argv[5];

  if (!strukturPath || !cdbPath || !rsGroupPath) {
    console.error(
      'Usage: npx tsx scripts/generateMockData.ts "STRUKTUR.csv" "Customer_Database.xlsx" "RS GROUP.xlsx" ["LIST PRODUK PI.xlsx"]'
    );
    process.exit(1);
  }

  // Parse struktur CSV → users, outlets, MR assignments
  const { users, outlets, mrAssignments } = parseStrukturCSV(path.resolve(strukturPath));
  const validOutletCodes = new Set(outlets.map((o) => o.kodePI));

  // Parse doctors
  const { customers: cdbCustomers, junctions } = await parseCDB(path.resolve(cdbPath), validOutletCodes);
  const { newCustomers: fokusCustomers, fokusJunctionIds } = await parseRSGroup(
    path.resolve(rsGroupPath), cdbCustomers, junctions, validOutletCodes
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

  const customerOutlets: MockCustomerOutlet[] = uniqueJunctions.map(({ customerId, kodePI }, i) => ({
    id: `co-${String(i + 1).padStart(6, "0")}`,
    customerId,
    kodePI,
    isFokus: fokusJunctionIds.has(`${customerId}|${kodePI}`),
  }));

  const products = productsPath ? await parseProducts(path.resolve(productsPath)) : [];

  const data: MockData = { users, outlets, mrAssignments, customers: allCustomers, customerOutlets, products };

  const outPath = path.resolve("src/lib/mock/generated-data.json");
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf-8");

  console.log(`\n✅ Mock data generated: ${outPath}`);
  console.log(`   Users:           ${data.users.length}`);
  console.log(`   Outlets:         ${data.outlets.length}`);
  console.log(`   MR assignments:  ${data.mrAssignments.length}`);
  console.log(`   Customers:       ${data.customers.length}`);
  console.log(`   CustomerOutlets: ${data.customerOutlets.length} (fokus: ${customerOutlets.filter((c) => c.isFokus).length})`);
  console.log(`   Products:        ${data.products.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
