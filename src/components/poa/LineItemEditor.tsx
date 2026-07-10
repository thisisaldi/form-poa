"use client";

import { useState, useTransition, useMemo } from "react";
import type { PoaLineItem } from "@prisma/client";
import type { Product } from "@/lib/masterData";
import { addLineItemAction, updateLineItemAction, deleteLineItemAction } from "@/app/actions/lineItem";
import { getSpesialisasiByOutlet, getCustomersByOutletSpesialisasi, type CustomerOption } from "@/app/actions/customer";
import { computePeriodeAkhir, formatPeriodeRange, LAMA_PERIODE_OPTIONS } from "@/lib/poaUtils";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";

const STATUS_STANDARISASI_LABELS: Record<string, string> = {
  SUDAH_STANDARISASI: "Sudah Standarisasi",
  PROSES_PENGAJUAN: "Proses Pengajuan",
  BELUM_STANDARISASI: "Belum Standarisasi",
};

interface OutletOption {
  kodePI: string;
  namaOutlet: string;
}

interface Props {
  poaId: string;
  initialItems: PoaLineItem[];
  outlets: OutletOption[];
  products: Product[];
}

function formatRp(val: string | number | { toString(): string } | null | undefined) {
  if (val == null) return "—";
  const n = parseFloat(val.toString());
  if (isNaN(n)) return "—";
  return "Rp " + n.toLocaleString("id-ID");
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider mb-2"
      style={{ color: "var(--color-text-faint)" }}>
      {children}
    </p>
  );
}

function InfoField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>{label}</span>
      <span className="text-sm px-2.5 py-1.5 rounded-md"
        style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
        {value || "—"}
      </span>
    </div>
  );
}

// ─── Edit panel ───────────────────────────────────────────────────────────────
function EditPanel({ item, poaId, onCancel }: { item: PoaLineItem; poaId: string; onCancel: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await updateLineItemAction(poaId, item.id, fd);
        window.location.reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan.");
      }
    });
  }

  return (
    <div className="rounded-xl border p-4 space-y-5"
      style={{ background: "var(--color-bg)", borderColor: "var(--color-primary)", borderWidth: 1.5 }}>
      {error && (
        <p className="text-sm px-3 py-2 rounded-md"
          style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>
      )}

      <div>
        <SectionLabel>Info Customer &amp; Produk</SectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <InfoField label="Outlet" value={item.kodePI ? `${item.kodePI} - ${item.namaOutlet}` : item.namaOutlet} />
          <InfoField label="Nama Customer" value={item.namaCust} />
          <InfoField label="Spesialisasi" value={item.spesialisasi} />
          <InfoField label="Produk" value={item.namaProduk} />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <input type="hidden" name="periodeAwal" value={item.periodeAwal} />

        <div>
          <SectionLabel>Estimasi Volume</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Hari Kerja / Bulan</span>
              <input name="hariKerjaBulan" type="number" min="0" max="31"
                defaultValue={item.hariKerjaBulan ?? ""} placeholder="cth: 22" className="input-field" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Pasien / Hari</span>
              <input name="jumlahPasienHari" type="number" min="0"
                defaultValue={item.jumlahPasienHari ?? ""} placeholder="cth: 10" className="input-field" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Resep / Hari</span>
              <input name="jumlahResepHari" type="number" min="0"
                defaultValue={item.jumlahResepHari ?? ""} placeholder="cth: 3" className="input-field" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Qty Produk / Resep</span>
              <input name="qtyProdukResep" type="number" min="0"
                defaultValue={item.qtyProdukResep ?? ""} placeholder="cth: 1" className="input-field" />
            </label>
          </div>
        </div>

        <div>
          <SectionLabel>Rencana MR</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Lama Periode</span>
              <select name="lamaPeriode" defaultValue={item.lamaPeriode} className="input-field">
                {LAMA_PERIODE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n} bulan</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Rencana Total Biaya (Rp)</span>
              <input name="rencanaTotalBiaya" type="number" min="0" step="1000"
                defaultValue={item.rencanaTotalBiaya.toString()} className="input-field" required />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Rencana Visit / Minggu</span>
              <input name="rencanaVisitMinggu" type="number" min="0"
                defaultValue={item.rencanaVisitMinggu} className="input-field" required />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Produk Kompetitor</span>
              <input name="produkKompetitor" type="text"
                defaultValue={item.produkKompetitor ?? ""} className="input-field" />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Status Standarisasi</span>
              <select name="statusStandarisasi" defaultValue={item.statusStandarisasi ?? ""} className="input-field">
                <option value="">— Pilih —</option>
                {Object.entries(STATUS_STANDARISASI_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs mt-2" style={{ color: "var(--color-text-faint)" }}>
            Periode: <span style={{ color: "var(--color-text-muted)" }}>
              {formatPeriodeRange(item.periodeAwal, item.lamaPeriode)}
            </span>
          </p>
        </div>

        <div className="flex gap-2 pt-1">
          <Button type="submit" size="sm" disabled={isPending}>{isPending ? "Menyimpan…" : "Simpan"}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Batal</Button>
        </div>
      </form>
    </div>
  );
}

// ─── Add panel ────────────────────────────────────────────────────────────────
function AddPanel({
  poaId,
  outlets,
  products,
  onCancel,
}: {
  poaId: string;
  outlets: OutletOption[];
  products: Product[];
  onCancel: () => void;
}) {
  const [kodePI, setKodePI] = useState("");
  const [spesialisasi, setSpesialisasi] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [kodeProduk, setKodeProduk] = useState("");
  const [extraFields, setExtraFields] = useState({
    lamaPeriode: 3, periodeAwal: "", rencanaTotalBiaya: "", rencanaVisitMinggu: "",
    produkKompetitor: "", statusStandarisasi: "", hariKerjaBulan: "", jumlahPasienHari: "",
    jumlahResepHari: "", qtyProdukResep: "",
  });

  const [specList, setSpecList] = useState<string[]>([]);
  const [customerList, setCustomerList] = useState<CustomerOption[]>([]);
  const [loadingSpec, startLoadSpec] = useTransition();
  const [loadingCust, startLoadCust] = useTransition();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const outletOptions = useMemo(() => outlets.map((o) => ({
    value: o.kodePI,
    label: `${o.kodePI} - ${o.namaOutlet}`,
  })), [outlets]);

  const specOptions = useMemo(() => specList.map((s) => ({ value: s, label: s })), [specList]);

  const customerOptions = useMemo(() => customerList.map((c) => ({
    value: c.id,
    label: c.namaCustomer,
    sublabel: c.isFokus ? "⭐ Fokus" : undefined,
  })), [customerList]);

  const productOptions = useMemo(() => products.map((p) => ({
    value: p.kodeProduk,
    label: p.namaProduk,
    sublabel: `${p.kodeProduk} · ${p.namaGroupBrand} · ${p.satuan}`,
  })), [products]);

  const selectedCustomer = useMemo(() => customerList.find((c) => c.id === customerId) ?? null, [customerList, customerId]);
  const selectedOutlet = useMemo(() => outlets.find((o) => o.kodePI === kodePI) ?? null, [outlets, kodePI]);

  function handleOutletChange(val: string) {
    setKodePI(val);
    setSpesialisasi("");
    setCustomerId("");
    setSpecList([]);
    setCustomerList([]);
    if (!val) return;
    startLoadSpec(async () => {
      const specs = await getSpesialisasiByOutlet(val);
      setSpecList(specs);
    });
  }

  function handleSpecChange(val: string) {
    setSpesialisasi(val);
    setCustomerId("");
    setCustomerList([]);
    if (!val || !kodePI) return;
    startLoadCust(async () => {
      const customers = await getCustomersByOutletSpesialisasi(kodePI, val);
      setCustomerList(customers);
    });
  }

  function setExtra(field: keyof typeof extraFields, value: string | number) {
    setExtraFields((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await addLineItemAction(poaId, fd);
        window.location.reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menambahkan baris.");
      }
    });
  }

  const periodeOk = extraFields.periodeAwal.length === 6;

  return (
    <div className="rounded-xl border p-4 space-y-5"
      style={{ background: "var(--color-bg)", borderColor: "var(--color-primary)", borderWidth: 1.5 }}>
      <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Tambah Baris Baru</p>

      {error && (
        <p className="text-sm px-3 py-2 rounded-md"
          style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Hidden fields for server action */}
        <input type="hidden" name="customerId" value={customerId} />
        <input type="hidden" name="kodePI" value={kodePI} />

        {/* Seksi 1: Cascade outlet → spesialisasi → dokter */}
        <div>
          <SectionLabel>Outlet &amp; Dokter</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Outlet</span>
              <Combobox name="_outlet" value={kodePI} onChange={handleOutletChange}
                placeholder="Cari outlet…" required options={outletOptions} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                Spesialisasi {loadingSpec && <span style={{ color: "var(--color-text-faint)" }}>…</span>}
              </span>
              <Combobox name="_spesialisasi" value={spesialisasi} onChange={handleSpecChange}
                placeholder={kodePI ? (loadingSpec ? "Memuat…" : "Pilih spesialisasi") : "Pilih outlet dulu"}
                disabled={!kodePI || loadingSpec} required options={specOptions} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                Dokter {loadingCust && <span style={{ color: "var(--color-text-faint)" }}>…</span>}
              </span>
              <Combobox name="_dokter" value={customerId} onChange={setCustomerId}
                placeholder={spesialisasi ? (loadingCust ? "Memuat…" : "Pilih dokter") : "Pilih spesialisasi dulu"}
                disabled={!spesialisasi || loadingCust} required options={customerOptions} />
            </div>
          </div>

          {/* Info setelah dokter dipilih */}
          {selectedCustomer && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 rounded-lg px-3 py-2 text-xs"
              style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>
              {selectedCustomer.kodeCustomer && (
                <span><span style={{ color: "var(--color-text-faint)" }}>Kode:</span> {selectedCustomer.kodeCustomer}</span>
              )}
              <span><span style={{ color: "var(--color-text-faint)" }}>Outlet:</span> {selectedOutlet?.namaOutlet}</span>
              <span><span style={{ color: "var(--color-text-faint)" }}>Spesialisasi:</span> {selectedCustomer.spesialisasi}</span>
              {selectedCustomer.isFokus && (
                <span style={{ color: "var(--color-primary)" }}>⭐ Dokter Fokus</span>
              )}
            </div>
          )}
        </div>

        {/* Seksi 2: Produk */}
        <div>
          <SectionLabel>Produk</SectionLabel>
          <div className="flex flex-col gap-1">
            <Combobox name="kodeProduk" value={kodeProduk} onChange={setKodeProduk}
              placeholder="Cari produk…" required
              disabled={!customerId} options={productOptions} />
          </div>
        </div>

        {/* Seksi 3: Estimasi Volume */}
        <div>
          <SectionLabel>Estimasi Volume</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Hari Kerja / Bulan</span>
              <input name="hariKerjaBulan" type="number" min="0" max="31"
                value={extraFields.hariKerjaBulan} onChange={(e) => setExtra("hariKerjaBulan", e.target.value)}
                placeholder="cth: 22" className="input-field" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Pasien / Hari</span>
              <input name="jumlahPasienHari" type="number" min="0"
                value={extraFields.jumlahPasienHari} onChange={(e) => setExtra("jumlahPasienHari", e.target.value)}
                placeholder="cth: 10" className="input-field" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Resep / Hari</span>
              <input name="jumlahResepHari" type="number" min="0"
                value={extraFields.jumlahResepHari} onChange={(e) => setExtra("jumlahResepHari", e.target.value)}
                placeholder="cth: 3" className="input-field" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Qty Produk / Resep</span>
              <input name="qtyProdukResep" type="number" min="0"
                value={extraFields.qtyProdukResep} onChange={(e) => setExtra("qtyProdukResep", e.target.value)}
                placeholder="cth: 1" className="input-field" />
            </label>
          </div>
        </div>

        {/* Seksi 4: Rencana MR */}
        <div>
          <SectionLabel>Rencana MR</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Periode Awal (YYYYMM)</span>
              <input name="periodeAwal" type="text" pattern="\d{6}" maxLength={6} placeholder="202607"
                value={extraFields.periodeAwal} onChange={(e) => setExtra("periodeAwal", e.target.value)}
                className="input-field" required />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Lama Periode</span>
              <select name="lamaPeriode" value={extraFields.lamaPeriode}
                onChange={(e) => setExtra("lamaPeriode", parseInt(e.target.value))} className="input-field">
                {LAMA_PERIODE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n} bulan</option>
                ))}
              </select>
            </label>
            {periodeOk && (
              <div className="flex flex-col justify-end">
                <span className="text-xs pb-1" style={{ color: "var(--color-text-faint)" }}>
                  {formatPeriodeRange(extraFields.periodeAwal, extraFields.lamaPeriode)}
                  {" · akhir "}
                  <span style={{ color: "var(--color-text-muted)" }}>
                    {computePeriodeAkhir(extraFields.periodeAwal, extraFields.lamaPeriode)}
                  </span>
                </span>
              </div>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Rencana Total Biaya (Rp)</span>
              <input name="rencanaTotalBiaya" type="number" min="0" step="1000"
                value={extraFields.rencanaTotalBiaya} onChange={(e) => setExtra("rencanaTotalBiaya", e.target.value)}
                className="input-field" required />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Rencana Visit / Minggu</span>
              <input name="rencanaVisitMinggu" type="number" min="0"
                value={extraFields.rencanaVisitMinggu} onChange={(e) => setExtra("rencanaVisitMinggu", e.target.value)}
                className="input-field" required />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Produk Kompetitor</span>
              <input name="produkKompetitor" type="text"
                value={extraFields.produkKompetitor} onChange={(e) => setExtra("produkKompetitor", e.target.value)}
                className="input-field" />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Status Standarisasi</span>
              <select name="statusStandarisasi" value={extraFields.statusStandarisasi}
                onChange={(e) => setExtra("statusStandarisasi", e.target.value)} className="input-field">
                <option value="">— Pilih —</option>
                {Object.entries(STATUS_STANDARISASI_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <Button type="submit" size="sm" disabled={isPending || !customerId || !kodeProduk}>
            {isPending ? "Menyimpan…" : "Tambah Baris"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Batal</Button>
        </div>
      </form>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function LineItemEditor({ poaId, initialItems, outlets, products }: Props) {
  const [items, setItems] = useState<PoaLineItem[]>(initialItems);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete(itemId: string) {
    if (!confirm("Hapus baris ini?")) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteLineItemAction(poaId, itemId);
        setItems((prev) => prev.filter((li) => li.id !== itemId));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menghapus.");
      }
    });
  }

  // Group by outlet then by customer
  const grouped = useMemo(() => {
    const byOutlet = new Map<string, Map<string, PoaLineItem[]>>();
    for (const item of items) {
      const outletKey = item.kodePI ?? item.namaOutlet;
      if (!byOutlet.has(outletKey)) byOutlet.set(outletKey, new Map());
      const byCustomer = byOutlet.get(outletKey)!;
      const custKey = item.namaCust ?? "—";
      if (!byCustomer.has(custKey)) byCustomer.set(custKey, []);
      byCustomer.get(custKey)!.push(item);
    }
    return byOutlet;
  }, [items]);

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md px-4 py-2 text-sm"
          style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</div>
      )}

      {grouped.size === 0 ? (
        <div className="rounded-xl border-2 border-dashed py-10 text-center"
          style={{ borderColor: "var(--color-border)" }}>
          <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>Belum ada baris.</p>
          <p className="text-xs mt-1" style={{ color: "var(--color-text-faint)" }}>
            Klik "+ Tambah Baris" di bawah untuk mulai.
          </p>
        </div>
      ) : (
        Array.from(grouped.entries()).map(([outletKey, byCustomer]) => {
          const firstItem = byCustomer.values().next().value![0];
          return (
            <div key={outletKey} className="rounded-xl border overflow-hidden"
              style={{ borderColor: "var(--color-border)" }}>
              {/* Outlet header */}
              <div className="px-4 py-2.5 flex items-center gap-2"
                style={{ background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
                <span className="text-xs font-mono px-2 py-0.5 rounded"
                  style={{ background: "var(--color-border)", color: "var(--color-text-muted)" }}>
                  {firstItem.kodePI ?? outletKey}
                </span>
                <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                  {firstItem.namaOutlet}
                </span>
              </div>

              {/* Per-customer sections */}
              {Array.from(byCustomer.entries()).map(([custKey, custItems]) => {
                const cItem = custItems[0];
                return (
                  <div key={custKey} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                    {/* Doctor sub-header */}
                    <div className="px-4 py-2 flex items-center gap-2 flex-wrap"
                      style={{ background: "var(--color-bg)" }}>
                      <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{cItem.namaCust}</span>
                      <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>·</span>
                      <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{cItem.spesialisasi}</span>
                      {cItem.kodeCust && (
                        <>
                          <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>·</span>
                          <span className="text-xs font-mono" style={{ color: "var(--color-text-faint)" }}>{cItem.kodeCust}</span>
                        </>
                      )}
                    </div>

                    {/* Product rows */}
                    <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                      {custItems.map((item) => (
                        <div key={item.id}>
                          <div className="px-4 pl-8 py-3 flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
                                {item.namaProduk}
                              </p>
                              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                                <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                                  {formatPeriodeRange(item.periodeAwal, item.lamaPeriode)}
                                </span>
                                <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                                  {formatRp(item.rencanaTotalBiaya)} / periode
                                </span>
                                <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                                  {item.rencanaVisitMinggu}× visit/minggu
                                </span>
                                {item.statusStandarisasi && (
                                  <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                                    {STATUS_STANDARISASI_LABELS[item.statusStandarisasi]}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <button type="button" className="text-xs font-medium"
                                style={{ color: "var(--color-primary)" }}
                                onClick={() => setEditingId(editingId === item.id ? null : item.id)}>
                                {editingId === item.id ? "Tutup" : "Edit"}
                              </button>
                              <button type="button" className="text-xs font-medium"
                                style={{ color: "var(--color-red)" }}
                                onClick={() => handleDelete(item.id)} disabled={isPending}>
                                Hapus
                              </button>
                            </div>
                          </div>
                          {editingId === item.id && (
                            <div className="px-4 pb-4">
                              <EditPanel item={item} poaId={poaId} onCancel={() => setEditingId(null)} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })
      )}

      {showAddForm ? (
        <AddPanel poaId={poaId} outlets={outlets} products={products} onCancel={() => setShowAddForm(false)} />
      ) : (
        <Button type="button" variant="secondary" size="sm"
          onClick={() => { setShowAddForm(true); setEditingId(null); }}>
          + Tambah Baris
        </Button>
      )}
    </div>
  );
}
