"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { PoaDoctorApproval, PoaForm, PoaLineItem, User } from "@prisma/client";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { quarterToMonths } from "@/lib/quarterUtils";
import {
  StatsPanel, formatRp, toNum, doctorKey,
  computeDummyTarget, computeDummySales,
} from "@/components/poa/DraftChecklist";
import type { ActivePsspRow } from "@/app/actions/customer";

export interface PendingPoaRow extends PoaForm {
  owner: User;
  items: PoaLineItem[];
  doctorApprovals: PoaDoctorApproval[];
}

// ─── MR row ─────────────────────────────────────────────────────────────────

function MrRow({ poa }: { poa: PendingPoaRow }) {
  const est = poa.items.reduce((s, it) => s + toNum(it.rencanaTotalBiaya), 0);
  const doctorCount = new Set(poa.items.map(doctorKey)).size;
  // Per-doctor approve progress (2026-08-19 bug fix follow-up: "di samping
  // button review ada count berapa yang belum approve dan yang sudah") —
  // "disetujui" = fully approved, i.e. no further holder pending. That's any
  // APPROVED_BY_* status, not just APPROVED_BY_NSM (2026-09-22 fix: a
  // doctor whose ceiling is ASM/SM/ASD/SD terminates at THAT status, not
  // NSM — the old NSM-only check miscounted those as "belum" even though
  // they were genuinely done). Everything else (still mid-chain, in REVISI,
  // or not yet submitted at all) counts as belum.
  const approvedCount = poa.doctorApprovals.filter((a) => a.status.startsWith("APPROVED_BY_")).length;
  const belumCount = doctorCount - approvedCount;

  return (
    <div className="flex items-center gap-3 py-3 px-2 rounded-lg">
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>{poa.owner.name}</span>
          <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>({poa.owner.nip})</span>
        </div>
        <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Periode {poa.period}</p>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right">
          <StatusBadge status={poa.status} version={poa.version} />
          <p className="text-xs mt-1" style={{ color: "var(--color-text-faint)" }}>
            {doctorCount} user · {est > 0 ? formatRp(est) : "-"}
          </p>
          <p className="text-xs mt-0.5">
            <span style={{ color: "var(--color-status-approved)" }}>{approvedCount} disetujui</span>
            <span style={{ color: "var(--color-text-faint)" }}> · </span>
            <span style={{ color: "var(--color-status-pending)" }}>{belumCount} belum</span>
          </p>
        </div>
        <Link href={`/poa/${poa.id}`}>
          <Button size="sm" variant="secondary">Review</Button>
        </Link>
      </div>
    </div>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function ApprovalsChecklist({ pending, activePssp = [] }: {
  pending: PendingPoaRow[];
  /** Still-active PSSP contracts for the doctors across all pending POAs, for the ringkasan. */
  activePssp?: ActivePsspRow[];
}) {
  const allItems = useMemo(() => pending.flatMap((p) => p.items), [pending]);
  const totalDoctorCount = useMemo(() => new Set(allItems.map(doctorKey)).size, [allItems]);

  // Dominant period among pending MRs — best-effort for the "Tercacah" quarter calc.
  const dominantPeriod = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of pending) counts.set(p.period, (counts.get(p.period) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }, [pending]);

  const quarterMonths = useMemo(() => {
    try { return quarterToMonths(dominantPeriod); } catch { return []; }
  }, [dominantPeriod]);

  // Stable dummy target/sales (not affected by checklist), seeded by the group of pending MRs.
  const { targetArea, dummySales } = useMemo(() => {
    const totalEst = allItems.reduce((s, it) => s + toNum(it.rencanaTotalBiaya), 0);
    const seed = pending.length > 0 ? pending.map((p) => p.id).sort().join("|") : "x";
    return {
      targetArea: computeDummyTarget(),
      dummySales: computeDummySales(seed, totalEst),
    };
  }, [pending, allItems]);

  if (pending.length === 0) return null;

  return (
    <div className="grid md:grid-cols-[3fr_2fr] gap-5 items-start">
      {/* Left: MR checklist */}
      <div className="space-y-4 min-w-0">
        <div className="md:hidden">
          <StatsPanel
            items={allItems}
            selectedDoctorCount={totalDoctorCount}
            totalDoctorCount={totalDoctorCount}
            targetArea={targetArea}
            salesFigures={dummySales}
            quarterMonths={quarterMonths}
          />
        </div>

        <Card>
          <div className="mb-3">
            <p className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>Daftar MR</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
              Klik &quot;Review&quot; untuk approve/reject per dokter.
            </p>
          </div>

          <div className="space-y-0.5">
            {pending.map((poa) => (
              <MrRow key={poa.id} poa={poa} />
            ))}
          </div>
        </Card>
      </div>

      {/* Right: stats panel — sticky like the per-POA detail view */}
      <div className="hidden md:block sticky top-8 max-h-[calc(100vh-5rem)] overflow-y-auto">
        <StatsPanel
          items={allItems}
          selectedDoctorCount={totalDoctorCount}
          totalDoctorCount={totalDoctorCount}
          targetArea={targetArea}
          salesFigures={dummySales}
          quarterMonths={quarterMonths}
          activePssp={activePssp}
        />
      </div>
    </div>
  );
}
