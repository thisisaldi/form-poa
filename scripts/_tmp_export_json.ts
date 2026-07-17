import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import * as fs from "fs";

async function main() {
  const rows = await prisma.customerOutlet.findMany({
    where: { isFokus: true },
    include: { customer: true, outlet: true },
    orderBy: [{ customer: { namaCustomer: "asc" } }],
  });
  const pm = rows.map(r => ({
    dokter: r.customer.namaCustomer,
    spesialisasi: r.customer.spesialisasi,
    kodePI: r.kodePI,
    outlet: r.outlet.namaOutlet,
  }));
  fs.writeFileSync("scripts/_tmp_pm.json", JSON.stringify(pm));
  console.log("PM rows:", pm.length);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
