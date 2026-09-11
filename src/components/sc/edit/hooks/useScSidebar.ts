"use client";

import { useState, useMemo } from "react";
import { getPreviousQuarterInfo } from "@/lib/quarterUtils";
import { aggregateHistorySales, type AggregatedProductHistory } from "@/lib/historySalesUtils";
import { resolveProductName, isSameZatAktif } from "../utils/productMatcherUtils";
import { formatHistoryPeriodRange } from "../utils/periodUtils";
import type { SidebarTab, ScSidebarProps } from "../types/sidebarTypes";

export function useScSidebar({
  poaPeriod,
  canvasserProducts = [],
  masterProducts = [],
  salesOnlineData,
  surveyData = [],
  surveyNexusData,
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

  // Build lookup map from Nexus survey: procode (kode_item) -> list of competitors
  const nexusSurveyMap = useMemo(() => {
    const map = new Map<string, Array<{ namaKompetitor: string; salesForecast: number }>>();
    if (!surveyNexusData?.data?.has_data) return map;

    const surveys = surveyNexusData.data.surveys;
    if (!Array.isArray(surveys) || surveys.length === 0) return map;

    // Use latest survey (index 0)
    const latestSurvey = surveys[0];
    const products = Array.isArray(latestSurvey?.products) ? latestSurvey.products : [];

    for (const p of products) {
      const compName = String(p.product_name || "").trim();
      const forecast = Number(p.sales_forecast) || 0;
      const switching = Array.isArray(p.switching_products) ? p.switching_products : [];

      for (const sw of switching) {
        const procode = String(sw.procode || "").trim();
        if (!procode) continue;
        const stripped = procode.replace(/^0+/, "");
        const entry = { namaKompetitor: compName, salesForecast: forecast };

        const addKey = (k: string) => {
          const list = map.get(k) ?? [];
          if (!list.some((it) => it.namaKompetitor === compName)) {
            list.push(entry);
          }
          map.set(k, list);
        };

        addKey(procode);
        if (stripped) addKey(stripped);
      }
    }
    return map;
  }, [surveyNexusData]);

  const effectiveSurveyData = useMemo(() => {
    // If we have nexusSurveyMap with matches from canvasserProducts:
    if (nexusSurveyMap.size > 0 && Array.isArray(canvasserProducts) && canvasserProducts.length > 0) {
      const nexusItems: any[] = [];
      const seen = new Set<string>();

      for (const cp of canvasserProducts) {
        const itemCode = String(cp.kode_item || "").trim();
        const strippedItemCode = itemCode.replace(/^0+/, "");
        const proCode = String(cp.pro_code || cp.kodeProduk || "").trim();
        const strippedProCode = proCode.replace(/^0+/, "");

        const matched =
          (itemCode ? nexusSurveyMap.get(itemCode) || (strippedItemCode ? nexusSurveyMap.get(strippedItemCode) : undefined) : undefined) ||
          (proCode ? nexusSurveyMap.get(proCode) || (strippedProCode ? nexusSurveyMap.get(strippedProCode) : undefined) : undefined) ||
          [];

        const primaryKey = proCode || itemCode;
        if (matched.length > 0 && !seen.has(primaryKey)) {
          seen.add(primaryKey);
          const totalForecast = matched.reduce((sum, c) => sum + c.salesForecast, 0);
          nexusItems.push({
            kodeProduk: primaryKey,
            namaProdukRekomendasi: cp.pro_name || cp.namaProduk || resolveProductName(primaryKey, masterProducts) || `Produk ${primaryKey}`,
            totalPotensiBulan: totalForecast,
            kompetitor: matched,
          });
        }
      }

      if (nexusItems.length > 0) {
        return nexusItems;
      }
    }

    const raw = Array.isArray(surveyData) ? surveyData : [];
    if (canvasserScCodes.size === 0) return [];
    return raw.filter((s: any) => {
      const c = String(s.kodeProduk || "").trim();
      return canvasserScCodes.has(c) || canvasserScCodes.has(c.replace(/^0+/, ""));
    });
  }, [surveyData, canvasserScCodes, nexusSurveyMap, canvasserProducts, masterProducts]);

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
    const rawList: any[] = Array.isArray(canvasserProducts) ? canvasserProducts : [];

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

      // Matching with Nexus Survey: match switching_products.procode with cp.kode_item or cp.pro_code
      const matchedCompetitors =
        (altCode ? nexusSurveyMap.get(altCode) || (strippedAlt ? nexusSurveyMap.get(strippedAlt) : undefined) : undefined) ||
        (code ? nexusSurveyMap.get(code) || (strippedCode ? nexusSurveyMap.get(strippedCode) : undefined) : undefined) ||
        [];

      const hasSurvey = matchedCompetitors.length > 0;
      const surveyQty = matchedCompetitors.reduce((sum, c) => sum + c.salesForecast, 0);
      const surveyCompetitors = matchedCompetitors;

      const healthyOneUb = 0;

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

      // Group matching B2B items by product code to prevent duplicate keys and aggregate quantities
      const b2bProductMap = new Map<string, { code: string; namaProduk: string; qty_sales: number; isSelected: boolean }>();
      for (const it of matchingOnlineItems) {
        const itCode = String(it.code || "").trim();
        if (!itCode) continue;
        const itName = it.product_name || resolveProductName(itCode, masterProducts) || `Produk ${itCode}`;
        const qty = Number(it.qty_sales) || 0;
        const itStripped = itCode.replace(/^0+/, "");
        const isB2bSelected = selectedProductCodes.has(itCode) || selectedProductCodes.has(itStripped);
        const existing = b2bProductMap.get(itCode);
        if (existing) {
          existing.qty_sales += qty;
        } else {
          b2bProductMap.set(itCode, {
            code: itCode,
            namaProduk: itName,
            qty_sales: qty,
            isSelected: isB2bSelected,
          });
        }
      }

      const b2bProducts = Array.from(b2bProductMap.values()).map((bp) => ({
        ...bp,
        kode: bp.code,
        nama: bp.namaProduk,
        qtyUb: bp.qty_sales,
      }));

      const totalB2bQty = b2bProducts.reduce((sum: number, p: any) => sum + p.qty_sales, 0);

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
        surveyCompetitors,
        surveyQty,
        healthyOneUb,
        b2bProducts,
        totalPotensi,
        isSelected,
        hasSurvey,
        hasHealthyOne: healthyOneUb > 0,
        hasB2b: b2bProducts.length > 0,
      };
    });
  }, [canvasserProducts, masterProducts, salesOnlineMap, effectiveSalesOnlineItems, selectedProductCodes, nexusSurveyMap]);

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
        c.surveyCompetitors.some((sc: any) => sc.namaKompetitor.toLowerCase().includes(q))
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
