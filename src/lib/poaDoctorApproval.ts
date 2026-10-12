/**
 * Gelombang (batch) approval per dokter — docs/poa-deal-addendum/. Satu dokter (poaId + kodePI + namaCust)
 * bisa punya beberapa gelombang; hanya gelombang TERBESAR yang boleh belum Deal. Gelombang aktif dibaca dari
 * BARIS dokter (PoaLineItem.batch terbesar), bukan dari baris approval, karena PoaDoctorApproval baru dibuat
 * saat submit pertama gelombang itu. Semua aksi yang mengubah approval bekerja pada gelombang aktif.
 */
import { prisma } from "@/lib/prisma";
import type { PoaDoctorApproval } from "@prisma/client";

/** Gelombang aktif dokter ini di POA ini (batch terbesar di baris; 1 bila belum ada baris). */
export async function getActiveBatch(poaId: string, kodePI: string, namaCust: string): Promise<number> {
  const agg = await prisma.poaLineItem.aggregate({ where: { poaId, kodePI, namaCust }, _max: { batch: true } });
  return agg._max.batch ?? 1;
}

/** Approval gelombang tertentu, atau null bila gelombang itu belum pernah di-submit. */
export async function findApprovalByBatch(poaId: string, kodePI: string, namaCust: string, batch: number): Promise<PoaDoctorApproval | null> {
  return prisma.poaDoctorApproval.findUnique({ where: { poaId_kodePI_namaCust_batch: { poaId, kodePI, namaCust, batch } } });
}

/** Approval gelombang aktif, atau null bila gelombang aktif belum pernah di-submit. */
export async function findActiveApproval(poaId: string, kodePI: string, namaCust: string): Promise<PoaDoctorApproval | null> {
  return findApprovalByBatch(poaId, kodePI, namaCust, await getActiveBatch(poaId, kodePI, namaCust));
}
