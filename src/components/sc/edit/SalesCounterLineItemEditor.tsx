"use client";

import { useMemo, useState, useEffect } from "react";
import type { Product } from "@/lib/masterData";
import { useSalesCounterEditor } from "./hooks/useSalesCounterEditor";
import { ProductSelector } from "./ProductSelector";
import { buildScProductOptions } from "./productOptionUtils";
import { UnitInput } from "./UnitInput";
import { ScSidebar } from "./ScSidebar";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { BlastInBadge, InsScBadge } from "@/components/ui/BlastInBadge";
import { quarterToMonths } from "@/lib/quarterUtils";
import { expandPeriodeMonths } from "@/lib/poaUtils";
import { getB3PeriodInfo } from "@/lib/b3Utils";
import { getScOutletB3SalesAction } from "@/app/actions/canvasser";
import { BlastInTable } from "./BlastInTable";
import { PosmTable } from "./PosmTable";
import { PerincianBudgetModal } from "./PerincianBudgetModal";
import { OnlineApotekSalesWidget } from "./OnlineApotekSalesWidget";

interface SalesCounterLineItemEditorProps {
  poaId: string;
  poaPeriod: string;
  outlets: { kodePI: string; namaOutlet: string; groupRS: string | null; sector?: string | null; subSektor?: string | null; is_sc?: boolean; jumlah_sc?: number | null; isBlastIn?: boolean; isPosm?: boolean }[];
  products: Product[];
  savedDrafts?: any[];
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

function formatRp(val: number): string {
  return new Intl.NumberFormat("id-ID").format(Math.round(val || 0));
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider mb-2"
      style={{ color: "var(--color-text-faint)" }}>{children}</p>
  );
}

function Req() {
  return <span style={{ color: "var(--color-red)", marginLeft: 2 }}>*</span>;
}

const ERR_RING = { outline: "2px solid var(--color-red)", outlineOffset: 2, borderRadius: 6 } as const;

export function SalesCounterLineItemEditor({
  poaId,
  poaPeriod,
  outlets,
  products,
  savedDrafts = [],
}: SalesCounterLineItemEditorProps) {
  const {
    outletId,
    setOutletId,
    personId,
    setPersonId,
    selectedPersonIds,
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
    products: selectedProducts,
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
  } = useSalesCounterEditor({ poaId, poaPeriod, redirectTo: `/sc/${poaId}`, masterProducts: products, outlets, savedDrafts });

  const [showBudgetModal, setShowBudgetModal] = useState(false);

  // Period / Quarter setup
  const validPeriodMatch = poaPeriod.match(/^(\d{4})-Q([1-4])$/);
  const poaYear = validPeriodMatch ? parseInt(validPeriodMatch[1], 10) : new Date().getFullYear();
  const rowQuarterPeriod = `${poaYear}-Q${rowQuarter}`;
  const quarterMonths = quarterToMonths(validPeriodMatch ? rowQuarterPeriod : `${new Date().getFullYear()}-Q1`);

  const activeMonths = useMemo(() => {
    if (periodeAwal && /^\d{6}$/.test(periodeAwal) && lamaPeriode > 0) {
      return expandPeriodeMonths(periodeAwal, lamaPeriode);
    }
    return quarterMonths;
  }, [periodeAwal, lamaPeriode, quarterMonths]);

  const quartersOptions = useMemo(
    () => [
      { number: 1, label: "Q1", monthsName: ["Jan", "Feb", "Mar"] },
      { number: 2, label: "Q2", monthsName: ["Apr", "Mei", "Jun"] },
      { number: 3, label: "Q3", monthsName: ["Jul", "Agu", "Sep"] },
      { number: 4, label: "Q4", monthsName: ["Okt", "Nov", "Des"] },
    ],
    []
  );

  const handleQuarterChange = (qNum: number) => {
    setRowQuarter(qNum);
    const newQuarterPeriod = `${poaYear}-Q${qNum}`;
    const newMonths = quarterToMonths(newQuarterPeriod);
    if (newMonths.length > 0) {
      setPeriodeAwal(newMonths[0]);
    }
  };

  const selectedOutlet = useMemo(
    () => outlets.find((o) => o.kodePI === outletId) ?? null,
    [outlets, outletId]
  );

  const [b3SalesMap, setB3SalesMap] = useState<Map<string, number>>(new Map());
  const [b3RangeLabel, setB3RangeLabel] = useState<string>("");

  useEffect(() => {
    if (!outletId) return;
    const selectedCodes = selectedProducts.map((p) => p.kodeProduk).filter(Boolean);
    if (selectedCodes.length === 0) return;

    const b3Info = getB3PeriodInfo(poaPeriod);
    setB3RangeLabel(b3Info.rangeLabel);

    getScOutletB3SalesAction(b3Info.period, outletId, selectedCodes).then((res) => {
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
  }, [outletId, selectedProducts, poaPeriod]);

  const productOptions = useMemo(() => {
    return buildScProductOptions({
      canvasserProducts,
      princodeProducts,
      productsMenang,
      productsInsentif,
      masterProducts: products,
      historySalesData,
      surveyData,
    });
  }, [canvasserProducts, princodeProducts, productsMenang, productsInsentif, products, historySalesData, surveyData]);

  const selectedPerson = personId ? personsList.find((p) => p.person_id === personId) : null;
  const totalEstimasi = selectedProducts.reduce((sum, p) => sum + p.rencanaTotalBiaya, 0);
  const totalEntertain = entertainList.reduce((sum, item) => sum + (parseFloat(item.value) || 0), 0);

  const monthlyBreakdown = activeMonths.map((m) => {
    let monthlyEstimasiSales = 0;
    let monthlyNilaiSc = 0;

    for (const row of selectedProducts) {
      if (!row.kodeProduk) continue;
      const masterProduct = products.find((pr) => pr.kodeProduk === row.kodeProduk);
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

  const totalMonthlyEstimasiSales = monthlyBreakdown.reduce((sum, item) => sum + item.estimasiSales, 0);
  const totalMonthlyNilaiSc = monthlyBreakdown.reduce((sum, item) => sum + item.nilaiSc, 0);

  const totalEstimasiSales = selectedProducts.reduce((sum, row) => {
    if (!row.kodeProduk) return sum;
    const masterProduct = products.find((pr) => pr.kodeProduk === row.kodeProduk);
    if (!masterProduct) return sum;
    const hnaSJ = parseFloat(masterProduct.hna) || 0;
    const qty = parseFloat(row.qtyPerBulan) || 0;
    return sum + (qty * hnaSJ * lamaPeriode);
  }, 0);

  const totalNilaiSc = selectedProducts.reduce((sum, row) => {
    if (!row.kodeProduk) return sum;
    const masterProduct = products.find((pr) => pr.kodeProduk === row.kodeProduk);
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

  const isCashbackNotFound =
    !cashbackData ||
    (cashbackData as any)?.message === "Gudang Tidak Ditemukan" ||
    (typeof (cashbackData as any)?.message === "string" &&
      ((cashbackData as any).message.toLowerCase().includes("tidak ditemukan") ||
        (cashbackData as any).message.toLowerCase().includes("gudang"))) ||
    (typeof (cashbackData as any)?.data?.message === "string" &&
      ((cashbackData as any).data.message.toLowerCase().includes("tidak ditemukan") ||
        (cashbackData as any).data.message.toLowerCase().includes("gudang"))) ||
    (cashbackData as any)?.status === false ||
    (cashbackData as any)?.success === false;

  const totalCashbackVal = isCashbackNotFound ? 0 : (cashbackDetails?.totalFinalCashback ?? 0);

  const totalDiskonVal = selectedProducts.reduce((sum, row) => {
    if (!row.kodeProduk) return sum;
    const masterProduct = products.find((pr) => pr.kodeProduk === row.kodeProduk);
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

  let totalAvgB3Bln = 0;
  let hasB3Data = false;
  for (const row of selectedProducts) {
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

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6 p-6 max-w-5xl">
        <div className="space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
              Tambah Rencana POA (Sales Counter)
            </h2>

            <div className="flex items-center gap-2">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Quarter</span>
              <select
                value={rowQuarter}
                onChange={(e) => handleQuarterChange(parseInt(e.target.value, 10))}
                className="input-field font-semibold text-xs px-3 py-1.5 h-9 rounded-md border"
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
            </div>
          </div>

          {/* 1. OUTLET */}
          <div className="space-y-4">
            <SectionLabel>Outlet</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium" style={{ color: errors.outletId ? "var(--color-red)" : "var(--color-text-muted)" }}>
                  Outlet <Req />
                </span>
                <div style={errors.outletId ? ERR_RING : undefined}>
                  <Combobox
                    name="outletId"
                    options={outlets
                      .map((o) => {
                        const isSc = !!(o as any).is_sc;
                        const isBlastIn = !!(o as any).isBlastIn;
                        const isPosm = !!(o as any).isPosm;
                        const statusCount = (isSc ? 1 : 0) + (isBlastIn ? 1 : 0) + (isPosm ? 1 : 0);
                        const jumlahSc = (o as any).jumlah_sc;
                        const rawCreated = (o as any).created ?? (o as any).created_at;
                        let createdPeriodStr = "";
                        if (rawCreated != null) {
                          const str = String(rawCreated).trim();
                          const m = str.match(/^(\d{4})[-/]?(\d{2})/);
                          if (m) {
                            createdPeriodStr = `${m[1]}${m[2]}`;
                          }
                        }

                        const sublabelParts: string[] = [];
                        if (isSc && jumlahSc != null) {
                          sublabelParts.push(`Jumlah Sales Counter: ${jumlahSc}`);
                        }
                        if (createdPeriodStr) {
                          sublabelParts.push(`Periode Pendaftaran Insentif SC : ${createdPeriodStr}`);
                        }
                        const sublabel = sublabelParts.length > 0 ? sublabelParts.join(" · ") : undefined;

                        const tags: { tag: string; color: any }[] = [];
                        if (isSc) tags.push({ tag: "INS - SC", color: "indigo" as const });
                        if (isBlastIn) tags.push({ tag: "BLAST-IN", color: "gray" as const });
                        if (isPosm) tags.push({ tag: "POSM", color: "purple" as const });

                        return {
                          value: o.kodePI,
                          label: `${o.kodePI} · ${o.namaOutlet}${o.groupRS ? ` (${o.groupRS})` : ""}`,
                          sublabel,
                          tag: tags[0]?.tag,
                          tagColor: tags[0]?.color,
                          tag2: tags[1]?.tag,
                          tag2Color: tags[1]?.color,
                          tag3: tags[2]?.tag,
                          tag3Color: tags[2]?.color,
                          statusCount,
                        };
                      })
                      .sort((a, b) => {
                        if (b.statusCount !== a.statusCount) return b.statusCount - a.statusCount;
                        return a.label.localeCompare(b.label);
                      })}
                    value={outletId}
                    onChange={setOutletId}
                    placeholder="Cari outlet..."
                    emptyMessage="Tidak ada outlet di coverage Anda."
                    required
                  />
                </div>
                {errors.outletId && <span className="text-xs" style={{ color: "var(--color-red)" }}>{errors.outletId}</span>}
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                  Sektor
                </span>
                <div className="input-field flex items-center px-3 bg-transparent text-xs font-medium uppercase tracking-wider" style={{ background: "var(--color-bg-subtle)", opacity: 0.85, height: 32, cursor: "not-allowed" }}>
                  {selectedOutlet?.sector || "-"}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                  Subsektor
                </span>
                <div className="input-field flex items-center px-3 bg-transparent text-xs font-medium uppercase tracking-wider" style={{ background: "var(--color-bg-subtle)", opacity: 0.85, height: 32, cursor: "not-allowed" }}>
                  {selectedOutlet?.subSektor || "-"}
                </div>
              </div>
            </div>

            {outletId && (
              <OnlineApotekSalesWidget
                poaPeriod={poaPeriod}
                outletCode={outletId}
                outletName={selectedOutlet?.namaOutlet}
              />
            )}

            {outletId && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium" style={{ color: errors.personId ? "var(--color-red)" : "var(--color-text-muted)" }}>
                    Pilih Sales Counter <Req />
                    {selectedPersonIds.length > 0 && ` (${selectedPersonIds.length} terpilih)`}
                  </span>
                  {errors.personId && (
                    <span className="text-xs font-semibold" style={{ color: "var(--color-red)" }}>
                      {errors.personId}
                    </span>
                  )}
                </div>

                {loadingPersons ? (
                  <div className="text-xs py-4 text-center animate-pulse" style={{ color: "var(--color-text-faint)" }}>
                    Memuat Sales Counter...
                  </div>
                ) : personsList.length === 0 ? (
                  <div className="text-xs py-4 text-center border rounded-lg" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
                    Tidak ada Sales Counter di outlet ini.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
                    <table className="w-full text-xs text-left" style={{ borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-subtle)" }}>
                          <th className="py-2.5 px-3 w-10 text-center">
                            <input
                              type="checkbox"
                              checked={personsList.length > 0 && personsList.every((p) => selectedPersonIds.includes(p.person_id))}
                              onChange={() => toggleSelectAll(personsList)}
                              className="cursor-pointer"
                            />
                          </th>
                          <th className="py-2.5 px-3 font-semibold" style={{ color: "var(--color-text-muted)" }}>Sales Counter / NIK</th>
                          <th className="py-2.5 px-3 font-semibold" style={{ color: "var(--color-text-muted)" }}>Jabatan</th>
                          <th className="py-2.5 px-3 font-semibold" style={{ color: "var(--color-text-muted)" }}>Tipe Upload</th>
                        </tr>
                      </thead>
                      <tbody>
                        {personsList.map((p) => {
                          const isChecked = selectedPersonIds.includes(p.person_id);
                          const isFocused = personId === p.person_id;
                          return (
                            <tr
                              key={p.person_id}
                              onClick={() => setPersonId(p.person_id)}
                              className="cursor-pointer transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800"
                              style={{
                                borderBottom: "1px solid var(--color-border)",
                                background: isFocused ? "var(--color-blue-light, #eff6ff)" : "transparent",
                              }}
                            >
                              <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleSelectPerson(p.person_id)}
                                  className="cursor-pointer"
                                />
                              </td>
                              <td className="py-2.5 px-3 font-medium" style={{ color: "var(--color-text)" }}>
                                <div>{p.person_name}</div>
                                <div className="text-[10px]" style={{ color: "var(--color-text-faint)" }}>NIK: {p.nik}</div>
                              </td>
                              <td className="py-2.5 px-3" style={{ color: "var(--color-text-muted)" }}>{p.position_name}</td>
                              <td className="py-2.5 px-3" style={{ color: "var(--color-text-muted)" }}>{p.tipe_upload_sc || "-"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
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
                  className="input-field text-center font-semibold text-sm h-[38px]"
                />
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                  Jumlah Pasien (Per Hari)
                </span>
                <input
                  type="number"
                  value={jumlahPasien}
                  onChange={(e) => setJumlahPasien(e.target.value)}
                  placeholder="0"
                  min={0}
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

          {/* 3. RENCANA POA */}
          <div>
            <SectionLabel>Rencana SC</SectionLabel>
            <div className="grid grid-cols-2 gap-3 mb-3">

              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium" style={{ color: errors.periodeAwal ? "var(--color-red)" : "var(--color-text-muted)" }}>
                  Periode Awal <Req />
                </span>
                <select
                  value={periodeAwal}
                  onChange={(e) => setPeriodeAwal(e.target.value)}
                  className="input-field font-mono w-full text-sm"
                  style={{
                    background: "var(--color-bg)",
                    borderColor: "var(--color-border)",
                    color: periodeAwal ? "var(--color-text)" : "var(--color-text-faint)",
                    outline: errors.periodeAwal ? "1px solid var(--color-red)" : undefined,
                  }}
                  required>
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
                {errors.periodeAwal && <span className="text-xs" style={{ color: "var(--color-red)" }}>{errors.periodeAwal}</span>}
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                  Lama Periode
                </span>
                <div className="input-field flex items-center bg-transparent" style={{ background: "var(--color-bg-subtle)", opacity: 0.85, height: 32, cursor: "not-allowed" }}>
                  <span className="text-xs font-semibold px-1">{lamaPeriode} bulan</span>
                </div>
              </div>
            </div>

            {/* 4. PRODUK YANG DIPROMOSIKAN */}
            <div>
              <SectionLabel>Produk yang Dipromosikan</SectionLabel>
              <ProductSelector
                kodePI={selectedOutlet?.kodePI || ""}
                rows={selectedProducts}
                onAddRow={addProductRow}
                onRemoveRow={removeProductRow}
                onUpdateRow={updateProductRow}
                productsOptions={productOptions}
                canvasserProducts={canvasserProducts}
                masterProducts={products}
                lamaPeriode={lamaPeriode}
                periodeAwal={periodeAwal}
                diskonPeriode={diskonPeriode}
                cashbackPeriode={cashbackPeriode}
                cashbackData={cashbackData}
                hideCashback={isCashbackNotFound}
                error={errors.products}
                b3SalesMap={b3SalesMap}
                b3RangeLabel={b3RangeLabel}
              />
            </div>

            {/* 5. Rencana Entertain Breakdown Table */}
            {entertainList.length > 0 && (
              <div className="space-y-2 mt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Rencana Entertain Per Bulan</span>
                  <span className="text-xs font-semibold" style={{ color: "var(--color-blue, #2563eb)" }}>
                    History Entertain: Rp 100.000
                  </span>
                </div>
                <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
                  <table className="w-full text-xs text-left animate-fade-in" style={{ borderCollapse: "collapse" }}>
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
                              <UnitInput
                                value={row.value}
                                onChange={(val) => updateEntertainValue(row.month, val)}
                                unit="Rp"
                                placeholder="0"
                              />
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

            {/* Tabel BLAST-IN & POSM (Autofill data - ditempatkan di bawah Rencana Entertain) */}
            {selectedOutlet?.isBlastIn && <BlastInTable poaPeriod={poaPeriod} quarter={rowQuarter} />}
            {(selectedOutlet?.isPosm || selectedOutlet?.kodePI === "F4002441") && <PosmTable />}
          </div>

          {/* 5. TOTAL SEMUA PRODUK */}
          <div className="rounded-xl border px-4 py-3 space-y-4"
            style={{ background: "var(--color-bg)", borderColor: "var(--color-blue)", borderWidth: 2 }}>
            <div className="space-y-3">
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 overflow-x-auto pb-1">
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
                <div className="shrink-0 min-w-[220px]" style={{ borderLeft: "1px solid var(--color-border)", paddingLeft: "1.5rem" }}>
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
                        History Sales Rp {Math.round(totalAvgB3Bln).toLocaleString("id-ID")} / Bln
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
                </div>
              </div>
            </div>

            {selectedProducts.some(p => p.kodeProduk) && (
              <div className="space-y-3 pt-3" style={{ borderTop: "1px solid var(--color-border)" }}>
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                  Estimasi &amp; Nilai SC Per Produk
                </p>
                <div className="rounded-lg overflow-hidden overflow-x-auto" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
                  <table className="w-full text-xs text-left" style={{ borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
                        <th className="px-3 py-2 font-medium whitespace-nowrap">Produk</th>
                        <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Qty</th>
                        <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Estimasi Sales</th>
                        <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Nilai SC</th>
                        {!isCashbackNotFound && (
                          <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Value Cashback</th>
                        )}
                        <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Growth</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedProducts.map((row, idx) => {
                        if (!row.kodeProduk) return null;
                        const masterProduct = products.find((pr) => pr.kodeProduk === row.kodeProduk);
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
                            {!isCashbackNotFound && (
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
          {monthlyBreakdown.length > 0 && selectedProducts.some(p => p.kodeProduk) && (
            <div className="rounded-xl border px-4 py-3 space-y-3"
              style={{ background: "var(--color-bg)", borderColor: "var(--color-blue)", borderWidth: 2, marginTop: "2rem" }}>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                {isCashbackNotFound ? "Estimasi & Nilai SC per Bulan" : "Estimasi & Nilai SC/Cashback per Bulan"}
              </p>
              <div className="rounded-lg overflow-hidden overflow-x-auto" style={{ border: "1px solid var(--color-border)" }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
                      <th className="text-left font-medium px-3 py-1.5 whitespace-nowrap">Bulan</th>
                      <th className="text-right font-medium px-3 py-1.5 whitespace-nowrap">Estimasi Sales</th>
                      <th className="text-right font-medium px-3 py-1.5 whitespace-nowrap">Nilai Insentif SC</th>
                      {!isCashbackNotFound && (
                        <th className="text-right font-medium px-3 py-1.5 whitespace-nowrap">Nilai Cashback</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyBreakdown.map((m) => {
                      const mCashback = totalCashbackVal / (lamaPeriode || 1);
                      return (
                        <tr key={m.month} style={{ borderBottom: "1px solid var(--color-border)" }}>
                          <td className="px-3 py-1.5 align-middle" style={{ color: "var(--color-text-muted)" }}>{m.label}</td>
                          <td className="text-right px-3 py-1.5 tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-text)" }}>
                            {m.estimasiSales > 0 ? `Rp ${Math.round(m.estimasiSales).toLocaleString("id-ID")}` : "-"}
                          </td>
                          <td className="text-right px-3 py-1.5 font-semibold tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-blue)" }}>
                            {m.nilaiSc > 0 ? `Rp ${Math.round(m.nilaiSc).toLocaleString("id-ID")}` : "-"}
                          </td>
                          {!isCashbackNotFound && (
                            <td className="text-right px-3 py-1.5 font-semibold tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-green, #16a34a)" }}>
                              {mCashback > 0 ? `Rp ${Math.round(mCashback).toLocaleString("id-ID")}` : "-"}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    <tr style={{ fontWeight: 600 }}>
                      <td className="px-3 py-1.5 align-middle" style={{ color: "var(--color-text)" }}>Total</td>
                      <td className="text-right px-3 py-1.5 tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-text)" }}>
                        Rp {Math.round(totalMonthlyEstimasiSales).toLocaleString("id-ID")}
                      </td>
                      <td className="text-right px-3 py-1.5 font-bold tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-blue)" }}>
                        Rp {Math.round(totalMonthlyNilaiSc).toLocaleString("id-ID")}
                      </td>
                      {!isCashbackNotFound && (
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

        {/* Validation Error Summary Banner */}
        {Object.keys(errors).length > 0 && (
          <div className="rounded-lg p-3 text-xs space-y-1 my-2" style={{ background: "var(--color-red-light, #fef2f2)", color: "var(--color-red, #dc2626)", border: "1px solid #fecaca" }}>
            <p className="font-bold">Tidak dapat menyimpan rencana POA:</p>
            <ul className="list-disc list-inside space-y-0.5 font-medium">
              {Object.values(errors).map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 pt-4 border-t" style={{ borderColor: "var(--color-border)" }}>
          <Button type="button" variant="ghost" onClick={handleCancel} disabled={isPending}>
            Batal
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Menyimpan..." : "Simpan Rencana"}
          </Button>
        </div>
      </form>
      {outletId && (
        <ScSidebar
          poaPeriod={poaPeriod}
          doctorName={selectedOutlet?.namaOutlet || undefined}
          productsMenang={productsMenang}
          productsInsentif={productsInsentif}
          insentifHistory={insentifHistory}
          historySalesData={historySalesData}
          salesOnlineData={salesOnlineData}
          surveyData={surveyData}
          rekomendasiProduk={rekomendasiProduk}
          masterProducts={products}
          canvasserProducts={canvasserProducts}
          selectedProductCodes={new Set(selectedProducts.map((p) => p.kodeProduk).filter(Boolean))}
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
        showCashback={!isCashbackNotFound}
        showBlastIn={!!selectedOutlet?.isBlastIn}
        showPosm={!!selectedOutlet?.isPosm}
      />
    </>
  );
}
