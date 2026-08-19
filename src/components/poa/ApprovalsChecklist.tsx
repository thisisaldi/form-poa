"use client";

import { useMemo, useState } from "react";
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

function MrRow({ poa, checked, onToggle }: { poa: PendingPoaRow; checked: boolean; onToggle: () => void }) {
  const est = poa.items.reduce((s, it) => s + toNum(it.rencanaTotalBiaya), 0);
  const doctorCount = new Set(poa.items.map(doctorKey)).size;
  // Per-doctor approve progress (2026-08-19 bug fix follow-up: "di samping
  // button review ada count berapa yang belum approve dan yang sudah") —
  // "disetujui" = fully approved to the end (APPROVED_BY_NSM); everything
  // else (still mid-chain, in REVISI, or not yet submitted at all) counts as
  // belum, regardless of which stage it's stuck at.
  const approvedCount = poa.doctorApprovals.filter((a) => a.status === "APPROVED_BY_NSM").length;
  const belumCount = doctorCount - approvedCount;

  return (
    <div className="flex items-center gap-3 py-3 px-2 rounded-lg" style={{ opacity: checked ? 1 : 0.5 }}>
      <label className="flex items-center gap-3 cursor-pointer flex-1 min-w-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="h-4 w-4 shrink-0 rounded"
          style={{ accentColor: "var(--color-blue)" }}
        />
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>{poa.owner.name}</span>
            <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>({poa.owner.nip})</span>
          </div>
          <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Periode {poa.period}</p>
        </div>
      </label>

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
  const allKeys = useMemo(() => pending.map((p) => p.id), [pending]);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(allKeys));

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setChecked(checked.size === allKeys.length ? new Set() : new Set(allKeys));
  }

  const allItems = useMemo(() => pending.flatMap((p) => p.items), [pending]);
  const selectedItems = useMemo(
    () => pending.filter((p) => checked.has(p.id)).flatMap((p) => p.items),
    [pending, checked]
  );

  const totalDoctorCount = useMemo(() => new Set(allItems.map(doctorKey)).size, [allItems]);
  const selectedDoctorCount = useMemo(() => new Set(selectedItems.map(doctorKey)).size, [selectedItems]);

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

  const allChecked = checked.size === allKeys.length;

  return (
    <div className="grid md:grid-cols-[3fr_2fr] gap-5 items-start">
      {/* Left: MR checklist */}
      <div className="space-y-4 min-w-0">
        <div className="md:hidden">
          <StatsPanel
            items={selectedItems}
            selectedDoctorCount={selectedDoctorCount}
            totalDoctorCount={totalDoctorCount}
            targetArea={targetArea}
            salesFigures={dummySales}
            quarterMonths={quarterMonths}
          />
        </div>

        <Card>
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div>
              <p className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>Daftar MR</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                Centang MR yang ingin dihitung statistiknya. Klik &quot;Review&quot; untuk approve/reject per dokter.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="text-xs px-2.5 py-1 rounded-md font-medium"
                style={{ background: "var(--color-bg-subtle)", color: "var(--color-blue)", border: "1px solid var(--color-border)" }}
                onClick={toggleAll}
              >
                {allChecked ? "Unselect All" : "Select All"}
              </button>
            </div>
          </div>

          <div className="space-y-0.5">
            {pending.map((poa) => (
              <MrRow key={poa.id} poa={poa} checked={checked.has(poa.id)} onToggle={() => toggle(poa.id)} />
            ))}
          </div>
        </Card>
      </div>

      {/* Right: stats panel — sticky like the per-POA detail view */}
      <div className="hidden md:block sticky top-8 max-h-[calc(100vh-5rem)] overflow-y-auto">
        <StatsPanel
          items={selectedItems}
          selectedDoctorCount={selectedDoctorCount}
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
