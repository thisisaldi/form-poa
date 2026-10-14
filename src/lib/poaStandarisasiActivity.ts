/**
 * Riwayat aktivitas POA Standarisasi (PoaStandarisasiActivityLog). Plain module
 * (bukan "use server") supaya bisa dipakai action, halaman, dan route export.
 */
import type { Prisma } from "@prisma/client";

export const ACTIVITY_LABELS: Record<string, string> = {
  DIBUAT: "Pengajuan dibuat",
  DIAJUKAN_ATASAN: "Diajukan ke Approval Atasan",
  APPROVAL_ATASAN: "Approval Atasan",
  GANTI_DOKTER: "Dokter diganti",
  TTD_DOKTER: "Dokter sudah TTD",
  TTD_DOKTER_BATAL: "Centang TTD dokter dibatalkan",
  JADWAL_KFT: "Jadwal Meeting KFT diatur",
  JADWAL_KFT_HAPUS: "Jadwal Meeting KFT dihapus",
  FINALISASI_DIMULAI: "Lanjut ke Finalisasi",
  DOKUMEN_DIUNGGAH: "Dokumen diunggah",
  SUBMIT_FINALISASI: "Finalisasi disubmit",
  SP_NON_SALES_DIAJUKAN: "Permintaan SP Non Sales diajukan",
  MEMO_DIBUAT: "Memo SP Non Sales dibuat",
  MEMO_TTD: "Memo SP Non Sales sudah ditandatangani",
  MEMO_TTD_BATAL: "Centang tanda tangan memo SP Non Sales dibatalkan",
  DPL_DPF_DIKIRIM: "Request DPL/DPF dikirim ke Exodus",
};

/** Tulis satu baris riwayat. `db` = prisma atau tx (supaya ikut transaksi aksi yang sama). */
export async function logPoaStandarisasiActivity(
  db: Pick<Prisma.TransactionClient, "poaStandarisasiActivityLog">,
  e: { pengajuanId: string; action: keyof typeof ACTIVITY_LABELS; actorNip: string; detail?: string | null }
): Promise<void> {
  await db.poaStandarisasiActivityLog.create({
    data: { pengajuanId: e.pengajuanId, action: e.action, actorNip: e.actorNip, detail: e.detail ?? null },
  });
}

export interface ActivityRow {
  id: string;
  action: string;
  label: string;
  detail: string | null;
  actorNama: string;
  /** ISO UTC — format ke WIB di sisi tampil (formatWib). */
  at: string;
}

/**
 * Sheet "Riwayat Aktivitas" untuk export Excel — satu baris per aksi, waktu dalam WIB
 * (teks, bukan serial date, supaya Excel tidak menggeser zona).
 */
export function addActivitySheet(
  wb: import("exceljs").Workbook,
  logs: { pengajuanId: string; action: string; detail: string | null; createdAt: Date; actor: { name: string } }[],
  metaByPengajuanId: Map<string, { namaMr: string; kodeOutlet: string; outlet: string }>
): void {
  const sheet = wb.addWorksheet("Riwayat Aktivitas");
  sheet.columns = [
    { header: "Nama MR", key: "namaMr", width: 24 },
    { header: "Kode Outlet", key: "kodeOutlet", width: 12 },
    { header: "Outlet", key: "outlet", width: 28 },
    { header: "Waktu (WIB)", key: "waktu", width: 26 },
    { header: "Aktivitas", key: "aktivitas", width: 40 },
    { header: "Detail", key: "detail", width: 60 },
    { header: "Dilakukan Oleh", key: "oleh", width: 24 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0063A0" } };
  const kodeOf = (id: string) => metaByPengajuanId.get(id)?.kodeOutlet ?? "";
  const sorted = [...logs].sort(
    (a, b) => kodeOf(a.pengajuanId).localeCompare(kodeOf(b.pengajuanId)) || a.pengajuanId.localeCompare(b.pengajuanId) || a.createdAt.getTime() - b.createdAt.getTime()
  );
  for (const l of sorted) {
    const m = metaByPengajuanId.get(l.pengajuanId);
    sheet.addRow({
      namaMr: m?.namaMr ?? "-",
      kodeOutlet: m?.kodeOutlet ?? "-",
      outlet: m?.outlet ?? "-",
      waktu: `${l.createdAt.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`,
      aktivitas: ACTIVITY_LABELS[l.action] ?? l.action,
      detail: l.detail ?? "",
      oleh: l.actor.name,
    });
  }
  if (sorted.length === 0) sheet.addRow(["(Belum ada aktivitas)"]);
}
