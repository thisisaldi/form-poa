"use client";

import { useState, useMemo, useEffect } from "react";
import type { Product } from "@/lib/masterData";
import type { Person } from "../types/person";
import type { EntertainItem, EntertainRow } from "../types/entertain";
import type { SelectedProductRow } from "../types/productRow";
import type { SalesCounterProduct } from "@/app/(app)/sc/[id]/_models/SalesCounterProductModel";
import type { LossSalesRekomendasiProduct } from "@/app/(app)/sc/[id]/_models/ScProductRecommendationModel";
import {
  getScOutletBundleAction,
  getSalesCounterProductsAction,
  getScProductMenangAction,
  getScProductWithInsentifAction,
  getScInsentifHistoryAction,
  getScCashbackPoaAction,
  getScOutletB3SalesAction,
  postHistorySalesAction,
  getRekomendasiProdukAction,
  getSalesOnlineAction,
  getHistoryEntertainAction,
  getSurveyNexusAction,
  getScHistoryIncentiveCounterAction,
} from "@/app/actions/canvasser";
import { getDiskonDplDpfByPeriodeAction } from "@/app/actions/scActions";
import { getSurveyRekomendasiByOutletAggregate } from "@/app/actions/customer";
import { calculateCashbackDetails } from "./useSalesCounterCashback";
import { expandPeriodeMonths } from "@/lib/poaUtils";
import { quarterToMonths, resolvePeriodForQuarter } from "@/lib/quarterUtils";
import { getB3RollingPeriodInfo } from "@/lib/b3Utils";
import { parseOutletHistorySales } from "@/lib/historySalesUtils";
import { formatDiskonPct, formatCashbackPct } from "../utils/formatEditUtils";
import { findDiskonItem, findCashbackItem } from "../utils/productMatcherUtils";
import { formatMonthLabel } from "../utils/periodUtils";
import { buildScProductOptions } from "../utils/productOptionBuilder";
import { extractQuarterAndYear } from "@/components/sc/detail/utils/outletCalculationUtils";

interface UseSalesCounterEditByIdParams {
  poaPeriod: string;
  kodePI: string;
  persons: Person[];
  initialProducts: Array<{
    id?: string;
    kodeProduk: string;
    namaProduk?: string;
    produkKompetitor: string | null;
    periodeMonth?: string;
    qtyPerBulan: number;
    persenMatriksSc: number;
    persenDiskon: number;
    persenCashback: number;
    rencanaTotalBiaya: number;
  }>;
  initialEntertainItems: EntertainItem[];
  initialPeriodeAwal: string;
  initialLamaPeriode: number;
  initialJumlahKaryawan?: number | null;
  initialJumlahPasien?: number | null;
  initialJumlahPasienResep?: number | null;
  initialJumlahPasienNonResep?: number | null;
  masterProducts: Product[];
}

export function useSalesCounterEditById({
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
}: UseSalesCounterEditByIdParams) {
  // Pre-filled locked values
  const selectedPersonIds = persons.map((p) => parseInt(p.outletPersonId || p.nik_ktp, 10));

  // Quarter & period setup
  const extracted = useMemo(() => {
    return extractQuarterAndYear(poaPeriod, initialPeriodeAwal);
  }, [poaPeriod, initialPeriodeAwal]);
  const poaYear = parseInt(extracted.year, 10) || new Date().getFullYear();
  const initialRowQuarter = parseInt(extracted.quarter.replace(/^Q/i, ""), 10) || 1;

  const [rowQuarter, setRowQuarter] = useState(initialRowQuarter);
  const [periodeAwal, setPeriodeAwal] = useState(initialPeriodeAwal);
  const [lamaPeriode, setLamaPeriode] = useState(3);

  const effectivePoaPeriod = `${poaYear}-Q${rowQuarter}`;
  const quarterMonths = useMemo(() => quarterToMonths(effectivePoaPeriod), [effectivePoaPeriod]);

  // Editable states - pre-filled from DB
  const [jumlahKaryawan, setJumlahKaryawan] = useState(String(initialJumlahKaryawan ?? ""));
  const [jumlahPasien, setJumlahPasien] = useState(String(initialJumlahPasien ?? ""));
  const [jumlahPasienResep, setJumlahPasienResep] = useState(String(initialJumlahPasienResep ?? ""));

  const jumlahPasienNonResep = useMemo(() => {
    const numPasien = parseInt(jumlahPasien, 10);
    const numResep = parseInt(jumlahPasienResep, 10);
    if (!isNaN(numPasien) && !isNaN(numResep)) {
      return String(Math.max(0, numPasien - numResep));
    }
    return String(initialJumlahPasienNonResep ?? "0");
  }, [jumlahPasien, jumlahPasienResep, initialJumlahPasienNonResep]);

  // Products editable - group multi-month items by kodeProduk
  const [products, setProducts] = useState<SelectedProductRow[]>(() => {
    if (initialProducts.length === 0) {
      return [{ kodeProduk: "", produkKompetitor: "", qtyPerBulan: "", persenMatriksSc: "", persenDiskon: "", persenCashback: "", rencanaTotalBiaya: 0 }];
    }

    const groupMap = new Map<string, typeof initialProducts>();
    for (const p of initialProducts) {
      if (!groupMap.has(p.kodeProduk)) {
        groupMap.set(p.kodeProduk, []);
      }
      groupMap.get(p.kodeProduk)!.push(p);
    }

    // Selalu gunakan 3 bulan kuartal (mis. 2026-Q3 -> Jul, Agu, Sep) agar tetap tampil 3 box walaupun 0
    let periodMonths: string[] = [];
    try {
      periodMonths = quarterToMonths(`${poaYear}-Q${initialRowQuarter}`);
    } catch {
      periodMonths = [];
    }
    if (periodMonths.length !== 3) {
      const startYear = parseInt(initialPeriodeAwal.slice(0, 4), 10);
      const startMonth = parseInt(initialPeriodeAwal.slice(4, 6), 10);
      for (let i = 0; i < 3; i++) {
        const d = new Date(startYear, startMonth - 1 + i, 1);
        periodMonths.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
      }
    }

    const groupedRows: SelectedProductRow[] = [];
    for (const [, items] of groupMap.entries()) {
      const primary = items[0];
      const monthMap = new Map<string, number>();
      for (const it of items) {
        if (it.periodeMonth) {
          monthMap.set(it.periodeMonth, it.qtyPerBulan);
        }
      }

      // Selalu sediakan 3 bulan kuartal (tetap pertahankan 3 box walaupun 0)
      let totalQty = 0;
      const monthlyQty = periodMonths.map((m) => {
        if (monthMap.has(m)) {
          const q = monthMap.get(m)!;
          totalQty += q;
          return String(q);
        }
        return "0";
      });

      const hasAnyMonthMapped = items.some((it) => it.periodeMonth && monthMap.has(it.periodeMonth));
      if (!hasAnyMonthMapped && primary.qtyPerBulan) {
        const def = primary.qtyPerBulan || 0;
        totalQty = def * 3;
        for (let i = 0; i < monthlyQty.length; i++) {
          monthlyQty[i] = String(def);
        }
      }

      const avgQty = totalQty / 3;
      const formattedAvg = avgQty % 1 === 0 ? avgQty.toString() : parseFloat(avgQty.toFixed(2)).toString();
      const totalRencana = items.reduce((sum, it) => sum + (it.rencanaTotalBiaya || 0), 0);

      groupedRows.push({
        kodeProduk: primary.kodeProduk,
        produkKompetitor: primary.produkKompetitor || "",
        qtyPerBulan: formattedAvg,
        monthlyQty,
        persenMatriksSc: String(primary.persenMatriksSc),
        persenDiskon: String(primary.persenDiskon),
        persenCashback: String(primary.persenCashback),
        rencanaTotalBiaya: totalRencana,
      });
    }

    return groupedRows.length > 0 ? groupedRows : [{ kodeProduk: "", produkKompetitor: "", qtyPerBulan: "", persenMatriksSc: "", persenDiskon: "", persenCashback: "", rencanaTotalBiaya: 0 }];
  });

  // Entertain
  const [entertainList, setEntertainList] = useState<EntertainRow[]>(() => {
    const validPeriodMatch = poaPeriod.match(/^(\d{4})-Q([1-4])$/);
    const y = validPeriodMatch ? parseInt(validPeriodMatch[1], 10) : new Date().getFullYear();
    const q = validPeriodMatch ? parseInt(validPeriodMatch[2], 10) : 1;
    const qPeriod = `${y}-Q${q}`;
    const mths = quarterToMonths(qPeriod);

    return mths
      .filter((m) => {
        const monthNum = parseInt(m.slice(4), 10);
        const startMonthNum = parseInt(initialPeriodeAwal.slice(4), 10);
        return monthNum >= startMonthNum;
      })
      .map((m) => {
        const existing = initialEntertainItems.find((e) => e.periodeMonth === m);
        return {
          month: m,
          label: formatMonthLabel(m),
          value: existing ? String(existing.biayaEntertain) : "",
        };
      });
  });

  const [historyEntertain, setHistoryEntertain] = useState<number | null>(null);
  const [loadingHistoryEntertain, setLoadingHistoryEntertain] = useState(false);

  const handlePeriodeAwalChange = (newStart: string, q = rowQuarter) => {
    setPeriodeAwal(newStart);
    if (!newStart) {
      setLamaPeriode(0);
      setEntertainList([]);
      return;
    }

    const startYear = parseInt(newStart.slice(0, 4), 10);
    const startMonth = parseInt(newStart.slice(4, 6), 10);
    const endMonth = q * 3;
    const calcDuration = endMonth - startMonth + 1;
    const duration = calcDuration > 0 ? calcDuration : 1;
    setLamaPeriode(duration);

    // Recalculate products rencanaTotalBiaya with new duration
    setProducts((prev) =>
      prev.map((row) => {
        const qty = parseFloat(row.qtyPerBulan) || 0;
        const masterProd = masterProducts.find((p) => p.kodeProduk === row.kodeProduk);
        const hna = parseFloat(masterProd?.hna || "0") || 0;
        const pctMatriks = parseFloat(row.persenMatriksSc) || 0;
        return {
          ...row,
          rencanaTotalBiaya: qty * hna * duration * (pctMatriks / 100),
        };
      })
    );

    setEntertainList((prevList) => {
      const newItems = [];
      for (let m = startMonth; m <= endMonth; m++) {
        const monthStr = String(m).padStart(2, "0");
        const periodMonth = `${startYear}${monthStr}`;
        const existingItem = prevList.find((item) => item.month === periodMonth);
        const existingInitial = initialEntertainItems.find((e) => e.periodeMonth === periodMonth);

        newItems.push({
          month: periodMonth,
          label: formatMonthLabel(periodMonth),
          value: existingItem ? existingItem.value : (existingInitial ? String(existingInitial.biayaEntertain) : ""),
        });
      }
      return newItems;
    });
  };

  const handleQuarterChange = (qNum: number) => {
    setRowQuarter(qNum);
    const newQuarterPeriod = `${poaYear}-Q${qNum}`;
    const newMonths = quarterToMonths(newQuarterPeriod);
    if (newMonths.length > 0) {
      handlePeriodeAwalChange(newMonths[0], qNum);
    }
  };

  const [canvasserProducts, setCanvasserProducts] = useState<SalesCounterProduct[]>([]);
  const [cashbackMatrix, setCashbackMatrix] = useState<any[]>([]);
  const [rawCashbackData, setRawCashbackData] = useState<any>(null);
  const [productsMenang, setProductsMenang] = useState<any[]>([]);
  const [productsInsentif, setProductsInsentif] = useState<any[]>([]);
  const [insentifHistory, setInsentifHistory] = useState<any>(null);
  const [historySalesData, setHistorySalesData] = useState<any>(null);
  const [b3HistorySalesData, setB3HistorySalesData] = useState<any>(null);
  const [salesOnlineData, setSalesOnlineData] = useState<any>(null);
  const [surveyData, setSurveyData] = useState<any[]>([]);
  const [surveyNexusData, setSurveyNexusData] = useState<any>(null);
  const [healthyOneData, setHealthyOneData] = useState<any[]>([]);
  const [loadingSurvey, setLoadingSurvey] = useState(false);
  const [rekomendasiProduk, setRekomendasiProduk] = useState<LossSalesRekomendasiProduct[]>([]);
  const [b3SalesMap, setB3SalesMap] = useState<Map<string, number>>(new Map());
  const [b3QtyMap, setB3QtyMap] = useState<Map<string, number>>(new Map());
  const [b3RangeLabel, setB3RangeLabel] = useState<string>("");
  const [outletTotalAvgB3Sales, setOutletTotalAvgB3Sales] = useState<number>(0);
  const [diskonList, setDiskonList] = useState<{ proCode: string; diskon: number }[]>([]);
  const [diskonPeriode, setDiskonPeriode] = useState<string>("");

  const effectiveDiskonPeriod = useMemo(
    () => periodeAwal || resolvePeriodForQuarter(poaPeriod),
    [periodeAwal, poaPeriod]
  );

  useEffect(() => {
    if (!effectiveDiskonPeriod) {
      setDiskonList([]);
      setDiskonPeriode("");
      return;
    }
    getDiskonDplDpfByPeriodeAction(effectiveDiskonPeriod).then((res) => {
      if (Array.isArray(res)) {
        setDiskonList(res);
        setDiskonPeriode(effectiveDiskonPeriod);
      } else {
        setDiskonList(res?.list || []);
        setDiskonPeriode(res?.diskonPeriode || effectiveDiskonPeriod);
      }
    });
  }, [effectiveDiskonPeriod]);

  useEffect(() => {
    if (diskonList.length === 0) return;
    setProducts((prev) =>
      prev.map((row) => {
        if (!row.kodeProduk) return row;
        const diskonItem = findDiskonItem(diskonList, row.kodeProduk);
        const autoPct = diskonItem ? formatDiskonPct(diskonItem.diskon) : "0";
        return row.persenDiskon === autoPct ? row : { ...row, persenDiskon: autoPct };
      })
    );
  }, [diskonList]);

  // Fetch bundle outlet data (products, b3 sales, survey, cashback, entertain, etc.) in a single round-trip
  useEffect(() => {
    if (!kodePI) {
      setHistoryEntertain(null);
      setCanvasserProducts([]);
      setCashbackMatrix([]);
      setRawCashbackData(null);
      setProductsMenang([]);
      setProductsInsentif([]);
      setHistorySalesData(null);
      setSalesOnlineData(null);
      setSurveyData([]);
      setSurveyNexusData(null);
      setRekomendasiProduk([]);
      setB3SalesMap(new Map());
      setB3QtyMap(new Map());
      setOutletTotalAvgB3Sales(0);
      return;
    }

    const b3Info = getB3RollingPeriodInfo(effectivePoaPeriod);
    setB3RangeLabel(b3Info.rangeLabel);

    let isMounted = true;
    setLoadingHistoryEntertain(true);
    setLoadingSurvey(true);

    getScOutletBundleAction({
      outletId: kodePI,
      includeEntertain: true,
      b3TargetPeriods: b3Info.targetPeriods,
      poaPeriod: effectivePoaPeriod,
    })
      .then((bundle) => {
        if (!isMounted) return;

        // Entertain
        setHistoryEntertain(bundle.historyEntertain ?? 0);

        // Canvasser products & draft product validation
        setCanvasserProducts(bundle.canvasserProducts);
        const validCodes = new Set(bundle.canvasserProducts.map((cp: any) => cp.pro_code).filter(Boolean));
        setProducts((prev) => {
          const filtered = prev.filter(
            (r) => !r.kodeProduk || validCodes.has(r.kodeProduk) || validCodes.has(r.kodeProduk.replace(/^0+/, ""))
          );
          return filtered.length > 0
            ? filtered
            : [{ kodeProduk: "", produkKompetitor: "", qtyPerBulan: "", persenMatriksSc: "", persenDiskon: "", persenCashback: "", rencanaTotalBiaya: 0 }];
        });

        // B3 sales
        if (bundle.b3SalesResponse) {
          setB3HistorySalesData(bundle.b3SalesResponse);
          const parsed = parseOutletHistorySales(bundle.b3SalesResponse, kodePI);
          if (parsed.averageSales > 0 || parsed.productSalesMap.size > 0) {
            setB3SalesMap(parsed.productSalesMap);
            setB3QtyMap(parsed.productQtyMap);
            setOutletTotalAvgB3Sales(parsed.averageSales);
          } else {
            // Fallback if needed
            const scProCodes = Array.from(validCodes) as string[];
            if (scProCodes.length > 0) {
              getScOutletB3SalesAction(b3Info.period, kodePI, scProCodes).then((fallbackRes) => {
                if (!isMounted) return;
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
          }
        }

        // Others
        setProductsMenang(bundle.productsMenang);
        setProductsInsentif(bundle.productsInsentif);
        setHistorySalesData(bundle.historySalesData);
        setSalesOnlineData(bundle.salesOnlineData);
        setSurveyData(bundle.surveyData);
        setSurveyNexusData(bundle.surveyNexusData);
        setHealthyOneData(bundle.healthyOneData || []);

        const latestSurvey = bundle.surveyNexusData?.data?.surveys?.[0];
        if (latestSurvey?.avg_patient != null) {
          setJumlahPasien((prev) => (!prev || prev === "0" ? String(latestSurvey.avg_patient) : prev));
        }
        if (latestSurvey?.avg_recipes_in != null) {
          setJumlahPasienResep((prev) => (!prev || prev === "0" ? String(latestSurvey.avg_recipes_in) : prev));
        }
        const totalEmp = latestSurvey?.total_outlet_employees ?? (bundle.surveyNexusData?.data as any)?.total_outlet_employees;
        if (totalEmp != null) {
          setJumlahKaryawan((prev) => (!prev || prev === "0" ? String(totalEmp) : prev));
        }

        setRekomendasiProduk(bundle.rekomendasiProduk);
        setRawCashbackData(bundle.cashbackData);
        const array = Array.isArray(bundle.cashbackData?.matrix)
          ? bundle.cashbackData.matrix
          : Array.isArray(bundle.cashbackData?.data?.matrix)
          ? bundle.cashbackData.data.matrix
          : Array.isArray(bundle.cashbackData?.data)
          ? bundle.cashbackData.data
          : Array.isArray(bundle.cashbackData)
          ? bundle.cashbackData
          : [];
        setCashbackMatrix(array);
      })
      .catch((err) => {
        console.error("Error fetching SC outlet bundle:", err);
      })
      .finally(() => {
        if (isMounted) {
          setLoadingHistoryEntertain(false);
          setLoadingSurvey(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [kodePI, effectivePoaPeriod]);

  // Period-aware SC insentif history
  const targetPeriod = useMemo(
    () => resolvePeriodForQuarter(effectivePoaPeriod, periodeAwal),
    [effectivePoaPeriod, periodeAwal]
  );

  useEffect(() => {
    if (!kodePI) return;
    getScInsentifHistoryAction(kodePI, targetPeriod).then((res) => setInsentifHistory(res?.data || null));
  }, [kodePI, targetPeriod]);

  const [scHistoryIncentiveData, setScHistoryIncentiveData] = useState<any[]>([]);
  const [historyIncentiveQuarter, setHistoryIncentiveQuarter] = useState<string>("");
  const [historyIncentiveYear, setHistoryIncentiveYear] = useState<string | number>("");
  const [isLoadingIncentiveHistory, setIsLoadingIncentiveHistory] = useState(false);

  useEffect(() => {
    if (!kodePI) {
      setScHistoryIncentiveData([]);
      return;
    }
    let isMounted = true;
    setIsLoadingIncentiveHistory(true);
    const effectiveQ = rowQuarter > 0 ? `Q${rowQuarter}` : extracted.quarter;
    const effectiveYr = poaYear > 2000 ? poaYear : (parseInt(extracted.year, 10) || new Date().getFullYear());
    getScHistoryIncentiveCounterAction(kodePI, effectiveQ, effectiveYr)
      .then((res) => {
        if (!isMounted) return;
        const items = res?.data && Array.isArray(res.data) ? res.data : [];
        if (res?.quarter) setHistoryIncentiveQuarter(res.quarter);
        if (res?.year) setHistoryIncentiveYear(res.year);
        setScHistoryIncentiveData(items);
      })
      .catch(() => {
        if (isMounted) setScHistoryIncentiveData([]);
      })
      .finally(() => {
        if (isMounted) setIsLoadingIncentiveHistory(false);
      });

    return () => {
      isMounted = false;
    };
  }, [kodePI, rowQuarter, poaYear, extracted.quarter, extracted.year]);

  const { scHistoryIncentiveMap, totalOutletHistoryIncentive } = useMemo(() => {
    const map = new Map<string, { win_incentive: number; win_qty?: number; name?: string }>();
    if (!scHistoryIncentiveData || scHistoryIncentiveData.length === 0) {
      return { scHistoryIncentiveMap: map, totalOutletHistoryIncentive: 0 };
    }
    let sumTotal = 0;
    for (const item of scHistoryIncentiveData) {
      if (item.code) {
        const val = Number(item.win_incentive) || 0;
        const qty = Number(item.win_qty) || 0;
        sumTotal += val;
        const entry = { win_incentive: val, win_qty: qty, name: item.name };
        map.set(item.code, entry);
        map.set(item.code.replace(/^0+/, ""), entry);
      }
    }
    return { scHistoryIncentiveMap: map, totalOutletHistoryIncentive: sumTotal };
  }, [scHistoryIncentiveData]);

  useEffect(() => {
    if (cashbackMatrix.length === 0) return;
    setProducts((prev) =>
      prev.map((row) => {
        if (!row.kodeProduk) return row;
        const matrixItem = findCashbackItem(cashbackMatrix, row.kodeProduk);
        if (!matrixItem) return row;
        const getVal = (m: any) => m?.cashback_percentage ?? m?.cashback_percent ?? m?.cashback ?? m?.persenCashback ?? m?.persen_cashback;
        const autoPct = formatCashbackPct(getVal(matrixItem));
        return row.persenCashback === autoPct ? row : { ...row, persenCashback: autoPct };
      })
    );
  }, [cashbackMatrix]);

  const selectProductFromSidebar = (code: string) => {
    if (!code) return;
    setProducts((prev) => {
      const alreadyExists = prev.some((p) => p.kodeProduk === code);
      if (alreadyExists) {
        const filtered = prev.filter((p) => p.kodeProduk !== code);
        if (filtered.length === 0) {
          return [
            {
              kodeProduk: "",
              produkKompetitor: "",
              qtyPerBulan: "",
              persenMatriksSc: "",
              persenDiskon: "",
              persenCashback: "",
              rencanaTotalBiaya: 0,
            },
          ];
        }
        return filtered;
      }

      const emptyIdx = prev.findIndex((p) => !p.kodeProduk);
      let targetIndex = emptyIdx;
      const nextList = [...prev];

      if (emptyIdx < 0) {
        targetIndex = nextList.length;
        nextList.push({
          kodeProduk: "",
          produkKompetitor: "",
          qtyPerBulan: "",
          persenMatriksSc: "",
          persenDiskon: "",
          persenCashback: "",
          rencanaTotalBiaya: 0,
        });
      }

      const canvasserProd = canvasserProducts.find((p) => p.pro_code === code);
      const masterProd = masterProducts.find((p) => p.kodeProduk === code);

      let pctMatriksSc = nextList[targetIndex].persenMatriksSc;
      if (canvasserProd && masterProd) {
        const hna = parseFloat(masterProd.hna) || 0;
        const val = canvasserProd.sales_counter_value || 0;
        const pct = hna > 0 ? (val / hna) * 100 : 0;
        pctMatriksSc = pct > 0 ? pct.toFixed(2) : "0";
      }

      let pctCashback = nextList[targetIndex].persenCashback;
      const matrixItem = findCashbackItem(cashbackMatrix, code);
      if (matrixItem) {
        const getVal = (m: any) =>
          m?.cashback_percentage ?? m?.cashback_percent ?? m?.cashback ?? m?.persenCashback ?? m?.persen_cashback;
        pctCashback = formatCashbackPct(getVal(matrixItem));
      }

      let pctDiskon = "0";
      const diskonItem = findDiskonItem(diskonList, code);
      if (diskonItem) {
        pctDiskon = formatDiskonPct(diskonItem.diskon);
      }

      const updatedRow = {
        ...nextList[targetIndex],
        kodeProduk: code,
        persenMatriksSc: pctMatriksSc,
        persenCashback: pctCashback,
        persenDiskon: pctDiskon,
      };

      nextList[targetIndex] = updatedRow;

      setTimeout(() => {
        const el = document.getElementById(`sc-product-row-${code}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 100);

      return nextList;
    });
  };

  const productOptions = useMemo(() => {
    return buildScProductOptions({
      canvasserProducts,
      productsMenang,
      productsInsentif,
      masterProducts,
      historySalesData,
      surveyData,
    });
  }, [canvasserProducts, productsMenang, productsInsentif, masterProducts, historySalesData, surveyData]);

  const totalEstimasiSales = products.reduce((sum, row) => {
    if (!row.kodeProduk) return sum;
    const masterProduct = masterProducts.find((pr) => pr.kodeProduk === row.kodeProduk);
    if (!masterProduct) return sum;
    const hnaSJ = parseFloat(masterProduct.hna) || 0;
    const qty = parseFloat(row.qtyPerBulan) || 0;
    return sum + (qty * hnaSJ * lamaPeriode);
  }, 0);

  const totalNilaiSc = products.reduce((sum, row) => {
    if (!row.kodeProduk) return sum;
    const masterProduct = masterProducts.find((pr) => pr.kodeProduk === row.kodeProduk);
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

  const cashbackDetails = calculateCashbackDetails({
    cashbackData: rawCashbackData,
    selectedProducts: products,
    masterProducts,
    lamaPeriode,
  });

  const isCashbackHidden =
    !rawCashbackData ||
    rawCashbackData?.message === "Gudang Tidak Ditemukan" ||
    (typeof rawCashbackData?.message === "string" &&
      (rawCashbackData.message.toLowerCase().includes("tidak ditemukan") ||
       rawCashbackData.message.toLowerCase().includes("gudang"))) ||
    (typeof rawCashbackData?.data?.message === "string" &&
      (rawCashbackData.data.message.toLowerCase().includes("tidak ditemukan") ||
       rawCashbackData.data.message.toLowerCase().includes("gudang"))) ||
    rawCashbackData?.status === false ||
    rawCashbackData?.success === false;

  const totalCashbackVal = isCashbackHidden ? 0 : (cashbackDetails?.totalFinalCashback ?? 0);

  const totalDiskonVal = products.reduce((sum, row) => {
    if (!row.kodeProduk) return sum;
    const masterProduct = masterProducts.find((pr) => pr.kodeProduk === row.kodeProduk);
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
  for (const row of products) {
    if (!row.kodeProduk) continue;
    const avgSales = b3SalesMap.get(row.kodeProduk);
    if (avgSales != null && avgSales > 0) {
      totalSelectedProductsAvgB3Bln += avgSales;
    }
  }

  const effectiveOutletAvgB3Bln =
    outletTotalAvgB3Sales > 0 ? outletTotalAvgB3Sales : totalSelectedProductsAvgB3Bln;
  const hasB3Data = effectiveOutletAvgB3Bln > 0;
  const totalEstSalesBln = totalEstimasiSales / (lamaPeriode > 0 ? lamaPeriode : 1);
  const totalGrowthPct = hasB3Data
    ? ((totalEstSalesBln - effectiveOutletAvgB3Bln) / effectiveOutletAvgB3Bln) * 100
    : null;

  const monthlyMonths = useMemo(() => {
    return quarterMonths;
  }, [quarterMonths]);

  const monthlyBreakdown = useMemo(() => {
    return monthlyMonths.map((m: string, mIdx: number) => {
      let monthlyEstimasiSales = 0;
      let monthlyNilaiSc = 0;

      for (const row of products) {
        if (!row.kodeProduk) continue;
        const masterProduct = masterProducts.find((pr) => pr.kodeProduk === row.kodeProduk);
        if (!masterProduct) continue;
        const canvasserProd = canvasserProducts.find((cp) => cp.pro_code === row.kodeProduk);

        const hnaSJ = parseFloat(masterProduct.hna) || 0;
        const qty = (Array.isArray(row.monthlyQty) && row.monthlyQty[mIdx] !== undefined && row.monthlyQty[mIdx] !== "")
          ? (parseFloat(row.monthlyQty[mIdx]) || 0)
          : (parseFloat(row.qtyPerBulan) || 0);
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

      const mCashback = isCashbackHidden
        ? 0
        : (cashbackDetails?.monthlyStats?.[mIdx]?.totalCashbackThisMonth ?? 0);

      return {
        month: m,
        label: formatMonthLabel(m),
        estimasiSales: monthlyEstimasiSales,
        nilaiSc: monthlyNilaiSc,
        nilaiCashback: mCashback,
      };
    });
  }, [monthlyMonths, products, masterProducts, canvasserProducts, isCashbackHidden, cashbackDetails]);

  const handleAddProduct = () => {
    setProducts((prev) => [
      ...prev,
      {
        kodeProduk: "",
        produkKompetitor: "",
        qtyPerBulan: "0",
        monthlyQty: Array(lamaPeriode || 3).fill("0"),
        persenMatriksSc: "",
        persenDiskon: "",
        persenCashback: "",
        rencanaTotalBiaya: 0,
      },
    ]);
  };

  const handleRemoveProduct = (index: number) => {
    setProducts((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length > 0
        ? next
        : [{ kodeProduk: "", produkKompetitor: "", qtyPerBulan: "", persenMatriksSc: "", persenDiskon: "", persenCashback: "", rencanaTotalBiaya: 0 }];
    });
  };

  const handleProductChange = (index: number, fields: Partial<SelectedProductRow>) => {
    setProducts((prev) => {
      const next = [...prev];
      const current = next[index];
      const updated = { ...current, ...fields };

      if (fields.kodeProduk !== undefined) {
        const canvasserProd = canvasserProducts.find((p) => p.pro_code === fields.kodeProduk);
        const masterProd = masterProducts.find((p) => p.kodeProduk === fields.kodeProduk);
        if (canvasserProd && masterProd) {
          const hna = parseFloat(masterProd.hna) || 0;
          const val = canvasserProd.sales_counter_value || 0;
          const pct = hna > 0 ? (val / hna) * 100 : 0;
          updated.persenMatriksSc = pct > 0 ? pct.toFixed(2) : "0";
        }
        const matrixItem = findCashbackItem(cashbackMatrix, fields.kodeProduk);
        if (matrixItem) {
          const getVal = (m: any) => m?.cashback_percentage ?? m?.cashback_percent ?? m?.cashback ?? m?.persenCashback ?? m?.persen_cashback;
          updated.persenCashback = formatCashbackPct(getVal(matrixItem));
        } else if (fields.kodeProduk === "") {
          updated.persenCashback = "0";
        }
        const diskonItem = findDiskonItem(diskonList, fields.kodeProduk);
        updated.persenDiskon = diskonItem ? formatDiskonPct(diskonItem.diskon) : "0";
      }

      const qty = parseFloat(updated.qtyPerBulan) || 0;
      const masterProduct = masterProducts.find((p) => p.kodeProduk === updated.kodeProduk);
      const hna = parseFloat(masterProduct?.hna || "0") || 0;
      const duration = lamaPeriode > 0 ? lamaPeriode : 1;
      const pctMatriks = parseFloat(updated.persenMatriksSc) || 0;
      updated.rencanaTotalBiaya = qty * hna * duration * (pctMatriks / 100);

      next[index] = updated;
      return next;
    });
  };

  const updateEntertainValue = (month: string, val: string) => {
    setEntertainList((prev) =>
      prev.map((e) => (e.month === month ? { ...e, value: val } : e))
    );
  };

  const totalMonthlyEstimasiSales = monthlyBreakdown.reduce((sum: number, item: { estimasiSales: number }) => sum + item.estimasiSales, 0);
  const totalMonthlyNilaiSc = monthlyBreakdown.reduce((sum: number, item: { nilaiSc: number }) => sum + item.nilaiSc, 0);

  return {
    selectedPersonIds,
    poaYear,
    rowQuarter,
    setRowQuarter,
    periodeAwal,
    setPeriodeAwal,
    lamaPeriode,
    setLamaPeriode,
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
    setProducts,
    entertainList,
    setEntertainList,
    historyEntertain,
    loadingHistoryEntertain,
    canvasserProducts,
    cashbackMatrix,
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
    scHistoryIncentiveMap,
    totalOutletHistoryIncentive,
    historyIncentiveQuarter,
    historyIncentiveYear,
    isLoadingIncentiveHistory,
    diskonList,
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
    hasB3Data,
    totalEstSalesBln,
    totalGrowthPct,
    monthlyMonths,
    monthlyBreakdown,
    totalMonthlyEstimasiSales,
    totalMonthlyNilaiSc,
    handlePeriodeAwalChange,
    handleQuarterChange,
    selectProductFromSidebar,
    handleAddProduct,
    handleRemoveProduct,
    handleProductChange,
    updateEntertainValue,
  };
}
