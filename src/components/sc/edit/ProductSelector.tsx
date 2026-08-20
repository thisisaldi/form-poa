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
  productsOptions: { value: string; label: string; isScProduct?: boolean }[];
  canvasserProducts: SalesCounterProduct[];
  masterProducts: Product[];
  hariKerjaBulan: number;
  lamaPeriode: number;
  error?: string;
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
  error,
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
          const nilaiSc = estimasiSales * (pctMatriks / 100);
          const nilaiScBln = lamaPeriode > 0 ? nilaiSc / lamaPeriode : 0;
          const nilaiSc3Bln = nilaiScBln * 3;

          return (
            <div
              key={idx}
              className="p-4 rounded-lg border space-y-4 relative animate-fade-in"
              style={{ borderColor: "var(--color-border)", background: "var(--color-bg-subtle)" }}
            >
              {/* Product Card Header */}
              {rows.length > 1 && (
                <div className="flex justify-end">
                  <Button type="button" size="sm" variant="danger" onClick={() => onRemoveRow(idx)}>
                    Hapus
                  </Button>
                </div>
              )}

              {/* 1. Combobox to select product */}
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
                  placeholder="Pilih Produk..."
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

              {/* 2. Competitor */}
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                  Produk Kompetitor Utama yang dipakai Sales Counter
                </span>
                <input
                  type="text"
                  value={row.produkKompetitor}
                  onChange={(e) => onUpdateRow(idx, { produkKompetitor: e.target.value })}
                  placeholder="Nama produk kompetitor utama yang digunakan Sales Counter"
                  className="input-field text-xs w-full"
                />
              </div>

              {/* 3. Numeric inputs row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                    Pembeli / Hari <Req />
                  </span>
                  <UnitInput
                    value={row.pembeliHari}
                    onChange={(val) => onUpdateRow(idx, { pembeliHari: val })}
                    unit="Pembeli"
                    placeholder="0"
                  />
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
                  />
                </div>
              </div>

              {/* 4. Percentage inputs row */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                    % Matriks SC
                  </span>
                  <UnitInput
                    value={row.persenMatriksSc}
                    onChange={(val) => onUpdateRow(idx, { persenMatriksSc: val })}
                    unit="%"
                    placeholder="0"
                  />
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
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                    % Cashback
                  </span>
                  <UnitInput
                    value={row.persenCashback}
                    onChange={(val) => onUpdateRow(idx, { persenCashback: val })}
                    unit="%"
                    placeholder="0"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                    Nilai SC (Autofill)
                  </span>
                  <div className="input-field flex items-center bg-transparent" style={{ background: "var(--color-bg-subtle)", opacity: 0.85, height: 32, cursor: "not-allowed" }}>
                    <span className="text-xs font-semibold px-1">Rp {formatRp(canvasserProduct?.sales_counter_value || 0)}</span>
                  </div>
                </div>
              </div>

              {/* 5. Summary calculations display */}
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

                    <div className="pt-1.5 border-t" style={{ borderColor: "var(--color-border)" }}>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs font-semibold" style={{ color: "var(--color-text-faint)" }}>Growth Estimasi</div>
                          <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                            Belum ada data SC
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* NILAI SC CARD */}
                  <div className="rounded-lg border px-3 py-2.5 space-y-2"
                    style={{ background: "var(--color-bg)", borderColor: "var(--color-blue, #3b82f6)" }}>
                    <p className="text-xs font-semibold uppercase tracking-wider"
                      style={{ color: "var(--color-blue, #3b82f6)" }}>Nilai SC</p>
                    
                    <div className="flex gap-6 flex-wrap">
                      <div>
                        <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                          Nilai SC / Bln {pctMatriks > 0 && `(${pctMatriks.toFixed(1)}%)`}
                        </div>
                        <div className="text-sm font-semibold" style={{ color: "var(--color-blue, #3b82f6)" }}>
                          {formatRp((pembeli * qty * days * hnaST) * (pctMatriks / 100))}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                          Nilai SC 3 Bln
                        </div>
                        <div className="text-sm font-semibold" style={{ color: "var(--color-blue, #3b82f6)" }}>
                          {formatRp((pembeli * qty * days * hnaST * 3) * (pctMatriks / 100))}
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

      <div className="flex justify-start">
        <Button type="button" size="sm" variant="secondary" onClick={onAddRow}>
          + Tambah Produk
        </Button>
      </div>
    </div>
  );
}