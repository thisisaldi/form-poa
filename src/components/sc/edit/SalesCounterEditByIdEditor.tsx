"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveSalesCounterFormAction } from "@/app/actions/scActions";
import { ProductSelector } from "./ProductSelector";
import { ScSidebar } from "./ScSidebar";
import { UnitInput } from "./UnitInput";
import { Button } from "@/components/ui/Button";
import { BlastInTable } from "./BlastInTable";
import { PosmTable } from "./PosmTable";
import { PerincianBudgetModal } from "./PerincianBudgetModal";
import { OnlineApotekSalesWidget } from "./OnlineApotekSalesWidget";
import { useScToast } from "../ui/ScToast";

import { QUARTER_OPTIONS } from "./constants/quarterOptions";
import type { SalesCounterEditByIdEditorProps } from "./types/editorProps";
import { formatHumanStatus, formatRpNumber as formatRp } from "./utils/formatEditUtils";
import { satuanLabel } from "./utils/productMatcherUtils";
import { SectionLabel } from "./ui";
import { useSalesCounterEditById } from "./hooks/useSalesCounterEditById";

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
  status,
}: SalesCounterEditByIdEditorProps) {
  const router = useRouter();
  const { showToast } = useScToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showBudgetModal, setShowBudgetModal] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const persenResepDokter = String(initialPersenResepDokter ?? "0");
  const quartersOptions = QUARTER_OPTIONS;

  const {
    selectedPersonIds,
    rowQuarter,
    periodeAwal,
    lamaPeriode,
    effectivePoaPeriod,
    quarterMonths,
    jumlahKaryawan,
    setJumlahKaryawan,
    jumlahPasien,
    setJumlahPasien,
    jumlahPasienResep,
    setJumlahPasienResep,
    jumlahPasienNonResep,
    products,
    entertainList,
    historyEntertain,
    loadingHistoryEntertain,
    canvasserProducts,
    rawCashbackData,
    productsMenang,
    productsInsentif,
    insentifHistory,
    historySalesData,
    salesOnlineData,
    surveyData,
    rekomendasiProduk,
    b3SalesMap,
    b3RangeLabel,
    diskonPeriode,
    productOptions,
    totalEstimasiSales,
    totalNilaiSc,
    cashbackDetails,
    isCashbackHidden,
    totalCashbackVal,
    totalDiskonVal,
    totalEntertainVal,
    totalEstimasiBudget,
    costRatio,
    effectiveOutletAvgB3Bln,
    totalGrowthPct,
    monthlyBreakdown,
    totalMonthlyEstimasiSales,
    totalMonthlyNilaiSc,
    handlePeriodeAwalChange,
    handleQuarterChange,
    selectProductFromSidebar,
    handleAddProduct: addProductRow,
    handleRemoveProduct: removeProductRow,
    handleProductChange: updateProductRow,
    updateEntertainValue,
  } = useSalesCounterEditById({
    poaPeriod,
    kodePI,
    persons,
    initialProducts,
    initialEntertainItems,
    initialPeriodeAwal,
    initialLamaPeriode,
    initialJumlahKaryawan,
    initialJumlahPasien,
    initialJumlahPasienResep,
    initialJumlahPasienNonResep,
    masterProducts,
  });

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
      {readOnly && isOwner === false && (
        <div className="rounded-md px-4 py-3 text-sm font-medium"
          style={{ background: "var(--color-blue-light, #eff6ff)", color: "var(--color-blue)", border: "1px solid var(--color-blue)" }}>
          Mode Lihat (Read-Only) — Anda melihat form ini sebagai Atasan (Akses Read-Only). Perubahan hanya dapat dilakukan oleh pemilik draf (MR).
        </div>
      )}
      {!readOnly && status && status !== "DRAFT" && status !== "REVISI" && (
        <div className="rounded-md px-4 py-3 text-sm font-medium"
          style={{ background: "var(--color-warning-bg, #fef3c7)", color: "var(--color-warning, #b45309)", border: "1px solid var(--color-warning, #f59e0b)" }}>
          Outlet ini sudah berstatus <strong>{formatHumanStatus(status)}</strong> pada periode ini. Anda dapat mengubah data rencana ini dan menyimpannya sebagai <strong>Ajukan Edit</strong> (status akan di-reset untuk di-review kembali oleh {status === "SUBMITTED_TO_NSM" || status === "APPROVED_BY_NSM" ? "NSM" : status === "SUBMITTED_TO_SM" || status === "APPROVED_BY_SM" ? "SM" : "ASM"}).
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
                  History Entertain: {loadingHistoryEntertain ? (
                    <span className="animate-pulse opacity-60">Memuat...</span>
                  ) : (
                    `Rp ${Math.round(historyEntertain ?? 0).toLocaleString("id-ID")}`
                  )}
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
                <table className="w-full text-xs text-left" style={{ borderCollapse: "collapse" }}>
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
                              <span
                                className="inline-block text-[10px] font-semibold px-1.5 py-0.2 rounded border"
                                style={{
                                  background: "rgba(22, 163, 74, 0.12)",
                                  color: "#16a34a",
                                  borderColor: "rgba(22, 163, 74, 0.3)",
                                }}
                              >
                                Baru
                              </span>
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
              {isSubmitting
                ? "Menyimpan..."
                : status && status !== "DRAFT" && status !== "REVISI"
                ? "Ajukan Edit"
                : "Simpan Perubahan"}
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
