"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSalesCounterEditor } from "./hooks/useSalesCounterEditor";
import { ProductSelector } from "./ProductSelector";
import { buildScProductOptions } from "./utils/productOptionBuilder";
import { UnitInput } from "./UnitInput";
import { ScSidebar } from "./ScSidebar";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { quarterToMonths, getPreviousQuarterInfo } from "@/lib/quarterUtils";
import { expandPeriodeMonths } from "@/lib/poaUtils";
import { getB3RollingPeriodInfo } from "@/lib/b3Utils";
import { getScOutletB3SalesAction, postHistorySalesAction, getHistoryEntertainAction } from "@/app/actions/canvasser";
import { parseOutletHistorySales } from "@/lib/historySalesUtils";
import { BlastInTable } from "./BlastInTable";
import { PosmTable } from "./PosmTable";
import { PerincianBudgetModal } from "./PerincianBudgetModal";
import { OnlineApotekSalesWidget } from "./OnlineApotekSalesWidget";
import { KomposisiSalesWidget } from "./KomposisiSalesWidget";
import { MonthlyBreakdownTable } from "./MonthlyBreakdownTable";
import { StatusBadge } from "@/components/ui/StatusBadge";

import type { SalesCounterLineItemEditorProps } from "./types/editorProps";
import { formatHumanStatus, formatRpNumber as formatRp } from "./utils/formatEditUtils";
import { satuanLabel } from "./utils/productMatcherUtils";
import { formatMonthLabel } from "./utils/periodUtils";
import { Req, SectionLabel } from "./ui";
import { ERR_RING } from "./constants/uiConstants";
import { SalesCounterProductBreakdownTable } from "../detail/SalesCounterProductBreakdownTable";
import { calculateProductDetailRows } from "../detail/utils/outletCalculationUtils";
import type { ScProductItemData } from "../types";

export function SalesCounterLineItemEditor({
  poaId,
  poaPeriod,
  ownerName,
  outlets,
  products,
  savedDrafts = [],
  initialOutletId = "",
}: SalesCounterLineItemEditorProps) {
  const router = useRouter();
  const {
    outletId,
    setOutletId,
    personId,
    setPersonId,
    selectedPersonIds,
    toggleSelectPerson,
    toggleSelectAll,
    periodeAwal,
    setPeriodeAwal,
    lamaPeriode,
    rowQuarter,
    setRowQuarter,
    entertainList,
    updateEntertainValue,
    jumlahKaryawan,
    setJumlahKaryawan,
    jumlahPasien,
    setJumlahPasien,
    jumlahPasienResep,
    setJumlahPasienResep,
    jumlahPasienNonResep,
    products: selectedProducts,
    addProductRow,
    removeProductRow,
    updateProductRow,
    selectProductFromSidebar,
    canvasserProducts,
    personsList,
    loadingPersons,
    loadingOutletData,
    loadingSurvey,
    productsMenang,
    productsInsentif,
    insentifHistory,
    historySalesData,
    salesOnlineData,
    surveyData,
    surveyNexusData,
    rekomendasiProduk,
    cashbackData,
    cashbackDetails,
    cashbackPeriode,
    scHistoryIncentiveMap,
    totalOutletHistoryIncentive,
    historyIncentiveQuarter,
    historyIncentiveYear,
    isLoadingIncentiveHistory,
    diskonPeriode,
    errors,
    isPending,
    handleSubmit,
    handleCancel,
  } = useSalesCounterEditor({
    poaId,
    poaPeriod,
    redirectTo: `/sc/${poaId}`,
    masterProducts: products,
    outlets,
    savedDrafts,
    initialOutletId,
  });

  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [posmVal, setPosmVal] = useState(0);

  // Period / Quarter setup
  const validPeriodMatch = poaPeriod.match(/^(\d{4})-Q([1-4])$/);
  const poaYear = validPeriodMatch ? parseInt(validPeriodMatch[1], 10) : new Date().getFullYear();
  const rowQuarterPeriod = `${poaYear}-Q${rowQuarter}`;
  const quarterMonths = quarterToMonths(validPeriodMatch ? rowQuarterPeriod : `${new Date().getFullYear()}-Q1`);

  const activeMonths = useMemo(() => {
    if (periodeAwal && /^\d{6}$/.test(periodeAwal) && lamaPeriode > 0) {
      return expandPeriodeMonths(periodeAwal, lamaPeriode);
    }
    return quarterMonths;
  }, [periodeAwal, lamaPeriode, quarterMonths]);

  const quartersOptions = useMemo(
    () => [
      { number: 1, label: "Q1", monthsName: ["Jan", "Feb", "Mar"] },
      { number: 2, label: "Q2", monthsName: ["Apr", "Mei", "Jun"] },
      { number: 3, label: "Q3", monthsName: ["Jul", "Agu", "Sep"] },
      { number: 4, label: "Q4", monthsName: ["Okt", "Nov", "Des"] },
    ],
    []
  );

  const handleQuarterChange = (qNum: number) => {
    setRowQuarter(qNum);
    const newQuarterPeriod = `${poaYear}-Q${qNum}`;
    const newMonths = quarterToMonths(newQuarterPeriod);
    if (newMonths.length > 0) {
      setPeriodeAwal(newMonths[0]);
    }
    const outletParam = outletId ? `?outlet=${encodeURIComponent(outletId)}` : "";
    router.push(`/sc/${newQuarterPeriod}/edit${outletParam}`);
  };

  const selectedOutlet = useMemo(
    () => outlets.find((o) => o.kodePI === outletId) ?? null,
    [outlets, outletId]
  );

  const activeDraft = useMemo(
    () => (outletId ? savedDrafts.find((d: any) => d.kodePI === outletId) : null),
    [savedDrafts, outletId]
  );

  const isFullyApproved = activeDraft?.status === "APPROVED_BY_NSM";
  const isSubmittingEditRequest =
    activeDraft &&
    activeDraft.status !== "DRAFT" &&
    activeDraft.status !== "REVISI" &&
    !isFullyApproved;

  const currentStatus = activeDraft ? activeDraft.status : "DRAFT";
  const currentVersion = activeDraft ? activeDraft.version : 1;

  const [b3SalesMap, setB3SalesMap] = useState<Map<string, number>>(new Map());
  const [b3QtyMap, setB3QtyMap] = useState<Map<string, number>>(new Map());
  const [b3HistorySalesData, setB3HistorySalesData] = useState<any>(null);
  const [b3RangeLabel, setB3RangeLabel] = useState<string>("");
  const [outletTotalAvgB3Sales, setOutletTotalAvgB3Sales] = useState<number>(0);
  const [isEntertainOpen, setIsEntertainOpen] = useState(false);

  useEffect(() => {
    setB3SalesMap(new Map());
    setB3QtyMap(new Map());
    setB3HistorySalesData(null);
    setOutletTotalAvgB3Sales(0);

    if (!outletId) {
      setB3RangeLabel("");
      return;
    }
    const b3Info = getB3RollingPeriodInfo(poaPeriod);
    setB3RangeLabel(b3Info.rangeLabel);

    const scProCodes = Array.from(new Set(canvasserProducts.map((cp) => cp.pro_code).filter(Boolean)));
    if (scProCodes.length === 0) {
      return;
    }

    postHistorySalesAction([outletId], b3Info.targetPeriods, scProCodes, false).then((res) => {
      const parsed = parseOutletHistorySales(res, outletId);
      if (parsed.averageSales > 0 || parsed.productSalesMap.size > 0) {
        setB3SalesMap(parsed.productSalesMap);
        setB3QtyMap(parsed.productQtyMap);
        setOutletTotalAvgB3Sales(parsed.averageSales);
        setB3HistorySalesData(res);
      } else {
        // Fallback to getScOutletB3SalesAction for all SC products
        getScOutletB3SalesAction(b3Info.period, outletId, scProCodes).then((fallbackRes) => {
          const map = new Map<string, number>();
          const qMap = new Map<string, number>();
          let totalVal = 0;
          if (fallbackRes?.data && Array.isArray(fallbackRes.data)) {
            for (const item of fallbackRes.data) {
              if (item.pro_code) {
                const val = Number(item.average_sales) || 0;
                const qVal = Number(item.average_qty) || 0;
                map.set(item.pro_code, val);
                map.set(item.pro_code.replace(/^0+/, ""), val);
                qMap.set(item.pro_code, qVal);
                qMap.set(item.pro_code.replace(/^0+/, ""), qVal);
                totalVal += val;
              }
            }
          }
          if (map.size > 0) {
            setB3SalesMap(map);
            setB3QtyMap(qMap);
            setOutletTotalAvgB3Sales(totalVal);
          }
        });
      }
    });
  }, [outletId, poaPeriod, canvasserProducts]);

  const productOptions = useMemo(() => {
    return buildScProductOptions({
      canvasserProducts,
      productsMenang,
      productsInsentif,
      masterProducts: products,
      historySalesData,
      surveyData,
    });
  }, [canvasserProducts, productsMenang, productsInsentif, products, historySalesData, surveyData]);

  const [historyEntertain, setHistoryEntertain] = useState<number | null>(null);
  const [loadingHistoryEntertain, setLoadingHistoryEntertain] = useState(false);

  useEffect(() => {
    const outletCode = selectedOutlet?.kodePI;
    if (!outletCode) {
      setHistoryEntertain(null);
      return;
    }
    let isMounted = true;
    setLoadingHistoryEntertain(true);
    getHistoryEntertainAction(outletCode)
      .then((val) => {
        if (isMounted) setHistoryEntertain(val ?? 0);
      })
      .catch((err) => {
        console.error("Error fetching history entertain:", err);
        if (isMounted) setHistoryEntertain(0);
      })
      .finally(() => {
        if (isMounted) setLoadingHistoryEntertain(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedOutlet?.kodePI]);

  // Online vs Offline Komposisi Sales Calculation
  const [onlinePiSales, setOnlinePiSales] = useState<number>(0);
  const [offlineHistoricalSales, setOfflineHistoricalSales] = useState<number>(0);

  useEffect(() => {
    if (!outletId) {
      setOfflineHistoricalSales(0);
      return;
    }
    const prevQInfo = getPreviousQuarterInfo(poaPeriod);
    const prevQQuarterPeriod = `${prevQInfo.year}-${prevQInfo.quarter}`;
    const prevQMonths = quarterToMonths(prevQQuarterPeriod);

    let isMounted = true;
    postHistorySalesAction([outletId], prevQMonths).then((res) => {
      if (!isMounted) return;
      const parsed = parseOutletHistorySales(res, outletId);
      setOfflineHistoricalSales(parsed.totalSales || 0);
    });

    return () => {
      isMounted = false;
    };
  }, [outletId, poaPeriod]);

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

  const monthlyBreakdown = activeMonths.map((m) => {
    let monthlyEstimasiSales = 0;
    let monthlyNilaiSc = 0;

    for (const row of selectedProducts) {
      if (!row.kodeProduk) continue;
      const masterProduct = products.find((pr) => pr.kodeProduk === row.kodeProduk);
      if (!masterProduct) continue;
      const canvasserProd = canvasserProducts.find((cp) => cp.pro_code === row.kodeProduk);

      const hnaSJ = parseFloat(masterProduct.hna) || 0;
      const qty = parseFloat(row.qtyPerBulan) || 0;
      const estSalesPerMonth = qty * hnaSJ;
      const pctMatriks = parseFloat(row.persenMatriksSc) || 0;

      const scVal = canvasserProd?.sales_counter_value;
      const scMin = canvasserProd?.sales_counter_minimum || 0;

      let valScPerMonth = 0;
      if (scVal != null && scVal > 0) {
        valScPerMonth = qty >= scMin ? qty * scVal : 0;
      } else {
        valScPerMonth = estSalesPerMonth * (pctMatriks / 100);
      }

      monthlyEstimasiSales += estSalesPerMonth;
      monthlyNilaiSc += valScPerMonth;
    }

    return {
      month: m,
      label: formatMonthLabel(m),
      estimasiSales: monthlyEstimasiSales,
      nilaiSc: monthlyNilaiSc,
    };
  });

  const totalMonthlyEstimasiSales = monthlyBreakdown.reduce((sum, item) => sum + item.estimasiSales, 0);
  const totalMonthlyNilaiSc = monthlyBreakdown.reduce((sum, item) => sum + item.nilaiSc, 0);

  const totalEstimasiSales = selectedProducts.reduce((sum, row) => {
    if (!row.kodeProduk) return sum;
    const masterProduct = products.find((pr) => pr.kodeProduk === row.kodeProduk);
    if (!masterProduct) return sum;
    const hnaSJ = parseFloat(masterProduct.hna) || 0;
    const qty = parseFloat(row.qtyPerBulan) || 0;
    return sum + (qty * hnaSJ * lamaPeriode);
  }, 0);

  const totalNilaiSc = selectedProducts.reduce((sum, row) => {
    if (!row.kodeProduk) return sum;
    const masterProduct = products.find((pr) => pr.kodeProduk === row.kodeProduk);
    if (!masterProduct) return sum;
    const canvasserProd = canvasserProducts.find((cp) => cp.pro_code === row.kodeProduk);
    const hnaSJ = parseFloat(masterProduct.hna) || 0;
    const qty = parseFloat(row.qtyPerBulan) || 0;
    const estSalesBln = qty * hnaSJ;
    const scVal = canvasserProd?.sales_counter_value;
    const scMin = canvasserProd?.sales_counter_minimum || 0;
    let valScBln = 0;
    if (scVal != null && scVal > 0) {
      valScBln = qty >= scMin ? qty * scVal : 0;
    } else {
      const pctMatriks = parseFloat(row.persenMatriksSc) || 0;
      valScBln = estSalesBln * (pctMatriks / 100);
    }
    return sum + (valScBln * lamaPeriode);
  }, 0);

  const isCashbackNotFound =
    !cashbackData ||
    (cashbackData as any)?.message === "Gudang Tidak Ditemukan" ||
    (typeof (cashbackData as any)?.message === "string" &&
      ((cashbackData as any).message.toLowerCase().includes("tidak ditemukan") ||
        (cashbackData as any).message.toLowerCase().includes("gudang"))) ||
    (typeof (cashbackData as any)?.data?.message === "string" &&
      ((cashbackData as any).data.message.toLowerCase().includes("tidak ditemukan") ||
        (cashbackData as any).data.message.toLowerCase().includes("gudang"))) ||
    (cashbackData as any)?.status === false ||
    (cashbackData as any)?.success === false;

  const totalCashbackVal = isCashbackNotFound ? 0 : (cashbackDetails?.totalFinalCashback ?? 0);

  const totalDiskonVal = selectedProducts.reduce((sum, row) => {
    if (!row.kodeProduk) return sum;
    const masterProduct = products.find((pr) => pr.kodeProduk === row.kodeProduk);
    if (!masterProduct) return sum;
    const hnaSJ = parseFloat(masterProduct.hna) || 0;
    const qty = parseFloat(row.qtyPerBulan) || 0;
    const estSalesBln = qty * hnaSJ;
    const pctDiskon = parseFloat(row.persenDiskon) || 0;
    return sum + (estSalesBln * (pctDiskon / 100) * lamaPeriode);
  }, 0);

  const totalEntertainVal = entertainList.reduce((sum, item) => sum + (parseFloat(item.value) || 0), 0);
  const totalEstimasiBudget = totalNilaiSc + totalCashbackVal + totalEntertainVal + totalDiskonVal;
  const costRatio = totalEstimasiSales > 0 ? (totalEstimasiBudget / totalEstimasiSales) * 100 : 0;

  let totalSelectedProductsAvgB3Bln = 0;
  for (const row of selectedProducts) {
    if (!row.kodeProduk) continue;
    const avgSales = b3SalesMap.get(row.kodeProduk);
    if (avgSales != null && avgSales > 0) {
      totalSelectedProductsAvgB3Bln += avgSales;
    }
  }

  // Baseline histori penjualan seluruh produk di outlet (post-history-sales)
  const effectiveOutletAvgB3Bln =
    outletTotalAvgB3Sales > 0 ? outletTotalAvgB3Sales : totalSelectedProductsAvgB3Bln;
  const hasB3Data = effectiveOutletAvgB3Bln > 0;
  const totalEstSalesBln = totalEstimasiSales / (lamaPeriode > 0 ? lamaPeriode : 1);
  const totalGrowthPct = hasB3Data
    ? ((totalEstSalesBln - effectiveOutletAvgB3Bln) / effectiveOutletAvgB3Bln) * 100
    : null;

  const selectedCodesNormalized = useMemo(() => {
    return new Set(
      selectedProducts
        .map((p) => (p.kodeProduk ? p.kodeProduk.replace(/^0+/, "").toUpperCase() : ""))
        .filter(Boolean)
    );
  }, [selectedProducts]);

  const productGrowthAnalysis = useMemo(() => {
    const selectedAnalyzed = selectedProducts
      .map((row) => {
        if (!row.kodeProduk) return null;
        const masterProduct = products.find((pr) => pr.kodeProduk === row.kodeProduk);
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

        const masterProd = products.find(
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
    selectedProducts,
    products,
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

  const monthlyMonths = useMemo(() => {
    if (periodeAwal && /^\d{6}$/.test(periodeAwal.replace(/[^0-9]/g, "")) && lamaPeriode > 0) {
      return expandPeriodeMonths(periodeAwal.replace(/[^0-9]/g, ""), lamaPeriode);
    }
    return quarterToMonths(rowQuarterPeriod);
  }, [rowQuarterPeriod, periodeAwal, lamaPeriode]);

  const scProductItems: ScProductItemData[] = useMemo(() => {
    const items: ScProductItemData[] = [];
    selectedProducts.forEach((row, idx) => {
      if (!row.kodeProduk) return;
      const master = products.find((p) => p.kodeProduk === row.kodeProduk);
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
  }, [selectedProducts, products, canvasserProducts, monthlyMonths]);

  const productDetailRows = useMemo(() => {
    return calculateProductDetailRows({
      scProducts: scProductItems,
      lama: lamaPeriode,
      periodeAwal,
      cashbackData,
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
    cashbackData,
    cashbackDetails,
    b3SalesMap,
    outletTotalAvgB3Sales,
    scHistoryIncentiveMap,
    totalOutletHistoryIncentive,
  ]);

  const unselectedProducts = useMemo(() => {
    if (!b3SalesMap || b3SalesMap.size === 0) return [];
    const selectedNorm = new Set<string>();
    for (const p of selectedProducts) {
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

      const matchedMaster = products?.find((p: any) => {
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
  }, [b3SalesMap, selectedProducts, products, canvasserProducts, lamaPeriode]);

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6 p-3 sm:p-6 max-w-5xl w-full max-w-full overflow-hidden">
        <div className="space-y-6">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-xl font-bold" style={{ color: "var(--color-text)" }}>
                {isFullyApproved
                  ? `Detail Rencana POA (${activeDraft?.namaOutlet || outletId})`
                  : activeDraft
                  ? `Edit Rencana POA (${activeDraft.namaOutlet || outletId})`
                  : outletId
                  ? `Tambah Rencana POA (${selectedOutlet?.namaOutlet || outletId})`
                  : "Tambah Rencana POA Sales Counter"}
              </h2>
              <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
                Periode {rowQuarterPeriod} {ownerName ? `· ${ownerName}` : ""}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {outletId && (
                <StatusBadge status={currentStatus} version={currentVersion} />
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Quarter</span>
                <select
                  value={rowQuarter}
                  onChange={(e) => handleQuarterChange(parseInt(e.target.value, 10))}
                  className="input-field font-semibold text-xs px-3 py-1.5 h-9 rounded-md border"
                  style={{
                    background: "var(--color-bg)",
                    borderColor: "var(--color-border)",
                    color: "var(--color-text)",
                  }}
                >
                  {quartersOptions.map((q) => (
                    <option key={q.number} value={q.number}>
                      {q.label} ({q.monthsName.join("-")})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {isFullyApproved && (
            <div
              className="rounded-md px-4 py-3 text-sm font-medium"
              style={{
                background: "var(--color-blue-light, #eff6ff)",
                color: "var(--color-blue)",
                border: "1px solid var(--color-blue)",
              }}
            >
              Outlet ini sudah berstatus <strong>Fully Approved</strong> pada periode ini sehingga rencana tidak dapat diubah lagi (Mode Lihat Saja).
            </div>
          )}

          {isSubmittingEditRequest && (
            <div
              className="rounded-md px-4 py-3 text-sm font-medium"
              style={{
                background: "var(--color-warning-bg, #fef3c7)",
                color: "var(--color-warning, #b45309)",
                border: "1px solid var(--color-warning, #f59e0b)",
              }}
            >
              Outlet ini sudah berstatus <strong>{formatHumanStatus(activeDraft?.status)}</strong> pada periode ini. Anda dapat mengubah data rencana ini dan menyimpannya sebagai <strong>Ajukan Edit</strong> (status akan di-reset untuk di-review kembali oleh {activeDraft?.status === "SUBMITTED_TO_NSM" ? "NSM" : activeDraft?.status === "SUBMITTED_TO_SM" || activeDraft?.status === "APPROVED_BY_SM" ? "SM" : "ASM"}).
            </div>
          )}

          {/* 1. OUTLET */}
          <div className="space-y-4">
            <SectionLabel>Outlet</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium" style={{ color: errors.outletId ? "var(--color-red)" : "var(--color-text-muted)" }}>
                  Outlet <Req />
                </span>
                <div style={errors.outletId ? ERR_RING : undefined}>
                  <Combobox
                    name="outletId"
                    options={outlets
                      .map((o) => {
                        const isSc = !!(o as any).is_sc;
                        const isBlastIn = !!(o as any).isBlastIn;
                        const isPosm = !!(o as any).isPosm;
                        const isOnline = !!(o as any).isOnline;
                        const statusCount = (isSc ? 1 : 0) + (isBlastIn ? 1 : 0) + (isPosm ? 1 : 0) + (isOnline ? 1 : 0);
                        const jumlahSc = (o as any).jumlah_sc;
                        const rawCreated = (o as any).created ?? (o as any).created_at;
                        let createdPeriodStr = "";
                        if (rawCreated != null) {
                          const str = String(rawCreated).trim();
                          const m = str.match(/^(\d{4})[-/]?(\d{2})/);
                          if (m) {
                            createdPeriodStr = `${m[1]}${m[2]}`;
                          }
                        }

                        const sublabelParts: string[] = [];
                        if (isSc && jumlahSc != null) {
                          sublabelParts.push(`Jumlah Sales Counter: ${jumlahSc}`);
                        }
                        if (createdPeriodStr) {
                          sublabelParts.push(`Periode Pendaftaran Insentif SC : ${createdPeriodStr}`);
                        }
                        const sublabel = sublabelParts.length > 0 ? sublabelParts.join(" · ") : undefined;

                        const tags: { tag: string; color: any }[] = [];
                        if (isSc) tags.push({ tag: "INS - SC", color: "indigo" as const });
                        if (isBlastIn) tags.push({ tag: "BLAST-IN", color: "gray" as const });
                        if (isPosm) tags.push({ tag: "POSM", color: "purple" as const });
                        if (isOnline) tags.push({ tag: "ONLINE", color: "yellow" as const });

                        return {
                          value: o.kodePI,
                          label: `${o.kodePI} · ${o.namaOutlet}${o.groupRS ? ` (${o.groupRS})` : ""}`,
                          sublabel,
                          tags,
                          tag: tags[0]?.tag,
                          tagColor: tags[0]?.color,
                          tag2: tags[1]?.tag,
                          tag2Color: tags[1]?.color,
                          tag3: tags[2]?.tag,
                          tag3Color: tags[2]?.color,
                          statusCount,
                        };
                      })
                      .sort((a, b) => {
                        if (b.statusCount !== a.statusCount) return b.statusCount - a.statusCount;
                        return a.label.localeCompare(b.label);
                      })}
                    value={outletId}
                    onChange={setOutletId}
                    placeholder="Cari outlet..."
                    emptyMessage="Tidak ada outlet di coverage Anda."
                    required
                  />
                </div>
                {errors.outletId && <span className="text-xs" style={{ color: "var(--color-red)" }}>{errors.outletId}</span>}
                {outletId && selectedOutlet && (() => {
                  const statusItems: string[] = [];
                  if ((selectedOutlet as any).is_sc) statusItems.push("Ins-SC");
                  if ((selectedOutlet as any).isBlastIn) statusItems.push("Blast-In");
                  if ((selectedOutlet as any).isOnline) statusItems.push("Online");
                  if ((selectedOutlet as any).isPosm) statusItems.push("POSM");
                  if (statusItems.length === 0) return null;

                  return (
                    <div className="text-[11px] font-medium mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                      {statusItems.join(", ")}
                    </div>
                  );
                })()}
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                  Sektor
                </span>
                <div
                  className="input-field flex items-center px-3 text-sm h-[38px]"
                  style={{ background: "var(--color-bg-subtle)", opacity: 0.85, cursor: "not-allowed" }}
                >
                  {selectedOutlet?.sector || "-"}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                  Subsektor
                </span>
                <div
                  className="input-field flex items-center px-3 text-sm h-[38px]"
                  style={{ background: "var(--color-bg-subtle)", opacity: 0.85, cursor: "not-allowed" }}
                >
                  {selectedOutlet?.subSektor || "-"}
                </div>
              </div>
            </div>

            {outletId && !!selectedOutlet?.isOnline && (
              <>
                <KomposisiSalesWidget onlinePct={komposisiOnlinePct} offlinePct={komposisiOfflinePct} />
                <OnlineApotekSalesWidget
                  poaPeriod={poaPeriod}
                  outletCode={outletId}
                  outletName={selectedOutlet?.namaOutlet}
                  isOnline={selectedOutlet?.isOnline}
                  onTotalPiSalesChange={setOnlinePiSales}
                />
              </>
            )}

            {outletId && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium" style={{ color: errors.personId ? "var(--color-red)" : "var(--color-text-muted)" }}>
                    Pilih Sales Counter <Req />
                    {selectedPersonIds.length > 0 && ` (${selectedPersonIds.length} terpilih)`}
                  </span>
                  {errors.personId && (
                    <span className="text-xs font-semibold" style={{ color: "var(--color-red)" }}>
                      {errors.personId}
                    </span>
                  )}
                </div>

                {loadingPersons ? (
                  <div className="text-xs py-4 text-center animate-pulse" style={{ color: "var(--color-text-faint)" }}>
                    Memuat Sales Counter...
                  </div>
                ) : personsList.length === 0 ? (
                  <div className="text-xs py-4 text-center border rounded-lg" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
                    Tidak ada Sales Counter di outlet ini.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
                    <table className="w-full text-xs text-left min-w-[380px]" style={{ borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-subtle)" }}>
                          <th className="py-2.5 px-3 w-10 text-center whitespace-nowrap">
                            <input
                              type="checkbox"
                              checked={personsList.length > 0 && personsList.every((p) => selectedPersonIds.includes(p.person_id))}
                              onChange={() => toggleSelectAll(personsList)}
                              className="cursor-pointer"
                            />
                          </th>
                          <th className="py-2.5 px-3 font-semibold whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>Sales Counter</th>
                          <th className="py-2.5 px-3 font-semibold whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>Jabatan</th>
                          <th className="py-2.5 px-3 font-semibold whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>Tipe Upload</th>
                        </tr>
                      </thead>
                      <tbody>
                        {personsList.map((p) => {
                          const isChecked = selectedPersonIds.includes(p.person_id);
                          const isFocused = personId === p.person_id;
                          return (
                            <tr
                              key={p.person_id}
                              onClick={() => setPersonId(p.person_id)}
                              className="cursor-pointer transition-colors hover:bg-[var(--color-bg-subtle)]"
                              style={{
                                borderBottom: "1px solid var(--color-border)",
                                background: isFocused ? "var(--color-blue-light, #eff6ff)" : "transparent",
                              }}
                            >
                              <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleSelectPerson(p.person_id)}
                                  className="cursor-pointer"
                                />
                              </td>
                              <td className="py-2.5 px-3 font-medium" style={{ color: "var(--color-text)" }}>
                                <div>{p.person_name}</div>
                              </td>
                              <td className="py-2.5 px-3" style={{ color: "var(--color-text-muted)" }}>{p.position_name}</td>
                              <td className="py-2.5 px-3" style={{ color: "var(--color-text-muted)" }}>{p.tipe_upload_sc || "-"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
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

          {/* 3. PRODUK YANG DIPROMOSIKAN */}
          <div>
            <div>
              <SectionLabel>Produk yang Dipromosikan</SectionLabel>
              <ProductSelector
                kodePI={selectedOutlet?.kodePI || ""}
                rows={selectedProducts}
                onAddRow={addProductRow}
                onRemoveRow={removeProductRow}
                onUpdateRow={updateProductRow}
                productsOptions={productOptions}
                canvasserProducts={canvasserProducts}
                masterProducts={products}
                readOnly={isFullyApproved}
                lamaPeriode={lamaPeriode}
                periodeAwal={periodeAwal}
                diskonPeriode={diskonPeriode}
                cashbackPeriode={cashbackPeriode}
                cashbackData={cashbackData}
                hideCashback={isCashbackNotFound}
                isLoading={loadingOutletData}
                error={errors.products}
                b3SalesMap={b3SalesMap}
                b3QtyMap={b3QtyMap}
                b3RangeLabel={b3RangeLabel}
                surveyNexusData={surveyNexusData}
                historySalesData={b3HistorySalesData || historySalesData}
              />
            </div>

            {/* 5. Rencana Entertain Breakdown Table */}
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
                    <table className="w-full text-xs text-left animate-fade-in min-w-[320px]" style={{ borderCollapse: "collapse" }}>
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
                                <UnitInput
                                  value={row.value}
                                  onChange={(val) => updateEntertainValue(row.month, val)}
                                  unit="Rp"
                                  placeholder="0"
                                />
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


            {/* Tabel BLAST-IN & POSM (Autofill data - ditempatkan di bawah Rencana Entertain) */}
            {selectedOutlet?.isBlastIn && (
              <BlastInTable
                poaPeriod={poaPeriod}
                quarter={rowQuarter}
                outletId={selectedOutlet.kodePI}
                estimasiSales={totalEstimasiSales}
              />
            )}
            {selectedOutlet?.kodePI && (
              <PosmTable
                poaPeriod={poaPeriod}
                quarter={rowQuarter}
                outletId={selectedOutlet.kodePI}
                onTotalValueChange={setPosmVal}
              />
            )}
          </div>

          {/* 5. TOTAL SEMUA PRODUK */}
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
                  {hasB3Data ? (
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
            {(selectedProducts.some((p) => p.kodeProduk) || unselectedProducts.length > 0) && (
              <div className="space-y-3 pt-3" style={{ borderTop: "1px solid var(--color-border)" }}>
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                  Estimasi &amp; Insentif SC Per Produk
                </p>
                <SalesCounterProductBreakdownTable
                  productDetailRows={productDetailRows}
                  lama={lamaPeriode}
                  b3RangeLabel={b3RangeLabel}
                  isLoadingB3={loadingOutletData}
                  isLoadingIncentiveHistory={isLoadingIncentiveHistory}
                  unselectedProducts={unselectedProducts}
                  isForm={true}
                />
              </div>
            )}
          </div>

          {/* ESTIMASI & INSENTIF SC/CASHBACK PER BULAN */}
          {monthlyBreakdown.length > 0 && selectedProducts.some(p => p.kodeProduk) && (
            <MonthlyBreakdownTable
              monthlyBreakdown={monthlyBreakdown}
              totalMonthlyEstimasiSales={totalMonthlyEstimasiSales}
              totalMonthlyNilaiSc={totalMonthlyNilaiSc}
              totalCashbackVal={totalCashbackVal}
              lamaPeriode={lamaPeriode}
              isCashbackHidden={isCashbackNotFound}
            />
          )}
        </div>

        {/* Validation Error Summary Banner */}
        {Object.keys(errors).length > 0 && (
          <div className="rounded-lg p-3 text-xs space-y-1 my-2" style={{ background: "var(--color-red-light, #fef2f2)", color: "var(--color-red, #dc2626)", border: "1px solid #fecaca" }}>
            <p className="font-bold">Tidak dapat menyimpan rencana POA:</p>
            <ul className="list-disc list-inside space-y-0.5 font-medium">
              {Object.values(errors).map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 pt-4 pb-10 md:pb-0 border-t" style={{ borderColor: "var(--color-border)" }}>
          <Button type="button" variant={isFullyApproved ? "secondary" : "ghost"} onClick={handleCancel} disabled={isPending}>
            {isFullyApproved ? "Kembali" : "Batal"}
          </Button>
          {!isFullyApproved && (
            <Button type="submit" disabled={isPending}>
              {isPending
                ? "Menyimpan..."
                : isSubmittingEditRequest
                ? "Ajukan Edit"
                : "Simpan Rencana"}
            </Button>
          )}
        </div>
      </form>
      {outletId && (
        <ScSidebar
          poaPeriod={poaPeriod}
          doctorName={selectedOutlet?.namaOutlet || undefined}
          productsMenang={productsMenang}
          productsInsentif={productsInsentif}
          insentifHistory={insentifHistory}
          historySalesData={historySalesData}
          salesOnlineData={salesOnlineData}
          surveyData={surveyData}
          surveyNexusData={surveyNexusData}
          rekomendasiProduk={rekomendasiProduk}
          masterProducts={products}
          canvasserProducts={canvasserProducts}
          selectedProductCodes={new Set(selectedProducts.map((p) => p.kodeProduk).filter(Boolean))}
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
        showCashback={!isCashbackNotFound}
        showBlastIn={!!selectedOutlet?.isBlastIn}
        showPosm={!!selectedOutlet?.isPosm}
        costRatio={costRatio}
      />
    </>
  );
}
