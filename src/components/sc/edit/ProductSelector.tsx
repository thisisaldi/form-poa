"use client";

import type { SalesCounterProduct } from "@/app/(app)/sc/[id]/_models/SalesCounterProductModel";
import type { SelectedProductRow } from "./hooks/useSalesCounterEditor";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { UnitInput } from "./UnitInput";
import type { Product } from "@/lib/masterData";

interface ProductSelectorProps {
  rows: SelectedProductRow[];
  onAddRow: () => void;
  onRemoveRow: (index: number) => void;
  onUpdateRow: (index: number, fields: Partial<SelectedProductRow>) => void;
  productsOptions: any[];
  canvasserProducts: SalesCounterProduct[];
  masterProducts: Product[];
  hariKerjaBulan: number;
  lamaPeriode: number;
  surveyPasienHarian?: string;
  error?: string;
  readOnly?: boolean;
  b3SalesMap?: Map<string, number>;
  b3RangeLabel?: string;
}

function Req() {
  return <span style={{ color: "var(--color-red)", marginLeft: 2 }}>*</span>;
}

function formatRp(val: string | number | null | undefined) {
  if (val == null) return "-";
  const n = typeof val === "number" ? val : parseFloat(val.toString());
  if (isNaN(n)) return "-";
  return Math.round(n).toLocaleString("id-ID");
}

function satuanLabel(product: Product | null | undefined): string {
  const s = product?.satuan?.trim();
  return s && !/^[-—–]$/.test(s) ? s : "SJ";
}

export function ProductSelector({
  rows,
  onAddRow,
  onRemoveRow,
  onUpdateRow,
  productsOptions,
  canvasserProducts,
  masterProducts,
  hariKerjaBulan,
  lamaPeriode,
  surveyPasienHarian,
  error,
  readOnly = false,
  b3SalesMap,
  b3RangeLabel,
}: ProductSelectorProps) {
  return (
    <div className="space-y-4">


      {error && <p className="text-xs font-semibold" style={{ color: "var(--color-red)" }}>{error}</p>}

      <div className="space-y-4">
        {rows.map((row, idx) => {
          const masterProduct = masterProducts.find((p) => p.kodeProduk === row.kodeProduk);
          const canvasserProduct = canvasserProducts.find((p) => p.pro_code === row.kodeProduk);
          
          const hnaSJ = masterProduct ? (parseFloat(masterProduct.hna) || 0) : 0;
          const konv = masterProduct ? (parseInt(masterProduct.konversiPembagi || "1", 10) || 1) : 1;
          const hnaST = hnaSJ / konv;
          
          const pembeli = parseFloat(row.pembeliHari) || 0;
          const qty = parseFloat(row.qtyCustomerBaru) || 0;
          const days = hariKerjaBulan || 0;
          
          const estimasiSales = pembeli * qty * days * hnaST * lamaPeriode;
          const pctMatriks = parseFloat(row.persenMatriksSc) || 0;
          
          const qtySjBln = konv > 0 ? (pembeli * qty * days) / konv : 0;
          const scVal = canvasserProduct?.sales_counter_value;
          const scMin = canvasserProduct?.sales_counter_minimum || 0;

          let nilaiScBln = 0;
          if (scVal != null && scVal > 0) {
            nilaiScBln = qtySjBln >= scMin ? qtySjBln * scVal : 0;
          } else {
            nilaiScBln = (pembeli * qty * days * hnaST) * (pctMatriks / 100);
          }
          const nilaiSc3Bln = nilaiScBln * 3;

          return (
            <div
              key={idx}
              id={row.kodeProduk ? `sc-product-row-${row.kodeProduk}` : `sc-product-row-index-${idx}`}
              className="p-4 rounded-lg border space-y-4 relative animate-fade-in"
              style={{ borderColor: "var(--color-border)", background: "var(--color-bg-subtle)" }}
            >
              {!readOnly && (
                <div className="flex justify-end">
                  <Button type="button" size="sm" variant="danger" onClick={() => onRemoveRow(idx)}>
                    Hapus
                  </Button>
                </div>
              )}

              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                  Produk <Req />
                </span>
                <Combobox
                  name={`product-${idx}`}
                  options={productsOptions}
                  value={row.kodeProduk}
                  onChange={(val) => {
                    onUpdateRow(idx, {
                      kodeProduk: val,
                    });
                  }}
                  disabled={readOnly}
                  placeholder="Cari produk..."
                  emptyMessage="Tidak ada produk."
                />
                {masterProduct && (
                  <div className="flex gap-3 text-[11px] mt-1 flex-wrap animate-fade-in" style={{ color: "var(--color-text-faint)" }}>
                    <span>HNA SJ: <strong style={{ color: "var(--color-text-muted)" }}>{formatRp(masterProduct.hna)}</strong> ({satuanLabel(masterProduct)})</span>
                    <span>HNA ST: <strong style={{ color: "var(--color-text-muted)" }}>{formatRp(parseFloat(masterProduct.hna) / (parseInt(masterProduct.konversiPembagi || "1", 10) || 1))}</strong> ({masterProduct.satuanTerkecil ?? satuanLabel(masterProduct)})
                      <span style={{ opacity: 0.7 }}> = {formatRp(masterProduct.hna)} / {masterProduct.konversiPembagi ?? "1"}</span>
                    </span>
                    <span>{masterProduct.namaGroupBrand}</span>
                    {masterProduct.zatAktif && (
                      <span>Zat Aktif: <strong style={{ color: "var(--color-text-muted)" }}>{masterProduct.zatAktif}</strong></span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                  Produk Kompetitor
                </span>
                <input
                  type="text"
                  value={row.produkKompetitor}
                  onChange={(e) => onUpdateRow(idx, { produkKompetitor: e.target.value })}
                  placeholder="Nama produk kompetitor"
                  disabled={readOnly}
                  className="input-field text-xs w-full disabled:opacity-75 disabled:cursor-not-allowed"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
                    Customer / Hari <Req />
                  </span>
                  <UnitInput
                    value={row.pembeliHari}
                    onChange={(val) => onUpdateRow(idx, { pembeliHari: val })}
                    unit="Pembeli"
                    placeholder="0"
                    disabled={readOnly}
                  />
                  {surveyPasienHarian && (
                    <div className="text-[11px] mt-0.5 leading-tight" style={{ color: "var(--color-text-faint)" }}>
                      <span className="font-semibold" style={{ color: "var(--color-text-muted)" }}>Referensi PM: </span>
                      Survey Customer Harian: <strong>{surveyPasienHarian}</strong> orang
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                    Jml Produk ST / Customer Baru <Req />
                  </span>
                  <UnitInput
                    value={row.qtyCustomerBaru}
                    onChange={(val) => onUpdateRow(idx, { qtyCustomerBaru: val })}
                    unit={masterProduct?.satuanTerkecil ?? "ST"}
                    placeholder="0"
                    disabled={readOnly}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                    % Matriks SC (Autofill)
                  </span>
                  <div style={{ opacity: 0.85, cursor: "not-allowed" }}>
                    <UnitInput
                      value={row.persenMatriksSc}
                      onChange={() => {}}
                      unit="%"
                      placeholder="0"
                      disabled={true}
                    />
                  </div>
                  {canvasserProduct?.sales_counter_value != null && (
                    <div className="text-[11px] mt-0.5 leading-tight" style={{ color: "var(--color-text-faint)" }}>
                      <span className="font-semibold" style={{ color: "var(--color-text-muted)" }}>Nilai SC (Autofill): </span>
                      Rp {formatRp(canvasserProduct.sales_counter_value)}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                    % Diskon (DPL/DPF)
                  </span>
                  <UnitInput
                    value={row.persenDiskon}
                    onChange={(val) => onUpdateRow(idx, { persenDiskon: val })}
                    unit="%"
                    placeholder="0"
                    disabled={readOnly}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                    % Cashback (Autofill)
                  </span>
                  <div style={{ opacity: 0.85, cursor: "not-allowed" }}>
                    <UnitInput
                      value={row.persenCashback}
                      onChange={() => {}}
                      unit="%"
                      placeholder="0"
                      disabled={true}
                    />
                  </div>
                </div>
              </div>

              {row.kodeProduk &&
               parseFloat(row.pembeliHari) > 0 &&
               parseFloat(row.qtyCustomerBaru) > 0 &&
               hariKerjaBulan > 0 &&
               row.persenMatriksSc !== "" &&
               lamaPeriode > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start animate-fade-in mt-3">
                  {/* ESTIMASI SALES CARD */}
                  <div className="rounded-lg border px-3 py-2.5 space-y-2"
                    style={{ background: "var(--color-bg)", borderColor: "var(--color-border-strong)" }}>
                    <p className="text-xs font-semibold uppercase tracking-wider"
                      style={{ color: "var(--color-text-faint)" }}>Estimasi Sales</p>
                    
                    <div className="flex gap-6 flex-wrap">
                      <div>
                        <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Est. Sales / Bln</div>
                        <div className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                          {formatRp(pembeli * qty * days * hnaST)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>Est. Sales 3 Bln</div>
                        <div className="text-sm font-semibold" style={{ color: "var(--color-blue)" }}>
                          {formatRp(pembeli * qty * days * hnaST * 3)}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-6 flex-wrap">
                      <div>
                        <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                          Qty per {satuanLabel(masterProduct)} / Bln
                        </div>
                        <div className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                          {Math.round((pembeli * qty * days) / (parseInt(masterProduct?.konversiPembagi || "1", 10) || 1))} {satuanLabel(masterProduct)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                          Qty per {satuanLabel(masterProduct)} 3 Bln
                        </div>
                        <div className="text-sm font-semibold" style={{ color: "var(--color-blue)" }}>
                          {Math.round((pembeli * qty * days * 3) / (parseInt(masterProduct?.konversiPembagi || "1", 10) || 1))} {satuanLabel(masterProduct)}
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t space-y-1" style={{ borderColor: "var(--color-border)" }}>
                      {(() => {
                        const estSalesBln = pembeli * qty * days * hnaST;
                        const avgSalesBln = b3SalesMap?.get(row.kodeProduk) ?? 0;
                        let growthPct: number | null = null;
                        if (avgSalesBln > 0) {
                          growthPct = ((estSalesBln - avgSalesBln) / avgSalesBln) * 100;
                        }

                        return (
                          <>
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="text-xs font-semibold" style={{ color: "var(--color-text-faint)" }}>
                                  Growth Estimasi
                                </div>
                                {avgSalesBln > 0 ? (
                                  <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                                    SC sebelumnya {formatRp(Math.round(avgSalesBln))}/bln {b3RangeLabel ? `(${b3RangeLabel})` : ""}
                                  </div>
                                ) : (
                                  <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                                    Belum ada data SC sebelumnya
                                  </div>
                                )}
                              </div>
                              {growthPct != null ? (
                                <span
                                  className="text-sm font-semibold"
                                  style={{ color: growthPct > 0 ? "var(--color-success, #16a34a)" : "var(--color-red)" }}
                                >
                                  {growthPct >= 0 ? "+" : ""}{growthPct.toFixed(1)}%
                                </span>
                              ) : (
                                <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                                  -
                                </span>
                              )}
                            </div>
                            {growthPct != null && (
                              <p
                                className="text-xs font-semibold mt-1"
                                style={{ color: growthPct > 0 ? "var(--color-success, #16a34a)" : "var(--color-warning, #f59e0b)" }}
                              >
                                {growthPct > 0
                                  ? "✓ Estimasi sudah menunjukkan intensifikasi - pastikan nilainya sudah tepat"
                                  : "⚠️ Intensifikasi kurang — estimasi belum naik dibanding SC sebelumnya"}
                              </p>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="rounded-lg border px-3 py-2.5 space-y-2"
                    style={{ background: "var(--color-bg)", borderColor: "var(--color-blue, #3b82f6)" }}>
                    <p className="text-xs font-semibold uppercase tracking-wider"
                      style={{ color: "var(--color-blue, #3b82f6)" }}>Nilai SC</p>
                    
                    <div className="flex gap-6 flex-wrap">
                      <div>
                        <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                          Nilai SC / Bln
                        </div>
                        <div className="text-sm font-semibold" style={{ color: "var(--color-blue, #3b82f6)" }}>
                          {formatRp(nilaiScBln)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                          Nilai SC 3 Bln
                        </div>
                        <div className="text-sm font-semibold" style={{ color: "var(--color-blue, #3b82f6)" }}>
                          {formatRp(nilaiSc3Bln)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!readOnly && (
        <div className="flex justify-start">
          <Button type="button" size="sm" variant="secondary" onClick={onAddRow}>
            + Tambah Produk
          </Button>
        </div>
      )}
    </div>
  );
}