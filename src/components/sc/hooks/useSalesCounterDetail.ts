import { useState, useMemo, useEffect, useRef, useTransition } from "react";
import { quarterToMonths } from "@/lib/quarterUtils";
import { getB3RollingPeriodInfo } from "@/lib/b3Utils";
import type { ScDraftFormItem } from "../types";
import { getScCashbackPoaAction, postHistorySalesAction } from "@/app/actions/canvasser";
import { computeScMetrics } from "@/lib/scFormMetrics";
import { parseOutletHistorySales } from "@/lib/historySalesUtils";

export function useSalesCounterDetail({
  scDrafts = [],
  poaPeriod,
  showSubmit,
  userRole,
  canApprove,
  canFastTrack,
  onRefetch,
}: {
  scDrafts?: ScDraftFormItem[];
  poaPeriod?: string;
  showSubmit?: boolean;
  userRole?: string;
  canApprove?: boolean;
  canFastTrack?: boolean;
  onRefetch?: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [cashbackData, setCashbackData] = useState<any>(null);
  const [historySalesMap, setHistorySalesMap] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    getScCashbackPoaAction().then((res) => setCashbackData(res));
  }, []);

  const safeScDrafts = Array.isArray(scDrafts) ? scDrafts : [];

  const b3Info = useMemo(() => {
    if (!poaPeriod) return null;
    try {
      return getB3RollingPeriodInfo(poaPeriod);
    } catch {
      return null;
    }
  }, [poaPeriod]);

  const fetchedOutletsRef = useRef<Set<string>>(new Set());
  const inFlightOutletsRef = useRef<Set<string>>(new Set());

  // Fetch B3 history sales for each draft in parallel
  useEffect(() => {
    if (!b3Info?.targetPeriods || b3Info.targetPeriods.length === 0) return;

    safeScDrafts.forEach((draft) => {
      if (!draft.kodePI) return;
      if (draft.historySalesQuarter != null) return;
      if (fetchedOutletsRef.current.has(draft.kodePI)) return;
      if (inFlightOutletsRef.current.has(draft.kodePI)) return;

      const scProCodes = (draft.products || [])
        .filter((p: any) => p.isScProduct !== false)
        .map((p: any) => p.kodeProduk)
        .filter(Boolean);

      if (scProCodes.length === 0) {
        fetchedOutletsRef.current.add(draft.kodePI);
        setHistorySalesMap((prev) => new Map(prev).set(draft.kodePI, 0));
        return;
      }

      inFlightOutletsRef.current.add(draft.kodePI);

      postHistorySalesAction([draft.kodePI], b3Info.targetPeriods, scProCodes)
        .then((res) => {
          const parsed = parseOutletHistorySales(res, draft.kodePI);
          const total = parsed.totalSales || 0;
          setHistorySalesMap((prev) => new Map(prev).set(draft.kodePI, total));
        })
        .catch(() => {
          setHistorySalesMap((prev) => new Map(prev).set(draft.kodePI, 0));
        })
        .finally(() => {
          inFlightOutletsRef.current.delete(draft.kodePI);
          fetchedOutletsRef.current.add(draft.kodePI);
        });
    });
  }, [safeScDrafts, b3Info]);

  const isFullyApproved = (status: string) => {
    return ["APPROVED_BY_NSM", "APPROVED_BY_ASD", "APPROVED_BY_SD"].includes(status);
  };

  const isPendingSubmission = (status: string) => {
    return [
      "SUBMITTED_TO_ASM",
      "APPROVED_BY_ASM",
      "SUBMITTED_TO_SM",
      "APPROVED_BY_SM",
      "SUBMITTED_TO_NSM",
      "SUBMITTED_TO_ASD",
      "APPROVED_BY_ASD",
      "SUBMITTED_TO_SD",
    ].includes(status);
  };

  const actionableIds = useMemo(() => {
    if (canApprove) {
      return safeScDrafts
        .filter((d) => {
          if (d.status === "DRAFT" || d.status === "REVISI" || isFullyApproved(d.status)) {
            return false;
          }
          if (userRole === "ADMIN") {
            return ["SUBMITTED_TO_ASM", "SUBMITTED_TO_SM", "SUBMITTED_TO_NSM"].includes(d.status);
          }
          if (userRole === "ASM") {
            return d.status === "SUBMITTED_TO_ASM";
          }
          if (userRole === "SM") {
            return d.status === "SUBMITTED_TO_SM" || (canFastTrack && d.status === "SUBMITTED_TO_ASM");
          }
          if (userRole === "NSM") {
            return d.status === "SUBMITTED_TO_NSM";
          }
          return ["SUBMITTED_TO_ASM", "SUBMITTED_TO_SM", "SUBMITTED_TO_NSM"].includes(d.status);
        })
        .map((d) => d.id);
    }
    // MR / Owner / Viewer: "Siap Diajukan" are outlets in DRAFT or REVISI
    return safeScDrafts.filter((d) => d.status === "DRAFT" || d.status === "REVISI").map((d) => d.id);
  }, [safeScDrafts, canApprove, userRole, canFastTrack]);

  const actionableIdsSet = useMemo(() => new Set(actionableIds), [actionableIds]);

  const filterCounts = useMemo(() => {
    let actionable = 0;
    let pending = 0;
    let approved = 0;
    let draftRevisi = 0;

    for (const d of safeScDrafts) {
      if (actionableIdsSet.has(d.id)) actionable++;
      if (isPendingSubmission(d.status)) pending++;
      if (isFullyApproved(d.status)) approved++;
      if (d.status === "DRAFT" || d.status === "REVISI") draftRevisi++;
    }

    return {
      all: safeScDrafts.length,
      actionable,
      pending,
      approved,
      draftRevisi,
    };
  }, [safeScDrafts, actionableIdsSet]);

  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIONABLE" | "PENDING" | "APPROVED" | "DRAFT_REVISI">("ALL");

  const filteredScDrafts = useMemo(() => {
    if (statusFilter === "ACTIONABLE") {
      return safeScDrafts.filter((d) => actionableIdsSet.has(d.id));
    }
    if (statusFilter === "PENDING") {
      return safeScDrafts.filter((d) => isPendingSubmission(d.status));
    }
    if (statusFilter === "APPROVED") {
      return safeScDrafts.filter((d) => isFullyApproved(d.status));
    }
    if (statusFilter === "DRAFT_REVISI") {
      return safeScDrafts.filter((d) => d.status === "DRAFT" || d.status === "REVISI");
    }
    return safeScDrafts;
  }, [statusFilter, safeScDrafts, actionableIdsSet]);

  const allIds = useMemo(() => safeScDrafts.map((d) => d.id), [safeScDrafts]);
  const filteredIds = useMemo(() => filteredScDrafts.map((d) => d.id), [filteredScDrafts]);

  const [checked, setChecked] = useState<Set<string>>(() =>
    canApprove && !showSubmit ? new Set() : new Set(allIds)
  );

  useEffect(() => {
    if (!canApprove || showSubmit) {
      setChecked(new Set(allIds));
    }
  }, [allIds, canApprove, showSubmit]);

  function handleStatusFilterChange(newFilter: "ALL" | "ACTIONABLE" | "PENDING" | "APPROVED" | "DRAFT_REVISI") {
    setStatusFilter(newFilter);
    if (newFilter === "APPROVED") {
      const approvedIds = safeScDrafts.filter((d) => isFullyApproved(d.status)).map((d) => d.id);
      setChecked(new Set(approvedIds));
    } else if (newFilter === "PENDING") {
      const pendingIds = safeScDrafts.filter((d) => isPendingSubmission(d.status)).map((d) => d.id);
      setChecked(new Set(pendingIds));
    } else if (newFilter === "ACTIONABLE") {
      const actIds = safeScDrafts.filter((d) => actionableIdsSet.has(d.id)).map((d) => d.id);
      setChecked(new Set(actIds));
    } else if (newFilter === "DRAFT_REVISI") {
      const drIds = safeScDrafts.filter((d) => d.status === "DRAFT" || d.status === "REVISI").map((d) => d.id);
      setChecked(new Set(drIds));
    } else {
      setChecked(new Set(allIds));
    }
  }

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allFilteredChecked = useMemo(() => {
    return filteredIds.length > 0 && filteredIds.every((id) => checked.has(id));
  }, [filteredIds, checked]);

  function toggleAll() {
    setChecked((prev) => {
      const next = new Set(prev);
      if (allFilteredChecked) {
        for (const id of filteredIds) {
          next.delete(id);
        }
      } else {
        for (const id of filteredIds) {
          next.add(id);
        }
      }
      return next;
    });
  }

  const quarterMonths = useMemo(() => {
    if (!poaPeriod) return [];
    try {
      return quarterToMonths(poaPeriod);
    } catch {
      return [];
    }
  }, [poaPeriod]);

  const selectedDrafts = useMemo(
    () => safeScDrafts.filter((d) => checked.has(d.id)),
    [safeScDrafts, checked]
  );

  // Computations across selected SC drafts (formula lives in src/lib/scFormMetrics.ts,
  // shared with the stored form summary)
  const metrics = useMemo(
    () =>
      computeScMetrics({
        drafts: selectedDrafts,
        quarterMonths,
        getCashbackData: () => cashbackData,
        historySalesMap,
        historyQuarterLabel: b3Info?.rangeLabel || "",
      }),
    [selectedDrafts, quarterMonths, cashbackData, historySalesMap, b3Info]
  );

  const [isSubmitting, startSubmit] = useTransition();
  const [submitNotes, setSubmitNotes] = useState("");

  // IDs that are selected AND can be submitted (DRAFT or REVISI)
  const submittableIds = useMemo(() => {
    const draftRevisiIds = new Set(
      safeScDrafts
        .filter((d) => d.status === "DRAFT" || d.status === "REVISI")
        .map((d) => d.id)
    );
    return Array.from(checked).filter((id) => draftRevisiIds.has(id));
  }, [checked, safeScDrafts]);

  return {
    checked,
    toggle,
    toggleAll,
    allSelected: allFilteredChecked,
    actionableIds,
    actionableCount: actionableIds.length,
    selectedActionableCount: actionableIds.filter((id) => checked.has(id)).length,
    submittableIds,
    selectedDrafts,
    quarterMonths,
    metrics,
    b3Info,
    isSubmitting,
    startSubmit,
    submitNotes,
    setSubmitNotes,
    statusFilter,
    setStatusFilter: handleStatusFilterChange,
    filterCounts,
    filteredScDrafts,
  };
}
