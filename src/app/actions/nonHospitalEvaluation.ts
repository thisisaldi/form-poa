"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { runNonHospitalAbsensiSync, type NhAbsensiSyncResult } from "@/lib/sync/nonHospitalAbsensiSync";
import { runNonHospitalScMenangSync, type NhScMenangSyncResult } from "@/lib/sync/nonHospitalScMenangSync";
import { getCurrentUser } from "@/lib/session";
import { assertWritable } from "@/lib/maintenance";
import { getNonHospitalEvalRows, getNonHospitalMonitoringRows, type NhEvalRow, type NhMonitoringRow } from "@/lib/nonHospitalEvaluation";

// v1 access: ADMIN-only (docs/evaluasi-kontrak-non-hospital/03-ui-and-access.md §1).
async function requireAdmin() {
  const session = await getCurrentUser();
  if (!session || session.role !== "ADMIN") throw new Error("Evaluasi Kontrak Non-Hospital is ADMIN-only for now.");
  return session;
}

export async function getNonHospitalEvaluation(akhirPeriod: string): Promise<NhEvalRow[]> {
  await requireAdmin();
  if (!/^\d{4}-\d{2}$/.test(akhirPeriod)) throw new Error("Periode tidak valid");
  return getNonHospitalEvalRows(akhirPeriod);
}

/** Manual monthly input with no automatic source yet: SC Menang and (override of) absensi hari telat. */
export async function saveNonHospitalMonthlyEntryAction(input: {
  nip: string;
  period: string; // YYYY-MM
  scMenang: number | null;
  absensiHariTelat: number | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireAdmin();
  await assertWritable(session.role);
  if (!/^\d{4}-\d{2}$/.test(input.period)) return { ok: false, error: "Periode tidak valid" };
  for (const v of [input.scMenang, input.absensiHariTelat]) {
    if (v != null && (!Number.isInteger(v) || v < 0 || v > 31)) return { ok: false, error: "Nilai harus bilangan bulat 0-31" };
  }
  await prisma.nonHospitalMonthlyEntry.upsert({
    where: { nip_period: { nip: input.nip, period: input.period } },
    create: { nip: input.nip, period: input.period, scMenang: input.scMenang, absensiHariTelat: input.absensiHariTelat, updatedByNip: session.userId },
    update: { scMenang: input.scMenang, absensiHariTelat: input.absensiHariTelat, updatedByNip: session.userId },
  });
  return { ok: true };
}

const VALID_MONTHS = [0, 6, 9, 12]; // OQ: full valid set unconfirmed; prototype only shows these

/**
 * Records a decision (append-only). The score and recommendation are recomputed
 * server-side and frozen into the row — never trusted from the client.
 * DISETUJUI ⇔ decision equals the system recommendation; otherwise DIUBAH,
 * which requires a reason. Development plan is always required (memo §6).
 */
export async function decideNonHospitalEvaluationAction(input: {
  contractId: string;
  decisionMonths: number;
  decisionReason: string;
  developmentPlanNotes: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireAdmin();
  await assertWritable(session.role);

  if (!VALID_MONTHS.includes(input.decisionMonths)) return { ok: false, error: "Pilihan bulan tidak valid" };
  const plan = input.developmentPlanNotes.trim();
  if (!plan) return { ok: false, error: "Rencana pengembangan wajib diisi" };

  const [row] = await getNonHospitalEvalRows("2000-01", input.contractId);
  if (!row) return { ok: false, error: "Kontrak tidak ditemukan" };

  const rec = row.recommendation?.months ?? null;
  const status = rec != null && input.decisionMonths === rec ? "DISETUJUI" : "DIUBAH";
  const reason = input.decisionReason.trim();
  if (status === "DIUBAH" && !reason) {
    return { ok: false, error: rec == null ? "Alasan wajib diisi (skor belum bisa dihitung)" : "Alasan wajib diisi karena berbeda dari rekomendasi sistem" };
  }

  await prisma.kpiNonHospitalEvaluation.create({
    data: {
      nip: row.nip,
      contractId: row.contractId,
      windowMulai: row.window[0] ?? row.akhirKontrak.slice(0, 7),
      windowAkhir: row.window[row.window.length - 1] ?? row.akhirKontrak.slice(0, 7),
      indicators: JSON.parse(JSON.stringify({ indicators: row.indicators, months: row.months, visitTargetPerDay: row.visitTargetPerDay })),
      totalScore: row.totalScore,
      dataNotes: row.notes.length ? row.notes.join("; ") : null,
      systemRecommendationMonths: rec,
      status,
      decisionMonths: input.decisionMonths,
      decisionReason: status === "DIUBAH" ? reason : null,
      developmentPlanNotes: plan,
      decidedByNip: session.userId,
    },
  });
  return { ok: true };
}

/**
 * Monthly monitoring of all OMEGA MR/ASM/SM (no contract needed). ADMIN-only
 * for now, same as the rest of Non-Hospital (03-ui-and-access.md §1).
 */
export async function getNonHospitalMonitoring(period: string, opts?: { nips?: string[] }): Promise<NhMonitoringRow[]> {
  await requireAdmin();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("Periode tidak valid");
  return getNonHospitalMonitoringRows(period, opts);
}

/** ADMIN-only, manually triggered: Absensi (hari telat, SIPP) + SC Menang (approved SC forms vs actual sales) for `period`. */
export async function syncNonHospitalAction(
  period: string
): Promise<{ absensi: NhAbsensiSyncResult; scMenang: NhScMenangSyncResult }> {
  const session = await requireAdmin();
  await assertWritable(session.role);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("Periode tidak valid");
  const absensi = await runNonHospitalAbsensiSync(period);
  const scMenang = await runNonHospitalScMenangSync(period);
  revalidatePath("/evaluasi-kontrak-non-hospital");
  return { absensi, scMenang };
}
