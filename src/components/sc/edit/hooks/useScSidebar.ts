"use client";

import { useState, useMemo } from "react";
import { getPreviousQuarterInfo } from "@/lib/quarterUtils";
import { aggregateHistorySales, type AggregatedProductHistory } from "@/lib/historySalesUtils";
import { DUMMY_KOMPETITOR_DATA } from "../constants/dummyCompetitorData";
import { resolveProductName, isSameZatAktif } from "../utils/productMatcherUtils";
import { formatHistoryPeriodRange } from "../utils/periodUtils";
import type { SidebarTab, ScSidebarProps } from "../types/sidebarTypes";

export function useScSidebar({
  poaPeriod,
  canvasserProducts = [],
  masterProducts = [],
  salesOnlineData,
  surveyData = [],
  historySalesData,
  selectedProductCodes = new Set<string>(),
}: ScSidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab | null>(null);
  const [kompetitorFilter, setKompetitorFilter] = useState<string>("semua");
  const [kompetitorSearch, setKompetitorSearch] = useState<string>("");
  const [kompetitorPage, setKompetitorPage] = useState<number>(1);

  const prevQuarterInfo = useMemo(() => {
    return getPreviousQuarterInfo(poaPeriod);
  }, [poaPeriod]);

  const canvasserScCodes = useMemo(() => {
    const set = new Set<string>();
    if (Array.isArray(canvasserProducts)) {
      for (const cp of canvasserProducts) {
        const code = String(cp.pro_code || cp.kode_item || cp.kodeProduk || "").trim();
        if (code) {
          set.add(code);
          set.add(code.replace(/^0+/, ""));
        }
      }
    }
    return set;
  }, [canvasserProducts]);

  const effectiveSurveyData = useMemo(() => {
    const raw = Array.isArray(surveyData) ? surveyData : [];
    if (canvasserScCodes.size === 0) return [];
    return raw.filter((s: any) => {
      const c = String(s.kodeProduk || "").trim();
      return canvasserScCodes.has(c) || canvasserScCodes.has(c.replace(/^0+/, ""));
    });
  }, [surveyData, canvasserScCodes]);

  const historyPeriodSubtext = useMemo(() => {
    return formatHistoryPeriodRange(historySalesData?.period);
  }, [historySalesData]);

  const effectiveSalesOnlineItems = useMemo(() => {
    if (Array.isArray(salesOnlineData?.data)) {
      return salesOnlineData.data;
    }
    if (Array.isArray(salesOnlineData)) {
      return salesOnlineData;
    }
    return [];
  }, [salesOnlineData]);

  // Map of product codes to sales online (B2B Sell In)
  const salesOnlineMap = useMemo(() => {
    const map = new Map<string, { qty_sales: number; value_sales: number | null; zat_aktif: string | null }>();
    for (const it of effectiveSalesOnlineItems) {
      const code = String(it.code || "").trim();
      if (code) {
        map.set(code, it);
        map.set(code.replace(/^0+/, ""), it);
      }
    }
    return map;
  }, [effectiveSalesOnlineItems]);

  // Competitor Cards derived from Sales Counter Products (canvasserProducts)
  const scCards = useMemo(() => {
    const rawList: any[] = (Array.isArray(canvasserProducts) && canvasserProducts.length > 0)
      ? canvasserProducts
      : DUMMY_KOMPETITOR_DATA.map((d) => ({
          pro_code: d.kodeProduk,
          kode_item: d.kodeProduk,
          pro_name: d.namaProduk,
        }));

    const dummyMap = new Map<string, typeof DUMMY_KOMPETITOR_DATA[0]>();
    for (const d of DUMMY_KOMPETITOR_DATA) {
      const c = d.kodeProduk.trim();
      dummyMap.set(c, d);
      dummyMap.set(c.replace(/^0+/, ""), d);
    }

    return rawList.map((cp: any) => {
      const code = String(cp.pro_code || cp.kode_item || cp.kodeProduk || "").trim();
      const strippedCode = code.replace(/^0+/, "");
      const altCode = String(cp.kode_item || cp.pro_code || "").trim();
      const strippedAlt = altCode.replace(/^0+/, "");
      const name = cp.pro_name || cp.namaProduk || resolveProductName(code, masterProducts) || `Produk ${code}`;

      const mProd = masterProducts.find((p: any) => {
        const pCode = String(p.kodeProduk || p.pro_code || p.product_code || "").trim();
        const pStripped = pCode.replace(/^0+/, "");
        return (
          pCode === code ||
          pStripped === strippedCode ||
          (altCode && (pCode === altCode || pStripped === strippedAlt))
        );
      });

      const onlineItem =
        salesOnlineMap.get(code) ||
        salesOnlineMap.get(strippedCode) ||
        (altCode ? salesOnlineMap.get(altCode) || salesOnlineMap.get(strippedAlt) : undefined);

      let zatAktif = (onlineItem?.zat_aktif || mProd?.zatAktif || "").trim().toUpperCase();
      if (!zatAktif) {
        const upper = name.toUpperCase();
        if (upper.includes("PRORIS")) {
          zatAktif = "IBUPROFEN";
        } else if (upper.includes("POLYSILANE")) {
          zatAktif = "AL(OH)3, MG(OH)2, DIMETHICONE";
        } else if (upper.includes("MICROLAX")) {
          zatAktif = "NA LAURYL SULFATE, PEG, SORBITOL, NA CITRATE, SORBIC ACID";
        }
      }

      const realSurvey = (Array.isArray(surveyData) ? surveyData : []).find((s: any) => {
        const sCode = String(s.kodeProduk || "").trim();
        return (
          sCode === code ||
          sCode.replace(/^0+/, "") === strippedCode ||
          (altCode && (sCode === altCode || sCode.replace(/^0+/, "") === strippedAlt))
        );
      });

      const dummyRef = dummyMap.get(code) || dummyMap.get(strippedCode) || (altCode ? dummyMap.get(altCode) || dummyMap.get(strippedAlt) : undefined);

      let defaultKompetitorName = `Kompetitor ${name.split(" ")[0]}`;
      const upperName = name.toUpperCase();
      if (upperName.includes("PRORIS")) defaultKompetitorName = "Sanmol Syrup 60ml";
      else if (upperName.includes("POLYSILANE")) defaultKompetitorName = "Mylanta Liquid 150ml";
      else if (upperName.includes("MICROLAX")) defaultKompetitorName = "Dulcolax Suppositoria";
      else if (upperName.includes("SALBUVEN")) defaultKompetitorName = "Ventolin 2mg";
      else if (upperName.includes("VASTROL") || upperName.includes("STAVINOR")) defaultKompetitorName = "Lipitor 20mg";
      else if (upperName.includes("ARCOLASE")) defaultKompetitorName = "Nexium 20mg";
      else if (upperName.includes("BECANTEX")) defaultKompetitorName = "Mucosta 100mg";
      else if (upperName.includes("ROZGRA")) defaultKompetitorName = "Viagra 50mg";

      const surveyCompetitor = realSurvey
        ? {
            namaKompetitor: realSurvey.kompetitorTop3?.[0]?.namaProduk || defaultKompetitorName,
            forecastPenjualanKompetitor: `${realSurvey.totalPotensiBulan || 5} UB`,
            potensiProrisUb: realSurvey.totalPotensiBulan || 5,
          }
        : dummyRef?.surveyCompetitor || {
            namaKompetitor: defaultKompetitorName,
            forecastPenjualanKompetitor: "5 UB",
            potensiProrisUb: 30,
          };

      const healthyOneUb = dummyRef?.internalSales?.healthyOneUb ?? 10;

      // Sell In: find matching products from effectiveSalesOnlineItems with SAME zat_aktif, EXCLUDING this product itself
      const matchingOnlineItems = effectiveSalesOnlineItems.filter((it: any) => {
        const itCode = String(it.code || "").trim();
        const itStripped = itCode.replace(/^0+/, "");
        const isSelf =
          itCode === code ||
          itStripped === strippedCode ||
          (altCode && (itCode === altCode || itStripped === strippedAlt));
        if (isSelf) return false;
        if (!zatAktif) return false;
        const itZat = String(it.zat_aktif || "").trim();
        if (!itZat) return false;
        return isSameZatAktif(zatAktif, itZat);
      });

      const b2bProducts = matchingOnlineItems.map((it: any) => {
        const itCode = String(it.code || "").trim();
        const itName = it.product_name || resolveProductName(itCode, masterProducts) || `Produk ${itCode}`;
        const qty = Number(it.qty_sales) || 0;
        return {
          kode: itCode,
          nama: itName,
          qtyUb: qty,
        };
      });

      const totalB2bQty = b2bProducts.reduce((sum: number, p: any) => sum + p.qtyUb, 0);

      const surveyForecast = surveyCompetitor?.forecastPenjualanKompetitor || "5 UB";
      const surveyDisplay = surveyForecast.toUpperCase().includes("UB") ? surveyForecast : `${surveyForecast} UB`;
      const surveyQty = surveyCompetitor ? parseFloat(surveyForecast.replace(/[^0-9.]/g, "")) || 0 : 0;
      const totalPotensi = Math.ceil(surveyQty + healthyOneUb + totalB2bQty);
      const isSelected =
        selectedProductCodes.has(code) ||
        selectedProductCodes.has(strippedCode) ||
        (altCode ? selectedProductCodes.has(altCode) || selectedProductCodes.has(strippedAlt) : false);

      return {
        kodeProduk: code,
        namaProduk: name,
        subtitel: `${code} · ${zatAktif || name}`,
        zatAktif,
        surveyCompetitor,
        surveyDisplay,
        healthyOneUb,
        b2bProducts,
        totalPotensi,
        isSelected,
        hasSurvey: Boolean(surveyCompetitor),
        hasHealthyOne: healthyOneUb > 0,
        hasB2b: b2bProducts.length > 0,
      };
    });
  }, [canvasserProducts, masterProducts, salesOnlineMap, effectiveSalesOnlineItems, selectedProductCodes, surveyData]);

  const filteredCards = useMemo(() => {
    let list = scCards;
    if (kompetitorFilter === "survey") {
      list = list.filter((c) => c.hasSurvey);
    } else if (kompetitorFilter === "healthyone") {
      list = list.filter((c) => c.hasHealthyOne);
    } else if (kompetitorFilter === "b2b") {
      list = list.filter((c) => c.hasB2b);
    }

    if (kompetitorSearch.trim()) {
      const q = kompetitorSearch.toLowerCase().trim();
      list = list.filter((c) =>
        c.namaProduk.toLowerCase().includes(q) ||
        c.kodeProduk.toLowerCase().includes(q) ||
        c.zatAktif.toLowerCase().includes(q) ||
        (c.surveyCompetitor?.namaKompetitor || "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [scCards, kompetitorFilter, kompetitorSearch]);

  const KOMPETITOR_PER_PAGE = 3;
  const totalKompetitorPages = Math.max(1, Math.ceil(filteredCards.length / KOMPETITOR_PER_PAGE));
  const paginatedCards = useMemo(() => {
    const start = (kompetitorPage - 1) * KOMPETITOR_PER_PAGE;
    return filteredCards.slice(start, start + KOMPETITOR_PER_PAGE);
  }, [filteredCards, kompetitorPage]);

  // Map of product codes to aggregated history sales
  const aggregatedHistoryMap = useMemo(() => {
    if (!historySalesData) return new Map<string, AggregatedProductHistory>();
    return aggregateHistorySales(historySalesData);
  }, [historySalesData]);

  // Category 2: Only SC products from canvasserProducts that HAVE history sales (> 0)
  const historySalesList = useMemo(() => {
    if (!Array.isArray(canvasserProducts) || aggregatedHistoryMap.size === 0) return [];

    const matchedList: {
      code: string;
      name: string;
      targetCode: string;
      salesQty: number;
      salesVal: number;
      item: any;
    }[] = [];

    for (const cp of canvasserProducts) {
      const code = String(cp.pro_code || cp.kode_item || cp.kodeProduk || "").trim();
      if (!code) continue;
      const strippedCode = code.replace(/^0+/, "");

      const agg = aggregatedHistoryMap.get(code) ?? aggregatedHistoryMap.get(strippedCode);
      if (agg && agg.avgQty > 0) {
        matchedList.push({
          code,
          name: cp.pro_name || cp.namaProduk || resolveProductName(code, masterProducts) || `Produk ${code}`,
          targetCode: code,
          salesQty: agg.avgQty,
          salesVal: agg.avgValue,
          item: agg,
        });
      }
    }

    matchedList.sort((a, b) => b.salesQty - a.salesQty);
    return matchedList;
  }, [canvasserProducts, aggregatedHistoryMap, masterProducts]);

  return {
    activeTab,
    setActiveTab,
    kompetitorFilter,
    setKompetitorFilter,
    kompetitorSearch,
    setKompetitorSearch,
    kompetitorPage,
    setKompetitorPage,
    prevQuarterInfo,
    canvasserScCodes,
    effectiveSurveyData,
    historyPeriodSubtext,
    scCards,
    filteredCards,
    paginatedCards,
    totalKompetitorPages,
    aggregatedHistoryMap,
    historySalesList,
  };
}
