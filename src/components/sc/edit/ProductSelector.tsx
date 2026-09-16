"use client";

import { useState, useEffect, useMemo } from "react";
import type { ProductSelectorProps } from "./types/editorProps";
import { Req, InfoTooltip } from "./ui";
import { formatRpNumber as formatRp } from "./utils/formatEditUtils";
import { satuanLabel, formatHnaLabel } from "./utils/productMatcherUtils";
import { Combobox } from "@/components/ui/Combobox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { UnitInput } from "./UnitInput";
import { ProductMobileCard, ProductMobileGrandTotal, ProductMobileToolbar } from "./ProductMobileCard";
import {
  getLossSalesAnalysisAction,
  getRecommendedProCodesAction,
  getScHistoryIncentiveCounterAction,
} from "@/app/actions/canvasser";
import { aggregateHistorySales } from "@/lib/historySalesUtils";
import { calculateCashbackDetails } from "./hooks/useSalesCounterCashback";
import { getB3RollingPeriodInfo } from "@/lib/b3Utils";

export { InfoTooltip };

const ID_MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function formatPeriodMonthYear(p?: string | number): string {
  if (!p) return "";
  const s = String(p).trim();
  if (s.length !== 6) return s;
  const yr = parseInt(s.slice(0, 4), 10);
  const mo = parseInt(s.slice(4, 6), 10);
  if (isNaN(yr) || isNaN(mo) || mo < 1 || mo > 12) return s;
  return `${ID_MONTHS_SHORT[mo - 1]} ${yr}`;
}

export function ProductSelector({
  rows,
  onAddRow,
  onRemoveRow,
  onUpdateRow,
  productsOptions,
  canvasserProducts,
  masterProducts,
  lamaPeriode,
  periodeAwal,
  diskonPeriode,
  cashbackData,
  hideCashback = false,
  isLoading = false,
  error,
  readOnly = false,
  b3SalesMap,
  b3QtyMap,
  b3RangeLabel,
  kodePI,
  surveyNexusData,
  historySalesData,
  historyIncentiveData,
}: ProductSelectorProps) {
  const [lossSalesItems, setLossSalesItems] = useState<any[]>([]);
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);

  const nexusSurveyMap = useMemo(() => {
    const map = new Map<string, Array<{ namaKompetitor: string; salesForecast: number }>>();
    if (!surveyNexusData?.data?.has_data) return map;

    const surveys = surveyNexusData.data.surveys;
    if (!Array.isArray(surveys) || surveys.length === 0) return map;

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

  const { historySalesMap, historyPeriodRange, b1Label, b2Label, b3Label } = useMemo(() => {
    const hMap = new Map<string, {
      history_sales: number;
      sales_b1: number;
      sales_b2: number;
      sales_b3: number;
      sales_val_b1?: number;
      sales_val_b2?: number;
      sales_val_b3?: number;
      activeMonthsB3?: number;
      avgQtyB3?: number;
      avgQtyB3Active?: number;
      avgValueB3Active?: number;
    }>();
    let periodRange = "";

    let rawPeriods = Array.isArray(historySalesData?.period) ? [...historySalesData.period] : [];
    if (rawPeriods.length === 0 && historySalesData?.data && typeof historySalesData.data === "object" && !Array.isArray(historySalesData.data)) {
      rawPeriods = Object.keys(historySalesData.data);
    }
    const validPeriods = rawPeriods
      .map(String)
      .filter((p) => p.length === 6)
      .sort();

    let p1 = validPeriods[validPeriods.length - 1]; // Latest (B1)
    let p2 = validPeriods[validPeriods.length - 2]; // B2
    let p3 = validPeriods[validPeriods.length - 3]; // B3

    if (!p1 || !p2 || !p3) {
      const b3Info = getB3RollingPeriodInfo(periodeAwal || "");
      if (b3Info.targetPeriods && b3Info.targetPeriods.length >= 3) {
        const sortedTarget = [...b3Info.targetPeriods].map(String).sort();
        p1 = p1 || sortedTarget[sortedTarget.length - 1];
        p2 = p2 || sortedTarget[sortedTarget.length - 2];
        p3 = p3 || sortedTarget[sortedTarget.length - 3];
      }
    }

    const b1Str = p1 ? formatPeriodMonthYear(p1) : "B1";
    const b2Str = p2 ? formatPeriodMonthYear(p2) : "B2";
    const b3Str = p3 ? formatPeriodMonthYear(p3) : "B3";

    if (p3 && p1) {
      periodRange = `${formatPeriodMonthYear(p3)} - ${formatPeriodMonthYear(p1)}`;
    }

    if (historySalesData?.data) {
      const aggMap = aggregateHistorySales(historySalesData);
      for (const [code, item] of aggMap.entries()) {
        const entry = {
          history_sales: item.avgQtyB3 ?? item.avgQty,
          sales_b1: item.sales_b1,
          sales_b2: item.sales_b2,
          sales_b3: item.sales_b3,
          sales_val_b1: item.sales_val_b1,
          sales_val_b2: item.sales_val_b2,
          sales_val_b3: item.sales_val_b3,
          activeMonthsB3: item.activeMonthsB3,
          avgQtyB3: item.avgQtyB3 ?? (item.sales_b1 + item.sales_b2 + item.sales_b3) / 3,
          avgQtyB3Active: item.avgQtyB3Active,
          avgValueB3Active: item.avgValueB3Active,
        };
        hMap.set(code, entry);
        hMap.set(code.replace(/^0+/, ""), entry);
      }
    }

    return {
      historySalesMap: hMap,
      historyPeriodRange: periodRange,
      b1Label: b1Str,
      b2Label: b2Str,
      b3Label: b3Str,
    };
  }, [historySalesData, periodeAwal]);

  const [fetchedIncentiveItems, setFetchedIncentiveItems] = useState<any[]>([]);

  useEffect(() => {
    if (historyIncentiveData?.data && Array.isArray(historyIncentiveData.data)) {
      setFetchedIncentiveItems(historyIncentiveData.data);
      return;
    }
    if (!kodePI) {
      setFetchedIncentiveItems([]);
      return;
    }
    let isMounted = true;
    const cleanPeriod = (periodeAwal || "").replace(/[^0-9]/g, "");
    const year = cleanPeriod.length >= 4 ? cleanPeriod.slice(0, 4) : String(new Date().getFullYear());
    const month = cleanPeriod.length >= 6 ? parseInt(cleanPeriod.slice(4, 6), 10) : new Date().getMonth() + 1;
    const quarter = `Q${Math.floor((month - 1) / 3) + 1}`;

    getScHistoryIncentiveCounterAction(kodePI, quarter, year)
      .then((res) => {
        if (!isMounted) return;
        const items = res?.data && Array.isArray(res.data) ? res.data : [];
        setFetchedIncentiveItems(items);
      })
      .catch((err) => {
        console.error("Failed fetching SC history incentive counter:", err);
        if (isMounted) setFetchedIncentiveItems([]);
      });

    return () => {
      isMounted = false;
    };
  }, [kodePI, periodeAwal, historyIncentiveData]);

  const historyIncentiveMap = useMemo(() => {
    const map = new Map<string, { win_incentive: number; win_qty: number; name: string }>();
    const items = historyIncentiveData?.data && Array.isArray(historyIncentiveData.data)
      ? historyIncentiveData.data
      : fetchedIncentiveItems;

    for (const item of items) {
      const code = String(item.code || "").trim();
      const stripped = code.replace(/^0+/, "");
      const val = {
        win_incentive: Number(item.win_incentive) || 0,
        win_qty: Number(item.win_qty) || 0,
        name: item.name || "",
      };
      if (code) map.set(code, val);
      if (stripped) map.set(stripped, val);
    }
    return map;
  }, [historyIncentiveData, fetchedIncentiveItems]);

  const getCompetitorsForRow = (kodeProduk: string) => {
    if (!kodeProduk) return [];
    const code = String(kodeProduk).trim();
    const strippedCode = code.replace(/^0+/, "");

    const canvasserProd = canvasserProducts.find(
      (p) =>
        p.pro_code === code ||
        p.pro_code?.replace(/^0+/, "") === strippedCode ||
        p.kode_item === code ||
        p.kode_item?.replace(/^0+/, "") === strippedCode
    );

    const itemCode = String(canvasserProd?.kode_item || "").trim();
    const strippedItemCode = itemCode.replace(/^0+/, "");

    return (
      (itemCode ? nexusSurveyMap.get(itemCode) || (strippedItemCode ? nexusSurveyMap.get(strippedItemCode) : undefined) : undefined) ||
      nexusSurveyMap.get(code) ||
      (strippedCode ? nexusSurveyMap.get(strippedCode) : undefined) ||
      []
    );
  };


  useEffect(() => {
    if (!kodePI || !periodeAwal) {
      setLossSalesItems([]);
      return;
    }
    const cleanPeriod = periodeAwal.replace(/[^0-9]/g, "");
    const periodInt = parseInt(cleanPeriod.slice(0, 6), 10);
    if (!periodInt || isNaN(periodInt)) {
      setLossSalesItems([]);
      return;
    }

    let isMounted = true;
    const selectedSourceCodes = rows.map((r) => r.kodeProduk).filter(Boolean);

    if (selectedSourceCodes.length === 0) {
      setLossSalesItems([]);
      return;
    }

    const availableOptionCodes = new Set([
      ...(productsOptions || []).map((p: any) => p.value || p.kodeProduk),
      ...(canvasserProducts || []).map((p: any) => p.pro_code),
    ].filter(Boolean));

    getRecommendedProCodesAction(selectedSourceCodes)
      .then((recommendedCodes: string[]) => {
        if (!isMounted) return null;

        const validCodes: string[] = availableOptionCodes.size > 0
          ? recommendedCodes.filter((code: string) => availableOptionCodes.has(code))
          : recommendedCodes;

        if (validCodes.length === 0) {
          if (isMounted) setLossSalesItems([]);
          return null;
        }

        return getLossSalesAnalysisAction(periodInt, kodePI, validCodes);
      })
      .then((res) => {
        if (!isMounted) return;
        if (res && res.status && Array.isArray(res.data)) {
          const filtered = res.data.filter(
            (item: any) =>
              ((item.qty != null && Number(item.qty) > 0) ||
                (item.total_sales != null && Number(item.total_sales) > 0)) &&
              (availableOptionCodes.size === 0 || availableOptionCodes.has(item.code))
          );
          setLossSalesItems(filtered);
        } else {
          setLossSalesItems([]);
        }
      })
      .catch(() => {
        if (isMounted) setLossSalesItems([]);
      });

    return () => {
      isMounted = false;
    };
  }, [kodePI, periodeAwal, JSON.stringify(rows.map((r) => r.kodeProduk)), productsOptions, masterProducts]);

  const isCashbackNotFound =
    hideCashback ||
    !cashbackData ||
    cashbackData?.message === "Gudang Tidak Ditemukan" ||
    (typeof cashbackData?.message === "string" &&
      (cashbackData.message.toLowerCase().includes("tidak ditemukan") ||
        cashbackData.message.toLowerCase().includes("gudang"))) ||
    (typeof cashbackData?.data?.message === "string" &&
      (cashbackData.data.message.toLowerCase().includes("tidak ditemukan") ||
        cashbackData.data.message.toLowerCase().includes("gudang"))) ||
    cashbackData?.status === false ||
    cashbackData?.success === false;

  const toggleRowDetail = (idx: number) => {
    setExpandedRows((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const [mobileOpenCards, setMobileOpenCards] = useState<Record<number, boolean>>({});
  const isMobileCardExpanded = (idx: number) => mobileOpenCards[idx] !== false;
  const toggleMobileCard = (idx: number) => {
    setMobileOpenCards((prev) => ({
      ...prev,
      [idx]: !isMobileCardExpanded(idx),
    }));
  };
  const areAllMobileExpanded = rows.length > 0 && rows.every((_, idx) => isMobileCardExpanded(idx));
  const toggleAllMobileCards = () => {
    const nextVal = !areAllMobileExpanded;
    const nextMap: Record<number, boolean> = {};
    rows.forEach((_, idx) => {
      nextMap[idx] = nextVal;
    });
    setMobileOpenCards(nextMap);
  };

  const numMonths = Math.max(1, lamaPeriode || 3);
  const monthNamesIndo = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

  const monthLabels: string[] = useMemo(() => {
    if (!periodeAwal) {
      return Array.from({ length: numMonths }, (_, mIdx) => `B${mIdx + 1}`);
    }
    const clean = periodeAwal.replace(/[^0-9]/g, "");
    if (clean.length < 6) {
      return Array.from({ length: numMonths }, (_, mIdx) => `B${mIdx + 1}`);
    }
    const year = parseInt(clean.slice(0, 4), 10);
    const month = parseInt(clean.slice(4, 6), 10); // 1-based
    const startMonths = year * 12 + (month - 1);
    return Array.from({ length: numMonths }, (_, i) => {
      const m = startMonths + i;
      const monthIndex = m % 12;
      return monthNamesIndo[monthIndex] || `B${i + 1}`;
    });
  }, [periodeAwal, numMonths]);

  const monthNamesStr = monthLabels.join("+");

  // Calculate grand totals for table footer (Total Akumulasi Periode)
  let grandTotalQtySwitch = 0;
  let grandTotalEstSalesPeriode = 0;
  let grandTotalNilaiScPeriode = 0;
  let grandTotalPotensi = 0;

  const numMonthsTotal = Math.max(1, lamaPeriode || 3);

  rows.forEach((row) => {
    const masterProduct = masterProducts.find((p) => p.kodeProduk === row.kodeProduk);
    const canvasserProduct = canvasserProducts.find(
      (p) =>
        p.pro_code === row.kodeProduk ||
        p.pro_code?.replace(/^0+/, "") === row.kodeProduk?.replace(/^0+/, "")
    );
    const hnaSJ = masterProduct ? (parseFloat(masterProduct.hna) || 0) : 0;
    const pctMatriks = parseFloat(row.persenMatriksSc) || 0;
    const scVal = canvasserProduct?.sales_counter_value;
    const scMin = canvasserProduct?.sales_counter_minimum != null ? Number(canvasserProduct.sales_counter_minimum) : 0;

    const currentMonthly: string[] = Array.isArray(row.monthlyQty) && row.monthlyQty.length === numMonthsTotal
      ? row.monthlyQty
      : Array.from({ length: numMonthsTotal }, (_, mIdx) => {
          if (Array.isArray(row.monthlyQty) && row.monthlyQty[mIdx] !== undefined) {
            return String(row.monthlyQty[mIdx]);
          }
          return row.qtyPerBulan || "";
        });

    let rowQtyTotal = 0;
    let rowEstSalesTotal = 0;
    let rowNilaiScTotal = 0;

    for (let m = 0; m < numMonthsTotal; m++) {
      const mQty = parseFloat(currentMonthly[m]) || 0;
      const mEstSales = mQty * hnaSJ;
      let mNilaiSc = 0;
      if (scVal != null && scVal > 0) {
        mNilaiSc = mQty >= scMin ? mQty * scVal : 0;
      } else {
        mNilaiSc = mEstSales * (pctMatriks / 100);
      }
      rowQtyTotal += mQty;
      rowEstSalesTotal += mEstSales;
      rowNilaiScTotal += mNilaiSc;
    }

    const rowComps = getCompetitorsForRow(row.kodeProduk);
    const rowPotensi = rowComps.reduce((s, c) => s + c.salesForecast, 0);

    grandTotalQtySwitch += rowQtyTotal;
    grandTotalEstSalesPeriode += rowEstSalesTotal;
    grandTotalNilaiScPeriode += rowNilaiScTotal;
    grandTotalPotensi += rowPotensi;
  });

  const cashbackDetails = calculateCashbackDetails({
    cashbackData,
    selectedProducts: rows,
    masterProducts,
    lamaPeriode,
  });

  const colProdukWidth = "w-[28%] min-w-[250px]";
  const colSwitchWidth = "w-[16%] min-w-[130px]";
  const colEstSalesWidth = "w-[18%] min-w-[145px]";
  const colNilaiScWidth = "w-[18%] min-w-[145px]";
  const colCashbackWidth = "w-[14%] min-w-[115px]";
  const colActionWidth = "w-[6%] min-w-[44px]";
  const tableMinWidth = "min-w-[880px]";

  return (
    <div className="space-y-4">
      {error && <p className="text-xs font-semibold" style={{ color: "var(--color-red)" }}>{error}</p>}

      {isCashbackNotFound && (
        <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
          <svg className="w-4 h-4 shrink-0" style={{ color: "var(--color-text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Outlet Ini Tidak Berpartisipasi Dalam Promosi Cashback</span>
        </div>
      )}

      {/* Mobile Card View (md:hidden) */}
      <div className="md:hidden space-y-3">
        {isLoading ? (
          Array.from({ length: 2 }).map((_, sIdx) => (
            <div key={`mob-skeleton-${sIdx}`} className="p-3.5 rounded-xl border animate-pulse space-y-3" style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
              <div className="flex justify-between items-center gap-2">
                <div className="h-9 bg-slate-200 dark:bg-slate-700 rounded-lg flex-1" />
                <div className="h-9 w-9 bg-slate-200 dark:bg-slate-700 rounded-lg shrink-0" />
              </div>
              <div className="h-16 bg-slate-200 dark:bg-slate-700 rounded w-full" />
              <div className="grid grid-cols-3 gap-2">
                <div className="h-12 bg-slate-200 dark:bg-slate-700 rounded" />
                <div className="h-12 bg-slate-200 dark:bg-slate-700 rounded" />
                <div className="h-12 bg-slate-200 dark:bg-slate-700 rounded" />
              </div>
            </div>
          ))
        ) : rows.length === 0 ? (
          <div className="p-4 rounded-xl border text-center text-xs" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
            Belum ada produk yang ditambahkan. Klik tombol <strong>+ Tambah Produk</strong> di bawah untuk memilih produk.
          </div>
        ) : (
          <>
            {rows.length > 1 && (
              <ProductMobileToolbar
                totalProducts={rows.length}
                allExpanded={areAllMobileExpanded}
                onToggleAll={toggleAllMobileCards}
              />
            )}
            {rows.map((row, idx) => (
              <ProductMobileCard
                key={idx}
                row={row}
                idx={idx}
                readOnly={readOnly}
                masterProducts={masterProducts}
                canvasserProducts={canvasserProducts}
                productsOptions={productsOptions}
                rows={rows}
                onUpdateRow={onUpdateRow}
                onRemoveRow={onRemoveRow}
                setDeleteIndex={setDeleteIndex}
                numMonths={numMonths}
                monthLabels={monthLabels}
                diskonPeriode={diskonPeriode}
                b3RangeLabel={b3RangeLabel}
                historyPeriodRange={historyPeriodRange}
                b1Label={b1Label}
                b2Label={b2Label}
                b3Label={b3Label}
                b3SalesMap={b3SalesMap}
                b3QtyMap={b3QtyMap}
                historySalesMap={historySalesMap}
                historyIncentiveMap={historyIncentiveMap}
                cashbackDetails={cashbackDetails}
                isCashbackNotFound={isCashbackNotFound}
                getCompetitorsForRow={getCompetitorsForRow}
                isExpanded={isMobileCardExpanded(idx)}
                onToggleExpand={() => toggleMobileCard(idx)}
              />
            ))}
          </>
        )}

        {/* Mobile Add Product Button */}
        {!readOnly && (
          <button
            type="button"
            onClick={onAddRow}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl border border-dashed text-xs font-semibold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs hover:bg-[var(--color-bg-subtle)]"
            style={{
              borderColor: "var(--color-border-strong)",
              background: "var(--color-bg)",
              color: "var(--color-blue)",
            }}
          >
            <span className="text-base font-bold">+</span> Tambah Produk
          </button>
        )}

        {/* Mobile Grand Total Summary */}
        {rows.length > 0 && (
          <ProductMobileGrandTotal
            rowCount={rows.length}
            grandTotalEstSalesPeriode={grandTotalEstSalesPeriode}
            grandTotalNilaiScPeriode={grandTotalNilaiScPeriode}
            totalFinalCashback={cashbackDetails.totalFinalCashback}
            isCashbackNotFound={isCashbackNotFound}
            numMonths={numMonths}
          />
        )}
      </div>

      {/* Desktop Main Product Table Container */}
      <div className="hidden md:block overflow-x-auto rounded-lg border shadow-xs" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
        <table className={`w-full text-left text-xs border-collapse ${tableMinWidth}`}>
          <thead className="sticky top-0 z-20 shadow-xs" style={{ background: "var(--color-bg-subtle)" }}>
            <tr style={{ background: "var(--color-bg-subtle)" }}>
              <th
                className={`py-2 pl-3 pr-2 font-semibold text-[11px] text-left border-b rounded-tl-lg ${colProdukWidth}`}
                style={{ color: "var(--color-text-muted)", background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}
              >
                Produk <Req />
              </th>
              <th
                className={`py-2 px-1 font-semibold text-[11px] text-center border-b ${colSwitchWidth}`}
                style={{ color: "var(--color-text-muted)", background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}
              >
                Est. Switch<Req />
              </th>
              <th
                className={`py-2 px-2 font-semibold text-[11px] text-center border-b ${colEstSalesWidth}`}
                style={{ color: "var(--color-text-muted)", background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}
              >
                Est. Sales
              </th>
              <th
                className={`py-2 px-2 font-semibold text-[11px] text-center border-b ${colNilaiScWidth}`}
                style={{ color: "var(--color-text-muted)", background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}
              >
                Est. Insentif
              </th>
              <th
                className={`py-2 px-2 font-semibold text-[11px] text-center border-b ${readOnly ? "rounded-tr-lg" : ""} ${colCashbackWidth}`}
                style={{ color: "var(--color-text-muted)", background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}
              >
                <div className="inline-flex items-center gap-1">
                  <span>Est. Cashback</span>
                  <InfoTooltip text="Nilai Cashback akan diterima oleh outlet jika belanja lewat Pharmanet" />
                </div>
              </th>
              {!readOnly && (
                <th
                  className={`py-2 px-1 text-center font-semibold text-[11px] border-b rounded-tr-lg ${colActionWidth}`}
                  style={{ color: "var(--color-text-muted)", background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}
                >
                  Aksi
                </th>
              )}
            </tr>
          </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, sIdx) => (
                  <tr key={`skeleton-${sIdx}`} className="animate-pulse">
                    <td className="py-3 pl-4 pr-2.5">
                      <div className="h-7 bg-slate-200 dark:bg-slate-700/50 rounded w-full mb-1.5" />
                      <div className="h-3 bg-slate-200 dark:bg-slate-700/50 rounded w-2/3" />
                    </td>
                    <td className="py-3 px-1 text-center">
                      <div className="h-6 bg-slate-200 dark:bg-slate-700/50 rounded w-full" />
                    </td>
                    <td className="py-3 px-1 text-center">
                      <div className="h-5 bg-slate-200 dark:bg-slate-700/50 rounded w-3/4 mx-auto" />
                    </td>
                    <td className="py-3 px-1.5 text-center">
                      <div className="h-5 bg-slate-200 dark:bg-slate-700/50 rounded w-4/5 mx-auto mb-1" />
                      <div className="h-3 bg-slate-200 dark:bg-slate-700/50 rounded w-1/2 mx-auto" />
                    </td>
                    <td className="py-3 px-1.5 text-center">
                      <div className="h-5 bg-slate-200 dark:bg-slate-700/50 rounded w-4/5 mx-auto mb-1" />
                      <div className="h-3 bg-slate-200 dark:bg-slate-700/50 rounded w-3/5 mx-auto" />
                    </td>
                    {!readOnly && (
                      <td className="py-3 px-2 text-center">
                        <div className="h-6 w-6 bg-slate-200 dark:bg-slate-700/50 rounded mx-auto" />
                      </td>
                    )}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={readOnly ? 5 : 6} className="py-6 text-center text-xs" style={{ color: "var(--color-text-muted)" }}>
                    Belum ada produk yang ditambahkan. Klik tombol <strong>+ Tambah Produk</strong> di bawah untuk memilih produk.
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => {
                  const masterProduct = masterProducts.find((p) => p.kodeProduk === row.kodeProduk);
                  const canvasserProduct = canvasserProducts.find(
                    (p) =>
                      p.pro_code === row.kodeProduk ||
                      p.pro_code?.replace(/^0+/, "") === row.kodeProduk?.replace(/^0+/, "")
                  );

                  const hnaSJ = masterProduct ? (parseFloat(masterProduct.hna) || 0) : 0;
                  const numMonths = Math.max(1, lamaPeriode || 3);
                  const currentMonthly: string[] = Array.isArray(row.monthlyQty) && row.monthlyQty.length === numMonths
                    ? row.monthlyQty.map((val) => String(val).replace(/^0+(?=\d)/, ""))
                    : Array.from({ length: numMonths }, (_, mIdx) => {
                        if (Array.isArray(row.monthlyQty) && row.monthlyQty[mIdx] !== undefined) {
                          return String(row.monthlyQty[mIdx]).replace(/^0+(?=\d)/, "");
                        }
                        return row.qtyPerBulan ? String(row.qtyPerBulan).replace(/^0+(?=\d)/, "") : "0";
                      });

                  let totalQtySwitch = 0;
                  let hasAnyMonthlyVal = false;
                  for (const v of currentMonthly) {
                    if (v !== "" && !isNaN(parseFloat(v))) {
                      totalQtySwitch += parseFloat(v);
                      hasAnyMonthlyVal = true;
                    }
                  }

                  const effectiveQtyUb = hasAnyMonthlyVal
                    ? (numMonths > 0 ? totalQtySwitch / numMonths : 0)
                    : (parseFloat(row.qtyPerBulan) || 0);

                  const qtyUb = effectiveQtyUb;
                  const estSalesBln = qtyUb * hnaSJ;
                  const pctMatriks = parseFloat(row.persenMatriksSc) || 0;

                  const scVal = canvasserProduct?.sales_counter_value;
                  const scMin = canvasserProduct?.sales_counter_minimum != null ? Number(canvasserProduct.sales_counter_minimum) : 0;
                  const targetSellInBln = scMin * hnaSJ;

                  const monthlyEstSales = Array.from({ length: numMonths }, (_, mIdx) => {
                    const mQty = parseFloat(currentMonthly[mIdx]) || 0;
                    return mQty * hnaSJ;
                  });

                  const underTargetMonths = Array.from({ length: numMonths }, (_, mIdx) => {
                    const mSales = monthlyEstSales[mIdx];
                    return targetSellInBln > 0 && mSales < targetSellInBln ? monthLabels[mIdx] : null;
                  }).filter(Boolean) as string[];

                  const isUnderTarget = targetSellInBln > 0 && estSalesBln < targetSellInBln;
                  const isAboveOrEqualTarget = !isUnderTarget;

                  let nilaiScBln = 0;
                  if (scVal != null && scVal > 0) {
                    nilaiScBln = qtyUb >= scMin ? qtyUb * scVal : 0;
                  } else {
                    nilaiScBln = estSalesBln * (pctMatriks / 100);
                  }

                  return (
                    <tr key={idx} id={row.kodeProduk ? `sc-product-row-${row.kodeProduk}` : `sc-product-row-index-${idx}`} className="align-top hover:bg-[var(--color-bg-subtle)] transition-colors">
                      {/* Column 1: Product Selection, Competitor & Potensi */}
                      <td className={`py-2.5 pl-4 pr-2.5 space-y-2 ${colProdukWidth}`}>
                        <Combobox
                          name={`product-${idx}`}
                          options={productsOptions.filter((option: any) => {
                            const optionCode = option.value || option.kodeProduk;
                            if (optionCode === row.kodeProduk) {
                              return true;
                            }
                            return !rows.some(
                              (otherRow, otherIdx) =>
                                otherIdx !== idx &&
                                otherRow.kodeProduk === optionCode
                            );
                          })}
                          value={row.kodeProduk}
                          onChange={(val) => {
                            const comps = getCompetitorsForRow(val);
                            const compNames = comps.map((c) => c.namaKompetitor).join(", ");
                            onUpdateRow(idx, {
                              kodeProduk: val,
                              ...(compNames ? { produkKompetitor: compNames } : {}),
                            });
                          }}
                          disabled={readOnly}
                          placeholder="Cari produk..."
                          emptyMessage="Tidak ada produk."
                        />
                        {row.kodeProduk && (
                          <div className="text-[11px] leading-tight space-y-0.5" style={{ color: "var(--color-text-muted)" }}>
                            {masterProduct && (
                              <>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span>{formatHnaLabel(masterProduct)}: <strong style={{ color: "var(--color-text)" }}>Rp {formatRp(masterProduct.hna)}</strong></span>
                                </div>
                                {masterProduct.zatAktif && (
                                  <div className="truncate text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                                    Zat: {masterProduct.zatAktif}
                                  </div>
                                )}
                              </>
                            )}
                            <div
                              className="pt-1 pb-1.5 mt-1 border-t border-dashed flex items-center justify-between gap-2 flex-wrap"
                              style={{ borderColor: "var(--color-border)" }}
                            >
                              <div className="flex items-center gap-1.5 text-[11px] leading-tight">
                                <span className="font-bold" style={{ color: "var(--color-text-muted)" }}>
                                  Diskon:
                                </span>
                                <span className="font-bold text-xs" style={{ color: "var(--color-text)" }}>
                                  {row.persenDiskon ? `${row.persenDiskon}%` : (diskonPeriode ? `${diskonPeriode}%` : "-")}
                                </span>
                              </div>
                              {underTargetMonths.length > 0 && (
                                <span
                                  className="text-[10px] leading-tight font-semibold px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0"
                                  style={{
                                    color: "var(--color-red, #dc2626)",
                                    background: "rgba(239, 68, 68, 0.1)",
                                    border: "1px solid rgba(239, 68, 68, 0.25)",
                                  }}
                                  title={`Di bawah target sell-in: ${underTargetMonths.join(", ")}`}
                                >
                                  <span className="text-xs leading-none">⚠</span>
                                  <span>Di bawah target: {underTargetMonths.join(", ")}</span>
                                </span>
                              )}
                            </div>
                            {/* Potensi dipindahkan ke bawah Zat dengan garis pembatas */}
                            {(() => {
                              const comps = getCompetitorsForRow(row.kodeProduk);
                              const totalPotensi = comps.reduce((sum, c) => sum + c.salesForecast, 0);
                              const hasMoreThan4 = comps.length > 4;
                              const visibleComps = hasMoreThan4 ? comps.slice(0, 4) : comps;
                              const otherComps = hasMoreThan4 ? comps.slice(4) : [];
                              const qtyOthers = otherComps.reduce((sum, c) => sum + c.salesForecast, 0);

                              return (
                                <div className="pt-1.5 mt-0 border-t border-dashed" style={{ borderColor: "var(--color-border)" }}>
                                  <div className="flex items-center gap-1.5 text-[11px] leading-tight">
                                    <span className="font-semibold" style={{ color: "var(--color-text-muted)" }}>
                                      Potensi:
                                    </span>
                                    <span className="font-bold text-xs" style={{ color: "var(--color-text)" }}>
                                      {totalPotensi}
                                    </span>
                                  </div>
                                  {comps.length > 0 && (
                                    <div className="text-[10px] space-y-0.5 mt-1" style={{ color: "var(--color-text-muted)" }}>
                                      {visibleComps.map((comp, cIdx) => (
                                        <div
                                          key={cIdx}
                                          className="flex items-center gap-1 text-[10px] min-w-0"
                                          title={`${comp.namaKompetitor}: ${comp.salesForecast}`}
                                        >
                                          <span className="truncate text-left" style={{ color: "var(--color-text-muted)" }}>
                                            {comp.namaKompetitor}:
                                          </span>
                                          <strong className="shrink-0" style={{ color: "var(--color-text)" }}>
                                            {comp.salesForecast}
                                          </strong>
                                        </div>
                                      ))}
                                      {hasMoreThan4 && (
                                        <div
                                          className="flex items-center gap-1 text-[10px] min-w-0"
                                          title={otherComps.map((c) => `${c.namaKompetitor}: ${c.salesForecast}`).join(", ")}
                                        >
                                          <span className="truncate text-left" style={{ color: "var(--color-text-muted)" }}>
                                            lainnya:
                                          </span>
                                          <strong className="shrink-0" style={{ color: "var(--color-text)" }}>
                                            {qtyOthers}
                                          </strong>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </td>

                      {/* Column 3: Quantity Input per Bulan (Estimasi Switching / UB) */}
                      <td className="py-2.5 px-1 text-center align-top">
                        {(() => {
                          const handleMonthChange = (mIdx: number, newVal: string) => {
                            const cleanVal = newVal === "" ? "" : newVal.replace(/^0+(?=\d)/, "");
                            const nextMonthly = [...currentMonthly];
                            nextMonthly[mIdx] = cleanVal;

                            let totalQty = 0;
                            let hasAnyValue = false;
                            for (const v of nextMonthly) {
                              if (v !== "" && !isNaN(parseFloat(v))) {
                                totalQty += parseFloat(v);
                                hasAnyValue = true;
                              }
                            }
                            const avgQty = numMonths > 0 ? totalQty / numMonths : 0;
                            const formattedAvg = hasAnyValue
                              ? (avgQty % 1 === 0 ? avgQty.toString() : parseFloat(avgQty.toFixed(2)).toString())
                              : "";

                            onUpdateRow(idx, {
                              monthlyQty: nextMonthly,
                              qtyPerBulan: formattedAvg,
                            });
                          };

                          const unitStr = satuanLabel(masterProduct);

                          let totalQtySwitch = 0;
                          for (const v of currentMonthly) {
                            if (v !== "" && !isNaN(parseFloat(v))) {
                              totalQtySwitch += parseFloat(v);
                            }
                          }

                          const cleanKode = (row.kodeProduk || "").trim();
                          const historyData = historySalesMap.get(cleanKode) ?? historySalesMap.get(cleanKode.replace(/^0+/, ""));
                          const rawB3Sales = b3SalesMap?.get(cleanKode) ?? b3SalesMap?.get(cleanKode.replace(/^0+/, "")) ?? 0;
                          const b1 = Number(historyData?.sales_b1) || 0;
                          const b2 = Number(historyData?.sales_b2) || 0;
                          const b3 = Number(historyData?.sales_b3) || 0;
                          const totalQtyB3 = b1 + b2 + b3;
                          const avgQtyB3 = historyData ? (totalQtyB3 / 3) : 0;
                          const postB3Qty = b3QtyMap?.get(cleanKode) ?? b3QtyMap?.get(cleanKode.replace(/^0+/, ""));
                          const historyDisplayVal = postB3Qty != null ? postB3Qty : (avgQtyB3 || 0);

                          const formatHistoryValue = (value: number) => {
                            if (!value) return "0";
                            return value % 1 === 0
                              ? value.toString()
                              : (Math.round(value * 10) / 10).toString();
                          };

                          const periodLabel = b3RangeLabel || historyPeriodRange || "B3";

                          return (
                            <div>
                              {/* Top Card: Total Est Switch with bottom border */}
                              <div
                                className="-mx-1 px-1 h-[38px] flex flex-col justify-center border-b border-solid"
                                style={{ borderColor: "var(--color-border-strong, #B8AF9E)" }}
                              >
                                <div
                                  className="w-full h-[32px] rounded-md px-1.5 flex flex-col items-center justify-center text-center gap-0.5"
                                  style={{
                                    border: "1px solid var(--color-blue-light, #c8e1f5)",
                                    background: "var(--color-blue-light, #E6F0F8)",
                                  }}
                                >
                                  <div className="text-[9px] font-semibold tracking-wider uppercase leading-none" style={{ color: "var(--color-text-muted)" }}>
                                    TOTAL EST. SWITCH
                                  </div>
                                  <div className="text-xs font-bold leading-none" style={{ color: "var(--color-blue)" }}>
                                    {totalQtySwitch} {unitStr}
                                  </div>
                                </div>
                              </div>

                              {/* Input per bulan (Sep, Okt, Nov, ...) */}
                              <div>
                                {Array.from({ length: numMonths }, (_, mIdx) => (
                                  <div
                                    key={mIdx}
                                    className="-mx-1 px-1 h-[36px] flex items-center gap-1.5 border-b border-solid"
                                    style={{ borderColor: "var(--color-border-strong, #B8AF9E)" }}
                                  >
                                    <span
                                      className="text-[11px] font-medium w-7 shrink-0 text-left select-none"
                                      style={{ color: "var(--color-text-muted)" }}
                                    >
                                      {monthLabels[mIdx]}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                      <UnitInput
                                        value={currentMonthly[mIdx] ?? ""}
                                        onChange={(val) => handleMonthChange(mIdx, val)}
                                        unit={unitStr}
                                        placeholder="0"
                                        disabled={readOnly}
                                        className="h-[28px]"
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>

                              {/* Bottom: Avg. History & Sales */}
                              {row.kodeProduk && (
                                <div className="pt-1.5 flex items-center justify-start text-[10px]">
                                  <InfoTooltip
                                    align="left"
                                    trigger={
                                      <span
                                        className="inline-flex items-center gap-1 hover:underline font-medium text-[10px] cursor-pointer leading-tight"
                                        style={{ color: "var(--color-text-muted)" }}
                                      >
                                        <span>Avg. History & Sales</span>
                                        <span
                                          className="w-3.5 h-3.5 text-[9px] inline-flex items-center justify-center rounded-full font-bold border shrink-0"
                                          style={{
                                            borderColor: "var(--color-border)",
                                            background: "var(--color-bg)",
                                            color: "var(--color-text-muted)",
                                          }}
                                        >
                                          i
                                        </span>
                                      </span>
                                    }
                                    content={
                                      <div className="space-y-1 text-xs">
                                        <div className="flex justify-between items-center gap-3 border-b border-slate-700/80 pb-1">
                                          <span className="font-semibold text-white">Avg. History & Sales</span>
                                          <span className="text-slate-300 text-[10px]">({periodLabel})</span>
                                        </div>
                                        <div className="flex justify-between items-center gap-3 pt-0.5">
                                          <span className="text-slate-300">Avg. History ({periodLabel}):</span>
                                          <strong className="text-white font-semibold">
                                            {formatHistoryValue(historyDisplayVal)}
                                          </strong>
                                        </div>
                                        <div className="flex justify-between items-center gap-3">
                                          <span className="text-slate-300">Sales {b1Label}:</span>
                                          <strong className="text-white font-semibold">
                                            {formatHistoryValue(b1)}
                                          </strong>
                                        </div>
                                        <div className="flex justify-between items-center gap-3">
                                          <span className="text-slate-300">Sales {b2Label}:</span>
                                          <strong className="text-white font-semibold">
                                            {formatHistoryValue(b2)}
                                          </strong>
                                        </div>
                                        <div className="flex justify-between items-center gap-3">
                                          <span className="text-slate-300">Sales {b3Label}:</span>
                                          <strong className="text-white font-semibold">
                                            {formatHistoryValue(b3)}
                                          </strong>
                                        </div>
                                      </div>
                                    }
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </td>

                      {/* Column 4: Est Sales per Bulan */}
                      <td className={`py-2.5 px-2 text-left align-top ${colEstSalesWidth}`}>
                        {(() => {
                          const historyData = historySalesMap.get(row.kodeProduk);
                          const rawB3Sales = b3SalesMap?.get(row.kodeProduk) ?? 0;

                          const b1 = Number(historyData?.sales_b1) || 0;
                          const b2 = Number(historyData?.sales_b2) || 0;
                          const b3 = Number(historyData?.sales_b3) || 0;
                          const totalQtyB3 = b1 + b2 + b3;
                          const avgQtyB3 = historyData ? (totalQtyB3 / 3) : 0;

                          let avgSalesBln = 0;
                          if (historyData != null && hnaSJ > 0) {
                            avgSalesBln = avgQtyB3 * hnaSJ;
                          } else if (rawB3Sales > 0) {
                            avgSalesBln = rawB3Sales;
                          }

                          const monthlyEstSales = Array.from({ length: numMonths }, (_, mIdx) => {
                            const mQty = parseFloat(currentMonthly[mIdx]) || 0;
                            return mQty * hnaSJ;
                          });

                          const totalEstSalesPeriode = monthlyEstSales.reduce((s, v) => s + v, 0);
                          const avgEstSalesBln = numMonths > 0 ? (totalEstSalesPeriode / numMonths) : estSalesBln;

                          const overallGrowthPct = avgSalesBln > 0
                            ? ((avgEstSalesBln - avgSalesBln) / avgSalesBln) * 100
                            : null;

                          return (
                            <div>
                              {/* Header: Rp Total & Growth with bottom border */}
                              <div
                                className="-mx-2 px-2 h-[38px] flex flex-col justify-center leading-none space-y-0.5 text-center border-b border-solid"
                                style={{ borderColor: "var(--color-border-strong, #B8AF9E)" }}
                              >
                                <div
                                  className="text-sm font-extrabold whitespace-nowrap leading-none"
                                  style={{ color: "var(--color-text)" }}
                                >
                                  Rp {formatRp(totalEstSalesPeriode)}
                                </div>
                                <div className="flex items-center gap-1 leading-none text-[10px] justify-center">
                                  <span className="font-semibold" style={{ color: "var(--color-green)" }}>Growth:</span>
                                  {overallGrowthPct != null ? (
                                    <span
                                      className="font-bold leading-none whitespace-nowrap text-[11px]"
                                      style={{ color: overallGrowthPct >= 0 ? "var(--color-green)" : "var(--color-red)" }}
                                    >
                                      {overallGrowthPct >= 0 ? "+" : ""}{overallGrowthPct.toFixed(1)}%
                                    </span>
                                  ) : (
                                    <span
                                      className="text-[9px] font-semibold px-1 rounded border leading-none whitespace-nowrap"
                                      style={{
                                        color: "var(--color-green)",
                                        borderColor: "var(--color-green)",
                                        background: "var(--color-green-light)",
                                      }}
                                    >
                                      Baru
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Monthly breakdown */}
                              <div>
                                {Array.from({ length: numMonths }, (_, mIdx) => (
                                  <div
                                    key={mIdx}
                                    className="-mx-2 px-2 h-[36px] flex items-center border-b border-solid whitespace-nowrap justify-center"
                                    style={{ borderColor: "var(--color-border-strong, #B8AF9E)" }}
                                  >
                                    <span className="font-bold text-[13px] whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                                      Rp {formatRp(monthlyEstSales[mIdx])}
                                    </span>
                                  </div>
                                ))}
                              </div>

                              {/* Bottom: Rincian Estimasi Sales (seperti Avg. History & Sales pada Est. Switch) */}
                              {row.kodeProduk && (
                                <div className="pt-1.5 flex items-center text-[10px] justify-center">
                                  <InfoTooltip
                                    align="left"
                                    width={290}
                                    trigger={
                                      <span
                                        className="inline-flex items-center gap-1 hover:underline font-medium text-[10px] cursor-pointer leading-tight whitespace-nowrap"
                                        style={{ color: "var(--color-text-muted)" }}
                                      >
                                        <span>Rincian Est. Sales</span>
                                        <span
                                          className="w-3.5 h-3.5 text-[9px] inline-flex items-center justify-center rounded-full font-bold border shrink-0"
                                          style={{
                                            borderColor: "var(--color-border)",
                                            background: "var(--color-bg)",
                                            color: "var(--color-text-muted)",
                                          }}
                                        >
                                          i
                                        </span>
                                      </span>
                                    }
                                    content={
                                      <div className="space-y-2 text-xs">
                                        <div className="font-semibold text-white border-b border-slate-700/80 pb-1 flex items-center justify-between gap-2">
                                          <span>Rincian Estimasi Sales</span>
                                          <span className="text-slate-300 text-[10px]">({numMonths} Bulan)</span>
                                        </div>
                                        <div className="space-y-1 text-[11px]">
                                          <div className="flex justify-between items-center gap-3">
                                            <span className="text-slate-300">Total Periode:</span>
                                            <strong className="text-white font-semibold whitespace-nowrap">
                                              Rp {formatRp(totalEstSalesPeriode)}
                                            </strong>
                                          </div>
                                          <div className="flex justify-between items-center gap-3 text-slate-400 text-[10px]">
                                            <span>Hitungan Total:</span>
                                            <span className="whitespace-nowrap font-mono">
                                              {totalQtySwitch} UB × Rp {formatRp(hnaSJ)}
                                            </span>
                                          </div>
                                          <div className="flex justify-between items-center gap-3">
                                            <span className="text-slate-300">Rata-rata / Bulan:</span>
                                            <strong className="text-white font-semibold whitespace-nowrap">
                                              Rp {formatRp(avgEstSalesBln)}
                                            </strong>
                                          </div>
                                          {targetSellInBln > 0 && (
                                            <div className="flex justify-between items-center gap-3">
                                              <span className="text-slate-300">Target Sell-in / bln:</span>
                                              <strong className="text-white font-semibold whitespace-nowrap">
                                                Rp {formatRp(targetSellInBln)}
                                              </strong>
                                            </div>
                                          )}
                                          {avgSalesBln > 0 && (
                                            <div className="flex justify-between items-center gap-3">
                                              <span className="text-slate-300">Rata-rata Historis B3:</span>
                                              <strong className="text-white font-semibold whitespace-nowrap">
                                                Rp {formatRp(avgSalesBln)}
                                              </strong>
                                            </div>
                                          )}
                                          {overallGrowthPct != null && (
                                            <div className="flex justify-between items-center gap-3">
                                              <span className="text-slate-300">Total Growth vs Historis:</span>
                                              <strong
                                                className="font-semibold whitespace-nowrap"
                                                style={{ color: overallGrowthPct >= 0 ? "#4ade80" : "#f87171" }}
                                              >
                                                {overallGrowthPct >= 0 ? "+" : ""}{overallGrowthPct.toFixed(1)}%
                                              </strong>
                                            </div>
                                          )}
                                        </div>

                                        {/* Growth per Bulan */}
                                        <div className="pt-1.5 border-t border-slate-700/80 space-y-1">
                                          <div className="text-[10px] font-semibold text-slate-300 uppercase tracking-wider">
                                            Growth per Bulan:
                                          </div>
                                          <div className="space-y-1 text-[11px]">
                                            {Array.from({ length: numMonths }, (_, mIdx) => {
                                              const mQty = parseFloat(currentMonthly[mIdx]) || 0;
                                              const mSales = monthlyEstSales[mIdx];
                                              const mGrowthPct = avgSalesBln > 0
                                                ? ((mSales - avgSalesBln) / avgSalesBln) * 100
                                                : null;

                                              const isMonthUnderTarget = targetSellInBln > 0 && mSales < targetSellInBln;

                                              return (
                                                <div
                                                  key={mIdx}
                                                  className="flex items-center justify-between gap-2 bg-slate-800/70 px-2 py-1 rounded border border-slate-700/40"
                                                >
                                                  <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span className="w-7 font-semibold text-slate-200">{monthLabels[mIdx]}</span>
                                                    <span className="text-white font-medium whitespace-nowrap">
                                                      Rp {formatRp(mSales)}
                                                    </span>
                                                    <span className="text-slate-400 text-[10px]">({mQty} UB)</span>
                                                    {isMonthUnderTarget && (
                                                      <span className="text-[9px] text-red-400 font-semibold flex items-center gap-0.5">
                                                        <span>⚠</span>
                                                        <span>&lt; target</span>
                                                      </span>
                                                    )}
                                                  </div>
                                                  <div className="text-right whitespace-nowrap">
                                                    {mGrowthPct != null ? (
                                                      <span
                                                        className="font-bold text-[10px] px-1 py-0.5 rounded"
                                                        style={{
                                                          color: mGrowthPct >= 0 ? "#4ade80" : "#f87171",
                                                          background: mGrowthPct >= 0 ? "rgba(74, 222, 128, 0.12)" : "rgba(248, 113, 113, 0.12)",
                                                        }}
                                                      >
                                                        {mGrowthPct >= 0 ? "+" : ""}{mGrowthPct.toFixed(1)}%
                                                      </span>
                                                    ) : (
                                                      <span className="text-[9px] text-emerald-400 font-semibold px-1 py-0.5 rounded bg-emerald-950/40">
                                                        Baru
                                                      </span>
                                                    )}
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>

                                        {targetSellInBln > 0 && (
                                          <div className="flex justify-between items-center gap-3 pt-1 border-t border-slate-700/80 text-[11px]">
                                            <span className="text-slate-300">Target {numMonths} Bulan:</span>
                                            <strong className="text-white font-semibold whitespace-nowrap">
                                              Rp {formatRp(targetSellInBln * numMonths)}
                                            </strong>
                                          </div>
                                        )}
                                      </div>
                                    }
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </td>

                      {/* Column 5: Nilai SC / Bln (Est. Insentif) */}
                      <td className={`py-2.5 px-2 text-left align-top ${colNilaiScWidth}`}>
                        {(() => {
                          const historyData = historySalesMap.get(row.kodeProduk);
                          const rawB3Sales = b3SalesMap?.get(row.kodeProduk) ?? 0;
                          const b1 = Number(historyData?.sales_b1) || 0;
                          const b2 = Number(historyData?.sales_b2) || 0;
                          const b3 = Number(historyData?.sales_b3) || 0;
                          const totalQtyB3 = b1 + b2 + b3;
                          const avgQtyB3 = historyData ? (totalQtyB3 / 3) : 0;

                          let avgSalesBln = 0;
                          if (historyData != null && hnaSJ > 0) {
                            avgSalesBln = avgQtyB3 * hnaSJ;
                          } else if (rawB3Sales > 0) {
                            avgSalesBln = rawB3Sales;
                          }

                          const monthlyNilaiSc = Array.from({ length: numMonths }, (_, mIdx) => {
                            const mQty = parseFloat(currentMonthly[mIdx]) || 0;
                            const mEstSales = mQty * hnaSJ;
                            if (scVal != null && scVal > 0) {
                              return mQty >= scMin ? mQty * scVal : 0;
                            }
                            return mEstSales * (pctMatriks / 100);
                          });

                          const totalNilaiScPeriode = monthlyNilaiSc.reduce((s, v) => s + v, 0);
                          const avgNilaiScBln = numMonths > 0 ? (totalNilaiScPeriode / numMonths) : 0;

                          // Lookup win_incentive strictly from get-history-incentive-sales-counter API (no fallback)
                          const code = String(row.kodeProduk || "").trim();
                          const strippedCode = code.replace(/^0+/, "");
                          const historyIncentiveEntry = historyIncentiveMap.get(code) || (strippedCode ? historyIncentiveMap.get(strippedCode) : undefined);

                          const historyIncentiveVal = historyIncentiveEntry != null
                            ? Number(historyIncentiveEntry.win_incentive) || 0
                            : 0;

                          const overallGrowthPct = historyIncentiveVal > 0
                            ? ((avgNilaiScBln - historyIncentiveVal) / historyIncentiveVal) * 100
                            : null;

                          return (
                            <div>
                              {/* Header: Rp Total & Growth with bottom border */}
                              <div
                                className="-mx-2 px-2 h-[38px] flex flex-col justify-center leading-none space-y-0.5 text-center border-b border-solid"
                                style={{ borderColor: "var(--color-border-strong, #B8AF9E)" }}
                              >
                                <div
                                  className="text-sm font-extrabold whitespace-nowrap leading-none"
                                  style={{ color: "var(--color-blue)" }}
                                >
                                  Rp {formatRp(totalNilaiScPeriode)}
                                </div>
                                <div className="flex items-center gap-1 leading-none text-[10px] justify-center">
                                  <span className="font-semibold" style={{ color: "var(--color-green)" }}>Growth:</span>
                                  {overallGrowthPct != null ? (
                                    <span
                                      className="font-bold leading-none whitespace-nowrap text-[11px]"
                                      style={{ color: overallGrowthPct >= 0 ? "var(--color-green)" : "var(--color-red)" }}
                                    >
                                      {overallGrowthPct >= 0 ? "+" : ""}{overallGrowthPct.toFixed(1)}%
                                    </span>
                                  ) : (
                                    <span
                                      className="text-[9px] font-semibold px-1 rounded border leading-none whitespace-nowrap"
                                      style={{
                                        color: "var(--color-green)",
                                        borderColor: "var(--color-green)",
                                        background: "var(--color-green-light)",
                                      }}
                                    >
                                      Baru
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Monthly breakdown */}
                              <div>
                                {Array.from({ length: numMonths }, (_, mIdx) => (
                                  <div
                                    key={mIdx}
                                    className="-mx-2 px-2 h-[36px] flex items-center border-b border-solid whitespace-nowrap justify-center"
                                    style={{ borderColor: "var(--color-border-strong, #B8AF9E)" }}
                                  >
                                    <span className="font-bold text-[13px] whitespace-nowrap" style={{ color: "var(--color-blue)" }}>
                                      Rp {formatRp(monthlyNilaiSc[mIdx])}
                                    </span>
                                  </div>
                                ))}
                              </div>

                              {/* Bottom: Rincian Estimasi Insentif (seperti Avg. History & Sales pada Est. Switch) */}
                              {row.kodeProduk && (
                                <div className="pt-1.5 flex items-center text-[10px] justify-center">
                                  <InfoTooltip
                                    align="left"
                                    width={290}
                                    trigger={
                                      <span
                                        className="inline-flex items-center gap-1 hover:underline font-medium text-[10px] cursor-pointer leading-tight whitespace-nowrap"
                                        style={{ color: "var(--color-text-muted)" }}
                                      >
                                        <span>Rincian Est. Insentif</span>
                                        <span
                                          className="w-3.5 h-3.5 text-[9px] inline-flex items-center justify-center rounded-full font-bold border shrink-0"
                                          style={{
                                            borderColor: "var(--color-border)",
                                            background: "var(--color-bg)",
                                            color: "var(--color-text-muted)",
                                          }}
                                        >
                                          i
                                        </span>
                                      </span>
                                    }
                                    content={
                                      <div className="space-y-2 text-xs">
                                        <div className="font-semibold text-white border-b border-slate-700/80 pb-1 flex items-center justify-between gap-2">
                                          <span>Rincian Estimasi Insentif</span>
                                          <span className="text-slate-300 text-[10px]">({numMonths} Bulan)</span>
                                        </div>
                                        <div className="space-y-1 text-[11px]">
                                          <div className="flex justify-between items-center gap-3">
                                            <span className="text-slate-300">Total Periode:</span>
                                            <strong className="text-white font-semibold whitespace-nowrap">
                                              Rp {formatRp(totalNilaiScPeriode)}
                                            </strong>
                                          </div>
                                          <div className="flex justify-between items-center gap-3 text-slate-400 text-[10px]">
                                            <span>Skema:</span>
                                            <span className="whitespace-nowrap font-mono">
                                              {scVal != null && scVal > 0
                                                ? `Rp ${formatRp(scVal)} / UB (Min ${scMin})`
                                                : `${pctMatriks}% Matriks`}
                                            </span>
                                          </div>
                                          <div className="flex justify-between items-center gap-3">
                                            <span className="text-slate-300">Rata-rata / Bulan:</span>
                                            <strong className="text-white font-semibold whitespace-nowrap">
                                              Rp {formatRp(avgNilaiScBln)}
                                            </strong>
                                          </div>
                                          <div className="flex justify-between items-center gap-3">
                                            <span className="text-slate-300">Historis Insentif:</span>
                                            <strong className="text-white font-semibold whitespace-nowrap">
                                              {historyIncentiveVal > 0 ? (
                                                <>
                                                  Rp {formatRp(historyIncentiveVal)}
                                                  {historyIncentiveEntry?.win_qty != null && historyIncentiveEntry.win_qty > 0
                                                    ? ` (${historyIncentiveEntry.win_qty} UB)`
                                                    : ""}
                                                </>
                                              ) : (
                                                <span className="text-slate-400 font-normal">-</span>
                                              )}
                                            </strong>
                                          </div>
                                          {overallGrowthPct != null && (
                                            <div className="flex justify-between items-center gap-3">
                                              <span className="text-slate-300">Total Growth vs Historis:</span>
                                              <strong
                                                className="font-semibold whitespace-nowrap"
                                                style={{ color: overallGrowthPct >= 0 ? "#4ade80" : "#f87171" }}
                                              >
                                                {overallGrowthPct >= 0 ? "+" : ""}{overallGrowthPct.toFixed(1)}%
                                              </strong>
                                            </div>
                                          )}
                                        </div>

                                        {/* Growth per Bulan */}
                                        <div className="pt-1.5 border-t border-slate-700/80 space-y-1">
                                          <div className="text-[10px] font-semibold text-slate-300 uppercase tracking-wider">
                                            Growth Insentif per Bulan:
                                          </div>
                                          <div className="space-y-1 text-[11px]">
                                            {Array.from({ length: numMonths }, (_, mIdx) => {
                                              const mQty = parseFloat(currentMonthly[mIdx]) || 0;
                                              const mIns = monthlyNilaiSc[mIdx];
                                              const mGrowthPct = historyIncentiveVal > 0
                                                ? ((mIns - historyIncentiveVal) / historyIncentiveVal) * 100
                                                : null;

                                              return (
                                                <div
                                                  key={mIdx}
                                                  className="flex items-center justify-between gap-2 bg-slate-800/70 px-2 py-1 rounded border border-slate-700/40"
                                                >
                                                  <div className="flex items-center gap-1.5">
                                                    <span className="w-7 font-semibold text-slate-200">{monthLabels[mIdx]}</span>
                                                    <span className="text-white font-medium whitespace-nowrap">
                                                      Rp {formatRp(mIns)}
                                                    </span>
                                                    <span className="text-slate-400 text-[10px]">({mQty} UB)</span>
                                                  </div>
                                                  <div className="text-right whitespace-nowrap">
                                                    {mGrowthPct != null ? (
                                                      <span
                                                        className="font-bold text-[10px] px-1 py-0.5 rounded"
                                                        style={{
                                                          color: mGrowthPct >= 0 ? "#4ade80" : "#f87171",
                                                          background: mGrowthPct >= 0 ? "rgba(74, 222, 128, 0.12)" : "rgba(248, 113, 113, 0.12)",
                                                        }}
                                                      >
                                                        {mGrowthPct >= 0 ? "+" : ""}{mGrowthPct.toFixed(1)}%
                                                      </span>
                                                    ) : (
                                                      <span className="text-[9px] text-emerald-400 font-semibold px-1 py-0.5 rounded bg-emerald-950/40">
                                                        Baru
                                                      </span>
                                                    )}
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      </div>
                                    }
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </td>

                      {/* Column 6: Nilai Cashback / Bln */}
                      <td className="py-2.5 px-2 text-center align-top">
                        {isCashbackNotFound ? (
                          <div
                            className="-mx-2 px-2 h-[38px] flex items-center justify-center border-b border-solid"
                            style={{
                              borderColor: "var(--color-border-strong, #B8AF9E)",
                            }}
                          >
                            <div
                              className="text-sm font-medium"
                              style={{ color: "var(--color-text-muted)" }}
                            >
                              -
                            </div>
                          </div>
                        ) : (
                          (() => {
                            const cbMonthly = cashbackDetails.monthlyResultMap.get(row.kodeProduk) ?? 0;
                            const isEligible = cashbackDetails.itemEligibilityMap?.get(row.kodeProduk) ?? false;
                            const rawCbPct = parseFloat(String(row.persenCashback || "0")) || 0;
                            const displayPct = isEligible && cbMonthly > 0 ? rawCbPct : 0;

                            const monthlyCashback = cashbackDetails.monthlyBreakdownMap?.get(row.kodeProduk) ??
                              Array(numMonths).fill(0);

                            const totalCashbackPeriode = cashbackDetails.resultMap.get(row.kodeProduk) ??
                              monthlyCashback.reduce((s: number, v: number) => s + v, 0);

                            return (
                              <div>
                                {/* Total Cashback with bottom border */}
                                <div
                                  className="-mx-2 px-2 h-[38px] flex flex-col justify-center leading-none text-center border-b border-solid"
                                  style={{ borderColor: "var(--color-border-strong, #B8AF9E)" }}
                                >
                                  <div className="text-sm font-extrabold whitespace-nowrap text-center leading-none" style={{ color: "var(--color-green)" }}>
                                    Rp {formatRp(totalCashbackPeriode)}
                                  </div>
                                </div>

                                {/* Monthly breakdown */}
                                <div>
                                  {Array.from({ length: numMonths }, (_, mIdx) => (
                                    <div
                                      key={mIdx}
                                      className="-mx-2 px-2 h-[36px] flex items-center border-b border-solid whitespace-nowrap justify-center"
                                      style={{ borderColor: "var(--color-border-strong, #B8AF9E)" }}
                                    >
                                      <span className="font-bold text-[13px] whitespace-nowrap" style={{ color: "var(--color-green)" }}>
                                        Rp {formatRp(monthlyCashback[mIdx])}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()
                        )}
                      </td>

                      {/* Column 8: Delete Action */}
                      {!readOnly && (
                        <td className="py-2.5 px-2 text-center align-top">
                          <div className="h-[38px] flex items-center justify-center">
                            <button
                              type="button"
                              onClick={() => {
                                const r = rows[idx];
                                const hasQty = (parseFloat(r.qtyPerBulan) || 0) > 0 || (Array.isArray(r.monthlyQty) && r.monthlyQty.some((q) => (parseFloat(q) || 0) > 0));
                                if (!r.kodeProduk && !hasQty) {
                                  onRemoveRow(idx);
                                } else {
                                  setDeleteIndex(idx);
                                }
                              }}
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-red-500 hover:text-red-700 bg-red-50/70 hover:bg-red-100 border border-red-200/70 hover:border-red-300 transition-all cursor-pointer shadow-2xs"
                              title="Hapus produk"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="w-4 h-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                />
                              </svg>
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* Table Summary Footer */}
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t font-semibold" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
                  <td className={`py-2.5 pl-4 pr-2 text-xs whitespace-nowrap ${colProdukWidth}`} style={{ color: "var(--color-text)" }}>
                    <div className="flex items-center justify-between gap-2">
                      <span>Total ({rows.length} produk)</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-1 text-center text-xs whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                    {grandTotalQtySwitch % 1 === 0 ? grandTotalQtySwitch : parseFloat(grandTotalQtySwitch.toFixed(2))} UB
                  </td>
                  <td className={`py-2.5 px-2 text-center text-xs whitespace-nowrap ${colEstSalesWidth}`} style={{ color: "var(--color-text)" }}>
                    <InfoTooltip
                      align="left"
                      trigger={
                        <span
                          className="cursor-pointer border-b border-dotted transition-colors hover:opacity-80"
                          style={{ borderColor: "var(--color-border-strong, #94a3b8)" }}
                          title="Klik/hover untuk melihat rincian"
                        >
                          Rp {formatRp(grandTotalEstSalesPeriode)}
                        </span>
                      }
                      content={
                        <div className="space-y-1.5 text-xs">
                          <div className="font-semibold text-white border-b border-slate-700/80 pb-1 flex items-center justify-between gap-2">
                            <span>Total Estimasi Sales</span>
                            <span className="text-slate-300 text-[10px]">({rows.length} Produk)</span>
                          </div>
                          <div className="space-y-1 pt-0.5 text-[11px]">
                            <div className="flex justify-between items-center gap-3">
                              <span className="text-slate-300">Total Periode ({numMonths} Bulan):</span>
                              <strong className="text-white font-semibold whitespace-nowrap">
                                Rp {formatRp(grandTotalEstSalesPeriode)}
                              </strong>
                            </div>
                            <div className="flex justify-between items-center gap-3">
                              <span className="text-slate-300">Rata-rata / Bulan:</span>
                              <strong className="text-white font-semibold whitespace-nowrap">
                                Rp {formatRp(numMonths > 0 ? grandTotalEstSalesPeriode / numMonths : 0)}
                              </strong>
                            </div>
                          </div>
                        </div>
                      }
                    />
                  </td>
                  <td className={`py-2.5 px-2 text-center text-xs whitespace-nowrap ${colNilaiScWidth}`} style={{ color: "var(--color-blue)" }}>
                    <InfoTooltip
                      align="left"
                      trigger={
                        <span
                          className="cursor-pointer border-b border-dotted transition-colors hover:opacity-80"
                          style={{ borderColor: "var(--color-border-strong, #94a3b8)" }}
                          title="Klik/hover untuk melihat rincian"
                        >
                          Rp {formatRp(grandTotalNilaiScPeriode)}
                        </span>
                      }
                      content={
                        <div className="space-y-1.5 text-xs">
                          <div className="font-semibold text-white border-b border-slate-700/80 pb-1 flex items-center justify-between gap-2">
                            <span>Total Estimasi Insentif</span>
                            <span className="text-slate-300 text-[10px]">({rows.length} Produk)</span>
                          </div>
                          <div className="space-y-1 pt-0.5 text-[11px]">
                            <div className="flex justify-between items-center gap-3">
                              <span className="text-slate-300">Total Periode ({numMonths} Bulan):</span>
                              <strong className="text-white font-semibold whitespace-nowrap">
                                Rp {formatRp(grandTotalNilaiScPeriode)}
                              </strong>
                            </div>
                            <div className="flex justify-between items-center gap-3">
                              <span className="text-slate-300">Rata-rata / Bulan:</span>
                              <strong className="text-white font-semibold whitespace-nowrap">
                                Rp {formatRp(numMonths > 0 ? grandTotalNilaiScPeriode / numMonths : 0)}
                              </strong>
                            </div>
                          </div>
                        </div>
                      }
                    />
                  </td>
                  <td className="py-2.5 px-2 text-center text-xs whitespace-nowrap" style={{ color: isCashbackNotFound ? "var(--color-text-muted)" : "var(--color-green)" }}>
                    {isCashbackNotFound ? "-" : `Rp ${formatRp(cashbackDetails.totalFinalCashback)}`}
                  </td>
                  {!readOnly && <td className="py-2.5 px-1 text-center"></td>}
                </tr>
              </tfoot>
            )}
          </table>

        {/* Add Product Button Row at Bottom of Table */}
        {!readOnly && (
          <div className="p-2.5 border-t" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
            <button
              type="button"
              onClick={onAddRow}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-1.5 py-2 px-4 rounded-md border border-dashed hover:bg-white text-xs font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                borderColor: "var(--color-border-strong)",
                color: "var(--color-text-muted)",
              }}
            >
              <span className="text-sm font-bold" style={{ color: "var(--color-blue)" }}>+</span> Tambah Produk
            </button>
          </div>
        )}
      </div>

      {/* Expanded Growth & Switching Details Panel */}
      {rows.map((row, idx) => {
        const isExpanded = expandedRows[idx] ?? false;
        if (!isExpanded || !row.kodeProduk) return null;

        const masterProduct = masterProducts.find((p) => p.kodeProduk === row.kodeProduk);
        const hnaSJ = masterProduct ? (parseFloat(masterProduct.hna) || 0) : 0;
        const qty = parseFloat(row.qtyPerBulan) || 0;
        const estSalesMonthly = qty * hnaSJ;
        const historyData = historySalesMap.get(row.kodeProduk);
        const rawB3Sales = b3SalesMap?.get(row.kodeProduk) ?? 0;

        // Rumus per arahan user:
        // Rata-rata Qty B3 = (B1 + B2 + B3) / 3
        // Historis Sales = Rata-rata Qty B3 * HNA
        // Contoh: B1=2, B2=0, B3=0 -> (2 / 3) * 176.000 = Rp 117.333
        const b1 = Number(historyData?.sales_b1) || 0;
        const b2 = Number(historyData?.sales_b2) || 0;
        const b3 = Number(historyData?.sales_b3) || 0;
        const totalQtyB3 = b1 + b2 + b3;
        const avgQtyB3 = historyData ? (totalQtyB3 / 3) : 0;

        let avgSalesBln = 0;
        if (historyData != null && hnaSJ > 0) {
          avgSalesBln = avgQtyB3 * hnaSJ;
        } else if (rawB3Sales > 0) {
          avgSalesBln = rawB3Sales;
        }

        let growthPct: number | null = null;
        if (avgSalesBln > 0) {
          growthPct = ((estSalesMonthly - avgSalesBln) / avgSalesBln) * 100;
        }

        return (
          <div key={`detail-${idx}`} className="p-3 rounded-lg border space-y-3 text-xs animate-fade-in" style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
            <div className="flex items-center justify-between font-semibold" style={{ color: "var(--color-text)" }}>
              <span>Detail Analisis Produk #{idx + 1}: {masterProduct?.namaProduk || row.kodeProduk}</span>
              <button type="button" onClick={() => toggleRowDetail(idx)} className="text-xs hover:underline cursor-pointer" style={{ color: "var(--color-text-muted)" }}>✕ Tutup</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Growth Box */}
              <div className="p-2.5 rounded border bg-white space-y-1" style={{ borderColor: "var(--color-border)" }}>
                <div className="font-semibold text-[11px]" style={{ color: "var(--color-text-muted)" }}>Growth Estimasi Sales</div>
                {avgSalesBln > 0 ? (
                  <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    Sales Sebelumnya: <strong style={{ color: "var(--color-text)" }}>Rp {formatRp(Math.round(avgSalesBln))}/bln</strong> {b3RangeLabel ? `(${b3RangeLabel})` : ""}
                  </div>
                ) : (
                  <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>Belum ada data sales sebelumnya</div>
                )}
                {growthPct != null && (
                  <div className="text-xs font-semibold" style={{ color: growthPct > 0 ? "var(--color-green)" : "var(--color-warning)" }}>
                    Growth: {growthPct >= 0 ? "+" : ""}{growthPct.toFixed(1)}% — {growthPct > 0 ? "✓ Intensifikasi tercapai" : "⚠️ Intensifikasi kurang"}
                  </div>
                )}
              </div>

              {/* Loss Sales Recommendation Box */}
              {lossSalesItems.length > 0 && (
                <div className="p-2.5 rounded border bg-white space-y-1" style={{ borderColor: "var(--color-border)" }}>
                  <div className="font-semibold text-[11px]" style={{ color: "var(--color-blue)" }}>Rekomendasi Switching Produk</div>
                  {lossSalesItems.map((item, itemIdx) => (
                    <div key={item.code || itemIdx} className="flex items-center justify-between text-xs pt-1 border-t" style={{ borderColor: "var(--color-border)" }}>
                      <div>
                        <div className="font-medium">{item.name || item.code}</div>
                        <div className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>Sales 3 Bln: {item.qty} (Total: Rp {formatRp(item.total_sales)})</div>
                      </div>
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => onUpdateRow(idx, { kodeProduk: item.code })}
                          className="text-[11px] px-2 py-1 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 cursor-pointer"
                        >
                          Ganti
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Double verification dialog for deleting a product */}
      {deleteIndex !== null && (() => {
        const rowToDelete = rows[deleteIndex];
        const prod = masterProducts.find((p) => p.kodeProduk === rowToDelete?.kodeProduk);
        const prodName = prod?.namaProduk || rowToDelete?.kodeProduk || "produk ini";

        return (
          <ConfirmDialog
            open={true}
            title="Hapus Produk?"
            message={`Apakah Anda yakin ingin menghapus "${prodName}" dari daftar rencana SC? Seluruh data isian kuantitas untuk produk ini akan dihapus.`}
            confirmLabel="Hapus Produk"
            cancelLabel="Batal"
            tone="danger"
            onConfirm={() => {
              onRemoveRow(deleteIndex);
              setDeleteIndex(null);
            }}
            onCancel={() => setDeleteIndex(null)}
          />
        );
      })()}
    </div>
  );
}