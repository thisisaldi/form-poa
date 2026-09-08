"use client";

import { useState, useTransition, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Product } from "@/lib/masterData";
import { saveSalesCounterFormAction, getDiskonDplDpfByPeriodeAction } from "@/app/actions/scActions";
import { ProductSelector } from "./ProductSelector";
import { buildScProductOptions } from "./productOptionUtils";
import { getSurveyRekomendasiByOutletAggregate } from "@/app/actions/customer";
import { ScSidebar } from "./ScSidebar";
import { UnitInput } from "./UnitInput";
import { Button } from "@/components/ui/Button";
import { calculateCashbackDetails } from "./hooks/useSalesCounterCashback";
import { expandPeriodeMonths } from "@/lib/poaUtils";
import { quarterToMonths, resolvePeriodForQuarter } from "@/lib/quarterUtils";
import { BlastInTable } from "./BlastInTable";
import { PosmTable } from "./PosmTable";
import { PerincianBudgetModal } from "./PerincianBudgetModal";
import { OnlineApotekSalesWidget } from "./OnlineApotekSalesWidget";
import { useScToast } from "../ui/ScToast";

function formatDiskonPct(rawVal: number | string | undefined | null): string {
  if (rawVal == null) return "0";
  const num = typeof rawVal === "number" ? rawVal : parseFloat(String(rawVal));
  if (isNaN(num)) return "0";
  const pct = num > 0 && num <= 1 ? num * 100 : num;
  return String(Number(pct.toFixed(2)));
}

function formatRp(val: number): string {
  return new Intl.NumberFormat("id-ID").format(Math.round(val || 0));
}

function findDiskonItem(list: any[], targetCode: string) {
  if (!targetCode || !Array.isArray(list)) return null;
  const cleanTarget = String(targetCode).trim();
  const strippedTarget = cleanTarget.replace(/^0+/, "");

  return list.find((d: any) => {
    const codeStr = String(d.proCode || d.pro_code || d.kodeProduk || "").trim();
    if (codeStr === cleanTarget) return true;
    if (codeStr.replace(/^0+/, "") === strippedTarget) return true;
    return false;
  });
}

import {
  getSalesCounterProductsAction,
  getScProductMenangAction,
  getScProductWithInsentifAction,
  getScInsentifHistoryAction,
  getPrincodeProductsAction,
  getScCashbackPoaAction,
  getScOutletB3SalesAction,
  postHistorySalesAction,
  getRekomendasiProdukAction,
  getHistorySalesAction,
  getSalesOnlineAction,
} from "@/app/actions/canvasser";
import type { LossSalesRekomendasiProduct } from "@/app/(app)/sc/[id]/_models/ScProductRecommendationModel";
import { getB3PeriodInfo } from "@/lib/b3Utils";
import { parseOutletHistorySales } from "@/lib/historySalesUtils";
import type { SalesCounterProduct } from "@/app/(app)/sc/[id]/_models/SalesCounterProductModel";

function formatCashbackPct(rawVal: number | string | undefined | null): string {
  if (rawVal == null) return "0";
  const num = typeof rawVal === "number" ? rawVal : parseFloat(String(rawVal));
  if (isNaN(num)) return "0";
  const pct = num > 0 && num <= 1 ? num * 100 : num;
  return String(Number(pct.toFixed(2)));
}

function findCashbackItem(matrix: any[], targetCode: string) {
  if (!targetCode || !Array.isArray(matrix)) return null;
  const cleanTarget = String(targetCode).trim();
  const strippedTarget = cleanTarget.replace(/^0+/, "");

  return matrix.find((m: any) => {
    const codeStr = String(m.code || m.pro_code || m.kodeProduk || m.pro_code_raw || m.kode || "").trim();
    if (codeStr === cleanTarget) return true;
    if (codeStr.replace(/^0+/, "") === strippedTarget) return true;
    return false;
  });
}

interface ProductRow {
  kodeProduk: string;
  produkKompetitor: string;
  qtyPerBulan: string;
  persenMatriksSc: string;
  persenDiskon: string;
  persenCashback: string;
  rencanaTotalBiaya: number;
}

interface EntertainItem {
  id: string;
  periodeMonth: string;
  biayaEntertain: number;
}

interface Person {
  id: string;
  nik_ktp: string;
  personName: string;
  positionName: string;
  tipeUploadSc?: string;
}

interface SalesCounterEditByIdEditorProps {
  scId: string;
  poaPeriod: string;
  kodePI: string;
  namaOutlet: string | null;
  is_sc?: boolean;
  isBlastIn?: boolean;
  isPosm?: boolean;
  isOnline?: boolean;
  persons: Person[];
  initialProducts: {
    id: string;
    kodeProduk: string;
    namaProduk: string;
    produkKompetitor: string | null;
    qtyPerBulan: number;
    persenMatriksSc: number;
    persenDiskon: number;
    persenCashback: number;
    rencanaTotalBiaya: number;
  }[];
  initialEntertainItems: EntertainItem[];
  initialPeriodeAwal: string;
  initialLamaPeriode: number;
  initialPersenResepDokter: number;
  initialJumlahKaryawan?: number | null;
  initialJumlahPasien?: number | null;
  initialJumlahPasienResep?: number | null;
  initialJumlahPasienNonResep?: number | null;
  masterProducts: Product[];
  readOnly?: boolean;
  isOwner?: boolean;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider mb-2"
      style={{ color: "var(--color-text-faint)" }}>{children}</p>
  );
}

function satuanLabel(product: Product | null | undefined): string {
  const s = product?.satuan?.trim();
  return s && !/^[-—–]$/.test(s) ? s : "SJ";
}

function formatMonthLabel(m: string) {
  const year = m.slice(0, 4);
  const monthIndex = parseInt(m.slice(4)) - 1;
  return new Date(parseInt(year), monthIndex).toLocaleString("id-ID", { month: "short", year: "numeric" });
}

const ERR_RING = { outline: "2px solid var(--color-red)", outlineOffset: 2, borderRadius: 6 } as const;

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
}: SalesCounterEditByIdEditorProps) {
  const router = useRouter();
  const { showToast } = useScToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showBudgetModal, setShowBudgetModal] = useState(false);

  // Pre-filled locked values
  const selectedPersonIds = persons.map((p) => parseInt(p.nik_ktp, 10));

  // Quarter & period setup
  const poaYear = parseInt(poaPeriod.slice(0, 4), 10) || new Date().getFullYear();
  const quarterMatch = poaPeriod.match(/-Q([1-4])/);
  const initialRowQuarter = quarterMatch ? parseInt(quarterMatch[1], 10) : 1;

  const [rowQuarter, setRowQuarter] = useState(initialRowQuarter);
  const [periodeAwal, setPeriodeAwal] = useState(initialPeriodeAwal);
  const [lamaPeriode, setLamaPeriode] = useState(initialLamaPeriode);

  const effectivePoaPeriod = `${poaYear}-Q${rowQuarter}`;
  const quarterMonths = useMemo(() => quarterToMonths(effectivePoaPeriod), [effectivePoaPeriod]);

  const quartersOptions = useMemo(
    () => [
      { number: 1, label: "Q1", monthsName: ["Jan", "Feb", "Mar"] },
      { number: 2, label: "Q2", monthsName: ["Apr", "Mei", "Jun"] },
      { number: 3, label: "Q3", monthsName: ["Jul", "Agu", "Sep"] },
      { number: 4, label: "Q4", monthsName: ["Okt", "Nov", "Des"] },
    ],
    []
  );

  // Editable states - pre-filled from DB
  const [persenResepDokter, setPersenResepDokter] = useState(String(initialPersenResepDokter ?? "0"));
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

  // Products editable
  const [products, setProducts] = useState<ProductRow[]>(() =>
    initialProducts.length > 0
      ? initialProducts.map((p) => ({
          kodeProduk: p.kodeProduk,
          produkKompetitor: p.produkKompetitor || "",
          qtyPerBulan: String(p.qtyPerBulan ?? ""),
          persenMatriksSc: String(p.persenMatriksSc),
          persenDiskon: String(p.persenDiskon),
          persenCashback: String(p.persenCashback),
          rencanaTotalBiaya: p.rencanaTotalBiaya,
        }))
      : [{ kodeProduk: "", produkKompetitor: "", qtyPerBulan: "", persenMatriksSc: "", persenDiskon: "", persenCashback: "", rencanaTotalBiaya: 0 }]
  );

  // Entertain
  const [entertainList, setEntertainList] = useState(() => {
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
  const [princodeProducts, setPrincodeProducts] = useState<any[]>([]);
  const [cashbackMatrix, setCashbackMatrix] = useState<any[]>([]);
  const [rawCashbackData, setRawCashbackData] = useState<any>(null);
  const [productsMenang, setProductsMenang] = useState<any[]>([]);
  const [productsInsentif, setProductsInsentif] = useState<any[]>([]);
  const [insentifHistory, setInsentifHistory] = useState<any>(null);
  const [historySalesData, setHistorySalesData] = useState<any>(null);
  const [salesOnlineData, setSalesOnlineData] = useState<any>(null);
  const [surveyData, setSurveyData] = useState<any[]>([]);
  const [rekomendasiProduk, setRekomendasiProduk] = useState<LossSalesRekomendasiProduct[]>([]);
  const [b3SalesMap, setB3SalesMap] = useState<Map<string, number>>(new Map());
  const [b3RangeLabel, setB3RangeLabel] = useState<string>("");
  const [outletTotalAvgB3Sales, setOutletTotalAvgB3Sales] = useState<number>(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
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

  useEffect(() => {
    if (!kodePI) return;
    const b3Info = getB3PeriodInfo(effectivePoaPeriod);
    setB3RangeLabel(b3Info.rangeLabel);

    postHistorySalesAction([kodePI], b3Info.targetPeriods).then((res) => {
      const parsed = parseOutletHistorySales(res, kodePI);
      if (parsed.averageSales > 0 || parsed.productSalesMap.size > 0) {
        setB3SalesMap(parsed.productSalesMap);
        setOutletTotalAvgB3Sales(parsed.averageSales);
      } else {
        const selectedCodes = products.map((p) => p.kodeProduk).filter(Boolean);
        if (selectedCodes.length > 0) {
          getScOutletB3SalesAction(b3Info.period, kodePI, selectedCodes).then((fallbackRes) => {
            const map = new Map<string, number>();
            if (fallbackRes?.data && Array.isArray(fallbackRes.data)) {
              for (const item of fallbackRes.data) {
                if (item.pro_code) {
                  map.set(item.pro_code, item.average_sales || 0);
                }
              }
            }
            if (map.size > 0) {
              setB3SalesMap(map);
            }
          });
        }
      }
    });
  }, [kodePI, products, effectivePoaPeriod]);

  // Load canvasser products & sidebar data for the outlet
  useEffect(() => {
    if (!kodePI) return;
    getSalesCounterProductsAction(kodePI).then((res) => {
      if (res?.data) setCanvasserProducts(res.data);
    });
    getPrincodeProductsAction().then((res) => {
      if (res?.data) setPrincodeProducts(res.data);
    });
    getScProductMenangAction(kodePI).then((res) => setProductsMenang(res?.data || []));
    getScProductWithInsentifAction(kodePI).then((res) => setProductsInsentif(res?.data || []));
    getHistorySalesAction(kodePI, false).then((res) => setHistorySalesData(res || null));
    getSalesOnlineAction(kodePI).then((res) => setSalesOnlineData(res || null));
    getSurveyRekomendasiByOutletAggregate(kodePI).then((res) => setSurveyData(res || []));
    getRekomendasiProdukAction(kodePI).then((res) => {
      if (!res?.data) {
        setRekomendasiProduk([]);
        return;
      }
      let prods: LossSalesRekomendasiProduct[] = [];
      if (Array.isArray(res.data)) {
        for (const group of res.data) {
          if (Array.isArray(group.products)) {
            prods.push(...group.products);
          }
        }
      } else if (res.data && Array.isArray((res.data as any).products)) {
        prods = (res.data as any).products;
      }
      setRekomendasiProduk(prods);
    });
    getScCashbackPoaAction(kodePI).then((res) => {
      setRawCashbackData(res);
      const array = Array.isArray(res?.matrix)
        ? res.matrix
        : Array.isArray(res?.data?.matrix)
        ? res.data.matrix
        : Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res)
        ? res
        : [];
      setCashbackMatrix(array);
    });
  }, [kodePI]);

  // Period-aware SC insentif history
  const targetPeriod = useMemo(
    () => resolvePeriodForQuarter(effectivePoaPeriod, periodeAwal),
    [effectivePoaPeriod, periodeAwal]
  );

  useEffect(() => {
    if (!kodePI) return;
    getScInsentifHistoryAction(kodePI, targetPeriod).then((res) => setInsentifHistory(res?.data || null));
  }, [kodePI, targetPeriod]);

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

  const months = quarterMonths;

  const productOptions = useMemo(() => {
    return buildScProductOptions({
      canvasserProducts,
      princodeProducts,
      productsMenang,
      productsInsentif,
      masterProducts,
      historySalesData,
      surveyData,
    });
  }, [canvasserProducts, princodeProducts, productsMenang, productsInsentif, masterProducts, historySalesData, surveyData]);

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

  // Baseline histori penjualan seluruh produk di outlet (post-history-sales)
  const effectiveOutletAvgB3Bln =
    outletTotalAvgB3Sales > 0 ? outletTotalAvgB3Sales : totalSelectedProductsAvgB3Bln;
  const hasB3Data = effectiveOutletAvgB3Bln > 0;
  const totalEstSalesBln = totalEstimasiSales / (lamaPeriode > 0 ? lamaPeriode : 1);
  const totalGrowthPct = hasB3Data
    ? ((totalEstSalesBln - effectiveOutletAvgB3Bln) / effectiveOutletAvgB3Bln) * 100
    : null;

  const monthlyMonths = useMemo(() => {
    if (periodeAwal && /^\d{6}$/.test(periodeAwal) && lamaPeriode > 0) {
      return expandPeriodeMonths(periodeAwal, lamaPeriode);
    }
    return quarterMonths;
  }, [quarterMonths, periodeAwal, lamaPeriode]);

  const monthlyBreakdown = useMemo(() => {
    return monthlyMonths.map((m: string) => {
      let monthlyEstimasiSales = 0;
      let monthlyNilaiSc = 0;

      for (const row of products) {
        if (!row.kodeProduk) continue;
        const masterProduct = masterProducts.find((pr) => pr.kodeProduk === row.kodeProduk);
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
  }, [monthlyMonths, products, masterProducts, canvasserProducts]);

  const totalMonthlyEstimasiSales = monthlyBreakdown.reduce((sum: number, item: { estimasiSales: number }) => sum + item.estimasiSales, 0);
  const totalMonthlyNilaiSc = monthlyBreakdown.reduce((sum: number, item: { nilaiSc: number }) => sum + item.nilaiSc, 0);

  const updateEntertainValue = (month: string, val: string) => {
    setEntertainList((prev) => prev.map((item) => item.month === month ? { ...item, value: val } : item));
  };

  const addProductRow = () => {
    setProducts((prev) => [
      ...prev,
      { kodeProduk: "", produkKompetitor: "", qtyPerBulan: "", persenMatriksSc: "", persenDiskon: "", persenCashback: "", rencanaTotalBiaya: 0 },
    ]);
  };

  const removeProductRow = (index: number) => {
    setProducts((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) {
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
      return next;
    });
  };

  const updateProductRow = (index: number, fields: Partial<ProductRow>) => {
    setProducts((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const updated = { ...row, ...fields };
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
        // Recalculate rencanaTotalBiaya
        const masterProd = masterProducts.find((p) => p.kodeProduk === updated.kodeProduk);
        if (masterProd) {
          const hna = parseFloat(masterProd.hna) || 0;
          const qty = parseFloat(updated.qtyPerBulan) || 0;
          const pctMatriks = parseFloat(updated.persenMatriksSc) || 0;
          updated.rencanaTotalBiaya = qty * hna * lamaPeriode * (pctMatriks / 100);
        }
        return updated;
      })
    );
  };

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

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6 p-3 sm:p-6 max-w-5xl">
      {readOnly && (
        <div className="rounded-md px-4 py-3 text-sm font-medium"
          style={{ background: "var(--color-blue-light, #eff6ff)", color: "var(--color-blue)", border: "1px solid var(--color-blue)" }}>
          {isOwner === false
            ? "Mode Lihat (Read-Only) — Anda melihat form ini sebagai Atasan (Akses Read-Only). Perubahan hanya dapat dilakukan oleh pemilik draf (MR)."
            : "Mode Lihat (Read-Only) — Form ini tidak dalam status Draft/Revisi sehingga tidak dapat diubah."}
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
            <OnlineApotekSalesWidget
              poaPeriod={poaPeriod}
              outletCode={kodePI}
              outletName={namaOutlet}
              isOnline={isOnline}
            />
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
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                Jumlah Karyawan
              </span>
              <input
                type="number"
                value={jumlahKaryawan}
                onChange={(e) => setJumlahKaryawan(e.target.value)}
                placeholder="0"
                min={0}
                disabled={readOnly}
                className="input-field text-center font-semibold text-sm h-[38px]"
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                Jumlah Pasien
              </span>
              <input
                type="number"
                value={jumlahPasien}
                onChange={(e) => setJumlahPasien(e.target.value)}
                placeholder="0"
                min={0}
                disabled={readOnly}
                className="input-field text-center font-semibold text-sm h-[38px]"
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                Jumlah Pasien Resep (Per Hari)
              </span>
              <input
                type="number"
                value={jumlahPasienResep}
                onChange={(e) => setJumlahPasienResep(e.target.value)}
                placeholder="0"
                min={0}
                disabled={readOnly}
                className="input-field text-center font-semibold text-sm h-[38px]"
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                Jumlah Pasien Non Resep (Per Hari)
              </span>
              <input
                type="number"
                value={jumlahPasienNonResep}
                readOnly
                disabled
                className="input-field text-center font-semibold text-sm h-[38px]"
                style={{ background: "var(--color-bg-subtle)", opacity: 0.85, cursor: "not-allowed" }}
              />
              <span className="text-[10px] leading-tight mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                Pasien Non Resep = Jumlah Pasien - Jumlah Pasien Resep
              </span>
            </div>
          </div>
        </div>

        {/* RENCANA SC */}
        <div>
          <SectionLabel>Rencana SC</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Kuartal</span>
              {readOnly ? (
                <div
                  className="input-field flex items-center"
                  style={{ background: "var(--color-bg-subtle)", opacity: 0.85, height: 38, cursor: "not-allowed" }}
                >
                  <span className="text-xs font-semibold px-1">Q{rowQuarter}</span>
                </div>
              ) : (
                <select
                  value={rowQuarter}
                  onChange={(e) => handleQuarterChange(parseInt(e.target.value, 10))}
                  className="input-field font-semibold text-xs px-3 py-1.5 h-[38px] rounded-md border w-full"
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
              )}
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Periode Awal</span>
              {readOnly ? (
                <div
                  className="input-field flex items-center"
                  style={{ background: "var(--color-bg-subtle)", opacity: 0.85, height: 38, cursor: "not-allowed" }}
                >
                  <span className="text-xs font-semibold px-1">{periodeAwal}</span>
                </div>
              ) : (
                <select
                  value={periodeAwal}
                  onChange={(e) => handlePeriodeAwalChange(e.target.value)}
                  className="input-field font-mono w-full text-xs h-[38px] rounded-md border"
                  style={{
                    background: "var(--color-bg)",
                    borderColor: "var(--color-border)",
                    color: periodeAwal ? "var(--color-text)" : "var(--color-text-faint)",
                  }}
                  required
                >
                  <option value="">YYYYMM</option>
                  {quarterMonths.map((m) => {
                    const year = m.slice(0, 4);
                    const monthIndex = parseInt(m.slice(4)) - 1;
                    const label = new Date(parseInt(year), monthIndex).toLocaleString("id-ID", { month: "long", year: "numeric" });
                    return (
                      <option key={m} value={m}>
                        {m} · {label}
                      </option>
                    );
                  })}
                </select>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Lama Periode</span>
              <div
                className="input-field flex items-center"
                style={{ background: "var(--color-bg-subtle)", opacity: 0.85, height: 38, cursor: "not-allowed" }}
              >
                <span className="text-xs font-semibold px-1">{lamaPeriode} bulan</span>
              </div>
            </div>
          </div>

          {/* PRODUK YANG DIPROMOSIKAN */}
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
              b3RangeLabel={b3RangeLabel}
            />
          </div>

          {/* Entertain */}
          {entertainList.length > 0 && (
            <div className="space-y-2 mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Rencana Entertain Per Bulan</span>
                <span className="text-xs font-semibold" style={{ color: "var(--color-blue, #2563eb)" }}>
                  History Entertain: Rp 100.000
                </span>
              </div>
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
          {(isPosm || kodePI === "F4002441") && <PosmTable />}
        </div>

        {/* TOTAL */}
        <div className="rounded-xl border px-4 py-3 space-y-4"
          style={{ background: "var(--color-bg)", borderColor: "var(--color-blue)", borderWidth: 2 }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
              Total Semua Produk
            </p>
            <button
              type="button"
              onClick={() => setShowBudgetModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border cursor-pointer hover:bg-blue-100"
              style={{
                borderColor: "var(--color-blue)",
                color: "var(--color-blue)",
                background: "var(--color-blue-light, #eff6ff)",
              }}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
              </svg>
              <span>Perincian Budget</span>
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 overflow-x-auto pb-1">
            <div className="shrink-0 min-w-[180px]">
              <div className="text-xs font-semibold whitespace-nowrap uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                ESTIMASI SALES
              </div>
              <div className="text-xl font-bold whitespace-nowrap mt-1" style={{ color: "var(--color-blue)" }}>
                Rp {Math.round(totalEstimasiSales).toLocaleString("id-ID")}
              </div>
              <div className="text-xs mt-0.5 whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                Rp {Math.round(totalEstimasiSales / (lamaPeriode > 0 ? lamaPeriode : 1)).toLocaleString("id-ID")} / Bln
              </div>
            </div>
            <div
              className="shrink-0 min-w-[200px] border-t pt-4 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-6"
              style={{ borderColor: "var(--color-border)" }}
            >
              <div className="text-xs font-semibold whitespace-nowrap uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                ESTIMASI GROWTH SALES
              </div>
              {totalGrowthPct != null ? (
                <>
                  <div
                    className="text-xl font-bold whitespace-nowrap mt-1"
                    style={{ color: totalGrowthPct > 0 ? "var(--color-success, #16a34a)" : "var(--color-red)" }}
                  >
                    {totalGrowthPct >= 0 ? "+" : ""}{totalGrowthPct.toFixed(1)}%
                  </div>
                  <div className="text-xs mt-0.5 whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                    History Sales Rp {Math.round(effectiveOutletAvgB3Bln).toLocaleString("id-ID")} / Bln
                  </div>
                  {b3RangeLabel && (
                    <div className="text-[11px] mt-0.5 whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                      ({b3RangeLabel})
                    </div>
                  )}
                  <div
                    className="text-[11px] font-semibold mt-0.5"
                    style={{ color: totalGrowthPct > 0 ? "var(--color-success, #16a34a)" : "var(--color-warning, #f59e0b)" }}
                  >
                    {totalGrowthPct > 0
                      ? "✓ Intensifikasi naik"
                      : "⚠️ Intensifikasi kurang"}
                  </div>
                </>
              ) : (
                <div className="text-xs mt-1 whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                  Belum ada data history sales
                </div>
              )}
            </div>
            <div
              className="shrink-0 min-w-[180px] border-t pt-4 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-6"
              style={{ borderColor: "var(--color-border)" }}
            >
              <div className="text-xs font-semibold whitespace-nowrap uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                TOTAL % COST RATIO
              </div>
              <div className="text-xl font-bold whitespace-nowrap mt-1" style={{ color: "var(--color-blue)" }}>
                {costRatio.toFixed(2)}%
              </div>
              <div className="text-xs mt-0.5 whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                Total Budget / Total Sales
              </div>
            </div>
          </div>

          {products.some(p => p.kodeProduk) && (
            <div className="space-y-3 pt-3" style={{ borderTop: "1px solid var(--color-border)" }}>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                Estimasi &amp; Insentif SC Per Produk
              </p>
              <div className="rounded-lg overflow-hidden overflow-x-auto" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
                <table className="w-full text-xs text-left min-w-[580px]" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
                      <th className="px-3 py-2 font-medium whitespace-nowrap min-w-[160px]">Produk</th>
                      <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Qty</th>
                      <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Estimasi Sales</th>
                      <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Insentif SC</th>
                      {!isCashbackHidden && (
                        <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Value Cashback</th>
                      )}
                      <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Growth</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((row, idx) => {
                      if (!row.kodeProduk) return null;
                      const masterProduct = masterProducts.find((pr) => pr.kodeProduk === row.kodeProduk);
                      if (!masterProduct) return null;

                      const hnaSJ = parseFloat(masterProduct.hna) || 0;
                      const qty = parseFloat(row.qtyPerBulan) || 0;

                      const canvasserProd = canvasserProducts.find((cp) => cp.pro_code === row.kodeProduk);
                      const qtyTotal = qty * lamaPeriode;
                      const estimasiSales = qty * hnaSJ * lamaPeriode;
                      const pctMatriks = parseFloat(row.persenMatriksSc) || 0;

                      const scVal = canvasserProd?.sales_counter_value;
                      const scMin = canvasserProd?.sales_counter_minimum || 0;

                      let nilaiScBln = 0;
                      if (scVal != null && scVal > 0) {
                        nilaiScBln = qty >= scMin ? qty * scVal : 0;
                      } else {
                        nilaiScBln = (qty * hnaSJ) * (pctMatriks / 100);
                      }
                      const nilaiSc = nilaiScBln * lamaPeriode;
                      const valCashback = cashbackDetails?.resultMap?.get(row.kodeProduk) ?? 0;

                      const avgSales = b3SalesMap.get(row.kodeProduk) ?? 0;
                      const salesHistorical = avgSales * lamaPeriode;
                      let growthPct = 0;
                      if (salesHistorical > 0 && estimasiSales > 0) {
                        growthPct = ((estimasiSales - salesHistorical) / salesHistorical) * 100;
                      }

                      return (
                        <tr key={idx} style={{ borderBottom: "1px solid var(--color-border)" }}>
                          <td className="px-3 py-2 font-medium align-middle" style={{ color: "var(--color-text)" }}>
                            {masterProduct.namaProduk}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-text-muted)" }}>
                            {qtyTotal > 0 ? `${Math.round(qtyTotal).toLocaleString("id-ID")} ${satuanLabel(masterProduct)}` : "-"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-text-muted)" }}>
                            {estimasiSales > 0 ? `Rp ${Math.round(estimasiSales).toLocaleString("id-ID")}` : "-"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap font-semibold align-middle" style={{ color: "var(--color-blue)" }}>
                            {nilaiSc > 0 ? `Rp ${Math.round(nilaiSc).toLocaleString("id-ID")}` : "-"}
                          </td>
                          {!isCashbackHidden && (
                            <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-text-muted)" }}>
                              {valCashback > 0 ? `Rp ${Math.round(valCashback).toLocaleString("id-ID")}` : "-"}
                            </td>
                          )}
                          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-text-muted)" }}>
                            {salesHistorical > 0 ? (
                              <span className={growthPct > 0 ? "text-emerald-600 font-semibold" : growthPct < 0 ? "text-rose-600 font-semibold" : ""}>
                                {growthPct > 0 ? `+${growthPct.toFixed(1)}%` : `${growthPct.toFixed(1)}%`}
                              </span>
                            ) : (
                              "0%"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {b3RangeLabel && (
                  <p className="text-[11px] px-3 py-1.5 border-t" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)", background: "var(--color-bg-subtle)" }}>
                    * Growth Dihitung dari Histori Rata-Rata Penjualan Quarter ({b3RangeLabel})
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ESTIMASI & NILAI SC/CASHBACK PER BULAN */}
        {monthlyBreakdown.length > 0 && products.some(p => p.kodeProduk) && (
          <div className="rounded-xl border px-4 py-3 space-y-3"
            style={{ background: "var(--color-bg)", borderColor: "var(--color-blue)", borderWidth: 2, marginTop: "2rem" }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
              {isCashbackHidden ? "Estimasi & Insentif SC per Bulan" : "Estimasi & Insentif SC/Cashback per Bulan"}
            </p>
            <div className="rounded-lg overflow-hidden overflow-x-auto" style={{ border: "1px solid var(--color-border)" }}>
              <table className="w-full text-xs min-w-[460px]">
                <thead>
                  <tr style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
                    <th className="text-left font-medium px-3 py-1.5 whitespace-nowrap">Bulan</th>
                    <th className="text-right font-medium px-3 py-1.5 whitespace-nowrap">Estimasi Sales</th>
                    <th className="text-right font-medium px-3 py-1.5 whitespace-nowrap">Nilai Insentif SC</th>
                    {!isCashbackHidden && (
                      <th className="text-right font-medium px-3 py-1.5 whitespace-nowrap">Nilai Cashback</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {monthlyBreakdown.map((m: { month: string; label: string; estimasiSales: number; nilaiSc: number }) => {
                    const mCashback = totalCashbackVal / (lamaPeriode || 1);
                    return (
                      <tr key={m.month} style={{ borderBottom: "1px solid var(--color-border)" }}>
                        <td className="px-3 py-1.5 align-middle whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>{m.label}</td>
                        <td className="text-right px-3 py-1.5 tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-text)" }}>
                          {m.estimasiSales > 0 ? `Rp ${Math.round(m.estimasiSales).toLocaleString("id-ID")}` : "-"}
                        </td>
                        <td className="text-right px-3 py-1.5 font-semibold tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-blue)" }}>
                          {m.nilaiSc > 0 ? `Rp ${Math.round(m.nilaiSc).toLocaleString("id-ID")}` : "-"}
                        </td>
                        {!isCashbackHidden && (
                          <td className="text-right px-3 py-1.5 font-semibold tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-green, #16a34a)" }}>
                            {mCashback > 0 ? `Rp ${Math.round(mCashback).toLocaleString("id-ID")}` : "-"}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  <tr style={{ fontWeight: 600 }}>
                    <td className="px-3 py-1.5 align-middle whitespace-nowrap" style={{ color: "var(--color-text)" }}>Total</td>
                    <td className="text-right px-3 py-1.5 tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-text)" }}>
                      Rp {Math.round(totalMonthlyEstimasiSales).toLocaleString("id-ID")}
                    </td>
                    <td className="text-right px-3 py-1.5 font-bold tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-blue)" }}>
                      Rp {Math.round(totalMonthlyNilaiSc).toLocaleString("id-ID")}
                    </td>
                    {!isCashbackHidden && (
                      <td className="text-right px-3 py-1.5 font-bold tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-green, #16a34a)" }}>
                        Rp {Math.round(totalCashbackVal).toLocaleString("id-ID")}
                      </td>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ACTION BUTTONS */}
      <div className="flex justify-end gap-3 pt-4 border-t" style={{ borderColor: "var(--color-border)" }}>
        {readOnly ? (
          <Button type="button" variant="secondary" onClick={() => router.push(`/sc/${scId}`)}>
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
      totalPosmVal={0}
      showCashback={!isCashbackHidden}
      showBlastIn={!!isBlastIn}
      showPosm={!!isPosm}
    />
    </>
  );
}
