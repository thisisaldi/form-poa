"use client";

import { useMemo, useState, useEffect } from "react";
import type { Product } from "@/lib/masterData";
import { useSalesCounterEditor } from "./hooks/useSalesCounterEditor";
import { ProductSelector } from "./ProductSelector";
import { UnitInput } from "./UnitInput";
import { ScSidebar } from "./ScSidebar";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { BlastInBadge, InsScBadge } from "@/components/ui/BlastInBadge";
import { quarterToMonths } from "@/lib/quarterUtils";
import { getB3PeriodInfo } from "@/lib/b3Utils";
import { getScOutletB3SalesAction } from "@/app/actions/canvasser";
import { BlastInTable } from "./BlastInTable";
import { PosmTable } from "./PosmTable";

interface SalesCounterLineItemEditorProps {
  poaId: string;
  poaPeriod: string;
  outlets: { kodePI: string; namaOutlet: string; groupRS: string | null; sector?: string | null; subSektor?: string | null; is_sc?: boolean; jumlah_sc?: number | null; isBlastIn?: boolean }[];
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

  // Period / Quarter setup
  const validPeriodMatch = poaPeriod.match(/^(\d{4})-Q([1-4])$/);
  const poaYear = validPeriodMatch ? parseInt(validPeriodMatch[1], 10) : new Date().getFullYear();
  const rowQuarterPeriod = `${poaYear}-Q${rowQuarter}`;
  const months = quarterToMonths(validPeriodMatch ? rowQuarterPeriod : `${new Date().getFullYear()}-Q1`);

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
    const scCodes = new Set(canvasserProducts.map((p) => p.pro_code));
    const menangCodes = new Set([
      ...(productsMenang || []).map((p: any) => typeof p === "string" ? p : p.pro_code || p.kode_item || p.kodeProduk || p.code),
      ...(productsInsentif || []).map((p: any) => typeof p === "string" ? p : p.pro_code || p.kode_item || p.kodeProduk || p.code),
    ].filter(Boolean));

    const scOptions = canvasserProducts.map((p) => {
      const masterP = products.find((mp) => mp.kodeProduk === p.pro_code);
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
        const masterP = products.find((mp) => mp.kodeProduk === p.code);
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
        const masterP = products.find((mp) => mp.kodeProduk === code);
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
  }, [canvasserProducts, princodeProducts, productsMenang, productsInsentif, products]);

  const selectedPerson = personId ? personsList.find((p) => p.person_id === personId) : null;
  const totalEstimasi = selectedProducts.reduce((sum, p) => sum + p.rencanaTotalBiaya, 0);
  const totalEntertain = entertainList.reduce((sum, item) => sum + (parseFloat(item.value) || 0), 0);

  const monthlyBreakdown = months.map((m) => {
    let monthlyEstimasiSales = 0;
    let monthlyNilaiSc = 0;

    for (const row of selectedProducts) {
      if (!row.kodeProduk) continue;
      const masterProduct = products.find((pr) => pr.kodeProduk === row.kodeProduk);
      if (!masterProduct) continue;
      const canvasserProd = canvasserProducts.find((cp) => cp.pro_code === row.kodeProduk);

      const hnaSJ = parseFloat(masterProduct.hna) || 0;
      const konv = parseInt(masterProduct.konversiPembagi || "1", 10) || 1;
      const hnaST = hnaSJ / konv;

      const qty = parseFloat(row.qtyPerBulan) || 0;

      const estSalesPerMonth = qty * hnaST;
      const pctMatriks = parseFloat(row.persenMatriksSc) || 0;

      const qtySjBln = konv > 0 ? qty / konv : 0;
      const scVal = canvasserProd?.sales_counter_value;
      const scMin = canvasserProd?.sales_counter_minimum || 0;

      let valScPerMonth = 0;
      if (scVal != null && scVal > 0) {
        valScPerMonth = qtySjBln >= scMin ? qtySjBln * scVal : 0;
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
    const konv = parseInt(masterProduct.konversiPembagi || "1", 10) || 1;
    const hnaST = hnaSJ / konv;
    const qty = parseFloat(row.qtyPerBulan) || 0;
    return sum + (qty * hnaST * lamaPeriode);
  }, 0);

  const totalNilaiSc = selectedProducts.reduce((sum, row) => {
    if (!row.kodeProduk) return sum;
    const masterProduct = products.find((pr) => pr.kodeProduk === row.kodeProduk);
    if (!masterProduct) return sum;
    const canvasserProd = canvasserProducts.find((cp) => cp.pro_code === row.kodeProduk);
    const hnaSJ = parseFloat(masterProduct.hna) || 0;
    const konv = parseInt(masterProduct.konversiPembagi || "1", 10) || 1;
    const hnaST = hnaSJ / konv;
    const qty = parseFloat(row.qtyPerBulan) || 0;
    const estSalesBln = qty * hnaST;
    const qtySjBln = konv > 0 ? qty / konv : 0;
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

  const totalCashbackVal = cashbackDetails?.totalFinalCashback ?? 0;

  const totalDiskonVal = selectedProducts.reduce((sum, row) => {
    if (!row.kodeProduk) return sum;
    const masterProduct = products.find((pr) => pr.kodeProduk === row.kodeProduk);
    if (!masterProduct) return sum;
    const hnaSJ = parseFloat(masterProduct.hna) || 0;
    const konv = parseInt(masterProduct.konversiPembagi || "1", 10) || 1;
    const hnaST = hnaSJ / konv;
    const qty = parseFloat(row.qtyPerBulan) || 0;
    const estSalesBln = qty * hnaST;
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
                        const statusCount = (isSc ? 1 : 0) + (isBlastIn ? 1 : 0);
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
                          sublabelParts.push(`Periode: ${createdPeriodStr}`);
                        }
                        const sublabel = sublabelParts.length > 0 ? sublabelParts.join(" · ") : undefined;

                        return {
                          value: o.kodePI,
                          label: `${o.kodePI} · ${o.namaOutlet}${o.groupRS ? ` (${o.groupRS})` : ""}`,
                          sublabel,
                          tag: isSc ? "INS - SC" : undefined,
                          tagColor: isSc ? ("indigo" as const) : undefined,
                          tag2: isBlastIn ? "BLAST-IN" : undefined,
                          tag2Color: isBlastIn ? ("gray" as const) : undefined,
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
                  Jumlah Pasien
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
                  Jumlah Pasien Resep
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
                  Jumlah Pasien Non Resep
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
                  {months.map((m) => {
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
                hideCashback={
                  (cashbackData as any)?.message === "Gudang Tidak Ditemukan" ||
                  (typeof (cashbackData as any)?.message === "string" &&
                    ((cashbackData as any).message.toLowerCase().includes("tidak ditemukan") ||
                      (cashbackData as any).message.toLowerCase().includes("gudang"))) ||
                  (typeof (cashbackData as any)?.data?.message === "string" &&
                    ((cashbackData as any).data.message.toLowerCase().includes("tidak ditemukan") ||
                      (cashbackData as any).data.message.toLowerCase().includes("gudang"))) ||
                  (cashbackData as any)?.status === false ||
                  (cashbackData as any)?.success === false
                }
                error={errors.products}
                b3SalesMap={b3SalesMap}
                b3RangeLabel={b3RangeLabel}
              />
            </div>

            {/* 5. Rencana Entertain Breakdown Table */}
            {entertainList.length > 0 && (
              <div className="space-y-2 mt-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Rencana Entertain Per Bulan</span>
                  <span className="text-xs font-semibold" style={{ color: "var(--color-blue, #2563eb)" }}>
                    Total Entertain: Rp {formatRp(entertainList.reduce((sum, item) => sum + (parseFloat(item.value) || 0), 0))}
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
            <BlastInTable poaPeriod={poaPeriod} quarter={rowQuarter} />
            <PosmTable />
          </div>

          {/* 5. TOTAL SEMUA PRODUK */}
          <div className="rounded-xl border px-4 py-3 space-y-4"
            style={{ background: "var(--color-bg)", borderColor: "var(--color-blue)", borderWidth: 2 }}>
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                  Total Semua Produk
                </p>
              </div>
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
                    <div>DISKON : <strong>Rp {Math.round(totalDiskonVal).toLocaleString("id-ID")}</strong></div>
                    <div>ENTERTAIN : <strong>Rp {Math.round(totalEntertainVal).toLocaleString("id-ID")}</strong></div>
                    <div>CASHBACK : <strong>Rp {Math.round(totalCashbackVal).toLocaleString("id-ID")}</strong></div>
                    <div>BLAST-IN : <strong>Rp 0</strong></div>
                    <div>POSM : <strong>Rp 0</strong></div>
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
                        <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Value Cashback</th>
                        <th className="px-3 py-2 font-medium text-right whitespace-nowrap">
                          <div>Growth Sebelumnya</div>
                          {b3RangeLabel && (
                            <div className="text-[10px] font-normal normal-case opacity-75">
                              ({b3RangeLabel})
                            </div>
                          )}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedProducts.map((row, idx) => {
                        if (!row.kodeProduk) return null;
                        const masterProduct = products.find((pr) => pr.kodeProduk === row.kodeProduk);
                        if (!masterProduct) return null;

                        const hnaSJ = parseFloat(masterProduct.hna) || 0;
                        const konv = parseInt(masterProduct.konversiPembagi || "1", 10) || 1;
                        const hnaST = hnaSJ / konv;

                        const qty = parseFloat(row.qtyPerBulan) || 0;

                        const canvasserProd = canvasserProducts.find((cp) => cp.pro_code === row.kodeProduk);
                        const qtyTotal = konv > 0 ? (qty * lamaPeriode) / konv : 0;
                        const estimasiSales = qty * hnaST * lamaPeriode;
                        const pctMatriks = parseFloat(row.persenMatriksSc) || 0;

                        const qtySjBln = konv > 0 ? qty / konv : 0;
                        const scVal = canvasserProd?.sales_counter_value;
                        const scMin = canvasserProd?.sales_counter_minimum || 0;

                        let nilaiScBln = 0;
                        if (scVal != null && scVal > 0) {
                          nilaiScBln = qtySjBln >= scMin ? qtySjBln * scVal : 0;
                        } else {
                          nilaiScBln = (qty * hnaST) * (pctMatriks / 100);
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
                            <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-text-muted)" }}>
                              {valCashback > 0 ? `Rp ${Math.round(valCashback).toLocaleString("id-ID")}` : "-"}
                            </td>
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
                      * Growth Sebelumnya dihitung dari histori rata-rata penjualan B3 ({b3RangeLabel})
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 7. ESTIMASI & NILAI SC PER BULAN */}
          {monthlyBreakdown.length > 0 && selectedProducts.some(p => p.kodeProduk) && (
            <div className="rounded-xl border px-4 py-3 space-y-3"
              style={{ background: "var(--color-bg)", borderColor: "var(--color-blue)", borderWidth: 2, marginTop: "2rem" }}>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                Estimasi &amp; Nilai SC/Cashback per Bulan
              </p>
              <div className="rounded-lg overflow-hidden overflow-x-auto" style={{ border: "1px solid var(--color-border)" }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
                      <th className="text-left font-medium px-3 py-1.5 whitespace-nowrap">Bulan</th>
                      <th className="text-right font-medium px-3 py-1.5 whitespace-nowrap">Estimasi Sales</th>
                      <th className="text-right font-medium px-3 py-1.5 whitespace-nowrap">Nilai Insentif SC</th>
                      <th className="text-right font-medium px-3 py-1.5 whitespace-nowrap">Nilai Cashback</th>
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
                          <td className="text-right px-3 py-1.5 font-semibold tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-green, #16a34a)" }}>
                            {mCashback > 0 ? `Rp ${Math.round(mCashback).toLocaleString("id-ID")}` : "-"}
                          </td>
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
                      <td className="text-right px-3 py-1.5 font-bold tabular-nums whitespace-nowrap align-middle" style={{ color: "var(--color-green, #16a34a)" }}>
                        Rp {Math.round(totalCashbackVal).toLocaleString("id-ID")}
                      </td>
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
          productsMenang={productsMenang}
          productsInsentif={productsInsentif}
          insentifHistory={insentifHistory}
          rekomendasiProduk={rekomendasiProduk}
          masterProducts={products}
          selectedProductCodes={new Set(selectedProducts.map((p) => p.kodeProduk).filter(Boolean))}
          onSelectProduct={selectProductFromSidebar}
        />
      )}
    </>
  );
}
