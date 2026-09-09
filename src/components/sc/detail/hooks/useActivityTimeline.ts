"use client";

import { useState, useMemo } from "react";
import type {
  SalesCounterAuditLogItem,
  AvailableOutletItem,
} from "../types/timeline";

export function useActivityTimeline({
  auditLogs = [],
  outlets = [],
}: {
  auditLogs: SalesCounterAuditLogItem[];
  outlets?: Array<{ kodePI: string; namaOutlet?: string | null }>;
}) {
  const [selectedOutlet, setSelectedOutlet] = useState<string>("ALL");

  const availableOutlets = useMemo(() => {
    const map = new Map<string, AvailableOutletItem>();

    // Daftarkan outlet dari data drafts jika ada
    for (const o of outlets) {
      if (o.kodePI) {
        map.set(o.kodePI, {
          kodePI: o.kodePI,
          namaOutlet: o.namaOutlet || o.kodePI,
          count: 0,
        });
      }
    }

    // Hitung kemunculan log per outlet
    for (const log of auditLogs) {
      const k = log.kodePI || "UNKNOWN";
      if (!map.has(k)) {
        map.set(k, {
          kodePI: k,
          namaOutlet: log.namaOutlet || (k === "UNKNOWN" ? "Umum / Tanpa Outlet" : k),
          count: 0,
        });
      }
      const item = map.get(k)!;
      item.count += 1;
      if (log.namaOutlet && item.namaOutlet === k) {
        item.namaOutlet = log.namaOutlet;
      }
    }

    return Array.from(map.values()).sort((a, b) => a.namaOutlet.localeCompare(b.namaOutlet));
  }, [auditLogs, outlets]);

  const filteredLogs = useMemo(() => {
    if (selectedOutlet === "ALL") return auditLogs;
    return auditLogs.filter((log) => (log.kodePI || "UNKNOWN") === selectedOutlet);
  }, [auditLogs, selectedOutlet]);

  return {
    selectedOutlet,
    setSelectedOutlet,
    availableOutlets,
    filteredLogs,
  };
}
