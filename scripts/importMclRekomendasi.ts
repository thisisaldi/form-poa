/**
 * Import MCL dari Excel internal (docs/mcl-rekomendasi-dokter/).
 *
 *   npx tsx scripts/importMclRekomendasi.ts [path.xlsx]           # dry-run
 *   npx tsx scripts/importMclRekomendasi.ts [path.xlsx] --apply   # tulis ke DB
 *
 * Default file: internal/data Rekomendasi dokter Per Hospital dan per Spesialist.xlsx, sheet "Main"
 * (header baris 3). Workbook 36MB -> WAJIB streaming reader (ExcelJS biasa OOM).
 * Mengisi OutletProdukListing (status per outlet x produk) dan MclRekomendasiDokter (dedupe per
 * outlet+nama ternormalisasi+spesialis+produk). customerId hanya untuk match EXACT ke
 * CustomerOutlet di outlet yang sama. --apply mengganti SELURUH isi kedua tabel (satu batch).
 */
import ExcelJS from "exceljs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { matchTier, nameTokens, normalizeNama, type MatchTier } from "../src/lib/mclMatch";

type Status = "SUDAH_LISTING" | "BELUM_LISTING" | "PRODUK_TIDAK_ADA" | "OUTLET_TIDAK_ADA";
const STATUS_MAP: Record<string, Status> = {
  "SUDAH LISTING": "SUDAH_LISTING",
  "BELUM LISTING": "BELUM_LISTING",
  "PRODUK TIDAK ADA DI DATA LISTING": "PRODUK_TIDAK_ADA",
  "OUTLET TIDAK ADA DI DATA LISTING": "OUTLET_TIDAK_ADA",
};

function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown };
    if (o.result !== undefined) return cellText(o.result);
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("").trim();
    if (o.text !== undefined) return cellText(o.text);
  }
  return String(v).trim();
}

function num(v: unknown): number | null {
  const s = cellText(v).replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Kode produk Excel bisa terbaca numerik tanpa nol depan; kode DB 6 digit.
function kodeProduk(v: unknown): string {
  const s = cellText(v);
  return /^\d+$/.test(s) && s.length < 6 ? s.padStart(6, "0") : s;
}

interface Row { pi: string; dokter: string; spes: string; kp: string; ket: string; status: Status | null; est: number | null; lunas: number | null }

async function readMain(file: string): Promise<Row[]> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(file, { worksheets: "emit", sharedStrings: "cache", styles: "ignore", hyperlinks: "ignore" });
  const rows: Row[] = [];
  for await (const ws of reader) {
    if (ws.name !== "Main") { for await (const _ of ws) { /* drain */ } continue; }
    let n = 0;
    for await (const row of ws) {
      n++;
      if (n < 4) continue;
      const v = (row.values as unknown[]).slice(1);
      const pi = cellText(v[6]);
      const dokter = cellText(v[9]);
      if (!pi || !dokter) continue;
      rows.push({
        pi, dokter, spes: cellText(v[8]), kp: kodeProduk(v[10]), ket: cellText(v[12]),
        status: STATUS_MAP[cellText(v[13]).toUpperCase()] ?? null, est: num(v[14]), lunas: num(v[15]),
      });
    }
  }
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const file = args.find((a) => !a.startsWith("--")) ?? path.join("internal", "data Rekomendasi dokter Per Hospital dan per Spesialist.xlsx");
  const batch = `mcl-${new Date().toISOString().slice(0, 10)}`;

  console.log(`Membaca ${file} ...`);
  const rows = await readMain(file);
  console.log(`${rows.length} baris data Main.`);

  // Status per (outlet, produk): harus konsisten antar dokter (terverifikasi 2026-10-15; dilaporkan kalau tidak).
  const listing = new Map<string, Status>();
  const unknownStatus = new Set<string>();
  let conflict = 0;
  for (const r of rows) {
    if (!r.kp) continue;
    if (!r.status) { unknownStatus.add(r.pi + "|" + r.kp); continue; }
    const key = r.pi + "|" + r.kp;
    const prev = listing.get(key);
    if (prev && prev !== r.status) { conflict++; if (prev !== "SUDAH_LISTING") listing.set(key, r.status); continue; }
    listing.set(key, r.status);
  }

  const outletSet = new Set(rows.map((r) => r.pi));
  const outlets = await prisma.outlet.findMany({ where: { kodePI: { in: [...outletSet] } }, select: { kodePI: true } });
  const outletFound = new Set(outlets.map((o) => o.kodePI));
  const kpSet = [...new Set(rows.map((r) => r.kp).filter(Boolean))];
  const products = await prisma.product.findMany({ where: { kodeProduk: { in: kpSet } }, select: { kodeProduk: true } });
  const productFound = new Set(products.map((p) => p.kodeProduk));

  // Kandidat dokter per outlet dari CustomerOutlet (sumber lokal; dokter Exodus yang belum ada lokal tetap "Belum terdaftar").
  const co = await prisma.customerOutlet.findMany({
    where: { kodePI: { in: [...outletFound] } },
    select: { kodePI: true, customer: { select: { id: true, kodeCustomer: true, namaCustomer: true } } },
  });
  const candByPi = new Map<string, { id: string; hasKode: boolean; tokens: string[] }[]>();
  for (const c of co) {
    const list = candByPi.get(c.kodePI) ?? [];
    list.push({ id: c.customer.id, hasKode: !!c.customer.kodeCustomer, tokens: nameTokens(c.customer.namaCustomer) });
    candByPi.set(c.kodePI, list);
  }

  const matchCache = new Map<string, { tier: MatchTier; customerId: string | null }>();
  function resolve(pi: string, nama: string) {
    const key = pi + "|" + nama;
    const hit = matchCache.get(key);
    if (hit) return hit;
    const t = nameTokens(nama);
    let best: { tier: MatchTier; score: number; id: string; hasKode: boolean } | null = null;
    const rank = (x: MatchTier) => (x === "EXACT" ? 3 : x === "SUBSET" ? 2 : x === "FUZZY" ? 1 : 0);
    for (const c of candByPi.get(pi) ?? []) {
      const m = matchTier(t, c.tokens);
      if (m.tier === "NONE") continue;
      if (!best || rank(m.tier) > rank(best.tier) || (rank(m.tier) === rank(best.tier) && (m.score > best.score || (m.score === best.score && c.hasKode && !best.hasKode)))) {
        best = { tier: m.tier, score: m.score, id: c.id, hasKode: c.hasKode };
      }
    }
    const res = { tier: (best?.tier ?? "NONE") as MatchTier, customerId: best?.tier === "EXACT" ? best.id : null };
    matchCache.set(key, res);
    return res;
  }

  type Reko = { kodePI: string; namaDokter: string; namaNormalized: string; spesialis: string; kodeProduk: string; keterangan: string | null; estimasiAktif: number | null; pelunasan: number | null; customerId: string | null; matchTier: MatchTier; importBatch: string };
  const reko = new Map<string, Reko>();
  let noNormalized = 0;
  let placeholder = 0;
  for (const r of rows) {
    if (!r.kp) continue;
    if (r.dokter === "0") { placeholder++; continue; }
    const norm = normalizeNama(r.dokter);
    if (!norm) { noNormalized++; continue; }
    const key = [r.pi, norm, r.spes, r.kp].join("|");
    const m = resolve(r.pi, r.dokter);
    const next: Reko = {
      kodePI: r.pi, namaDokter: r.dokter, namaNormalized: norm, spesialis: r.spes, kodeProduk: r.kp,
      keterangan: r.ket || null, estimasiAktif: r.est, pelunasan: r.lunas, customerId: m.customerId, matchTier: m.tier, importBatch: batch,
    };
    const prev = reko.get(key);
    if (!prev) { reko.set(key, next); continue; }
    // Duplikat: pertahankan yang punya keterangan / angka terisi.
    if (!prev.keterangan && next.keterangan) prev.keterangan = next.keterangan;
    if (prev.estimasiAktif == null && next.estimasiAktif != null) prev.estimasiAktif = next.estimasiAktif;
    if (prev.pelunasan == null && next.pelunasan != null) prev.pelunasan = next.pelunasan;
  }

  const tier = new Map<string, number>();
  const docs = new Map<string, MatchTier>();
  for (const r of reko.values()) docs.set(r.kodePI + "|" + r.namaNormalized, r.matchTier);
  for (const t of docs.values()) tier.set(t, (tier.get(t) ?? 0) + 1);
  const statusCount = new Map<string, number>();
  for (const s of listing.values()) statusCount.set(s, (statusCount.get(s) ?? 0) + 1);

  console.log(`Outlet Excel: ${outletSet.size}, ada di DB: ${outletFound.size}${outletFound.size < outletSet.size ? " (hilang: " + [...outletSet].filter((o) => !outletFound.has(o)).slice(0, 10).join(", ") + ")" : ""}`);
  console.log(`Produk Excel: ${kpSet.length}, ada di DB: ${productFound.size}${productFound.size < kpSet.length ? " (hilang: " + kpSet.filter((k) => !productFound.has(k)).slice(0, 10).join(", ") + ")" : ""}`);
  console.log(`OutletProdukListing: ${listing.size} pasangan | per status: ${JSON.stringify(Object.fromEntries(statusCount))} | konflik antar dokter: ${conflict} | status tak dikenal: ${unknownStatus.size}`);
  console.log(`MclRekomendasiDokter: ${reko.size} baris (dari ${rows.length}); dilewati: placeholder nama "0" ${placeholder}, nama kosong setelah normalisasi ${noNormalized}`);
  console.log(`Dokter unik (outlet, nama): ${docs.size} | tier: ${JSON.stringify(Object.fromEntries(tier))}`);

  if (!apply) return console.log("Dry-run. Tambah --apply untuk menulis (mengganti seluruh isi kedua tabel).");

  const listingRows = [...listing].map(([k, status]) => { const [kodePI, kodeProduk] = k.split("|"); return { kodePI, kodeProduk, status, importBatch: batch }; });
  const rekoRows = [...reko.values()];
  await prisma.$transaction(
    async (tx) => {
      await tx.mclRekomendasiDokter.deleteMany();
      await tx.outletProdukListing.deleteMany();
      for (let i = 0; i < listingRows.length; i += 5000) await tx.outletProdukListing.createMany({ data: listingRows.slice(i, i + 5000) });
      for (let i = 0; i < rekoRows.length; i += 5000) await tx.mclRekomendasiDokter.createMany({ data: rekoRows.slice(i, i + 5000) });
    },
    { timeout: 10 * 60 * 1000, maxWait: 60 * 1000 },
  );
  console.log(`Selesai: ${listingRows.length} listing, ${rekoRows.length} rekomendasi (batch ${batch}).`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
