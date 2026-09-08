"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { syncKpiCallActivityAction } from "@/app/actions/kpi";

/** Manual trigger for the Exodus Call Activity sync (see src/lib/sync/kpiCallActivitySync.ts) — no automatic schedule, ADMIN presses this when they want fresh data. */
export function SyncCallActivityButton({ period }: { period: string }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run() {
    startTransition(async () => {
      const result = await syncKpiCallActivityAction(period);
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
        Sync Kunjungan dari Exodus
      </Button>
      {message && (
        <p className="text-xs text-right" style={{ color: "var(--color-text-faint)" }}>{message}</p>
      )}
    </div>
  );
}
