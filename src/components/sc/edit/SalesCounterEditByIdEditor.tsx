"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { saveSalesCounterFormAction } from "@/app/actions/scActions";
import {
  requestEditSalesCounterFormAction,
  grantEditSalesCounterFormAction,
  declineEditSalesCounterFormAction,
} from "@/app/actions/scApprovalActions";
import { ProductSelector } from "./ProductSelector";
import { ScSidebar } from "./ScSidebar";
import { UnitInput } from "./UnitInput";
import { Button } from "@/components/ui/Button";
import { BlastInTable } from "./BlastInTable";
import { PosmTable } from "./PosmTable";
import { PerincianBudgetModal } from "./PerincianBudgetModal";
import { OnlineApotekSalesWidget } from "./OnlineApotekSalesWidget";
import { KomposisiSalesWidget } from "./KomposisiSalesWidget";
import { useScToast } from "../ui/ScToast";
import { quarterToMonths, getPreviousQuarterInfo } from "@/lib/quarterUtils";
import { postHistorySalesAction } from "@/app/actions/canvasser";
import { parseOutletHistorySales } from "@/lib/historySalesUtils";

import type { SalesCounterEditByIdEditorProps } from "./types/editorProps";
import { formatHumanStatus, formatRpNumber as formatRp } from "./utils/formatEditUtils";
import { satuanLabel } from "./utils/productMatcherUtils";
import { SectionLabel } from "./ui";
import { useSalesCounterEditById } from "./hooks/useSalesCounterEditById";
import { SalesCounterProductBreakdownTable } from "../detail/SalesCounterProductBreakdownTable";
import { MonthlyBreakdownTable } from "./MonthlyBreakdownTable";
import { calculateProductDetailRows } from "../detail/utils/outletCalculationUtils";
import type { ScProductItemData } from "../types";

export function SalesCounterEditByIdEditor({
  scId,
  poaPeriod,
  kodePI,
  namaOutlet,
  is_sc,
  isBlastIn,
  isPosm,
  isOnline,
  persons,
  initialProducts,
  initialEntertainItems,
  initialPeriodeAwal,
  initialLamaPeriode,
  initialPersenResepDokter,
  initialJumlahKaryawan,
  initialJumlahPasien,
  initialJumlahPasienResep,
  initialJumlahPasienNonResep,
  masterProducts,
  readOnly = false,
  isOwner,
  userRole,
  status,
  hasPendingEditRequest = false,
  pendingEditRequestNotes = "",
}: SalesCounterEditByIdEditorProps) {
  const router = useRouter();
  const { showToast } = useScToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [posmVal, setPosmVal] = useState(0);

  const [requestEditBoxOpen, setRequestEditBoxOpen] = useState(false);
  const [requestEditReason, setRequestEditReason] = useState("");
  const [isRequestingEdit, setIsRequestingEdit] = useState(false);

  const [isRespondingEdit, setIsRespondingEdit] = useState(false);
  const [declineBoxOpen, setDeclineBoxOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const canRespondEdit = !isOwner && ["ASM", "SM", "NSM", "ADMIN"].includes(userRole || "") && hasPendingEditRequest;

  const handleRequestEditSubmit = async () => {
    if (isRequestingEdit) return;
    setIsRequestingEdit(true);
    try {
      const res = await requestEditSalesCounterFormAction([scId], requestEditReason);
      if (res.ok) {
        showToast("Permohonan edit berhasil dikirim ke Atasan.", "success");
        setRequestEditBoxOpen(false);
        router.refresh();
      } else {
        showToast(res.error || "Gagal mengajukan permohonan edit.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Terjadi kesalahan saat mengajukan permohonan edit.", "error");
    } finally {
      setIsRequestingEdit(false);
    }
  };

  const handleGrantEdit = async () => {
    if (isRespondingEdit) return;
    setIsRespondingEdit(true);
    try {
      const res = await grantEditSalesCounterFormAction([scId]);
      if (res.ok) {
        showToast("Izin edit telah disetujui. Status outlet dikembalikan ke Revisi.", "success");
        router.refresh();
      } else {
        showToast(res.error || "Gagal menyetujui izin edit.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Terjadi kesalahan saat menyetujui izin edit.", "error");
    } finally {
      setIsRespondingEdit(false);
    }
  };

  const handleDeclineEdit = async () => {
    if (isRespondingEdit) return;
    if (!declineReason.trim()) {
      showToast("Harap isi alasan penolakan permintaan edit.", "error");
      return;
    }
    setIsRespondingEdit(true);
    try {
      const res = await declineEditSalesCounterFormAction([scId], declineReason);
      if (res.ok) {
        showToast("Permintaan edit telah ditolak.", "info");
        setDeclineBoxOpen(false);
        router.refresh();
      } else {
        showToast(res.error || "Gagal menolak permintaan edit.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Terjadi kesalahan saat menolak permintaan edit.", "error");
    } finally {
      setIsRespondingEdit(false);
    }
  };

  const [errors, setErrors] = useState<Record<string, string>>({});
  const persenResepDokter = String(initialPersenResepDokter ?? "0");

  const {
    selectedPersonIds,
    rowQuarter,
    periodeAwal,
    lamaPeriode,
    effectivePoaPeriod,
    quarterMonths,
    jumlahKaryawan,
    setJumlahKaryawan,
    jumlahPasien,
    setJumlahPasien,
    jumlahPasienResep,
    setJumlahPasienResep,
    jumlahPasienNonResep,
    products,
    entertainList,
    historyEntertain,
    loadingHistoryEntertain,
    canvasserProducts,
    rawCashbackData,
    productsMenang,
    productsInsentif,
    insentifHistory,
    historySalesData,
    b3HistorySalesData,
    salesOnlineData,
    surveyData,
    surveyNexusData,
    healthyOneData,
    loadingSurvey,
    rekomendasiProduk,
    b3SalesMap,
    b3QtyMap,
    b3RangeLabel,
    outletTotalAvgB3Sales,
    monthlyMonths,
    scHistoryIncentiveMap,
    totalOutletHistoryIncentive,
    historyIncentiveQuarter,
    historyIncentiveYear,
    isLoadingIncentiveHistory,
    diskonPeriode,
    productOptions,
    totalEstimasiSales,
    totalNilaiSc,
    cashbackDetails,
    isCashbackHidden,
    totalCashbackVal,
    totalDiskonVal,
    totalEntertainVal,
    totalEstimasiBudget,
    costRatio,
    effectiveOutletAvgB3Bln,
    totalGrowthPct,
    monthlyBreakdown,
    totalMonthlyEstimasiSales,
    totalMonthlyNilaiSc,
    handlePeriodeAwalChange,
    selectProductFromSidebar,
    handleAddProduct: addProductRow,
    handleRemoveProduct: removeProductRow,
    handleProductChange: updateProductRow,
    updateEntertainValue,
  } = useSalesCounterEditById({
    poaPeriod,
    kodePI,
    persons,
    initialProducts,
    initialEntertainItems,
    initialPeriodeAwal,
    initialLamaPeriode,
    initialJumlahKaryawan,
    initialJumlahPasien,
    initialJumlahPasienResep,
    initialJumlahPasienNonResep,
    masterProducts,
  });

  // Online vs Offline Komposisi Sales Calculation
  const [onlinePiSales, setOnlinePiSales] = useState<number>(0);
  const [offlineHistoricalSales, setOfflineHistoricalSales] = useState<number>(0);
  const [isEntertainOpen, setIsEntertainOpen] = useState(false);

  useEffect(() => {
    if (!kodePI) {
      setOfflineHistoricalSales(0);
      return;
    }
    const prevQInfo = getPreviousQuarterInfo(poaPeriod);
    const prevQQuarterPeriod = `${prevQInfo.year}-${prevQInfo.quarter}`;
    const prevQMonths = quarterToMonths(prevQQuarterPeriod);

    let isMounted = true;
    postHistorySalesAction([kodePI], prevQMonths).then((res) => {
      if (!isMounted) return;
      const parsed = parseOutletHistorySales(res, kodePI);
      setOfflineHistoricalSales(parsed.totalSales || 0);
    });

    return () => {
      isMounted = false;
    };
  }, [kodePI, poaPeriod]);

  const { komposisiOnlinePct, komposisiOfflinePct } = useMemo(() => {
    const total = onlinePiSales + offlineHistoricalSales;
    if (total <= 0) {
      if (onlinePiSales > 0) return { komposisiOnlinePct: 100, komposisiOfflinePct: 0 };
      if (offlineHistoricalSales > 0) return { komposisiOnlinePct: 0, komposisiOfflinePct: 100 };
      return { komposisiOnlinePct: 100, komposisiOfflinePct: 0 };
    }
    const onPct = Math.round((onlinePiSales / total) * 100);
    const offPct = 100 - onPct;
    return { komposisiOnlinePct: onPct, komposisiOfflinePct: offPct };
  }, [onlinePiSales, offlineHistoricalSales]);

  const validate = () => {
    const nextErrors: Record<string, string> = {};
    if (!periodeAwal) nextErrors.periodeAwal = "Periode awal wajib diisi";
    const hasValidProduct = products.some((p) => p.kodeProduk && (parseFloat(p.qtyPerBulan) || 0) > 0);
    if (!hasValidProduct) nextErrors.products = "Minimal pilih 1 produk dengan kuantitas > 0";
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const res = await saveSalesCounterFormAction(
        effectivePoaPeriod,
        kodePI,
        selectedPersonIds,
        products,
        entertainList,
        parseInt(persenResepDokter, 10) || 0,
        namaOutlet || undefined,
        parseInt(jumlahKaryawan, 10) || 0,
        parseInt(jumlahPasien, 10) || 0,
        parseInt(jumlahPasienResep, 10) || 0,
        parseInt(jumlahPasienNonResep, 10) || 0,
        periodeAwal,
        lamaPeriode,
        scId
      );
      if (res.ok) {
        showToast("Perubahan rencana POA berhasil disimpan.", "success");
        setTimeout(() => {
          window.location.href = `/sc/${scId}`;
        }, 800);
      } else {
        showToast(res.error || "Gagal menyimpan data.", "error");
        setIsSubmitting(false);
      }
    } catch (err: any) {
      showToast(err?.message || "Terjadi kesalahan saat menyimpan data.", "error");
      setIsSubmitting(false);
    }
  };

  const selectedCodesNormalized = useMemo(() => {
    return new Set(
      products
        .map((p) => (p.kodeProduk ? p.kodeProduk.replace(/^0+/, "").toUpperCase() : ""))
        .filter(Boolean)
    );
  }, [products]);

  const productGrowthAnalysis = useMemo(() => {
    const selectedAnalyzed = products
      .map((row) => {
        if (!row.kodeProduk) return null;
        const masterProduct = masterProducts.find((pr) => pr.kodeProduk === row.kodeProduk);
        if (!masterProduct) return null;

        const normCode = row.kodeProduk.replace(/^0+/, "").toUpperCase();
        const hnaSJ = parseFloat(masterProduct.hna) || 0;
        const qtyBln = parseFloat(row.qtyPerBulan) || 0;
        const qtyTotal = qtyBln * lamaPeriode;
        const estimasiSales = qtyTotal * hnaSJ;

        const canvasserProd = canvasserProducts.find((cp) => cp.pro_code === row.kodeProduk);
        const pctMatriks = parseFloat(row.persenMatriksSc) || 0;
        const scVal = canvasserProd?.sales_counter_value;
        const scMin = canvasserProd?.sales_counter_minimum || 0;

        let nilaiScBln = 0;
        if (scVal != null && scVal > 0) {
          nilaiScBln = qtyBln >= scMin ? qtyBln * scVal : 0;
        } else {
          nilaiScBln = (qtyBln * hnaSJ) * (pctMatriks / 100);
        }
        const nilaiSc = nilaiScBln * lamaPeriode;
        const valCashback = cashbackDetails?.resultMap?.get(row.kodeProduk) ?? 0;

        const histAvgSales =
          b3SalesMap.get(row.kodeProduk) ??
          b3SalesMap.get(normCode) ??
          0;
        const histAvgQty =
          b3QtyMap.get(row.kodeProduk) ??
          b3QtyMap.get(normCode) ??
          (hnaSJ > 0 && histAvgSales > 0 ? histAvgSales / hnaSJ : 0);

        const histTotalQty = Math.round(histAvgQty * lamaPeriode);
        const salesHistorical = histAvgSales * lamaPeriode;

        let growthType: "ekstensifikasi" | "intensifikasi" | "penurunan" | "tetap" = "ekstensifikasi";
        let growthPct: number | null = null;
        let deltaUb = 0;

        if (histAvgSales === 0 && histAvgQty === 0) {
          growthType = "ekstensifikasi";
          growthPct = null;
          deltaUb = 0;
        } else if (qtyTotal > histTotalQty) {
          growthType = "intensifikasi";
          deltaUb = Math.round(qtyTotal - histTotalQty);
          growthPct = salesHistorical > 0 ? ((estimasiSales - salesHistorical) / salesHistorical) * 100 : 100;
        } else if (qtyTotal < histTotalQty) {
          growthType = "penurunan";
          deltaUb = Math.round(histTotalQty - qtyTotal);
          growthPct = salesHistorical > 0 ? ((estimasiSales - salesHistorical) / salesHistorical) * 100 : -100;
        } else {
          growthType = "tetap";
          deltaUb = 0;
          growthPct = 0;
        }

        return {
          isUnselected: false,
          kodeProduk: row.kodeProduk,
          namaProduk: masterProduct.namaProduk,
          satuan: satuanLabel(masterProduct),
          qtyTotal,
          estimasiSales,
          nilaiSc,
          valCashback,
          growthPct,
          growthType,
          deltaUb,
        };
      })
      .filter(Boolean) as {
        isUnselected: boolean;
        kodeProduk: string;
        namaProduk: string;
        satuan: string;
        qtyTotal: number;
        estimasiSales: number;
        nilaiSc: number;
        valCashback: number;
        growthPct: number | null;
        growthType: "ekstensifikasi" | "intensifikasi" | "penurunan" | "tetap";
        deltaUb: number;
      }[];

    const unselectedAnalyzed: {
      isUnselected: boolean;
      kodeProduk: string;
      namaProduk: string;
      satuan: string;
      qtyTotal: number;
      estimasiSales: number;
      nilaiSc: number;
      valCashback: number;
      growthPct: number | null;
      growthType: "unselected";
      deltaUb: number;
    }[] = [];

    if (b3SalesMap.size > 0 || b3QtyMap.size > 0) {
      const seenNorm = new Set<string>();
      const allHistCodes = new Set([...Array.from(b3SalesMap.keys()), ...Array.from(b3QtyMap.keys())]);
      for (const code of allHistCodes) {
        const norm = code.replace(/^0+/, "").toUpperCase();
        if (!norm || seenNorm.has(norm)) continue;
        seenNorm.add(norm);

        if (selectedCodesNormalized.has(norm)) continue;

        const histAvgSales = b3SalesMap.get(code) ?? b3SalesMap.get(norm) ?? 0;
        const histAvgQty = b3QtyMap.get(code) ?? b3QtyMap.get(norm) ?? 0;

        if (histAvgSales <= 0 && histAvgQty <= 0) continue;

        const masterProd = masterProducts.find(
          (p) => p.kodeProduk.replace(/^0+/, "").toUpperCase() === norm
        );
        const canvasserProd = canvasserProducts.find(
          (cp) => cp.pro_code.replace(/^0+/, "").toUpperCase() === norm
        );

        const namaProduk = masterProd?.namaProduk || canvasserProd?.pro_name || `Produk (${code})`;
        const satuan = masterProd ? satuanLabel(masterProd) : "BOX";
        const histTotalQty = Math.round(histAvgQty * lamaPeriode) || Math.round(histAvgQty) || 1;

        unselectedAnalyzed.push({
          isUnselected: true,
          kodeProduk: code,
          namaProduk,
          satuan,
          qtyTotal: 0,
          estimasiSales: 0,
          nilaiSc: 0,
          valCashback: 0,
          growthPct: -100,
          growthType: "unselected",
          deltaUb: histTotalQty,
        });
      }
    }

    return {
      selectedItems: selectedAnalyzed,
      unselectedItems: unselectedAnalyzed,
    };
  }, [
    products,
    masterProducts,
    lamaPeriode,
    canvasserProducts,
    cashbackDetails,
    b3SalesMap,
    b3QtyMap,
    selectedCodesNormalized,
  ]);

  const countIntensifikasi = productGrowthAnalysis.selectedItems.filter((it) => it.growthType === "intensifikasi").length;
  const totalDeltaUbIntensifikasi = productGrowthAnalysis.selectedItems
    .filter((it) => it.growthType === "intensifikasi")
    .reduce((sum, it) => sum + it.deltaUb, 0);

  const countEkstensifikasi = productGrowthAnalysis.selectedItems.filter((it) => it.growthType === "ekstensifikasi").length;

  const countPenurunan =
    productGrowthAnalysis.selectedItems.filter((it) => it.growthType === "penurunan").length +
    productGrowthAnalysis.unselectedItems.length;
  const totalDeltaUbPenurunan =
    productGrowthAnalysis.selectedItems
      .filter((it) => it.growthType === "penurunan")
      .reduce((sum, it) => sum + it.deltaUb, 0) +
    productGrowthAnalysis.unselectedItems.reduce((sum, it) => sum + it.deltaUb, 0);

  const totalRealQty = productGrowthAnalysis.selectedItems.reduce((sum, it) => sum + it.qtyTotal, 0);
  const distinctUnits = Array.from(
    new Set(productGrowthAnalysis.selectedItems.map((it) => it.satuan).filter(Boolean))
  );
  const commonUnit = distinctUnits.length === 1 ? distinctUnits[0] : "UB";

  const scProductItems: ScProductItemData[] = useMemo(() => {
    const items: ScProductItemData[] = [];
    products.forEach((row, idx) => {
      if (!row.kodeProduk) return;
      const master = masterProducts.find((p) => p.kodeProduk === row.kodeProduk);
      const canvasser = canvasserProducts?.find((cp) => cp.pro_code === row.kodeProduk);
      const hnaSJ = parseFloat(master?.hna || "0") || 0;
      const scVal = canvasser?.sales_counter_value;
      const scMin = canvasser?.sales_counter_minimum || 0;
      const pctMatriks = parseFloat(row.persenMatriksSc) || 0;
      const pctDiskon = parseFloat(row.persenDiskon) || 0;
      const pctCashback = parseFloat(row.persenCashback) || 0;

      if (Array.isArray(row.monthlyQty) && row.monthlyQty.length > 0 && monthlyMonths && monthlyMonths.length > 0) {
        monthlyMonths.forEach((m: string, mIdx: number) => {
          const q = parseFloat(row.monthlyQty?.[mIdx] || "") || 0;
          items.push({
            id: `${row.kodeProduk}-${m}`,
            kodeProduk: row.kodeProduk,
            namaProduk: master?.namaProduk || canvasser?.pro_name || row.kodeProduk,
            periodeMonth: m,
            produkKompetitor: row.produkKompetitor || null,
            qtyPerBulan: q,
            persenMatriksSc: pctMatriks,
            persenDiskon: pctDiskon,
            persenCashback: pctCashback,
            rencanaTotalBiaya: row.rencanaTotalBiaya,
            hnaSJ,
            salesCounterValue: scVal,
            salesCounterMinimum: scMin,
          });
        });
      } else {
        const q = parseFloat(row.qtyPerBulan) || 0;
        items.push({
          id: `${row.kodeProduk}-${idx}`,
          kodeProduk: row.kodeProduk,
          namaProduk: master?.namaProduk || canvasser?.pro_name || row.kodeProduk,
          produkKompetitor: row.produkKompetitor || null,
          qtyPerBulan: q,
          persenMatriksSc: pctMatriks,
          persenDiskon: pctDiskon,
          persenCashback: pctCashback,
          rencanaTotalBiaya: row.rencanaTotalBiaya,
          hnaSJ,
          salesCounterValue: scVal,
          salesCounterMinimum: scMin,
        });
      }
    });
    return items;
  }, [products, masterProducts, canvasserProducts, monthlyMonths]);

  const productDetailRows = useMemo(() => {
    return calculateProductDetailRows({
      scProducts: scProductItems,
      lama: lamaPeriode,
      periodeAwal,
      cashbackData: rawCashbackData,
      cbDetails: cashbackDetails,
      b3SalesMap,
      b3TotalOutletSalesPerMonth: outletTotalAvgB3Sales,
      scHistoryIncentiveMap,
      totalOutletHistoryIncentive,
    });
  }, [
    scProductItems,
    lamaPeriode,
    periodeAwal,
    rawCashbackData,
    cashbackDetails,
    b3SalesMap,
    outletTotalAvgB3Sales,
    scHistoryIncentiveMap,
    totalOutletHistoryIncentive,
  ]);

  const unselectedProducts = useMemo(() => {
    if (!b3SalesMap || b3SalesMap.size === 0) return [];
    const selectedNorm = new Set<string>();
    for (const p of products) {
      if (p.kodeProduk) selectedNorm.add(p.kodeProduk.replace(/^0+/, "").toUpperCase());
    }

    const results: {
      kodeProduk: string;
      namaProduk: string;
      avgSalesPerMonth: number;
      totalSalesPeriode: number;
    }[] = [];

    const seen = new Set<string>();
    for (const [rawCode, avgSales] of Array.from(b3SalesMap.entries())) {
      const norm = rawCode.replace(/^0+/, "").toUpperCase();
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);

      if (selectedNorm.has(norm)) continue;
      if (avgSales <= 0) continue;

      const matchedMaster = masterProducts?.find((p: any) => {
        const c1 = (p.kodeProduk || "").replace(/^0+/, "").toUpperCase();
        return c1 === norm;
      });
      const matchedCanvasser = canvasserProducts?.find((cp: any) => {
        const c1 = (cp.pro_code || "").replace(/^0+/, "").toUpperCase();
        return c1 === norm;
      });

      const namaProduk =
        matchedMaster?.namaProduk ||
        matchedCanvasser?.pro_name ||
        `Produk (${rawCode})`;

      results.push({
        kodeProduk: rawCode,
        namaProduk,
        avgSalesPerMonth: avgSales,
        totalSalesPeriode: avgSales * (lamaPeriode || 1),
      });
    }

    return results.sort((a, b) => b.avgSalesPerMonth - a.avgSalesPerMonth);
  }, [b3SalesMap, products, masterProducts, canvasserProducts, lamaPeriode]);

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6 p-3 sm:p-6 max-w-5xl w-full max-w-full overflow-hidden">
      {readOnly && (
        <div className="rounded-md px-4 py-3 text-sm font-medium space-y-2.5"
          style={{ background: "var(--color-blue-light, #eff6ff)", color: "var(--color-blue)", border: "1px solid var(--color-blue)" }}>
          <p>
            {status === "APPROVED_BY_NSM"
              ? "Outlet ini sudah berstatus Fully Approved pada periode ini sehingga rencana tidak dapat diubah lagi (Mode Lihat Saja)."
              : isOwner
              ? "Mode Lihat (Read-Only) — Outlet ini sudah disetujui oleh Atasan. Untuk melakukan perubahan rencana, Anda dapat mengajukan permohonan edit ke Atasan."
              : "Mode Lihat (Read-Only) — Anda melihat form ini sebagai Atasan (Akses Read-Only)."}
          </p>
          {isOwner && !hasPendingEditRequest && status !== "APPROVED_BY_NSM" && !requestEditBoxOpen && (
            <div>
              <Button
                type="button"
                size="sm"
                onClick={() => setRequestEditBoxOpen(true)}
                style={{ background: "var(--color-blue)", color: "#ffffff" }}
              >
                Ajukan Permohonan Edit
              </Button>
            </div>
          )}
        </div>
      )}

      {hasPendingEditRequest && (
        <div
          className="rounded-lg p-4 text-xs font-medium space-y-2.5 border"
          style={{
            background: "var(--color-warning-light, #fef3c7)",
            borderColor: "var(--color-warning, #f59e0b)",
            color: "var(--color-warning-dark, #92400e)",
          }}
        >
          <div>
            <p className="font-semibold text-xs flex items-center gap-1.5" style={{ color: "var(--color-warning-dark, #92400e)" }}>
              <span>⚠️</span>
              <span>Permintaan Izin Edit dari MR ({namaOutlet || kodePI})</span>
            </p>
            <p className="mt-1 font-normal text-xs leading-relaxed" style={{ color: "var(--color-text)" }}>
              {pendingEditRequestNotes ? (
                <>Alasan pengajuan: <em>&ldquo;{pendingEditRequestNotes}&rdquo;</em></>
              ) : (
                "Pemilik draf mengajukan izin untuk mengedit kembali outlet ini yang sudah disetujui."
              )}
            </p>
          </div>

          {canRespondEdit ? (
            <div className="pt-2 space-y-2 border-t" style={{ borderColor: "#fde68a" }}>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={isRespondingEdit}
                  onClick={handleGrantEdit}
                  style={{ background: "var(--color-green, #16a34a)", color: "#fff" }}
                >
                  {isRespondingEdit ? "Memproses…" : "Setujui Izin Edit (Kembali ke Revisi)"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={declineBoxOpen ? "ghost" : "danger"}
                  disabled={isRespondingEdit}
                  onClick={() => setDeclineBoxOpen(!declineBoxOpen)}
                >
                  {declineBoxOpen ? "Batal Menolak" : "Tolak Permintaan Edit"}
                </Button>
              </div>

              {declineBoxOpen && (
                <div className="pt-2 space-y-2 border-t" style={{ borderColor: "#fde68a" }}>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium" style={{ color: "var(--color-text)" }}>
                      Alasan Menolak Permintaan Edit (wajib diisi):
                    </span>
                    <textarea
                      value={declineReason}
                      onChange={(e) => setDeclineReason(e.target.value)}
                      rows={2}
                      placeholder="Jelaskan alasan mengapa permintaan izin edit ini ditolak…"
                      className="input-field text-xs rounded border p-2"
                      style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}
                    />
                  </label>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      disabled={isRespondingEdit || !declineReason.trim()}
                      onClick={handleDeclineEdit}
                    >
                      {isRespondingEdit ? "Menolak…" : "Konfirmasi Tolak Permintaan"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeclineBoxOpen(false)}
                    >
                      Batal
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-[11px] font-normal opacity-90">
              {isOwner
                ? "Permintaan Anda sedang menunggu persetujuan dari Atasan (ASM/SM/NSM)."
                : "Menunggu respon persetujuan dari Atasan."}
            </div>
          )}
        </div>
      )}

      {requestEditBoxOpen && (
        <div
          className="rounded-lg p-4 text-xs font-medium space-y-2.5 border"
          style={{
            background: "var(--color-warning-bg, #fef3c7)",
            color: "var(--color-warning, #b45309)",
            border: "1px solid var(--color-warning, #f59e0b)",
          }}
        >
          <p className="font-semibold text-sm">
            Permohonan Izin Edit Outlet ({namaOutlet || kodePI})
          </p>
          <p className="font-normal leading-relaxed text-xs">
            Outlet ini sedang terkunci untuk diedit karena sudah disetujui Atasan. Silakan ajukan permohonan izin edit ke Atasan dengan menyertakan alasan. Jika disetujui, status outlet akan dikembalikan ke <strong>Revisi</strong> agar Anda dapat mengedit form kembali.
          </p>
          <div className="space-y-2 pt-1">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-normal" style={{ color: "var(--color-text)" }}>
                Alasan permohonan edit (opsional) — akan dikirim ke Atasan yang menyetujui
              </span>
              <textarea
                value={requestEditReason}
                onChange={(e) => setRequestEditReason(e.target.value)}
                rows={2}
                placeholder="mis. ada koreksi jumlah atau estimasi produk yang perlu diperbaiki…"
                className="input-field text-xs rounded border p-2"
                style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}
              />
            </label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={isRequestingEdit}
                onClick={handleRequestEditSubmit}
                style={{ background: "var(--color-blue)", color: "#ffffff" }}
              >
                {isRequestingEdit ? "Mengirim…" : "Kirim Permohonan Edit ke Atasan"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setRequestEditBoxOpen(false)}
              >
                Batal
              </Button>
            </div>
          </div>
        </div>
      )}
      {!readOnly && isOwner && status === "SUBMITTED_TO_ASM" && (
        <div className="rounded-md px-4 py-3 text-sm font-medium"
          style={{ background: "var(--color-blue-light, #eff6ff)", color: "var(--color-blue)", border: "1px solid var(--color-blue)" }}>
          Outlet ini sedang dalam status <strong>Menunggu Persetujuan ASM</strong>. Perubahan yang Anda simpan akan langsung memperbarui draf yang sedang ditinjau oleh ASM.
        </div>
      )}
      <div className="space-y-6">
        <h2 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
          {readOnly ? "Detail Rencana POA (Sales Counter)" : "Edit Rencana POA (Sales Counter)"}
        </h2>

        {/* OUTLET — LOCKED */}
        <div className="space-y-3">
          <SectionLabel>Outlet</SectionLabel>
          <div className="rounded-lg border px-4 py-3 flex items-center gap-3"
            style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-semibold truncate" style={{ color: "var(--color-text)" }}>
                  {kodePI ? `${kodePI} · ` : ""}{namaOutlet || kodePI}
                </span>
              </div>
              {(() => {
                const statusItems: string[] = [];
                if (is_sc) statusItems.push("Ins-SC");
                if (isBlastIn) statusItems.push("Blast-In");
                if (isOnline) statusItems.push("Online");
                if (isPosm) statusItems.push("POSM");
                if (statusItems.length === 0) return null;

                return (
                  <p className="text-[11px] font-medium mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                    {statusItems.join(", ")}
                  </p>
                );
              })()}
            </div>
            <span className="text-xs px-2 py-0.5 rounded font-medium shrink-0"
              style={{ background: "var(--color-bg)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
              Terkunci
            </span>
          </div>

          {isOnline && (
            <>
              <KomposisiSalesWidget onlinePct={komposisiOnlinePct} offlinePct={komposisiOfflinePct} />
              <OnlineApotekSalesWidget
                poaPeriod={poaPeriod}
                outletCode={kodePI}
                outletName={namaOutlet}
                isOnline={isOnline}
                onTotalPiSalesChange={setOnlinePiSales}
              />
            </>
          )}

          {/* PERSONS — LOCKED */}
          {persons.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: "var(--color-text-muted)" }}>
                Sales Counter ({persons.length} terpilih)
              </p>
              <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
                <table className="w-full text-xs text-left min-w-[340px]" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-subtle)" }}>
                      <th className="py-2 px-3 font-semibold whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>Nama</th>
                      <th className="py-2 px-3 font-semibold whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>Jabatan</th>
                      <th className="py-2 px-3 font-semibold whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>Tipe Upload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {persons.map((p) => (
                      <tr key={p.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                        <td className="py-2 px-3 font-medium" style={{ color: "var(--color-text)" }}>{p.personName}</td>
                        <td className="py-2 px-3" style={{ color: "var(--color-text-muted)" }}>{p.positionName}</td>
                        <td className="py-2 px-3" style={{ color: "var(--color-text-muted)" }}>{p.tipeUploadSc || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Statistik Karyawan & Pasien */}
        <div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                Jumlah Karyawan
              </span>
              {loadingSurvey ? (
                <div className="h-[38px] rounded-md animate-pulse border" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }} />
              ) : (
                <input
                  type="number"
                  value={jumlahKaryawan}
                  onChange={(e) => setJumlahKaryawan(e.target.value)}
                  placeholder="0"
                  min={0}
                  disabled={readOnly}
                  className="input-field text-center font-semibold text-sm h-[38px]"
                />
              )}
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                Jumlah Pasien (Per Hari)
              </span>
              {loadingSurvey ? (
                <div className="h-[38px] rounded-md animate-pulse border" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }} />
              ) : (
                <input
                  type="number"
                  value={jumlahPasien}
                  onChange={(e) => setJumlahPasien(e.target.value)}
                  placeholder="0"
                  min={0}
                  disabled={readOnly}
                  className="input-field text-center font-semibold text-sm h-[38px]"
                />
              )}
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                Jumlah Pasien Resep (Per Hari)
              </span>
              {loadingSurvey ? (
                <div className="h-[38px] rounded-md animate-pulse border" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }} />
              ) : (
                <input
                  type="number"
                  value={jumlahPasienResep}
                  onChange={(e) => setJumlahPasienResep(e.target.value)}
                  placeholder="0"
                  min={0}
                  disabled={readOnly}
                  className="input-field text-center font-semibold text-sm h-[38px]"
                />
              )}
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                Jumlah Pasien Non Resep (Per Hari)
              </span>
              {loadingSurvey ? (
                <div className="h-[38px] rounded-md animate-pulse border" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }} />
              ) : (
                <input
                  type="number"
                  value={jumlahPasienNonResep}
                  readOnly
                  disabled
                  className="input-field text-center font-semibold text-sm h-[38px]"
                  style={{ background: "var(--color-bg-subtle)", opacity: 0.85, cursor: "not-allowed" }}
                />
              )}
              <span className="text-[10px] leading-tight mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                Pasien Non Resep = Jumlah Pasien - Jumlah Pasien Resep
              </span>
            </div>
          </div>
        </div>

        {/* PRODUK YANG DIPROMOSIKAN */}
        <div>
          <div>
            <SectionLabel>Produk yang Dipromosikan</SectionLabel>
            <ProductSelector
              kodePI={kodePI}
              rows={products}
              onAddRow={addProductRow}
              onRemoveRow={removeProductRow}
              onUpdateRow={updateProductRow}
              productsOptions={productOptions}
              canvasserProducts={canvasserProducts}
              masterProducts={masterProducts}
              lamaPeriode={lamaPeriode}
              periodeAwal={periodeAwal}
              diskonPeriode={diskonPeriode}
              cashbackPeriode={rawCashbackData?.period || rawCashbackData?.data?.period}
              cashbackData={rawCashbackData}
              hideCashback={isCashbackHidden}
              error={errors.products}
              readOnly={readOnly}
              b3SalesMap={b3SalesMap}
              b3QtyMap={b3QtyMap}
              b3RangeLabel={b3RangeLabel}
              surveyNexusData={surveyNexusData}
              historySalesData={b3HistorySalesData || historySalesData}
            />
          </div>

          {/* Entertain */}
          {entertainList.length > 0 && (
            <div className="space-y-2 mt-4">
              {/* Accordion header — same style as Blast-In */}
              <div
                onClick={() => setIsEntertainOpen((v) => !v)}
                className="flex items-center justify-between flex-wrap gap-2 cursor-pointer select-none py-1 group"
              >
                <div className="flex items-center gap-2">
                  <svg
                    className={`w-3.5 h-3.5 transition-transform duration-200 text-slate-500 group-hover:text-slate-800 ${isEntertainOpen ? "rotate-0" : "-rotate-90"}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                  </svg>
                  <span className="text-xs font-semibold uppercase tracking-wider group-hover:opacity-80 transition-opacity" style={{ color: "var(--color-text)" }}>
                    Rencana Entertain Per Bulan
                  </span>
                </div>
                <span className="text-xs font-semibold" style={{ color: "var(--color-blue, #2563eb)" }}>
                  History Entertain: {loadingHistoryEntertain ? (
                    <span className="animate-pulse opacity-60">Memuat...</span>
                  ) : (
                    `Rp ${Math.round(historyEntertain ?? 0).toLocaleString("id-ID")}`
                  )}
                </span>
              </div>

              {isEntertainOpen && (
                <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
                  <table className="w-full text-xs text-left min-w-[320px]" style={{ borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
                        <th className="px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>Bulan</th>
                        <th className="px-4 py-2.5 font-medium w-[220px] whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>Biaya Entertain</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entertainList.map((row) => (
                        <tr key={row.month} style={{ borderBottom: "1px solid var(--color-border)" }}>
                          <td className="px-4 py-2.5 font-medium" style={{ color: "var(--color-text)" }}>{row.label}</td>
                          <td className="px-4 py-2">
                            <div style={{ maxWidth: 180 }}>
                              <UnitInput value={row.value} onChange={(val) => updateEntertainValue(row.month, val)} unit="Rp" placeholder="0" disabled={readOnly} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="font-semibold" style={{ background: "var(--color-bg-subtle)", borderTop: "1px solid var(--color-border)" }}>
                        <td className="px-4 py-2.5" style={{ color: "var(--color-text)" }}>Total Entertain</td>
                        <td className="px-4 py-2.5 text-xs font-bold" style={{ color: "var(--color-blue, #2563eb)" }}>
                          Rp {formatRp(entertainList.reduce((sum, item) => sum + (parseFloat(item.value) || 0), 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}


          {/* Tabel BLAST-IN & POSM (Autofill data) */}
          {isBlastIn && (
            <BlastInTable
              poaPeriod={effectivePoaPeriod}
              quarter={rowQuarter}
              outletId={kodePI}
              estimasiSales={totalEstimasiSales}
            />
          )}
          {kodePI && (
            <PosmTable
              poaPeriod={effectivePoaPeriod}
              quarter={rowQuarter}
              outletId={kodePI}
              onTotalValueChange={setPosmVal}
            />
          )}
        </div>

        {/* TOTAL */}
        <div className="rounded-xl border px-4 py-4 space-y-5"
          style={{ background: "var(--color-bg)", borderColor: "var(--color-blue)", borderWidth: 2 }}>
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                Total Semua Produk
              </p>
              <button
                type="button"
                onClick={() => setShowBudgetModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold transition-all border cursor-pointer hover:bg-blue-50/70"
                style={{
                  borderColor: "#93c5fd",
                  color: "#2563eb",
                  background: "transparent",
                }}
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="9" />
                  <line x1="12" y1="8" x2="12" y2="8.01" />
                  <line x1="12" y1="11" x2="12" y2="16" />
                </svg>
                <span>Perincian Budget</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 overflow-x-auto pb-1 items-start">
              {/* 1. ESTIMASI SALES */}
              <div className="shrink-0 min-w-[180px]">
                <div className="text-xs font-semibold whitespace-nowrap uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                  ESTIMASI SALES
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold whitespace-nowrap mt-1" style={{ color: "var(--color-blue)" }}>
                  Rp {Math.round(totalEstimasiSales).toLocaleString("id-ID")}
                </div>
                <div className="text-xs mt-1 whitespace-nowrap font-medium" style={{ color: "var(--color-text-muted)" }}>
                  Rp {Math.round(totalEstimasiSales / (lamaPeriode > 0 ? lamaPeriode : 1)).toLocaleString("id-ID")} / Bln
                </div>
              </div>

              {/* 2. ESTIMASI GROWTH SALES */}
              <div
                className="shrink-0 min-w-[220px] border-t pt-4 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-6"
                style={{ borderColor: "var(--color-border)" }}
              >
                <div className="text-xs font-semibold whitespace-nowrap uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                  ESTIMASI GROWTH SALES
                </div>

                <div
                  className="text-2xl sm:text-3xl font-extrabold whitespace-nowrap mt-1"
                  style={{
                    color:
                      totalGrowthPct == null
                        ? "var(--color-text-muted)"
                        : totalGrowthPct > 0
                        ? "var(--color-success, #16a34a)"
                        : totalGrowthPct < 0
                        ? "var(--color-red, #dc2626)"
                        : "var(--color-text)",
                  }}
                >
                  {totalGrowthPct != null ? `${totalGrowthPct >= 0 ? "+" : ""}${totalGrowthPct.toFixed(1)}%` : "-"}
                </div>

                {/* Classification Badges */}
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  {countIntensifikasi > 0 && (
                    <span
                      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border"
                      style={{
                        background: "rgba(147, 51, 234, 0.1)",
                        color: "#7e22ce",
                        borderColor: "rgba(147, 51, 234, 0.3)",
                      }}
                    >
                      {countIntensifikasi} Intensifikasi (+{totalDeltaUbIntensifikasi} UB)
                    </span>
                  )}
                  {countEkstensifikasi > 0 && (
                    <span
                      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border"
                      style={{
                        background: "rgba(37, 99, 235, 0.1)",
                        color: "#1d4ed8",
                        borderColor: "rgba(37, 99, 235, 0.3)",
                      }}
                    >
                      {countEkstensifikasi} Ekstensifikasi
                    </span>
                  )}
                  {countPenurunan > 0 && (
                    <span
                      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border"
                      style={{
                        background: "rgba(225, 29, 72, 0.1)",
                        color: "#be123c",
                        borderColor: "rgba(225, 29, 72, 0.3)",
                      }}
                    >
                      {countPenurunan} Berkurang (-{totalDeltaUbPenurunan} UB)
                    </span>
                  )}
                  {countIntensifikasi === 0 && countEkstensifikasi === 0 && countPenurunan === 0 && (
                    <span className="text-xs font-medium text-slate-400">-</span>
                  )}
                </div>

                {/* History Sales & Period */}
                {effectiveOutletAvgB3Bln > 0 ? (
                  <div className="mt-2 space-y-0.5">
                    <div className="text-xs font-medium whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
                      History Sales Rp {Math.round(effectiveOutletAvgB3Bln).toLocaleString("id-ID")} / Bln
                    </div>
                    {b3RangeLabel && (
                      <div className="text-[11px] whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                        ({b3RangeLabel})
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs mt-2 whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                    Belum ada data history sales
                  </div>
                )}
              </div>

              {/* 3. NILAI INSENTIF SC */}
              <div
                className="shrink-0 min-w-[200px] border-t pt-4 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-6"
                style={{ borderColor: "var(--color-border)" }}
              >
                <div className="text-xs font-semibold whitespace-nowrap uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                  NILAI INSENTIF SC
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold whitespace-nowrap mt-1" style={{ color: "var(--color-blue)" }}>
                  Rp {Math.round(totalNilaiSc).toLocaleString("id-ID")}
                </div>
                <div className="text-xs mt-1 whitespace-nowrap font-medium" style={{ color: "var(--color-text-muted)" }}>
                  Rp {Math.round(totalNilaiSc / (lamaPeriode > 0 ? lamaPeriode : 1)).toLocaleString("id-ID")} / Bln
                </div>

                {/* History Insentif SC & Period */}
                {isLoadingIncentiveHistory ? (
                  <div className="text-xs mt-2 whitespace-nowrap text-slate-400">
                    Memuat history insentif...
                  </div>
                ) : totalOutletHistoryIncentive > 0 ? (
                  <div className="mt-2 space-y-0.5">
                    <div className="text-xs font-medium whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
                      History Insentif SC Rp {Math.round(totalOutletHistoryIncentive).toLocaleString("id-ID")}
                    </div>
                    <div className="text-[11px] whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                      ({historyIncentiveQuarter && historyIncentiveYear ? `${historyIncentiveQuarter} ${historyIncentiveYear}` : b3RangeLabel || "Kuartal Sebelumnya"})
                    </div>
                  </div>
                ) : (
                  <div className="text-xs mt-2 whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                    Belum ada data history insentif
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* TABEL ESTIMASI & INSENTIF SC PER PRODUK */}
          {(products.some((p) => p.kodeProduk) || unselectedProducts.length > 0) && (
            <div className="space-y-3 pt-3" style={{ borderTop: "1px solid var(--color-border)" }}>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                Estimasi &amp; Insentif SC Per Produk
              </p>
              <SalesCounterProductBreakdownTable
                productDetailRows={productDetailRows}
                lama={lamaPeriode}
                b3RangeLabel={b3RangeLabel}
                isLoadingIncentiveHistory={isLoadingIncentiveHistory}
                unselectedProducts={unselectedProducts}
                isForm={true}
              />
            </div>
          )}
        </div>

        {/* ESTIMASI & NILAI SC/CASHBACK PER BULAN */}
        {monthlyBreakdown.length > 0 && products.some(p => p.kodeProduk) && (
          <MonthlyBreakdownTable
            monthlyBreakdown={monthlyBreakdown}
            totalMonthlyEstimasiSales={totalMonthlyEstimasiSales}
            totalMonthlyNilaiSc={totalMonthlyNilaiSc}
            totalCashbackVal={totalCashbackVal}
            lamaPeriode={lamaPeriode}
            isCashbackHidden={isCashbackHidden}
          />
        )}
      </div>

      {/* ACTION BUTTONS */}
      <div className="flex justify-end gap-3 pt-4 pb-10 md:pb-0 border-t" style={{ borderColor: "var(--color-border)" }}>
        {readOnly ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push(`/sc/${scId}`)}
          >
            Kembali ke Detail
          </Button>
        ) : (
          <>
            <Button type="button" variant="ghost" onClick={() => router.push(`/sc/${scId}`)} disabled={isSubmitting}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Menyimpan..." : "Simpan Perubahan"}
            </Button>
          </>
        )}
      </div>
    </form>
    {kodePI && (
      <ScSidebar
        poaPeriod={poaPeriod}
        doctorName={namaOutlet || undefined}
        productsMenang={productsMenang}
        productsInsentif={productsInsentif}
        insentifHistory={insentifHistory}
        historySalesData={historySalesData}
        salesOnlineData={salesOnlineData}
        surveyData={surveyData}
        surveyNexusData={surveyNexusData}
        healthyOneData={healthyOneData}
        rekomendasiProduk={rekomendasiProduk}
        masterProducts={masterProducts}
        canvasserProducts={canvasserProducts}
        selectedProductCodes={new Set(products.map((p) => p.kodeProduk).filter(Boolean))}
        onSelectProduct={selectProductFromSidebar}
      />
    )}
    <PerincianBudgetModal
      isOpen={showBudgetModal}
      onClose={() => setShowBudgetModal(false)}
      totalEstimasiBudget={totalEstimasiBudget}
      totalNilaiSc={totalNilaiSc}
      totalDiskonVal={totalDiskonVal}
      totalEntertainVal={totalEntertainVal}
      totalCashbackVal={totalCashbackVal}
      totalBlastInVal={0}
      totalPosmVal={posmVal}
      showCashback={!isCashbackHidden}
      showBlastIn={!!isBlastIn}
      showPosm={!!isPosm}
      costRatio={costRatio}
    />
    </>
  );
}
