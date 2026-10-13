/**
 * Status approval request DPL/DPF POA Standarisasi (sumber: Exodus GET promotion/v1/request/discount).
 *
 * Disimpan di PoaStandarisasiDiscountRequest.exodusStatus dan di-refresh LAZY dari
 * Monitoring POA Standarisasi: hanya baris yang belum final (belum Approved/Rejected),
 * satu panggilan Exodus per outlet yang punya request terbuka, throttle 5 menit per pod.
 * Bukan scheduler/panggilan per baris — halaman monitoring company-wide (docs/PERFORMANCE.md).
 */
import { prisma } from "@/lib/prisma";
import { listDiscountRequestsByOutlet, matchDiscountRequest } from "@/lib/exodusApi";

export type DplStatus = "APPROVED" | "PENDING" | "REJECTED";

/** approved/active/done = sudah disetujui (active = DPF berjalan, done = DPL yang periodenya sudah lewat); selain itu masih di jalur approval. */
export function dplStatusOf(exodusStatus: string | null | undefined): DplStatus {
  if (exodusStatus === "approved" || exodusStatus === "active" || exodusStatus === "done") return "APPROVED";
  if (exodusStatus === "rejected") return "REJECTED";
  return "PENDING";
}

const MIN_INTERVAL_MS = 5 * 60_000;
const MAX_OUTLETS_PER_REFRESH = 40;
// ponytail: throttle per pod (in-memory), bukan lintas replica; cukup karena yang dikejar cuma beban Exodus, bukan konsistensi.
let lastRefreshAt = 0;

export interface OpenDiscountRequestRow {
  id: string;
  kodePI: string;
  tipe: string;
  submittedByNip: string;
  submittedAt: Date;
  produk: unknown;
  exodusRefId: string | null;
  exodusStatus: string | null;
}

/** Mengembalikan id -> { exodusRefId, exodusStatus } baru untuk baris yang berubah (sudah ditulis ke DB), supaya pemanggil bisa menimpa data di memorinya. */
export async function refreshOpenDiscountRequests(rows: OpenDiscountRequestRow[]): Promise<Map<string, { exodusRefId: string; exodusStatus: string }>> {
  const updated = new Map<string, { exodusRefId: string; exodusStatus: string }>();
  const open = rows.filter((r) => dplStatusOf(r.exodusStatus) === "PENDING");
  if (open.length === 0 || Date.now() - lastRefreshAt < MIN_INTERVAL_MS) return updated;
  lastRefreshAt = Date.now();

  const byOutlet = new Map<string, OpenDiscountRequestRow[]>();
  for (const r of open) byOutlet.set(r.kodePI, [...(byOutlet.get(r.kodePI) ?? []), r]);

  for (const [kodePI, list] of [...byOutlet].slice(0, MAX_OUTLETS_PER_REFRESH)) {
    let remote;
    try {
      remote = await listDiscountRequestsByOutlet(kodePI);
    } catch {
      continue;
    }
    if (!remote) continue;
    for (const r of list) {
      const hit = r.exodusRefId
        ? remote.find((x) => x.refId === r.exodusRefId)
        : (() => {
            const pcts = ((r.produk as { principalPct?: number }[] | null) ?? []).map((p) => Number(p.principalPct)).filter((n) => Number.isFinite(n));
            if (pcts.length === 0) return undefined;
            return matchDiscountRequest(remote, { discountType: r.tipe, createdBy: r.submittedByNip, sinceMs: r.submittedAt.getTime(), minPct: Math.min(...pcts), maxPct: Math.max(...pcts) }, "earliest");
          })();
      if (!hit) continue;
      if (hit.status !== r.exodusStatus || hit.refId !== r.exodusRefId) {
        await prisma.poaStandarisasiDiscountRequest.update({
          where: { id: r.id },
          data: { exodusRefId: hit.refId, exodusStatus: hit.status, exodusStatusAt: new Date() },
        });
      }
      updated.set(r.id, { exodusRefId: hit.refId, exodusStatus: hit.status });
    }
  }
  return updated;
}
