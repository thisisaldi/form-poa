"use client";

import { useState, useMemo, useRef } from "react";
import { getScActivityLogsAction } from "@/app/actions/scActivityActions";
import type { AvailableOutletItem, SalesCounterAuditLogItem } from "../types/timeline";

const MAX_SEARCH_RESULTS = 10;

/**
 * Nothing is fetched until the user searches for and picks an outlet; then
 * only that outlet's logs are loaded (getScActivityLogsAction).
 */
export function useActivityTimeline({
  outlets = [],
}: {
  outlets: Array<{ formId: string; kodePI: string; namaOutlet?: string | null }>;
}) {
  const [query, setQuery] = useState("");
  const [selectedOutlet, setSelectedOutlet] = useState<AvailableOutletItem | null>(null);
  const [logs, setLogs] = useState<SalesCounterAuditLogItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const requestIdRef = useRef(0);

  const availableOutlets = useMemo(() => {
    const map = new Map<string, AvailableOutletItem>();
    for (const o of outlets) {
      if (!o.kodePI) continue;
      const existing = map.get(o.kodePI);
      if (existing) {
        existing.formIds.push(o.formId);
      } else {
        map.set(o.kodePI, {
          kodePI: o.kodePI,
          namaOutlet: o.namaOutlet || o.kodePI,
          formIds: [o.formId],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.namaOutlet.localeCompare(b.namaOutlet));
  }, [outlets]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return availableOutlets
      .filter((o) => o.namaOutlet.toLowerCase().includes(q) || o.kodePI.toLowerCase().includes(q))
      .slice(0, MAX_SEARCH_RESULTS);
  }, [availableOutlets, query]);

  const selectOutlet = (outlet: AvailableOutletItem) => {
    const requestId = ++requestIdRef.current;
    setSelectedOutlet(outlet);
    setQuery("");
    setLogs([]);
    setTruncated(false);
    setHasError(false);
    setIsLoading(true);
    getScActivityLogsAction(outlet.formIds)
      .then((res) => {
        if (requestId !== requestIdRef.current) return;
        setLogs(res.logs);
        setTruncated(res.truncated);
      })
      .catch(() => {
        if (requestId === requestIdRef.current) setHasError(true);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setIsLoading(false);
      });
  };

  const clearOutlet = () => {
    requestIdRef.current++;
    setSelectedOutlet(null);
    setLogs([]);
    setTruncated(false);
    setHasError(false);
    setIsLoading(false);
  };

  return {
    query,
    setQuery,
    availableOutlets,
    searchResults,
    selectedOutlet,
    selectOutlet,
    clearOutlet,
    logs,
    truncated,
    isLoading,
    hasError,
  };
}
