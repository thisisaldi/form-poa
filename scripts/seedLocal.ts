/**
 * Seeds a local PostgreSQL database from generated-data.json (produced by mock:generate).
 * Use this when MSSQL / production DB is not reachable (e.g. working offline).
 *
 * Usage:
 *   npm run seed:local
 */

import "dotenv/config";
import path from "path";
import fs from "fs";
import { PrismaClient } from "@prisma/client";

const url = new URL(process.env.DATABASE_URL!);
url.searchParams.set("connection_limit", "5");
url.searchParams.set("pool_timeout", "60");
const prisma = new PrismaClient({ datasourceUrl: url.toString() });

const BATCH = 500;
const NOW = new Date();
const PERIODE = parseInt(`${NOW.getFullYear()}${String(NOW.getMonth() + 1).padStart(2, "0")}`);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function esc(v: string | null | undefined): string {
  if (v == null) return "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}

// ─── Load source data ─────────────────────────────────────────────────────────

const genPath = path.resolve("src/lib/mock/generated-data.json");
if (!fs.existsSync(genPath)) {
  console.error(`generated-data.json not found at ${genPath}`);
  console.error("Run: npm run mock:generate");
  process.exit(1);
}

const gen = JSON.parse(fs.readFileSync(genPath, "utf-8")) as {
  users: { nip: string; name: string; email: string | null; role: string; nipAtasan: string | null; namaAtasan: string | null; kodeWilayah: string | null; namaWilayah: string | null; isActive: boolean }[];
  outlets: { kodePI: string; namaOutlet: string; sector: string | null; subSektor: string | null; statusOutlet: string; kodeGT: string | null; namaGT: string | null; kodeSub: string | null; namaSub: string | null; kodeArea: string | null; namaArea: string | null; kodeReg: string | null; namaReg: string | null }[];
  mrAssignments: { id: string; nipMR: string; kodePI: string }[];
  customers: { id: string; kodeCustomer: string | null; namaCustomer: string; spesialisasi: string }[];
  customerOutlets: { id: string; customerId: string; kodePI: string; isFokus: boolean }[];
  products: { kodeProduk: string; namaGroupBrand: string; namaProduk: string; zatAktif: string | null; satuan: string; hna: string }[];
};

// ─── Step 1: Users (two passes — insert without manager first, then link) ────

async function seedUsers() {
  console.log(`\n[1/6] Seeding ${gen.users.length} users...`);

  // Pass A: upsert without nipAtasan to avoid FK self-ref issues
  for (const batch of chunks(gen.users, BATCH)) {
    const vals = batch.map((u) =>
      `(${esc(u.nip)},${esc(u.name)},${esc(u.email)},${esc(u.role)},NULL,NULL,${esc((u as {kodeWilayah?:string|null}).kodeWilayah)},${esc((u as {namaWilayah?:string|null}).namaWilayah)},${u.isActive},'${NOW.toISOString()}','${NOW.toISOString()}','${NOW.toISOString()}')`
    ).join(",");
    await prisma.$executeRawUnsafe(`
      INSERT INTO "User" (nip,name,email,role,"nipAtasan","namaAtasan","kodeWilayah","namaWilayah","isActive","syncedAt","createdAt","updatedAt")
      VALUES ${vals}
      ON CONFLICT (nip) DO UPDATE SET
        name=EXCLUDED.name, email=EXCLUDED.email, role=EXCLUDED.role,
        "kodeWilayah"=EXCLUDED."kodeWilayah", "namaWilayah"=EXCLUDED."namaWilayah",
        "isActive"=EXCLUDED."isActive", "syncedAt"=EXCLUDED."syncedAt", "updatedAt"=EXCLUDED."updatedAt"
    `);
  }

  // Pass B: update nipAtasan now that all users exist
  const withManager = gen.users.filter((u) => u.nipAtasan);
  for (const batch of chunks(withManager, BATCH)) {
    for (const u of batch) {
      await prisma.$executeRawUnsafe(`
        UPDATE "User" SET "nipAtasan"=${esc(u.nipAtasan)}, "namaAtasan"=${esc(u.namaAtasan)}
        WHERE nip=${esc(u.nip)}
      `);
    }
  }

  console.log(`  ✓ ${gen.users.length} users`);
}

// ─── Step 2: Outlets ──────────────────────────────────────────────────────────

async function seedOutlets() {
  console.log(`\n[2/6] Seeding ${gen.outlets.length} outlets...`);

  for (const batch of chunks(gen.outlets, BATCH)) {
    const vals = batch.map((o) =>
      `(${esc(o.kodePI)},${esc(o.namaOutlet)},${esc(o.statusOutlet || "A")},${esc(o.sector)},${esc(o.subSektor)},${esc(o.kodeGT)},${esc(o.namaGT)},${esc(o.kodeSub)},${esc(o.namaSub)},${esc(o.kodeArea)},${esc(o.namaArea)},${esc(o.kodeReg)},${esc(o.namaReg)},'${NOW.toISOString()}','${NOW.toISOString()}','${NOW.toISOString()}')`
    ).join(",");
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Outlet" ("kodePI","namaOutlet","statusOutlet",sector,"subSektor","kodeGT","namaGT","kodeSub","namaSub","kodeArea","namaArea","kodeReg","namaReg","syncedAt","createdAt","updatedAt")
      VALUES ${vals}
      ON CONFLICT ("kodePI") DO UPDATE SET
        "namaOutlet"=EXCLUDED."namaOutlet", "statusOutlet"=EXCLUDED."statusOutlet",
        sector=EXCLUDED.sector, "subSektor"=EXCLUDED."subSektor",
        "kodeGT"=EXCLUDED."kodeGT", "namaGT"=EXCLUDED."namaGT",
        "kodeSub"=EXCLUDED."kodeSub", "namaSub"=EXCLUDED."namaSub",
        "kodeArea"=EXCLUDED."kodeArea", "namaArea"=EXCLUDED."namaArea",
        "kodeReg"=EXCLUDED."kodeReg", "namaReg"=EXCLUDED."namaReg",
        "syncedAt"=EXCLUDED."syncedAt", "updatedAt"=EXCLUDED."updatedAt"
    `);
  }

  console.log(`  ✓ ${gen.outlets.length} outlets`);
}

// ─── Step 3: MR Assignments ───────────────────────────────────────────────────

async function seedAssignments() {
  console.log(`\n[3/6] Seeding ${gen.mrAssignments.length} MR assignments...`);

  // Only keep assignments where both nipMR and kodePI exist
  const validNips = new Set(gen.users.map((u) => u.nip));
  const validKodes = new Set(gen.outlets.map((o) => o.kodePI));
  const valid = gen.mrAssignments.filter((a) => validNips.has(a.nipMR) && validKodes.has(a.kodePI));

  // Deduplicate by nipMR|kodePI (periode is fixed)
  const seen = new Set<string>();
  const deduped = valid.filter((a) => {
    const k = `${a.nipMR}|${a.kodePI}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  for (const batch of chunks(deduped, BATCH)) {
    const vals = batch.map((a) =>
      `(gen_random_uuid(),${esc(a.nipMR)},${esc(a.kodePI)},${PERIODE},'${NOW.toISOString()}')`
    ).join(",");
    await prisma.$executeRawUnsafe(`
      INSERT INTO "MrOutletAssignment" (id,"nipMR","kodePI",periode,"syncedAt")
      VALUES ${vals}
      ON CONFLICT ("nipMR","kodePI",periode) DO UPDATE SET "syncedAt"=EXCLUDED."syncedAt"
    `);
  }

  console.log(`  ✓ ${deduped.length} assignments`);
}

// ─── Step 4: Products ─────────────────────────────────────────────────────────

async function seedProducts() {
  console.log(`\n[4/6] Seeding ${gen.products.length} products...`);

  for (const batch of chunks(gen.products, BATCH)) {
    const vals = batch.map((p) =>
      `(${esc(p.kodeProduk)},${esc(p.namaGroupBrand)},${esc(p.namaProduk)},${esc(p.zatAktif)},${esc(p.satuan)},${parseFloat(p.hna)},'${NOW.toISOString()}','${NOW.toISOString()}','${NOW.toISOString()}')`
    ).join(",");
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Product" ("kodeProduk","namaGroupBrand","namaProduk","zatAktif",satuan,hna,"syncedAt","createdAt","updatedAt")
      VALUES ${vals}
      ON CONFLICT ("kodeProduk") DO UPDATE SET
        "namaGroupBrand"=EXCLUDED."namaGroupBrand", "namaProduk"=EXCLUDED."namaProduk",
        "zatAktif"=EXCLUDED."zatAktif", satuan=EXCLUDED.satuan, hna=EXCLUDED.hna,
        "syncedAt"=EXCLUDED."syncedAt", "updatedAt"=EXCLUDED."updatedAt"
    `);
  }

  console.log(`  ✓ ${gen.products.length} products`);
}

// ─── Step 5: Customers ────────────────────────────────────────────────────────

async function seedCustomers() {
  console.log(`\n[5/6] Seeding ${gen.customers.length} customers...`);

  // Deduplicate by kodeCustomer (non-null)
  const seen = new Map<string, typeof gen.customers[0]>();
  const noCode: typeof gen.customers = [];
  for (const c of gen.customers) {
    if (c.kodeCustomer) {
      if (!seen.has(c.kodeCustomer)) seen.set(c.kodeCustomer, c);
    } else {
      noCode.push(c);
    }
  }
  const deduped = [...seen.values(), ...noCode];

  for (const batch of chunks(deduped, BATCH)) {
    const vals = batch.map((c) =>
      `(${esc(c.id)},${esc(c.kodeCustomer)},${esc(c.namaCustomer)},${esc(c.spesialisasi)},'${NOW.toISOString()}','${NOW.toISOString()}','${NOW.toISOString()}')`
    ).join(",");
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Customer" (id,"kodeCustomer","namaCustomer",spesialisasi,"syncedAt","createdAt","updatedAt")
      VALUES ${vals}
      ON CONFLICT (id) DO UPDATE SET
        "namaCustomer"=EXCLUDED."namaCustomer", spesialisasi=EXCLUDED.spesialisasi,
        "syncedAt"=EXCLUDED."syncedAt", "updatedAt"=EXCLUDED."updatedAt"
    `);
  }

  console.log(`  ✓ ${deduped.length} customers`);
}

// ─── Step 6: CustomerOutlets ──────────────────────────────────────────────────

async function seedCustomerOutlets() {
  console.log(`\n[6/6] Seeding ${gen.customerOutlets.length} customer-outlet links...`);

  const validCustomerIds = new Set(gen.customers.map((c) => c.id));
  const validKodes = new Set(gen.outlets.map((o) => o.kodePI));
  const valid = gen.customerOutlets.filter(
    (co) => validCustomerIds.has(co.customerId) && validKodes.has(co.kodePI)
  );

  // Deduplicate by customerId|kodePI
  const seen = new Set<string>();
  const deduped = valid.filter((co) => {
    const k = `${co.customerId}|${co.kodePI}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  for (const batch of chunks(deduped, BATCH)) {
    const vals = batch.map((co) =>
      `(${esc(co.id)},${esc(co.customerId)},${esc(co.kodePI)},${co.isFokus},'${NOW.toISOString()}')`
    ).join(",");
    await prisma.$executeRawUnsafe(`
      INSERT INTO "CustomerOutlet" (id,"customerId","kodePI","isFokus","syncedAt")
      VALUES ${vals}
      ON CONFLICT ("customerId","kodePI") DO UPDATE SET
        "isFokus"=EXCLUDED."isFokus", "syncedAt"=EXCLUDED."syncedAt"
    `);
  }

  console.log(`  ✓ ${deduped.length} customer-outlet links`);
}

// ─── Step 7: Dummy POAs ───────────────────────────────────────────────────────

function hashInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

async function seedDummyPoas(rootNip = "P240245") {
  // BFS to find all MR nips under rootNip
  const mrNips: string[] = [];
  let frontier = [rootNip];
  for (let depth = 0; depth < 6 && frontier.length > 0; depth++) {
    const subs = gen.users.filter((u) => frontier.includes(u.nipAtasan!) && u.isActive);
    if (!subs.length) break;
    mrNips.push(...subs.filter((u) => u.role === "MR").map((u) => u.nip));
    frontier = subs.filter((u) => u.role !== "MR").map((u) => u.nip);
  }

  if (mrNips.length === 0) {
    console.log(`\n[7/7] No MR users found under ${rootNip} — skipping dummy POAs`);
    return;
  }

  console.log(`\n[7/7] Seeding dummy POAs for ${mrNips.length} MR users under ${rootNip}...`);

  const period = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, "0")}`;
  let poaCount = 0;
  let lineCount = 0;

  for (const nipMR of mrNips) {
    const seed = hashInt(nipMR);

    // 2–4 POAs per MR (simulating multiple periods or drafts, but we use 1 period + suffix)
    const numPoas = 1 + (seed % 2); // 1 or 2 POAs
    const myAssignments = gen.mrAssignments.filter((a) => a.nipMR === nipMR);
    if (myAssignments.length === 0) continue;

    for (let pi = 0; pi < numPoas; pi++) {
      const poaId = `dummy-poa-${nipMR}-${pi}`;

      await prisma.$executeRawUnsafe(`
        INSERT INTO "PoaForm" (id,"ownerId",status,period,"createdAt","updatedAt")
        VALUES (${esc(poaId)},${esc(nipMR)},'APPROVED_BY_NSM',${esc(period)},'${NOW.toISOString()}','${NOW.toISOString()}')
        ON CONFLICT (id) DO NOTHING
      `);
      poaCount++;

      // 10–35 line items per POA
      const numItems = 10 + (hashInt(poaId) % 26);
      for (let li = 0; li < numItems; li++) {
        const liSeed = hashInt(`${poaId}-${li}`);
        const assignment = pick(myAssignments, liSeed);
        const product = pick(gen.products, liSeed + 7);
        const outlet = gen.outlets.find((o) => o.kodePI === assignment.kodePI);

        // Get customers for this outlet
        const coLinks = gen.customerOutlets.filter((co) => co.kodePI === assignment.kodePI);
        const customer = coLinks.length > 0
          ? gen.customers.find((c) => c.id === pick(coLinks, liSeed + 3).customerId)
          : null;

        const namaCust = customer?.namaCustomer ?? `Dokter ${liSeed % 999}`;
        const spesialisasi = customer?.spesialisasi ?? "UMUM";
        const kodePI = assignment.kodePI;
        const namaOutlet = outlet?.namaOutlet ?? kodePI;

        const hna = parseFloat(product.hna) || 100_000;
        const totalBiaya = Math.round(hna * (3 + liSeed % 8));

        const statusOptions = ["SUDAH_STANDARISASI", "BELUM_STANDARISASI", "BELUM_STANDARISASI"];
        const status = pick(statusOptions, liSeed);
        const lamaPeriode = 1 + (liSeed % 6);
        const periodeAwal = period;
        const rencanaVisitMinggu = 1 + (liSeed % 4);
        const role = spesialisasi.includes("SPESIALIS") ? "Dokter Spesialis" : "Dokter Umum";

        const liId = `dummy-li-${poaId}-${li}`;
        await prisma.$executeRawUnsafe(`
          INSERT INTO "PoaLineItem" (
            id,"poaId","kodePI","namaOutlet","namaCust",spesialisasi,role,
            "kodeProduk","namaProduk","kategoriProdukFokus","itemKode","satuanTerkecil",
            "rencanaTotalBiaya","rencanaVisitMinggu","statusStandarisasi",
            "lamaPeriode","periodeAwal","createdAt","updatedAt"
          ) VALUES (
            ${esc(liId)},${esc(poaId)},${esc(kodePI)},${esc(namaOutlet)},${esc(namaCust)},${esc(spesialisasi)},${esc(role)},
            ${esc(product.kodeProduk)},${esc(product.namaProduk)},'FOKUS',${esc(product.kodeProduk)},${esc(product.satuan)},
            ${totalBiaya},${rencanaVisitMinggu},${esc(status)},
            ${lamaPeriode},${esc(periodeAwal)},'${NOW.toISOString()}','${NOW.toISOString()}'
          )
          ON CONFLICT (id) DO NOTHING
        `);
        lineCount++;
      }
    }
  }

  console.log(`  ✓ ${poaCount} POAs, ${lineCount} line items`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Seeding local DB from generated-data.json...");
  console.log(`Target: ${url.hostname}:${url.port}/${url.pathname.slice(1)}`);

  await seedUsers();
  await seedOutlets();
  await seedAssignments();
  await seedProducts();
  await seedCustomers();
  await seedCustomerOutlets();
  await seedDummyPoas();

  console.log("\n✅ Seed complete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
