"use client";

import { useState, useEffect, useMemo } from "react";
import type { ScDraftFormItem, ScProductItemData } from "../../types";
import { getB3ByQuarter } from "@/lib/b3Utils";
import {
  getScOutletB3SalesAction,
  getScCashbackPoaAction,
  getSalesCounterProductsAction,
  getScInsentifHistoryAction,
  getScHistoryIncentiveCounterAction,
  getHistorySalesAction,
  postHistorySalesAction,
  getSalesOnlineAction,
  getSurveyNexusAction,
} from "@/app/actions/canvasser";
import { parseOutletHistorySales } from "@/lib/historySalesUtils";
import { calculateCashbackDetails } from "../../edit/hooks/useSalesCounterCashback";
import {
  isCashbackResponseNotFound,
  calculateOutletTotals,
  computeHistoryInsentifInfo,
  calculateProductDetailRows,
  extractQuarterAndYear,
} from "../utils/outletCalculationUtils";

interface CachedB3OutletData {
  b3SalesMap: Map<string, number>;
  b3TotalOutletSalesPerMonth: number;
  b3TotalCount: number;
  allScProducts: any[];
  clientScData: { codes: Set<string>; total: number };
}

const b3Cache = new Map<string, CachedB3OutletData>();
const cashbackCache = new Map<string, any>();
const scHistoryIncentiveCache = new Map<string, any[]>();
const insentifHistoryCache = new Map<string, any>();

export function useSalesCounterOutletData({
  draft,
  poaId,
  isExpanded = false,
  isKompetitorOpen = false,
}: {
  draft: ScDraftFormItem;
  poaId: string;
  isExpanded?: boolean;
  isKompetitorOpen?: boolean;
}) {
  const { quarter: poaQuarter, year: poaYear } = useMemo(() => {
    return extractQuarterAndYear(draft.period, draft.periodeAwal, poaId);
  }, [draft.period, draft.periodeAwal, poaId]);

  const b3Info = useMemo(() => {
    return getB3ByQuarter(draft.period || draft.periodeAwal || poaId);
  }, [draft.period, draft.periodeAwal, poaId]);
  const b3RangeLabel = b3Info.rangeLabel;

  const targetPeriodsKey = useMemo(() => {
    return (b3Info.targetPeriods || []).join(",");
  }, [b3Info.targetPeriods]);

  const b3CacheKey = `${draft.kodePI}_${b3Info.period}_${targetPeriodsKey}`;
  const cachedB3 = draft.kodePI ? b3Cache.get(b3CacheKey) : undefined;
  const cachedCashback = draft.kodePI ? cashbackCache.get(draft.kodePI) : undefined;
  const incentiveCacheKey = `${draft.kodePI}_${poaQuarter}_${poaYear}`;
  const cachedScIncentive = draft.kodePI ? scHistoryIncentiveCache.get(incentiveCacheKey) : undefined;
  const cachedInsentifHistory = draft.kodePI ? insentifHistoryCache.get(draft.kodePI) : undefined;

  const [b3SalesMap, setB3SalesMap] = useState<Map<string, number>>(() => cachedB3?.b3SalesMap || new Map());
  const [cashbackData, setCashbackData] = useState<any>(() => cachedCashback || null);
  const [clientScData, setClientScData] = useState<{ codes: Set<string>; total: number } | null>(() => cachedB3?.clientScData || null);
  const [isLoadingB3, setIsLoadingB3] = useState<boolean>(() => !cachedB3);

  const [allScProducts, setAllScProducts] = useState<any[]>(() => cachedB3?.allScProducts || []);
  const [b3TotalCount, setB3TotalCount] = useState<number | null>(() => (cachedB3 ? cachedB3.b3TotalCount : null));
  const [b3TotalOutletSalesPerMonth, setB3TotalOutletSalesPerMonth] = useState<number>(() => cachedB3?.b3TotalOutletSalesPerMonth || 0);

  const [insentifHistoryData, setInsentifHistoryData] = useState<any>(() => cachedInsentifHistory || null);
  const [scHistoryIncentiveData, setScHistoryIncentiveData] = useState<any[] | null>(() => cachedScIncentive || null);
  const [isLoadingIncentiveHistory, setIsLoadingIncentiveHistory] = useState<boolean>(() => !cachedScIncentive);
  const [salesOnlineData, setSalesOnlineData] = useState<any>(null);
  const [isLoadingSalesOnline, setIsLoadingSalesOnline] = useState<boolean>(false);
  const [surveyNexusData, setSurveyNexusData] = useState<any>(null);

  // Fetch cashback data
  useEffect(() => {
    if (!draft.kodePI) return;
    if (cashbackCache.has(draft.kodePI)) {
      setCashbackData(cashbackCache.get(draft.kodePI));
      return;
    }
    getScCashbackPoaAction(draft.kodePI).then((res) => {
      cashbackCache.set(draft.kodePI, res);
      setCashbackData(res);
    });
  }, [draft.kodePI]);

  // Fetch B-3 history sales data (Parallelized)
  useEffect(() => {
    if (!draft.kodePI) {
      setIsLoadingB3(false);
      return;
    }

    if (b3Cache.has(b3CacheKey)) {
      const cached = b3Cache.get(b3CacheKey)!;
      setB3SalesMap(cached.b3SalesMap);
      setB3TotalOutletSalesPerMonth(cached.b3TotalOutletSalesPerMonth);
      setB3TotalCount(cached.b3TotalCount);
      setAllScProducts(cached.allScProducts);
      setClientScData(cached.clientScData);
      setIsLoadingB3(false);
      return;
    }

    let isMounted = true;
    setIsLoadingB3(true);

    Promise.all([
      getSalesCounterProductsAction(draft.kodePI).catch(() => null),
      postHistorySalesAction([draft.kodePI], b3Info.targetPeriods).catch(() => null),
    ])
      .then(([scProdsRes, historyRes]) => {
        if (!isMounted) return;

        const products = scProdsRes?.data && Array.isArray(scProdsRes.data) ? scProdsRes.data : [];
        setAllScProducts(products);
        const scCodes = new Set<string>(products.map((cp: any) => cp.pro_code).filter(Boolean));
        const clientSc = { codes: scCodes, total: products.length };
        setClientScData(clientSc);

        const parsed = parseOutletHistorySales(historyRes, draft.kodePI);

        // Filter parsed product sales to SC products
        const filteredMap = new Map<string, number>();
        let sumAvg = 0;
        let scProductSalesCount = 0;
        const seenNorm = new Set<string>();

        if (parsed.productSalesMap && parsed.productSalesMap.size > 0) {
          for (const [code, avgVal] of parsed.productSalesMap.entries()) {
            const norm = code.replace(/^0+/, "");
            if (seenNorm.has(norm)) continue;
            seenNorm.add(norm);

            const isSc = scCodes.size === 0 || scCodes.has(code) || scCodes.has(norm);
            if (isSc) {
              filteredMap.set(code, avgVal);
              filteredMap.set(norm, avgVal);
              if (avgVal > 0) {
                sumAvg += avgVal;
                scProductSalesCount++;
              }
            }
          }
        }

        if (sumAvg > 0 || filteredMap.size > 0) {
          setB3SalesMap(filteredMap);
          setB3TotalOutletSalesPerMonth(sumAvg);
          setB3TotalCount(scProductSalesCount);
          setIsLoadingB3(false);
          b3Cache.set(b3CacheKey, {
            b3SalesMap: filteredMap,
            b3TotalOutletSalesPerMonth: sumAvg,
            b3TotalCount: scProductSalesCount,
            allScProducts: products,
            clientScData: clientSc,
          });
          return;
        }

        // Fallback 1: getScOutletB3SalesAction for all SC products in outlet
        const scProCodes = Array.from(scCodes);
        if (scProCodes.length === 0) {
          setB3SalesMap(new Map());
          setB3TotalOutletSalesPerMonth(0);
          setB3TotalCount(0);
          setIsLoadingB3(false);
          b3Cache.set(b3CacheKey, {
            b3SalesMap: new Map(),
            b3TotalOutletSalesPerMonth: 0,
            b3TotalCount: 0,
            allScProducts: products,
            clientScData: clientSc,
          });
          return;
        }

        getScOutletB3SalesAction(b3Info.period, draft.kodePI, scProCodes)
          .then((b3Res) => {
            if (!isMounted) return;
            const items = Array.isArray(b3Res?.data) ? b3Res.data : [];
            const activeItems = items.filter(
              (it: any) => (Number(it.average_sales) || 0) > 0 || (Number(it.average_qty) || 0) > 0
            );
            if (activeItems.length > 0) {
              const map = new Map<string, number>();
              let sumB3 = 0;
              for (const it of activeItems) {
                if (it.pro_code) {
                  const val = Number(it.average_sales) || 0;
                  map.set(it.pro_code, val);
                  map.set(it.pro_code.replace(/^0+/, ""), val);
                  sumB3 += val;
                }
              }
              setB3SalesMap(map);
              setB3TotalOutletSalesPerMonth(sumB3);
              setB3TotalCount(activeItems.length);
              setIsLoadingB3(false);
              b3Cache.set(b3CacheKey, {
                b3SalesMap: map,
                b3TotalOutletSalesPerMonth: sumB3,
                b3TotalCount: activeItems.length,
                allScProducts: products,
                clientScData: clientSc,
              });
              return;
            }

            // Fallback 2: legacy getHistorySalesAction strictly filtered by SC codes
            getHistorySalesAction(draft.kodePI, false)
              .then((legacyRes) => {
                if (!isMounted) return;
                if (legacyRes?.data && Array.isArray(legacyRes.data)) {
                  const targetPeriodsSet = new Set((b3Info.targetPeriods || []).map(Number));
                  const uniqueCodes = new Set<string>();
                  const productSalesSum = new Map<string, number>();

                  for (const it of legacyRes.data) {
                    const itemPeriod = Number(it.period);
                    const historyQty = Number(it.history_sales) || 0;
                    const salesVal = Number(it.sales_value) || 0;

                    if (targetPeriodsSet.has(itemPeriod) && (historyQty > 0 || salesVal > 0)) {
                      if (it.code && scCodes.has(it.code)) {
                        uniqueCodes.add(it.code);
                        const cur = productSalesSum.get(it.code) || 0;
                        productSalesSum.set(it.code, cur + salesVal);
                      }
                    }
                  }

                  let totalValSum = 0;
                  const avgMap = new Map<string, number>();
                  for (const [code, sumVal] of productSalesSum.entries()) {
                    avgMap.set(code, sumVal / 3);
                    totalValSum += sumVal;
                  }

                  const finalTotalCount = uniqueCodes.size;
                  const finalAvgSales = totalValSum > 0 ? totalValSum / 3 : 0;
                  setB3TotalCount(finalTotalCount);
                  setB3SalesMap(avgMap);
                  setB3TotalOutletSalesPerMonth(finalAvgSales);
                  b3Cache.set(b3CacheKey, {
                    b3SalesMap: avgMap,
                    b3TotalOutletSalesPerMonth: finalAvgSales,
                    b3TotalCount: finalTotalCount,
                    allScProducts: products,
                    clientScData: clientSc,
                  });
                } else {
                  setB3TotalCount(0);
                  setB3TotalOutletSalesPerMonth(0);
                  b3Cache.set(b3CacheKey, {
                    b3SalesMap: new Map(),
                    b3TotalOutletSalesPerMonth: 0,
                    b3TotalCount: 0,
                    allScProducts: products,
                    clientScData: clientSc,
                  });
                }
                setIsLoadingB3(false);
              })
              .catch(() => {
                if (isMounted) setIsLoadingB3(false);
              });
          })
          .catch(() => {
            if (isMounted) setIsLoadingB3(false);
          });
      })
      .catch(() => {
        if (isMounted) setIsLoadingB3(false);
      });

    return () => {
      isMounted = false;
    };
  }, [draft.kodePI, b3Info.period, targetPeriodsKey, b3CacheKey]);

  // Secondary fallback if expanded and b3SalesMap is empty
  const draftProductCodesKey = useMemo(() => {
    return draft.products.map((p) => p.kodeProduk).filter(Boolean).join(",");
  }, [draft.products]);

  useEffect(() => {
    if (!isExpanded || !draft.kodePI) return;
    if (b3SalesMap.size > 0) return;

    const proCodes = draft.products.map((p) => p.kodeProduk).filter(Boolean);
    if (proCodes.length === 0) {
      setIsLoadingB3(false);
      return;
    }

    getScOutletB3SalesAction(b3Info.period, draft.kodePI, proCodes)
      .then((res) => {
        const map = new Map<string, number>();
        if (res?.data && Array.isArray(res.data)) {
          for (const item of res.data) {
            if (item.pro_code) map.set(item.pro_code, item.average_sales || 0);
          }
        }
        if (map.size > 0) {
          setB3SalesMap(map);
        }
        setIsLoadingB3(false);
      })
      .catch(() => {
        setIsLoadingB3(false);
      });
  }, [isExpanded, draft.kodePI, draftProductCodesKey, b3Info.period, b3SalesMap.size]);

  // Fetch insentif history
  useEffect(() => {
    if (!draft.kodePI) {
      setIsLoadingIncentiveHistory(false);
      return;
    }

    if (scHistoryIncentiveCache.has(incentiveCacheKey) && insentifHistoryCache.has(draft.kodePI)) {
      setScHistoryIncentiveData(scHistoryIncentiveCache.get(incentiveCacheKey) || []);
      setInsentifHistoryData(insentifHistoryCache.get(draft.kodePI) || null);
      setIsLoadingIncentiveHistory(false);
      return;
    }

    let isMounted = true;
    setIsLoadingIncentiveHistory(true);

    getScHistoryIncentiveCounterAction(draft.kodePI, poaQuarter, poaYear)
      .then((res) => {
        if (!isMounted) return;
        const items = res?.data && Array.isArray(res.data) ? res.data : [];
        scHistoryIncentiveCache.set(incentiveCacheKey, items);
        setScHistoryIncentiveData(items);
      })
      .catch(() => {
        if (isMounted) setScHistoryIncentiveData([]);
      })
      .finally(() => {
        if (isMounted) setIsLoadingIncentiveHistory(false);
      });

    getScInsentifHistoryAction(draft.kodePI).then((res) => {
      if (isMounted) {
        insentifHistoryCache.set(draft.kodePI, res?.data || null);
        setInsentifHistoryData(res?.data || null);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [draft.kodePI, poaQuarter, poaYear, incentiveCacheKey]);

  // Fetch competitor / nexus data ONLY when competitor sidebar is opened
  useEffect(() => {
    if (!isKompetitorOpen || !draft.kodePI) return;
    if (salesOnlineData && surveyNexusData) return;

    let isMounted = true;
    setIsLoadingSalesOnline(true);

    getSalesOnlineAction(draft.kodePI)
      .then((res) => {
        if (isMounted) setSalesOnlineData(res || null);
      })
      .catch(() => {
        if (isMounted) setSalesOnlineData(null);
      })
      .finally(() => {
        if (isMounted) setIsLoadingSalesOnline(false);
      });

    getSurveyNexusAction(draft.kodePI)
      .then((res) => {
        if (isMounted) setSurveyNexusData(res || null);
      })
      .catch(() => {
        if (isMounted) setSurveyNexusData(null);
      });

    return () => {
      isMounted = false;
    };
  }, [isKompetitorOpen, draft.kodePI]);

  // Filter products to strictly SC products
  const scProducts = useMemo(() => {
    if (clientScData && clientScData.codes.size > 0) {
      return draft.products.filter(
        (p) =>
          clientScData.codes.has(p.kodeProduk) ||
          clientScData.codes.has(String(p.kodeProduk || "").replace(/^0+/, ""))
      );
    }
    if (draft.products.some((p) => p.isScProduct !== undefined)) {
      return draft.products.filter((p) => p.isScProduct !== false);
    }
    return draft.products;
  }, [draft.products, clientScData]);

  const selectedProductCodes = useMemo(() => {
    return new Set<string>(
      scProducts.map((p) => p.kodeProduk).filter((c): c is string => Boolean(c))
    );
  }, [scProducts]);

  const totalScCount = draft.totalScProducts ?? clientScData?.total ?? 0;
  const validScCount = selectedProductCodes.size;
  const lama = draft.lamaPeriode || 3;

  const cbDetails = useMemo(() => {
    return calculateCashbackDetails({
      cashbackData,
      selectedProducts: scProducts.map((p) => ({
        kodeProduk: p.kodeProduk,
        qtyPerBulan: String(p.qtyPerBulan || 0),
        persenCashback: String(p.persenCashback || 0),
      })),
      masterProducts: scProducts.map((p) => ({
        kodeProduk: p.kodeProduk,
        hna: String(p.hnaSJ || 0),
        konversiPembagi: String(p.konversiPembagi || 1),
      })),
      lamaPeriode: draft.lamaPeriode,
    });
  }, [cashbackData, draft.lamaPeriode, scProducts]);

  const isCashbackNotFound = isCashbackResponseNotFound(cashbackData);

  const { outletEstSales, outletNilaiSc } = useMemo(() => {
    return calculateOutletTotals(scProducts, lama);
  }, [scProducts, lama]);

  const totalEntertain = draft.entertainItems.reduce((s, e) => s + (e.biayaEntertain || 0), 0);
  const canvasserNames = draft.persons.map((p) => `${p.personName} (${p.positionName})`).join(", ");

  const historyInsentifInfo = useMemo(() => {
    return computeHistoryInsentifInfo(insentifHistoryData, draft.period || draft.periodeAwal, poaId);
  }, [insentifHistoryData, draft.periodeAwal, draft.period, poaId]);

  const { scHistoryIncentiveMap, totalOutletHistoryIncentive } = useMemo(() => {
    const map = new Map<string, { win_incentive: number; win_qty?: number; name?: string }>();
    if (!scHistoryIncentiveData) return { scHistoryIncentiveMap: map, totalOutletHistoryIncentive: 0 };
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

  const productDetailRows = useMemo(() => {
    return calculateProductDetailRows({
      scProducts,
      lama,
      periodeAwal: draft.periodeAwal,
      cashbackData,
      cbDetails,
      b3SalesMap,
      b3TotalOutletSalesPerMonth,
      scHistoryIncentiveMap,
      totalOutletHistoryIncentive,
    });
  }, [
    scProducts,
    lama,
    draft.periodeAwal,
    cashbackData,
    cbDetails,
    b3SalesMap,
    b3TotalOutletSalesPerMonth,
    scHistoryIncentiveMap,
    totalOutletHistoryIncentive,
  ]);

  const insentifGrowthPct = useMemo(() => {
    if (productDetailRows.overallIncentiveGrowthPct != null) {
      return productDetailRows.overallIncentiveGrowthPct;
    }
    if (!historyInsentifInfo || historyInsentifInfo.avgB3Insentif <= 0) return null;
    return (
      ((productDetailRows.sumNilaiScPerMonth - historyInsentifInfo.avgB3Insentif) /
        historyInsentifInfo.avgB3Insentif) *
      100
    );
  }, [productDetailRows.overallIncentiveGrowthPct, productDetailRows.sumNilaiScPerMonth, historyInsentifInfo]);

  return {
    allScProducts,
    scProducts,
    selectedProductCodes,
    totalScCount,
    validScCount,
    lama,
    b3Info,
    b3RangeLabel,
    b3TotalCount,
    b3SalesMap,
    b3TotalOutletSalesPerMonth,
    isLoadingB3,
    cashbackData,
    cbDetails,
    isCashbackNotFound,
    outletEstSales,
    outletNilaiSc,
    totalEntertain,
    canvasserNames,
    insentifHistoryData,
    scHistoryIncentiveData,
    scHistoryIncentiveMap,
    isLoadingIncentiveHistory,
    historyInsentifInfo,
    insentifGrowthPct,
    salesOnlineData,
    isLoadingSalesOnline,
    surveyNexusData,
    productDetailRows,
  };
}
