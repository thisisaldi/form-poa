"use client";

import { useState, useTransition, useMemo, useEffect } from "react";
import type { PoaLineItem } from "@prisma/client";
import type { Product } from "@/lib/masterData";
import { addLineItemAction, updateLineItemAction, deleteLineItemAction } from "@/app/actions/lineItem";
import { getSpesialisasiByOutlet, getCustomersByOutletSpesialisasi, createCustomerAction, getPsspHistory, type CustomerOption, type PsspKontrakSummary } from "@/app/actions/customer";
import { computePeriodeAkhir, formatPeriodeRange } from "@/lib/poaUtils";
import { spesLabel, SPESIALISASI_PM_LABEL } from "@/lib/spesialisasi";
import { getAllPakets, sortProductsBySpesialisasi, getPaketsBySpesialisasi, getProductTier } from "@/lib/paketProduk";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";

const STATUS_STANDARISASI_LABELS: Record<string, string> = {
  SUDAH_STANDARISASI: "Sudah Standarisasi",
  PROSES_PENGAJUAN: "Proses Pengajuan",
  BELUM_STANDARISASI: "Belum Standarisasi",
};

interface OutletOption { kodePI: string; namaOutlet: string }

interface Props {
  poaId: string;
  initialItems: PoaLineItem[];
  outlets: OutletOption[];
  products: Product[];
}

// ─── Per-dokter shared fields ────────────────────────────────────────────────

interface DokterFields {
  periodeAwal: string;
  lamaPeriode: number;
  hariKerjaBulan: string;
  jumlahPasienHari: string;
  rencanaVisitMinggu: string;
  produkKompetitor: string;
}

function emptyDokterFields(periodeAwal = ""): DokterFields {
  return {
    periodeAwal, lamaPeriode: 3,
    hariKerjaBulan: "", jumlahPasienHari: "",
    rencanaVisitMinggu: "", produkKompetitor: "",
  };
}

// ─── Per-product entry ────────────────────────────────────────────────────────

interface ProdukEntry {
  uid: string; // local react key
  kodeProduk: string;
  jumlahResepHari: string;
  qtyProdukResep: string;
  statusStandarisasi: string;
  rasioEstimasiGrowth: string;   // multiplier, e.g. "1.0" / "1.2"
  persenPsspDokter: string;      // % as 0-100
  persenPsspKpdm: string;
  persenDiskon: string;
  persenDp: string;
  persenListingFee: string;
  persenEntertain: string;
}

function emptyProdukEntry(): ProdukEntry {
  return {
    uid: Math.random().toString(36).slice(2),
    kodeProduk: "", jumlahResepHari: "", qtyProdukResep: "", statusStandarisasi: "",
    rasioEstimasiGrowth: "", persenPsspDokter: "", persenPsspKpdm: "",
    persenDiskon: "", persenDp: "", persenListingFee: "", persenEntertain: "",
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRp(val: string | number | { toString(): string } | null | undefined) {
  if (val == null) return "—";
  const n = parseFloat(val.toString());
  if (isNaN(n)) return "—";
  return "Rp " + n.toLocaleString("id-ID");
}

function computeEstimasi(entry: ProdukEntry, dokter: DokterFields, product: Product | null): number {
  if (!product) return 0;
  const hna    = parseFloat(product.hna) || 0;
  const pasien = parseFloat(dokter.jumlahPasienHari) || 0;
  const resep  = parseFloat(entry.jumlahResepHari) || 0;
  const qty    = parseFloat(entry.qtyProdukResep) || 0;
  const hari   = parseFloat(dokter.hariKerjaBulan) || 0;
  const lama   = dokter.lamaPeriode || 1;
  if (!hna || !pasien || !resep || !qty || !hari) return 0;
  return Math.round(pasien * resep * qty * hari * hna * lama);
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider mb-2"
      style={{ color: "var(--color-text-faint)" }}>{children}</p>
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

// ─── DokterFieldsSection ──────────────────────────────────────────────────────
// Per-dokter fields: periode, hari kerja, pasien/hari, visit/minggu, kompetitor

function DokterFieldsSection({ fields, onChange }: {
  fields: DokterFields;
  onChange: (patch: Partial<DokterFields>) => void;
}) {
  const periodeOk = fields.periodeAwal.length === 6;

  return (
    <div className="space-y-4">
      {/* Periode */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Periode Awal</span>
          <input type="text" pattern="\d{6}" maxLength={6} placeholder="202607"
            value={fields.periodeAwal}
            onChange={(e) => onChange({ periodeAwal: e.target.value })}
            className="input-field" required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Lama Periode</span>
          <div className="flex items-center gap-1">
            <input type="number" min="1" step="1"
              value={fields.lamaPeriode}
              onChange={(e) => onChange({ lamaPeriode: parseInt(e.target.value) || 1 })}
              className="input-field" required />
            <span className="text-xs whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>bulan</span>
          </div>
        </label>
        {periodeOk && (
          <div className="flex items-end pb-1">
            <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
              s/d {computePeriodeAkhir(fields.periodeAwal, fields.lamaPeriode)}
            </span>
          </div>
        )}
      </div>

      {/* Produktivitas dokter-level */}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Hari Praktek / Bln</span>
          <input type="number" min="0" placeholder="22"
            value={fields.hariKerjaBulan}
            onChange={(e) => onChange({ hariKerjaBulan: e.target.value })}
            className="input-field" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Jml Pasien / Hari</span>
          <input type="number" min="0" placeholder="10"
            value={fields.jumlahPasienHari}
            onChange={(e) => onChange({ jumlahPasienHari: e.target.value })}
            className="input-field" />
        </label>
      </div>

      {/* Visit & kompetitor */}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Visit / Bulan</span>
          <input type="number" min="0"
            value={fields.rencanaVisitMinggu}
            onChange={(e) => onChange({ rencanaVisitMinggu: e.target.value })}
            className="input-field" required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Produk Kompetitor</span>
          <input type="text"
            value={fields.produkKompetitor}
            onChange={(e) => onChange({ produkKompetitor: e.target.value })}
            className="input-field" />
        </label>
      </div>
    </div>
  );
}

// ─── ProdukEntryRow ───────────────────────────────────────────────────────────
// Per-product: product picker + resep/hari + qty/resep + status + grey calculator

function ProdukEntryRow({
  entry, products, dokterFields, spesialisasi, onChange, onRemove, showRemove,
}: {
  entry: ProdukEntry;
  products: Product[];
  dokterFields: DokterFields;
  spesialisasi?: string;
  onChange: (patch: Partial<ProdukEntry>) => void;
  onRemove: () => void;
  showRemove: boolean;
}) {
  const productOptions = useMemo(() => {
    const sorted = spesialisasi
      ? sortProductsBySpesialisasi(products, spesialisasi)
      : products;
    const matchedPakets = spesialisasi ? getPaketsBySpesialisasi(spesialisasi) : [];
    const TIER_LABEL = ["Produk Fokus Sesuai Spesialisasi", "Produk Fokus Lainnya", "Produk Lainnya"];
    return sorted.map((p) => {
      const allPakets = getAllPakets(p.namaProduk);
      const relevantPaket = allPakets.find((pk) => matchedPakets.includes(pk)) ?? allPakets[0] ?? null;
      const tier = getProductTier(p.namaProduk, matchedPakets);
      return {
        value: p.kodeProduk,
        label: p.namaProduk,
        sublabel: relevantPaket
          ? `${p.kodeProduk} · ${relevantPaket}`
          : `${p.kodeProduk} · ${p.namaGroupBrand}`,
        group: spesialisasi ? TIER_LABEL[tier] : allPakets.length > 0 ? "Produk Fokus" : "Produk Lainnya",
        accent: tier === 0,
      };
    });
  }, [products, spesialisasi]);

  const product = useMemo(() => products.find((p) => p.kodeProduk === entry.kodeProduk) ?? null, [products, entry.kodeProduk]);

  const pasien = parseFloat(dokterFields.jumlahPasienHari) || 0;
  const resep  = parseFloat(entry.jumlahResepHari) || 0;
  const qty    = parseFloat(entry.qtyProdukResep) || 0;
  const hari   = parseFloat(dokterFields.hariKerjaBulan) || 0;
  const hna    = product ? parseFloat(product.hna) || 0 : 0;
  const lama   = dokterFields.lamaPeriode || 1;
  const canCalc = pasien > 0 && resep > 0 && qty > 0 && hari > 0 && hna > 0;
  const perBulan = canCalc ? Math.round(pasien * resep * qty * hari * hna) : null;
  const totalEst = perBulan != null ? perBulan * lama : null;

  return (
    <div className="rounded-lg border p-3 space-y-3"
      style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
      {/* Product picker row */}
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <Combobox
            name={`_produk_${entry.uid}`}
            value={entry.kodeProduk}
            onChange={(v) => onChange({ kodeProduk: v })}
            placeholder="Cari produk…"
            required
            options={productOptions}
          />
          {product && (
            <div className="flex gap-3 text-xs mt-1" style={{ color: "var(--color-text-faint)" }}>
              <span>HNA: <strong style={{ color: "var(--color-text-muted)" }}>{formatRp(product.hna)}</strong></span>
              <span>{product.satuan}</span>
              <span>{product.namaGroupBrand}</span>
            </div>
          )}
        </div>
        {showRemove && (
          <button type="button" onClick={onRemove}
            className="text-xs mt-2 shrink-0" style={{ color: "var(--color-red)" }}>
            × Hapus
          </button>
        )}
      </div>

      {/* Per-product inputs */}
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Resep / Hari</span>
          <input type="number" min="0" placeholder="3"
            value={entry.jumlahResepHari}
            onChange={(e) => onChange({ jumlahResepHari: e.target.value })}
            className="input-field" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Jml Produk ST / Resep</span>
          <input type="number" min="0" placeholder="1"
            value={entry.qtyProdukResep}
            onChange={(e) => onChange({ qtyProdukResep: e.target.value })}
            className="input-field" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Standarisasi</span>
          <select value={entry.statusStandarisasi}
            onChange={(e) => onChange({ statusStandarisasi: e.target.value })}
            className="input-field text-xs">
            <option value="">— Pilih —</option>
            {Object.entries(STATUS_STANDARISASI_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Growth & Budget % per produk */}
      <BudgetFieldsRow entry={entry} onChange={onChange} />
    </div>
  );
}

// ─── BudgetFieldsRow ─────────────────────────────────────────────────────────

function BudgetFieldsRow({
  entry,
  onChange,
}: {
  entry: ProdukEntry;
  onChange: (patch: Partial<ProdukEntry>) => void;
}) {
  const totalPct =
    [entry.persenPsspDokter, entry.persenPsspKpdm, entry.persenDiskon,
     entry.persenDp, entry.persenListingFee, entry.persenEntertain]
      .reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
  const hasTotal = totalPct > 0;
  const overBudget = totalPct > 42.5;

  function numInput(label: string, key: keyof ProdukEntry, placeholder = "0") {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{label}</span>
        <input type="number" min="0" step="0.01" placeholder={placeholder}
          value={entry[key] as string}
          onChange={(e) => onChange({ [key]: e.target.value } as Partial<ProdukEntry>)}
          className="input-field" />
      </label>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {numInput("Growth Estimasi (×)", "rasioEstimasiGrowth", "1.0")}
        {numInput("% PSSP Dokter", "persenPsspDokter")}
        {numInput("% PSSP KPDM", "persenPsspKpdm")}
        {numInput("% Diskon (DPL/DPF)", "persenDiskon")}
        {numInput("% DP", "persenDp")}
        {numInput("% Listing Fee", "persenListingFee")}
        {numInput("% Entertain", "persenEntertain")}
      </div>
      {hasTotal && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded text-xs"
          style={{
            background: overBudget ? "var(--color-red-light)" : "var(--color-bg)",
            border: `1px solid ${overBudget ? "var(--color-red)" : "var(--color-border)"}`,
            color: overBudget ? "var(--color-red)" : "var(--color-text-muted)",
          }}>
          <span>Total % Budget: <strong>{totalPct.toFixed(2)}%</strong></span>
          <span style={{ fontWeight: 600 }}>{overBudget ? "⚠ OVER BUDGET" : "✓ SAFE"}</span>
        </div>
      )}
    </div>
  );
}

// ─── PsspHistoryPanel ─────────────────────────────────────────────────────────

function PsspHistoryPanel({ kodeCustomer }: { kodeCustomer: string }) {
  const [history, setHistory] = useState<PsspKontrakSummary[] | null>(null);
  const [loading, startLoad] = useTransition();

  useEffect(() => {
    startLoad(async () => {
      const rows = await getPsspHistory(kodeCustomer);
      setHistory(rows);
    });
  }, [kodeCustomer]);

  if (loading || history === null) {
    return (
      <div className="text-xs px-3 py-2 rounded-lg" style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}>
        Memuat histori PSSP…
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-xs px-3 py-2 rounded-lg" style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}>
        Tidak ada histori PSSP untuk dokter ini.{" "}
        <span className="font-mono" style={{ opacity: 0.6 }}>({kodeCustomer})</span>
      </div>
    );
  }

  // Group by cUrut
  const byContract = new Map<string, PsspKontrakSummary[]>();
  for (const row of history) {
    const bucket = byContract.get(row.cUrut) ?? [];
    bucket.push(row);
    byContract.set(row.cUrut, bucket);
  }

  // Determine current period (YYYYMM)
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

  const activeContracts: [string, PsspKontrakSummary[]][] = [];
  const expiredContracts: [string, PsspKontrakSummary[]][] = [];
  for (const entry of byContract.entries()) {
    const prdAkhir = entry[1][0].prdAkhir;
    (prdAkhir >= currentPeriod ? activeContracts : expiredContracts).push(entry);
  }

  function ContractCard({ cUrut, rows }: { cUrut: string; rows: PsspKontrakSummary[] }) {
    const first = rows[0];
    const biaya    = first.biaya;
    const sumEst   = rows.reduce((s, r) => s + r.estBaris, 0);
    const sumLunas = rows.reduce((s, r) => s + r.totalLunas, 0);
    const pct = sumEst > 0 ? Math.round((sumLunas / sumEst) * 100) : null;
    const pctColor = pct == null ? "var(--color-text-faint)"
      : pct >= 80 ? "var(--color-success, #16a34a)"
      : pct >= 40 ? "var(--color-warning, #f59e0b)"
      : "var(--color-red)";

    return (
      <div className="rounded-lg border px-3 py-2 space-y-2"
        style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="text-xs font-mono font-semibold" style={{ color: "var(--color-text)" }}>{cUrut}</span>
            <span className="ml-2 text-xs" style={{ color: "var(--color-text-faint)" }}>
              {first.prdAwal} – {first.prdAkhir}
            </span>
          </div>
          <span className="text-xs font-semibold shrink-0" style={{ color: pctColor }}>
            {pct != null ? `${pct}%` : "—"}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1 text-xs">
          <div>
            <div style={{ color: "var(--color-text-faint)" }}>Biaya</div>
            <div style={{ color: "var(--color-text-muted)" }}>{formatRp(biaya)}</div>
          </div>
          <div>
            <div style={{ color: "var(--color-text-faint)" }}>Est.</div>
            <div style={{ color: "var(--color-text-muted)" }}>{formatRp(sumEst)}</div>
          </div>
          <div>
            <div style={{ color: "var(--color-text-faint)" }}>Lunas</div>
            <div style={{ color: pctColor }}>{formatRp(sumLunas)}</div>
          </div>
        </div>
        <div className="space-y-0.5 pt-1 border-t" style={{ borderColor: "var(--color-border)" }}>
          {rows.map((r) => {
            const rowPct = r.estBaris > 0 ? Math.round((r.totalLunas / r.estBaris) * 100) : null;
            return (
              <div key={r.id} className="flex items-center justify-between text-xs gap-2">
                <span style={{ color: "var(--color-text-muted)" }} className="truncate min-w-0">{r.nmProduk ?? r.kdProduk}</span>
                <span className="shrink-0 tabular-nums" style={{ color: "var(--color-text-faint)" }}>
                  {formatRp(r.totalLunas)} / {formatRp(r.estBaris)}
                  {rowPct != null && (
                    <span className="ml-1" style={{ color: rowPct >= 80 ? "var(--color-success, #16a34a)" : rowPct >= 40 ? "var(--color-warning, #f59e0b)" : "var(--color-red)" }}>
                      ({rowPct}%)
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activeContracts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-primary)" }}>
            Aktif ({activeContracts.length})
          </p>
          {activeContracts.map(([cUrut, rows]) => <ContractCard key={cUrut} cUrut={cUrut} rows={rows} />)}
        </div>
      )}
      {expiredContracts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
            Selesai ({expiredContracts.length})
          </p>
          {expiredContracts.map(([cUrut, rows]) => <ContractCard key={cUrut} cUrut={cUrut} rows={rows} />)}
        </div>
      )}
      <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
        {byContract.size} kontrak · snapshot {history[0]?.snapshotDate ?? "—"}
      </p>
    </div>
  );
}

// ─── AddPanel (new dokter + multi-produk) ─────────────────────────────────────

function AddPanel({
  poaId, outlets, products, onCancel,
}: {
  poaId: string; outlets: OutletOption[]; products: Product[]; onCancel: () => void;
}) {
  const [kodePI, setKodePI] = useState("");
  const [spesialisasi, setSpesialisasi] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [specList, setSpecList] = useState<string[]>([]);
  const [customerList, setCustomerList] = useState<CustomerOption[]>([]);
  const [loadingSpec, startLoadSpec] = useTransition();
  const [loadingCust, startLoadCust] = useTransition();

  const [dokterFields, setDokterFields] = useState<DokterFields>(emptyDokterFields(""));
  const [produkList, setProdukList] = useState<ProdukEntry[]>([emptyProdukEntry()]);

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const outletOptions = useMemo(() => outlets.map((o) => ({
    value: o.kodePI, label: `${o.kodePI} - ${o.namaOutlet}`,
  })), [outlets]);
  const specOptions = useMemo(() => specList.map((s) => ({ value: s, label: spesLabel(s) })), [specList]);
  const customerOptions = useMemo(() => customerList.map((c) => ({
    value: c.id, label: c.namaCustomer,
    sublabel: c.isFokus ? "⭐ Fokus" : undefined,
  })), [customerList]);

  const selectedCustomer = useMemo(() => customerList.find((c) => c.id === customerId) ?? null, [customerList, customerId]);
  const selectedOutlet = useMemo(() => outlets.find((o) => o.kodePI === kodePI) ?? null, [outlets, kodePI]);

  const totalEstimasi = useMemo(() => produkList.reduce((sum, e) => {
    const p = products.find((pr) => pr.kodeProduk === e.kodeProduk) ?? null;
    return sum + computeEstimasi(e, dokterFields, p);
  }, 0), [produkList, dokterFields, products]);

  function handleOutletChange(val: string) {
    setKodePI(val); setSpesialisasi(""); setCustomerId("");
    setSpecList([]); setCustomerList([]);
    if (!val) return;
    startLoadSpec(async () => setSpecList(await getSpesialisasiByOutlet(val)));
  }

  function handleSpecChange(val: string) {
    setSpesialisasi(val); setCustomerId(""); setCustomerList([]);
    if (!val || !kodePI) return;
    startLoadCust(async () => setCustomerList(await getCustomersByOutletSpesialisasi(kodePI, val)));
  }

  function updateProduk(idx: number, patch: Partial<ProdukEntry>) {
    setProdukList((prev) => prev.map((e, i) => i === idx ? { ...e, ...patch } : e));
  }

  function buildFormData(entry: ProdukEntry): FormData {
    const fd = new FormData();
    const product = products.find((p) => p.kodeProduk === entry.kodeProduk) ?? null;
    fd.set("customerId", customerId);
    fd.set("kodePI", kodePI);
    fd.set("kodeProduk", entry.kodeProduk);
    fd.set("periodeAwal", dokterFields.periodeAwal);
    fd.set("lamaPeriode", String(dokterFields.lamaPeriode));
    fd.set("hariKerjaBulan", dokterFields.hariKerjaBulan);
    fd.set("jumlahPasienHari", dokterFields.jumlahPasienHari);
    fd.set("jumlahResepHari", entry.jumlahResepHari);
    fd.set("qtyProdukResep", entry.qtyProdukResep);
    fd.set("rencanaVisitMinggu", dokterFields.rencanaVisitMinggu);
    fd.set("produkKompetitor", dokterFields.produkKompetitor);
    fd.set("statusStandarisasi", entry.statusStandarisasi);
    fd.set("rasioEstimasiGrowth", entry.rasioEstimasiGrowth);
    fd.set("persenPsspDokter", entry.persenPsspDokter);
    fd.set("persenPsspKpdm", entry.persenPsspKpdm);
    fd.set("persenDiskon", entry.persenDiskon);
    fd.set("persenDp", entry.persenDp);
    fd.set("persenListingFee", entry.persenListingFee);
    fd.set("persenEntertain", entry.persenEntertain);
    fd.set("rencanaTotalBiaya", String(computeEstimasi(entry, dokterFields, product)));
    return fd;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validEntries = produkList.filter((e) => !!e.kodeProduk);
    if (!validEntries.length) { setError("Pilih minimal satu produk."); return; }
    if (!customerId) { setError("Pilih dokter terlebih dahulu."); return; }
    setError(null);
    setProgress({ done: 0, total: validEntries.length });
    startTransition(async () => {
      try {
        for (let i = 0; i < validEntries.length; i++) {
          await addLineItemAction(poaId, buildFormData(validEntries[i]));
          setProgress({ done: i + 1, total: validEntries.length });
        }
        window.location.reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan.");
        setProgress(null);
      }
    });
  }

  const filledCount = produkList.filter((e) => !!e.kodeProduk).length;
  const canSubmit = !!customerId && filledCount > 0 && !!dokterFields.periodeAwal;

  return (
    <div className="rounded-xl border p-4 space-y-5"
      style={{ background: "var(--color-bg)", borderColor: "var(--color-primary)", borderWidth: 1.5 }}>
      <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Tambah Rencana POA</p>

      {error && (
        <p className="text-sm px-3 py-2 rounded-md"
          style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Outlet & Dokter cascade */}
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
          {selectedCustomer && (
            <>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 rounded-lg px-3 py-2 text-xs"
                style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>
                {selectedCustomer.kodeCustomer && (
                  <span><span style={{ color: "var(--color-text-faint)" }}>Kode:</span> {selectedCustomer.kodeCustomer}</span>
                )}
                <span><span style={{ color: "var(--color-text-faint)" }}>Outlet:</span> {selectedOutlet?.namaOutlet}</span>
                <span><span style={{ color: "var(--color-text-faint)" }}>Spesialisasi:</span> {spesLabel(selectedCustomer.spesialisasi)}</span>
                {selectedCustomer.isFokus && <span style={{ color: "var(--color-primary)" }}>⭐ Dokter Fokus</span>}
              </div>
              {selectedCustomer.kodeCustomer && (
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2"
                    style={{ color: "var(--color-text-faint)" }}>Histori PSSP</p>
                  <PsspHistoryPanel kodeCustomer={selectedCustomer.kodeCustomer} />
                </div>
              )}
            </>
          )}
        </div>

        {/* Rencana per dokter */}
        <div>
          <SectionLabel>Rencana Kunjungan (per Dokter)</SectionLabel>
          <DokterFieldsSection
            fields={dokterFields}
            onChange={(patch) => setDokterFields((prev) => ({ ...prev, ...patch }))}
          />
        </div>

        {/* Products */}
        <div>
          <SectionLabel>Produk yang Dipromosikan</SectionLabel>
          <div className="space-y-2">
            {produkList.map((entry, i) => (
              <ProdukEntryRow
                key={entry.uid}
                entry={entry}
                products={products}
                dokterFields={dokterFields}
                spesialisasi={spesialisasi || undefined}
                onChange={(patch) => updateProduk(i, patch)}
                onRemove={() => setProdukList((prev) => prev.filter((_, idx) => idx !== i))}
                showRemove={produkList.length > 1}
              />
            ))}
            <button type="button"
              onClick={() => setProdukList((prev) => [...prev, emptyProdukEntry()])}
              className="text-sm font-medium px-3 py-2 rounded-lg w-full border-2 border-dashed"
              style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
              + Tambah Produk Lagi
            </button>
          </div>
          {filledCount > 0 && totalEstimasi > 0 && (
            <p className="mt-2 text-xs text-right" style={{ color: "var(--color-text-muted)" }}>
              Total estimasi: <strong style={{ color: "var(--color-primary)" }}>{formatRp(totalEstimasi)}</strong>
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" size="sm" disabled={isPending || !canSubmit}>
            {isPending
              ? (progress ? `Menyimpan ${progress.done}/${progress.total}…` : "Menyimpan…")
              : `Simpan (${filledCount} produk)`}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Batal</Button>
        </div>
      </form>
    </div>
  );
}

// ─── AddDokterBaruPanel (daftarkan dokter baru ke database customer) ──────────
// Setelah terdaftar, dokter muncul di dropdown "Tambah Rencana POA".

function AddDokterBaruPanel({
  outlets, onCancel,
}: {
  outlets: OutletOption[]; onCancel: () => void;
}) {
  const [kodePI, setKodePI] = useState("");
  const [namaDokter, setNamaDokter] = useState("");
  const [spesialisasi, setSpesialisasi] = useState("");
  const [isFokus, setIsFokus] = useState(false);

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const outletOptions = useMemo(() => outlets.map((o) => ({
    value: o.kodePI, label: `${o.kodePI} - ${o.namaOutlet}`,
  })), [outlets]);

  const spesOptions = Object.entries(SPESIALISASI_PM_LABEL).map(([db, pm]) => ({ value: db, label: pm }));
  const selectedOutlet = outlets.find((o) => o.kodePI === kodePI);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("namaCustomer", namaDokter.trim());
    fd.set("spesialisasi", spesialisasi);
    fd.set("kodePI", kodePI);
    fd.set("isFokus", isFokus ? "true" : "false");
    startTransition(async () => {
      const result = await createCustomerAction(fd);
      if (result.ok) {
        setSuccess(true);
      } else {
        setError(result.error ?? "Gagal mendaftarkan dokter.");
      }
    });
  }

  const canSubmit = !!kodePI && !!namaDokter.trim() && !!spesialisasi;

  if (success) {
    return (
      <div className="rounded-xl border p-4 space-y-3"
        style={{ background: "var(--color-bg)", borderColor: "var(--color-success, #16a34a)", borderWidth: 1.5 }}>
        <p className="text-sm font-semibold" style={{ color: "var(--color-success, #16a34a)" }}>
          ✓ Dokter berhasil didaftarkan
        </p>
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          <strong>{namaDokter}</strong> ({spesLabel(spesialisasi)}) sudah terdaftar di {selectedOutlet?.namaOutlet}.
          Sekarang bisa ditambahkan ke POA via &ldquo;Tambah Rencana POA&rdquo;.
        </p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="secondary"
            onClick={() => { setSuccess(false); setNamaDokter(""); setSpesialisasi(""); setKodePI(""); setIsFokus(false); }}>
            Daftar Dokter Lain
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Selesai</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-4 space-y-4"
      style={{ background: "var(--color-bg)", borderColor: "var(--color-warning, #f59e0b)", borderWidth: 1.5 }}>
      <div>
        <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Daftar Dokter Baru</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
          Daftarkan dokter ke database terlebih dahulu. Setelah terdaftar, pilih via &ldquo;Tambah Rencana POA&rdquo;.
        </p>
      </div>

      {error && (
        <p className="text-sm px-3 py-2 rounded-md"
          style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Outlet</span>
            <Combobox name="_outlet_reg" value={kodePI} onChange={setKodePI}
              placeholder="Cari outlet…" required options={outletOptions} />
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Nama Dokter</span>
            <input type="text" value={namaDokter}
              onChange={(e) => setNamaDokter(e.target.value)}
              placeholder="dr. Nama Lengkap"
              className="input-field" required />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Spesialisasi</span>
            <select value={spesialisasi}
              onChange={(e) => setSpesialisasi(e.target.value)}
              className="input-field" required>
              <option value="">— Pilih —</option>
              {spesOptions.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={isFokus}
            onChange={(e) => setIsFokus(e.target.checked)}
            className="rounded" />
          <span style={{ color: "var(--color-text-muted)" }}>
            Termasuk Dokter Fokus
          </span>
        </label>

        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={isPending || !canSubmit}>
            {isPending ? "Mendaftarkan…" : "Daftarkan Dokter"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Batal</Button>
        </div>
      </form>
    </div>
  );
}

// ─── AddProductPanel (tambah produk ke dokter existing) ───────────────────────

function AddProductPanel({
  poaId, products, kodePI, namaOutlet, kodeCust, namaCust, spesialisasi, defaultPeriode, onCancel,
}: {
  poaId: string; products: Product[];
  kodePI: string; namaOutlet: string;
  kodeCust: string | null; namaCust: string; spesialisasi: string;
  defaultPeriode: string; onCancel: () => void;
}) {
  const [dokterFields, setDokterFields] = useState<DokterFields>(emptyDokterFields(defaultPeriode));
  const [produkList, setProdukList] = useState<ProdukEntry[]>([emptyProdukEntry()]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const totalEstimasi = useMemo(() => produkList.reduce((sum, e) => {
    const p = products.find((pr) => pr.kodeProduk === e.kodeProduk) ?? null;
    return sum + computeEstimasi(e, dokterFields, p);
  }, 0), [produkList, dokterFields, products]);

  function updateProduk(idx: number, patch: Partial<ProdukEntry>) {
    setProdukList((prev) => prev.map((e, i) => i === idx ? { ...e, ...patch } : e));
  }

  function buildFormData(entry: ProdukEntry): FormData {
    const fd = new FormData();
    const product = products.find((p) => p.kodeProduk === entry.kodeProduk) ?? null;
    fd.set("directNamaCust", namaCust);
    fd.set("directSpesialisasi", spesialisasi);
    fd.set("directKodeCust", kodeCust ?? "");
    fd.set("kodePI", kodePI);
    fd.set("kodeProduk", entry.kodeProduk);
    fd.set("periodeAwal", dokterFields.periodeAwal);
    fd.set("lamaPeriode", String(dokterFields.lamaPeriode));
    fd.set("hariKerjaBulan", dokterFields.hariKerjaBulan);
    fd.set("jumlahPasienHari", dokterFields.jumlahPasienHari);
    fd.set("jumlahResepHari", entry.jumlahResepHari);
    fd.set("qtyProdukResep", entry.qtyProdukResep);
    fd.set("rencanaVisitMinggu", dokterFields.rencanaVisitMinggu);
    fd.set("produkKompetitor", dokterFields.produkKompetitor);
    fd.set("statusStandarisasi", entry.statusStandarisasi);
    fd.set("rasioEstimasiGrowth", entry.rasioEstimasiGrowth);
    fd.set("persenPsspDokter", entry.persenPsspDokter);
    fd.set("persenPsspKpdm", entry.persenPsspKpdm);
    fd.set("persenDiskon", entry.persenDiskon);
    fd.set("persenDp", entry.persenDp);
    fd.set("persenListingFee", entry.persenListingFee);
    fd.set("persenEntertain", entry.persenEntertain);
    fd.set("rencanaTotalBiaya", String(computeEstimasi(entry, dokterFields, product)));
    return fd;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validEntries = produkList.filter((e) => !!e.kodeProduk);
    if (!validEntries.length) { setError("Pilih minimal satu produk."); return; }
    setError(null);
    setProgress({ done: 0, total: validEntries.length });
    startTransition(async () => {
      try {
        for (let i = 0; i < validEntries.length; i++) {
          await addLineItemAction(poaId, buildFormData(validEntries[i]));
          setProgress({ done: i + 1, total: validEntries.length });
        }
        window.location.reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan.");
        setProgress(null);
      }
    });
  }

  const filledCount = produkList.filter((e) => !!e.kodeProduk).length;
  const canSubmit = filledCount > 0 && !!dokterFields.periodeAwal;

  return (
    <div className="mx-4 mb-4 mt-1 rounded-xl border p-4 space-y-4"
      style={{ background: "var(--color-bg)", borderColor: "var(--color-primary)", borderWidth: 1.5 }}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Tambah Produk</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
            {namaCust} · {spesLabel(spesialisasi)} · {namaOutlet}
          </p>
        </div>
        <button type="button" onClick={onCancel} className="text-xs" style={{ color: "var(--color-text-faint)" }}>✕</button>
      </div>

      {kodeCust && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2"
            style={{ color: "var(--color-text-faint)" }}>Histori PSSP</p>
          <PsspHistoryPanel kodeCustomer={kodeCust} />
        </div>
      )}

      {error && (
        <p className="text-sm px-3 py-2 rounded-md"
          style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <SectionLabel>Rencana Kunjungan (per Dokter)</SectionLabel>
          <DokterFieldsSection
            fields={dokterFields}
            onChange={(patch) => setDokterFields((prev) => ({ ...prev, ...patch }))}
          />
        </div>

        <div>
          <SectionLabel>Produk yang Dipromosikan</SectionLabel>
          <div className="space-y-2">
            {produkList.map((entry, i) => (
              <ProdukEntryRow
                key={entry.uid}
                entry={entry}
                products={products}
                dokterFields={dokterFields}
                spesialisasi={spesialisasi || undefined}
                onChange={(patch) => updateProduk(i, patch)}
                onRemove={() => setProdukList((prev) => prev.filter((_, idx) => idx !== i))}
                showRemove={produkList.length > 1}
              />
            ))}
            <button type="button"
              onClick={() => setProdukList((prev) => [...prev, emptyProdukEntry()])}
              className="text-sm font-medium px-3 py-2 rounded-lg w-full border-2 border-dashed"
              style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
              + Tambah Produk Lagi
            </button>
          </div>
          {filledCount > 0 && totalEstimasi > 0 && (
            <p className="mt-2 text-xs text-right" style={{ color: "var(--color-text-muted)" }}>
              Total estimasi: <strong style={{ color: "var(--color-primary)" }}>{formatRp(totalEstimasi)}</strong>
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" size="sm" disabled={isPending || !canSubmit}>
            {isPending
              ? (progress ? `Menyimpan ${progress.done}/${progress.total}…` : "Menyimpan…")
              : `Simpan (${filledCount} produk)`}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Batal</Button>
        </div>
      </form>
    </div>
  );
}

// ─── EditPanel ────────────────────────────────────────────────────────────────

function EditPanel({ item, poaId, products, onCancel }: { item: PoaLineItem; poaId: string; products: Product[]; onCancel: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dokterFields, setDokterFields] = useState<DokterFields>({
    periodeAwal: item.periodeAwal,
    lamaPeriode: item.lamaPeriode,
    hariKerjaBulan: item.hariKerjaBulan?.toString() ?? "",
    jumlahPasienHari: item.jumlahPasienHari?.toString() ?? "",
    rencanaVisitMinggu: item.rencanaVisitMinggu.toString(),
    produkKompetitor: item.produkKompetitor ?? "",
  });
  const [produkEntry, setProdukEntry] = useState<ProdukEntry>({
    uid: "edit",
    kodeProduk: item.kodeProduk,
    jumlahResepHari: item.jumlahResepHari?.toString() ?? "",
    qtyProdukResep: item.qtyProdukResep?.toString() ?? "",
    statusStandarisasi: item.statusStandarisasi ?? "",
    rasioEstimasiGrowth: item.rasioEstimasiGrowth?.toString() ?? "",
    persenPsspDokter: item.persenPsspDokter ? (parseFloat(item.persenPsspDokter.toString()) * 100).toFixed(2) : "",
    persenPsspKpdm: item.persenPsspKpdm ? (parseFloat(item.persenPsspKpdm.toString()) * 100).toFixed(2) : "",
    persenDiskon: item.persenDiskon ? (parseFloat(item.persenDiskon.toString()) * 100).toFixed(2) : "",
    persenDp: item.persenDp ? (parseFloat(item.persenDp.toString()) * 100).toFixed(2) : "",
    persenListingFee: item.persenListingFee ? (parseFloat(item.persenListingFee.toString()) * 100).toFixed(2) : "",
    persenEntertain: item.persenEntertain ? (parseFloat(item.persenEntertain.toString()) * 100).toFixed(2) : "",
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    const product = products.find((p) => p.kodeProduk === produkEntry.kodeProduk) ?? null;
    fd.set("periodeAwal", dokterFields.periodeAwal);
    fd.set("lamaPeriode", String(dokterFields.lamaPeriode));
    fd.set("hariKerjaBulan", dokterFields.hariKerjaBulan);
    fd.set("jumlahPasienHari", dokterFields.jumlahPasienHari);
    fd.set("jumlahResepHari", produkEntry.jumlahResepHari);
    fd.set("qtyProdukResep", produkEntry.qtyProdukResep);
    fd.set("rencanaVisitMinggu", dokterFields.rencanaVisitMinggu);
    fd.set("produkKompetitor", dokterFields.produkKompetitor);
    fd.set("statusStandarisasi", produkEntry.statusStandarisasi);
    fd.set("rasioEstimasiGrowth", produkEntry.rasioEstimasiGrowth);
    fd.set("persenPsspDokter", produkEntry.persenPsspDokter);
    fd.set("persenPsspKpdm", produkEntry.persenPsspKpdm);
    fd.set("persenDiskon", produkEntry.persenDiskon);
    fd.set("persenDp", produkEntry.persenDp);
    fd.set("persenListingFee", produkEntry.persenListingFee);
    fd.set("persenEntertain", produkEntry.persenEntertain);
    fd.set("rencanaTotalBiaya", String(computeEstimasi(produkEntry, dokterFields, product)));
    startTransition(async () => {
      try {
        await updateLineItemAction(poaId, item.id, fd);
        window.location.reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan.");
      }
    });
  }

  const product = products.find((p) => p.kodeProduk === produkEntry.kodeProduk) ?? null;
  const pasien = parseFloat(dokterFields.jumlahPasienHari) || 0;
  const resep  = parseFloat(produkEntry.jumlahResepHari) || 0;
  const qty    = parseFloat(produkEntry.qtyProdukResep) || 0;
  const hari   = parseFloat(dokterFields.hariKerjaBulan) || 0;
  const hna    = product ? parseFloat(product.hna) || parseFloat(item.hargaSatuanTerkecil?.toString() ?? "0") || 0 : parseFloat(item.hargaSatuanTerkecil?.toString() ?? "0") || 0;
  const lama   = dokterFields.lamaPeriode;
  const canCalc = pasien > 0 && resep > 0 && qty > 0 && hari > 0 && hna > 0;
  const perBulan = canCalc ? Math.round(pasien * resep * qty * hari * hna) : null;
  const totalEst = perBulan != null ? perBulan * lama : null;

  return (
    <div className="rounded-xl border p-4 space-y-5"
      style={{ background: "var(--color-bg)", borderColor: "var(--color-primary)", borderWidth: 1.5 }}>
      {error && (
        <p className="text-sm px-3 py-2 rounded-md"
          style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>
      )}

      <div>
        <SectionLabel>Info</SectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <InfoField label="Outlet" value={item.kodePI ? `${item.kodePI} - ${item.namaOutlet}` : item.namaOutlet} />
          <InfoField label="Dokter" value={item.namaCust} />
          <InfoField label="Spesialisasi" value={spesLabel(item.spesialisasi)} />
          <InfoField label="Produk" value={item.namaProduk} />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <SectionLabel>Rencana Kunjungan (per Dokter)</SectionLabel>
          <DokterFieldsSection
            fields={dokterFields}
            onChange={(patch) => setDokterFields((prev) => ({ ...prev, ...patch }))}
          />
        </div>

        <div>
          <SectionLabel>Data Produk</SectionLabel>
          <div className="rounded-lg border p-3 space-y-3"
            style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
            <div className="grid grid-cols-3 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Resep / Hari</span>
                <input type="number" min="0" placeholder="3"
                  value={produkEntry.jumlahResepHari}
                  onChange={(e) => setProdukEntry((prev) => ({ ...prev, jumlahResepHari: e.target.value }))}
                  className="input-field" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Jml Produk ST / Resep</span>
                <input type="number" min="0" placeholder="1"
                  value={produkEntry.qtyProdukResep}
                  onChange={(e) => setProdukEntry((prev) => ({ ...prev, qtyProdukResep: e.target.value }))}
                  className="input-field" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Standarisasi</span>
                <select value={produkEntry.statusStandarisasi}
                  onChange={(e) => setProdukEntry((prev) => ({ ...prev, statusStandarisasi: e.target.value }))}
                  className="input-field text-xs">
                  <option value="">— Pilih —</option>
                  {Object.entries(STATUS_STANDARISASI_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </label>
            </div>
            <BudgetFieldsRow
              entry={produkEntry}
              onChange={(patch) => setProdukEntry((prev) => ({ ...prev, ...patch }))}
            />
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <Button type="submit" size="sm" disabled={isPending}>{isPending ? "Menyimpan…" : "Simpan"}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Batal</Button>
        </div>
      </form>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LineItemEditor({ poaId, initialItems, outlets, products }: Props) {
  const [items, setItems] = useState<PoaLineItem[]>(initialItems);
  const [mode, setMode] = useState<"none" | "add" | "addBaru">("none");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingProductFor, setAddingProductFor] = useState<{
    kodePI: string; namaOutlet: string; kodeCust: string | null;
    namaCust: string; spesialisasi: string; defaultPeriode: string;
  } | null>(null);
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

  // Group: outlet → dokter → products
  const grouped = useMemo(() => {
    const byOutlet = new Map<string, Map<string, PoaLineItem[]>>();
    for (const item of items) {
      const outletKey = item.kodePI ?? item.namaOutlet;
      if (!byOutlet.has(outletKey)) byOutlet.set(outletKey, new Map());
      const byDokter = byOutlet.get(outletKey)!;
      const custKey = item.namaCust ?? "—";
      if (!byDokter.has(custKey)) byDokter.set(custKey, []);
      byDokter.get(custKey)!.push(item);
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
          <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>Belum ada baris POA.</p>
          <p className="text-xs mt-1" style={{ color: "var(--color-text-faint)" }}>Klik tombol di bawah untuk mulai.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {Array.from(grouped.entries()).map(([outletKey, byDokter]) => {
            const firstItem = byDokter.values().next().value![0];
            return (
              <div key={outletKey} className="rounded-xl border overflow-hidden"
                style={{ borderColor: "var(--color-border)" }}>
                {/* Outlet header */}
                <div className="px-4 py-2 flex items-center gap-2"
                  style={{ background: "var(--color-bg-subtle)", borderBottom: "1px solid var(--color-border)" }}>
                  <span className="text-xs font-mono px-2 py-0.5 rounded"
                    style={{ background: "var(--color-border)", color: "var(--color-text-muted)" }}>
                    {firstItem.kodePI ?? outletKey}
                  </span>
                  <span className="text-sm font-semibold truncate" style={{ color: "var(--color-text)" }}>
                    {firstItem.namaOutlet}
                  </span>
                </div>

                {Array.from(byDokter.entries()).map(([custKey, custItems]) => {
                  const cItem = custItems[0];
                  const isDokterBaru = !cItem.kodeCust;
                  const isAddingHere = addingProductFor?.namaCust === cItem.namaCust
                    && addingProductFor?.kodePI === (cItem.kodePI ?? outletKey);

                  const totalEst = custItems.reduce((s, it) => s + parseFloat(it.rencanaTotalBiaya.toString()), 0);

                  return (
                    <div key={custKey} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                      {/* Compact doctor header: Outlet — Dokter in one line */}
                      <div className="px-4 py-2.5 flex items-center gap-2 flex-wrap"
                        style={{ background: "var(--color-bg)" }}>
                        <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                          {cItem.namaCust}
                        </span>
                        {isDokterBaru && (
                          <span className="text-xs font-medium px-1.5 py-0.5 rounded"
                            style={{ background: "var(--color-warning-light, #fff7ed)", color: "var(--color-warning, #92400e)", border: "1px solid var(--color-warning-border, #fcd34d)" }}>
                            Baru
                          </span>
                        )}
                        <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>·</span>
                        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{spesLabel(cItem.spesialisasi)}</span>
                        {cItem.kodeCust && (
                          <span className="text-xs font-mono" style={{ color: "var(--color-text-faint)" }}>· {cItem.kodeCust}</span>
                        )}
                        <span className="text-xs ml-auto" style={{ color: "var(--color-text-faint)" }}>
                          {custItems.length} produk · {formatRp(totalEst)}
                        </span>
                        {!isAddingHere && (
                          <button type="button"
                            className="text-xs font-medium px-2 py-0.5 rounded shrink-0"
                            style={{ color: "var(--color-primary)", border: "1px solid var(--color-primary)" }}
                            onClick={() => {
                              setMode("none");
                              setEditingId(null);
                              setAddingProductFor({
                                kodePI: cItem.kodePI ?? outletKey,
                                namaOutlet: cItem.namaOutlet,
                                kodeCust: cItem.kodeCust,
                                namaCust: cItem.namaCust,
                                spesialisasi: cItem.spesialisasi,
                                defaultPeriode: cItem.periodeAwal,
                              });
                            }}>
                            + Produk
                          </button>
                        )}
                      </div>

                      {/* Product rows — compact */}
                      <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                        {custItems.map((item) => {
                          const est = parseFloat(item.rencanaTotalBiaya.toString());
                          return (
                            <div key={item.id}>
                              <div className="px-4 pl-8 py-2.5 flex items-center gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
                                      {item.namaProduk}
                                    </span>
                                    {item.statusStandarisasi && (
                                      <span className="text-xs px-1.5 py-0.5 rounded shrink-0"
                                        style={{
                                          background: item.statusStandarisasi === "SUDAH_STANDARISASI"
                                            ? "var(--color-success-bg, #dcfce7)" : "var(--color-bg-subtle)",
                                          color: item.statusStandarisasi === "SUDAH_STANDARISASI"
                                            ? "var(--color-success, #16a34a)" : "var(--color-text-faint)",
                                        }}>
                                        {STATUS_STANDARISASI_LABELS[item.statusStandarisasi]}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap gap-x-3 gap-y-0 mt-0.5 text-xs"
                                    style={{ color: "var(--color-text-faint)" }}>
                                    <span>{formatPeriodeRange(item.periodeAwal, item.lamaPeriode)}</span>
                                    {est > 0 && <span>{formatRp(est)}</span>}
                                    <span>{item.rencanaVisitMinggu}×/mgg</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                  <button type="button" className="text-xs font-medium"
                                    style={{ color: "var(--color-primary)" }}
                                    onClick={() => { setAddingProductFor(null); setEditingId(editingId === item.id ? null : item.id); }}>
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
                                  <EditPanel item={item} poaId={poaId} products={products} onCancel={() => setEditingId(null)} />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {isAddingHere && addingProductFor && (
                        <AddProductPanel
                          poaId={poaId} products={products}
                          kodePI={addingProductFor.kodePI}
                          namaOutlet={addingProductFor.namaOutlet}
                          kodeCust={addingProductFor.kodeCust}
                          namaCust={addingProductFor.namaCust}
                          spesialisasi={addingProductFor.spesialisasi}
                          defaultPeriode={addingProductFor.defaultPeriode}
                          onCancel={() => setAddingProductFor(null)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* Add panels */}
      {mode === "add" && (
        <AddPanel poaId={poaId} outlets={outlets} products={products} onCancel={() => setMode("none")} />
      )}
      {mode === "addBaru" && (
        <AddDokterBaruPanel outlets={outlets} onCancel={() => setMode("none")} />
      )}

      {/* Action buttons */}
      {mode === "none" && (
        <Button type="button" variant="secondary" size="sm"
          onClick={() => { setMode("add"); setAddingProductFor(null); setEditingId(null); }}>
          + Tambah Rencana POA
        </Button>
      )}
    </div>
  );
}
