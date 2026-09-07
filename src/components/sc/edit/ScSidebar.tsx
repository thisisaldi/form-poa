"use client";

import { useState, useMemo } from "react";
import { HeaderInfo } from "@/components/ui/HeaderInfo";
import { getPreviousQuarterInfo } from "@/lib/quarterUtils";
import { aggregateHistorySales, type AggregatedProductHistory } from "@/lib/historySalesUtils";

function formatRp(val: number) {
  return "Rp " + Math.round(val).toLocaleString("id-ID");
}

function formatMonthKey(key: string) {
  if (key.length !== 6) return key;
  const year = key.slice(0, 4);
  const month = parseInt(key.slice(4, 6), 10);
  const MONTH_NAMES = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function formatHistoryPeriodRange(periodArr?: string[]): string {
  if (!Array.isArray(periodArr) || periodArr.length === 0) return "";
  const validPeriods = periodArr.filter((p) => typeof p === "string" && p.length === 6).sort();
  if (validPeriods.length === 0) return "";

  const MONTH_NAMES = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];

  const minStr = validPeriods[0];
  const maxStr = validPeriods[validPeriods.length - 1];

  const minYear = minStr.slice(0, 4);
  const minMonthIdx = parseInt(minStr.slice(4, 6), 10) - 1;

  const maxYear = maxStr.slice(0, 4);
  const maxMonthIdx = parseInt(maxStr.slice(4, 6), 10) - 1;

  if (minMonthIdx < 0 || minMonthIdx > 11 || maxMonthIdx < 0 || maxMonthIdx > 11) return "";

  const minMonthName = MONTH_NAMES[minMonthIdx];
  const maxMonthName = MONTH_NAMES[maxMonthIdx];

  if (minYear === maxYear) {
    return `Data diambil dari bulan ${minMonthName} - ${maxMonthName} ${maxYear}`;
  } else {
    return `Data diambil dari bulan ${minMonthName} ${minYear} - ${maxMonthName} ${maxYear}`;
  }
}

const SIDEBAR_ORANGE = "var(--color-orange, #ea580c)";
const SIDEBAR_BLUE = "var(--color-blue, #0063a0)";
const SIDEBAR_GREEN = "var(--color-success, #16a34a)";
const SIDEBAR_PURPLE = "#7c3aed";
const SIDEBAR_RED = "#e11d48";

function formatQtySales(qty: number): string {
  if (qty == null || isNaN(qty)) return "0";
  if (Number.isInteger(qty)) return String(qty);
  return qty.toFixed(2);
}

function resolveProductName(code: string, masterProducts: any[]): string {
  if (!code) return "";
  const clean = String(code).trim();
  const stripped = clean.replace(/^0+/, "");
  const found = masterProducts.find((p: any) => {
    const pCode = String(p.kodeProduk || p.pro_code || p.product_code || "").trim();
    return pCode === clean || pCode.replace(/^0+/, "") === stripped;
  });
  if (found?.namaProduk) return found.namaProduk;

  const fallbackMap: Record<string, string> = {
    "0110492": "PRORIS FORTE 200MG SUSP 50ML",
    "0201478": "PRORIS SUSP 60 ML RASA JERUK",
    "0202672": "PRORIS IBUPROFEN 10 KAPLET",
    "0201784": "POLYSILANE SUSPENSI 100 ML",
    "0200850": "POLYSILANE SUSPENSI 180 ML",
    "0200851": "POLYSILANE MAX TABLET",
    "0202144": "MICROLAX 3 X 5 ML",
    "0203638": "MICROLAXTAB BISACODYL 5MG",
  };
  return fallbackMap[clean] || fallbackMap[stripped] || `Produk ${clean}`;
}

function isSameZatAktif(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const cleanA = a.toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, "");
  const cleanB = b.toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, "");
  if (!cleanA || !cleanB) return false;
  if (cleanA === cleanB) return true;
  if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) return true;

  const wordsA = a.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length > 3);
  const wordsB = b.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length > 3);
  return wordsA.some((wa) => wordsB.includes(wa));
}

const DUMMY_KOMPETITOR_DATA = [
  {
    kodeProduk: "0201478",
    namaProduk: "PRORIS SUSP 60 ML RASA JERUK",
    subtitel: "0201478 · PRORIS · Ibuprofen 100mg/5ml",
    zatAktif: "IBUPROFEN",
    internalSales: {
      healthyOneUb: 10,
      b2bSellInUb: 16.67,
    },
    surveyCompetitor: {
      namaKompetitor: "Sanmol Syrup 60ml",
      forecastPenjualanKompetitor: "5 UB",
      potensiProrisUb: 35,
    },
  },
  {
    kodeProduk: "0201784",
    namaProduk: "POLYSILANE SUSPENSI 100 ML",
    subtitel: "0201784 · POLYSILANE · Antasida Doen & Dimethicone",
    zatAktif: "AL(OH)3, MG(OH)2, DIMETHICONE",
    internalSales: {
      healthyOneUb: 18,
      b2bSellInUb: 7.33,
    },
    surveyCompetitor: {
      namaKompetitor: "Mylanta Liquid 150ml",
      forecastPenjualanKompetitor: "8 UB",
      potensiProrisUb: 51,
    },
  },
  {
    kodeProduk: "0202144",
    namaProduk: "MICROLAX 3 X 5 ML",
    subtitel: "0202144 · MICROLAX · Na Lauril Sulfoasetat",
    zatAktif: "NA LAURYL SULFATE, PEG, SORBITOL, NA CITRATE, SORBIC ACID",
    internalSales: {
      healthyOneUb: 8,
      b2bSellInUb: 3.33,
    },
    surveyCompetitor: {
      namaKompetitor: "Dulcolax Suppositoria",
      forecastPenjualanKompetitor: "4 UB",
      potensiProrisUb: 27,
    },
  },
];

function sidebarEdgeTabStyle(color: string): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "18px 10px",
    gap: 2,
    background: color,
    border: `1px solid ${color}`,
    borderRight: "none",
    borderRadius: "8px 0 0 8px",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    writingMode: "vertical-rl",
    letterSpacing: "0.05em",
  };
}

type SidebarTab = "rekomendasi" | "loss_sales" | "history" | "analisis_kompetitor";

function SidebarTabSwitcher({
  activeTab,
  onChange,
}: {
  activeTab: SidebarTab;
  onChange: (tab: SidebarTab) => void;
}) {
  function pillStyle(color: string, active: boolean): React.CSSProperties {
    return {
      fontSize: 11,
      fontWeight: 700,
      padding: "3px 9px",
      borderRadius: 999,
      cursor: "pointer",
      letterSpacing: "0.01em",
      border: `1px solid ${color}`,
      background: active ? color : "transparent",
      color: active ? "#fff" : color,
    };
  }
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={() => onChange("rekomendasi")}
        style={pillStyle(SIDEBAR_GREEN, activeTab === "rekomendasi")}
      >
        Produk Rekomendasi
      </button>
      <button
        type="button"
        onClick={() => onChange("history")}
        style={pillStyle(SIDEBAR_BLUE, activeTab === "history")}
      >
        Histori SC
      </button>
      <button
        type="button"
        onClick={() => onChange("analisis_kompetitor")}
        style={pillStyle(SIDEBAR_RED, activeTab === "analisis_kompetitor")}
      >
        Analisis Kompetitor
      </button>
    </div>
  );
}

function getHnaForProduct(code: string, masterProducts: any[]): number {
  if (!code || !Array.isArray(masterProducts) || masterProducts.length === 0) return 0;
  const cleanCode = String(code).trim();
  const strippedCode = cleanCode.replace(/^0+/, "");

  const item = masterProducts.find((p: any) => {
    const pCode = String(p.kodeProduk || p.pro_code || p.product_code || "").trim();
    if (pCode === cleanCode) return true;
    if (pCode.replace(/^0+/, "") === strippedCode) return true;
    return false;
  });

  if (!item) return 0;
  const rawHna = item.hna;
  const num = typeof rawHna === "number" ? rawHna : parseFloat(String(rawHna || "0"));
  return isNaN(num) ? 0 : num;
}

export function ScSidebar({
  poaPeriod,
  doctorName,
  productsMenang = [],
  productsInsentif = [],
  insentifHistory,
  historySalesData,
  salesOnlineData,
  surveyData = [],
  rekomendasiProduk = [],
  masterProducts = [],
  canvasserProducts = [],
  selectedProductCodes = new Set<string>(),
  onSelectProduct,
}: {
  poaPeriod?: string | null;
  doctorName?: string;
  productsMenang?: any[];
  productsInsentif?: any[];
  insentifHistory?: any;
  historySalesData?: any;
  salesOnlineData?: any;
  surveyData?: any[];
  rekomendasiProduk?: any[];
  masterProducts?: any[];
  canvasserProducts?: any[];
  selectedProductCodes?: Set<string>;
  onSelectProduct?: (code: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<SidebarTab | null>(null);
  const [kompetitorFilter, setKompetitorFilter] = useState<string>("semua");
  const [kompetitorSearch, setKompetitorSearch] = useState<string>("");
  const [kompetitorPage, setKompetitorPage] = useState<number>(1);

  const prevQuarterInfo = useMemo(() => {
    return getPreviousQuarterInfo(poaPeriod);
  }, [poaPeriod]);

  const effectiveSurveyData = useMemo(() => {
    return Array.isArray(surveyData) ? surveyData : [];
  }, [surveyData]);

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
        if (isSelf) return false; // EXCLUDE self!
        if (!zatAktif) return false;
        const itZat = String(it.zat_aktif || "").trim();
        if (!itZat) return false;
        return isSameZatAktif(zatAktif, itZat);
      });

      const b2bProducts = matchingOnlineItems.map((it: any) => {
        const itCode = String(it.code || "").trim();
        const itName = resolveProductName(itCode, masterProducts);
        const qty = Number(it.qty_sales) || 0;
        const isSelected = selectedProductCodes.has(itCode) || selectedProductCodes.has(itCode.replace(/^0+/, ""));
        return {
          code: itCode,
          namaProduk: itName,
          qty_sales: qty,
          zat_aktif: it.zat_aktif,
          isSelected,
        };
      });

      const totalB2bQty = b2bProducts.reduce((sum: number, p: any) => sum + p.qty_sales, 0);
      const rawSurveyForecast = String(surveyCompetitor?.forecastPenjualanKompetitor || "0").trim();
      const surveyForecast = rawSurveyForecast.replace(/Botol|Box/gi, "UB");
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
  }, [canvasserProducts, masterProducts, salesOnlineMap, effectiveSalesOnlineItems, selectedProductCodes]);

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

  // Map of product codes to aggregated history sales (Average per active transaction month)
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
      const salesQty = agg?.avgQty ?? 0;
      if (salesQty > 0) {
        const name = cp.pro_name || cp.namaProduk || cp.name || code;
        matchedList.push({
          code,
          name,
          targetCode: code,
          salesQty,
          salesVal: agg?.avgValue ?? 0,
          item: cp,
        });
      }
    }

    return matchedList.sort((a, b) => b.salesQty - a.salesQty);
  }, [canvasserProducts, aggregatedHistoryMap]);

  // Set of codes already placed in Category 2 (Pernah diorder)
  const orderedScCodesSet = useMemo(() => {
    const set = new Set<string>();
    for (const entry of historySalesList) {
      set.add(entry.code);
      set.add(entry.code.replace(/^0+/, ""));
    }
    return set;
  }, [historySalesList]);

  // SC Products from canvasserProducts that HAVE NO sales history
  const noSalesScProducts = useMemo(() => {
    if (!Array.isArray(canvasserProducts)) return [];
    return canvasserProducts.filter((cp: any) => {
      const code = String(cp.pro_code || cp.kode_item || cp.kodeProduk || "").trim();
      const strippedCode = code.replace(/^0+/, "");
      return !orderedScCodesSet.has(code) && !orderedScCodesSet.has(strippedCode);
    });
  }, [canvasserProducts, orderedScCodesSet]);

  // Category 3: PRODUK PROMILAN SC (SC products with NO sales history matching Promilan keywords)
  const promilanProducts = useMemo(() => {
    const keywords = ["PRORIS", "MICROLAX", "POLYSILANE"];
    return noSalesScProducts.filter((item: any) => {
      const name = String(item.pro_name || item.namaProduk || item.name || "").toUpperCase();
      return keywords.some((kw) => name.includes(kw));
    });
  }, [noSalesScProducts]);

  // Category 4: PRODUK SC (SC products with NO sales history that are NOT Promilan)
  const scNoSalesProducts = useMemo(() => {
    const keywords = ["PRORIS", "MICROLAX", "POLYSILANE"];
    return noSalesScProducts.filter((item: any) => {
      const name = String(item.pro_name || item.namaProduk || item.name || "").toUpperCase();
      return !keywords.some((kw) => name.includes(kw));
    });
  }, [noSalesScProducts]);

  const recommendationList = useMemo(() => {
    const map = new Map<
      string,
      {
        code: string;
        name: string;
        insentifValue?: number;
        avgInsentif?: number;
        avgSellout?: number;
        totalSellout?: number;
        activePeriods?: number[];
        pct?: string;
        period?: string;
      }
    >();

    const processItem = (item: any) => {
      if (!item) return;
      const code = typeof item === "string"
        ? item
        : String(item.pro_code || item.kode_item || item.kodeProduk || item.code || "").trim();
      const name = typeof item === "string"
        ? item
        : (item.pro_name || item.namaProduk || item.nama_produk || item.name || code);
      const insentif = typeof item === "object"
        ? (item.total_insentif ?? item.insentif ?? item.sales_counter_value)
        : undefined;
      const avgInsentif = typeof item === "object" ? item.average_insentif : undefined;
      const avgSellout = typeof item === "object" ? item.average_sellout : undefined;
      const totalSellout = typeof item === "object" ? item.total_sellout : undefined;
      const activePeriods = typeof item === "object" ? item.active_periods : undefined;
      const pct = typeof item === "object" ? (item.pct || item.pelunasan) : undefined;
      const period = typeof item === "object" ? (item.period || item.periode) : undefined;

      const key = code || name;
      if (key && !map.has(key)) {
        map.set(key, {
          code,
          name,
          insentifValue: insentif != null ? Number(insentif) : undefined,
          avgInsentif: avgInsentif != null ? Number(avgInsentif) : undefined,
          avgSellout: avgSellout != null ? Number(avgSellout) : undefined,
          totalSellout: totalSellout != null ? Number(totalSellout) : undefined,
          activePeriods: Array.isArray(activePeriods) ? activePeriods : undefined,
          pct,
          period,
        });
      }
    };

    for (const item of productsMenang) {
      processItem(item);
    }
    for (const item of productsInsentif) {
      processItem(item);
    }

    return Array.from(map.values());
  }, [productsMenang, productsInsentif]);

  const sortedLossSalesProducts = useMemo(() => {
    if (!Array.isArray(rekomendasiProduk)) return [];
    return [...rekomendasiProduk]
      .map((item) => {
        const code = String(item.product_code || item.code || "").trim();
        const hna = getHnaForProduct(code, masterProducts);
        const salesPotential = Number(item.sales_potential) || 0;
        const qty = hna > 0 ? Math.ceil(salesPotential / hna) : 0;
        return {
          ...item,
          _computedQty: qty,
          _salesPotentialNum: salesPotential,
        };
      })
      .sort((a, b) => {
        if (b._computedQty !== a._computedQty) {
          return b._computedQty - a._computedQty;
        }
        return b._salesPotentialNum - a._salesPotentialNum;
      });
  }, [rekomendasiProduk, masterProducts]);

  if (activeTab === null) {
    return (
      <>
        {/* Desktop Vertical Tabs */}
        <div
          className="hidden md:flex flex-col gap-1 fixed right-0 top-1/2 -translate-y-1/2 z-40"
        >
          <button
            type="button"
            onClick={() => setActiveTab("rekomendasi")}
            style={sidebarEdgeTabStyle(SIDEBAR_GREEN)}
          >
            Produk Rekomendasi
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("history")}
            style={sidebarEdgeTabStyle(SIDEBAR_BLUE)}
          >
            Histori SC
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("analisis_kompetitor")}
            style={sidebarEdgeTabStyle(SIDEBAR_RED)}
          >
            Analisis Kompetitor
          </button>
        </div>

        {/* Mobile Floating Action Pill at Bottom-Right */}
        <div className="flex md:hidden fixed bottom-6 right-4 z-40">
          <button
            type="button"
            onClick={() => setActiveTab("rekomendasi")}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full shadow-lg text-xs font-semibold text-white transition-all active:scale-95 cursor-pointer"
            style={{ background: "var(--color-blue, #0063a0)" }}
          >
            <span>Data Rekomendasi / SC</span>
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Mobile Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-xs z-40 md:hidden"
        onClick={() => setActiveTab(null)}
      />

      <div
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col shadow-2xl transition-all duration-300 w-[88vw] sm:w-[320px] max-w-[360px]"
        style={{
          background: "var(--color-bg)",
          borderLeft: "1px solid var(--color-border)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <SidebarTabSwitcher activeTab={activeTab} onChange={setActiveTab} />
            {doctorName && (
              <p className="truncate" style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)", marginTop: 1 }}>
                {doctorName}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setActiveTab(null)}
            className="p-1 rounded text-gray-500 hover:text-gray-800 text-sm font-bold flex items-center gap-1 cursor-pointer"
            title="Tutup"
          >
            <span>✕</span>
            <span className="text-xs md:hidden">Tutup</span>
          </button>
        </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 14 }} className="space-y-4">
        {activeTab === "rekomendasi" ? (
          <div className="space-y-4 animate-fade-in">
            {/* 1. PRODUK YANG SUDAH DI SURVEY ( NEXUS ) */}
            <div className="space-y-1.5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                  PRODUK YANG SUDAH DI SURVEY ({effectiveSurveyData.length})
                </p>
                <p className="text-[9px] font-medium" style={{ color: "var(--color-text-faint)", marginTop: 1 }}>
                  ( NEXUS )
                </p>
              </div>
              {effectiveSurveyData.length > 0 ? (
                <div className="space-y-1.5">
                  {effectiveSurveyData.map((item: any, i: number) => {
                    const targetCode = String(item.kodeProduk || "").trim();
                    const isSelected = targetCode ? selectedProductCodes.has(targetCode) : false;
                    return (
                      <div
                        key={i}
                        onClick={() => targetCode && onSelectProduct?.(targetCode)}
                        className={`p-2 rounded-lg border text-[11px] space-y-1.5 transition-all ${
                          onSelectProduct && targetCode ? "cursor-pointer hover:border-emerald-500" : ""
                        }`}
                        style={{
                          background: isSelected ? "var(--color-success-bg, #dcfce7)" : "var(--color-bg-subtle)",
                          borderColor: isSelected ? "var(--color-success, #16a34a)" : "var(--color-border)",
                        }}
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="min-w-0 flex-1">
                            <span className="font-semibold leading-tight block truncate" style={{ color: "var(--color-text)" }}>
                              {item.namaProdukRekomendasi || item.kodeProduk}
                            </span>
                          </div>
                          {isSelected && (
                            <span
                              className="inline-flex items-center gap-1 text-[9px] font-bold shrink-0 px-1.5 py-0.5 rounded-full"
                              style={{ background: "var(--color-success, #16a34a)", color: "#ffffff" }}
                            >
                              ✓ Terpilih
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 text-[9px] flex-wrap pt-0.5">
                          <span
                            className="font-medium px-1.5 py-0.5 rounded"
                            style={{ background: "#f3e8ff", color: "#6b21a8" }}
                          >
                            Produk Survey{item.totalPotensiBulan ? `: ${Math.floor(item.totalPotensiBulan)} UB` : ""}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border p-3 text-center text-xs" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
                  Belum ada data survey.
                </div>
              )}
            </div>

            {/* 2. PRODUK PERNAH DI ORDER */}
            <div className="space-y-1.5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                  PRODUK PERNAH DI ORDER ({historySalesList.length})
                </p>
                {historyPeriodSubtext && (
                  <p className="text-[9px] font-medium" style={{ color: "var(--color-text-faint)", marginTop: 1 }}>
                    ( {historyPeriodSubtext} )
                  </p>
                )}
              </div>
              {historySalesList.length > 0 ? (
                <div className="space-y-1.5">
                  {historySalesList.map((entry, i) => {
                    const isSelected = entry.targetCode ? selectedProductCodes.has(entry.targetCode) || selectedProductCodes.has(entry.code) : false;

                    return (
                      <div
                        key={i}
                        onClick={() => entry.targetCode && onSelectProduct?.(entry.targetCode)}
                        className={`p-2 rounded-lg border text-[11px] space-y-1.5 transition-all ${
                          onSelectProduct && entry.targetCode ? "cursor-pointer hover:border-emerald-500" : ""
                        }`}
                        style={{
                          background: isSelected ? "var(--color-success-bg, #dcfce7)" : "var(--color-bg-subtle)",
                          borderColor: isSelected ? "var(--color-success, #16a34a)" : "var(--color-border)",
                        }}
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="min-w-0 flex-1">
                            <span className="font-semibold leading-tight block truncate" style={{ color: "var(--color-text)" }}>
                              {entry.name}
                            </span>
                          </div>
                          {isSelected && (
                            <span
                              className="inline-flex items-center gap-1 text-[9px] font-bold shrink-0 px-1.5 py-0.5 rounded-full"
                              style={{ background: "var(--color-success, #16a34a)", color: "#ffffff" }}
                            >
                              ✓ Terpilih
                            </span>
                          )}
                        </div>

                        {(() => {
                          const hna = getHnaForProduct(entry.code, masterProducts) || parseFloat(String(entry.item?.hna || entry.item?.pro_hna || 0)) || 0;
                          const salesVal = entry.salesVal > 0 ? entry.salesVal : entry.salesQty * hna;
                          const formattedQty = entry.salesQty % 1 === 0 ? entry.salesQty.toString() : (Math.round(entry.salesQty * 10) / 10).toString();
                          return (
                            <div className="flex items-center gap-1.5 text-[9px] flex-wrap pt-0.5">
                              <span
                                className="font-medium px-1.5 py-0.5 rounded"
                                style={{ background: "var(--color-blue-light, #eff6ff)", color: "var(--color-blue, #2563eb)" }}
                              >
                                Average History Per Bulan: {salesVal > 0 ? `Rp ${Math.round(salesVal).toLocaleString("id-ID")} (${formattedQty} UB)` : `${formattedQty} UB`}
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border p-3 text-center text-xs" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
                  Belum ada data order.
                </div>
              )}
            </div>

            {/* 3. PRODUK PROMILAN SC */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                PRODUK PROMILAN SC ({promilanProducts.length})
              </p>
              {promilanProducts.length > 0 ? (
                <div className="space-y-1.5">
                  {promilanProducts.map((item: any, i: number) => {
                    const targetCode = String(item.pro_code || item.kode_item || "").trim();
                    const name = item.pro_name || item.namaProduk || item.name || targetCode;
                    const isSelected = targetCode ? selectedProductCodes.has(targetCode) : false;
                    const insentif = item.sales_counter_value != null ? Number(item.sales_counter_value) : null;

                    return (
                      <div
                        key={i}
                        onClick={() => targetCode && onSelectProduct?.(targetCode)}
                        className={`p-2 rounded-lg border text-[11px] space-y-1.5 transition-all ${
                          onSelectProduct && targetCode ? "cursor-pointer hover:border-emerald-500" : ""
                        }`}
                        style={{
                          background: isSelected ? "var(--color-success-bg, #dcfce7)" : "var(--color-bg-subtle)",
                          borderColor: isSelected ? "var(--color-success, #16a34a)" : "var(--color-border)",
                        }}
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="min-w-0 flex-1">
                            <span className="font-semibold leading-tight block truncate" style={{ color: "var(--color-text)" }}>
                              {name}
                            </span>
                          </div>
                          {isSelected && (
                            <span
                              className="inline-flex items-center gap-1 text-[9px] font-bold shrink-0 px-1.5 py-0.5 rounded-full"
                              style={{ background: "var(--color-success, #16a34a)", color: "#ffffff" }}
                            >
                              ✓ Terpilih
                            </span>
                          )}
                        </div>

                        {insentif != null && !isNaN(insentif) && (
                          <div className="flex items-center gap-1.5 text-[9px] flex-wrap pt-0.5">
                            <span
                              className="font-medium px-1.5 py-0.5 rounded"
                              style={{ background: "var(--color-success-bg, #dcfce7)", color: "var(--color-success, #16a34a)" }}
                            >
                              Insentif: {formatRp(insentif)}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border p-3 text-center text-xs" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
                  Tidak ada produk Promilan SC.
                </div>
              )}
            </div>

            {/* 4. PRODUK SC */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                PRODUK SC ({scNoSalesProducts.length})
              </p>
              {scNoSalesProducts.length > 0 ? (
                <div className="space-y-1.5">
                  {scNoSalesProducts.map((item: any, i: number) => {
                    const targetCode = String(item.pro_code || item.kode_item || "").trim();
                    const name = item.pro_name || item.namaProduk || item.name || targetCode;
                    const isSelected = targetCode ? selectedProductCodes.has(targetCode) : false;
                    const insentif = item.sales_counter_value != null ? Number(item.sales_counter_value) : null;

                    return (
                      <div
                        key={i}
                        onClick={() => targetCode && onSelectProduct?.(targetCode)}
                        className={`p-2 rounded-lg border text-[11px] space-y-1.5 transition-all ${
                          onSelectProduct && targetCode ? "cursor-pointer hover:border-emerald-500" : ""
                        }`}
                        style={{
                          background: isSelected ? "var(--color-success-bg, #dcfce7)" : "var(--color-bg-subtle)",
                          borderColor: isSelected ? "var(--color-success, #16a34a)" : "var(--color-border)",
                        }}
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="min-w-0 flex-1">
                            <span className="font-semibold leading-tight block truncate" style={{ color: "var(--color-text)" }}>
                              {name}
                            </span>
                          </div>
                          {isSelected && (
                            <span
                              className="inline-flex items-center gap-1 text-[9px] font-bold shrink-0 px-1.5 py-0.5 rounded-full"
                              style={{ background: "var(--color-success, #16a34a)", color: "#ffffff" }}
                            >
                              ✓ Terpilih
                            </span>
                          )}
                        </div>

                        {insentif != null && !isNaN(insentif) && (
                          <div className="flex items-center gap-1.5 text-[9px] flex-wrap pt-0.5">
                            <span
                              className="font-medium px-1.5 py-0.5 rounded"
                              style={{ background: "var(--color-success-bg, #dcfce7)", color: "var(--color-success, #16a34a)" }}
                            >
                              Insentif: {formatRp(insentif)}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border p-3 text-center text-xs" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
                  Tidak ada produk SC.
                </div>
              )}
            </div>
          </div>
        ) : activeTab === "loss_sales" ? (
          <div className="space-y-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                  POTENSI SALES ({sortedLossSalesProducts.length})
                </p>
                <HeaderInfo text="Angka potensi sales didapatkan dari penjualan B-1 sampai B-6" />
              </div>
            </div>
            {sortedLossSalesProducts.length > 0 ? (
              <div className="space-y-1.5">
                {sortedLossSalesProducts.map((item, i) => {
                  const code = String(item.product_code || item.code || "").trim();
                  const name = item.product_name || item.name || code;
                  const isSelected = selectedProductCodes.has(code);
                  const hna = getHnaForProduct(code, masterProducts);
                  const salesPotential = Number(item.sales_potential) || 0;
                  const qty = hna > 0 ? Math.ceil(salesPotential / hna) : 0;

                  return (
                    <div
                      key={i}
                      onClick={() => code && onSelectProduct?.(code)}
                      className={`p-2 rounded-lg border text-[11px] space-y-1.5 transition-all ${
                        onSelectProduct && code ? "cursor-pointer hover:border-purple-500" : ""
                      }`}
                      style={{
                        background: isSelected ? "var(--color-purple-light, #f3e8ff)" : "var(--color-bg-subtle)",
                        borderColor: isSelected ? "var(--color-purple, #7c3aed)" : "var(--color-border)",
                      }}
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="min-w-0 flex-1">
                          <span className="font-semibold leading-tight block truncate" style={{ color: "var(--color-text)" }}>
                            {name}
                          </span>
                          <span className="text-[10px]" style={{ color: "var(--color-text-faint)" }}>
                            Kode: {code}
                          </span>
                        </div>
                        {isSelected && (
                          <span
                            className="inline-flex items-center gap-1 text-[9px] font-bold shrink-0 px-1.5 py-0.5 rounded-full"
                            style={{ background: "#7c3aed", color: "#ffffff" }}
                          >
                            ✓ Terpilih
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 text-[9px] flex-wrap pt-0.5">
                        <span
                          className="font-medium px-1.5 py-0.5 rounded"
                          style={{ background: "var(--color-blue-light, #eff6ff)", color: "var(--color-blue, #2563eb)" }}
                        >
                          Sales Potential: {formatRp(salesPotential)}
                        </span>
                        <span
                          className="font-medium px-1.5 py-0.5 rounded"
                          style={{ background: "var(--color-success-bg, #dcfce7)", color: "var(--color-success, #16a34a)" }}
                        >
                          Qty: {qty}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border p-4 text-center text-xs" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
                Tidak ada data potensi sales untuk outlet ini.
              </div>
            )}
          </div>
        ) : activeTab === "analisis_kompetitor" ? (
          <div className="space-y-3 animate-fade-in">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                Analisis Kompetitor &amp; Survey ({filteredCards.length} Produk)
              </p>
              <p className="text-[9px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                Sumber: Survey, HealthyOne &amp; B2B · Periode: {prevQuarterInfo.label}
              </p>
            </div>

            {/* Search Input */}
            <div className="relative">
              <input
                type="text"
                placeholder="Cari produk SC / zat aktif..."
                value={kompetitorSearch}
                onChange={(e) => {
                  setKompetitorSearch(e.target.value);
                  setKompetitorPage(1);
                }}
                className="w-full px-2.5 py-1.5 rounded-lg border outline-none transition-colors"
                style={{
                  background: "var(--color-surface)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text)",
                  fontSize: "11px",
                  fontFamily: "inherit",
                }}
              />
              {kompetitorSearch && (
                <button
                  type="button"
                  onClick={() => {
                    setKompetitorSearch("");
                    setKompetitorPage(1);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Source Filter Pills */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 text-[10px]">
              {[
                {
                  id: "semua",
                  label: "Semua",
                  activeBg: "#7c3aed", // Ungu sedang (tidak terlalu gelap/bold)
                  activeText: "#ffffff",
                  activeBorder: "#7c3aed",
                  inactiveText: "#7c3aed",
                  inactiveBorder: "#ddd6fe",
                },
                {
                  id: "survey",
                  label: "Survey",
                  activeBg: "#dc2626", // Merah
                  activeText: "#ffffff",
                  activeBorder: "#dc2626",
                  inactiveText: "#dc2626",
                  inactiveBorder: "#fca5a5",
                },
                {
                  id: "healthyone",
                  label: "HealthyOne",
                  activeBg: "#026D77", // Warna gambar 3
                  activeText: "#ffffff",
                  activeBorder: "#026D77",
                  inactiveText: "#026D77",
                  inactiveBorder: "#80ced4",
                },
                {
                  id: "b2b",
                  label: "B2B",
                  activeBg: "#028CD5", // HospiNet
                  activeText: "#ffffff",
                  activeBorder: "#028CD5",
                  inactiveText: "#028CD5",
                  inactiveBorder: "#7dd3fc",
                },
              ].map((f) => {
                const isActive = kompetitorFilter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setKompetitorFilter(f.id);
                      setKompetitorPage(1);
                    }}
                    className="px-2.5 py-0.5 rounded-full border transition-all cursor-pointer whitespace-nowrap text-[9px]"
                    style={{
                      background: isActive ? f.activeBg : "var(--color-surface)",
                      color: isActive ? f.activeText : f.inactiveText,
                      borderColor: isActive ? f.activeBorder : f.inactiveBorder,
                      fontWeight: isActive ? 700 : 500,
                    }}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>

            {/* Product Competitor Cards */}
            <div className="space-y-2.5">
              {paginatedCards.length === 0 ? (
                <div
                  className="rounded-lg border p-4 text-center text-xs"
                  style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}
                >
                  Tidak ada produk yang cocok dengan pencarian atau filter ini.
                </div>
              ) : (
                paginatedCards.map((item, idx) => {
                  const showSurvey = kompetitorFilter === "semua" || kompetitorFilter === "survey";
                  const showHealthyOne = kompetitorFilter === "semua" || kompetitorFilter === "healthyone";
                  const showB2B = kompetitorFilter === "semua" || kompetitorFilter === "b2b";

                  return (
                    <div
                      key={item.kodeProduk || idx}
                      onClick={() => item.kodeProduk && onSelectProduct?.(item.kodeProduk)}
                      className={`rounded-lg border overflow-hidden text-xs transition-all ${
                        onSelectProduct ? "cursor-pointer hover:border-[var(--color-border-strong)]" : ""
                      }`}
                      style={{
                        borderColor: item.isSelected ? "var(--color-success, #16a34a)" : "var(--color-border)",
                        background: "var(--color-surface)",
                        boxShadow: item.isSelected ? "0 0 0 1px rgba(22, 163, 74, 0.2)" : undefined,
                      }}
                    >
                      {/* Header Card */}
                      <div
                        className="p-2.5 border-b flex items-start justify-between gap-1.5 transition-colors"
                        style={{
                          background: item.isSelected ? "var(--color-success-bg, #dcfce7)" : "var(--color-bg-subtle)",
                          borderColor: item.isSelected ? "rgba(22, 163, 74, 0.3)" : "var(--color-border)",
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <span className="font-semibold text-[11px] leading-tight block truncate" style={{ color: "var(--color-text)" }}>
                            {item.namaProduk}
                          </span>
                          <span className="text-[9px] block truncate" style={{ color: "var(--color-text-muted)" }}>
                            {item.subtitel}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {item.isSelected && (
                            <span
                              className="shrink-0 px-1.5 py-0.5 rounded font-semibold text-[8px] uppercase border"
                              style={{
                                background: "#16a34a",
                                color: "#ffffff",
                                borderColor: "#16a34a",
                              }}
                            >
                              ✓ Terpilih
                            </span>
                          )}
                          <span
                            className="text-[9px] font-bold shrink-0 px-2 py-0.5 rounded border"
                            style={{
                              background: item.isSelected ? "#ffffff" : "var(--color-surface)",
                              color: item.isSelected ? "#15803d" : "var(--color-text)",
                              borderColor: item.isSelected ? "#86efac" : "var(--color-border-strong)",
                            }}
                          >
                            Potensi: {item.totalPotensi} UB
                          </span>
                        </div>
                      </div>

                      {/* Card Body */}
                      <div className="p-2 space-y-2.5">
                        {/* 1. SELL OUT (Survey, HealthyOne) */}
                        {((showSurvey && item.surveyCompetitor) || (showHealthyOne && item.healthyOneUb > 0)) && (
                          <div className="space-y-1">
                            <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                              Sell Out
                            </div>
                            <div className="space-y-1 text-[10px]">
                              {/* Survey (External Competitor Survey) */}
                              {showSurvey && item.surveyCompetitor && (
                                <div
                                  className="p-1.5 rounded border flex items-center justify-between"
                                  style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                                >
                                  <div className="flex items-center gap-2 min-w-0 flex-1 mr-1">
                                    <span
                                      className="shrink-0 px-1.5 py-0.5 rounded font-semibold text-[8px] uppercase border"
                                      style={{
                                        background: "#fef2f2",
                                        color: "#dc2626",
                                        borderColor: "#fecaca",
                                      }}
                                    >
                                      Survey
                                    </span>
                                    <span className="truncate font-medium" style={{ color: "var(--color-text)" }}>
                                      {item.surveyCompetitor.namaKompetitor}
                                    </span>
                                  </div>
                                  <span className="font-bold shrink-0" style={{ color: "var(--color-text)" }}>
                                    {item.surveyDisplay}
                                  </span>
                                </div>
                              )}

                              {/* HealthyOne (Internal Sell Out) */}
                              {showHealthyOne && item.healthyOneUb > 0 && (
                                <div
                                  className="p-1.5 rounded border flex items-center justify-between"
                                  style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                                >
                                  <div className="flex items-center gap-2 min-w-0 flex-1 mr-1">
                                    <span
                                      className="shrink-0 px-1.5 py-0.5 rounded font-semibold text-[8px] uppercase border"
                                      style={{
                                        background: "#e6f4f5",
                                        color: "#026D77",
                                        borderColor: "#a0d7db",
                                      }}
                                    >
                                      HealthyOne
                                    </span>
                                    <span className="truncate font-medium" style={{ color: "var(--color-text)" }}>
                                      HealthyOne Sell Out
                                    </span>
                                  </div>
                                  <span className="font-bold shrink-0" style={{ color: "var(--color-text)" }}>
                                    {item.healthyOneUb} UB
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* 2. SELL IN (All matching B2B products by zat_aktif, excluding this product) */}
                        {showB2B && (
                          <div className="space-y-1 pt-1.5 border-t" style={{ borderColor: "var(--color-border)" }}>
                            <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                              Sell In
                            </div>

                            {item.b2bProducts.length === 0 ? (
                              <div className="p-1.5 rounded border text-[10px] text-center" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)", background: "var(--color-bg)" }}>
                                Tidak ada produk lain dengan zat aktif serupa.
                              </div>
                            ) : (
                              <div className="space-y-1">
                                {item.b2bProducts.map((bp: any) => {
                                  const formattedQty = formatQtySales(bp.qty_sales);
                                  return (
                                    <div
                                      key={bp.code}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onSelectProduct?.(bp.code);
                                      }}
                                      className="p-1.5 rounded border flex items-center justify-between text-[10px] transition-all cursor-pointer"
                                      style={{
                                        borderColor: bp.isSelected ? "var(--color-success, #16a34a)" : "var(--color-border)",
                                        background: bp.isSelected ? "var(--color-success-bg, #dcfce7)" : "var(--color-bg)",
                                      }}
                                      title={bp.isSelected ? "Sudah dipilih di rencana produk" : "Klik untuk menambahkan produk ini"}
                                    >
                                      <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                                        <span
                                          className="shrink-0 px-1.5 py-0.5 rounded font-semibold text-[8px] uppercase border"
                                          style={{
                                            background: bp.isSelected ? "#16a34a" : "#e0f2fe",
                                            color: bp.isSelected ? "#ffffff" : "#028CD5",
                                            borderColor: bp.isSelected ? "#16a34a" : "#bae6fd",
                                          }}
                                        >
                                          {bp.isSelected ? "✓ Terpilih" : "B2B"}
                                        </span>
                                        <span className="font-medium truncate" style={{ color: "var(--color-text)" }}>
                                          {bp.namaProduk}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <span className="font-bold" style={{ color: "var(--color-text)" }}>
                                          {formattedQty} UB
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Pagination Controls */}
            {totalKompetitorPages > 1 && (
              <div className="flex items-center justify-between pt-2 border-t text-[10px]" style={{ borderColor: "var(--color-border)" }}>
                <button
                  type="button"
                  disabled={kompetitorPage <= 1}
                  onClick={() => setKompetitorPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1 rounded border disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors"
                  style={{ background: "var(--color-surface)", borderColor: "var(--color-border)", color: "var(--color-text)" }}
                >
                  &larr; Prev
                </button>
                <span style={{ color: "var(--color-text-muted)" }}>
                  Halaman {kompetitorPage} dari {totalKompetitorPages}
                </span>
                <button
                  type="button"
                  disabled={kompetitorPage >= totalKompetitorPages}
                  onClick={() => setKompetitorPage((p) => Math.min(totalKompetitorPages, p + 1))}
                  className="px-2.5 py-1 rounded border disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors"
                  style={{ background: "var(--color-surface)", borderColor: "var(--color-border)", color: "var(--color-text)" }}
                >
                  Next &rarr;
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                Histori Sales Counter (SC)
              </p>
            </div>

            {(() => {
              const historyMap = insentifHistory?.data
                ? insentifHistory.data
                : (insentifHistory && typeof insentifHistory === "object" ? insentifHistory : null);
              const entries = historyMap ? Object.entries(historyMap) : [];

              if (entries.length === 0) {
                return (
                  <div className="rounded-lg border p-4 text-center text-xs" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
                    Tidak ada data histori insentif untuk outlet ini.
                  </div>
                );
              }

              return entries.map(([monthKey, items]: [string, any]) => {
                const itemList = Array.isArray(items) ? items : [];
                const monthLabel = formatMonthKey(monthKey);
                const totalTarget = itemList.reduce((sum: number, it: any) => sum + (parseFloat(it.target_sell_in_value ?? it.target ?? it.target_sales ?? 0) || 0), 0);
                const totalActual = itemList.reduce((sum: number, it: any) => sum + (parseFloat(it.realisasi_sell_in_value ?? it.actual ?? it.actual_sales ?? 0) || 0), 0);
                const totalInsentif = itemList.reduce((sum: number, it: any) => sum + (parseFloat(it.total_insentif ?? it.insentif ?? 0) || 0), 0);

                return (
                  <div key={monthKey} className="rounded-lg border space-y-2 p-2.5" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
                    <div className="flex items-center justify-between border-b pb-1.5" style={{ borderColor: "var(--color-border)" }}>
                      <span className="text-[11px] font-bold" style={{ color: "var(--color-text)" }}>
                        {monthLabel}
                      </span>
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "var(--color-blue-light, #eff6ff)", color: "var(--color-blue, #2563eb)" }}>
                        SC Active
                      </span>
                    </div>

                    {/* Metric Summary Header Card: Target / Realisasi / Insentif */}
                    <div className="grid grid-cols-3 gap-1 rounded-md p-1.5 text-center" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
                      <div>
                        <div className="text-[8px] uppercase font-semibold" style={{ color: "var(--color-text-faint)" }}>Target</div>
                        <div className="text-[10px] font-bold" style={{ color: "var(--color-text)" }}>
                          {totalTarget > 0 ? formatRp(totalTarget) : "-"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[8px] uppercase font-semibold" style={{ color: "var(--color-text-faint)" }}>Realisasi</div>
                        <div className="text-[10px] font-bold" style={{ color: "var(--color-blue, #2563eb)" }}>
                          {totalActual > 0 ? formatRp(totalActual) : "-"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[8px] uppercase font-semibold" style={{ color: "var(--color-text-faint)" }}>Insentif</div>
                        <div className="text-[10px] font-bold" style={{ color: "var(--color-success, #16a34a)" }}>
                          {totalInsentif > 0 ? formatRp(totalInsentif) : "-"}
                        </div>
                      </div>
                    </div>

                    {/* History Product Items List */}
                    <div className="space-y-1 pt-0.5">
                      {itemList.map((item: any, idx: number) => {
                        const targetVal = parseFloat(item.target_sell_in_value ?? item.target ?? 0) || 0;
                        const realisasiVal = parseFloat(item.realisasi_sell_in_value ?? item.actual ?? 0) || 0;
                        const insentifVal = parseFloat(item.total_insentif ?? item.insentif ?? 0) || 0;
                        return (
                          <div
                            key={idx}
                            className="p-1.5 rounded border text-[10px] leading-tight space-y-0.5"
                            style={{
                              background: "var(--color-bg)",
                              borderColor: "var(--color-border)",
                            }}
                          >
                            <div className="flex justify-between font-medium items-baseline gap-1">
                              <span className="truncate" style={{ color: "var(--color-text)" }}>{item.pro_name || item.namaProduk}</span>
                              <div className="flex items-center gap-1 shrink-0">
                                <span className="font-semibold" style={{ color: "var(--color-success, #16a34a)" }}>{formatRp(insentifVal)}</span>
                              </div>
                            </div>
                            {targetVal > 0 || realisasiVal > 0 ? (
                              <div className="text-[9px]" style={{ color: "var(--color-text-faint)" }}>
                                Target: {formatRp(targetVal)} | Realisasi: {formatRp(realisasiVal)}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>
    </div>
  </>
);
}
