"use client";

import { useMemo } from "react";
import type { Product } from "@/lib/masterData";
import { useSalesCounterEditor } from "./hooks/useSalesCounterEditor";
import { ProductSelector } from "./ProductSelector";
import { UnitInput } from "./UnitInput";
import { ScSidebar } from "./ScSidebar";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { quarterToMonths } from "@/lib/quarterUtils";

interface SalesCounterLineItemEditorProps {
  poaId: string;
  poaPeriod: string;
  outlets: { kodePI: string; namaOutlet: string; groupRS: string | null }[];
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

function LabelCustomerBadge({ label }: { label: string }) {
  const isNew = label === "Dokter Baru" || label === "SC Baru";
  const isGood = label.includes("Bagus");
  const color = isNew
    ? "var(--color-blue)"
    : isGood ? "var(--color-success, #16a34a)"
    : "var(--color-text-muted)";
  const bg = isNew
    ? "var(--color-blue-light, #eff6ff)"
    : isGood ? "var(--color-success-bg, #dcfce7)"
    : "var(--color-bg-subtle)";
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded border"
      style={{ color, background: bg, borderColor: color }}>
      {label}
    </span>
  );
}

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
    doctorName,
    periodeAwal,
    setPeriodeAwal,
    lamaPeriode,
    rowQuarter,
    setRowQuarter,
    entertainList,
    updateEntertainValue,
    hariKerjaBulan,
    setHariKerjaBulan,
    rencanaVisitMinggu,
    setRencanaVisitMinggu,
    surveyPasienHarian,
    setSurveyPasienHarian,
    products: selectedProducts,
    addProductRow,
    removeProductRow,
    updateProductRow,
    canvasserProducts,
    princodeProducts,
    personsList,
    loadingPersons,
    productsMenang,
    productsInsentif,
    insentifHistory,
    errors,
    isPending,
    handleSubmit,
    handleCancel,
  } = useSalesCounterEditor({ poaId, poaPeriod, redirectTo: `/sc/${poaId}`, masterProducts: products, outlets, savedDrafts });

  // Period / Quarter setup
  const poaYear = parseInt(poaPeriod.slice(0, 4), 10) || new Date().getFullYear();
  const rowQuarterPeriod = `${poaYear}-Q${rowQuarter}`;
  const months = quarterToMonths(rowQuarterPeriod);

  const productOptions = useMemo(() => {
    const scCodes = new Set(canvasserProducts.map((p) => p.pro_code));

    const scOptions = canvasserProducts.map((p) => ({
      value: p.pro_code,
      label: `${p.pro_code} · ${p.pro_name} (Produk SC)`,
      isScProduct: true,
    }));

    const otherOptions = princodeProducts
      .filter((p) => !scCodes.has(p.code))
      .map((p) => ({
        value: p.code,
        label: `${p.code} · ${p.name}`,
        isScProduct: false,
      }));

    return [...scOptions, ...otherOptions];
  }, [canvasserProducts, princodeProducts]);



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

      const hnaSJ = parseFloat(masterProduct.hna) || 0;
      const konv = parseInt(masterProduct.konversiPembagi || "1", 10) || 1;
      const hnaST = hnaSJ / konv;

      const pembeli = parseFloat(row.pembeliHari) || 0;
      const qty = parseFloat(row.qtyCustomerBaru) || 0;
      const days = parseFloat(hariKerjaBulan) || 0;

      const estSalesPerMonth = pembeli * qty * days * hnaST;
      const pctMatriks = parseFloat(row.persenMatriksSc) || 0;
      const valScPerMonth = estSalesPerMonth * (pctMatriks / 100);

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

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6 p-6 max-w-5xl">
        <div className="space-y-6">
        <h2 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
          Tambah Rencana POA (Sales Counter)
        </h2>

        {/* 1. OUTLET */}
        <div className="space-y-4">
          <SectionLabel>Outlet</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: errors.outletId ? "var(--color-red)" : "var(--color-text-muted)" }}>
                Outlet <Req />
              </span>
              <div style={errors.outletId ? ERR_RING : undefined}>
                <Combobox
                  name="outletId"
                  options={outlets.map((o) => ({
                    value: o.kodePI,
                    label: `${o.kodePI} · ${o.namaOutlet}${o.groupRS ? ` (${o.groupRS})` : ""}`,
                  }))}
                  value={outletId}
                  onChange={setOutletId}
                  placeholder="Cari outlet..."
                  emptyMessage="Tidak ada outlet di coverage Anda."
                  required
                />
              </div>
              {errors.outletId && <span className="text-xs" style={{ color: "var(--color-red)" }}>{errors.outletId}</span>}
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

        {/* 2. RENCANA KUNJUNGAN */}
        <div>
          <SectionLabel>Rencana Kunjungan</SectionLabel>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: errors.hariKerjaBulan ? "var(--color-red)" : "var(--color-text-muted)" }}>
                Jumlah hari kerja / Bln <Req />
              </span>
              <div style={errors.hariKerjaBulan ? ERR_RING : undefined}>
                <UnitInput
                  value={hariKerjaBulan}
                  onChange={setHariKerjaBulan}
                  unit="Hari"
                  placeholder="Jumlah hari praktek / bulan"
                  max={31}
                />
              </div>
              {errors.hariKerjaBulan && <span className="text-xs" style={{ color: "var(--color-red)" }}>{errors.hariKerjaBulan}</span>}
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                Rencana Visit / Bulan <Req />
              </span>
              <UnitInput
                value={rencanaVisitMinggu}
                onChange={setRencanaVisitMinggu}
                unit="Kali"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: errors.surveyPasienHarian ? "var(--color-red)" : "var(--color-text-muted)" }}>
                Survey Pasien Harian <Req />
              </span>
              <div style={errors.surveyPasienHarian ? ERR_RING : undefined}>
                <UnitInput
                  value={surveyPasienHarian}
                  onChange={setSurveyPasienHarian}
                  unit="Pasien"
                  placeholder="Hasil survey pasien harian"
                />
              </div>
              {errors.surveyPasienHarian && <span className="text-xs" style={{ color: "var(--color-red)" }}>{errors.surveyPasienHarian}</span>}
            </div>
          </div>
        </div>

        {/* 3. RENCANA POA */}
        <div>
          <SectionLabel>Rencana POA</SectionLabel>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Quarter</span>
              <select
                value={rowQuarter}
                onChange={(e) => {
                  setRowQuarter(parseInt(e.target.value, 10));
                  setPeriodeAwal("");
                }}
                className="input-field w-full text-sm"
                style={{ color: "var(--color-text)", background: "var(--color-bg-subtle)", opacity: 0.85 }}
                disabled>
                <option value={1}>Q1 (Jan-Mar)</option>
                <option value={2}>Q2 (Apr-Jun)</option>
                <option value={3}>Q3 (Jul-Sep)</option>
                <option value={4}>Q4 (Okt-Des)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: errors.periodeAwal ? "var(--color-red)" : "var(--color-text-muted)" }}>
                Periode Awal <Req />
              </span>
              <select
                value={periodeAwal}
                onChange={(e) => setPeriodeAwal(e.target.value)}
                className="input-field font-mono w-full text-sm"
                style={{
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

          {/* Rencana Entertain Breakdown Table */}
          {entertainList.length > 0 && (
            <div className="space-y-2 mt-4">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Rencana Entertain Per Bulan</span>
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
                </table>
              </div>
            </div>
          )}
        </div>

        {/* 4. PRODUK YANG DIPROMOSIKAN */}
        <div>
          <SectionLabel>Produk yang Dipromosikan</SectionLabel>
          <ProductSelector
            rows={selectedProducts}
            onAddRow={addProductRow}
            onRemoveRow={removeProductRow}
            onUpdateRow={updateProductRow}
            productsOptions={productOptions}
            canvasserProducts={canvasserProducts}
            masterProducts={products}
            hariKerjaBulan={parseFloat(hariKerjaBulan) || 0}
            lamaPeriode={lamaPeriode}
            error={errors.products}
          />
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
            <div className="flex gap-6 flex-wrap items-start">
              <div>
                <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Total Rencana Biaya SC</div>
                <div className="text-xl font-bold" style={{ color: "var(--color-blue)" }}>
                  Rp {totalEstimasi.toLocaleString("id-ID")}
                </div>
                <div className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                  {(totalEstimasi / 1000000).toLocaleString("id-ID", { minimumFractionDigits: 2 })} Juta
                </div>
              </div>
              <div>
                <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Total Rencana Entertain</div>
                <div className="text-xl font-bold" style={{ color: "var(--color-blue)" }}>
                  Rp {totalEntertain.toLocaleString("id-ID")}
                </div>
                <div className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                  {(totalEntertain / 1000000).toLocaleString("id-ID", { minimumFractionDigits: 2 })} Juta
                </div>
              </div>
              <div style={{ borderLeft: "1px solid var(--color-border)", paddingLeft: "1.5rem" }}>
                <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Total Keseluruhan Pengajuan</div>
                <div className="text-xl font-bold" style={{ color: "var(--color-blue)" }}>
                  Rp {(totalEstimasi + totalEntertain).toLocaleString("id-ID")}
                </div>
                <div className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                  {((totalEstimasi + totalEntertain) / 1000000).toLocaleString("id-ID", { minimumFractionDigits: 2 })} Juta
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
                      <th className="px-3 py-2 font-medium">Produk</th>
                      <th className="px-3 py-2 font-medium text-right">Qty</th>
                      <th className="px-3 py-2 font-medium text-right">Estimasi Sales</th>
                      <th className="px-3 py-2 font-medium text-right">Nilai SC</th>
                      <th className="px-3 py-2 font-medium text-right">% Matriks</th>
                      <th className="px-3 py-2 font-medium text-right">% Diskon</th>
                      <th className="px-3 py-2 font-medium text-right">% Cashback</th>
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

                      const pembeli = parseFloat(row.pembeliHari) || 0;
                      const qty = parseFloat(row.qtyCustomerBaru) || 0;
                      const days = parseFloat(hariKerjaBulan) || 0;

                      const qtyTotal = (pembeli * qty * days * lamaPeriode) / konv;
                      const estimasiSales = pembeli * qty * days * hnaST * lamaPeriode;
                      const pctMatriks = parseFloat(row.persenMatriksSc) || 0;
                      const nilaiSc = estimasiSales * (pctMatriks / 100);

                      return (
                        <tr key={idx} style={{ borderBottom: "1px solid var(--color-border)" }}>
                          <td className="px-3 py-2 font-medium" style={{ color: "var(--color-text)" }}>
                            {masterProduct.namaProduk}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--color-text-muted)" }}>
                            {qtyTotal > 0 ? `${Math.round(qtyTotal).toLocaleString("id-ID")} ${satuanLabel(masterProduct)}` : "-"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--color-text-muted)" }}>
                            {estimasiSales > 0 ? `Rp ${Math.round(estimasiSales).toLocaleString("id-ID")}` : "-"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: "var(--color-blue)" }}>
                            {nilaiSc > 0 ? `Rp ${Math.round(nilaiSc).toLocaleString("id-ID")}` : "-"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--color-text-muted)" }}>
                            {row.persenMatriksSc ? `${row.persenMatriksSc}%` : "-"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--color-text-muted)" }}>
                            {row.persenDiskon ? `${row.persenDiskon}%` : "-"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--color-text-muted)" }}>
                            {row.persenCashback ? `${row.persenCashback}%` : "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* 7. ESTIMASI & NILAI SC PER BULAN */}
        {monthlyBreakdown.length > 0 && selectedProducts.some(p => p.kodeProduk) && (
          <div className="rounded-xl border px-4 py-3 space-y-3"
            style={{ background: "var(--color-bg)", borderColor: "var(--color-blue)", borderWidth: 2, marginTop: "2rem" }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
              Estimasi &amp; Nilai SC per Bulan
            </p>
            <div className="rounded-lg overflow-hidden overflow-x-auto" style={{ border: "1px solid var(--color-border)" }}>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
                    <th className="text-left font-medium px-3 py-1.5">Bulan</th>
                    <th className="text-right font-medium px-3 py-1.5">Estimasi Sales</th>
                    <th className="text-right font-medium px-3 py-1.5">Nilai SC</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyBreakdown.map((m) => (
                    <tr key={m.month} style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <td className="px-3 py-1.5" style={{ color: "var(--color-text-muted)" }}>{m.label}</td>
                      <td className="text-right px-3 py-1.5" style={{ color: "var(--color-text)" }}>
                        {m.estimasiSales > 0 ? `Rp ${Math.round(m.estimasiSales).toLocaleString("id-ID")}` : "-"}
                      </td>
                      <td className="text-right px-3 py-1.5 font-semibold" style={{ color: "var(--color-blue)" }}>
                        {m.nilaiSc > 0 ? `Rp ${Math.round(m.nilaiSc).toLocaleString("id-ID")}` : "-"}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 600 }}>
                    <td className="px-3 py-1.5" style={{ color: "var(--color-text)" }}>Total</td>
                    <td className="text-right px-3 py-1.5" style={{ color: "var(--color-text)" }}>
                      Rp {Math.round(totalMonthlyEstimasiSales).toLocaleString("id-ID")}
                    </td>
                    <td className="text-right px-3 py-1.5 font-bold" style={{ color: "var(--color-blue)" }}>
                      Rp {Math.round(totalMonthlyNilaiSc).toLocaleString("id-ID")}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

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
          doctorName={doctorName}
          productsMenang={productsMenang}
          productsInsentif={productsInsentif}
          insentifHistory={insentifHistory}
        />
      )}
    </>
  );
}
