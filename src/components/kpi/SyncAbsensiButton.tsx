"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { syncKpiAbsensiAction } from "@/app/actions/kpi";
import { syncNonHospitalAction } from "@/app/actions/nonHospitalEvaluation";

/** Manual trigger for the SIPP Absensi sync (see src/lib/sync/kpiAbsensiSync.ts) — no automatic schedule, ADMIN presses this when they want fresh data. */
export function SyncAbsensiButton({ period, scheme = "hospital" }: { period: string; scheme?: "hospital" | "non-hospital" }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run() {
    startTransition(async () => {
      if (scheme === "non-hospital") {
        const { absensi: a, scMenang: sc } = await syncNonHospitalAction(period);
        setMessage(`Absensi: ${a.updated}/${a.scanned} diperbarui, ${a.noData} tanpa data · SC Menang: ${sc.updated}/${sc.owners} MR diperbarui${sc.skippedManual ? `, ${sc.skippedManual} dilewati (manual)` : ""}`);
        return;
      }
      const result = await syncKpiAbsensiAction(period);
      setMessage(
        result.errors.length > 0 && result.updated === 0 && result.scanned === 0
          ? result.errors[0]
          : `Sinkron: ${result.updated}/${result.scanned} diperbarui, ${result.skippedManual} dilewati (manual), ${result.noData} tanpa data`
      );
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="ghost" onClick={run} loading={isPending}>
        {scheme === "non-hospital" ? "Sync Absensi & SC Menang" : "Sync Absensi dari SIPP"}
      </Button>
      {message && (
        <p className="text-xs text-right" style={{ color: "var(--color-text-faint)" }}>{message}</p>
      )}
    </div>
  );
}
