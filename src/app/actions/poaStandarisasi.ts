"use server";

/**
 * POA Standarisasi — server actions. See docs/poa-standarisasi/ for the spec
 * this implements (business rules, data model, role/access). Produk × Outlet
 * sub-form, wizard 5-phase: Planning Standarisasi → Approval Atasan →
 * Approval User/Dokter → Menunggu Meeting KFT → Finalisasi. All estimasi
 * fields are PER BULAN (resolved Q4, docs/poa-standarisasi/01-business-rules.md
 * §7) — never multiplied by periodeBulan here.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { isWriteBlocked, WRITE_BLOCKED_MESSAGE } from "@/lib/maintenance";
import { canCreatePoa, canViewPoaStandarisasi, canEditPoaStandarisasi, canEditPoaStandarisasiStep5, canApprovePoaStandarisasiAtasan, isPoaStandarisasiLevelApprover, canAccessSalesSupportMemo, getSubordinateMRNips, getSubordinateOwnerNips } from "@/lib/authz";
import { PHASES } from "@/lib/poaStandarisasiPhases";
import { POA_STANDARISASI_VIEW_ROLES } from "@/lib/role";
import { APPROVAL_LEVELS, actionableRows, discountApprovalLevel, levelsUpTo, type ApprovalLevel, type ProdukApprovalRow } from "@/lib/discountApprovalLevel";
import { buildSpNonSalesMemoDocx, formatMemoNomor } from "@/lib/spNonSalesMemo";
import { hargaST } from "@/lib/masterData";
import type { Product as ProductLite } from "@/lib/masterData";
import { getDiscountsForOutlet, getLiveProductPricing, getExodusOutletIdByCode, submitDiscountRequest, confirmDiscountRequest, type ExodusDiscountPct } from "@/lib/exodusApi";
import { EXODUS_DISTRIBUTORS, type ExodusDistributorKode } from "@/lib/exodusDistributors";
import { getSurveyRekomendasiInfo, getCustomersByOutlet, getDiskonByOutlet, getDiskonByOutlets } from "@/app/actions/customer";
import { uploadFileToPoaStandarisasiDrive, isGoogleDriveConfigured, describeGoogleDriveConfig } from "@/lib/googleDrive";
import { getAppSetting } from "@/lib/appSettings";
import { settingMessage } from "@/lib/appSettingsRegistry";
import { SALES_TEAM_ROLES } from "@/lib/role";
import { assertHkaGateway } from "@/lib/hkaGateway";
import { dplStatusOf, refreshOpenDiscountRequests, type DplStatus } from "@/lib/discountRequestStatus";
import { logPoaStandarisasiActivity, censorActivityDetail, type ActivityRow, ACTIVITY_LABELS } from "@/lib/poaStandarisasiActivity";
import type { Product as PrismaProduct, Prisma } from "@prisma/client";

async function requireSession() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (await isWriteBlocked(session.role)) throw new Error(WRITE_BLOCKED_MESSAGE);
  return session;
}

/** authz.ts's canX() helpers take a full Prisma `User` row (not SessionData) — same pattern as poa.ts's `actor`. */
async function requireActor() {
  const session = await requireSession();
  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  return { session, actor };
}

/**
 * Production build Next.js MENYAMARKAN pesan dari Error yang di-throw Server
 * Action (client cuma dapat "An error occurred in the Server Components
 * render..." + digest), jadi pesan yang memang ditujukan ke user (validasi,
 * diagnostik Google Drive) tidak pernah sampai. Action yang butuh pesannya
 * kelihatan dibungkus ini: error dikembalikan sebagai nilai `{ error }`.
 * redirect()/notFound() (digest NEXT_*) tetap di-rethrow supaya tidak rusak.
 */
export type ActionResult = { error?: string };
async function runAction(fn: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await fn();
    return {};
  } catch (e) {
    const digest = (e as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_")) throw e;
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan." };
  }
}

/**
 * Pre-check gateway HKA untuk UI (docs/poa-standarisasi-pusat/): server action
 * yang throw dimasking di production, jadi pesan blokir sampai ke user lewat
 * `{ error }` dari sini. Penegakan sesungguhnya tetap di create/savePlanning.
 */
export async function checkHkaGatewayAction(kodePI: string, kodeProdukList: string[]): Promise<ActionResult> {
  return runAction(() => assertHkaGateway(kodePI, kodeProdukList));
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? null : n;
}

/**
 * Snapshot level approval per produk saat pengajuan masuk Fase 2
 * (docs/poa-standarisasi-approval-level/): level dari estimasiDiskonPct (skema
 * DP / kosong = 0% = ASM), satu baris per level ASM..level tertinggi. Dipanggil
 * dari kedua jalur masuk Fase 2 (create langsung + advanceToApprovalAtasanAction).
 */
async function snapshotProdukApprovals(tx: Prisma.TransactionClient, pengajuanId: string): Promise<void> {
  const produk = await tx.poaStandarisasiProduk.findMany({ where: { pengajuanId }, select: { id: true, skemaPembayaran: true, estimasiDiskonPct: true } });
  const data = produk.flatMap((p: (typeof produk)[number]) => {
    const pct = p.skemaPembayaran === "DISKON" ? toNum(p.estimasiDiskonPct) ?? 0 : 0;
    return levelsUpTo(discountApprovalLevel(pct)).map((level) => ({ produkId: p.id, level, diskonPctSnapshot: pct }));
  });
  await tx.poaStandarisasiProdukApproval.createMany({ data, skipDuplicates: true });
}

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * Creates the pengajuan AND saves the full Planning Standarisasi payload in one
 * shot (outlet, KPDM, jabatan, tipe, produk, dokter klinis) — the "new" form is
 * literally the same Planning Standarisasi form as Phase 1 of the wizard, not a
 * separate outlet-only pre-step (2026-08-19 redesign).
 */
export async function createPoaStandarisasiAction(input: PlanningInput & { kodePI: string }): Promise<void> {
  const session = await requireSession();
  // Re-opened to MR 2026-09-10 (user request) — see poa-standarisasi/new/
  // page.tsx's note. Hard gate here too (not just the page), since this
  // action can be called directly.
  if (session.role !== "ADMIN" && session.role !== "MR") redirect("/dashboard");

  const kodePI = input.kodePI.trim();
  if (!kodePI) throw new Error("Outlet wajib dipilih.");

  // Same eligibility as POA Estimasi (MR with an assignment, or ASM/SM/NSM
  // covering a vacant-team outlet) — resolved Q3, docs/poa-standarisasi/01-business-rules.md §7.
  if (!(await canCreatePoa(session.userId))) redirect("/dashboard?error=no_outlets");

  const outlet = await prisma.outlet.findUnique({ where: { kodePI } });
  if (!outlet) throw new Error("Outlet tidak ditemukan.");

  validatePlanningInput(input);
  // The "new" form already collects produk + dokter user (same fields as Phase
  // 1), so a fresh pengajuan created here goes straight to Phase 2 instead of
  // landing back on Phase 1 requiring a second, separate "Lanjut" click.
  validateReadyForApprovalAtasan(input);
  await assertHkaGateway(kodePI, input.produk.map((p) => p.kodeProduk));

  const dplKode = new Set((await getActiveDplByOutletAction(kodePI)).map((d) => d.kodeProduk));
  const pengajuanId = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const pengajuan = await tx.poaStandarisasi.create({
      data: {
        ownerId: session.userId,
        kodePI,
        tipeStandarisasi: input.tipeStandarisasi,
        periodeBulan: input.tipeStandarisasi === "PERMANEN" ? null : toNum(input.periodeBulan),
        jumlahBedRs: toNum(input.jumlahBedRs) ?? outlet.jumlahBed,
        estimasiTimelineSelesai: input.estimasiTimelineSelesai ? new Date(input.estimasiTimelineSelesai) : null,
        currentPhase: "APPROVAL_ATASAN",
      },
    });
    await applyPlanningKpdm(tx, pengajuan.id, input.kpdmList);
    await applyPlanningProduk(tx, pengajuan.id, kodePI, input.produk, dplKode);
    await snapshotProdukApprovals(tx, pengajuan.id);
    await logPoaStandarisasiActivity(tx, { pengajuanId: pengajuan.id, action: "DIBUAT", actorNip: session.userId });
    await logPoaStandarisasiActivity(tx, { pengajuanId: pengajuan.id, action: "DIAJUKAN_ATASAN", actorNip: session.userId });
    return pengajuan.id;
  });

  redirect(`/poa-standarisasi/${pengajuanId}`);
}

// ─── Read ────────────────────────────────────────────────────────────────────

const detailInclude = {
  outlet: true,
  kpdmList: { include: { customer: true }, orderBy: { createdAt: "asc" as const } },
  produk: {
    include: {
      product: true,
      dokterApproval: { include: { customer: true } },
      dokterUser: { include: { customer: true } },
      dokumen: true,
      approvals: true,
    },
    orderBy: { createdAt: "asc" as const },
  },
  spNonSalesDocuments: { include: { uploadedBy: { select: { name: true } } }, orderBy: { uploadedAt: "desc" as const } },
};

type RawDetail = Prisma.PoaStandarisasiGetPayload<{ include: typeof detailInclude }>;

const d = (v: { toString(): string } | null | undefined): number | null => (v == null ? null : parseFloat(v.toString()));

/**
 * Prisma Decimal fields can't cross the Server→Client Component boundary as-is
 * — stringify/numberify everything before returning. `discounts` (live Exodus
 * principal_percentage + distributor_percentage per kodeProduk, see
 * getDiscountsForOutlet) is only a DEFAULT for finalDiscountPct/
 * diskonDistributorPct when the MR hasn't saved a value of their own yet —
 * Finalisasi stays fully editable, nothing here gets locked to the live
 * Exodus number (2026-09-09 user request, reverted the earlier "always
 * override with live value" behavior which silently discarded edits on the
 * next page load).
 */
function serializeDetail(p: RawDetail, discounts: Map<string, ExodusDiscountPct> | null) {
  return {
    ...p,
    outlet: { ...p.outlet },
    kpdmList: p.kpdmList.map((k) => ({
      ...k,
      entertainEstimasi: d(k.entertainEstimasi),
      entertainFinal: d(k.entertainFinal),
    })),
    produk: p.produk.map((prod) => ({
      ...prod,
      estimasiDiskonPct: d(prod.estimasiDiskonPct),
      estimasiDiskonDistributorPct: d(prod.estimasiDiskonDistributorPct),
      estimasiValueDpRp: d(prod.estimasiValueDpRp),
      estimasiBiayaListingRp: d(prod.estimasiBiayaListingRp),
      diskonKompetitorPct: d(prod.diskonKompetitorPct),
      finalDiscountPct: d(prod.finalDiscountPct) ?? discounts?.get(prod.product.kodeProduk)?.principalPct ?? null,
      diskonDistributorPct: d(prod.diskonDistributorPct) ?? discounts?.get(prod.product.kodeProduk)?.distributorPct ?? null,
      finalBiayaListingRp: d(prod.finalBiayaListingRp),
      finalValueDpRp: d(prod.finalValueDpRp),
      spNonSalesJumlahBox: d(prod.spNonSalesJumlahBox),
      product: {
        ...prod.product,
        hna: prod.product.hna.toString(),
        nilaiRPersen: prod.product.nilaiRPersen?.toString() ?? null,
        konversiPembagi: prod.product.konversiPembagi?.toString() ?? null,
        qtyPerRxPasien: prod.product.qtyPerRxPasien?.toString() ?? null,
        jumlahPemberianPerHari: prod.product.jumlahPemberianPerHari?.toString() ?? null,
      },
      dokterApproval: prod.dokterApproval.map((da) => ({
        ...da,
        resepPerPasienSt: d(da.resepPerPasienSt),
        estimasiQtyPerBulan: d(da.estimasiQtyPerBulan),
        estimasiNilaiRpPerBulan: d(da.estimasiNilaiRpPerBulan),
        entertainRp: d(da.entertainRp),
      })),
      dokterUser: prod.dokterUser.map((du) => ({
        ...du,
        resepPerPasienSt: d(du.resepPerPasienSt),
        estimasiQtyPerBulan: d(du.estimasiQtyPerBulan),
        estimasiSalesRpPerBulan: d(du.estimasiSalesRpPerBulan),
        entertainRp: d(du.entertainRp),
      })),
      dokumen: prod.dokumen,
      approvals: prod.approvals.map((a) => ({ ...a, diskonPctSnapshot: d(a.diskonPctSnapshot) })),
    })),
  };
}

export type PoaStandarisasiDetail = ReturnType<typeof serializeDetail>;

export async function getPoaStandarisasiDetail(id: string): Promise<PoaStandarisasiDetail | null> {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });

  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id }, include: detailInclude });
  if (!pengajuan) return null;
  if (!(await canViewPoaStandarisasi(actor, pengajuan))) return null;

  const discounts = await getDiscountsForOutlet(pengajuan.kodePI);
  return serializeDetail(pengajuan, discounts);
}

/**
 * Delete a pengajuan (2026-09-09 user request: "tambahin button hapus juga
 * di page /poa-standarisasi sama kayak yang poa estimasi"). Restricted to
 * Phase 1 (PLANNING) only — same DRAFT-only spirit as POA Estimasi's
 * deletePoaAction (poa.ts), before ASM/SM or any dokter has acted on it.
 * Every child row (produk, dokter, kpdm, dokumen, reassign logs) cascades
 * via `onDelete: Cascade` in schema.prisma — no manual cleanup needed here,
 * unlike PoaForm's separate poaAuditLog table.
 */
export async function deletePoaStandarisasiAction(id: string): Promise<{ error?: string }> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id } });
  if (!pengajuan) return { error: "Pengajuan tidak ditemukan." };
  if (!canEditPoaStandarisasi(actor, pengajuan)) return { error: "Tidak punya akses." };
  if (pengajuan.currentPhase !== "PLANNING") return { error: "Hanya pengajuan di tahap Planning yang bisa dihapus." };

  await prisma.poaStandarisasi.delete({ where: { id } });
  revalidatePath("/poa-standarisasi");
  return {};
}

export interface StandarisasiDashboardOutletRow {
  kodePI: string;
  namaOutlet: string;
  /** Produk yang pengajuannya sudah final submit dan TIDAK ditandai gagal (distinct per produk, submittedAt terbaru). */
  sudah: { kodeProduk: string; namaProduk: string; submittedAt: Date }[];
  /** Produk di pengajuan yang belum final submit — satu baris per (produk, pengajuan). */
  onProgress: { kodeProduk: string; namaProduk: string; phaseLabel: string; pengajuanId: string; ownerNama: string }[];
  /** Jumlah produk distinct yang final submit tapi ditandai gagal standarisasi (dan belum pernah sukses di outlet ini). */
  gagal: number;
  /** Request DPL/DPF yang sudah diajukan ke Exodus untuk outlet ini + status approval-nya (lihat discountRequestStatus.ts). */
  dpl: { id: string; tipe: string; distributorKode: string; status: DplStatus; produk: string[]; submittedAt: Date }[];
  /** Pengajuan di outlet ini (terbaru dulu) — buat tracking tahapan per pengajuan. */
  pengajuan: StandarisasiDashboardPengajuan[];
  /** Aktivitas terakhir dari semua pengajuan outlet ini (null = belum ada log). */
  lastActivityAt: Date | null;
}

export type StandarisasiStepState = "done" | "partial" | "todo";

export interface StandarisasiDashboardPengajuan {
  id: string;
  ownerNama: string;
  createdAt: Date;
  produkCount: number;
  /** Planning → Approval Atasan → Approval Dokter → Finalisasi → SP Non Sales → DPL/DPF. */
  steps: { label: string; state: StandarisasiStepState; at: Date | null }[];
  /** Label step pertama yang belum done, atau "Selesai". */
  stage: string;
  lastActivity: { label: string; actorNama: string; at: Date } | null;
  activityCount: number;
}

/** Urutan tahapan monitoring — juga dipakai ringkasan per tahap di halaman. */
const MONITOR_STEPS = ["Planning", "Approval Atasan", "Approval Dokter", "Finalisasi", "SP Non Sales", "DPL/DPF"] as const;

function buildMonitorSteps(p: {
  currentPhase: string;
  createdAt: Date;
  submittedAt: Date | null;
  spNonSalesSubmittedAt: Date | null;
  spNonSalesSignedAt: Date | null;
  dpl: { status: DplStatus; submittedAt: Date }[];
}): { steps: StandarisasiDashboardPengajuan["steps"]; stage: string } {
  // Fase legacy MENUNGGU_MEETING_KFT (tidak ada di PHASES) setara posisi Approval Dokter.
  const phaseIdx = p.submittedAt ? PHASES.length : Math.max(PHASES.findIndex((ph) => ph.id === p.currentPhase), p.currentPhase === "MENUNGGU_MEETING_KFT" ? 2 : 0);
  const byPhase = (i: number): StandarisasiStepState => (phaseIdx > i ? "done" : "todo");
  const dplFirst = p.dpl.length ? p.dpl.reduce((a, b) => (a.submittedAt < b.submittedAt ? a : b)).submittedAt : null;
  const steps: StandarisasiDashboardPengajuan["steps"] = [
    { label: MONITOR_STEPS[0], state: byPhase(0), at: p.createdAt },
    { label: MONITOR_STEPS[1], state: byPhase(1), at: null },
    { label: MONITOR_STEPS[2], state: byPhase(2), at: null },
    { label: MONITOR_STEPS[3], state: byPhase(3), at: p.submittedAt },
    { label: MONITOR_STEPS[4], state: p.spNonSalesSignedAt ? "done" : p.spNonSalesSubmittedAt ? "partial" : "todo", at: p.spNonSalesSignedAt ?? p.spNonSalesSubmittedAt },
    { label: MONITOR_STEPS[5], state: p.dpl.some((d) => d.status === "APPROVED") ? "done" : p.dpl.length ? "partial" : "todo", at: dplFirst },
  ];
  return { steps, stage: steps.find((s) => s.state !== "done")?.label ?? "Selesai" };
}

/**
 * Monitoring rekap POA Standarisasi per outlet (2026-09-24, user request):
 * berapa dan produk apa saja yang sudah standarisasi, dan mana yang masih on
 * progress. "Sudah" = HANYA dari pengajuan yang final submit di app ini
 * (bukan label import kriteria / DPL aktif — itu butuh panggilan Exodus per
 * outlet, terlalu berat untuk halaman company-wide, lihat docs/PERFORMANCE.md).
 *
 * Scope: ADMIN/GM/SD/SFE/VIEWER company-wide (kecuali pengajuan milik akun
 * dummy, sama seperti getSubordinateMRNips), ASM/SM/NSM = MR di bawah rantainya
 * (BFS ber-cache, bukan rekursi per node), MR = milik sendiri. Satu findMany
 * (nested select) tanpa query di dalam loop; volume kecil (29 pengajuan saat
 * ditulis), jadi tanpa window periode — status "sudah" memang kumulatif.
 */
export async function getStandarisasiDashboardAction(): Promise<{ rows: StandarisasiDashboardOutletRow[]; canOpenDetail: boolean }> {
  const { actor } = await requireActor();
  if (actor.role === "SALES_SUPPORT") throw new Error("Anda tidak berhak mengakses ini.");

  const companyWide = actor.role === "ADMIN" || actor.role === "GM" || actor.role === "SD" || actor.role === "SFE" || actor.role === "VIEWER";
  // owner.role in SALES_TEAM_ROLES (2026-09-30 user request): pengajuan yang
  // dibuat langsung oleh ADMIN (biasa dipakai buat testing di production —
  // lihat 12 baris test yang dihapus hari ini) tidak boleh nyangkut di
  // rollup company-wide ini. Cuma perlu di branch companyWide — branch
  // subtree di bawah sudah otomatis sales-only (getSubordinateMRNips cuma
  // mengembalikan NIP MR).
  const where: Prisma.PoaStandarisasiWhereInput = companyWide
    ? { owner: { isDummy: false, role: { in: [...SALES_TEAM_ROLES] } } }
    : { ownerId: { in: actor.role === "MR" ? [actor.nip] : await getSubordinateMRNips(actor) } };

  const pengajuan = await prisma.poaStandarisasi.findMany({
    where,
    select: {
      id: true, kodePI: true, currentPhase: true, submittedAt: true, createdAt: true, spNonSalesSubmittedAt: true, spNonSalesSignedAt: true,
      outlet: { select: { namaOutlet: true } },
      owner: { select: { name: true } },
      // Cuma log terakhir per pengajuan — riwayat lengkap di-load on demand (getPoaStandarisasiActivityAction).
      activityLogs: { select: { action: true, createdAt: true, actor: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { activityLogs: true } },
      produk: { select: { standarisasiGagal: true, product: { select: { kodeProduk: true, namaProduk: true } } } },
      discountRequests: { select: { id: true, tipe: true, distributorKode: true, produk: true, submittedByNip: true, submittedAt: true, exodusRefId: true, exodusStatus: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Refresh lazy status DPL/DPF dari Exodus (hanya baris yang belum final, throttle) lalu timpa di memori.
  const refreshed = await refreshOpenDiscountRequests(
    pengajuan.flatMap((p: (typeof pengajuan)[number]) => p.discountRequests.map((d: (typeof p.discountRequests)[number]) => ({ ...d, kodePI: p.kodePI })))
  );

  type Acc = { namaOutlet: string; sudah: Map<string, { kodeProduk: string; namaProduk: string; submittedAt: Date }>; onProgress: StandarisasiDashboardOutletRow["onProgress"]; gagal: Set<string>; dpl: StandarisasiDashboardOutletRow["dpl"]; pengajuan: StandarisasiDashboardPengajuan[] };
  const byOutlet = new Map<string, Acc>();
  for (const p of pengajuan) {
    const acc: Acc = byOutlet.get(p.kodePI) ?? { namaOutlet: p.outlet.namaOutlet, sudah: new Map(), onProgress: [], gagal: new Set<string>(), dpl: [], pengajuan: [] };
    byOutlet.set(p.kodePI, acc);
    const ownDpl: StandarisasiDashboardOutletRow["dpl"] = [];
    for (const d of p.discountRequests) {
      const names = ((d.produk as { namaProduk?: string }[] | null) ?? []).map((x) => x.namaProduk ?? "").filter(Boolean);
      ownDpl.push({ id: d.id, tipe: d.tipe, distributorKode: d.distributorKode, status: dplStatusOf(refreshed.get(d.id)?.exodusStatus ?? d.exodusStatus), produk: names, submittedAt: d.submittedAt });
    }
    acc.dpl.push(...ownDpl);
    const last = p.activityLogs[0];
    acc.pengajuan.push({
      id: p.id,
      ownerNama: p.owner.name,
      createdAt: p.createdAt,
      produkCount: p.produk.length,
      ...buildMonitorSteps({ ...p, dpl: ownDpl }),
      lastActivity: last ? { label: ACTIVITY_LABELS[last.action] ?? last.action, actorNama: last.actor.name, at: last.createdAt } : null,
      activityCount: p._count.activityLogs,
    });
    const phaseLabel = PHASES.find((ph) => ph.id === p.currentPhase)?.label ?? p.currentPhase;
    for (const prod of p.produk) {
      const { kodeProduk, namaProduk } = prod.product;
      if (!p.submittedAt) {
        acc.onProgress.push({ kodeProduk, namaProduk, phaseLabel, pengajuanId: p.id, ownerNama: p.owner.name });
      } else if (prod.standarisasiGagal) {
        acc.gagal.add(kodeProduk);
      } else {
        const prev = acc.sudah.get(kodeProduk);
        if (!prev || prev.submittedAt < p.submittedAt) acc.sudah.set(kodeProduk, { kodeProduk, namaProduk, submittedAt: p.submittedAt });
      }
    }
  }

  const rows: StandarisasiDashboardOutletRow[] = [...byOutlet].map(([kodePI, a]) => ({
    kodePI,
    namaOutlet: a.namaOutlet,
    sudah: [...a.sudah.values()].sort((x, y) => x.namaProduk.localeCompare(y.namaProduk, "id")),
    onProgress: a.onProgress.sort((x, y) => x.namaProduk.localeCompare(y.namaProduk, "id")),
    gagal: [...a.gagal].filter((k) => !a.sudah.has(k)).length,
    dpl: a.dpl.sort((x, y) => y.submittedAt.getTime() - x.submittedAt.getTime()),
    pengajuan: a.pengajuan,
    lastActivityAt: a.pengajuan.reduce<Date | null>((m, p) => (p.lastActivity && (!m || p.lastActivity.at > m) ? p.lastActivity.at : m), null),
  }));
  rows.sort((x, y) => (y.sudah.length + y.onProgress.length) - (x.sudah.length + x.onProgress.length) || x.namaOutlet.localeCompare(y.namaOutlet, "id"));

  // Halaman detail wizard cuma untuk ADMIN/MR (lihat [id]/page.tsx) — role lain view-only.
  return { rows, canOpenDetail: actor.role === "ADMIN" || actor.role === "MR" };
}

/**
 * Daftar pengajuan sesuai visibilitas POA PSSP: MR sendiri; ASM/SM/NSM sendiri
 * + bawahan; GM/SD/SFE/VIEWER/ADMIN company-wide (tanpa akun dummy/nonaktif,
 * plus milik sendiri). Satu findMany (owner in [...]) per halaman (skip/take;
 * pageSize null = semua) — jangan ganti jadi resolve approver per baris
 * (docs/PERFORMANCE.md §2 poin 3-4). Scope yang sama dipakai
 * /api/poa-standarisasi/export, jadi export = isi dashboard.
 */
export async function listVisiblePoaStandarisasiAction({ page = 1, pageSize = 25 }: { page?: number; pageSize?: number | null } = {}) {
  const { actor } = await requireActor();
  if (!POA_STANDARISASI_VIEW_ROLES.includes(actor.role)) throw new Error("Anda tidak berhak mengakses ini.");
  const ownerNips = [...new Set([actor.nip, ...(await getSubordinateOwnerNips(actor))])];
  const where = { ownerId: { in: ownerNips } };
  // Hitung ringkasan di DB (bukan dari halaman yang tampil) supaya angkanya tetap total walau dipaginasi.
  const now = new Date();
  const besok = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const [total, aktif, telat] = await Promise.all([
    prisma.poaStandarisasi.count({ where }),
    prisma.poaStandarisasi.count({ where: { ...where, submittedAt: null } }),
    prisma.poaStandarisasi.count({ where: { ...where, submittedAt: null, estimasiTimelineSelesai: { lt: besok } } }),
  ]);
  const totalPages = pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const rows = await prisma.poaStandarisasi.findMany({
    where,
    include: {
      owner: { select: { name: true } },
      outlet: { select: { namaOutlet: true } },
      produk: {
        select: {
          id: true, product: { select: { namaProduk: true } }, standarisasiGagal: true,
          dokterUser: { select: { customer: { select: { namaCustomer: true } } } },
          dokterApproval: { select: { customer: { select: { namaCustomer: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    ...(pageSize ? { skip: (currentPage - 1) * pageSize, take: pageSize } : {}),
  });
  const list = rows.map((p: (typeof rows)[number]) => {
    // Dokter: dokterUser (Finalisasi) kalau ada, fallback dokterApproval (Planning). Unik per nama.
    const finalNames = p.produk.flatMap((x: (typeof p.produk)[number]) => x.dokterUser.map((d: (typeof x.dokterUser)[number]) => d.customer.namaCustomer));
    const planNames = p.produk.flatMap((x: (typeof p.produk)[number]) => x.dokterApproval.map((d: (typeof x.dokterApproval)[number]) => d.customer.namaCustomer));
    const dokter = [...new Set(finalNames.length > 0 ? finalNames : planNames)];
    return {
    ...p,
    dokter,
    ownerName: p.owner.name,
    produk: p.produk.map((prod: (typeof p.produk)[number]) => ({ id: prod.id, namaProduk: prod.product.namaProduk, standarisasiGagal: prod.standarisasiGagal })),
    };
  });
  return { rows: list, total, aktif, telat, page: currentPage, totalPages };
}

export async function listMyPoaStandarisasiAction() {
  const session = await requireSession();
  const rows = await prisma.poaStandarisasi.findMany({
    where: { ownerId: session.userId },
    include: {
      outlet: { select: { namaOutlet: true } },
      produk: {
        select: {
          id: true,
          product: { select: { namaProduk: true } },
          standarisasiGagal: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((p: (typeof rows)[number]) => ({
    ...p,
    produk: p.produk.map((prod: (typeof p.produk)[number]) => ({
      id: prod.id,
      namaProduk: prod.product.namaProduk,
      standarisasiGagal: prod.standarisasiGagal,
    })),
  }));
}

/**
 * POA Standarisasi pengajuan currently sitting in Phase 2 (Approval Atasan)
 * that THIS atasan (ASM/SM/NSM, or ADMIN for testing) can act on right now —
 * dedicated "tampilan atasan" (2026-09-10 user request), separate from the
 * MR-facing wizard at /poa-standarisasi/[id] which stays MR-only.
 *
 * Bounded scan, not company-wide: only pengajuan actively in
 * currentPhase=APPROVAL_ATASAN (a small, naturally-limited set — everything
 * else is either still Planning or already past this phase), so the
 * per-row canApprovePoaStandarisasiAtasan call (itself a couple of extra
 * queries via getPoaStandarisasiApprovers) doesn't hit docs/PERFORMANCE.md's
 * call-in-loop constraint the way an unbounded company-wide scan would.
 */
export async function getPendingPoaStandarisasiForAtasanAction() {
  const { actor } = await requireActor();

  const candidates = await prisma.poaStandarisasi.findMany({
    where: { currentPhase: "APPROVAL_ATASAN" },
    include: {
      owner: { select: { nip: true, name: true } },
      outlet: { select: { namaOutlet: true } },
      produk: { select: { id: true, approvals: { select: { level: true, status: true } } } },
    },
    orderBy: { updatedAt: "asc" },
  });

  const result: (typeof candidates[number] & { pendingLevel: ApprovalLevel })[] = [];
  for (const p of candidates) {
    // Jalur baru (approval level per produk): level pertama yang punya produk
    // menunggu (level di bawahnya sudah disetujui) dan actor adalah approver-nya.
    if (p.produk.some((pr: (typeof p.produk)[number]) => pr.approvals.length > 0)) {
      for (const level of APPROVAL_LEVELS) {
        if (!hasWaitingAtLevel(p.produk, level)) continue;
        if (await isPoaStandarisasiLevelApprover(actor, p, level)) { result.push({ ...p, pendingLevel: level }); break; }
      }
      continue;
    }
    // Sequential chain (ASM -> SM -> NSM): the level still awaiting action is
    // the first one not yet DISETUJUI — same rule approvePoaStandarisasiAtasanAction
    // enforces when advancing to Phase 3.
    const pendingLevel: ApprovalLevel =
      p.statusApprovalAsm !== "DISETUJUI" ? "ASM" : p.statusApprovalSm !== "DISETUJUI" ? "SM" : "NSM";
    if (await canApprovePoaStandarisasiAtasan(actor, p, pendingLevel)) {
      result.push({ ...p, pendingLevel });
    }
  }
  return result;
}

/** "Golongan yang Dipakai Saat Ini" per dokter — resolved Q1, reuses the exact
 * function backing "Produk Kompetitor Utama" in the POA Estimasi form. */
export async function getGolonganSaatIniAction(kodeCustomer: string, kodePI: string, kodeProduk: string) {
  return getSurveyRekomendasiInfo(kodeCustomer, kodePI, kodeProduk);
}

export async function getDokterOptionsAction(kodePI: string) {
  return getCustomersByOutlet(kodePI);
}

/**
 * Live Exodus discount (principal_percentage + distributor_percentage),
 * keyed by kodeProduk, for pre-filling Planning's "Estimasi Diskon (PI)" and
 * "Estimasi Diskon Distributor" so an MR doesn't start from a blank field and
 * can immediately see/adjust the margin math (2026-08-28 user request for PI,
 * extended to distributor 2026-09-07) — same source as Finalisasi's
 * read-only Discount Final / Diskon Distributor (`getDiscountsForOutlet`),
 * but here it's just a DEFAULT: both fields stay editable, the caller only
 * applies this when the row's own value is still empty (never overwrites
 * what the MR already typed/saved).
 */
export async function getEstimasiDiskonPreviewAction(kodePI: string): Promise<Record<string, ExodusDiscountPct>> {
  if (!kodePI) return {};
  const discounts = await getDiscountsForOutlet(kodePI);
  if (!discounts) return {};
  return Object.fromEntries(discounts);
}

/**
 * Baseline for the "estimasi diskon" margin warning (2026-08-28, replaces a
 * flat "diskon% > 20%" cap that compared the NEW discount straight to a
 * constant with no historical basis — user-confirmed correct formula):
 * warn when the NEW proposed discount cost (this outlet+produk's new
 * estimated sales × new diskon%) exceeds the historical margin budget (this
 * outlet+produk's 12-month sales history × 20%, the company's target gross
 * margin). Only returns an entry — i.e. only shows the warning at all — for
 * a kodeProduk that currently HAS a live Exodus discount request; existence
 * is the gate. Since 2026-09-21 the entry also carries that discount's rate
 * (`diskonLamaPct`, PI + distributor) so the Planning UI can compare
 * "sales sebelumnya @ diskon lama" vs "sales baru @ diskon baru".
 */
export interface MarginBaseline {
  /** Total sales 12 bulan terakhir (Rp) produk ini di outlet ini. */
  sales12Bln: number;
  /** Diskon terdahulu (PI + distributor, %) dari request Exodus terbaru. */
  diskonLamaPct: number;
}

export async function getMarginWarningBaselineAction(kodePI: string, kodeProdukList: string[]): Promise<Record<string, MarginBaseline>> {
  if (!kodePI || kodeProdukList.length === 0) return {};
  const discounts = await getDiscountsForOutlet(kodePI);
  if (!discounts) return {};
  const salesRows = await prisma.outletSalesHistory.findMany({
    where: { kodePI, itemKode: { in: kodeProdukList } },
    select: { itemKode: true, totalSales12Bln: true },
  });
  const salesByKode = new Map<string, number>(salesRows.map((r: (typeof salesRows)[number]) => [r.itemKode, parseFloat(r.totalSales12Bln.toString())]));
  const result: Record<string, MarginBaseline> = {};
  for (const kodeProduk of kodeProdukList) {
    const d = discounts.get(kodeProduk);
    if (d) result[kodeProduk] = { sales12Bln: salesByKode.get(kodeProduk) ?? 0, diskonLamaPct: d.principalPct + d.distributorPct };
  }
  return result;
}

export interface StandarisasiDataForDokterProduk {
  jumlahPasien: number | null;
  jumlahHariPraktekPerBulan: number | null;
  resepPerPasienSt: number | null;
}

/**
 * "Tarik Data POA Standarisasi" toggle in POA Estimasi (2026-09-08, atasan
 * redline) — lets an MR pull Pasien Baru/Hari + Jml Produk ST/Pasien Baru
 * straight from a POA Standarisasi Finalisasi row for the SAME outlet +
 * dokter + produk, instead of retyping numbers already entered there. Only
 * returns a match when that pengajuan has actually reached Finalisasi
 * (`currentPhase === "FINALISASI"`, which also covers post-submit/Step 5 —
 * this app never advances currentPhase past FINALISASI) — a match earlier in
 * the flow (still Planning/Approval) isn't final enough to trust yet.
 * "Hari Praktek" (`jumlahHariPraktekPerBulan`) is included since 2026-09-09 —
 * POA Standarisasi didn't have that field yet when this toggle was first
 * built (2026-09-08), so it originally only pulled Pasien/Resep.
 */
export async function getStandarisasiDataForDokterProdukAction(
  kodePI: string,
  kodeCustomer: string,
  kodeProduk: string
): Promise<StandarisasiDataForDokterProduk | null> {
  if (!kodePI || !kodeCustomer || !kodeProduk) return null;
  const row = await prisma.poaStandarisasiDokterUser.findFirst({
    where: {
      customer: { kodeCustomer },
      produk: { kodeProduk, pengajuan: { kodePI, currentPhase: "FINALISASI" } },
    },
    orderBy: { createdAt: "desc" },
    select: { jumlahPasien: true, jumlahHariPraktekPerBulan: true, resepPerPasienSt: true },
  });
  if (!row) return null;
  return {
    jumlahPasien: row.jumlahPasien,
    jumlahHariPraktekPerBulan: row.jumlahHariPraktekPerBulan,
    resepPerPasienSt: row.resepPerPasienSt != null ? parseFloat(row.resepPerPasienSt.toString()) : null,
  };
}

export interface StandarisasiProdukForDokter extends StandarisasiDataForDokterProduk {
  kodeProduk: string;
}

/**
 * Semua produk di POA Standarisasi (Finalisasi) untuk outlet + dokter ini —
 * dipakai toggle "Tarik Data POA Standarisasi" di POA Estimasi buat auto-isi
 * daftar produknya sekaligus (bukan cuma angka per produk yang sudah dipilih
 * manual). Satu baris per produk, pengajuan terbaru menang.
 */
export async function getStandarisasiProdukForDokterAction(kodePI: string, kodeCustomer: string): Promise<StandarisasiProdukForDokter[]> {
  if (!kodePI || !kodeCustomer) return [];
  const rows = await prisma.poaStandarisasiDokterUser.findMany({
    where: { customer: { kodeCustomer }, produk: { pengajuan: { kodePI, currentPhase: "FINALISASI" } } },
    orderBy: { createdAt: "desc" },
    select: { jumlahPasien: true, jumlahHariPraktekPerBulan: true, resepPerPasienSt: true, produk: { select: { kodeProduk: true } } },
  });
  const byKode = new Map<string, StandarisasiProdukForDokter>();
  for (const r of rows) {
    if (byKode.has(r.produk.kodeProduk)) continue;
    byKode.set(r.produk.kodeProduk, {
      kodeProduk: r.produk.kodeProduk,
      jumlahPasien: r.jumlahPasien,
      jumlahHariPraktekPerBulan: r.jumlahHariPraktekPerBulan,
      resepPerPasienSt: r.resepPerPasienSt != null ? parseFloat(r.resepPerPasienSt.toString()) : null,
    });
  }
  return Array.from(byKode.values());
}

/** kodeCustomer dokter di outlet ini yang pernah diestimasi di POA Standarisasi (fase apa pun) — label dropdown customer di POA Estimasi. */
export async function getStandarisasiCustomerKodesByOutletAction(kodePI: string): Promise<string[]> {
  if (!kodePI) return [];
  const rows = await prisma.poaStandarisasiDokterUser.findMany({
    where: { produk: { pengajuan: { kodePI } } },
    select: { customer: { select: { kodeCustomer: true } } },
    distinct: ["customerId"],
  });
  return rows.map((r: (typeof rows)[number]) => r.customer.kodeCustomer).filter(Boolean);
}

/**
 * Kode produk yang sedang dalam proses POA Standarisasi di outlet ini —
 * pengajuan sudah dibuat tapi belum disubmit (`submittedAt` null). Dipakai POA
 * Estimasi buat auto-set Status Standarisasi = "Proses Pengajuan".
 */
export async function getStandarisasiProsesKodeByOutletAction(kodePI: string): Promise<string[]> {
  if (!kodePI) return [];
  const rows = await prisma.poaStandarisasiProduk.findMany({
    where: { pengajuan: { kodePI, submittedAt: null } },
    select: { kodeProduk: true },
    distinct: ["kodeProduk"],
  });
  return rows.map((r: (typeof rows)[number]) => r.kodeProduk);
}

export interface StandarisasiGroupOutletRow {
  kodeProduk: string;
  outlets: { namaOutlet: string; salesAvg3Bulan: number | null; dplPeriode: string | null; dplDiskonPct: number | null }[];
}

function bulanTahunFromYyyymm(yyyymm: string): string {
  const bulan = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const m = parseInt(yyyymm.slice(4, 6), 10);
  return m >= 1 && m <= 12 ? `${bulan[m - 1]} ${yyyymm.slice(0, 4)}` : yyyymm;
}

/**
 * Untuk tiap produk yang sudah standarisasi di outlet LAIN dalam group
 * corporate yang sama (Outlet.groupRS) — daftar outlet + sales rata-rata 3
 * bulan + periode DPL-nya, buat info "RS segrup" di sidebar (Produk
 * Rekomendasi dan Standarisasi & Historis Sales). "Sudah standarisasi" =
 * ada sales (3 bulan penuh terakhir, OutletSalesMonthly) DAN ada DPL aktif
 * bulan berjalan (user 2026-10-01 — sebelumnya OR dari sales/pengajuan/label
 * kriteria/DPL). DPL via getDiskonByOutlets (BATCHED, DB-only — bukan N HTTP
 * call per outlet, larangan docs/PERFORMANCE.md §2.4). "NON CHAIN"/null
 * groupRS bukan group corporate sungguhan → selalu [].
 */
export async function getStandarisasiGroupOutletsAction(kodePI: string): Promise<StandarisasiGroupOutletRow[]> {
  if (!kodePI) return [];
  const outlet = await prisma.outlet.findUnique({ where: { kodePI }, select: { groupRS: true } });
  if (!outlet?.groupRS || outlet.groupRS === "NON CHAIN") return [];

  const siblings = await prisma.outlet.findMany({
    where: { groupRS: outlet.groupRS, kodePI: { not: kodePI } },
    select: { kodePI: true, namaOutlet: true },
  });
  if (siblings.length === 0) return [];
  const siblingKodePI = siblings.map((s: (typeof siblings)[number]) => s.kodePI);
  const namaOutletByKode = new Map<string, string>(siblings.map((s: (typeof siblings)[number]) => [s.kodePI, s.namaOutlet]));

  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const last3Months = [1, 2, 3].map((i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const [sales3BulanRows, dplByOutlet] = await Promise.all([
    // Window 3-bulan-terakhir yang sama dengan getSalesLast3MonthsByOutletAction,
    // tapi batched lintas semua sibling outlet sekaligus (no N+1).
    prisma.outletSalesMonthly.findMany({
      where: { kodePI: { in: siblingKodePI }, periode: { in: last3Months }, qty: { gt: 0 } },
      select: { kodePI: true, itemKode: true, qty: true },
    }),
    getDiskonByOutlets(siblingKodePI),
  ]);

  // qty 3-bulan-terakhir per (kodeProduk, kodePI) -> Rp rata-rata/bulan (hna diambil setelahnya, sekali query).
  const qty3BulanByPair = new Map<string, number>();
  for (const r of sales3BulanRows) {
    const key = `${r.itemKode}|${r.kodePI}`;
    qty3BulanByPair.set(key, (qty3BulanByPair.get(key) ?? 0) + parseFloat(r.qty.toString()));
  }
  const kodeProdukForHna = [...new Set(sales3BulanRows.map((r: (typeof sales3BulanRows)[number]) => r.itemKode))];
  const hnaByKode = new Map<string, number>();
  if (kodeProdukForHna.length > 0) {
    const products = await prisma.product.findMany({ where: { kodeProduk: { in: kodeProdukForHna } }, select: { kodeProduk: true, hna: true } });
    for (const p of products) hnaByKode.set(p.kodeProduk, parseFloat(p.hna.toString()));
  }

  // DPL aktif bulan berjalan per (kodeProduk, kodePI) — kontrak dengan prdAkhir terjauh kalau lebih dari satu.
  const dplByPair = new Map<string, { prdAwal: string; prdAkhir: string; diskonPct: number }>();
  for (const [siblingKodePIVal, contracts] of dplByOutlet) {
    for (const c of contracts) {
      if (!(c.prdAwal <= ym && ym <= c.prdAkhir)) continue;
      const key = `${c.kodeProduk}|${siblingKodePIVal}`;
      if ((dplByPair.get(key)?.prdAkhir ?? "") < c.prdAkhir) dplByPair.set(key, { prdAwal: c.prdAwal, prdAkhir: c.prdAkhir, diskonPct: c.newOnPi });
    }
  }

  // Union sales-only ∪ DPL-only ∪ sales+DPL (2026-10-01 user request: tiap RS
  // segrup ditampilin APAPUN sinyal yang dia punya, bukan cuma yang sudah
  // punya DUA-duanya — field yang gak ada di sibling itu dibiarin null,
  // dirender UI apa adanya (lihat GroupOutlet di RekomendasiSidebar.tsx).
  const allPairKeys = new Set([...qty3BulanByPair.keys(), ...dplByPair.keys()]);
  const byKode = new Map<string, StandarisasiGroupOutletRow["outlets"]>();
  for (const key of allPairKeys) {
    const [kodeProduk, siblingKodePIVal] = key.split("|");
    const qty = qty3BulanByPair.get(key);
    const dpl = dplByPair.get(key);
    const list = byKode.get(kodeProduk) ?? [];
    list.push({
      namaOutlet: namaOutletByKode.get(siblingKodePIVal) ?? siblingKodePIVal,
      salesAvg3Bulan: qty !== undefined ? (qty * (hnaByKode.get(kodeProduk) ?? 0)) / 3 : null,
      dplPeriode: dpl ? `${bulanTahunFromYyyymm(dpl.prdAwal)} – ${bulanTahunFromYyyymm(dpl.prdAkhir)}` : null,
      dplDiskonPct: dpl?.diskonPct ?? null,
    });
    byKode.set(kodeProduk, list);
  }

  // Tambahin sibling yang BELUM punya sinyal apa-apa buat produk ini juga
  // (user 2026-10-01: "dan belum" — mau liat yang belum standarisasi juga,
  // bukan cuma yang udah) — cuma buat produk yang minimal 1 sibling LAIN-nya
  // udah punya sinyal (artinya produk ini relevan buat group ini).
  for (const [, outlets] of byKode) {
    const covered = new Set(outlets.map((o) => o.namaOutlet));
    for (const s of siblings) {
      if (covered.has(s.namaOutlet)) continue;
      outlets.push({ namaOutlet: s.namaOutlet, salesAvg3Bulan: null, dplPeriode: null, dplDiskonPct: null });
    }
  }

  return Array.from(byKode, ([kodeProduk, outlets]) => ({
    kodeProduk,
    // "Sudah" (minimal 1 sinyal) duluan, "belum" (dua-duanya null) belakangan.
    outlets: outlets.sort((a, b) => {
      const aDone = a.salesAvg3Bulan != null || a.dplPeriode != null;
      const bDone = b.salesAvg3Bulan != null || b.dplPeriode != null;
      if (aDone !== bDone) return aDone ? -1 : 1;
      return a.namaOutlet.localeCompare(b.namaOutlet, "id");
    }),
  }));
}

export interface SalesHistoryOutletRow {
  kodeProduk: string;
  namaProduk: string;
  totalSales12Bln: number;
  periodeFrom: string; // YYYYMM
  periodeTo: string; // YYYYMM
}

/**
 * Widget "Historical Sales per Produk/Outlet" di sidebar Planning
 * (2026-09-08, user request) — flat 12-bulan rollup per produk untuk outlet
 * terpilih, sumber sama seperti getMarginWarningBaselineAction/
 * computeStatusPengajuanMap (`OutletSalesHistory`), tapi di sini ditampilkan
 * apa adanya (bukan cuma dipakai buat gate warning/status).
 */
export async function getSalesHistoryByOutletAction(kodePI: string): Promise<SalesHistoryOutletRow[]> {
  if (!kodePI) return [];
  const rows = await prisma.outletSalesHistory.findMany({ where: { kodePI }, orderBy: { totalSales12Bln: "desc" } });
  if (rows.length === 0) return [];
  const products = await prisma.product.findMany({
    where: { kodeProduk: { in: rows.map((r: (typeof rows)[number]) => r.itemKode) } },
    select: { kodeProduk: true, namaProduk: true },
  });
  const namaByKode = new Map(products.map((p: (typeof products)[number]) => [p.kodeProduk, p.namaProduk]));
  return rows.map((r: (typeof rows)[number]) => ({
    kodeProduk: r.itemKode,
    namaProduk: namaByKode.get(r.itemKode) ?? r.itemKode,
    totalSales12Bln: parseFloat(r.totalSales12Bln.toString()),
    periodeFrom: r.periodeFrom,
    periodeTo: r.periodeTo,
  }));
}

// ─── Phase 1: Planning Standarisasi ─────────────────────────────────────────

export interface PlanningDokterKlinisInput {
  customerId: string;
  jumlahPasien: number | string | null;
  jumlahHariPraktekPerBulan: number | string | null;
  resepPerPasienSt: number | string | null;
  entertainRp: number | string | null;
}

export interface PlanningProdukInput {
  id?: string;
  kodeProduk: string;
  skemaPembayaran: "DISKON" | "DP";
  estimasiDiskonPct: number | string | null;
  estimasiDiskonDistributorPct: number | string | null;
  estimasiValueDpRp: number | string | null;
  estimasiBiayaListingRp: number | string | null;
  /** Diskon kompetitor (%). Opsional di tipe supaya simpan draft tetap boleh kosong; wajib saat lanjut ke Approval Atasan. */
  diskonKompetitorPct?: number | string | null;
  dokterKlinis: PlanningDokterKlinisInput[];
}

export interface PlanningKpdmInput {
  customerId: string;
  nama: string;
  jabatan: string | null;
  entertainEstimasi: number | string | null;
}

export interface PlanningInput {
  kpdmList: PlanningKpdmInput[];
  tipeStandarisasi: "PERIODIC" | "SISIPAN" | "PERMANEN";
  periodeBulan: number | string | null;
  jumlahBedRs: number | string | null;
  estimasiTimelineSelesai: string | null; // yyyy-mm-dd
  produk: PlanningProdukInput[];
}

function toProductLite(product: PrismaProduct): ProductLite {
  return {
    kodeProduk: product.kodeProduk,
    namaGroupBrand: product.namaGroupBrand,
    namaProduk: product.namaProduk,
    zatAktif: product.zatAktif,
    satuan: product.satuan,
    hna: product.hna.toString(),
    nilaiRPersen: product.nilaiRPersen?.toString() ?? null,
    satuanTerkecil: product.satuanTerkecil,
    konversiPembagi: product.konversiPembagi?.toString() ?? null,
    dosisKekuatanSediaan: product.dosisKekuatanSediaan,
    qtyPerRxPasien: product.qtyPerRxPasien?.toString() ?? null,
    lamaPemberianHari: product.lamaPemberianHari,
    jumlahPemberianPerHari: product.jumlahPemberianPerHari?.toString() ?? null,
    bentukSediaan: product.bentukSediaan,
    packing: product.packing,
    indikasi: product.indikasi,
    spesialisasiRekomendasi: product.spesialisasiRekomendasi,
  };
}

/**
 * estimasiQty/estimasiNilai are PER BULAN, never multiplied by periodeBulan
 * — resolved Q4. jumlahPasien is PER HARI (label UI "Jumlah Pasien / Hari",
 * 2026-09-09) — jumlahHariPraktekPerBulan is the new multiplier that turns it
 * into a monthly qty, see 01-business-rules.md §3.
 */
async function computeEstimasiPerBulan(
  kodeProduk: string,
  jumlahPasien: number | null,
  jumlahHariPraktekPerBulan: number | null,
  resepPerPasienSt: number | null
) {
  if (!jumlahPasien || !jumlahHariPraktekPerBulan || !resepPerPasienSt) return { estimasiQtyPerBulan: null, estimasiQtyUbPerBulan: null, estimasiNilaiRpPerBulan: null };
  const product = await prisma.product.findUnique({ where: { kodeProduk } });
  if (!product) return { estimasiQtyPerBulan: null, estimasiQtyUbPerBulan: null, estimasiNilaiRpPerBulan: null };
  const hst = hargaST(toProductLite(product));
  const qty = jumlahPasien * jumlahHariPraktekPerBulan * resepPerPasienSt;
  const konversi = Number(product.konversiPembagi ?? 1) || 1;
  return { estimasiQtyPerBulan: qty, estimasiQtyUbPerBulan: Math.ceil(qty / konversi), estimasiNilaiRpPerBulan: Math.round(qty * hst) };
}

/**
 * DPL aktif per produk di outlet ini — periode DPL (prdAwal..prdAkhir,
 * YYYYMM) mencakup bulan berjalan. DPF tidak dihitung (tanpa periode). DPL adalah output standarisasi, jadi ada DPL
 * aktif = salah satu syarat produk sudah standarisasi (bersama sales, 2026-10-01). Sumber sama
 * dengan "% Diskon (DPL/DPF)" di POA Estimasi (getDiskonByOutlet: Exodus live,
 * fallback DiskonKontrak). Detail = prdAkhir terjauh per produk.
 */
export async function getActiveDplByOutletAction(kodePI: string): Promise<{ kodeProduk: string; prdAwal: string; prdAkhir: string; diskonPct: number }[]> {
  if (!kodePI) return [];
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const byKode = new Map<string, { prdAwal: string; prdAkhir: string; diskonPct: number }>();
  for (const c of await getDiskonByOutlet(kodePI)) {
    if (c.prdAwal <= ym && ym <= c.prdAkhir && (byKode.get(c.kodeProduk)?.prdAkhir ?? "") < c.prdAkhir) {
      byKode.set(c.kodeProduk, { prdAwal: c.prdAwal, prdAkhir: c.prdAkhir, diskonPct: c.newOnPi });
    }
  }
  return Array.from(byKode, ([kodeProduk, v]) => ({ kodeProduk, ...v }));
}

/**
 * Sales per produk di outlet ini untuk 3 bulan penuh terakhir (jendela SAMA
 * dengan sinyal sales di computeStatusPengajuanMap, supaya "Sudah ada sales"
 * di sidebar konsisten dengan label Baru/Perpanjangan). Nilai Rp = qty × HNA
 * — konvensi repo (OutletSalesMonthly cuma nyimpen qty, lihat
 * targetCalculation.ts). Cuma produk dengan qty > 0 yang dikembalikan.
 */
export async function getSalesLast3MonthsByOutletAction(kodePI: string): Promise<{ kodeProduk: string; salesRp: number }[]> {
  if (!kodePI) return [];
  const now = new Date();
  const last3Months = [1, 2, 3].map((i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const rows = await prisma.outletSalesMonthly.findMany({
    where: { kodePI, periode: { in: last3Months }, qty: { gt: 0 } },
    select: { itemKode: true, qty: true },
  });
  if (rows.length === 0) return [];
  const qtyByKode = new Map<string, number>();
  for (const r of rows) qtyByKode.set(r.itemKode, (qtyByKode.get(r.itemKode) ?? 0) + parseFloat(r.qty.toString()));
  const products = await prisma.product.findMany({ where: { kodeProduk: { in: [...qtyByKode.keys()] } }, select: { kodeProduk: true, hna: true } });
  const hnaByKode = new Map<string, number>(products.map((p: (typeof products)[number]) => [p.kodeProduk, parseFloat(p.hna.toString())]));
  return [...qtyByKode].map(([kodeProduk, qty]) => ({ kodeProduk, salesRp: qty * (hnaByKode.get(kodeProduk) ?? 0) }));
}

/**
 * Status Pengajuan (Baru/Perpanjangan) — auto-derived per produk×outlet, NOT
 * user-picked (2026-08-27). PERPANJANGAN = produk "sudah standarisasi" = ada
 * sales DAN ada DPL (user 2026-10-01; sebelumnya OR dari sales / pernah submit
 * pengajuan / label kriteria / DPL), keduanya wajib:
 * 1. Ada sales (qty > 0) produk ini di outlet ini dalam 3 bulan kalender
 *    penuh terakhir (OutletSalesMonthly, bulan berjalan tidak dihitung);
 * 2. Ada DPL aktif di bulan berjalan (getActiveDplByOutletAction) — `dplKode`
 *    dari caller, wajib di-fetch SEBELUM $transaction supaya HTTP Exodus tidak
 *    makan timeout tx. DPF tidak dihitung.
 * Selain itu → Baru. `excludePengajuanId` tidak dipakai lagi (pengajuan
 * submit sebelumnya bukan sinyal), parameternya dipertahankan supaya
 * pemanggil tidak berubah. Batched (satu findMany untuk seluruh kodeProduk).
 */
async function computeStatusPengajuanMap(
  client: Prisma.TransactionClient | typeof prisma,
  kodePI: string,
  kodeProdukList: string[],
  _excludePengajuanId?: string,
  dplKode?: Set<string>
): Promise<Map<string, "BARU" | "PERPANJANGAN">> {
  const map = new Map<string, "BARU" | "PERPANJANGAN">(kodeProdukList.map((k) => [k, "BARU"]));
  if (kodeProdukList.length === 0 || !dplKode || dplKode.size === 0) return map;
  const now = new Date();
  const last3Months = [1, 2, 3].map((i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const salesRows = await client.outletSalesMonthly.findMany({
    where: { kodePI, itemKode: { in: kodeProdukList.filter((k) => dplKode.has(k)) }, periode: { in: last3Months }, qty: { gt: 0 } },
    select: { itemKode: true },
  });
  for (const r of salesRows) map.set(r.itemKode, "PERPANJANGAN");
  return map;
}

/** Read-only preview for the Planning UI — same logic as computeStatusPengajuanMap,
 * called live as the MR picks products, before anything is saved. */
export async function getStatusPengajuanPreviewAction(
  kodePI: string,
  kodeProdukList: string[],
  excludePengajuanId?: string
): Promise<Record<string, "BARU" | "PERPANJANGAN">> {
  if (!kodePI || kodeProdukList.length === 0) return {};
  const dplKode = new Set((await getActiveDplByOutletAction(kodePI)).map((d) => d.kodeProduk));
  const map = await computeStatusPengajuanMap(prisma, kodePI, kodeProdukList, excludePengajuanId, dplKode);
  return Object.fromEntries(map);
}

function validatePlanningInput(input: PlanningInput) {
  if ((input.tipeStandarisasi === "PERIODIC" || input.tipeStandarisasi === "SISIPAN") && !toNum(input.periodeBulan)) {
    throw new Error("Periode wajib diisi untuk tipe Periodic/Sisipan.");
  }
  if (input.kpdmList.length === 0) throw new Error("KPDM wajib dipilih minimal 1.");
}

/** Same "ready for Approval Atasan" rule as advanceToApprovalAtasanAction — reused
 * by createPoaStandarisasiAction so a freshly-created pengajuan can skip straight to
 * Phase 2 instead of landing back on Phase 1 requiring a second, separate "Lanjut" click. */
function validateReadyForApprovalAtasan(input: PlanningInput) {
  if (input.produk.length === 0) throw new Error("Tambahkan minimal 1 produk sebelum lanjut.");
  if (input.produk.some((p) => p.dokterKlinis.length === 0)) {
    throw new Error("Setiap produk wajib punya minimal 1 dokter user.");
  }
  if (input.produk.some((p) => toNum(p.diskonKompetitorPct) === null)) {
    throw new Error("Diskon kompetitor wajib diisi untuk setiap produk.");
  }
}

/** Upserts KPDM rows for a pengajuan (can be more than one per outlet) — same
 * add/update/remove-by-diff pattern as applyPlanningProduk's dokter loop. */
async function applyPlanningKpdm(tx: Prisma.TransactionClient, pengajuanId: string, kpdmList: PlanningKpdmInput[]) {
  const existing = await tx.poaStandarisasiKpdm.findMany({ where: { pengajuanId }, select: { customerId: true } });
  const existingSet = new Set(existing.map((k) => k.customerId));
  const wantSet = new Set(kpdmList.map((k) => k.customerId));

  const toRemove = [...existingSet].filter((cid) => !wantSet.has(cid));
  if (toRemove.length > 0) {
    await tx.poaStandarisasiKpdm.deleteMany({ where: { pengajuanId, customerId: { in: toRemove } } });
  }

  for (const k of kpdmList) {
    const data = {
      namaSnapshot: k.nama,
      jabatanSnapshot: k.jabatan,
      entertainEstimasi: toNum(k.entertainEstimasi),
    };
    if (existingSet.has(k.customerId)) {
      await tx.poaStandarisasiKpdm.updateMany({ where: { pengajuanId, customerId: k.customerId }, data });
    } else {
      await tx.poaStandarisasiKpdm.create({ data: { ...data, pengajuanId, customerId: k.customerId } });
    }
  }
}

/** Upserts produk + per-dokter estimasi rows for a pengajuan — shared between
 * savePlanningAction (existing pengajuan, may delete removed produk) and
 * createPoaStandarisasiAction (freshly created pengajuan, produk are all new). */
async function applyPlanningProduk(tx: Prisma.TransactionClient, pengajuanId: string, kodePI: string, produk: PlanningProdukInput[], dplKode: Set<string>) {
  const statusMap = await computeStatusPengajuanMap(tx, kodePI, produk.map((p) => p.kodeProduk), pengajuanId, dplKode);

  for (const p of produk) {
    const data = {
      kodeProduk: p.kodeProduk,
      statusPengajuan: statusMap.get(p.kodeProduk) ?? "BARU",
      skemaPembayaran: p.skemaPembayaran,
      estimasiDiskonPct: toNum(p.estimasiDiskonPct),
      estimasiDiskonDistributorPct: toNum(p.estimasiDiskonDistributorPct),
      estimasiValueDpRp: toNum(p.estimasiValueDpRp),
      estimasiBiayaListingRp: toNum(p.estimasiBiayaListingRp),
      diskonKompetitorPct: toNum(p.diskonKompetitorPct),
    };

    const produkRow = p.id
      ? await tx.poaStandarisasiProduk.update({ where: { id: p.id }, data })
      : await tx.poaStandarisasiProduk.create({ data: { ...data, pengajuanId } });

    const existingDokter = await tx.poaStandarisasiDokterApproval.findMany({ where: { produkId: produkRow.id }, select: { customerId: true } });
    const existingSet = new Set(existingDokter.map((d) => d.customerId));
    const wantSet = new Set(p.dokterKlinis.map((dk) => dk.customerId));

    const toRemove = [...existingSet].filter((cid) => !wantSet.has(cid));
    if (toRemove.length > 0) {
      await tx.poaStandarisasiDokterApproval.deleteMany({ where: { produkId: produkRow.id, customerId: { in: toRemove } } });
    }

    for (const dk of p.dokterKlinis) {
      const jumlahPasien = toNum(dk.jumlahPasien);
      const jumlahHariPraktekPerBulan = toNum(dk.jumlahHariPraktekPerBulan);
      const resepPerPasienSt = toNum(dk.resepPerPasienSt);
      const { estimasiQtyPerBulan, estimasiQtyUbPerBulan, estimasiNilaiRpPerBulan } = await computeEstimasiPerBulan(p.kodeProduk, jumlahPasien, jumlahHariPraktekPerBulan, resepPerPasienSt);
      const dokterData = {
        jumlahPasien: jumlahPasien != null ? Math.round(jumlahPasien) : null,
        jumlahHariPraktekPerBulan: jumlahHariPraktekPerBulan != null ? Math.round(jumlahHariPraktekPerBulan) : null,
        resepPerPasienSt,
        estimasiQtyPerBulan,
        estimasiQtyUbPerBulan,
        estimasiNilaiRpPerBulan,
        entertainRp: toNum(dk.entertainRp),
      };

      if (existingSet.has(dk.customerId)) {
        await tx.poaStandarisasiDokterApproval.updateMany({ where: { produkId: produkRow.id, customerId: dk.customerId }, data: dokterData });
      } else {
        await tx.poaStandarisasiDokterApproval.create({ data: { ...dokterData, produkId: produkRow.id, customerId: dk.customerId, wajib: true } });
      }
    }
  }
}

export async function savePlanningAction(id: string, input: PlanningInput): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");

  validatePlanningInput(input);

  // Gateway HKA hanya untuk produk yang belum tersimpan di pengajuan ini (baru/diganti) — yang sudah ada tidak dicek ulang.
  const savedKode = new Set((await prisma.poaStandarisasiProduk.findMany({ where: { pengajuanId: id }, select: { kodeProduk: true } })).map((p: { kodeProduk: string }) => p.kodeProduk));
  await assertHkaGateway(pengajuan.kodePI, input.produk.map((p) => p.kodeProduk).filter((k) => !savedKode.has(k)));

  const dplKode = new Set((await getActiveDplByOutletAction(pengajuan.kodePI)).map((d) => d.kodeProduk));
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.poaStandarisasi.update({
      where: { id },
      data: {
        tipeStandarisasi: input.tipeStandarisasi,
        periodeBulan: input.tipeStandarisasi === "PERMANEN" ? null : toNum(input.periodeBulan),
        jumlahBedRs: toNum(input.jumlahBedRs),
        estimasiTimelineSelesai: input.estimasiTimelineSelesai ? new Date(input.estimasiTimelineSelesai) : null,
      },
    });

    await applyPlanningKpdm(tx, id, input.kpdmList);

    const existingProduk = await tx.poaStandarisasiProduk.findMany({ where: { pengajuanId: id }, select: { id: true } });
    const keepIds = new Set(input.produk.filter((p) => p.id).map((p) => p.id!));
    const toDelete = existingProduk.filter((p) => !keepIds.has(p.id)).map((p) => p.id);
    if (toDelete.length > 0) {
      await tx.poaStandarisasiProduk.deleteMany({ where: { id: { in: toDelete } } });
    }

    await applyPlanningProduk(tx, id, pengajuan.kodePI, input.produk, dplKode);
  });

  revalidatePath(`/poa-standarisasi/${id}`);
}

/** Phase 1 → Phase 2. Requires at least one produk, each with at least one dokter. */
export async function advanceToApprovalAtasanAction(id: string): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id }, include: { produk: { include: { dokterApproval: true } } } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (pengajuan.currentPhase !== "PLANNING") throw new Error("Pengajuan sudah melewati fase Planning.");
  if (pengajuan.produk.length === 0) throw new Error("Tambahkan minimal 1 produk sebelum lanjut.");
  if (pengajuan.produk.some((p: (typeof pengajuan.produk)[number]) => p.dokterApproval.length === 0)) {
    throw new Error("Setiap produk wajib punya minimal 1 dokter user.");
  }
  if (pengajuan.produk.some((p: (typeof pengajuan.produk)[number]) => p.diskonKompetitorPct === null)) {
    throw new Error("Diskon kompetitor wajib diisi untuk setiap produk.");
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.poaStandarisasi.update({ where: { id }, data: { currentPhase: "APPROVAL_ATASAN" } });
    await snapshotProdukApprovals(tx, id);
    await logPoaStandarisasiActivity(tx, { pengajuanId: id, action: "DIAJUKAN_ATASAN", actorNip: actor.nip });
  });
  revalidatePath(`/poa-standarisasi/${id}`);
}

/**
 * Revisi setelah ditolak (2026-10-16): pengajuan yang ditolak di Approval Atasan
 * (level mana pun, produk mana pun) dikembalikan ke PLANNING supaya pemilik bisa
 * mengedit/menghapusnya, lalu mengajukan ulang. Approval yang sudah ada dihapus
 * semuanya (jalur per produk: baris ProdukApproval — dibuat ulang saat diajukan lagi
 * dengan level dari diskon terbaru; jalur lama: kolom status header di-reset),
 * jadi ASM/SM/NSM menilai ulang dari awal. Riwayat penolakan tetap ada di log aktivitas.
 */
export async function reopenPlanningAfterRejectAction(id: string): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (pengajuan.currentPhase !== "APPROVAL_ATASAN") throw new Error("Pengajuan tidak sedang di fase Approval Atasan.");

  const ditolakPerProduk = await prisma.poaStandarisasiProdukApproval.count({ where: { produk: { pengajuanId: id }, status: "DITOLAK" } });
  const ditolakLegacy = [pengajuan.statusApprovalAsm, pengajuan.statusApprovalSm, pengajuan.statusApprovalNsm].includes("DITOLAK");
  if (ditolakPerProduk === 0 && !ditolakLegacy) throw new Error("Pengajuan ini belum ditolak, tidak perlu direvisi.");

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.poaStandarisasiProdukApproval.deleteMany({ where: { produk: { pengajuanId: id } } });
    await tx.poaStandarisasi.update({
      where: { id },
      data: {
        currentPhase: "PLANNING",
        statusApprovalAsm: "MENUNGGU", tanggalApprovalAsm: null,
        statusApprovalSm: "MENUNGGU", tanggalApprovalSm: null,
        statusApprovalNsm: "MENUNGGU", tanggalApprovalNsm: null,
      },
    });
    await logPoaStandarisasiActivity(tx, { pengajuanId: id, action: "DIKEMBALIKAN_REVISI", actorNip: actor.nip });
  });
  revalidatePath(`/poa-standarisasi/${id}`);
  revalidatePath("/poa-standarisasi");
}

// ─── Phase 2: Approval Atasan (blocking, sequential ASM → SM → NSM) ────────

function hasWaitingAtLevel(produk: { id: string; approvals: { level: ApprovalLevel; status: string }[] }[], level: ApprovalLevel): boolean {
  return actionableRows(produk.flatMap((p) => p.approvals.map((a) => ({ produkId: p.id, ...a }))), level).length > 0;
}

/**
 * Approve/tolak di `level`. Pengajuan dengan baris PoaStandarisasiProdukApproval
 * (jalur baru, level dinamis per produk): berlaku ke produk di level itu yang
 * sedang menunggu — semua, atau hanya `produkIds`. Pengajuan lama tanpa baris:
 * jalur statis ASM -> SM -> NSM di kolom header, seperti sebelumnya.
 */
export async function approvePoaStandarisasiAtasanAction(
  id: string,
  level: ApprovalLevel,
  decision: "DISETUJUI" | "DITOLAK",
  produkIds?: string[]
): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (pengajuan.currentPhase !== "APPROVAL_ATASAN") throw new Error("Pengajuan tidak sedang di fase Approval Atasan.");

  const rows: ProdukApprovalRow[] = await prisma.poaStandarisasiProdukApproval.findMany({
    where: { produk: { pengajuanId: id } },
    select: { produkId: true, level: true, status: true },
  });

  if (rows.length === 0) {
    if (level === "ASD" || level === "SD") throw new Error("Level ini tidak berlaku untuk pengajuan ini.");
    await approveLegacyLevel(actor, pengajuan, level, decision);
    revalidatePath(`/poa-standarisasi/${id}`);
    return;
  }

  if (!(await isPoaStandarisasiLevelApprover(actor, pengajuan, level))) throw new Error("Anda tidak berhak melakukan approval di level ini.");
  const targets = actionableRows(rows, level).filter((r) => !produkIds || produkIds.includes(r.produkId));
  if (targets.length === 0) throw new Error("Tidak ada produk yang menunggu persetujuan Anda di level ini.");

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // status: MENUNGGU di where = idempotent kalau dua klik/approver bersamaan.
    const { count } = await tx.poaStandarisasiProdukApproval.updateMany({
      where: { produkId: { in: targets.map((t) => t.produkId) }, level, status: "MENUNGGU" },
      data: { status: decision, decidedByNip: actor.nip, decidedAt: new Date() },
    });
    if (count > 0) {
      const produk = await tx.poaStandarisasiProduk.findMany({
        where: { id: { in: targets.map((t) => t.produkId) } },
        select: { product: { select: { namaProduk: true } } },
      });
      await logPoaStandarisasiActivity(tx, {
        pengajuanId: id, action: "APPROVAL_ATASAN", actorNip: actor.nip,
        detail: `${level} — ${decision === "DISETUJUI" ? "Disetujui" : "Ditolak"} — ${produk.map((p: (typeof produk)[number]) => p.product.namaProduk).join(", ")}`,
      });
    }
    const remaining = await tx.poaStandarisasiProdukApproval.count({ where: { produk: { pengajuanId: id }, status: { not: "DISETUJUI" } } });
    if (remaining === 0) await tx.poaStandarisasi.update({ where: { id }, data: { currentPhase: "APPROVAL_USER_DOKTER" } });
  });

  revalidatePath(`/poa-standarisasi/${id}`);
}

async function approveLegacyLevel(
  actor: Awaited<ReturnType<typeof requireActor>>["actor"],
  pengajuan: NonNullable<Awaited<ReturnType<typeof prisma.poaStandarisasi.findUnique>>>,
  level: "ASM" | "SM" | "NSM",
  decision: "DISETUJUI" | "DITOLAK"
): Promise<void> {
  if (!(await canApprovePoaStandarisasiAtasan(actor, pengajuan, level))) {
    throw new Error("Anda tidak berhak melakukan approval di level ini.");
  }

  const data =
    level === "ASM"
      ? { statusApprovalAsm: decision, tanggalApprovalAsm: new Date() }
      : level === "SM"
      ? { statusApprovalSm: decision, tanggalApprovalSm: new Date() }
      : { statusApprovalNsm: decision, tanggalApprovalNsm: new Date() };

  const updated = await prisma.poaStandarisasi.update({ where: { id: pengajuan.id }, data });
  await logPoaStandarisasiActivity(prisma, {
    pengajuanId: pengajuan.id, action: "APPROVAL_ATASAN", actorNip: actor.nip,
    detail: `${level} — ${decision === "DISETUJUI" ? "Disetujui" : "Ditolak"}`,
  });

  // Blocking, sequential: only advance to Phase 3 once ALL THREE are DISETUJUI.
  if (updated.statusApprovalAsm === "DISETUJUI" && updated.statusApprovalSm === "DISETUJUI" && updated.statusApprovalNsm === "DISETUJUI") {
    await prisma.poaStandarisasi.update({ where: { id: pengajuan.id }, data: { currentPhase: "APPROVAL_USER_DOKTER" } });
  }
}

// ─── Phase 3: Approval User/Dokter ──────────────────────────────────────────
// "Sudah TTD" adalah checkbox manual (setDokterTtdAction) — sempat diganti
// upload-derived 2026-08-26 (docs/TODO.md #8/#14), dibalikin lagi ke checkbox
// karena upload Google Drive-nya bermasalah di staging. Dokter di list ini
// juga bisa ditambah/dihapus di fase ini (bukan cuma fixed dari Planning).

/** Adds a dokter to a produk's Approval User/Dokter checklist — lets an
 * atasan/MR change who needs to sign after Planning, not just what was
 * picked there. Customer must already be a real row (materialize "nexus:"
 * ids via createCustomerAction client-side first, same pattern as Planning). */
export async function addDokterApprovalAction(produkId: string, customerId: string): Promise<void> {
  const { actor } = await requireActor();
  const produk = await prisma.poaStandarisasiProduk.findUnique({ where: { id: produkId }, include: { pengajuan: true } });
  if (!produk) throw new Error("Produk tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, produk.pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (produk.pengajuan.currentPhase !== "APPROVAL_USER_DOKTER") throw new Error("Pengajuan tidak sedang di fase ini.");

  await prisma.poaStandarisasiDokterApproval.upsert({
    where: { produkId_customerId: { produkId, customerId } },
    update: {},
    create: { produkId, customerId, wajib: true },
  });
  revalidatePath(`/poa-standarisasi/${produk.pengajuanId}`);
}

export async function removeDokterApprovalAction(produkId: string, customerId: string): Promise<void> {
  const { actor } = await requireActor();
  const produk = await prisma.poaStandarisasiProduk.findUnique({ where: { id: produkId }, include: { pengajuan: true } });
  if (!produk) throw new Error("Produk tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, produk.pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (produk.pengajuan.currentPhase !== "APPROVAL_USER_DOKTER") throw new Error("Pengajuan tidak sedang di fase ini.");

  await prisma.poaStandarisasiDokterApproval.deleteMany({ where: { produkId, customerId } });
  revalidatePath(`/poa-standarisasi/${produk.pengajuanId}`);
}

/**
 * "Ganti Dokter" di Approval User/Dokter — remove lama + add baru dalam satu
 * transaksi, PLUS wajib alasan (2026-09-08, user request: mandatory reason
 * box saat re-assign dokter user di level approval ini) yang dicatat ke
 * PoaStandarisasiDokterReassignLog buat audit trail (siapa ganti siapa,
 * kapan, kenapa). `reason` divalidasi non-kosong di server juga — jangan
 * cuma percaya validasi client.
 */
export async function reassignDokterApprovalAction(produkId: string, oldCustomerId: string, newCustomerId: string, reason: string): Promise<void> {
  const { actor } = await requireActor();
  if (!reason.trim()) throw new Error("Alasan wajib diisi.");
  const produk = await prisma.poaStandarisasiProduk.findUnique({ where: { id: produkId }, include: { pengajuan: true } });
  if (!produk) throw new Error("Produk tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, produk.pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (produk.pengajuan.currentPhase !== "APPROVAL_USER_DOKTER") throw new Error("Pengajuan tidak sedang di fase ini.");

  const [oldCustomer, newCustomer] = await Promise.all([
    prisma.customer.findUnique({ where: { id: oldCustomerId }, select: { namaCustomer: true } }),
    prisma.customer.findUnique({ where: { id: newCustomerId }, select: { namaCustomer: true } }),
  ]);
  if (!oldCustomer || !newCustomer) throw new Error("Dokter tidak ditemukan.");

  await prisma.$transaction([
    prisma.poaStandarisasiDokterApproval.deleteMany({ where: { produkId, customerId: oldCustomerId } }),
    prisma.poaStandarisasiDokterApproval.upsert({
      where: { produkId_customerId: { produkId, customerId: newCustomerId } },
      update: {},
      create: { produkId, customerId: newCustomerId, wajib: true },
    }),
    prisma.poaStandarisasiDokterReassignLog.create({
      data: {
        produkId,
        oldCustomerId,
        oldNamaSnapshot: oldCustomer.namaCustomer,
        newCustomerId,
        newNamaSnapshot: newCustomer.namaCustomer,
        reason: reason.trim(),
        actorNip: actor.nip,
      },
    }),
    prisma.poaStandarisasiActivityLog.create({
      data: {
        pengajuanId: produk.pengajuanId, action: "GANTI_DOKTER", actorNip: actor.nip,
        detail: `${oldCustomer.namaCustomer} → ${newCustomer.namaCustomer} (${reason.trim()})`,
      },
    }),
  ]);
  revalidatePath(`/poa-standarisasi/${produk.pengajuanId}`);
}

/** Toggles "Sudah TTD" manually — checkbox, not upload-derived anymore
 * (docs batch standarisasi #11, reverts docs/TODO.md #8/#14 2026-08-26). */
export async function setDokterTtdAction(produkId: string, customerId: string, sudahTtd: boolean): Promise<void> {
  const { actor } = await requireActor();
  const produk = await prisma.poaStandarisasiProduk.findUnique({ where: { id: produkId }, include: { pengajuan: true } });
  if (!produk) throw new Error("Produk tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, produk.pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (produk.pengajuan.currentPhase !== "APPROVAL_USER_DOKTER") throw new Error("Pengajuan tidak sedang di fase ini.");

  const current = await prisma.poaStandarisasiDokterApproval.findUnique({
    where: { produkId_customerId: { produkId, customerId } },
    select: { sudahTtd: true, customer: { select: { namaCustomer: true } } },
  });
  await prisma.poaStandarisasiDokterApproval.updateMany({ where: { produkId, customerId }, data: { sudahTtd } });
  if (current && current.sudahTtd !== sudahTtd) {
    const prod = await prisma.poaStandarisasiProduk.findUnique({ where: { id: produkId }, select: { product: { select: { namaProduk: true } } } });
    await logPoaStandarisasiActivity(prisma, {
      pengajuanId: produk.pengajuanId, action: sudahTtd ? "TTD_DOKTER" : "TTD_DOKTER_BATAL", actorNip: actor.nip,
      detail: `${current.customer.namaCustomer} — ${prod?.product.namaProduk ?? ""}`,
    });
  }
  revalidatePath(`/poa-standarisasi/${produk.pengajuanId}`);
}

/**
 * "Jadwal Meeting KFT" — sekarang cuma satu field optional di card kecil
 * sidebar Approval User/Dokter (2026-09-08, redline kedua user: bukan phase
 * terpisah lagi, lihat advanceToFinalisasiAction di bawah). Phase-agnostic
 * (tidak gate ke currentPhase tertentu) — sama seperti field lain yang boleh
 * diedit kapan saja pengajuan masih editable, bukan cuma di satu step.
 */
export async function saveJadwalMeetingKftAction(id: string, jadwalMeetingKft: string | null): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");

  await prisma.poaStandarisasi.update({
    where: { id },
    data: { jadwalMeetingKft: jadwalMeetingKft ? new Date(jadwalMeetingKft) : null },
  });
  const sebelum = pengajuan.jadwalMeetingKft?.getTime() ?? null;
  const sesudah = jadwalMeetingKft ? new Date(jadwalMeetingKft).getTime() : null;
  if (sebelum !== sesudah) {
    await logPoaStandarisasiActivity(prisma, {
      pengajuanId: id, actorNip: actor.nip,
      action: sesudah ? "JADWAL_KFT" : "JADWAL_KFT_HAPUS",
      detail: sesudah ? new Date(sesudah).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "long", year: "numeric" }) : null,
    });
  }
  revalidatePath(`/poa-standarisasi/${id}`);
}

/**
 * Phase 3 → Phase 5, langsung (2026-09-08, user request: hapus "Menunggu
 * Meeting KFT" dari flow — was Phase 3 → Phase 4 → Phase 5, dua actions
 * terpisah, digabung jadi satu di sini). Requires "Sudah TTD" dicentang untuk
 * setiap dokter WAJIB di setiap produk, sama seperti sebelumnya. Enum
 * PoaStandarisasiPhase.MENUNGGU_MEETING_KFT tetap ada di schema (data
 * historis), tapi tidak pernah di-set lagi mulai sekarang.
 */
export async function advanceToFinalisasiAction(id: string): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({
    where: { id },
    include: { produk: { include: { dokterApproval: true } } },
  });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (pengajuan.currentPhase !== "APPROVAL_USER_DOKTER") throw new Error("Pengajuan tidak sedang di fase Approval User/Dokter.");
  const belumTtd = pengajuan.produk.some((p: (typeof pengajuan.produk)[number]) =>
    p.dokterApproval.some((d: (typeof p.dokterApproval)[number]) => d.wajib && !d.sudahTtd)
  );
  if (belumTtd) throw new Error("Centang Sudah TTD untuk semua dokter wajib sebelum lanjut.");

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Seed PoaStandarisasiDokterUser from every sudahTtd dokter in Phase 3
    // (docs/poa-standarisasi/02-data-model.md — "defaultnya di-seed dari
    // dokter yang sudah TTD di Phase 3") — was never actually done, leaving
    // Finalisasi's dokter list permanently empty. skipDuplicates makes this
    // safe to re-run if the pengajuan ever revisits this transition.
    // 2026-09-08 bug fix: seed dulu cuma copy {produkId, customerId} — angka
    // (jumlahPasien/resepPerPasienSt/estimasi*/entertainRp) dibiarkan null,
    // jadi Finalisasi tampil 0 padahal sudah diisi di Planning. Sekarang
    // seed langsung bawa angka Planning-nya juga, sama seperti pola diskon
    // (finalDiscountPct dst. default dari estimasiDiskonPct).
    for (const p of pengajuan.produk) {
      const ttdDokter = p.dokterApproval.filter((d: (typeof p.dokterApproval)[number]) => d.sudahTtd);
      if (ttdDokter.length === 0) continue;
      await tx.poaStandarisasiDokterUser.createMany({
        data: ttdDokter.map((d: (typeof p.dokterApproval)[number]) => ({
          produkId: p.id,
          customerId: d.customerId,
          jumlahPasien: d.jumlahPasien,
          jumlahHariPraktekPerBulan: d.jumlahHariPraktekPerBulan,
          resepPerPasienSt: d.resepPerPasienSt,
          estimasiQtyPerBulan: d.estimasiQtyPerBulan,
          estimasiQtyUbPerBulan: d.estimasiQtyUbPerBulan,
          estimasiSalesRpPerBulan: d.estimasiNilaiRpPerBulan,
          entertainRp: d.entertainRp,
        })),
        skipDuplicates: true,
      });
    }
    await tx.poaStandarisasi.update({ where: { id }, data: { currentPhase: "FINALISASI" } });
    await logPoaStandarisasiActivity(tx, { pengajuanId: id, action: "FINALISASI_DIMULAI", actorNip: actor.nip });
  });
  revalidatePath(`/poa-standarisasi/${id}`);
}

// ─── Phase 5: Finalisasi ────────────────────────────────────────────────────

export interface FinalisasiDokterUserInput {
  customerId: string;
  jumlahPasien: number | string | null;
  jumlahHariPraktekPerBulan: number | string | null;
  resepPerPasienSt: number | string | null;
  entertainRp: number | string | null;
}

export interface FinalisasiProdukInput {
  id: string;
  // Bisa diganti lagi di Finalisasi (2026-09-09 bug report — lihat schema.prisma).
  skemaPembayaran: "DISKON" | "DP";
  finalDiscountPct: number | string | null;
  diskonDistributorPct: number | string | null;
  finalValueDpRp: number | string | null;
  finalBiayaListingRp: number | string | null;
  standarisasiGagal: boolean;
  dokterUser: FinalisasiDokterUserInput[];
}

export interface FinalisasiKpdmInput {
  customerId: string;
  // Cuma dipakai kalau KPDM ini baru ditambah di Finalisasi (belum ada row-nya dari Planning) — lihat saveFinalisasiAction.
  nama?: string;
  jabatan?: string | null;
  entertainFinal: number | string | null;
}

export interface FinalisasiInput {
  distributors: string[];
  kpdmList: FinalisasiKpdmInput[];
  produk: FinalisasiProdukInput[];
}

const DISTRIBUTOR_PILIHAN = ["AMS", "PPG", "MPI"] as const;

export async function saveFinalisasiAction(id: string, input: FinalisasiInput): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id }, include: { produk: true } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (pengajuan.currentPhase !== "FINALISASI") throw new Error("Pengajuan tidak sedang di fase Finalisasi.");

  const distributors = input.distributors.filter((d): d is (typeof DISTRIBUTOR_PILIHAN)[number] => (DISTRIBUTOR_PILIHAN as readonly string[]).includes(d));

  const produkByKode = new Map<string, string>(pengajuan.produk.map((p: (typeof pengajuan.produk)[number]) => [p.id, p.kodeProduk] as const));

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.poaStandarisasi.update({
      where: { id },
      data: { distributors },
    });

    // Add/update/remove — mirrors applyPlanningKpdm, since KPDM can now be
    // added/removed at Finalisasi too (2026-09-09 user request), not just
    // Planning. A blind updateMany (the old behavior) silently dropped any
    // KPDM added here because no row existed yet to match against.
    const existingKpdm = await tx.poaStandarisasiKpdm.findMany({ where: { pengajuanId: id }, select: { customerId: true } });
    const existingKpdmSet = new Set(existingKpdm.map((k: (typeof existingKpdm)[number]) => k.customerId));
    const wantKpdmSet = new Set(input.kpdmList.map((k) => k.customerId));
    const toRemoveKpdm = [...existingKpdmSet].filter((cid) => !wantKpdmSet.has(cid));
    if (toRemoveKpdm.length > 0) {
      await tx.poaStandarisasiKpdm.deleteMany({ where: { pengajuanId: id, customerId: { in: toRemoveKpdm } } });
    }
    for (const k of input.kpdmList) {
      if (existingKpdmSet.has(k.customerId)) {
        await tx.poaStandarisasiKpdm.updateMany({
          where: { pengajuanId: id, customerId: k.customerId },
          data: { entertainFinal: toNum(k.entertainFinal) },
        });
      } else {
        await tx.poaStandarisasiKpdm.create({
          data: {
            pengajuanId: id,
            customerId: k.customerId,
            namaSnapshot: k.nama ?? "",
            jabatanSnapshot: k.jabatan ?? null,
            entertainFinal: toNum(k.entertainFinal),
          },
        });
      }
    }

    for (const p of input.produk) {
      const kodeProduk = produkByKode.get(p.id);
      if (!kodeProduk) continue;

      await tx.poaStandarisasiProduk.update({
        where: { id: p.id },
        data: {
          skemaPembayaran: p.skemaPembayaran,
          finalDiscountPct: toNum(p.finalDiscountPct),
          diskonDistributorPct: toNum(p.diskonDistributorPct),
          finalValueDpRp: toNum(p.finalValueDpRp),
          finalBiayaListingRp: toNum(p.finalBiayaListingRp),
          standarisasiGagal: p.standarisasiGagal,
        },
      });

      const existing = await tx.poaStandarisasiDokterUser.findMany({ where: { produkId: p.id }, select: { customerId: true } });
      const existingSet = new Set(existing.map((d) => d.customerId));
      const wantIds = new Set(p.dokterUser.map((d) => d.customerId));

      const toRemove = [...existingSet].filter((cid) => !wantIds.has(cid));
      if (toRemove.length > 0) {
        await tx.poaStandarisasiDokterUser.deleteMany({ where: { produkId: p.id, customerId: { in: toRemove } } });
      }

      for (const d of p.dokterUser) {
        const jumlahPasien = toNum(d.jumlahPasien);
        const jumlahHariPraktekPerBulan = toNum(d.jumlahHariPraktekPerBulan);
        const resepPerPasienSt = toNum(d.resepPerPasienSt);
        const { estimasiQtyPerBulan, estimasiQtyUbPerBulan, estimasiNilaiRpPerBulan } = await computeEstimasiPerBulan(kodeProduk, jumlahPasien, jumlahHariPraktekPerBulan, resepPerPasienSt);

        const data = {
          jumlahPasien: jumlahPasien != null ? Math.round(jumlahPasien) : null,
          jumlahHariPraktekPerBulan: jumlahHariPraktekPerBulan != null ? Math.round(jumlahHariPraktekPerBulan) : null,
          resepPerPasienSt,
          estimasiQtyPerBulan,
          estimasiQtyUbPerBulan,
          estimasiSalesRpPerBulan: estimasiNilaiRpPerBulan,
          entertainRp: toNum(d.entertainRp),
        };

        if (existingSet.has(d.customerId)) {
          await tx.poaStandarisasiDokterUser.updateMany({ where: { produkId: p.id, customerId: d.customerId }, data });
        } else {
          await tx.poaStandarisasiDokterUser.create({ data: { ...data, produkId: p.id, customerId: d.customerId } });
        }
      }
    }
  });

  revalidatePath(`/poa-standarisasi/${id}`);
}

export async function submitPoaStandarisasiAction(id: string): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id }, include: { produk: true } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (pengajuan.currentPhase !== "FINALISASI") throw new Error("Pengajuan belum di fase Finalisasi.");
  // Form Approval Standarisasi & Surat Approval Standarisasi KFT keduanya
  // optional (2026-09-07, user request) — tidak lagi gate submit.

  await prisma.poaStandarisasi.update({ where: { id }, data: { submittedAt: new Date() } });
  await logPoaStandarisasiActivity(prisma, { pengajuanId: id, action: "SUBMIT_FINALISASI", actorNip: actor.nip });
  revalidatePath(`/poa-standarisasi/${id}`);
}

// ─── File upload (Google Drive, same service account/pattern as Input Data Survey) ──

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB, per preview UI copy ("PDF atau JPG, maks 10MB")
const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];
const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function sanitizeForFileName(s: string): string {
  return s.replace(/[/\\?%*:|"<>]/g, "-").trim();
}

/**
 * Uploads "Form Approval Standarisasi" (per produk, Finalisasi) or "Surat
 * Approval Standarisasi KFT" (per pengajuan, resolved Q6 — one file, not per
 * produk). Each goes to its own ADMIN-settable GoogleDriveConfig folder,
 * separate from the survey folder and from each other (2026-09-07, user
 * request — see src/lib/googleDrive.ts).
 */
export async function uploadPoaStandarisasiFileAction(formData: FormData): Promise<ActionResult> {
  return runAction(() => uploadPoaStandarisasiFileActionImpl(formData));
}

async function uploadPoaStandarisasiFileActionImpl(formData: FormData): Promise<{ driveFileId: string; namaFile: string }> {
  if (await getAppSetting("standarisasi.upload.disabled")) throw new Error(settingMessage("standarisasi.upload.disabled"));
  const { session, actor } = await requireActor();
  if (!isGoogleDriveConfigured) throw new Error("Fitur upload belum dikonfigurasi.");

  const file = formData.get("file");
  const pengajuanId = (formData.get("pengajuanId") as string | null) ?? "";
  const kind = (formData.get("kind") as string | null) ?? ""; // "formApproval" | "suratKft"
  const produkId = (formData.get("produkId") as string | null) || null;

  if (!(file instanceof File)) throw new Error("File wajib diisi.");
  if (!pengajuanId) throw new Error("Pengajuan tidak valid.");

  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id: pengajuanId } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasi(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");

  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) throw new Error("File harus berformat PDF atau JPG/PNG.");
  if (file.size === 0) throw new Error("File kosong.");
  if (file.size > MAX_FILE_SIZE_BYTES) throw new Error("Ukuran file maksimum 10MB.");

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
  const label = kind === "suratKft" ? "Surat Approval Standarisasi KFT" : "Form Approval Standarisasi";
  const namaFile = `${timestamp} - ${label} - POA Standarisasi ${sanitizeForFileName(pengajuan.kodePI)} oleh ${sanitizeForFileName(session.name)}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = MIME_BY_EXT[ext] ?? "application/octet-stream";
  let driveFileId: string;
  try {
    ({ driveFileId } = await uploadFileToPoaStandarisasiDrive(kind === "suratKft" ? "kftApproval" : "formApproval", namaFile, mimeType, buffer));
  } catch (err) {
    // Same degradation as /api/survey/upload's POST — an unhandled throw
    // here becomes an opaque "Server Components render" digest error in
    // production (2026-08-27 bug report), so surface a real message instead.
    // Server Actions only propagate the Error's message to the client (no
    // separate JSON body to attach a `diag` field to like the REST route
    // does), so the safe diagnostic is appended into the message itself.
    const diag = describeGoogleDriveConfig();
    console.error("[poaStandarisasi/upload] Google Drive upload failed:", err, diag);
    throw new Error(`Upload ke Google Drive gagal: ${err instanceof Error ? err.message : String(err)}. Cek folder tujuan sudah di-share ke service account. (${JSON.stringify(diag)})`);
  }

  if (kind === "suratKft") {
    await prisma.poaStandarisasi.update({
      where: { id: pengajuanId },
      data: { suratApprovalStandarisasiKftPath: namaFile, suratApprovalStandarisasiKftDriveFileId: driveFileId },
    });
  } else {
    if (!produkId) throw new Error("Produk tidak valid.");
    await prisma.poaStandarisasiProduk.update({
      where: { id: produkId },
      data: { formApprovalFilePath: namaFile, formApprovalDriveFileId: driveFileId },
    });
  }

  await logPoaStandarisasiActivity(prisma, {
    pengajuanId, action: "DOKUMEN_DIUNGGAH", actorNip: actor.nip,
    detail: `${label} (${file.name})`,
  });
  revalidatePath(`/poa-standarisasi/${pengajuanId}`);
  return { driveFileId, namaFile };
}

// ─── Step 5: Permintaan SP Non Sales & DPL/DPF ──────────────────────────────
// Muncul otomatis setelah pengajuan.submittedAt terisi (Finalisasi selesai) —
// bukan phase di PoaStandarisasiPhase, gate-nya pakai canEditPoaStandarisasiStep5
// (kebalikan dari canEditPoaStandarisasi: butuh submittedAt SUDAH terisi,
// bukan belum). Tab "Request DPL/DPF": Beban Discount PI/Distributor =
// finalDiscountPct/diskonDistributorPct yang sudah ada, Distributor = field
// `distributors` yang sama; "Ajukan" kirim ke Exodus lewat
// submitDiscountRequestAction di bawah (2026-09-29).

export interface SpNonSalesJumlahInput {
  produkId: string;
  jumlahBox: number | string | null;
}

/** Jumlah SP Non Sales per produk — disimpan lepas dari "Ajukan" supaya MR bisa isi bertahap sebelum submit akhir. */
export async function saveSpNonSalesJumlahAction(id: string, lines: SpNonSalesJumlahInput[]): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasiStep5(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (pengajuan.spNonSalesSubmittedAt) throw new Error("Permintaan SP Non Sales sudah diajukan, tidak bisa diubah lagi.");

  await prisma.$transaction(
    lines.map((l) => prisma.poaStandarisasiProduk.update({ where: { id: l.produkId }, data: { spNonSalesJumlahBox: toNum(l.jumlahBox) } }))
  );
  revalidatePath(`/poa-standarisasi/${id}`);
}

/** "Ajukan Permintaan SP Non Sales" — locks the quantities, doesn't validate a minimum (lenient, matches this feature's other optional-first fields). */
export async function submitSpNonSalesRequestAction(id: string): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasiStep5(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (pengajuan.spNonSalesSubmittedAt) throw new Error("Sudah diajukan sebelumnya.");

  await prisma.poaStandarisasi.update({ where: { id }, data: { spNonSalesSubmittedAt: new Date() } });
  await logPoaStandarisasiActivity(prisma, { pengajuanId: id, action: "SP_NON_SALES_DIAJUKAN", actorNip: actor.nip });
  revalidatePath(`/poa-standarisasi/${id}`);
}

/**
 * Nama penerima memo ("Kepada") default — GoogleDriveConfig.spNonSalesMemoKepada
 * (ADMIN-settable, "Ibu Tuti Ambarwati" saat ini). Bukan admin-only: dibaca
 * MR juga buat prefill form generate memo (2026-09-23 — field TETAP editable
 * per pengajuan "buat jaga-jaga kalau berubah orangnya", cuma DEFAULT-nya
 * yang dari config, bukan fixed hardcode).
 */
export async function getSpNonSalesMemoKepadaDefaultAction(): Promise<string> {
  await requireActor();
  const driveConfig = await prisma.googleDriveConfig.findUnique({ where: { id: 1 } });
  return driveConfig?.spNonSalesMemoKepada ?? "";
}

/**
 * Generate memo SP Non Sales (docs/sp-non-sales-memo/, 2026-09-23) — GANTI
 * total flow upload manual dokumen (§1.3: tidak ada upload ulang lagi untuk
 * memo). MR isi "Kepada" (prefilled dari config, tetap bisa diubah per
 * pengajuan) + "Alasan" lalu generate. Nomor memo di-assign atomik lewat
 * SpNonSalesMemoCounter (increment dalam transaksi yang sama dengan update
 * PoaStandarisasi, supaya nomor tidak pernah bentrok antar 2 generate
 * bersamaan), file di-upload ke folder spNonSales existing (reuse folder
 * yang sama dengan upload dokumen lama).
 */
export async function generateSpNonSalesMemoAction(id: string, input: { kepada: string; alasan: string }): Promise<ActionResult> {
  return runAction(() => generateSpNonSalesMemoActionImpl(id, input));
}

async function generateSpNonSalesMemoActionImpl(id: string, input: { kepada: string; alasan: string }): Promise<void> {
  if (await getAppSetting("standarisasi.upload.disabled")) throw new Error(settingMessage("standarisasi.upload.disabled"));
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({
    where: { id },
    include: { outlet: true, owner: { select: { name: true } }, produk: { include: { product: true } } },
  });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasiStep5(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (pengajuan.spNonSalesMemoGeneratedAt) throw new Error("Memo sudah pernah digenerate, tidak bisa digenerate ulang.");
  if (!input.kepada.trim() || !input.alasan.trim()) throw new Error("Kepada dan alasan wajib diisi.");
  if (pengajuan.produk.length === 0) throw new Error("Belum ada produk di pengajuan ini.");
  if (!isGoogleDriveConfigured) throw new Error("Fitur upload belum dikonfigurasi.");

  const driveConfig = await prisma.googleDriveConfig.findUnique({ where: { id: 1 } });

  // Kolom "PT NIE" di memo = principal produk (Product.principalName). Kolom itu
  // baru terisi untuk sebagian kecil produk (diisi bertahap dari Exodus, bukan
  // import lengkap), jadi yang kosong dilengkapi live dari Exodus dulu — SEBELUM
  // transaksi, supaya HTTP call tidak makan waktu transaksi. Sengaja tidak
  // ditulis balik ke DB (write-through lengkap ada di poaDoctorsRows.ts, yang
  // ngisi principalId/code/category sekaligus). Exodus down -> tetap "-".
  const livePricing = pengajuan.produk.some((p: (typeof pengajuan.produk)[number]) => !p.product.principalName) ? await getLiveProductPricing() : null;

  const now = new Date();
  // Counter reset per TAHUN (2026-09-23 user correction: "POA001.26" →
  // "POA002.26", no reset mentioned across months) — periode key is just the
  // year, not YYYYMM.
  const periode = String(now.getFullYear());

  const { nomor, buffer } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const counter = await tx.spNonSalesMemoCounter.upsert({
      where: { periode },
      create: { periode, seq: 1 },
      update: { seq: { increment: 1 } },
    });
    const nomor = formatMemoNomor(now, counter.seq);
    const buffer = await buildSpNonSalesMemoDocx({
      nomor,
      kepada: input.kepada.trim(),
      tanggal: now,
      alasan: input.alasan.trim(),
      namaOutlet: `${pengajuan.outlet.namaOutlet} / ${pengajuan.kodePI}`,
      namaPengusul: pengajuan.owner.name,
      produk: pengajuan.produk.map((p: (typeof pengajuan.produk)[number]) => ({
        ptNie: p.product.principalName ?? livePricing?.get(p.product.kodeProduk)?.principalName ?? "-",
        kodeProduk: p.product.kodeProduk,
        namaProduk: p.product.namaProduk,
        qtyBox: p.spNonSalesJumlahBox != null ? p.spNonSalesJumlahBox.toString() : "-",
      })),
      signerHormatKami: driveConfig?.spNonSalesMemoSignerHormatKami ?? "",
      signerMenyetujui: driveConfig?.spNonSalesMemoSignerMenyetujui ?? "",
    });
    return { nomor, buffer };
  });

  const { driveFileId } = await uploadFileToPoaStandarisasiDrive("spNonSales", `Memo SP Non Sales - ${pengajuan.kodePI} - ${nomor.replace(/\s*\/\s*/g, "-")}.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer);

  await prisma.poaStandarisasi.update({
    where: { id },
    data: {
      spNonSalesMemoNomor: nomor,
      spNonSalesMemoAlasan: input.alasan.trim(),
      spNonSalesMemoGeneratedAt: now,
      spNonSalesMemoDriveFileId: driveFileId,
    },
  });
  await logPoaStandarisasiActivity(prisma, { pengajuanId: id, action: "MEMO_DIBUAT", actorNip: actor.nip, detail: nomor });
  revalidatePath(`/poa-standarisasi/${id}`);
}

/** Centang "sudah di-sign" — self-report oleh Sales Support (RESOLVED, §1.3: tidak ada approval berlapis, tidak ada upload ulang). Toggle-able (uncheck buat koreksi salah centang). */
export async function toggleSpNonSalesMemoSignedAction(id: string, signed: boolean): Promise<void> {
  const { actor } = await requireActor();
  if (!canAccessSalesSupportMemo(actor)) throw new Error("Anda tidak berhak mengedit ini.");
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id }, select: { spNonSalesMemoGeneratedAt: true, spNonSalesMemoNomor: true } });
  if (!pengajuan?.spNonSalesMemoGeneratedAt) throw new Error("Memo belum digenerate.");

  await prisma.poaStandarisasi.update({
    where: { id },
    data: signed ? { spNonSalesSignedAt: new Date(), spNonSalesSignedByNip: actor.nip } : { spNonSalesSignedAt: null, spNonSalesSignedByNip: null },
  });
  await logPoaStandarisasiActivity(prisma, { pengajuanId: id, action: signed ? "MEMO_TTD" : "MEMO_TTD_BATAL", actorNip: actor.nip, detail: pengajuan.spNonSalesMemoNomor });
  revalidatePath("/sales-support");
}

export interface SalesSupportMemoRow {
  id: string;
  kodePI: string;
  namaOutlet: string;
  nomor: string;
  alasan: string | null;
  generatedAt: Date;
  driveFileId: string;
  namaPengusul: string;
  signedAt: Date | null;
  signedByNama: string | null;
  // Bukti "sudah terstandarisasi" yang MR upload — syarat GOJ (gudang) lepas
  // produk SP Non Sales, dokumen TERPISAH dari memo (2026-09-23 user
  // clarification) — Sales Support teruskan DUA-duanya ke GOJ, jadi listing
  // ini juga perlu nampilin bukti standarisasi, bukan cuma memo.
  buktiStandarisasi: { id: string; fileName: string; driveFileId: string }[];
  /** Produk di pengajuan ini + qty SP Non Sales (box) — buat info di baris memo (2026-09-24, user request). */
  produk: { kodeProduk: string; namaProduk: string; satuan: string; qty: number | null }[];
}

/** Listing company-wide semua memo yang sudah digenerate (docs/sp-non-sales-memo/03-ui-and-access.md — asumsi kerja company-wide, belum dipersempit region/distributor). */
export async function listSalesSupportMemosAction(): Promise<SalesSupportMemoRow[]> {
  const { actor } = await requireActor();
  if (!canAccessSalesSupportMemo(actor)) throw new Error("Anda tidak berhak mengakses ini.");

  const rows = await prisma.poaStandarisasi.findMany({
    where: { spNonSalesMemoGeneratedAt: { not: null } },
    include: {
      outlet: { select: { namaOutlet: true } },
      owner: { select: { name: true } },
      spNonSalesDocuments: { select: { id: true, fileName: true, driveFileId: true } },
      produk: { select: { spNonSalesJumlahBox: true, product: { select: { kodeProduk: true, namaProduk: true, satuan: true } } }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { spNonSalesMemoGeneratedAt: "desc" },
  });

  // spNonSalesSignedByNip is a plain NIP string (no Prisma relation — keeps
  // the existing unnamed `owner` relation on this model from needing an
  // explicit @relation name just to disambiguate a second User FK), so the
  // signer's display name is resolved with one extra batched lookup instead
  // of an include.
  const signerNips = [...new Set(rows.map((p: (typeof rows)[number]) => p.spNonSalesSignedByNip).filter((n: string | null): n is string => !!n))];
  const signers = signerNips.length > 0 ? await prisma.user.findMany({ where: { nip: { in: signerNips } }, select: { nip: true, name: true } }) : [];
  const signerNameByNip = new Map(signers.map((s: (typeof signers)[number]) => [s.nip, s.name]));

  return rows.map((p: (typeof rows)[number]) => ({
    id: p.id,
    kodePI: p.kodePI,
    namaOutlet: p.outlet.namaOutlet,
    nomor: p.spNonSalesMemoNomor ?? "-",
    alasan: p.spNonSalesMemoAlasan,
    generatedAt: p.spNonSalesMemoGeneratedAt!,
    driveFileId: p.spNonSalesMemoDriveFileId!,
    namaPengusul: p.owner.name,
    signedAt: p.spNonSalesSignedAt,
    signedByNama: p.spNonSalesSignedByNip ? signerNameByNip.get(p.spNonSalesSignedByNip) ?? p.spNonSalesSignedByNip : null,
    buktiStandarisasi: p.spNonSalesDocuments,
    produk: p.produk.map((pr: (typeof p.produk)[number]) => ({ kodeProduk: pr.product.kodeProduk, namaProduk: pr.product.namaProduk, satuan: pr.product.satuan, qty: pr.spNonSalesJumlahBox != null ? parseFloat(pr.spNonSalesJumlahBox.toString()) : null })),
  }));
}

/** Distributor terpilih di tab "Request DPL/DPF" — reuse field `distributors` yang sama dipakai Finalisasi, tapi diedit lagi di sini (phase-agnostic, submittedAt Finalisasi sudah lewat). */
export async function updateSpNonSalesDistributorsAction(id: string, distributors: string[]): Promise<void> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasiStep5(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");

  const filtered = distributors.filter((d): d is (typeof DISTRIBUTOR_PILIHAN)[number] => (DISTRIBUTOR_PILIHAN as readonly string[]).includes(d));
  await prisma.poaStandarisasi.update({ where: { id }, data: { distributors: filtered } });
  revalidatePath(`/poa-standarisasi/${id}`);
}

// ─── Step 5 tab 2: Ajukan DPL/DPF ke Exodus ─────────────────────────────────
// POST promotion/v1/request/discount (lihat submitDiscountRequest di exodusApi.ts).
// Exodus TIDAK memvalidasi apa pun selain adanya file (semua payload ngawur
// tetap 200 — hasil tes staging 2026-09-29) dan tidak mengembalikan ID, jadi
// semua validasi ada di sini dan riwayat + anti double-submit disimpan lokal
// (PoaStandarisasiDiscountRequest, row di-reserve SEBELUM POST).

/** "YYYY-MM-DD" (tanggal kalender WIB) -> bagian tanggalnya, null kalau tidak valid. */
function parseYmd(v: string): { y: number; m: number; d: number } | null {
  const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return mt ? { y: +mt[1], m: +mt[2] - 1, d: +mt[3] } : null;
}
const WIB_MS = 7 * 3600e3;

export interface DiscountRequestRow {
  id: string;
  tipe: string;
  distributorKode: string;
  requestDocNumber: string | null;
  requestDocDate: Date | null;
  startDate: Date | null;
  endDate: Date | null;
  submittedAt: Date;
  submittedByNama: string;
  produk: { kodeProduk: string; namaProduk: string; principalPct: number; distributorPct: number; quantity: number }[];
}

export async function listDiscountRequestsAction(pengajuanId: string): Promise<DiscountRequestRow[]> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id: pengajuanId }, select: { ownerId: true, kodePI: true } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!(await canViewPoaStandarisasi(actor, pengajuan))) throw new Error("Anda tidak berhak melihat pengajuan ini.");
  const rows = await prisma.poaStandarisasiDiscountRequest.findMany({
    where: { pengajuanId },
    include: { submittedBy: { select: { name: true } } },
    orderBy: { submittedAt: "desc" },
  });
  return rows.map((r: (typeof rows)[number]) => ({
    id: r.id, tipe: r.tipe, distributorKode: r.distributorKode, requestDocNumber: r.requestDocNumber, requestDocDate: r.requestDocDate,
    startDate: r.startDate, endDate: r.endDate, submittedAt: r.submittedAt, submittedByNama: r.submittedBy.name,
    produk: r.produk as DiscountRequestRow["produk"],
  }));
}

/**
 * FormData: pengajuanId, tipe (DPL|DPF), distributor (AMS|PPG|MPI), produk
 * (JSON [{produkId, quantity}]), DPL: periodeAwal/periodeAkhir ("YYYY-MM-DD",
 * yang dipakai bulannya saja), DPF: tanggalPo, nomorPo, file (PDF/JPG/PNG).
 * Disc PI/Dist per produk dari nilai yang sudah ada di pengajuan
 * (finalDiscountPct/diskonDistributorPct, fallback live Exodus) — bukan input.
 */
export async function submitDiscountRequestAction(formData: FormData): Promise<ActionResult> {
  return runAction(() => submitDiscountRequestActionImpl(formData));
}

async function submitDiscountRequestActionImpl(formData: FormData): Promise<void> {
  if (await getAppSetting("standarisasi.dplDpfSubmit.disabled")) throw new Error(settingMessage("standarisasi.dplDpfSubmit.disabled"));
  const { actor } = await requireActor();
  const str = (k: string) => ((formData.get(k) as string | null) ?? "").trim();
  const pengajuanId = str("pengajuanId");
  const tipe = str("tipe");
  const distributorKode = str("distributor") as ExodusDistributorKode;

  if (tipe !== "DPL" && tipe !== "DPF") throw new Error("Tipe diskon tidak valid.");
  const distributor = EXODUS_DISTRIBUTORS[distributorKode];
  if (!distributor) throw new Error("Pilih distributor dulu.");

  const pengajuan = await prisma.poaStandarisasi.findUnique({
    where: { id: pengajuanId },
    include: { outlet: true, produk: { include: { product: true } } },
  });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasiStep5(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");

  // Tanggal / periode / file
  let requestDocNumber: string | null = null;
  let requestDocDate: Date | null = null;
  let startDate: Date | null = null;
  let endDate: Date | null = null;
  let file: { name: string; mimeType: string; buffer: Buffer } | undefined; // DPF only (dokumen PO); DPL tanpa file
  if (tipe === "DPF") {
    const tgl = parseYmd(str("tanggalPo"));
    requestDocNumber = str("nomorPo");
    if (!tgl) throw new Error("Tanggal PO wajib diisi.");
    if (!requestDocNumber) throw new Error("Nomor PO wajib diisi.");
    requestDocDate = new Date(Date.UTC(tgl.y, tgl.m, tgl.d) - WIB_MS); // 00:00 WIB, seperti data nyata Exodus
    const f = formData.get("file");
    if (!(f instanceof File) || f.size === 0) throw new Error("Dokumen PO wajib diupload.");
    const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) throw new Error("File harus berformat PDF atau JPG/PNG.");
    if (f.size > MAX_FILE_SIZE_BYTES) throw new Error("Ukuran file maksimum 10MB.");
    file = { name: f.name, mimeType: MIME_BY_EXT[ext] ?? "application/octet-stream", buffer: Buffer.from(await f.arrayBuffer()) };
  } else {
    const awal = parseYmd(str("periodeAwal"));
    const akhir = parseYmd(str("periodeAkhir"));
    if (!awal || !akhir) throw new Error("Periode awal dan akhir wajib diisi.");
    startDate = new Date(Date.UTC(awal.y, awal.m, 1) - WIB_MS); // tgl 1 bulan awal, 00:00 WIB
    endDate = new Date(Date.UTC(akhir.y, akhir.m + 1, 1) - WIB_MS - 1); // akhir bulan akhir, 23:59:59.999 WIB
    if (endDate < startDate) throw new Error("Periode akhir tidak boleh sebelum periode awal.");
    // DPL tidak pakai request-doc-file (dokumen PO cuma wajib untuk DPF — Mas Budi/Exodus 2026-10-01).
  }

  // Produk terpilih + disc
  let selected: { produkId: string; quantity: number | string }[];
  try { selected = JSON.parse(str("produk")); } catch { throw new Error("Data produk tidak valid."); }
  if (!Array.isArray(selected) || selected.length === 0) throw new Error("Pilih minimal satu produk.");
  const discounts = await getDiscountsForOutlet(pengajuan.kodePI);
  const pricing = await getLiveProductPricing();
  const products = selected.map((sel) => {
    const prod = pengajuan.produk.find((p: (typeof pengajuan.produk)[number]) => p.id === sel.produkId);
    if (!prod) throw new Error("Produk tidak ada di pengajuan ini.");
    const nama = prod.product.namaProduk;
    const qty = Number(sel.quantity);
    if (!Number.isInteger(qty) || qty < (tipe === "DPF" ? 1 : 0)) throw new Error(`Qty ${nama} harus bilangan bulat ${tipe === "DPF" ? ">= 1" : ">= 0"}.`);
    const principalPct = toNum(prod.finalDiscountPct) ?? discounts?.get(prod.kodeProduk)?.principalPct ?? null;
    const distributorPct = toNum(prod.diskonDistributorPct) ?? discounts?.get(prod.kodeProduk)?.distributorPct ?? null;
    if (principalPct == null || distributorPct == null) throw new Error(`Disc PI/Dist ${nama} belum ada.`);
    if (principalPct < 0 || principalPct > 100 || distributorPct < 0 || distributorPct > 100) throw new Error(`Disc ${nama} di luar 0-100%.`);
    const live = pricing?.get(prod.kodeProduk);
    if (!live?.principalId || !live.principalCode || !live.principalName) throw new Error(`Principal ${nama} tidak ditemukan di Exodus.`);
    return {
      snapshot: { kodeProduk: prod.kodeProduk, namaProduk: nama, principalPct, distributorPct, quantity: qty },
      exodus: {
        productName: live.namaProduk ?? nama, productCode: prod.kodeProduk,
        productType: live.namaGroupBrand === "ETHICAL" ? "ETH" : "OTC",
        principalDistributorId: live.principalId, principalDistributorName: live.principalName, principalDistributorCode: live.principalCode,
        principalPercentage: principalPct, distributorPercentage: distributorPct, quantity: qty,
      },
    };
  });

  const outletId = await getExodusOutletIdByCode(pengajuan.kodePI);
  if (!outletId) throw new Error("Outlet tidak ditemukan di Exodus (atau Exodus sedang tidak bisa dihubungi).");

  // Reserve dulu (unique dedupKey = anti double-submit), baru POST; POST gagal -> lepas reservasi.
  const scope = tipe === "DPF" ? requestDocNumber : `${startDate!.toISOString()}~${endDate!.toISOString()}`;
  const dedupKey = [tipe, distributorKode, scope, ...products.map((p) => p.snapshot.kodeProduk).sort()].join("|");
  let reservation: { id: string };
  try {
    reservation = await prisma.poaStandarisasiDiscountRequest.create({
      data: {
        pengajuanId, tipe, distributorKode, requestDocNumber, requestDocDate, startDate, endDate, dedupKey,
        produk: products.map((p) => p.snapshot),
        submittedByNip: actor.nip,
      },
      select: { id: true },
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new Error("Ajuan yang sama (tipe, distributor, PO/periode, produk) sudah pernah dikirim.");
    throw e;
  }

  const sinceMs = Date.now();
  const result = await submitDiscountRequest({
    discountType: tipe, outletId, outletCode: pengajuan.kodePI, outletName: pengajuan.outlet.namaOutlet,
    distributorId: distributor.id, distributorName: distributor.name,
    requestDocNumber, requestDocDate: requestDocDate?.toISOString() ?? null,
    startDate: startDate?.toISOString() ?? null, endDate: endDate?.toISOString() ?? null,
    // created_by = NIP user yang mengajukan (yang login di aplikasi), bukan service account — Exodus mencatat pembuat dari payload ini (Mas Budi 2026-10-01).
    createdBy: actor.nip,
    products: products.map((p) => p.exodus), file,
  });
  if (!result.ok) {
    await prisma.poaStandarisasiDiscountRequest.delete({ where: { id: reservation.id } });
    console.error("[poaStandarisasi/submitDiscountRequest] Exodus gagal:", result.error);
    throw new Error(`Gagal mengirim ke Exodus: ${result.error}`);
  }

  // POST Exodus 200 belum menjamin request dibuat (tanpa id di respons) — wajib terkonfirmasi di GET sebelum dinyatakan terkirim.
  const pcts = products.map((p) => p.snapshot.principalPct);
  const confirmed = await confirmDiscountRequest({ outletCode: pengajuan.kodePI, discountType: tipe, createdBy: actor.nip, sinceMs, minPct: Math.min(...pcts), maxPct: Math.max(...pcts) });
  if (!confirmed) {
    await prisma.poaStandarisasiDiscountRequest.delete({ where: { id: reservation.id } });
    console.error("[poaStandarisasi/submitDiscountRequest] POST 200 tapi request tidak ditemukan di GET Exodus", { outlet: pengajuan.kodePI, tipe, createdBy: actor.nip });
    throw new Error("Request belum terkonfirmasi di Exodus (tidak ditemukan setelah dikirim). Cek dulu di sistem Exodus sebelum mengirim ulang agar tidak dobel, dan hubungi admin kalau berulang.");
  }
  await prisma.poaStandarisasiDiscountRequest.update({
    where: { id: reservation.id },
    data: { exodusRefId: confirmed.refId, exodusStatus: confirmed.status, exodusStatusAt: new Date() },
  });
  await logPoaStandarisasiActivity(prisma, {
    pengajuanId, action: "DPL_DPF_DIKIRIM", actorNip: actor.nip,
    detail: `${tipe} — ${distributorKode} — ${products.map((p) => p.snapshot.namaProduk).join(", ")}`,
  });
  revalidatePath(`/poa-standarisasi/${pengajuanId}`);
}

/** Uploads a "Permintaan SP Non Sales" document — multiple files allowed per pengajuan (shared, not per produk), own admin-settable Drive folder. */
export async function uploadSpNonSalesDocumentAction(formData: FormData): Promise<ActionResult> {
  return runAction(() => uploadSpNonSalesDocumentActionImpl(formData));
}

async function uploadSpNonSalesDocumentActionImpl(formData: FormData): Promise<{ driveFileId: string; fileName: string }> {
  if (await getAppSetting("standarisasi.upload.disabled")) throw new Error(settingMessage("standarisasi.upload.disabled"));
  const { session, actor } = await requireActor();
  if (!isGoogleDriveConfigured) throw new Error("Fitur upload belum dikonfigurasi.");

  const file = formData.get("file");
  const pengajuanId = (formData.get("pengajuanId") as string | null) ?? "";
  if (!(file instanceof File)) throw new Error("File wajib diisi.");
  if (!pengajuanId) throw new Error("Pengajuan tidak valid.");

  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id: pengajuanId } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!canEditPoaStandarisasiStep5(actor, pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (pengajuan.spNonSalesSubmittedAt) throw new Error("Permintaan SP Non Sales sudah diajukan, tidak bisa upload dokumen baru lagi.");

  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) throw new Error("File harus berformat PDF atau JPG/PNG.");
  if (file.size === 0) throw new Error("File kosong.");
  if (file.size > MAX_FILE_SIZE_BYTES) throw new Error("Ukuran file maksimum 10MB.");

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
  const fileName = `${timestamp} - Permintaan SP Non Sales - POA Standarisasi ${sanitizeForFileName(pengajuan.kodePI)} oleh ${sanitizeForFileName(session.name)}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = MIME_BY_EXT[ext] ?? "application/octet-stream";
  let driveFileId: string;
  try {
    ({ driveFileId } = await uploadFileToPoaStandarisasiDrive("spNonSales", fileName, mimeType, buffer));
  } catch (err) {
    const diag = describeGoogleDriveConfig();
    console.error("[poaStandarisasi/uploadSpNonSales] Google Drive upload failed:", err, diag);
    throw new Error(`Upload ke Google Drive gagal: ${err instanceof Error ? err.message : String(err)}. Cek folder tujuan sudah di-share ke service account. (${JSON.stringify(diag)})`);
  }

  await prisma.poaStandarisasiSpNonSalesDocument.create({
    data: { pengajuanId, fileName, driveFileId, uploadedByNip: actor.nip },
  });

  revalidatePath(`/poa-standarisasi/${pengajuanId}`);
  return { driveFileId, fileName };
}

export async function deleteSpNonSalesDocumentAction(documentId: string): Promise<void> {
  const { actor } = await requireActor();
  const doc = await prisma.poaStandarisasiSpNonSalesDocument.findUnique({ where: { id: documentId }, include: { pengajuan: true } });
  if (!doc) throw new Error("Dokumen tidak ditemukan.");
  if (!canEditPoaStandarisasiStep5(actor, doc.pengajuan)) throw new Error("Anda tidak berhak mengedit pengajuan ini.");
  if (doc.pengajuan.spNonSalesSubmittedAt) throw new Error("Permintaan SP Non Sales sudah diajukan, tidak bisa hapus dokumen lagi.");

  await prisma.poaStandarisasiSpNonSalesDocument.delete({ where: { id: documentId } });
  revalidatePath(`/poa-standarisasi/${doc.pengajuanId}`);
}

// ─── Confidential file download (authenticated proxy + access log) ────────
// User 2026-08-27: dokumen POA Standarisasi (NIE/COA/CPOB/Flyer, Bukti TTD,
// Form Approval Standarisasi, Surat Approval Standarisasi KFT) itu
// confidential — link Drive mentah visibility-nya ikut sharing setting
// FOLDER Drive, bukan authz app. Semua download WAJIB lewat
// /api/poa-standarisasi/dokumen/[driveFileId] (bukan driveViewUrl langsung)
// supaya bisa digerbangi authz + dicatat siapa/kapan/berapa kali.

/** Resolves which pengajuan/produk/dokter owns a given Drive file id, across
 * the 4 places a driveFileId can live — so the download route never has to
 * trust a client-supplied pengajuanId/label. */
async function resolvePoaStandarisasiFileOwner(driveFileId: string) {
  const [dokumen, produk, suratKft, dokterApproval, memo, spNonSalesDoc] = await Promise.all([
    prisma.poaStandarisasiDokumen.findFirst({
      where: { driveFileId },
      include: { produk: { include: { pengajuan: true, product: true } } },
    }),
    prisma.poaStandarisasiProduk.findFirst({
      where: { formApprovalDriveFileId: driveFileId },
      include: { pengajuan: true, product: true },
    }),
    prisma.poaStandarisasi.findFirst({ where: { suratApprovalStandarisasiKftDriveFileId: driveFileId } }),
    prisma.poaStandarisasiDokterApproval.findFirst({
      where: { buktiTtdDriveFileId: driveFileId },
      include: { produk: { include: { pengajuan: true, product: true } }, customer: true },
    }),
    prisma.poaStandarisasi.findFirst({ where: { spNonSalesMemoDriveFileId: driveFileId } }),
    // "Bukti sudah terstandarisasi" MR upload buat syarat GOJ (gudang) lepas
    // produk SP Non Sales (2026-09-23 user clarification) — bukan redundant
    // sama memo, dua dokumen beda yang SAMA-SAMA perlu diteruskan ke GOJ.
    // Sebelumnya TIDAK ke-cover di resolver ini sama sekali (pre-existing gap,
    // ketauan waktu nambahin akses Sales Support) — ditambah sekalian di sini.
    prisma.poaStandarisasiSpNonSalesDocument.findFirst({ where: { driveFileId }, include: { pengajuan: true } }),
  ]);

  // salesSupportVisible: dokumen yang Sales Support (scope terbatas, BUKAN
  // canViewPoaStandarisasi) boleh akses — memo + bukti standarisasi, karena
  // keduanya yang mereka teruskan ke GOJ. Dokumen confidential lain
  // (NIE/CPOB/KFT/Bukti TTD) TETAP tidak boleh diakses Sales Support.
  if (dokumen) return { pengajuan: dokumen.produk.pengajuan, label: `${dokumen.jenis} — ${dokumen.produk.product.namaProduk}`, salesSupportVisible: false };
  if (produk) return { pengajuan: produk.pengajuan, label: `Form Approval Standarisasi — ${produk.product.namaProduk}`, salesSupportVisible: false };
  if (suratKft) return { pengajuan: suratKft, label: "Surat Approval Standarisasi KFT", salesSupportVisible: false };
  if (dokterApproval) return { pengajuan: dokterApproval.produk.pengajuan, label: `Bukti TTD — ${dokterApproval.customer.namaCustomer} (${dokterApproval.produk.product.namaProduk})`, salesSupportVisible: false };
  if (memo) return { pengajuan: memo, label: "Memo SP Non Sales", salesSupportVisible: true };
  if (spNonSalesDoc) return { pengajuan: spNonSalesDoc.pengajuan, label: `Bukti Standarisasi — ${spNonSalesDoc.fileName}`, salesSupportVisible: true };
  return null;
}

/**
 * Authorizes + logs one access to a confidential POA Standarisasi file,
 * given only its Drive file id. Throws if the file isn't found or the
 * current session isn't authorized to view its pengajuan — the download
 * route must not stream file bytes unless this resolves successfully.
 */
export async function authorizeAndLogPoaStandarisasiFileAccess(driveFileId: string): Promise<void> {
  const session = await getCurrentUser();
  if (!session) throw new Error("Sesi tidak valid.");

  const owner = await resolvePoaStandarisasiFileOwner(driveFileId);
  if (!owner) throw new Error("File tidak ditemukan.");

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  // Normal pengajuan access (owner/atasan/ADMIN/etc) always applies. Memo +
  // bukti standarisasi ALSO open to Sales Support (docs/sp-non-sales-memo/)
  // on top of that — their access is scoped to just these 2 document kinds
  // (they forward both to GOJ), never the rest of the pengajuan's
  // confidential files (NIE/CPOB/KFT/Bukti TTD stay canViewPoaStandarisasi-only).
  const authorized =
    (await canViewPoaStandarisasi(actor, owner.pengajuan)) ||
    (owner.salesSupportVisible && canAccessSalesSupportMemo(actor));
  if (!authorized) {
    throw new Error("Anda tidak berhak mengakses dokumen ini.");
  }

  await prisma.poaStandarisasiFileAccessLog.create({
    data: { pengajuanId: owner.pengajuan.id, driveFileId, label: owner.label, accessedByNip: actor.nip },
  });
}

export interface FileAccessLogRow {
  id: string;
  driveFileId: string;
  label: string;
  accessedByNip: string;
  accessedByNama: string;
  accessedAt: Date;
}

/** Powers the "Riwayat Akses Dokumen" panel — who opened which file, when, how many times. */
export async function getPoaStandarisasiFileAccessLogAction(pengajuanId: string): Promise<FileAccessLogRow[]> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id: pengajuanId } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!(await canViewPoaStandarisasi(actor, pengajuan))) throw new Error("Anda tidak berhak melihat log ini.");

  const rows = await prisma.poaStandarisasiFileAccessLog.findMany({
    where: { pengajuanId },
    include: { accessedBy: { select: { name: true } } },
    orderBy: { accessedAt: "desc" },
  });
  return rows.map((r: (typeof rows)[number]) => ({
    id: r.id,
    driveFileId: r.driveFileId,
    label: r.label,
    accessedByNip: r.accessedByNip,
    accessedByNama: r.accessedBy.name,
    accessedAt: r.accessedAt,
  }));
}

/** Riwayat aktivitas pengajuan (terbaru di atas) — waktu ISO UTC, ditampilkan WIB di UI. */
export async function getPoaStandarisasiActivityAction(pengajuanId: string): Promise<ActivityRow[]> {
  const { actor } = await requireActor();
  const pengajuan = await prisma.poaStandarisasi.findUnique({ where: { id: pengajuanId } });
  if (!pengajuan) throw new Error("Pengajuan tidak ditemukan.");
  if (!(await canViewPoaStandarisasi(actor, pengajuan))) throw new Error("Anda tidak berhak melihat riwayat ini.");

  const rows = await prisma.poaStandarisasiActivityLog.findMany({
    where: { pengajuanId },
    include: { actor: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r: (typeof rows)[number]) => ({
    id: r.id,
    action: r.action,
    label: ACTIVITY_LABELS[r.action] ?? r.action,
    detail: r.detail ? censorActivityDetail(r.action, r.detail) : null, // nama dokter disensor (sama seperti export)
    actorNama: r.actor.name,
    at: r.createdAt.toISOString(),
  }));
}
