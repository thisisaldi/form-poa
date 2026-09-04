"use client";

import { useState, useTransition, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { SalesCounterPersonModel } from "@/app/(app)/sc/[id]/_models/SalesCounterPersonModel";
import type { SalesCounterProduct } from "@/app/(app)/sc/[id]/_models/SalesCounterProductModel";
import {
  getSalesCounterProductsAction,
  getSalesCountersAction,
  getScProductMenangAction,
  getScProductWithInsentifAction,
  getScInsentifHistoryAction,
  getPrincodeProductsAction,
  getScCashbackPoaAction,
  getRekomendasiProdukAction,
  getHistorySalesAction,
  getSalesOnlineAction,
} from "@/app/actions/canvasser";
import type { LossSalesRekomendasiProduct } from "@/app/(app)/sc/[id]/_models/ScProductRecommendationModel";
import type { Product } from "@/lib/masterData";
import { saveSalesCounterFormAction, getDiskonDplDpfByPeriodeAction } from "@/app/actions/scActions";
import { getSurveyRekomendasiByOutletAggregate } from "@/app/actions/customer";
import { calculateCashbackDetails, type CashbackData } from "./useSalesCounterCashback";
import { resolvePeriodForQuarter } from "@/lib/quarterUtils";

function formatDiskonPct(rawVal: number | string | undefined | null): string {
  if (rawVal == null) return "0";
  const num = typeof rawVal === "number" ? rawVal : parseFloat(String(rawVal));
  if (isNaN(num)) return "0";
  const pct = num > 0 && num <= 1 ? num * 100 : num;
  return String(Number(pct.toFixed(2)));
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
    const codeStr = String(m.code || m.pro_code || "").trim();
    if (codeStr === cleanTarget) return true;
    if (codeStr.replace(/^0+/, "") === strippedTarget) return true;
    return false;
  });
}

export interface SelectedProductRow {
  kodeProduk: string;
  produkKompetitor: string;
  qtyPerBulan: string;
  persenMatriksSc: string;
  persenDiskon: string;
  persenCashback: string;
  rencanaTotalBiaya: number; // monthly estimate * duration
}

export interface EntertainRow {
  month: string;      // YYYYMM
  label: string;      // e.g. "Juli 2026"
  value: string;      // input value in Rp
}

export function useSalesCounterEditor({
  poaId,
  poaPeriod,
  redirectTo,
  masterProducts,
  outlets,
  savedDrafts = [],
}: {
  poaId: string;
  poaPeriod: string;
  redirectTo: string;
  masterProducts: Product[];
  outlets?: { kodePI: string; namaOutlet: string }[];
  savedDrafts?: any[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Form states
  const [outletId, setOutletId] = useState("");
  const [personId, setPersonId] = useState<number | null>(null);
  const [selectedPersonIds, setSelectedPersonIds] = useState<number[]>([]);
  const [periodeAwal, setPeriodeAwal] = useState("");
  const [lamaPeriode, setLamaPeriode] = useState(0);

  // Period / Quarter setup
  const [rowQuarter, setRowQuarter] = useState<number>(() => {
    const m = poaPeriod.match(/-Q([1-4])/);
    return m ? parseInt(m[1], 10) : 1;
  });

  // Monthly Entertain Plan list
  const [entertainList, setEntertainList] = useState<EntertainRow[]>([]);

  // % Resep Dokter
  const [persenResepDokter, setPersenResepDokter] = useState("");

  // Patient & Employee Statistics
  const [jumlahKaryawan, setJumlahKaryawan] = useState("");
  const [jumlahPasien, setJumlahPasien] = useState("");
  const [jumlahPasienResep, setJumlahPasienResep] = useState("");

  const numPasien = parseInt(jumlahPasien, 10) || 0;
  const numPasienResep = parseInt(jumlahPasienResep, 10) || 0;
  const jumlahPasienNonResep = Math.max(0, numPasien - numPasienResep);

  // API helper data states
  const [productsMenang, setProductsMenang] = useState<any[]>([]);
  const [productsInsentif, setProductsInsentif] = useState<any[]>([]);
  const [insentifHistory, setInsentifHistory] = useState<any>(null);
  const [historySalesData, setHistorySalesData] = useState<any>(null);
  const [salesOnlineData, setSalesOnlineData] = useState<any>(null);
  const [surveyData, setSurveyData] = useState<any[]>([]);
  const [rekomendasiProduk, setRekomendasiProduk] = useState<LossSalesRekomendasiProduct[]>([]);
  const [princodeProducts, setPrincodeProducts] = useState<any[]>([]);
  const [cashbackData, setCashbackData] = useState<CashbackData | null>(null);
  const [cashbackMatrix, setCashbackMatrix] = useState<any[]>([]);
  const [diskonList, setDiskonList] = useState<{ proCode: string; diskon: number }[]>([]);
  const [diskonPeriode, setDiskonPeriode] = useState<string>("");

  useEffect(() => {
    if (!periodeAwal) {
      setDiskonList([]);
      setDiskonPeriode("");
      return;
    }
    getDiskonDplDpfByPeriodeAction(periodeAwal).then((res) => {
      if (Array.isArray(res)) {
        setDiskonList(res);
        setDiskonPeriode(periodeAwal);
      } else {
        setDiskonList(res?.list || []);
        setDiskonPeriode(res?.diskonPeriode || periodeAwal);
      }
    });
  }, [periodeAwal]);

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


  const [products, setProducts] = useState<SelectedProductRow[]>([
    {
      kodeProduk: "",
      produkKompetitor: "",
      qtyPerBulan: "",
      persenMatriksSc: "",
      persenDiskon: "",
      persenCashback: "",
      rencanaTotalBiaya: 0,
    },
  ]);

  const [canvasserProducts, setCanvasserProducts] = useState<SalesCounterProduct[]>([]);
  const [personsList, setPersonsList] = useState<SalesCounterPersonModel[]>([]);
  const [loadingPersons, setLoadingPersons] = useState(false);

  // Errors state
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Fetch products and persons when outlet changes
  useEffect(() => {
    if (!outletId) {
      setCanvasserProducts([]);
      setPrincodeProducts([]);
      setPersonsList([]);
      setInsentifHistory(null);
      setProductsMenang([]);
      setProductsInsentif([]);
      setRekomendasiProduk([]);
      setSurveyData([]);
      setSalesOnlineData(null);
      setCashbackData(null);
      setCashbackMatrix([]);
      return;
    }

    setLoadingPersons(true);
    getSalesCountersAction(outletId)
      .then((res) => {
        if (res?.data) {
          setPersonsList(res.data);
        } else {
          setPersonsList([]);
        }
      })
      .finally(() => setLoadingPersons(false));

    getSalesCounterProductsAction(outletId).then((res) => {
      if (res?.data) {
        setCanvasserProducts(res.data);
      } else {
        setCanvasserProducts([]);
      }
    });

    getPrincodeProductsAction().then((res) => {
      if (res?.data) {
        setPrincodeProducts(res.data);
      } else {
        setPrincodeProducts([]);
      }
    });

    getScProductMenangAction(outletId).then((res) => setProductsMenang(res?.data || []));
    getScProductWithInsentifAction(outletId).then((res) => setProductsInsentif(res?.data || []));
    getHistorySalesAction(outletId).then((res) => setHistorySalesData(res || null));
    getSalesOnlineAction(outletId).then((res) => setSalesOnlineData(res || null));
    getSurveyRekomendasiByOutletAggregate(outletId).then((res) => setSurveyData(res || []));
    getScCashbackPoaAction(outletId).then((res) => {
      setCashbackData(res || null);
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
    getRekomendasiProdukAction(outletId).then((res) => {
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
  }, [outletId]);

  // Period-aware SC insentif history
  const targetPeriod = useMemo(
    () => resolvePeriodForQuarter(poaPeriod, periodeAwal),
    [poaPeriod, periodeAwal]
  );

  useEffect(() => {
    if (!outletId) {
      setInsentifHistory(null);
      return;
    }
    getScInsentifHistoryAction(outletId, targetPeriod).then((res) => setInsentifHistory(res?.data || null));
  }, [outletId, targetPeriod]);

  // Find if there is an existing database draft for the selected outlet and prefill states
  useEffect(() => {
    if (!outletId || !savedDrafts) return;
    const draft = savedDrafts.find((d) => d.kodePI === outletId);
    if (draft) {
      setSelectedPersonIds(draft.persons.map((p: any) => parseInt(p.nik_ktp, 10)));
      setPeriodeAwal(draft.periodeAwal);
      setLamaPeriode(draft.lamaPeriode);
      setPersenResepDokter(String(draft.persenResepDokter ?? draft.surveyPasienHarian ?? ""));
      setProducts(
        draft.products.map((p: any) => ({
          kodeProduk: p.kodeProduk,
          produkKompetitor: p.produkKompetitor || "",
          qtyPerBulan: String(p.qtyPerBulan ?? p.qtyCustomerBaru ?? ""),
          persenMatriksSc: String(p.persenMatriksSc),
          persenDiskon: String(p.persenDiskon),
          persenCashback: String(p.persenCashback),
          rencanaTotalBiaya: Number(p.rencanaTotalBiaya),
        }))
      );
    } else {
      setSelectedPersonIds([]);
      setPeriodeAwal("");
      setLamaPeriode(0);
      setPersenResepDokter("");
      setProducts([
        {
          kodeProduk: "",
          produkKompetitor: "",
          qtyPerBulan: "",
          persenMatriksSc: "",
          persenDiskon: "",
          persenCashback: "",
          rencanaTotalBiaya: 0,
        },
      ]);
    }
  }, [outletId, savedDrafts]);

  // Autofill lamaPeriode & resize entertainList based on selected start month and quarter end
  useEffect(() => {
    if (!periodeAwal) {
      setLamaPeriode(0);
      setEntertainList([]);
      return;
    }

    const startYear = parseInt(periodeAwal.slice(0, 4), 10);
    const startMonth = parseInt(periodeAwal.slice(4, 6), 10);
    const endMonth = rowQuarter * 3;
    const calculatedDuration = endMonth - startMonth + 1;
    const duration = calculatedDuration > 0 ? calculatedDuration : 0;

    setLamaPeriode(duration);

    setEntertainList((prevList) => {
      const newItems: EntertainRow[] = [];
      for (let m = startMonth; m <= endMonth; m++) {
        const monthStr = String(m).padStart(2, "0");
        const periodMonth = `${startYear}${monthStr}`;
        const monthIndex = m - 1;
        const label = new Date(startYear, monthIndex).toLocaleString("id-ID", { month: "long", year: "numeric" });

        const existingItem = prevList.find((item) => item.month === periodMonth);

        let initialBiaya = "";
        if (!existingItem && outletId && savedDrafts) {
          const draft = savedDrafts.find((d) => d.kodePI === outletId);
          if (draft && draft.entertainItems) {
            const savedItem = draft.entertainItems.find((e: any) => e.periodeMonth === periodMonth);
            if (savedItem) {
              initialBiaya = String(savedItem.biayaEntertain);
            }
          }
        }

        newItems.push({
          month: periodMonth,
          label,
          value: existingItem ? existingItem.value : initialBiaya,
        });
      }
      return newItems;
    });
  }, [periodeAwal, rowQuarter, outletId, savedDrafts]);

  // Helper to calculate product row estimate
  const calculateRowCost = (row: SelectedProductRow, duration: number) => {
    const master = masterProducts.find((p) => p.kodeProduk === row.kodeProduk);
    if (!master) return 0;

    const hnaSJ = parseFloat(master.hna) || 0;
    const qty = parseFloat(row.qtyPerBulan) || 0;
    return qty * hnaSJ * duration;
  };

  // Recalculate product estimate costs when duration updates
  useEffect(() => {
    setProducts((prev) =>
      prev.map((row) => ({
        ...row,
        rencanaTotalBiaya: calculateRowCost(row, lamaPeriode),
      }))
    );
  }, [lamaPeriode, canvasserProducts]);

  const toggleSelectPerson = (id: number) => {
    setSelectedPersonIds((prev) => {
      const exists = prev.includes(id);
      let next;
      if (exists) {
        next = prev.filter((x) => x !== id);
      } else {
        next = [...prev, id];
      }
      return next;
    });
    setPersonId(id);
  };

  const toggleSelectAll = (persons: SalesCounterPersonModel[]) => {
    setSelectedPersonIds((prev) => {
      const allIds = persons.map((p) => p.person_id);
      const isAllSelected = allIds.every((id) => prev.includes(id));
      if (isAllSelected) {
        return prev.filter((id) => !allIds.includes(id));
      } else {
        if (allIds.length > 0) {
          setPersonId(allIds[0]);
        }
        return Array.from(new Set([...prev, ...allIds]));
      }
    });
  };

  const addProductRow = () => {
    setProducts((prev) => [
      ...prev,
      {
        kodeProduk: "",
        produkKompetitor: "",
        qtyPerBulan: "",
        persenMatriksSc: "",
        persenDiskon: "",
        persenCashback: "",
        rencanaTotalBiaya: 0,
      },
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

  useEffect(() => {
    if (cashbackMatrix.length === 0) return;
    setProducts((prev) =>
      prev.map((row) => {
        if (!row.kodeProduk) return row;
        const matrixItem = findCashbackItem(cashbackMatrix, row.kodeProduk);
        if (!matrixItem) return row;
        const autoPct = formatCashbackPct(matrixItem.cashback_percentage);
        return row.persenCashback === autoPct ? row : { ...row, persenCashback: autoPct };
      })
    );
  }, [cashbackMatrix]);

  const updateProductRow = (index: number, fields: Partial<SelectedProductRow>) => {
    setProducts((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const updated = { ...row, ...fields };

        // Auto-calculate % Matriks SC, % Cashback and % Diskon if product is selected
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
            updated.persenCashback = formatCashbackPct(matrixItem.cashback_percentage);
          } else if (fields.kodeProduk === "") {
            updated.persenCashback = "0";
          }
          const diskonItem = findDiskonItem(diskonList, fields.kodeProduk);
          updated.persenDiskon = diskonItem ? formatDiskonPct(diskonItem.diskon) : "0";
        }

        updated.rencanaTotalBiaya = calculateRowCost(updated, lamaPeriode);
        return updated;
      })
    );
  };

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
        pctCashback = formatCashbackPct(matrixItem.cashback_percentage);
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
      updatedRow.rencanaTotalBiaya = calculateRowCost(updatedRow, lamaPeriode);

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

  const updateEntertainValue = (month: string, val: string) => {
    setEntertainList((prev) => prev.map((item) => (item.month === month ? { ...item, value: val } : item)));
  };

  const validate = () => {
    const nextErrors: Record<string, string> = {};
    if (!outletId) nextErrors.outletId = "Outlet wajib dipilih";
    if (selectedPersonIds.length === 0) nextErrors.personId = "Minimal pilih 1 Sales Counter";
    if (!periodeAwal) nextErrors.periodeAwal = "Periode awal wajib diisi";
    
    const hasValidProduct = products.some((p) => p.kodeProduk && (parseFloat(p.qtyPerBulan) || 0) > 0);
    if (!hasValidProduct) {
      nextErrors.products = "Minimal pilih 1 produk dengan kuantitas > 0";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const matchedOutlet = outlets?.find((o) => o.kodePI === outletId);

    startTransition(async () => {
      const res = await saveSalesCounterFormAction(
        poaPeriod,
        outletId,
        selectedPersonIds,
        products,
        entertainList,
        parseInt(persenResepDokter, 10) || 0,
        matchedOutlet?.namaOutlet,
        parseInt(jumlahKaryawan, 10) || 0,
        numPasien,
        numPasienResep,
        jumlahPasienNonResep,
        periodeAwal,
        lamaPeriode
      );
      if (res.ok) {
        router.push(redirectTo);
      } else {
        alert(res.error || "Gagal menyimpan data.");
      }
    });
  };

  const handleCancel = () => {
    router.push(redirectTo);
  };

  const cashbackDetails = calculateCashbackDetails({
    cashbackData,
    selectedProducts: products,
    masterProducts,
    lamaPeriode,
  });

  const cashbackPeriode = cashbackData?.period || (cashbackData as any)?.data?.period;

  return {
    outletId,
    setOutletId,
    personId,
    setPersonId,
    selectedPersonIds,
    setSelectedPersonIds,
    toggleSelectPerson,
    toggleSelectAll,
    periodeAwal,
    setPeriodeAwal,
    lamaPeriode,
    rowQuarter,
    setRowQuarter,
    entertainList,
    updateEntertainValue,
    persenResepDokter,
    setPersenResepDokter,
    jumlahKaryawan,
    setJumlahKaryawan,
    jumlahPasien,
    setJumlahPasien,
    jumlahPasienResep,
    setJumlahPasienResep,
    jumlahPasienNonResep,
    products,
    addProductRow,
    removeProductRow,
    updateProductRow,
    selectProductFromSidebar,
    canvasserProducts,
    princodeProducts,
    personsList,
    loadingPersons,
    productsMenang,
    productsInsentif,
    insentifHistory,
    historySalesData,
    salesOnlineData,
    surveyData,
    rekomendasiProduk,
    cashbackData,
    cashbackDetails,
    cashbackPeriode,
    diskonPeriode,
    errors,
    isPending,
    handleSubmit,
    handleCancel,
  };
}