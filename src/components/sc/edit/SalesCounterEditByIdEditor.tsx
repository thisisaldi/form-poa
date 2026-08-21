"use client";

import { useState, useTransition, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Product } from "@/lib/masterData";
import { saveSalesCounterFormAction } from "@/app/actions/scActions";
import { ProductSelector } from "./ProductSelector";
import { ScSidebar } from "./ScSidebar";
import { UnitInput } from "./UnitInput";
import { Button } from "@/components/ui/Button";
import { BlastInBadge, InsScBadge } from "@/components/ui/BlastInBadge";
import { calculateCashbackDetails } from "./hooks/useSalesCounterCashback";
import { quarterToMonths } from "@/lib/quarterUtils";
import {
  getSalesCounterProductsAction,
  getScProductMenangAction,
  getScProductWithInsentifAction,
  getScInsentifHistoryAction,
  getPrincodeProductsAction,
  getScCashbackPoaAction,
  getScOutletB3SalesAction,
} from "@/app/actions/canvasser";
import { getB3PeriodInfo } from "@/lib/b3Utils";
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
  pembeliHari: string;
  qtyCustomerBaru: string;
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
  persons: Person[];
  initialProducts: {
    id: string;
    kodeProduk: string;
    namaProduk: string;
    produkKompetitor: string | null;
    pembeliHari: number;
    qtyCustomerBaru: number;
    persenMatriksSc: number;
    persenDiskon: number;
    persenCashback: number;
    rencanaTotalBiaya: number;
  }[];
  initialEntertainItems: EntertainItem[];
  initialPeriodeAwal: string;
  initialLamaPeriode: number;
  initialHariKerjaBulan: number;
  initialRencanaVisitMinggu: number;
  initialSurveyPasienHarian: number;
  masterProducts: Product[];
  readOnly?: boolean;
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
  persons,
  initialProducts,
  initialEntertainItems,
  initialPeriodeAwal,
  initialLamaPeriode,
  initialHariKerjaBulan,
  initialRencanaVisitMinggu,
  initialSurveyPasienHarian,
  masterProducts,
  readOnly = false,
}: SalesCounterEditByIdEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Pre-filled locked values
  const selectedPersonIds = persons.map((p) => parseInt(p.nik_ktp, 10));

  // Editable states - pre-filled from DB
  const [periodeAwal] = useState(initialPeriodeAwal);
  const [lamaPeriode] = useState(initialLamaPeriode);
  const [hariKerjaBulan, setHariKerjaBulan] = useState(String(initialHariKerjaBulan));
  const [rencanaVisitMinggu, setRencanaVisitMinggu] = useState(String(initialRencanaVisitMinggu));
  const [surveyPasienHarian, setSurveyPasienHarian] = useState(String(initialSurveyPasienHarian));

  // Products editable
  const [products, setProducts] = useState<ProductRow[]>(() =>
    initialProducts.length > 0
      ? initialProducts.map((p) => ({
          kodeProduk: p.kodeProduk,
          produkKompetitor: p.produkKompetitor || "",
          pembeliHari: String(p.pembeliHari),
          qtyCustomerBaru: String(p.qtyCustomerBaru),
          persenMatriksSc: String(p.persenMatriksSc),
          persenDiskon: String(p.persenDiskon),
          persenCashback: String(p.persenCashback),
          rencanaTotalBiaya: p.rencanaTotalBiaya,
        }))
      : [{ kodeProduk: "", produkKompetitor: "", pembeliHari: "", qtyCustomerBaru: "", persenMatriksSc: "", persenDiskon: "", persenCashback: "", rencanaTotalBiaya: 0 }]
  );

  // Entertain
  const [entertainList, setEntertainList] = useState(() => {
    const poaYear = parseInt(poaPeriod.slice(0, 4), 10) || new Date().getFullYear();
    const quarterMatch = poaPeriod.match(/-Q([1-4])/);
    const q = quarterMatch ? parseInt(quarterMatch[1], 10) : 1;
    const qPeriod = `${poaYear}-Q${q}`;
    const months = quarterToMonths(qPeriod);

    return months
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

  const [canvasserProducts, setCanvasserProducts] = useState<SalesCounterProduct[]>([]);
  const [princodeProducts, setPrincodeProducts] = useState<any[]>([]);
  const [cashbackMatrix, setCashbackMatrix] = useState<any[]>([]);
  const [rawCashbackData, setRawCashbackData] = useState<any>(null);
  const [productsMenang, setProductsMenang] = useState<any[]>([]);
  const [productsInsentif, setProductsInsentif] = useState<any[]>([]);
  const [insentifHistory, setInsentifHistory] = useState<any>(null);
  const [b3SalesMap, setB3SalesMap] = useState<Map<string, number>>(new Map());
  const [b3RangeLabel, setB3RangeLabel] = useState<string>("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!kodePI) return;
    const selectedCodes = products.map((p) => p.kodeProduk).filter(Boolean);
    if (selectedCodes.length === 0) return;

    const b3Info = getB3PeriodInfo(poaPeriod);
    setB3RangeLabel(b3Info.rangeLabel);

    getScOutletB3SalesAction(b3Info.period, kodePI, selectedCodes).then((res) => {
      const map = new Map<string, number>();
      if (res?.data && Array.isArray(res.data)) {
        for (const item of res.data) {
          if (item.pro_code) {
            map.set(item.pro_code, item.average_sales || 0);
          }
        }
      }
      setB3SalesMap(map);
    });
  }, [kodePI, products, poaPeriod]);

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
    getScInsentifHistoryAction(kodePI).then((res) => setInsentifHistory(res?.data || null));
    getScCashbackPoaAction().then((res) => {
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
              pembeliHari: "",
              qtyCustomerBaru: "",
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
          pembeliHari: "",
          qtyCustomerBaru: "",
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

      const updatedRow = {
        ...nextList[targetIndex],
        kodeProduk: code,
        persenMatriksSc: pctMatriksSc,
        persenCashback: pctCashback,
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

  // Quarter info
  const poaYear = parseInt(poaPeriod.slice(0, 4), 10) || new Date().getFullYear();
  const quarterMatch = poaPeriod.match(/-Q([1-4])/);
  const rowQuarter = quarterMatch ? parseInt(quarterMatch[1], 10) : 1;
  const rowQuarterPeriod = `${poaYear}-Q${rowQuarter}`;
  const months = quarterToMonths(rowQuarterPeriod);

  const productOptions = useMemo(() => {
    const scCodes = new Set(canvasserProducts.map((p) => p.pro_code));
    const menangCodes = new Set([
      ...(productsMenang || []).map((p: any) => typeof p === "string" ? p : p.pro_code || p.kode_item || p.kodeProduk || p.code),
      ...(productsInsentif || []).map((p: any) => typeof p === "string" ? p : p.pro_code || p.kode_item || p.kodeProduk || p.code),
    ].filter(Boolean));

    const scOptions = canvasserProducts.map((p) => {
      const masterP = masterProducts.find((mp) => mp.kodeProduk === p.pro_code);
      const isMenang = menangCodes.has(p.pro_code);
      return {
        value: p.pro_code,
        label: p.pro_name,
        sublabel: `${p.pro_code} · ${masterP?.namaGroupBrand || "Produk SC"}${masterP?.zatAktif ? ` · ${masterP.zatAktif}` : ""}`,
        group: isMenang ? "PERNAH SC" : "PRODUK SC",
        tag: "Produk SC",
        tagColor: "orange" as any,
        tag2: isMenang ? "Pernah SC" : undefined,
        tag2Color: isMenang ? ("green" as any) : undefined,
      };
    });

    const otherOptions = princodeProducts
      .filter((p) => !scCodes.has(p.code))
      .map((p) => {
        const masterP = masterProducts.find((mp) => mp.kodeProduk === p.code);
        const isMenang = menangCodes.has(p.code);
        return {
          value: p.code,
          label: p.name,
          sublabel: `${p.code} · ${masterP?.namaGroupBrand || "Master Produk"}${masterP?.zatAktif ? ` · ${masterP.zatAktif}` : ""}`,
          group: isMenang ? "PERNAH SC" : "PRODUK LAINNYA",
          tag2: isMenang ? "Pernah SC" : undefined,
          tag2Color: isMenang ? ("green" as any) : undefined,
        };
      });

    const existingValues = new Set([
      ...scOptions.map((o) => o.value),
      ...otherOptions.map((o) => o.value),
    ]);

    const menangExtraOptions: any[] = [];
    menangCodes.forEach((code) => {
      if (!existingValues.has(code)) {
        const masterP = masterProducts.find((mp) => mp.kodeProduk === code);
        menangExtraOptions.push({
          value: code,
          label: masterP?.namaProduk || code,
          sublabel: `${code} · ${masterP?.namaGroupBrand || "Rekomendasi SC"}${masterP?.zatAktif ? ` · ${masterP.zatAktif}` : ""}`,
          group: "PERNAH SC",
          tag: "Pernah SC",
          tagColor: "green" as any,
          tag2: "Pernah SC",
          tag2Color: "green" as any,
        });
      }
    });

    return [...menangExtraOptions, ...scOptions, ...otherOptions];
  }, [canvasserProducts, princodeProducts, productsMenang, productsInsentif, masterProducts]);

  const totalEstimasiSales = products.reduce((sum, row) => {
    if (!row.kodeProduk) return sum;
    const masterProduct = masterProducts.find((pr) => pr.kodeProduk === row.kodeProduk);
    if (!masterProduct) return sum;
    const hnaSJ = parseFloat(masterProduct.hna) || 0;
    const konv = parseInt(masterProduct.konversiPembagi || "1", 10) || 1;
    const hnaST = hnaSJ / konv;
    const pembeli = parseFloat(row.pembeliHari) || 0;
    const qty = parseFloat(row.qtyCustomerBaru) || 0;
    const days = parseFloat(hariKerjaBulan) || 0;
    return sum + (pembeli * qty * days * hnaST * lamaPeriode);
  }, 0);

  const totalNilaiSc = products.reduce((sum, row) => {
    if (!row.kodeProduk) return sum;
    const masterProduct = masterProducts.find((pr) => pr.kodeProduk === row.kodeProduk);
    if (!masterProduct) return sum;
    const canvasserProd = canvasserProducts.find((cp) => cp.pro_code === row.kodeProduk);
    const hnaSJ = parseFloat(masterProduct.hna) || 0;
    const konv = parseInt(masterProduct.konversiPembagi || "1", 10) || 1;
    const hnaST = hnaSJ / konv;
    const pembeli = parseFloat(row.pembeliHari) || 0;
    const qty = parseFloat(row.qtyCustomerBaru) || 0;
    const days = parseFloat(hariKerjaBulan) || 0;
    const estSalesBln = pembeli * qty * days * hnaST;
    const qtySjBln = konv > 0 ? (pembeli * qty * days) / konv : 0;
    const scVal = canvasserProd?.sales_counter_value;
    const scMin = canvasserProd?.sales_counter_minimum || 0;
    let valScBln = 0;
    if (scVal != null && scVal > 0) {
      valScBln = qtySjBln >= scMin ? qtySjBln * scVal : 0;
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
    hariKerjaBulan: parseFloat(hariKerjaBulan) || 0,
    lamaPeriode,
  });

  const totalCashbackVal = cashbackDetails?.totalFinalCashback ?? 0;

  const totalDiskonVal = products.reduce((sum, row) => {
    if (!row.kodeProduk) return sum;
    const masterProduct = masterProducts.find((pr) => pr.kodeProduk === row.kodeProduk);
    if (!masterProduct) return sum;
    const hnaSJ = parseFloat(masterProduct.hna) || 0;
    const konv = parseInt(masterProduct.konversiPembagi || "1", 10) || 1;
    const hnaST = hnaSJ / konv;
    const pembeli = parseFloat(row.pembeliHari) || 0;
    const qty = parseFloat(row.qtyCustomerBaru) || 0;
    const days = parseFloat(hariKerjaBulan) || 0;
    const estSalesBln = pembeli * qty * days * hnaST;
    const pctDiskon = parseFloat(row.persenDiskon) || 0;
    return sum + (estSalesBln * (pctDiskon / 100) * lamaPeriode);
  }, 0);

  const totalEntertainVal = entertainList.reduce((sum, item) => sum + (parseFloat(item.value) || 0), 0);
  const totalEstimasiBudget = totalNilaiSc + totalCashbackVal + totalEntertainVal + totalDiskonVal;
  const costRatio = totalEstimasiSales > 0 ? (totalEstimasiBudget / totalEstimasiSales) * 100 : 0;

  let totalAvgB3Bln = 0;
  let hasB3Data = false;
  for (const row of products) {
    if (!row.kodeProduk) continue;
    const avgSales = b3SalesMap.get(row.kodeProduk);
    if (avgSales != null && avgSales > 0) {
      totalAvgB3Bln += avgSales;
      hasB3Data = true;
    }
  }
  const totalEstSalesBln = totalEstimasiSales / (lamaPeriode > 0 ? lamaPeriode : 1);
  const totalGrowthPct = hasB3Data && totalAvgB3Bln > 0
    ? ((totalEstSalesBln - totalAvgB3Bln) / totalAvgB3Bln) * 100
    : null;

  const updateEntertainValue = (month: string, val: string) => {
    setEntertainList((prev) => prev.map((item) => item.month === month ? { ...item, value: val } : item));
  };

  const addProductRow = () => {
    setProducts((prev) => [
      ...prev,
      { kodeProduk: "", produkKompetitor: "", pembeliHari: "", qtyCustomerBaru: "", persenMatriksSc: "", persenDiskon: "", persenCashback: "", rencanaTotalBiaya: 0 },
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
            pembeliHari: "",
            qtyCustomerBaru: "",
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
        }
        // Recalculate rencanaTotalBiaya
        const masterProd = masterProducts.find((p) => p.kodeProduk === updated.kodeProduk);
        if (masterProd) {
          const hna = parseFloat(masterProd.hna) || 0;
          const konv = parseInt(masterProd.konversiPembagi || "1", 10) || 1;
          const hnaST = hna / konv;
          const pembeli = parseFloat(updated.pembeliHari) || 0;
          const qty = parseFloat(updated.qtyCustomerBaru) || 0;
          const days = parseFloat(hariKerjaBulan) || 0;
          const pctMatriks = parseFloat(updated.persenMatriksSc) || 0;
          updated.rencanaTotalBiaya = pembeli * qty * days * hnaST * lamaPeriode * (pctMatriks / 100);
        }
        return updated;
      })
    );
  };

  const validate = () => {
    const nextErrors: Record<string, string> = {};
    if (!periodeAwal) nextErrors.periodeAwal = "Periode awal wajib diisi";
    if (!hariKerjaBulan) nextErrors.hariKerjaBulan = "Hari praktek wajib diisi";
    if (!surveyPasienHarian) nextErrors.surveyPasienHarian = "Survey pasien harian wajib diisi";
    const hasValidProduct = products.some((p) => p.kodeProduk && (parseFloat(p.pembeliHari) || 0) > 0);
    if (!hasValidProduct) nextErrors.products = "Minimal pilih 1 produk dengan kuantitas > 0";
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    startTransition(async () => {
      const res = await saveSalesCounterFormAction(
        poaPeriod,
        kodePI,
        selectedPersonIds,
        products,
        entertainList,
        parseInt(hariKerjaBulan, 10) || 0,
        parseInt(rencanaVisitMinggu, 10) || 0,
        parseInt(surveyPasienHarian, 10) || 0,
        namaOutlet || undefined
      );
      if (res.ok) {
        router.push(`/sc/${poaPeriod}`);
      } else {
        alert(res.error || "Gagal menyimpan data.");
      }
    });
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6 p-6 max-w-5xl">
      {readOnly && (
        <div className="rounded-md px-4 py-3 text-sm font-medium"
          style={{ background: "var(--color-blue-light, #eff6ff)", color: "var(--color-blue)", border: "1px solid var(--color-blue)" }}>
          Mode Lihat (Read-Only) — Form ini tidak dalam status Draft/Revisi sehingga tidak dapat diubah.
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
            </div>
            <span className="text-xs px-2 py-0.5 rounded font-medium shrink-0"
              style={{ background: "var(--color-bg)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
              Terkunci
            </span>
          </div>

          {/* PERSONS — LOCKED */}
          {persons.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: "var(--color-text-muted)" }}>
                Sales Counter ({persons.length} terpilih)
              </p>
              <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
                <table className="w-full text-xs text-left" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-subtle)" }}>
                      <th className="py-2 px-3 font-semibold" style={{ color: "var(--color-text-muted)" }}>Nama</th>
                      <th className="py-2 px-3 font-semibold" style={{ color: "var(--color-text-muted)" }}>Jabatan</th>
                      <th className="py-2 px-3 font-semibold" style={{ color: "var(--color-text-muted)" }}>Tipe Upload</th>
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

        {/* RENCANA KUNJUNGAN */}
        <div>
          <SectionLabel>Rencana Kunjungan</SectionLabel>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: errors.hariKerjaBulan ? "var(--color-red)" : "var(--color-text-muted)" }}>
                Jumlah hari kerja Outlet <span style={{ color: "var(--color-red)", marginLeft: 2 }}>*</span>
              </span>
              <div style={errors.hariKerjaBulan ? ERR_RING : undefined}>
                <UnitInput value={hariKerjaBulan} onChange={setHariKerjaBulan} unit="Hari" placeholder="Jumlah hari praktek / bulan" max={31} disabled={readOnly} />
              </div>
              {errors.hariKerjaBulan && <span className="text-xs" style={{ color: "var(--color-red)" }}>{errors.hariKerjaBulan}</span>}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Rencana Visit / Bulan <span style={{ color: "var(--color-red)", marginLeft: 2 }}>*</span></span>
              <UnitInput value={rencanaVisitMinggu} onChange={setRencanaVisitMinggu} unit="Kali" disabled={readOnly} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: errors.surveyPasienHarian ? "var(--color-red)" : "var(--color-text-muted)" }}>
                Survey Pasien Harian <span style={{ color: "var(--color-red)", marginLeft: 2 }}>*</span>
              </span>
              <div style={errors.surveyPasienHarian ? ERR_RING : undefined}>
                <UnitInput value={surveyPasienHarian} onChange={setSurveyPasienHarian} unit="Pasien" placeholder="Hasil survey pasien harian" disabled={readOnly} />
              </div>
              {errors.surveyPasienHarian && <span className="text-xs" style={{ color: "var(--color-red)" }}>{errors.surveyPasienHarian}</span>}
            </div>
          </div>
        </div>

        {/* RENCANA POA — Periode locked */}
        <div>
          <SectionLabel>Rencana POA</SectionLabel>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Quarter</span>
              <select className="input-field w-full text-sm" disabled
                style={{ color: "var(--color-text)", background: "var(--color-bg-subtle)", opacity: 0.85 }}>
                <option>Q{rowQuarter}</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Periode Awal</span>
              <div className="input-field flex items-center"
                style={{ background: "var(--color-bg-subtle)", opacity: 0.85, height: 32, cursor: "not-allowed" }}>
                <span className="text-xs font-semibold px-1">{periodeAwal}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Lama Periode</span>
              <div className="input-field flex items-center"
                style={{ background: "var(--color-bg-subtle)", opacity: 0.85, height: 32, cursor: "not-allowed" }}>
                <span className="text-xs font-semibold px-1">{lamaPeriode} bulan</span>
              </div>
            </div>
          </div>

          {/* Entertain */}
          {entertainList.length > 0 && (
            <div className="space-y-2 mt-4">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Rencana Entertain Per Bulan</span>
              <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
                <table className="w-full text-xs text-left" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
                      <th className="px-4 py-2.5 font-medium" style={{ color: "var(--color-text-muted)" }}>Bulan</th>
                      <th className="px-4 py-2.5 font-medium w-[220px]" style={{ color: "var(--color-text-muted)" }}>Biaya Entertain</th>
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
                </table>
              </div>
            </div>
          )}
        </div>

        {/* PRODUK */}
        <div>
          <SectionLabel>Produk yang Dipromosikan</SectionLabel>
          <ProductSelector
            rows={products}
            onAddRow={addProductRow}
            onRemoveRow={removeProductRow}
            onUpdateRow={updateProductRow}
            productsOptions={productOptions}
            canvasserProducts={canvasserProducts}
            masterProducts={masterProducts}
            hariKerjaBulan={parseFloat(hariKerjaBulan) || 0}
            lamaPeriode={lamaPeriode}
            error={errors.products}
            readOnly={readOnly}
            b3SalesMap={b3SalesMap}
            b3RangeLabel={b3RangeLabel}
          />
        </div>

        {/* TOTAL */}
        <div className="rounded-xl border px-4 py-3 space-y-4"
          style={{ background: "var(--color-bg)", borderColor: "var(--color-blue)", borderWidth: 2 }}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 overflow-x-auto pb-1">
            <div className="shrink-0 min-w-[180px]">
              <div className="text-xs font-semibold whitespace-nowrap uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                TOTAL ESTIMASI SALES
              </div>
              <div className="text-xl font-bold whitespace-nowrap mt-1" style={{ color: "var(--color-blue)" }}>
                Rp {Math.round(totalEstimasiSales).toLocaleString("id-ID")}
              </div>
              <div className="text-xs mt-0.5 whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                Rp {Math.round(totalEstimasiSales / (lamaPeriode > 0 ? lamaPeriode : 1)).toLocaleString("id-ID")} / Bln
              </div>
            </div>
            <div className="shrink-0 min-w-[200px]" style={{ borderLeft: "1px solid var(--color-border)", paddingLeft: "1.5rem" }}>
              <div className="text-xs font-semibold whitespace-nowrap uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                TOTAL ESTIMASI BUDGET
              </div>
              <div className="text-xl font-bold whitespace-nowrap mt-1" style={{ color: "var(--color-blue)" }}>
                Rp {Math.round(totalEstimasiBudget).toLocaleString("id-ID")}
              </div>
              <div className="text-[11px] mt-1 space-y-0.5" style={{ color: "var(--color-text-muted)" }}>
                <div>INSENTIF SC : <strong>Rp {Math.round(totalNilaiSc).toLocaleString("id-ID")}</strong></div>
                <div>CASHBACK : <strong>Rp {Math.round(totalCashbackVal).toLocaleString("id-ID")}</strong></div>
                <div>ENTERTAIN : <strong>Rp {Math.round(totalEntertainVal).toLocaleString("id-ID")}</strong></div>
                <div>DISKON : <strong>Rp {Math.round(totalDiskonVal).toLocaleString("id-ID")}</strong></div>
              </div>
            </div>
            <div className="shrink-0 min-w-[200px]" style={{ borderLeft: "1px solid var(--color-border)", paddingLeft: "1.5rem" }}>
              <div className="text-xs font-semibold whitespace-nowrap uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                TOTAL % COST RATIO
              </div>
              <div className="text-xl font-bold whitespace-nowrap mt-1" style={{ color: "var(--color-blue)" }}>
                {costRatio.toFixed(2)}%
              </div>
              <div className="text-xs mt-0.5 whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                Total Budget / Total Sales
              </div>

              <div className="pt-2 mt-2 border-t space-y-0.5" style={{ borderColor: "var(--color-border)" }}>
                <div className="text-xs font-semibold whitespace-nowrap uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                  TOTAL GROWTH
                </div>
                {totalGrowthPct != null ? (
                  <>
                    <div
                      className="text-xl font-bold whitespace-nowrap mt-0.5"
                      style={{ color: totalGrowthPct > 0 ? "var(--color-success, #16a34a)" : "var(--color-red)" }}
                    >
                      {totalGrowthPct >= 0 ? "+" : ""}{totalGrowthPct.toFixed(1)}%
                    </div>
                    <div className="text-[11px] mt-0.5 whitespace-nowrap" style={{ color: "var(--color-text-faint)" }}>
                      Histori SC Rp {Math.round(totalAvgB3Bln).toLocaleString("id-ID")}/bln {b3RangeLabel ? `(${b3RangeLabel})` : ""}
                    </div>
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
                    Belum ada data SC sebelumnya
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ACTION BUTTONS */}
      <div className="flex justify-end gap-3 pt-4 border-t" style={{ borderColor: "var(--color-border)" }}>
        {readOnly ? (
          <Button type="button" variant="secondary" onClick={() => router.push(`/sc/${poaPeriod}`)}>
            Kembali ke Detail
          </Button>
        ) : (
          <>
            <Button type="button" variant="ghost" onClick={() => router.push(`/sc/${poaPeriod}`)} disabled={isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Menyimpan..." : "Simpan Perubahan"}
            </Button>
          </>
        )}
      </div>
    </form>
    {kodePI && (
      <ScSidebar
        doctorName={namaOutlet || undefined}
        productsMenang={productsMenang}
        productsInsentif={productsInsentif}
        insentifHistory={insentifHistory}
        selectedProductCodes={new Set(products.map((p) => p.kodeProduk).filter(Boolean))}
        onSelectProduct={selectProductFromSidebar}
      />
    )}
    </>
  );
}
