/**
 * Export absensi SIPP semua orang di struktur pokok divisi Hospital
 * (GM/NSM/SM/ASM/SPV/MR di OutletStrukturBaru, project null) ke Excel.
 * Dipakai GET /api/absensi-hospital/export (SFE/ADMIN) dan
 * scripts/exportAbsensiHospital.ts.
 *
 * Kolom: nama, NIP, jabatan, hari, tanggal, jam masuk, jam pulang, keterangan.
 * - Izin/cuti sengaja kosong — API absensi SIPP (get=absensi) gak punya field
 *   itu. "Telat" diisi dari AbsTelatYN.
 * - isActive sengaja gak difilter: orang yang resign/pindah NIP tetap punya
 *   absen di rentang.
 * - NIP lama orang yang sama (nama HR sama, masa kerja beririsan dengan
 *   rentang) ikut ditarik dan digabung di bawah NIP struktur — sama kayak
 *   kpiAbsensiSync.ts.
 * - Record identik dobel dari SIPP dibuang.
 * - Orang tanpa record absen tetap muncul 1 baris ("Tidak ada data absen").
 *
 * Satu panggilan SIPP per NIP (gak ada endpoint bulk), jadi dipanggil paralel
 * dengan batas SIPP_CONCURRENCY.
 */

import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { loadIdentities } from "@/lib/kpiIdentity";
import { getAbsensiByNip, type AbsensiRecord } from "@/lib/sippApi";

const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const SIPP_CONCURRENCY = 8;
const SIPP_FAILED = "Gagal tarik dari SIPP";
/** Rentang maksimal per export (user: 1 bulan). */
export const MAX_RANGE_DAYS = 31;

/** "2026-10-01 07:55:12" / ISO -> { date, time }; sentinel/empty -> null. */
function splitStamp(v: string): { date: string; time: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2})/.exec(v ?? "");
  if (!m || Number(m[1]) < 1990) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] };
}

/** null = valid; string = pesan error buat user. */
export function validateRange(startDate: string, endDate: string): string | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(startDate) || !re.test(endDate)) return "Format tanggal harus YYYY-MM-DD.";
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return "Tanggal tidak valid.";
  if (start > end) return "Tanggal mulai harus sebelum tanggal selesai.";
  if ((end - start) / 86_400_000 + 1 > MAX_RANGE_DAYS) return `Rentang maksimal ${MAX_RANGE_DAYS} hari (1 bulan).`;
  return null;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

export interface AbsensiHospitalExportResult {
  workbook: ExcelJS.Workbook;
  people: number;
  mergedAliasPeople: number;
  /** Orang yang panggilan SIPP-nya gagal — kalau = people, SIPP-nya down. */
  sippFailures: number;
  problems: string[];
}

export async function buildAbsensiHospitalWorkbook(startDate: string, endDate: string): Promise<AbsensiHospitalExportResult> {
  const struktur = (await prisma.outletStrukturBaru.findMany({
    select: { gmNip: true, nsmNip: true, smNip: true, asmNip: true, spvNip: true, psrNip: true },
  })) as Record<string, string | null>[];
  const nips = new Set<string>();
  for (const r of struktur) for (const n of Object.values(r)) if (n) nips.add(n);

  const users = (await prisma.user.findMany({
    where: { nip: { in: [...nips] }, project: null, isDummy: false, NOT: { nip: { startsWith: "TEST" } } },
    select: { nip: true, name: true, role: true, jabatan: true, sippAbsPtId: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  })) as { nip: string; name: string; role: string; jabatan: string | null; sippAbsPtId: number | null }[];
  const identities = await loadIdentities(users.map((u) => u.nip));
  const rangeStart = new Date(`${startDate}T00:00:00Z`);
  const rangeEnd = new Date(`${endDate}T23:59:59Z`);

  type Fetched = { ket: string } | { recs: AbsensiRecord[]; merged: boolean };
  const fetched = await mapLimit(users, SIPP_CONCURRENCY, async (u): Promise<Fetched> => {
    const ptId = u.sippAbsPtId ?? identities.get(u.nip)?.nips.find((a) => a.nip === u.nip)?.ptid ?? null;
    if (ptId == null) return { ket: "PTID tidak ditemukan" };
    const aliases = (identities.get(u.nip)?.nips ?? []).filter(
      (a) => a.nip !== u.nip && (!a.tglMasuk || a.tglMasuk <= rangeEnd) && (!a.tglKeluar || a.tglKeluar >= rangeStart)
    );
    const recs: AbsensiRecord[] = [];
    for (const [nip, pt] of [[u.nip, ptId] as [string, number], ...aliases.map((a): [string, number] => [a.nip, a.ptid])]) {
      const got = await getAbsensiByNip(nip, pt, startDate, endDate);
      if (got == null) return { ket: SIPP_FAILED };
      recs.push(...got);
    }
    return { recs, merged: aliases.length > 0 };
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("absensi");
  sheet.columns = [
    { header: "Nama", key: "nama", width: 30 },
    { header: "NIP", key: "nip", width: 12 },
    { header: "Jabatan", key: "jabatan", width: 10 },
    { header: "Hari", key: "hari", width: 10 },
    { header: "Tanggal", key: "tanggal", width: 12 },
    { header: "Jam Masuk", key: "masuk", width: 11 },
    { header: "Jam Pulang", key: "pulang", width: 11 },
    { header: "Keterangan", key: "ket", width: 24 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const problems: string[] = [];
  let mergedAliasPeople = 0;
  let sippFailures = 0;
  users.forEach((u, idx) => {
    const base = { nama: u.name, nip: u.nip, jabatan: u.jabatan ?? u.role };
    const f = fetched[idx];
    if ("ket" in f) {
      if (f.ket === SIPP_FAILED) sippFailures++;
      problems.push(`${u.nip} ${u.name}: ${f.ket}`);
      sheet.addRow({ ...base, ket: f.ket });
      return;
    }
    if (f.merged) mergedAliasPeople++;
    const rows = f.recs
      .map((r) => ({ r, inn: splitStamp(r.absDateIn), out: splitStamp(r.absDateOut) }))
      .filter((x): x is typeof x & { inn: { date: string; time: string } } => x.inn != null)
      .sort((a, b) => a.inn.date.localeCompare(b.inn.date) || a.inn.time.localeCompare(b.inn.time));
    if (rows.length === 0) {
      sheet.addRow({ ...base, ket: "Tidak ada data absen" });
      return;
    }
    const seen = new Set<string>(); // SIPP kadang ngirim record identik dobel
    for (const { r, inn, out } of rows) {
      const dupKey = `${inn.date}|${inn.time}|${out?.time ?? ""}`;
      if (seen.has(dupKey)) continue;
      seen.add(dupKey);
      sheet.addRow({
        ...base,
        hari: HARI[new Date(`${inn.date}T00:00:00Z`).getUTCDay()],
        tanggal: inn.date,
        masuk: inn.time,
        pulang: out?.time ?? "",
        ket: r.absTelatYN === "Y" ? "Telat" : "",
      });
    }
  });

  return { workbook, people: users.length, mergedAliasPeople, sippFailures, problems };
}
