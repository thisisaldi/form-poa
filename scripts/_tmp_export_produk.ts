import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { PAKET_BY_PRODUK } from "../src/lib/paketProduk";
import * as fs from "fs";

async function main() {
  const kodeList = Object.keys(PAKET_BY_PRODUK);
  const products = await prisma.product.findMany({
    where: { namaProduk: { in: kodeList } },
  });
  const byName = new Map(products.map(p => [p.namaProduk, p]));
  const list = kodeList.map(nama => {
    const p = byName.get(nama);
    return {
      kodeProduk: p?.kodeProduk ?? "-",
      namaProduk: nama,
      pakets: PAKET_BY_PRODUK[nama],
      hna: p ? parseFloat(p.hna.toString()) : null,
      namaGroupBrand: p?.namaGroupBrand ?? "-",
    };
  }).sort((a, b) => a.pakets[0].localeCompare(b.pakets[0]) || a.namaProduk.localeCompare(b.namaProduk));
  fs.writeFileSync("scripts/_tmp_produk.json", JSON.stringify(list));
  console.log("Produk fokus:", list.length);
  console.log(list.filter(x => x.kodeProduk === "-"));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
