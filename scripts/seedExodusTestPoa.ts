/**
 * Ad-hoc test data for Exodus autofill testing (2026-09-04 request from Budi,
 * Pharos): 1 new PoaForm in the CURRENT quarter, NSM-approved, with line items
 * whose periodeAwal is THIS month so /api/poa-doctors returns non-zero qty
 * for that month (qty=0 blocks PSSP form submission on Exodus's side).
 *
 * Random MR + their real outlet assignments/customers, random products with
 * hna > 0 (qty = rencanaTotalBiaya / hna, so hna=0 would force qty=0).
 *
 * Usage (targets staging — hardcoded, this script has no other purpose):
 *   npx tsx scripts/seedExodusTestPoa.ts [doctorCount]
 */
import "dotenv/config";
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(".env.staging"), override: true });

import { PrismaClient, PoaStatus } from "@prisma/client";
import { currentQuarter } from "../src/lib/quarterUtils";

const prisma = new PrismaClient();

const doctorCount = parseInt(process.argv[2] ?? "3", 10);

async function main() {
  const mr = await prisma.$queryRawUnsafe<{ nip: string; kodePI: string }[]>(`
    SELECT u.nip, a."kodePI"
    FROM "User" u
    JOIN "MrOutletAssignment" a ON a."nipMR" = u.nip
    WHERE u.role = 'MR' AND u."isActive" = true
    ORDER BY random() LIMIT 1
  `);
  if (!mr.length) throw new Error("No active MR with an outlet assignment found.");
  const ownerId = mr[0].nip;

  const assignments = await prisma.$queryRawUnsafe<{ kodePI: string; namaOutlet: string }[]>(`
    SELECT "kodePI", "namaOutlet" FROM (
      SELECT DISTINCT ON (a."kodePI") a."kodePI", o."namaOutlet"
      FROM "MrOutletAssignment" a
      JOIN "Outlet" o ON o."kodePI" = a."kodePI"
      WHERE a."nipMR" = '${ownerId}'
    ) AS distinct_assignments
    ORDER BY random() LIMIT ${doctorCount}
  `);
  if (!assignments.length) throw new Error(`MR ${ownerId} has no outlet assignments.`);

  const products = await prisma.$queryRawUnsafe<{ kodeProduk: string; namaProduk: string; hna: string; satuanTerkecil: string | null }[]>(`
    SELECT "kodeProduk", "namaProduk", hna, "satuanTerkecil"
    FROM "Product"
    WHERE hna > 0
    ORDER BY random() LIMIT ${assignments.length}
  `);
  if (!products.length) throw new Error("No product with hna > 0 found.");

  const now = new Date();
  const periodeAwal = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const quarter = currentQuarter();

  const poa = await prisma.poaForm.create({
    data: { ownerId, period: quarter, status: PoaStatus.APPROVED_BY_NSM },
  });

  for (let i = 0; i < assignments.length; i++) {
    const { kodePI, namaOutlet } = assignments[i];
    const product = products[i % products.length];
    const hna = parseFloat(product.hna);
    const qtyTarget = 10; // arbitrary non-zero qty
    const rencanaTotalBiaya = Math.round(hna * qtyTarget);

    const customer = await prisma.$queryRawUnsafe<{ namaCustomer: string; spesialisasi: string }[]>(`
      SELECT c."namaCustomer", c.spesialisasi
      FROM "CustomerOutlet" co
      JOIN "Customer" c ON c.id = co."customerId"
      WHERE co."kodePI" = '${kodePI}'
      ORDER BY random() LIMIT 1
    `);
    const namaCust = customer[0]?.namaCustomer ?? `Dr Test Exodus ${i + 1}`;
    const spesialisasi = customer[0]?.spesialisasi ?? "UMUM";

    await prisma.poaLineItem.create({
      data: {
        poaId: poa.id,
        namaCust,
        role: spesialisasi.toUpperCase().includes("SPESIALIS") ? "Dokter Spesialis" : "Dokter Umum",
        spesialisasi,
        kodePI,
        namaOutlet,
        kodeProduk: product.kodeProduk,
        namaProduk: product.namaProduk,
        kategoriProdukFokus: "FOKUS",
        itemKode: product.kodeProduk,
        satuanTerkecil: product.satuanTerkecil ?? "TABLET",
        lamaPeriode: 1,
        periodeAwal,
        rencanaTotalBiaya,
        rencanaVisitMinggu: 1,
      },
    });
  }

  console.log(`Created PoaForm ${poa.id} (seq POA${String(poa.seq).padStart(4, "0")}), owner ${ownerId}, period ${quarter}, periodeAwal ${periodeAwal}, ${assignments.length} doctor(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
