"use client";

import { useState, useMemo, useTransition } from "react";
import { quarterToMonths } from "@/lib/quarterUtils";
import type { ScDraftFormItem } from "../types";

export function useSalesCounterDetail({
  scDrafts = [],
  poaPeriod,
  showSubmit,
}: {
  scDrafts?: ScDraftFormItem[];
  poaPeriod: string;
  showSubmit?: boolean;
}) {
  const safeScDrafts = Array.isArray(scDrafts) ? scDrafts : [];

  const allIds = useMemo(() => safeScDrafts.map((d) => d.id), [safeScDrafts]);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(allIds));

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setChecked(checked.size === allIds.length ? new Set() : new Set(allIds));
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
      const lama = draft.lamaPeriode || 3;
      const days = draft.hariKerjaBulan || 0;

      // Calculate overlap with quarter months
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

      for (const p of draft.persons) {
        distinctPersons.add(p.nik_ktp);
      }

      for (const p of draft.products) {
        if (!p.kodeProduk) continue;
        distinctProducts.add(p.kodeProduk);
        totalProductEntries++;

        const hnaSJ = p.hnaSJ || 0;
        const konv = p.konversiPembagi || 1;
        const hnaST = hnaSJ / konv;

        const pembeli = p.pembeliHari || 0;
        const qty = p.qtyCustomerBaru || 0;

        const estSalesPerMonth = pembeli * qty * days * hnaST;
        const estSalesFull = estSalesPerMonth * lama;

        const pctMatriks = p.persenMatriksSc || 0;
        const nilaiScPerMonth = estSalesPerMonth * (pctMatriks / 100);
        const nilaiScFull = nilaiScPerMonth * lama;

        const diskonFull = estSalesFull * ((p.persenDiskon || 0) / 100);
        const cashbackFull = estSalesFull * ((p.persenCashback || 0) / 100);

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
  }, [selectedDrafts, quarterMonths]);

  const [isSubmitting, startSubmit] = useTransition();
  const [submitNotes, setSubmitNotes] = useState("");

  return {
    checked,
    toggle,
    toggleAll,
    allSelected: checked.size === allIds.length,
    selectedDrafts,
    quarterMonths,
    metrics,
    isSubmitting,
    startSubmit,
    submitNotes,
    setSubmitNotes,
  };
}
