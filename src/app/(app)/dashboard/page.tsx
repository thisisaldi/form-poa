import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import type { SessionData } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getVisiblePoaFilter, getPendingActionFilter, canCreatePoa, canEdit, canAddNewDoctor, getMrIdsUnder, getEditLockLevelsForPoas } from "@/lib/authz";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { DeletePoaButton } from "@/components/poa/DeletePoaButton";
import { PoaStatusProgressChart } from "@/components/poa/PoaStatusProgressChart";
import type { PoaForm as PoaFormType, User as UserType, PoaStatus } from "@prisma/client";
import { displayRole } from "@/lib/role";
import { formatCurrency } from "@/lib/format";
import { resolveTargetHospitalValueFallback } from "@/lib/targetHospitalValue";
import { DashboardExportButton } from "@/components/poa/DashboardExportButton";

// Hospital dashboard (this page lists PoaForm — hospital POA) drops the
// "Jt/M/Rb" suffix, same as the hospital draft (DraftChecklist.tsx) —
// plain ÷1.000.000 (2026-09-03 request).
function formatRp(val: Parameters<typeof formatCurrency>[0]) {
  return formatCurrency(val, false);
}

export const metadata = { title: "Dashboard · Form POA" };

function buildPageHref(page: number, size: string, q?: string) {
  const sp = new URLSearchParams();
  sp.set("page", String(page));
  sp.set("size", size);
  if (q) sp.set("q", q);
  return `/dashboard?${sp.toString()}`;
}

type PoaWithMeta = PoaFormType & {
  owner: Pick<UserType, "nip" | "name" | "role">;
  _count: { items: number };
  _totalEst: number;
  _dokterCount: number;
  _target: number | null;          // poa.target (manual) ?? TargetHospitalValue fallback
  _ratioEstimasi: number | null;  // totalEst / target * 100 (null if no target)
  _pctBudget: number | null;       // weighted avg budget % (0-100), null if no items
};

// Lightweight placeholder shown while DashboardContent streams in (2026-08-03
// — see the split below: this page used to block on the full POA
// list/aggregation, MR progress rollup, and even the header action buttons
// before rendering anything at all, including the title that doesn't need
// any of that data). Row count is just a visual approximation of the POA
// table, not tied to any real data — same style as SummarySkeleton in
// summary/page.tsx.
function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <Card>
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-8 rounded" style={{ background: "var(--color-bg-subtle)" }} />
          ))}
        </div>
      </Card>
    </div>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const session = (await getCurrentUser())!;
  const rawActor = await prisma.user.findUnique({ where: { nip: session.userId } });
  if (!rawActor) return null;

  const actor: UserType = session.role === "MR" && rawActor.role !== "MR"
    ? { ...rawActor, role: "MR" as any, jabatan: session.jabatan ?? rawActor.jabatan }
    : rawActor;

  if (actor.project === "OMEGA") {
    redirect("/sc/dashboard");
  }

  const params = await searchParams;
  const isMR = session.role === "MR";

  return (
    <div className="space-y-6">
      {params.error === "no_outlets" && (
        <div className="rounded-md px-4 py-3 text-sm"
          style={{ background: "var(--color-warning-light, #fff7ed)", color: "var(--color-warning, #92400e)", border: "1px solid var(--color-warning-border, #fcd34d)" }}>
          Akun Anda belum memiliki outlet yang ditugaskan. Hubungi admin untuk mendapatkan akses.
        </div>
      )}

      {/* Header — static, no DB dependency, renders immediately */}
      <div>
        <h1>Dashboard</h1>
        <p style={{ color: "var(--color-text-muted)" }} className="mt-0.5 text-sm">
          Selamat datang, {session.name}
          <span className="ml-2 rounded px-1.5 py-0.5 text-xs font-medium"
            style={{ background: "var(--color-blue-light)", color: "var(--color-blue)" }}>
            {displayRole(session.role, session.jabatan)}
          </span>
        </p>
      </div>

      {/* Everything below needs the heavy POA fetch/aggregation and MR progress
          rollup — streamed in separately (2026-08-03) so it doesn't block the
          header above from showing up. The action-buttons row (was inline
          next to the header title) moved into DashboardContent too, since the
          Export Excel button's href depends on mrProgressPeriod, which is
          only known after the heavy MR-progress computation resolves — same
          "relocate a header element that needs heavy data" move Summary's
          refactor made for its counts line. key= forces a fresh Suspense
          fallback on page/size change instead of showing stale content while
          the new page loads. */}
      <Suspense key={`${params.page ?? ""}|${params.size ?? ""}|${params.q ?? ""}`} fallback={<DashboardSkeleton />}>
        <DashboardContent session={session} actor={actor} isMR={isMR} params={params} />
      </Suspense>
    </div>
  );
}

async function DashboardContent({
  session, actor, isMR, params,
}: {
  session: SessionData;
  actor: UserType;
  isMR: boolean;
  params: Record<string, string>;
}) {
  const [visibleFilter, pendingFilter, eligible] = await Promise.all([
    getVisiblePoaFilter(actor),
    Promise.resolve(getPendingActionFilter(actor)),
    // Not MR-only anymore — an ASM/SM/NSM with a vacant team is eligible too
    // (see canCreatePoa in authz.ts).
    canCreatePoa(session.userId),
  ]);

  const pageSizeParam = params.size ?? "25";
  const pageSize = pageSizeParam === "all" ? null : (Number(pageSizeParam) || 25);
  const requestedPage = Math.max(1, Number(params.page) || 1);

  // "Cari POA siapa" — atasan search by owner name/NIP, layered as an extra AND
  // on top of getVisiblePoaFilter so the existing role-scoping is untouched
  // (2026-08-06). MR-only view has no use for this (they only ever see their
  // own POA), so the input is hidden for isMR — see render below.
  const q = params.q?.trim();
  const where = q
    ? { AND: [visibleFilter, { owner: { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { nip: { contains: q, mode: "insensitive" as const } }] } }] }
    : visibleFilter;

  // Quarters offered in the export dropdown — only ones with an actual POA
  // that has line items, not just "last 8 calendar quarters" (2026-09-23:
  // exporting an empty quarter is pointless), and NOT just any POA row —
  // `items: { some: {} }` excludes empty DRAFT stubs (a POA row created by
  // opening "Buat POA" but never filled in), same class of ghost-period bug
  // mrProgressPeriod below already had to guard against (found here: an
  // otherwise-untouched 2027-Q3 showing up from a bare stub). groupBy is a
  // cheap aggregate (same shape as the mrProgressPeriod query below), so
  // this stays fine even at ADMIN/GM's company-wide visibleFilter scope
  // per docs/PERFORMANCE.md. Skipped for MR (no export button for them).
  const availableQuartersPromise = isMR
    ? Promise.resolve([])
    : prisma.poaForm.groupBy({ by: ["period"], where: { AND: [visibleFilter, { items: { some: {} } }] }, _count: { _all: true } })
        .then((rows) => rows.map((r) => r.period).sort((a, b) => b.localeCompare(a)));

  const totalPoaCount = await prisma.poaForm.count({ where });
  const totalPages = pageSize ? Math.max(1, Math.ceil(totalPoaCount / pageSize)) : 1;
  const page = Math.min(requestedPage, totalPages);

  const [recentRaw, pendingCount] = await Promise.all([
    prisma.poaForm.findMany({
      where,
      include: {
        owner: { select: { nip: true, name: true, role: true } },
        items: {
          select: {
            rencanaTotalBiaya: true,
            namaCust: true,
            persenPsspDokter: true, persenDiskon: true,
            persenDp: true, persenListingFee: true, persenEntertain: true, pengaliNilaiR: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      ...(pageSize ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
    }),
    prisma.poaForm.count({ where: pendingFilter }),
  ]);

  type RawItem = {
    rencanaTotalBiaya: { toString(): string };
    namaCust: string;
    persenPsspDokter: { toString(): string } | null;
    persenDiskon: { toString(): string } | null;
    persenDp: { toString(): string } | null;
    persenListingFee: { toString(): string } | null;
    persenEntertain: { toString(): string } | null;
    pengaliNilaiR: { toString(): string } | null;
  };
  type RawPoa = typeof recentRaw[number] & { items: RawItem[] };

  // Compute per-POA aggregates
  const toNum = (v: { toString(): string } | null | undefined) => parseFloat((v ?? "0").toString()) || 0;

  // Target resolution (docs/form-poa/01-business-rules.md §3): poa.target
  // (manual) wins if set, else SUM(TargetHospitalValue) via subordinate MR
  // nips for that POA's quarter — batched across the whole visible page
  // (docs/PERFORMANCE.md §2 point 4), not per-row, since this list can be
  // company-wide ADMIN scope. Previously only wired into poa/[id]/page.tsx's
  // single-POA view; this page just showed the raw (almost always unset)
  // poa.target, hence "-" everywhere (found 2026-08-24).
  const targetFallbackMap = await resolveTargetHospitalValueFallback(
    (recentRaw as RawPoa[]).map((poa) => ({ owner: poa.owner, quarter: poa.period }))
  );

  const recentPoas: PoaWithMeta[] = (recentRaw as RawPoa[]).map((poa) => {
    const items = poa.items;
    const totalEst = items.reduce((s: number, it: RawItem) => s + toNum(it.rencanaTotalBiaya), 0);
    const dokterCount = new Set(items.map((it: RawItem) => it.namaCust)).size;

    // Ratio % = totalEst / target
    const manualTarget = poa.target ? parseFloat(poa.target.toString()) : null;
    const target = manualTarget ?? targetFallbackMap.get(`${poa.owner.nip}|${poa.period}`) ?? null;
    const ratioEstimasi = target != null && target > 0 ? (totalEst / target) * 100 : null;

    // Weighted budget percentage
    let budgetSum = 0;
    for (const it of items) {
      const est = toNum(it.rencanaTotalBiaya);
      const pengaliNilaiR = it.pengaliNilaiR != null ? toNum(it.pengaliNilaiR) : 1;
      const pct = toNum(it.persenPsspDokter) * pengaliNilaiR + toNum(it.persenDiskon)
        + toNum(it.persenDp) + toNum(it.persenListingFee) + toNum(it.persenEntertain);
      budgetSum += est * pct;
    }
    const pctBudget = totalEst > 0 ? (budgetSum / totalEst) * 100 : null;

    return {
      ...poa,
      _count: { items: items.length },
      _totalEst: totalEst,
      _dokterCount: dokterCount,
      _target: target,
      _ratioEstimasi: ratioEstimasi,
      _pctBudget: pctBudget,
    };
  });

  // Batched (2026-08-31 perf fix, docs/PERFORMANCE.md §2 point 4's flagged
  // gap): getEditLockLevel's poaAuditLog lookup has a unique poaId per call,
  // so cache() can't dedupe it across this per-row canEdit loop the way it
  // does for the subtree helpers — one findMany for every recentPoas row here
  // instead of one per row.
  const lockLevelByPoaId = await getEditLockLevelsForPoas(recentPoas.map((poa) => ({ id: poa.id, ownerId: poa.ownerId })));
  const editablePoaIds = new Set(
    (await Promise.all(recentPoas.map(async (poa) => ((await canEdit(actor, poa, lockLevelByPoaId.get(poa.id))) ? poa.id : null))))
      .filter((id): id is string => id !== null)
  );
  // Separate from editablePoaIds/canEdit — the "Tambah" link goes to
  // /poa/[id]/edit, which is gated by canAddNewDoctor (adding a brand-new
  // doctor is deliberately NOT blocked by the edit lock that canEdit enforces,
  // see canAddNewDoctor in authz.ts). Using canEdit here made "Tambah" vanish
  // (leaving only "Detail") on any POA whose existing rows were all already
  // approved/locked, even though the owner could still add a new doctor.
  const addableDoctorPoaIds = new Set(
    (await Promise.all(recentPoas.map(async (poa) => ((await canAddNewDoctor(actor, poa)) ? poa.id : null))))
      .filter((id): id is string => id !== null)
  );

  // ── MR progress stats (non-MR only) ─────────────────────────────────────────

  interface MrGroupStat {
    groupNip: string;
    groupName: string;
    groupRole: string;
    mrNips: string[];
    submittedNips: Set<string>;
  }

  let mrProgressPeriod: string | null = null;
  let mrGroups: MrGroupStat[] = [];

  if (!isMR) {
    // Direct subordinates of the actor
    const directSubs = await prisma.user.findMany({
      where: { nipAtasan: actor.nip, isActive: true },
      select: { nip: true, name: true, role: true },
      orderBy: { name: "asc" },
    }) as { nip: string; name: string; role: string }[];

    // For each direct sub, get MR nips under them (or themselves if they're MRs)
    // — getMrIdsUnder (src/lib/authz.ts) is the same cache()'d, level-by-level
    // BFS helper canView/canEdit already use, replacing a local per-node
    // recursive `findMany` (one query per manager node down the subtree)
    // with ≤depth batched round-trips per direct sub, run in parallel
    // (2026-08-31 perf fix — docs/PERFORMANCE.md §2 point 2's exact
    // anti-pattern, reimplemented locally here instead of reusing the fix).
    const groupsRaw = await Promise.all(directSubs.map(async (sub) => {
      if (sub.role === "MR") return { ...sub, mrNips: [sub.nip] };
      // MRs 1 level deeper (ASM→MRs or SM→ASM→MRs would need 2 levels)
      const depth = sub.role === "ASM" ? 1 : sub.role === "SM" ? 2 : 1;
      const mrNips = await getMrIdsUnder(sub.nip, depth);
      return { ...sub, mrNips };
    }));

    // Pick the period the team is actually working in — the one with the
    // most real (non-draft) submissions — rather than just the newest
    // period string that exists at all. A single MR opening "Buat POA" for
    // next quarter creates an empty DRAFT stub whose period would otherwise
    // win via plain "latest period" sorting, silently flipping this whole
    // panel (and the Export Excel button's default period) to a period
    // nobody else has touched yet — everyone else then shows BELUM_SUBMIT/0,
    // looking like a data bug (2026-07-23, reported as "angkanya aneh, 0
    // semua" for AGUS PRIYONO's NSM export, whose team had exactly one Q4
    // draft/revisi stub next to a fully-submitted Q3).
    const allMrNips = [...new Set(groupsRaw.flatMap(g => g.mrNips))];
    if (allMrNips.length > 0) {
      const submittedByPeriod = await prisma.poaForm.groupBy({
        by: ["period"],
        where: { ownerId: { in: allMrNips }, status: { notIn: ["DRAFT", "REVISI"] as PoaStatus[] } },
        _count: { _all: true },
      }) as { period: string; _count: { _all: number } }[];

      if (submittedByPeriod.length > 0) {
        submittedByPeriod.sort((a, b) => b._count._all - a._count._all || (b.period < a.period ? -1 : 1));
        mrProgressPeriod = submittedByPeriod[0].period;
      } else {
        // Nobody has submitted anything anywhere yet — fall back to just
        // the newest period that exists at all, so the panel still shows
        // something rather than nothing.
        const periodRow = await prisma.poaForm.findFirst({
          where: { ownerId: { in: allMrNips } },
          orderBy: { period: "desc" },
          select: { period: true },
        });
        mrProgressPeriod = periodRow?.period ?? null;
      }

      if (mrProgressPeriod) {
        const submittedRows = await prisma.poaForm.findMany({
          where: {
            ownerId: { in: allMrNips },
            period: mrProgressPeriod,
            status: { notIn: ["DRAFT", "REVISI"] as PoaStatus[] },
          },
          select: { ownerId: true },
        }) as { ownerId: string }[];
        const submittedNips = new Set(submittedRows.map(r => r.ownerId));

        // Every direct subordinate shows, even ones with zero MRs under them
        // (e.g. an ASM whose team is genuinely empty) — previously filtered
        // out entirely, hiding that the ASM exists with nobody assigned yet.
        mrGroups = groupsRaw
          .map(g => ({
            groupNip: g.nip,
            groupName: g.name,
            groupRole: g.role,
            mrNips: g.mrNips,
            submittedNips: new Set(g.mrNips.filter(n => submittedNips.has(n))),
          }));
      }
    }
  }

  // Progress approval per status (2026-08-10) — "chart untuk tau progress
  // approval nya... bar draft, bar submitted ke ASM, bar submitted ke SM,
  // dst", scoped ke subtree actor lewat visibleFilter yang sama dipakai
  // tabel "Semua POA" di bawah (ASM lihat progress MR-nya, SM lihat
  // progress ASM+MR di bawahnya, dst — bukan query/RBAC baru). Discoped ke
  // mrProgressPeriod yang sama dengan panel "Progres Submit MR" di atas
  // supaya kedua panel selalu menunjuk ke kuartal yang sama.
  let statusCounts: Partial<Record<PoaStatus, number>> = {};
  if (!isMR && mrProgressPeriod) {
    const statusRows = await prisma.poaForm.groupBy({
      by: ["status"],
      where: { AND: [visibleFilter, { period: mrProgressPeriod }] },
      _count: { _all: true },
    }) as { status: PoaStatus; _count: { _all: number } }[];
    statusCounts = Object.fromEntries(statusRows.map(r => [r.status, r._count._all]));
  }

  const availableQuarters = await availableQuartersPromise;

  return (
    <div className="space-y-6">
      {/* Action-buttons row — was inline next to the header title in the
          shell; moved here since the Export Excel button needs
          mrProgressPeriod, which only exists once the heavy MR-progress
          computation above resolves (see comment on the Suspense in
          DashboardPage). */}
      <div className="flex items-center justify-end gap-2">
        {eligible && (
          actor.project === "OMEGA" ? (
            <Link href="/sc/new"><Button>+ Buat POA Baru</Button></Link>
          ) : (
            <Link href="/poa/new"><Button>+ Buat POA Baru</Button></Link>
          )
        )}
        {/* SFE used to be excluded here (2026-07-24, "monitoring-only") since
            the full team export goes well past what /summary shows — reversed
            2026-08-14 per explicit request: SFE (and VIEWER, already unaffected
            by this check) should get the bulk export too, not just per-POA
            one-by-one via canView. See matching block in /api/export/team.
            Quarter picker (2026-09-23) replaces the two hardcoded "Kuartal
            Ini"/"Semua Periode" links — /api/export/team already accepts any
            explicit ?period=YYYY-QN, this just exposes that as a dropdown
            instead of only current-quarter/all. recentQuarters() is pure date
            math (no DB query), so it's free even at ADMIN/GM's company-wide
            scope per docs/PERFORMANCE.md. */}
        {!isMR && availableQuarters.length > 0 && <DashboardExportButton quarters={availableQuarters} />}
      </div>

      {!isMR && pendingCount > 0 && (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Menunggu Tindakan Anda</CardTitle>
              <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
                {pendingCount} POA menunggu persetujuan Anda
              </p>
            </div>
            <Link href="/approvals">
              <Button size="sm" variant="secondary">Lihat Persetujuan →</Button>
            </Link>
          </div>
        </Card>
      )}

      {!isMR && mrGroups.length > 0 && mrProgressPeriod && (
        <Card>
          <CardHeader>
            <CardTitle>Progres Submit MR</CardTitle>
            <span className="text-xs px-2 py-0.5 rounded"
              style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-faint)" }}>
              Periode {mrProgressPeriod}
            </span>
          </CardHeader>
          <div className="space-y-3">
            {mrGroups.map((g) => {
              const total   = g.mrNips.length;
              const done    = g.submittedNips.size;
              const isEmpty = total === 0;
              const pct     = total > 0 ? (done / total) * 100 : 0;
              const allDone = !isEmpty && done === total;
              const noneDone = !isEmpty && done === 0;
              return (
                <div key={g.groupNip}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                        {g.groupName}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded"
                        style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-faint)" }}>
                        {g.groupRole}
                      </span>
                    </div>
                    <span className="text-sm font-semibold tabular-nums"
                      style={{ color: isEmpty ? "var(--color-text-faint)" : allDone ? "var(--color-success, #16a34a)" : noneDone ? "var(--color-danger, #dc2626)" : "var(--color-text)" }}>
                      {isEmpty ? "0 MR" : `${done}/${total}`}
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                    <div className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: isEmpty ? "0%" : `${pct}%`,
                        background: allDone ? "var(--color-success, #16a34a)" : noneDone ? "var(--color-danger, #dc2626)" : "var(--color-blue, #2563eb)",
                      }} />
                  </div>
                  {isEmpty ? (
                    <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                      Belum ada MR di bawahnya
                    </p>
                  ) : !allDone && (
                    <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                      {total - done} MR belum submit
                    </p>
                  )}
                </div>
              );
            })}

            {/* Totals */}
            {mrGroups.length > 1 && (() => {
              const totalMR   = mrGroups.reduce((s, g) => s + g.mrNips.length, 0);
              const doneTotal = mrGroups.reduce((s, g) => s + g.submittedNips.size, 0);
              return (
                <div className="flex items-center justify-between pt-3 text-sm"
                  style={{ borderTop: "1px solid var(--color-border)" }}>
                  <span style={{ color: "var(--color-text-muted)" }}>Total</span>
                  <span className="font-semibold" style={{ color: "var(--color-text)" }}>
                    {doneTotal} dari {totalMR} MR sudah submit
                  </span>
                </div>
              );
            })()}
          </div>
        </Card>
      )}

      {!isMR && mrProgressPeriod && Object.keys(statusCounts).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Progress Approval</CardTitle>
            <span className="text-xs px-2 py-0.5 rounded"
              style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-faint)" }}>
              Periode {mrProgressPeriod}
            </span>
          </CardHeader>
          <PoaStatusProgressChart counts={statusCounts} />
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{isMR ? "POA Saya" : "Semua POA"}</CardTitle>
        </CardHeader>

        {!isMR && (
          <form method="GET" className="mb-4 flex items-center gap-2">
            <input type="hidden" name="size" value={pageSizeParam} />
            <input
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Cari nama atau NIP MR..."
              className="w-full max-w-xs rounded-md px-3 py-1.5 text-sm"
              style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
            />
            <Button type="submit" size="sm" variant="secondary">Cari</Button>
            {q && (
              <Link href={buildPageHref(1, pageSizeParam)} className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                Reset
              </Link>
            )}
          </form>
        )}

        {recentPoas.length === 0 ? (
          q ? (
            <p className="py-10 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
              Tidak ada POA untuk pencarian &quot;{q}&quot;.
            </p>
          ) : (
            <EmptyState eligible={eligible} role={displayRole(session.role, session.jabatan)} project={actor.project} />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <th className="pb-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>MR</th>
                  <th className="pb-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Period</th>
                  <th className="pb-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Status</th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Target</th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Estimasi</th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Ratio %</th>
                  <th className="pb-3 text-right text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>% Budget</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {recentPoas.map((poa) => {
                  const target = poa._target;
                  const budgetOver = poa._pctBudget != null && poa._pctBudget > 42.5;
                  return (
                  <tr key={poa.id}>
                    <td className="py-3">
                      <p className="font-medium" style={{ color: "var(--color-text)" }}>{poa.owner.name}</p>
                      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{poa.owner.nip}</p>
                    </td>
                    <td className="py-3" style={{ color: "var(--color-text)" }}>{poa.period}</td>
                    <td className="py-3"><StatusBadge status={poa.status} version={poa.version} /></td>
                    <td className="py-3 text-right text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                      {target != null ? formatRp(target) : <span style={{ color: "var(--color-text-faint)" }}>-</span>}
                    </td>
                    <td className="py-3 text-right text-xs font-medium" style={{ color: "var(--color-text)" }}>
                      {poa._totalEst > 0 ? formatRp(poa._totalEst) : <span style={{ color: "var(--color-text-faint)" }}>-</span>}
                    </td>
                    <td className="py-3 text-right text-xs font-medium">
                      {poa._ratioEstimasi != null ? (
                        <span style={{ color: poa._ratioEstimasi >= 100 ? "var(--color-success, #16a34a)" : "var(--color-warning, #f59e0b)" }}>
                          {poa._ratioEstimasi.toFixed(1)}%
                        </span>
                      ) : <span style={{ color: "var(--color-text-faint)" }}>-</span>}
                    </td>
                    <td className="py-3 text-right text-xs font-medium">
                      {poa._pctBudget != null ? (
                        <span style={{ color: budgetOver ? "var(--color-red)" : "var(--color-text-muted)" }}>
                          {poa._pctBudget.toFixed(1)}%
                        </span>
                      ) : <span style={{ color: "var(--color-text-faint)" }}>-</span>}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {addableDoctorPoaIds.has(poa.id) && (
                          <Link href={`/poa/${poa.id}/edit`} className="text-xs font-medium"
                            style={{ color: "var(--color-text-muted)" }}>
                            Tambah
                          </Link>
                        )}
                        <Link href={`/poa/${poa.id}`} style={{ color: "var(--color-blue)" }} className="text-xs font-medium">
                          Detail
                        </Link>
                        {/* Owner can delete their own POA regardless of status/approval
                            progress (2026-09-11 decision) — deliberately NOT gated by
                            editablePoaIds/canEdit, which locks once someone above the
                            owner has approved (that lock is about editing content, not
                            about withdrawing the whole POA). Mirrors deletePoaAction's
                            own ownership check. */}
                        {(poa.ownerId === actor.nip || actor.role === "ADMIN") && (
                          <DeletePoaButton poaId={poa.id} period={poa.period} />
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {recentPoas.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 mt-3"
            style={{ borderTop: "1px solid var(--color-border)" }}>
            <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
              Menampilkan {pageSize ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, totalPoaCount)}` : `1-${totalPoaCount}`} dari {totalPoaCount} POA
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1 text-xs" style={{ color: "var(--color-text-faint)" }}>
                <span>Tampilkan:</span>
                {(["25", "50", "100", "all"] as const).map((s) => (
                  <Link key={s} href={buildPageHref(1, s, q)}
                    className="rounded px-1.5 py-0.5"
                    style={{
                      background: pageSizeParam === s ? "var(--color-blue-light)" : "transparent",
                      color: pageSizeParam === s ? "var(--color-blue)" : "var(--color-text-faint)",
                      fontWeight: pageSizeParam === s ? 600 : 400,
                    }}>
                    {s === "all" ? "Semua" : s}
                  </Link>
                ))}
              </div>
              {pageSize && totalPages > 1 && (
                <div className="flex items-center gap-1 text-xs">
                  <Link href={buildPageHref(Math.max(1, page - 1), pageSizeParam, q)}
                    className="rounded px-2 py-1"
                    style={{
                      color: page <= 1 ? "var(--color-text-faint)" : "var(--color-text-muted)",
                      pointerEvents: page <= 1 ? "none" : "auto",
                      border: "1px solid var(--color-border)",
                    }}>
                    ← Prev
                  </Link>
                  <span style={{ color: "var(--color-text-muted)" }}>Hal {page} / {totalPages}</span>
                  <Link href={buildPageHref(Math.min(totalPages, page + 1), pageSizeParam, q)}
                    className="rounded px-2 py-1"
                    style={{
                      color: page >= totalPages ? "var(--color-text-faint)" : "var(--color-text-muted)",
                      pointerEvents: page >= totalPages ? "none" : "auto",
                      border: "1px solid var(--color-border)",
                    }}>
                    Next →
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function EmptyState({ eligible, role, project }: { eligible: boolean; role: string; project?: string | null }) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        {eligible
          ? "Belum ada POA. Buat POA pertama Anda."
          : `Belum ada POA yang perlu ditinjau sebagai ${role}.`}
      </p>
      {eligible && (
        <Link href={project === "OMEGA" ? "/sc/new" : "/poa/new"} className="mt-3 inline-block">
          <Button size="sm">Buat POA</Button>
        </Link>
      )}
    </div>
  );
}
