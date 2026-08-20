"use client";

import { useState, useTransition, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Product } from "@/lib/masterData";
import { saveSalesCounterFormAction } from "@/app/actions/scActions";
import { ProductSelector } from "./ProductSelector";
import { UnitInput } from "./UnitInput";
import { Button } from "@/components/ui/Button";
import { quarterToMonths } from "@/lib/quarterUtils";
import {
  getSalesCounterProductsAction,
  getScProductMenangAction,
  getScProductWithInsentifAction,
  getScInsentifHistoryAction,
  getPrincodeProductsAction,
} from "@/app/actions/canvasser";
import type { SalesCounterProduct } from "@/app/(app)/sc/[id]/_models/SalesCounterProductModel";

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
}

interface SalesCounterEditByIdEditorProps {
  scId: string;
  poaPeriod: string;
  kodePI: string;
  namaOutlet: string | null;
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
  persons,
  initialProducts,
  initialEntertainItems,
  initialPeriodeAwal,
  initialLamaPeriode,
  initialHariKerjaBulan,
  initialRencanaVisitMinggu,
  initialSurveyPasienHarian,
  masterProducts,
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

  // Canvasser products from API (for ProductSelector)
  const [canvasserProducts, setCanvasserProducts] = useState<SalesCounterProduct[]>([]);
  const [princodeProducts, setPrincodeProducts] = useState<any[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load canvasser products for the outlet
  useEffect(() => {
    if (!kodePI) return;
    getSalesCounterProductsAction(kodePI).then((res) => {
      if (res?.data) setCanvasserProducts(res.data);
    });
    getPrincodeProductsAction().then((res) => {
      if (res?.data) setPrincodeProducts(res.data);
    });
  }, [kodePI]);

  // Quarter info
  const poaYear = parseInt(poaPeriod.slice(0, 4), 10) || new Date().getFullYear();
  const quarterMatch = poaPeriod.match(/-Q([1-4])/);
  const rowQuarter = quarterMatch ? parseInt(quarterMatch[1], 10) : 1;
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

  const totalEstimasi = products.reduce((sum, p) => sum + p.rencanaTotalBiaya, 0);
  const totalEntertain = entertainList.reduce((sum, item) => sum + (parseFloat(item.value) || 0), 0);

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
    setProducts((prev) => prev.filter((_, i) => i !== index));
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
    <form onSubmit={handleSubmit} className="space-y-6 p-6 max-w-5xl">
      <div className="space-y-6">
        <h2 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
          Edit Rencana POA (Sales Counter)
        </h2>

        {/* OUTLET — LOCKED */}
        <div className="space-y-3">
          <SectionLabel>Outlet</SectionLabel>
          <div className="rounded-lg border px-4 py-3 flex items-center gap-3"
            style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: "var(--color-text)" }}>
                {namaOutlet || kodePI}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                Kode: {kodePI}
              </p>
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
                      <th className="py-2 px-3 font-semibold" style={{ color: "var(--color-text-muted)" }}>NIK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {persons.map((p) => (
                      <tr key={p.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                        <td className="py-2 px-3 font-medium" style={{ color: "var(--color-text)" }}>{p.personName}</td>
                        <td className="py-2 px-3" style={{ color: "var(--color-text-muted)" }}>{p.positionName}</td>
                        <td className="py-2 px-3 font-mono" style={{ color: "var(--color-text-faint)" }}>{p.nik_ktp}</td>
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
                Jumlah hari kerja / Bln <span style={{ color: "var(--color-red)", marginLeft: 2 }}>*</span>
              </span>
              <div style={errors.hariKerjaBulan ? ERR_RING : undefined}>
                <UnitInput value={hariKerjaBulan} onChange={setHariKerjaBulan} unit="Hari" placeholder="Jumlah hari praktek / bulan" max={31} />
              </div>
              {errors.hariKerjaBulan && <span className="text-xs" style={{ color: "var(--color-red)" }}>{errors.hariKerjaBulan}</span>}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Rencana Visit / Bulan <span style={{ color: "var(--color-red)", marginLeft: 2 }}>*</span></span>
              <UnitInput value={rencanaVisitMinggu} onChange={setRencanaVisitMinggu} unit="Kali" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: errors.surveyPasienHarian ? "var(--color-red)" : "var(--color-text-muted)" }}>
                Survey Pasien Harian <span style={{ color: "var(--color-red)", marginLeft: 2 }}>*</span>
              </span>
              <div style={errors.surveyPasienHarian ? ERR_RING : undefined}>
                <UnitInput value={surveyPasienHarian} onChange={setSurveyPasienHarian} unit="Pasien" placeholder="Hasil survey pasien harian" />
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
                            <UnitInput value={row.value} onChange={(val) => updateEntertainValue(row.month, val)} unit="Rp" placeholder="0" />
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
          />
        </div>

        {/* TOTAL */}
        <div className="rounded-xl border px-4 py-3 space-y-4"
          style={{ background: "var(--color-bg)", borderColor: "var(--color-blue)", borderWidth: 2 }}>
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
      </div>

      {/* ACTION BUTTONS */}
      <div className="flex justify-end gap-3 pt-4 border-t" style={{ borderColor: "var(--color-border)" }}>
        <Button type="button" variant="ghost" onClick={() => router.push(`/sc/${poaPeriod}`)} disabled={isPending}>
          Batal
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Menyimpan..." : "Simpan Perubahan"}
        </Button>
      </div>
    </form>
  );
}
