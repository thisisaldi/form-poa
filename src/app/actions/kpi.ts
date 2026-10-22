"use server";

/**
 * KPI Monitoring (Monitoring KPI Perpanjangan) — see docs/kpi-monitoring/.
 * v1 scope: ADMIN-only listing + manual input for Call Activity, and for
 * Absensi when the SIPP sync (src/lib/sync/kpiAbsensiSync.ts) hasn't already
 * filled it for the period — this module just reads whatever KpiMonthlyEntry
 * has, same code path either way. Contract-evaluation workflow
 * (KpiContractEvaluation) is spec'd but NOT built yet — see
 * docs/kpi-monitoring/03-ui-and-access.md.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { getSubordinateOwnerNips } from "@/lib/authz";
import { runKpiAbsensiSync, type KpiAbsensiSyncResult } from "@/lib/sync/kpiAbsensiSync";
import { runKpiCallActivitySync, type KpiCallActivitySyncResult } from "@/lib/sync/kpiCallActivitySync";
import { CALL_ACTIVITY_STANDARD_BY_ROLE, KPI_WEIGHTS } from "@/lib/kpiScoring";
import { getNonHospitalMonitoringRows } from "@/lib/nonHospitalEvaluation";
import { roleLabel } from "@/components/kpi/kpiUi";
import { addMonths } from "@/lib/nonHospitalScoring";
import { computeKpiRows, type KpiPersonnelRow } from "@/lib/kpiMonitoring";

export type { KpiPersonnelRow } from "@/lib/kpiMonitoring";
import type { Role, User } from "@prisma/client";
import { canUseKpiPersonil, KPI_PERSONIL_DISABLED_MESSAGE } from "@/lib/kpiAccess";

async function requireAdmin() {
  const session = await getCurrentUser();
  if (!session || session.role !== "ADMIN") {
    throw new Error("KPI Monitoring is ADMIN-only for now.");
  }
  return session;
}

// View access (2026-09-28): ADMIN sees everyone; MR/ASM/SM/NSM see themselves
// + their own subtree, same "self and bawahannya" pattern as everywhere else
// in this app (getSubordinateOwnerNips — not a new RBAC concept). Editing
// (manual input, sync) stays ADMIN-only for now, gated separately below.
const KPI_VIEWER_ROLES = ["ADMIN", "MR", "ASM", "SM", "NSM"].filter(canUseKpiPersonil);

async function requireKpiViewer() {
  const session = await getCurrentUser();
  if (!session || !KPI_VIEWER_ROLES.includes(session.role)) {
    throw new Error("KPI Monitoring access denied for this role.");
  }
  return session;
}

/**
 * ADMIN-only listing for /kpi-perpanjangan: one row per active MR/ASM/SM,
 * scored for the given month. Sales Achievement + Customer Expansion are
 * derived live from existing sales/PSSP data (same sources as the Monitoring
 * page); Call Activity/Absensi come from whatever KpiMonthlyEntry a prior
 * saveKpiManualInputAction call left for this nip+period (null if nobody has
 * entered it yet — deliberately NOT defaulted to a band score, so missing
 * manual data reads as "belum diisi", not as a bad score).
 */
export async function getKpiMonitoringData(period: string, opts?: { nips?: string[] }): Promise<KpiPersonnelRow[]> {
  const session = await requireKpiViewer();

  // Non-ADMIN: scope to the viewer's own subtree (self + bawahannya), same
  // pattern as POA visibility (getSubordinateOwnerNips) — not company-wide.
  // An MR sees only themself; ASM/SM/NSM see themself + everyone under them.
  let scopeNips = session.role === "ADMIN"
    ? null
    : await getSubordinateOwnerNips({ nip: session.nip, role: session.role as Role } as User);
  // Optional nip filter (API ?nip=): narrows the personnel query itself, so
  // only those people's numbers get computed. Intersects with the viewer scope
  // — can't reach outside it.
  if (opts?.nips) {
    const wanted = opts.nips;
    scopeNips = scopeNips ? scopeNips.filter((n) => wanted.includes(n)) : wanted;
  }
  return computeKpiRows(period, scopeNips);
}

export type LeaderboardRow = {
  nip: string;
  name: string;
  /** Display role (MR/SPV/ASM/SM) for Hospital; jabatan (PSR/Supervisor/…) for Non-Hospital. */
  role: string;
  /** Hospital: Outlet.namaArea/namaReg of the team; Non-Hospital: namaWilayah (GT). */
  area: string | null;
  /** Rank in the previous month (Hospital only) for the ▲▼ movement; null = not ranked then. */
  prevRank: number | null;
  /** Points per pillar = band score × weight; Non-Hospital shows the total only. */
  pillars: { sales: number; activity: number; customer: number; absensi: number } | null;
  total: number;
};

/**
 * Leaderboard (docs/kpi-monitoring/04-final-layout.md §2): company-wide for ANY
 * logged-in role (decided 2026-10-05), points only — no raw data, no band
 * detail. Only fully-scored personnel are ranked; `unscored` counts the rest.
 * Still on-demand compute (docs/PERFORMANCE.md §5) — same cost as the ADMIN page.
 */
export async function getKpiLeaderboard(scheme: "hospital" | "non-hospital", period: string): Promise<{ rows: LeaderboardRow[]; unscored: number }> {
  const session = await getCurrentUser();
  if (!session) throw new Error("Unauthorized");
  if (!canUseKpiPersonil(session.role)) throw new Error(KPI_PERSONIL_DISABLED_MESSAGE);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("Periode tidak valid");

  let rows: LeaderboardRow[] = [];
  let total = 0;
  if (scheme === "hospital") {
    // Previous month in parallel — only for the ▲▼ movement; costs a second company-wide compute.
    const prevPeriod = addMonths(period, -1);
    const [data, prevData] = await Promise.all([
      computeKpiRows(period, null, { hospitalOnly: true }),
      computeKpiRows(prevPeriod, null, { hospitalOnly: true }),
    ]);
    const prevRank = new Map(
      prevData.filter((r) => r.totalScore != null).sort((a, b) => b.totalScore! - a.totalScore! || a.name.localeCompare(b.name)).map((r, i) => [r.nip, i + 1]),
    );
    total = data.length;
    for (const r of data) {
      if (r.totalScore == null) continue;
      rows.push({
        nip: r.nip, name: r.name, role: roleLabel(r.role, r.jabatan), area: r.area, prevRank: prevRank.get(r.nip) ?? null,
        pillars: {
          sales: r.salesScore! * KPI_WEIGHTS.sales, activity: r.activityScore! * KPI_WEIGHTS.activity,
          customer: r.customerScore * KPI_WEIGHTS.customer, absensi: r.absensiScore! * KPI_WEIGHTS.absensi,
        },
        total: r.totalScore,
      });
    }
  } else {
    const data = await getNonHospitalMonitoringRows(period, { scopeNips: null });
    total = data.length;
    for (const r of data) {
      if (r.totalScore == null) continue;
      rows.push({ nip: r.nip, name: r.name, role: r.jabatan ?? r.role, area: r.gt, prevRank: null, pillars: null, total: r.totalScore });
    }
  }
  rows = rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return { rows, unscored: total - rows.length };
}

/**
 * ADMIN-only: save the manual Call Activity/Absensi inputs for one personil ×
 * month — both can also be filled automatically by their respective syncs
 * (src/lib/sync/kpiCallActivitySync.ts, kpiAbsensiSync.ts). Touching either
 * field here always marks its *Source "MANUAL", so the sync job treats it as
 * an override and skips re-writing it on its next run — "manual wins"
 * contract documented in kpiAbsensiSync.ts, applies the same way to Call
 * Activity since 2026-09-08. Only touches fields that were actually passed
 * (undefined = leave as-is).
 */
export async function saveKpiManualInputAction(input: {
  nip: string;
  period: string;
  callActivityRealisasi?: number | null;
  absensiValue?: number | null;
}) {
  const session = await requireAdmin();

  const user = await prisma.user.findUniqueOrThrow({ where: { nip: input.nip }, select: { role: true } });
  const callActivityStandar = CALL_ACTIVITY_STANDARD_BY_ROLE[user.role] ?? null;
  const now = new Date();

  await prisma.kpiMonthlyEntry.upsert({
    where: { nip_period: { nip: input.nip, period: input.period } },
    create: {
      nip: input.nip,
      period: input.period,
      callActivityRealisasi: input.callActivityRealisasi ?? null,
      callActivityStandar,
      callActivitySource: "MANUAL",
      callActivityInputByNip: input.callActivityRealisasi != null ? session.userId : null,
      callActivityInputAt: input.callActivityRealisasi != null ? now : null,
      absensiValue: input.absensiValue ?? null,
      absensiSource: "MANUAL",
      absensiInputByNip: input.absensiValue != null ? session.userId : null,
      absensiInputAt: input.absensiValue != null ? now : null,
    },
    update: {
      ...(input.callActivityRealisasi !== undefined
        ? {
            callActivityRealisasi: input.callActivityRealisasi,
            callActivityStandar,
            callActivitySource: "MANUAL",
            callActivityInputByNip: session.userId,
            callActivityInputAt: now,
          }
        : {}),
      ...(input.absensiValue !== undefined
        ? {
            absensiValue: input.absensiValue,
            absensiSource: "MANUAL",
            absensiInputByNip: session.userId,
            absensiInputAt: now,
          }
        : {}),
    },
  });

  revalidatePath("/kpi-perpanjangan");
}

/**
 * ADMIN-only, manually triggered: pull this period's Absensi data from SIPP
 * for every active MR/ASM/SM (see src/lib/sync/kpiAbsensiSync.ts). No
 * automatic schedule — nobody asked for "always fresh," and running it
 * on-demand avoids an always-on background job for a feature an ADMIN
 * triggers deliberately before making contract decisions anyway.
 */
export async function syncKpiAbsensiAction(period: string): Promise<KpiAbsensiSyncResult> {
  await requireAdmin();
  const result = await runKpiAbsensiSync(period);
  revalidatePath("/kpi-perpanjangan");
  return result;
}

/**
 * ADMIN-only, manually triggered: pull this period's Call Activity (realized
 * visit count) from Exodus's "Get Count Visit By NIP" endpoint for every
 * active MR/ASM/SM (see src/lib/sync/kpiCallActivitySync.ts). Same
 * manually-triggered, no-schedule pattern as syncKpiAbsensiAction.
 */
export async function syncKpiCallActivityAction(period: string): Promise<KpiCallActivitySyncResult> {
  await requireAdmin();
  const result = await runKpiCallActivitySync(period);
  revalidatePath("/kpi-perpanjangan");
  return result;
}
