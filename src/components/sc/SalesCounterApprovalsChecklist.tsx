"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatRp } from "./detail/SalesCounterStatsPanel";

export interface MrApprovalGroup {
  ownerNip: string;
  ownerName: string;
  period: string;
  outletCount: number;
  totalBudgetSc: number;
  forms: {
    id: string;
    kodePI: string;
    namaOutlet: string;
    status: string;
    version: number;
  }[];
}

export function SalesCounterApprovalsChecklist({ mrGroups }: { mrGroups: MrApprovalGroup[] }) {
  if (mrGroups.length === 0) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          Tidak ada pengajuan Sales Counter yang menunggu persetujuan Anda saat ini.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {mrGroups.map((g) => (
        <Card key={`${g.period}_${g.ownerNip}`} className="p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-base" style={{ color: "var(--color-text)" }}>
                  {g.ownerName}
                </span>
                <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                  ({g.ownerNip})
                </span>
                <StatusBadge status={(g.forms[0]?.status as any) || "SUBMITTED_TO_ASM"} version={g.forms[0]?.version || 1} />
              </div>
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                Periode {g.period} · {g.outletCount} Outlet SC · Total Budget:{" "}
                <span className="font-semibold" style={{ color: "var(--color-blue)" }}>
                  {formatRp(g.totalBudgetSc)}
                </span>
              </p>
            </div>

            <div>
              <Link
                href={`/sc/${g.forms[0]?.id || g.period}`}
                className="px-4 py-1.5 rounded-md text-xs font-semibold inline-block text-white transition-opacity hover:opacity-90"
                style={{ background: "var(--color-blue)" }}
              >
                Review
              </Link>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
