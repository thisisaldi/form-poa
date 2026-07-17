/**
 * One-off fix: NARFOZ 4 INJEKSI (kodeProduk 005327) has konversiPembagi = 1,
 * should be 5 (5 ampul per satuan jual).
 *
 * Run: npx tsx scripts/fixNarfoz4InjeksiKonversi.ts
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const KODE_PRODUK = "005327";
const NEW_KONVERSI = 5;

async function main() {
  const before = await prisma.product.findUnique({
    where: { kodeProduk: KODE_PRODUK },
    select: { kodeProduk: true, namaProduk: true, konversiPembagi: true },
  });
  if (!before) {
    console.error(`Product ${KODE_PRODUK} not found.`);
    process.exit(1);
  }
  console.log(`Before: ${before.namaProduk} — konversiPembagi = ${before.konversiPembagi}`);

  const updated = await prisma.product.update({
    where: { kodeProduk: KODE_PRODUK },
    data: { konversiPembagi: NEW_KONVERSI },
  });
  console.log(`After:  ${updated.namaProduk} — konversiPembagi = ${updated.konversiPembagi}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
