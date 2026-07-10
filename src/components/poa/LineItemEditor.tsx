"use client";

import { useState, useTransition, useMemo } from "react";
import type { PoaLineItem } from "@prisma/client";
import type { Customer, Product } from "@/lib/masterData";
import { addLineItemAction, updateLineItemAction, deleteLineItemAction } from "@/app/actions/lineItem";
import { computePeriodeAkhir, formatPeriodeRange, LAMA_PERIODE_OPTIONS } from "@/lib/poaUtils";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";

const STATUS_STANDARISASI_LABELS: Record<string, string> = {
  SUDAH_STANDARISASI: "Sudah Standarisasi",
  PROSES_PENGAJUAN: "Proses Pengajuan",
  BELUM_STANDARISASI: "Belum Standarisasi",
};

interface Props {
  poaId: string;
  initialItems: PoaLineItem[];
  customers: Customer[];
  products: Product[];
}

type AddForm = {
  kodeRequest: string;
  kodeProduk: string;
  lamaPeriode: number;
  periodeAwal: string;
  rencanaTotalBiaya: string;
  rencanaVisitMinggu: string;
  produkKompetitor: string;
  statusStandarisasi: string;
  hariKerjaBulan: string;
  jumlahPasienHari: string;
  jumlahResepHari: string;
  qtyProdukResep: string;
};

const EMPTY_FORM: AddForm = {
  kodeRequest: "",
  kodeProduk: "",
  lamaPeriode: 3,
  periodeAwal: "",
  rencanaTotalBiaya: "",
  rencanaVisitMinggu: "",
  produkKompetitor: "",
  statusStandarisasi: "",
  hariKerjaBulan: "",
  jumlahPasienHari: "",
  jumlahResepHari: "",
  qtyProdukResep: "",
};

function groupByKodeRequest(items: PoaLineItem[]): Map<string, PoaLineItem[]> {
  const map = new Map<string, PoaLineItem[]>();
  for (const item of items) {
    const group = map.get(item.kodeRequest) ?? [];
    group.push(item);
    map.set(item.kodeRequest, group);
  }
  return map;
}

function formatRp(val: string | number | { toString(): string } | null | undefined) {
  if (val == null) return "—";
  const n = parseFloat(val.toString());
  if (isNaN(n)) return "—";
  return "Rp " + n.toLocaleString("id-ID");
}

// ─── Section label ────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-xs font-semibold uppercase tracking-wider mb-2"
      style={{ color: "var(--color-text-faint)" }}
    >
      {children}
    </p>
  );
}

// ─── Read-only info chip ──────────────────────────────────────────────────────
function InfoField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>{label}</span>
      <span
        className="text-sm px-2.5 py-1.5 rounded-md"
        style={{
          background: "var(--color-bg-subtle)",
          color: "var(--color-text-muted)",
          border: "1px solid var(--color-border)",
        }}
      >
        {value || "—"}
      </span>
    </div>
  );
}

// ─── Edit panel for an existing item ────────────────────────────────────────
function EditPanel({
  item,
  poaId,
  onCancel,
}: {
  item: PoaLineItem;
  poaId: string;
  onCancel: () => void;
}) {
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
    <div
      className="rounded-xl border p-4 space-y-5"
      style={{ background: "var(--color-bg)", borderColor: "var(--color-primary)", borderWidth: 1.5 }}
    >
      {error && (
        <p className="text-sm px-3 py-2 rounded-md" style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>
          {error}
        </p>
      )}

      {/* Seksi 1: Info (read-only) */}
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

        {/* Seksi 2: Estimasi Volume */}
        <div>
          <SectionLabel>Estimasi Volume</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Hari Kerja / Bulan</span>
              <input name="hariKerjaBulan" type="number" min="0" max="31"
                defaultValue={item.hariKerjaBulan ?? ""} placeholder="cth: 22"
                className="input-field" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Pasien / Hari</span>
              <input name="jumlahPasienHari" type="number" min="0"
                defaultValue={item.jumlahPasienHari ?? ""} placeholder="cth: 10"
                className="input-field" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Resep / Hari</span>
              <input name="jumlahResepHari" type="number" min="0"
                defaultValue={item.jumlahResepHari ?? ""} placeholder="cth: 3"
                className="input-field" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Qty Produk / Resep</span>
              <input name="qtyProdukResep" type="number" min="0"
                defaultValue={item.qtyProdukResep ?? ""} placeholder="cth: 1"
                className="input-field" />
            </label>
          </div>
        </div>

        {/* Seksi 3: Rencana MR */}
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
                defaultValue={item.rencanaTotalBiaya.toString()}
                className="input-field" required />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Rencana Visit / Minggu</span>
              <input name="rencanaVisitMinggu" type="number" min="0"
                defaultValue={item.rencanaVisitMinggu}
                className="input-field" required />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Produk Kompetitor</span>
              <input name="produkKompetitor" type="text"
                defaultValue={item.produkKompetitor ?? ""}
                className="input-field" />
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
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Menyimpan…" : "Simpan"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Batal</Button>
        </div>
      </form>
    </div>
  );
}

// ─── Add form ────────────────────────────────────────────────────────────────
function AddPanel({
  poaId,
  customers,
  products,
  customerOptions,
  onCancel,
}: {
  poaId: string;
  customers: Customer[];
  products: Product[];
  customerOptions: { value: string; label: string; sublabel?: string }[];
  onCancel: () => void;
}) {
  const [form, setForm] = useState<AddForm>(EMPTY_FORM);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.kodeRequest === form.kodeRequest) ?? null,
    [customers, form.kodeRequest]
  );

  const productOptions = useMemo(
    () =>
      products.map((p) => ({
        value: p.kodeProduk,
        label: p.namaProduk,
        sublabel: `${p.kodeProduk} · ${p.namaGroupBrand} · ${p.satuan}`,
      })),
    [products]
  );

  function set(field: keyof AddForm, value: string | number) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "kodeRequest") next.kodeProduk = "";
      return next;
    });
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

  const periodeOk = form.periodeAwal.length === 6;

  return (
    <div
      className="rounded-xl border p-4 space-y-5"
      style={{ background: "var(--color-bg)", borderColor: "var(--color-primary)", borderWidth: 1.5 }}
    >
      <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Tambah Baris Baru</p>

      {error && (
        <p className="text-sm px-3 py-2 rounded-md" style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Seksi 1: Pilih Outlet & Produk */}
        <div>
          <SectionLabel>Outlet &amp; Produk</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Outlet</span>
              <Combobox
                name="kodeRequest"
                value={form.kodeRequest}
                onChange={(v) => set("kodeRequest", v)}
                placeholder="Cari kode PI atau nama outlet…"
                required
                options={customerOptions}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Produk</span>
              <Combobox
                name="kodeProduk"
                value={form.kodeProduk}
                onChange={(v) => set("kodeProduk", v)}
                placeholder="Cari produk…"
                required
                disabled={!form.kodeRequest}
                options={productOptions}
              />
            </div>
          </div>

          {/* Info customer setelah pilih */}
          {selectedCustomer && (
            <div
              className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-lg px-3 py-2 text-xs"
              style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}
            >
              <span><span style={{ color: "var(--color-text-faint)" }}>Customer:</span> {selectedCustomer.namaCust}</span>
              <span><span style={{ color: "var(--color-text-faint)" }}>Spesialisasi:</span> {selectedCustomer.spesialisasi}</span>
              <span><span style={{ color: "var(--color-text-faint)" }}>Role:</span> {selectedCustomer.role}</span>
              {selectedCustomer.historisPSSP && (
                <span><span style={{ color: "var(--color-text-faint)" }}>Historis PSSP:</span> {selectedCustomer.historisPSSP}</span>
              )}
            </div>
          )}
        </div>

        {/* Seksi 2: Estimasi Volume */}
        <div>
          <SectionLabel>Estimasi Volume</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Hari Kerja / Bulan</span>
              <input name="hariKerjaBulan" type="number" min="0" max="31"
                value={form.hariKerjaBulan}
                onChange={(e) => set("hariKerjaBulan", e.target.value)}
                placeholder="cth: 22" className="input-field" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Pasien / Hari</span>
              <input name="jumlahPasienHari" type="number" min="0"
                value={form.jumlahPasienHari}
                onChange={(e) => set("jumlahPasienHari", e.target.value)}
                placeholder="cth: 10" className="input-field" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Resep / Hari</span>
              <input name="jumlahResepHari" type="number" min="0"
                value={form.jumlahResepHari}
                onChange={(e) => set("jumlahResepHari", e.target.value)}
                placeholder="cth: 3" className="input-field" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Qty Produk / Resep</span>
              <input name="qtyProdukResep" type="number" min="0"
                value={form.qtyProdukResep}
                onChange={(e) => set("qtyProdukResep", e.target.value)}
                placeholder="cth: 1" className="input-field" />
            </label>
          </div>
        </div>

        {/* Seksi 3: Rencana MR */}
        <div>
          <SectionLabel>Rencana MR</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Periode Awal (YYYYMM)</span>
              <input name="periodeAwal" type="text" pattern="\d{6}" maxLength={6}
                placeholder="202607"
                value={form.periodeAwal}
                onChange={(e) => set("periodeAwal", e.target.value)}
                className="input-field" required />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Lama Periode</span>
              <select name="lamaPeriode" value={form.lamaPeriode}
                onChange={(e) => set("lamaPeriode", parseInt(e.target.value))}
                className="input-field">
                {LAMA_PERIODE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n} bulan</option>
                ))}
              </select>
            </label>
            {periodeOk && (
              <div className="flex flex-col justify-end">
                <span className="text-xs pb-1" style={{ color: "var(--color-text-faint)" }}>
                  {formatPeriodeRange(form.periodeAwal, form.lamaPeriode)}
                  {" · akhir "}
                  <span style={{ color: "var(--color-text-muted)" }}>
                    {computePeriodeAkhir(form.periodeAwal, form.lamaPeriode)}
                  </span>
                </span>
              </div>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Rencana Total Biaya (Rp)</span>
              <input name="rencanaTotalBiaya" type="number" min="0" step="1000"
                value={form.rencanaTotalBiaya}
                onChange={(e) => set("rencanaTotalBiaya", e.target.value)}
                className="input-field" required />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Rencana Visit / Minggu</span>
              <input name="rencanaVisitMinggu" type="number" min="0"
                value={form.rencanaVisitMinggu}
                onChange={(e) => set("rencanaVisitMinggu", e.target.value)}
                className="input-field" required />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Produk Kompetitor</span>
              <input name="produkKompetitor" type="text"
                value={form.produkKompetitor}
                onChange={(e) => set("produkKompetitor", e.target.value)}
                className="input-field" />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Status Standarisasi</span>
              <select name="statusStandarisasi" value={form.statusStandarisasi}
                onChange={(e) => set("statusStandarisasi", e.target.value)}
                className="input-field">
                <option value="">— Pilih —</option>
                {Object.entries(STATUS_STANDARISASI_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Menyimpan…" : "Tambah Baris"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Batal</Button>
        </div>
      </form>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export function LineItemEditor({ poaId, initialItems, customers, products }: Props) {
  const [items, setItems] = useState<PoaLineItem[]>(initialItems);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const customerOptions = useMemo(
    () =>
      customers.map((c) => ({
        value: c.kodeRequest,
        label: c.kodePI ? `${c.kodePI} - ${c.namaOutlet}` : c.namaOutlet,
        sublabel: `${c.namaCust} · ${c.spesialisasi}`,
      })),
    [customers]
  );

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

  const grouped = groupByKodeRequest(items);

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md px-4 py-2 text-sm"
          style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>
          {error}
        </div>
      )}

      {/* ── Grouped line items ──────────────────────────────────────────────── */}
      {grouped.size === 0 ? (
        <div
          className="rounded-xl border-2 border-dashed py-10 text-center"
          style={{ borderColor: "var(--color-border)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>
            Belum ada baris.
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--color-text-faint)" }}>
            Klik "+ Tambah Baris" di bawah untuk mulai.
          </p>
        </div>
      ) : (
        Array.from(grouped.entries()).map(([kodeRequest, rows]) => {
          const first = rows[0];
          return (
            <div
              key={kodeRequest}
              className="rounded-xl border overflow-hidden"
              style={{ borderColor: "var(--color-border)" }}
            >
              {/* Customer header */}
              <div
                className="px-4 py-2.5 flex items-center gap-2 flex-wrap"
                style={{ background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}
              >
                <span
                  className="text-xs font-mono px-2 py-0.5 rounded"
                  style={{ background: "var(--color-border)", color: "var(--color-text-muted)" }}
                >
                  {first.kodePI ?? first.kodeRequest}
                </span>
                <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                  {first.namaOutlet}
                </span>
                <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>·</span>
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{first.namaCust}</span>
                <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>·</span>
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{first.spesialisasi}</span>
              </div>

              {/* Product rows */}
              <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {rows.map((item) => (
                  <div key={item.id}>
                    {/* Summary row */}
                    <div className="px-4 py-3 flex items-center gap-3">
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
                          {(item.hariKerjaBulan || item.jumlahPasienHari) && (
                            <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                              {[
                                item.hariKerjaBulan ? `${item.hariKerjaBulan} hr` : null,
                                item.jumlahPasienHari ? `${item.jumlahPasienHari} pasien` : null,
                                item.jumlahResepHari ? `${item.jumlahResepHari} resep` : null,
                                item.qtyProdukResep ? `${item.qtyProdukResep} qty` : null,
                              ].filter(Boolean).join(" · ")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <button
                          type="button"
                          className="text-xs font-medium"
                          style={{ color: "var(--color-primary)" }}
                          onClick={() => setEditingId(editingId === item.id ? null : item.id)}
                        >
                          {editingId === item.id ? "Tutup" : "Edit"}
                        </button>
                        <button
                          type="button"
                          className="text-xs font-medium"
                          style={{ color: "var(--color-red)" }}
                          onClick={() => handleDelete(item.id)}
                          disabled={isPending}
                        >
                          Hapus
                        </button>
                      </div>
                    </div>

                    {/* Inline edit panel */}
                    {editingId === item.id && (
                      <div className="px-4 pb-4">
                        <EditPanel
                          item={item}
                          poaId={poaId}
                          onCancel={() => setEditingId(null)}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}

      {/* ── Add panel ──────────────────────────────────────────────────────── */}
      {showAddForm ? (
        <AddPanel
          poaId={poaId}
          customers={customers}
          products={products}
          customerOptions={customerOptions}
          onCancel={() => setShowAddForm(false)}
        />
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => { setShowAddForm(true); setEditingId(null); }}
        >
          + Tambah Baris
        </Button>
      )}
    </div>
  );
}
