"use client";

import { useState, useMemo } from "react";
import {
  getProductPotensiDetail,
  buildNexusSurveyMap,
  type ProductPotensiDetail,
} from "../../utils/competitorAnalysisUtils";
import {
  COMPETITOR_ITEMS_PER_PAGE,
  type CompetitorFilterKey,
} from "../constants/competitorFilterTabs";

export type CompetitorCardItem = ProductPotensiDetail & {
  subtitel: string;
  surveyDisplay: string;
  hasSurvey: boolean;
  hasHealthyOne: boolean;
  hasB2b: boolean;
  isSelected: boolean;
};

export function useCompetitorAnalysis({
  products = [],
  salesOnlineData,
  selectedCodes = new Set<string>(),
  surveyNexusData,
  healthyOneData = [],
}: {
  products?: Array<any>;
  salesOnlineData?: any;
  selectedCodes?: Set<string>;
  surveyNexusData?: any;
  healthyOneData?: any[];
}) {
  const [kompetitorFilter, setKompetitorFilter] = useState<CompetitorFilterKey>("semua");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [page, setPage] = useState<number>(1);

  const nexusSurveyMap = useMemo(() => {
    return buildNexusSurveyMap(surveyNexusData);
  }, [surveyNexusData]);

  const salesOnlineItems = useMemo(() => {
    if (Array.isArray(salesOnlineData?.data)) return salesOnlineData.data;
    if (Array.isArray(salesOnlineData)) return salesOnlineData;
    return [];
  }, [salesOnlineData]);

  const healthyOneMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!Array.isArray(healthyOneData)) return map;
    for (const item of healthyOneData) {
      const pCode = String(item.procode || "").trim();
      if (!pCode) continue;
      const qty = Number(item.ordered_qty) || 0;
      const stripped = pCode.replace(/^0+/, "");
      map.set(pCode, (map.get(pCode) || 0) + qty);
      if (stripped && stripped !== pCode) {
        map.set(stripped, (map.get(stripped) || 0) + qty);
      }
    }
    return map;
  }, [healthyOneData]);

  // Build card details for all products (from get-sales-counter-product)
  const cards: CompetitorCardItem[] = useMemo(() => {
    return products.map((p) => {
      const detail = getProductPotensiDetail(p, salesOnlineItems, nexusSurveyMap, healthyOneMap);
      const code = detail.kodeProduk;
      const stripped = code.replace(/^0+/, "");
      const isSelected = selectedCodes.has(code) || selectedCodes.has(stripped);
      const subtitel = `${code} · ${detail.zatAktif || detail.namaProduk}`;
      const surveyDisplay = `${detail.surveyQty} UB`;
      return {
        ...detail,
        subtitel,
        surveyDisplay,
        hasSurvey: detail.surveyCompetitors.length > 0,
        hasHealthyOne: detail.healthyOneUb > 0,
        hasB2b: detail.b2bProducts.length > 0,
        isSelected,
      };
    });
  }, [products, salesOnlineItems, selectedCodes, nexusSurveyMap, healthyOneMap]);

  // Filter cards by pill tabs and search query
  const filteredCards = useMemo(() => {
    let list = cards;
    if (kompetitorFilter === "survey") {
      list = list.filter((c) => c.hasSurvey);
    } else if (kompetitorFilter === "healthyone") {
      list = list.filter((c) => c.hasHealthyOne);
    } else if (kompetitorFilter === "b2b") {
      list = list.filter((c) => c.hasB2b);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (c) =>
          c.namaProduk.toLowerCase().includes(q) ||
          c.kodeProduk.toLowerCase().includes(q) ||
          c.zatAktif.toLowerCase().includes(q) ||
          (c.surveyName || "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [cards, kompetitorFilter, searchQuery]);

  const counts = useMemo(() => {
    let survey = 0;
    let healthyone = 0;
    let b2b = 0;
    for (const c of cards) {
      if (c.hasSurvey) survey++;
      if (c.hasHealthyOne) healthyone++;
      if (c.hasB2b) b2b++;
    }
    return { semua: cards.length, survey, healthyone, b2b };
  }, [cards]);

  const totalPages = Math.max(1, Math.ceil(filteredCards.length / COMPETITOR_ITEMS_PER_PAGE));
  const paginatedCards = useMemo(() => {
    const start = (page - 1) * COMPETITOR_ITEMS_PER_PAGE;
    return filteredCards.slice(start, start + COMPETITOR_ITEMS_PER_PAGE);
  }, [filteredCards, page]);

  return {
    kompetitorFilter,
    setKompetitorFilter,
    searchQuery,
    setSearchQuery,
    page,
    setPage,
    cards,
    filteredCards,
    paginatedCards,
    totalPages,
    counts,
    itemsPerPage: COMPETITOR_ITEMS_PER_PAGE,
  };
}
