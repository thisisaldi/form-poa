"use client";

import { useState, useEffect, useMemo } from "react";
import type { ScDraftFormItem, ScProductItemData } from "../../types";
import { getB3ByQuarter } from "@/lib/b3Utils";
import {
  getScOutletB3SalesAction,
  getScCashbackPoaAction,
  getSalesCounterProductsAction,
  getScInsentifHistoryAction,
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
} from "../utils/outletCalculationUtils";

export function useSalesCounterOutletData({
  draft,
  poaId,
  isExpanded = false,
}: {
  draft: ScDraftFormItem;
  poaId: string;
  isExpanded?: boolean;
}) {
  const [b3SalesMap, setB3SalesMap] = useState<Map<string, number>>(new Map());
  const [cashbackData, setCashbackData] = useState<any>(null);
  const [clientScData, setClientScData] = useState<{ codes: Set<string>; total: number } | null>(null);
  const [isLoadingB3, setIsLoadingB3] = useState<boolean>(true);

  const [allScProducts, setAllScProducts] = useState<any[]>([]);
  const [b3TotalCount, setB3TotalCount] = useState<number | null>(null);
  const [b3TotalOutletSalesPerMonth, setB3TotalOutletSalesPerMonth] = useState<number>(0);

  const [insentifHistoryData, setInsentifHistoryData] = useState<any>(null);
  const [salesOnlineData, setSalesOnlineData] = useState<any>(null);
  const [isLoadingSalesOnline, setIsLoadingSalesOnline] = useState<boolean>(false);
  const [surveyNexusData, setSurveyNexusData] = useState<any>(null);

  const b3Info = useMemo(() => {
    return getB3ByQuarter(draft.period || draft.periodeAwal || poaId);
  }, [draft.period, draft.periodeAwal, poaId]);
  const b3RangeLabel = b3Info.rangeLabel;

  // Fetch cashback data
  useEffect(() => {
    if (draft.kodePI) {
      getScCashbackPoaAction(draft.kodePI).then((res) => setCashbackData(res));
    }
  }, [draft.kodePI]);

  // Fetch B-3 history sales data
  useEffect(() => {
    if (!draft.kodePI) {
      setIsLoadingB3(false);
      return;
    }

    let isMounted = true;
    setIsLoadingB3(true);

    getSalesCounterProductsAction(draft.kodePI)
      .then((res) => {
        if (!isMounted) return;
        const products = res?.data && Array.isArray(res.data) ? res.data : [];
        setAllScProducts(products);
        const scCodes = new Set<string>(products.map((cp: any) => cp.pro_code).filter(Boolean));
        setClientScData({ codes: scCodes, total: products.length });

        const scProCodes = Array.from(scCodes);
        if (scProCodes.length === 0) {
          setB3SalesMap(new Map());
          setB3TotalOutletSalesPerMonth(0);
          setB3TotalCount(0);
          setIsLoadingB3(false);
          return;
        }

        postHistorySalesAction([draft.kodePI], b3Info.targetPeriods, scProCodes)
          .then((historyRes) => {
            if (!isMounted) return;
            const parsed = parseOutletHistorySales(historyRes, draft.kodePI);
            if (parsed.averageSales > 0 || parsed.productSalesMap.size > 0) {
              setB3SalesMap(parsed.productSalesMap);
              setB3TotalOutletSalesPerMonth(parsed.averageSales);
              setB3TotalCount(parsed.productCount);
              setIsLoadingB3(false);
            } else {
              // Fallback 1: getScOutletB3SalesAction for all SC products in outlet
              getScOutletB3SalesAction(b3Info.period, draft.kodePI, scProCodes)
                .then((b3Res) => {
                  if (!isMounted) return;
                  const items = Array.isArray(b3Res?.data) ? b3Res.data : [];
                  const activeItems = items.filter(
                    (it: any) => (Number(it.average_sales) || 0) > 0 || (Number(it.average_qty) || 0) > 0
                  );
                  if (activeItems.length > 0) {
                    const map = new Map<string, number>();
                    let sumAvg = 0;
                    for (const it of activeItems) {
                      if (it.pro_code) {
                        const val = Number(it.average_sales) || 0;
                        map.set(it.pro_code, val);
                        map.set(it.pro_code.replace(/^0+/, ""), val);
                        sumAvg += val;
                      }
                    }
                    setB3SalesMap(map);
                    setB3TotalOutletSalesPerMonth(sumAvg);
                    setB3TotalCount(activeItems.length);
                    setIsLoadingB3(false);
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

                        setB3TotalCount(uniqueCodes.size);

                        let totalValSum = 0;
                        const avgMap = new Map<string, number>();
                        for (const [code, sumVal] of productSalesSum.entries()) {
                          avgMap.set(code, sumVal / 3);
                          totalValSum += sumVal;
                        }

                        if (totalValSum > 0) {
                          setB3SalesMap(avgMap);
                          setB3TotalOutletSalesPerMonth(totalValSum / 3);
                        }
                      } else {
                        setB3TotalCount(0);
                        setB3TotalOutletSalesPerMonth(0);
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
            }
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
  }, [draft.kodePI, b3Info.period, b3Info.targetPeriods]);

  // Secondary fallback if expanded and b3SalesMap is empty
  useEffect(() => {
    if (!isExpanded || !draft.kodePI) return;
    if (b3SalesMap.size > 0) return;

    const proCodes = draft.products.map((p) => p.kodeProduk).filter(Boolean);
    if (proCodes.length === 0) return;

    getScOutletB3SalesAction(b3Info.period, draft.kodePI, proCodes).then((res) => {
      const map = new Map<string, number>();
      if (res?.data && Array.isArray(res.data)) {
        for (const item of res.data) {
          if (item.pro_code) map.set(item.pro_code, item.average_sales || 0);
        }
      }
      if (map.size > 0) {
        setB3SalesMap(map);
        setIsLoadingB3(false);
      }
    });
  }, [isExpanded, draft.kodePI, draft.products, b3Info.period, b3SalesMap.size]);

  // Fetch insentif history and sales online
  useEffect(() => {
    if (!draft.kodePI) return;
    setIsLoadingSalesOnline(true);
    getScInsentifHistoryAction(draft.kodePI).then((res) => {
      setInsentifHistoryData(res?.data || null);
    });
    getSalesOnlineAction(draft.kodePI)
      .then((res) => {
        setSalesOnlineData(res || null);
      })
      .catch(() => {
        setSalesOnlineData(null);
      })
      .finally(() => {
        setIsLoadingSalesOnline(false);
      });
    getSurveyNexusAction(draft.kodePI)
      .then((res) => {
        setSurveyNexusData(res || null);
      })
      .catch(() => {
        setSurveyNexusData(null);
      });
  }, [draft.kodePI]);

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

  const totalScCount = draft.totalScProducts ?? clientScData?.total ?? 0;
  const validScCount = scProducts.length;
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

  const productDetailRows = useMemo(() => {
    return calculateProductDetailRows({
      scProducts,
      lama,
      periodeAwal: draft.periodeAwal,
      cashbackData,
      cbDetails,
      b3SalesMap,
      b3TotalOutletSalesPerMonth,
    });
  }, [scProducts, lama, draft.periodeAwal, cashbackData, cbDetails, b3SalesMap, b3TotalOutletSalesPerMonth]);

  const insentifGrowthPct = useMemo(() => {
    if (!historyInsentifInfo || historyInsentifInfo.avgB3Insentif <= 0) return null;
    return (
      ((productDetailRows.sumNilaiScPerMonth - historyInsentifInfo.avgB3Insentif) /
        historyInsentifInfo.avgB3Insentif) *
      100
    );
  }, [productDetailRows.sumNilaiScPerMonth, historyInsentifInfo]);

  const selectedProductCodes = useMemo(() => {
    return new Set<string>(
      scProducts.map((p) => p.kodeProduk).filter((c): c is string => Boolean(c))
    );
  }, [scProducts]);

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
    historyInsentifInfo,
    insentifGrowthPct,
    salesOnlineData,
    isLoadingSalesOnline,
    surveyNexusData,
    productDetailRows,
  };
}
