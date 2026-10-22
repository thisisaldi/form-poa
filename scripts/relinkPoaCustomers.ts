/**
 * Isi PoaLineItem.kodeCust (+ namaCust) yang null dengan mencocokkan nama ke Customer master.
 *
 * Aturan:
 *  A  nama (tanpa gelar) cocok + customer terdaftar di outlet item (kodePI) -> pasang.
 *  B  nama unik di master, outlet tidak cocok -> pasang HANYA kalau nama >= 2 kata, spesialisasi
 *     master bukan non-dokter, dan tidak bentrok dengan gelar Sp di nama item (item "SpPD" vs master GP).
 *  Sisanya (ambigu / tidak ketemu / B yang gagal cek) dilewati dan dicetak.
 *
 * Default DRY-RUN (tulis CSV, tidak ubah DB). --apply untuk menulis; backup id + nama lama ke JSON.
 * Target DB = DATABASE_URL. Jalankan backfill dulu: scripts/syncCustomerCodeExodus.ts.
 *
 * Usage: npx tsx scripts/relinkPoaCustomers.ts [--apply] [--out=./relink]
 */
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");
const OUT = (process.argv.find((a) => a.startsWith("--out=")) ?? "--out=./relink").slice(6);

const TITLE = /\b(dr|drg|dra|prof|sp[a-z]{0,4}|k|subsp|mkes|mars|mkm|msc|mm|msi)\b/g;
const norm = (s: string) => s.toLowerCase().replace(/[.,()\-\/]/g, " ").replace(TITLE, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean).sort().join(" ");
const NON_DOCTOR = /BIDAN|PEMBELIAN|APOTEKER|PERAWAT|ADMIN|PURCHAS/i;
const GP = /UMUM|\bGP\b/i;
// "SpPD", "Sp.A", "SPoG" dst di nama item, tapi bukan "Sp" kosong
const itemHasSp = (s: string) => /\bsp[\s.]?[a-z]{1,4}\b/i.test(s.replace(/,/g, " "));

(async () => {
  const groups = await prisma.poaLineItem.groupBy({ by: ["namaCust", "kodePI"], where: { kodeCust: null }, _count: true });
  const custs = await prisma.customer.findMany({ select: { kodeCustomer: true, namaCustomer: true, spesialisasi: true, outlets: { select: { kodePI: true } } } });
  const byName = new Map<string, typeof custs>();
  for (const c of custs) { if (!c.kodeCustomer) continue; const k = norm(c.namaCustomer); if (k) (byName.get(k) ?? byName.set(k, []).get(k)!).push(c); }

  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = ["decision,rule,item_nama,kodePI,item_count,kodeCustomer,namaCustomer,spesialisasi,note"];
  const backup: unknown[] = [];
  const stat: Record<string, number> = {}; let itemsUpdated = 0;

  for (const g of groups) {
    const key = norm(g.namaCust);
    const cands = byName.get(key) ?? [];
    const atOutlet = g.kodePI ? cands.filter((c) => c.outlets.some((o: { kodePI: string }) => o.kodePI === g.kodePI)) : [];
    let rule = "NONE", pick: (typeof custs)[number] | null = null, note = "";
    if (atOutlet.length === 1) { rule = "A"; pick = atOutlet[0]; }
    else if (atOutlet.length > 1) { rule = "AMBIG"; note = "banyak customer di outlet sama"; }
    else if (cands.length === 1) {
      rule = "B"; pick = cands[0];
      if (key.split(" ").length < 2) { note = "nama 1 kata"; pick = null; }
      else if (NON_DOCTOR.test(pick.spesialisasi)) { note = "master bukan dokter"; pick = null; }
      else if (itemHasSp(g.namaCust) && GP.test(pick.spesialisasi)) { note = "item bergelar Sp, master GP"; pick = null; }
    } else if (cands.length > 1) { rule = "AMBIG"; note = cands.map((c) => c.kodeCustomer).join("|"); }

    const decision = pick ? "PASANG" : "SKIP";
    stat[`${rule}/${decision}`] = (stat[`${rule}/${decision}`] ?? 0) + g._count;
    csv.push([decision, rule, q(g.namaCust), g.kodePI ?? "", g._count, pick?.kodeCustomer ?? "", q(pick?.namaCustomer), q(pick?.spesialisasi), q(note)].join(","));

    if (pick && APPLY) {
      const ids = (await prisma.poaLineItem.findMany({ where: { kodeCust: null, namaCust: g.namaCust, kodePI: g.kodePI }, select: { id: true } })).map((x: { id: string }) => x.id);
      backup.push({ ids, oldNamaCust: g.namaCust, kodePI: g.kodePI, newKodeCust: pick.kodeCustomer, newNamaCust: pick.namaCustomer });
      itemsUpdated += (await prisma.poaLineItem.updateMany({ where: { id: { in: ids }, kodeCust: null }, data: { kodeCust: pick.kodeCustomer, namaCust: pick.namaCustomer } })).count;
    }
  }

  fs.writeFileSync(`${OUT}.csv`, csv.join("\n"));
  if (APPLY) fs.writeFileSync(`${OUT}-backup.json`, JSON.stringify(backup));
  console.log({ mode: APPLY ? "APPLY" : "DRY-RUN", itemsByRuleDecision: stat, itemsUpdated, csv: `${OUT}.csv`, backup: APPLY ? `${OUT}-backup.json` : null });
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
