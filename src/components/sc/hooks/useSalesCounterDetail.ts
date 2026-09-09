import { useState, useMemo, useEffect, useTransition } from "react";
import { quarterToMonths } from "@/lib/quarterUtils";
import { getB3ByQuarter } from "@/lib/b3Utils";
import type { ScDraftFormItem } from "../types";
import { getScCashbackPoaAction, getHistorySalesAction, postHistorySalesAction } from "@/app/actions/canvasser";
import { calculateCashbackDetails } from "../edit/hooks/useSalesCounterCashback";
import { parseOutletHistorySales } from "@/lib/historySalesUtils";

export function useSalesCounterDetail({
  scDrafts = [],
  poaPeriod,
  showSubmit,
  userRole,
  canApprove,
  canFastTrack,
}: {
  scDrafts?: ScDraftFormItem[];
  poaPeriod: string;
  showSubmit?: boolean;
  userRole?: string;
  canApprove?: boolean;
  canFastTrack?: boolean;
}) {
  const safeScDrafts = Array.isArray(scDrafts) ? scDrafts : [];
  const [cashbackData, setCashbackData] = useState<any>(null);
  const [historySalesMap, setHistorySalesMap] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    getScCashbackPoaAction().then((res) => setCashbackData(res));
  }, []);

  const b3Info = useMemo(() => {
    try {
      return getB3ByQuarter(poaPeriod);
    } catch {
      return null;
    }
  }, [poaPeriod]);

  useEffect(() => {
    if (!b3Info) return;
    const missingDrafts = safeScDrafts.filter(
      (d) => d.kodePI && d.historySalesQuarter == null && !historySalesMap.has(d.kodePI)
    );
    if (missingDrafts.length === 0) return;

    missingDrafts.forEach((draft) => {
      if (!draft.kodePI) return;
      const scProCodes = (draft.products || [])
        .filter((p: any) => p.isScProduct !== false)
        .map((p: any) => p.kodeProduk)
        .filter(Boolean);

      if (scProCodes.length === 0) {
        setHistorySalesMap((prev) => new Map(prev).set(draft.kodePI, 0));
        return;
      }

      postHistorySalesAction([draft.kodePI], b3Info.targetPeriods, scProCodes).then((res) => {
        const parsed = parseOutletHistorySales(res, draft.kodePI);
        if (parsed.totalSales > 0) {
          setHistorySalesMap((prev) => new Map(prev).set(draft.kodePI, parsed.totalSales));
        } else {
          // Fallback to legacy getHistorySalesAction strictly filtered by SC codes
          const targetPeriodsSet = new Set((b3Info.targetPeriods || []).map(Number));
          const scCodesSet = new Set(scProCodes);
          getHistorySalesAction(draft.kodePI, false).then((legacyRes) => {
            if (legacyRes?.data && Array.isArray(legacyRes.data)) {
              let total = 0;
              for (const it of legacyRes.data) {
                const itemPeriod = Number(it.period);
                const salesVal = Number(it.sales_value) || 0;
                if (targetPeriodsSet.has(itemPeriod) && salesVal > 0 && it.code && scCodesSet.has(it.code)) {
                  total += salesVal;
                }
              }
              if (total > 0) {
                setHistorySalesMap((prev) => new Map(prev).set(draft.kodePI, total));
              }
            }
          });
        }
      });
    });
  }, [safeScDrafts, b3Info, historySalesMap]);

  const actionableIds = useMemo(() => {
    if (showSubmit) {
      return safeScDrafts.filter((d) => d.status === "DRAFT" || d.status === "REVISI").map((d) => d.id);
    }
    if (canApprove) {
      return safeScDrafts
        .filter((d) => {
          if (d.status === "DRAFT" || d.status === "REVISI" || d.status === "APPROVED_BY_NSM") {
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
    return safeScDrafts.map((d) => d.id);
  }, [safeScDrafts, showSubmit, canApprove, userRole, canFastTrack]);

  const [checked, setChecked] = useState<Set<string>>(() =>
    canApprove && !showSubmit ? new Set() : new Set(actionableIds)
  );

  useEffect(() => {
    if (!canApprove || showSubmit) {
      setChecked(new Set(actionableIds));
    }
  }, [actionableIds, canApprove, showSubmit]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setChecked((prev) => {
      const allActionableChecked =
        actionableIds.length > 0 && actionableIds.every((id) => prev.has(id));
      if (allActionableChecked) {
        const next = new Set(prev);
        for (const id of actionableIds) next.delete(id);
        return next;
      } else {
        const next = new Set(prev);
        for (const id of actionableIds) next.add(id);
        return next;
      }
    });
  }

  const quarterMonths = useMemo(() => {
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

  // Computations across selected SC drafts
  const metrics = useMemo(() => {
    let totalEstimasiSales = 0;
    let totalHistorySalesQuarter = 0;
    let totalNilaiSc = 0;
    let totalDiskon = 0;
    let totalCashback = 0;
    let totalEntertain = 0;

    let tercacahEstimasiSales = 0;
    let tercacahNilaiSc = 0;

    const monthlyBreakdownMap = new Map<string, { estimasiSales: number; nilaiSc: number }>();
    for (const m of quarterMonths) {
      monthlyBreakdownMap.set(m, { estimasiSales: 0, nilaiSc: 0 });
    }

    const distinctProducts = new Set<string>();
    const distinctPersons = new Set<string>();
    let totalProductEntries = 0;

    for (const draft of selectedDrafts) {
      const histVal = draft.historySalesQuarter ?? historySalesMap.get(draft.kodePI) ?? 0;
      totalHistorySalesQuarter += histVal;

      const lama = draft.lamaPeriode || 3;

      const startYear = parseInt(draft.periodeAwal.slice(0, 4), 10);
      const startMonth = parseInt(draft.periodeAwal.slice(4, 6), 10);
      let overlapCount = 0;
      for (let i = 0; i < lama; i++) {
        const d = new Date(startYear, startMonth - 1 + i, 1);
        const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (quarterMonths.includes(yyyymm)) {
          overlapCount++;
        }
      }

      const cbDetails = calculateCashbackDetails({
        cashbackData,
        selectedProducts: draft.products.map((p) => ({
          kodeProduk: p.kodeProduk,
          qtyPerBulan: String(p.qtyPerBulan || 0),
          persenCashback: String(p.persenCashback || 0),
        })),
        masterProducts: draft.products.map((p) => ({
          kodeProduk: p.kodeProduk,
          hna: String(p.hnaSJ || 0),
          konversiPembagi: String(p.konversiPembagi || 1),
        })),
        lamaPeriode: draft.lamaPeriode,
      });

      for (const p of draft.persons) {
        distinctPersons.add(p.nik_ktp);
      }

      for (const p of draft.products) {
        if (!p.kodeProduk) continue;
        distinctProducts.add(p.kodeProduk);
        totalProductEntries++;

        const hnaSJ = p.hnaSJ || 0;
        const qty = p.qtyPerBulan || 0;

        const estSalesPerMonth = qty * hnaSJ;
        const estSalesFull = estSalesPerMonth * lama;

        const pctMatriks = p.persenMatriksSc || 0;
        const scVal = p.salesCounterValue;
        const scMin = p.salesCounterMinimum || 0;

        let nilaiScPerMonth = 0;
        if (scVal != null && scVal > 0) {
          nilaiScPerMonth = qty >= scMin ? qty * scVal : 0;
        } else {
          nilaiScPerMonth = estSalesPerMonth * (pctMatriks / 100);
        }
        const nilaiScFull = nilaiScPerMonth * lama;

        const diskonFull = estSalesFull * ((p.persenDiskon || 0) / 100);
        const cashbackFull = cashbackData
          ? (cbDetails.resultMap.get(p.kodeProduk) ?? 0)
          : estSalesFull * ((p.persenCashback || 0) / 100);

        totalEstimasiSales += estSalesFull;
        totalNilaiSc += nilaiScFull;
        totalDiskon += diskonFull;
        totalCashback += cashbackFull;

        if (lama > 0 && overlapCount > 0) {
          tercacahEstimasiSales += (estSalesFull / lama) * overlapCount;
          tercacahNilaiSc += (nilaiScFull / lama) * overlapCount;
        }

        // Add to monthly breakdown
        for (let i = 0; i < lama; i++) {
          const d = new Date(startYear, startMonth - 1 + i, 1);
          const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
          if (monthlyBreakdownMap.has(yyyymm)) {
            const cur = monthlyBreakdownMap.get(yyyymm)!;
            monthlyBreakdownMap.set(yyyymm, {
              estimasiSales: cur.estimasiSales + estSalesPerMonth,
              nilaiSc: cur.nilaiSc + nilaiScPerMonth,
            });
          }
        }
      }

      // Entertain calculation
      const draftEntertain = draft.entertainItems.reduce((s, e) => s + (e.biayaEntertain || 0), 0);
      totalEntertain += draftEntertain;
    }

    const totalBudgetSc = totalNilaiSc + totalDiskon + totalCashback + totalEntertain;

    return {
      totalEstimasiSales,
      totalHistorySalesQuarter,
      historyQuarterLabel: b3Info?.rangeLabel || "",
      totalNilaiSc,
      totalDiskon,
      totalCashback,
      totalEntertain,
      totalBudgetSc,
      tercacahEstimasiSales,
      tercacahNilaiSc,
      monthlyBreakdownMap,
      productCount: distinctProducts.size,
      personCount: distinctPersons.size,
      totalProductEntries,
    };
  }, [selectedDrafts, quarterMonths, cashbackData, historySalesMap, b3Info]);

  const [isSubmitting, startSubmit] = useTransition();
  const [submitNotes, setSubmitNotes] = useState("");

  return {
    checked,
    toggle,
    toggleAll,
    allSelected: actionableIds.length > 0 && actionableIds.every((id) => checked.has(id)),
    actionableIds,
    actionableCount: actionableIds.length,
    selectedActionableCount: actionableIds.filter((id) => checked.has(id)).length,
    selectedDrafts,
    quarterMonths,
    metrics,
    b3Info,
    isSubmitting,
    startSubmit,
    submitNotes,
    setSubmitNotes,
  };
}
