"use client";

/**
 * Potongan tampilan Planning Standarisasi Pusat (HKA) yang meniru Planning cabang
 * (PoaStandarisasiWizard.PlanningPhase) — docs/poa-standarisasi-pusat/04-layout-parity.md.
 * Dipakai bersama oleh form buat (PusatCreateForm) dan tampilan read-only (PusatDetail).
 * Rumus estimasi sama dengan cabang: pasien/hari × hari praktek/bln × resep/pasien, × HNA per satuan terkecil.
 */

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Combobox } from "@/components/ui/Combobox";
import { createCustomerAction, type CustomerOption } from "@/app/actions/customer";
import type { Product } from "@/lib/masterData";
import { AccountingRp, RpInput, UnitCountInput, formatRp, hargaSTFromProduct } from "@/components/poaStandarisasi/PoaStandarisasiWizard";

export interface PusatDokterForm {
  customerId: string;
  nama: string;
  spesialisasi: string;
  jumlahPasien: string;
  jumlahHariPraktekPerBulan: string;
  resepPerPasienSt: string;
  entertainRp: string;
}

export interface PusatKpdmForm {
  customerId: string;
  nama: string;
  jabatan: string;
  entertainEstimasi: string;
}

const num = (v: string | number | null | undefined) => (typeof v === "number" ? v : parseFloat(v ?? "") || 0);

/** Qty/bln satu dokter (satuan terkecil). */
export const dokterQty = (d: { jumlahPasien: string | number | null; jumlahHariPraktekPerBulan: string | number | null; resepPerPasienSt: string | number | null }) =>
  num(d.jumlahPasien) * num(d.jumlahHariPraktekPerBulan) * num(d.resepPerPasienSt);

/**
 * Pemilih dua langkah (outlet di grup -> dokter) — dokter boleh dari outlet mana pun di grup.
 * Id "nexus:…" dijadikan baris Customer asli dulu (jadi FK), pola sama dengan wizard cabang.
 */
export function GroupDokterPicker({
  outlets, loadDokter, excludeIds, onPick, onError, placeholder,
}: {
  outlets: { kodePI: string; namaOutlet: string }[];
  loadDokter: (kodePI: string) => Promise<CustomerOption[]>;
  excludeIds: Set<string>;
  onPick: (picked: { customerId: string; nama: string; spesialisasi: string; jabatan: string }) => void;
  onError: (msg: string) => void;
  placeholder: string;
}) {
  const [kodePI, setKodePI] = useState("");
  const [options, setOptions] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(false);

  async function pickOutlet(v: string) {
    setKodePI(v);
    setOptions([]);
    if (!v) return;
    setLoading(true);
    setOptions(await loadDokter(v));
    setLoading(false);
  }

  async function pick(rawId: string) {
    if (!rawId) return;
    const opt = options.find((o) => o.id === rawId);
    if (!opt) return;
    let id = rawId;
    if (rawId.startsWith("nexus:")) {
      const fd = new FormData();
      fd.set("namaCustomer", opt.namaCustomer);
      fd.set("spesialisasi", opt.spesialisasi);
      fd.set("kodePI", kodePI);
      if (opt.kodeCustomer) fd.set("kodeCustomer", opt.kodeCustomer);
      const res = await createCustomerAction(fd);
      if (!res.ok || !res.customerId) return onError(res.error ?? "Gagal mendaftarkan dokter.");
      id = res.customerId;
    }
    if (excludeIds.has(id)) return;
    onPick({ customerId: id, nama: opt.namaCustomer, spesialisasi: opt.spesialisasi, jabatan: opt.jabatan });
  }

  return (
    <div className="flex gap-2 flex-wrap">
      <div className="w-64">
        <Combobox
          name="pusat-outlet"
          options={outlets.map((o) => ({ value: o.kodePI, label: o.namaOutlet, sublabel: o.kodePI }))}
          value={kodePI}
          onChange={pickOutlet}
          placeholder="Pilih outlet di grup…"
        />
      </div>
      <div className="w-72">
        <Combobox
          name="pusat-dokter"
          options={options.filter((o) => !excludeIds.has(o.id)).map((o) => ({ value: o.id, label: o.namaCustomer, sublabel: o.jabatan, tag: o.isFokus ? "Fokus" : undefined, tagColor: "blue" as const }))}
          value=""
          onChange={pick}
          disabled={!kodePI || loading}
          placeholder={loading ? "Memuat…" : placeholder}
          emptyMessage="Tidak ada customer terdaftar di outlet ini."
        />
      </div>
    </div>
  );
}

/** Tabel "Dokter User" per produk — kolom dan rumus sama dengan Planning cabang. `onChange` kosong = read-only. */
export function PusatDokterTable({
  dokter, product, onChange, onRemove,
}: {
  dokter: PusatDokterForm[];
  product: Product | undefined;
  onChange?: (customerId: string, patch: Partial<PusatDokterForm>) => void;
  onRemove?: (customerId: string) => void;
}) {
  const disabled = !onChange;
  const hst = product ? hargaSTFromProduct(product) : 0;
  const konversi = product ? parseFloat(product.konversiPembagi ?? "1") || 1 : 1;
  const totalQty = dokter.reduce((s, d) => s + dokterQty(d), 0);
  const totalEntertain = dokter.reduce((s, d) => s + num(d.entertainRp), 0);

  if (dokter.length === 0) {
    return <p className="text-xs italic mb-2" style={{ color: "var(--color-text-faint)" }}>Belum ada dokter user untuk produk ini.</p>;
  }
  return (
    <div className="overflow-x-auto mb-2">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ color: "var(--color-text-faint)" }}>
            <th className="text-left py-1 pr-3">Dokter</th>
            <th className="text-right py-1 px-2" style={{ minWidth: 130 }}>Jumlah Hari Praktek / Bulan</th>
            <th className="text-right py-1 px-2" style={{ minWidth: 130 }}>Jumlah Pasien / Hari</th>
            <th className="text-right py-1 px-2" style={{ minWidth: 130 }}>Resep/Pasien</th>
            <th className="text-right py-1 px-2" style={{ minWidth: 130 }}>Est. Qty/bln</th>
            <th className="text-right py-1 px-2" style={{ minWidth: 130 }}>Est. Sales/bln</th>
            <th className="text-right py-1 px-2" style={{ minWidth: 130 }}>Entertain</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {dokter.map((d) => {
            const dq = dokterQty(d);
            return (
              <tr key={d.customerId} style={{ borderTop: "1px solid var(--color-border)" }}>
                <td className="py-1.5 pr-3">
                  <div>{d.nama}</div>
                  {d.spesialisasi && <div style={{ color: "var(--color-text-faint)" }}>{d.spesialisasi}</div>}
                </td>
                <td className="py-1.5 px-2"><UnitCountInput unit="Hari" value={d.jumlahHariPraktekPerBulan} onChange={(v) => onChange?.(d.customerId, { jumlahHariPraktekPerBulan: v })} disabled={disabled} emphasizeValue /></td>
                <td className="py-1.5 px-2"><UnitCountInput unit="Pasien" value={d.jumlahPasien} onChange={(v) => onChange?.(d.customerId, { jumlahPasien: v })} disabled={disabled} emphasizeValue /></td>
                <td className="py-1.5 px-2"><UnitCountInput unit={product?.satuanTerkecil ?? "Resep"} value={d.resepPerPasienSt} onChange={(v) => onChange?.(d.customerId, { resepPerPasienSt: v })} disabled={disabled} emphasizeValue /></td>
                <td className="py-1.5 px-2 text-right">{dq ? `${Math.ceil(dq / konversi).toLocaleString("id-ID")} ${product?.satuan ?? ""}` : "-"}</td>
                <td className="py-1.5 px-2"><AccountingRp n={dq * hst} /></td>
                <td className="py-1.5 px-2"><RpInput value={d.entertainRp} onChange={(v) => onChange?.(d.customerId, { entertainRp: v })} disabled={disabled} /></td>
                <td className="pl-1">{onRemove && <button type="button" className="text-xs" style={{ color: "var(--color-error)" }} onClick={() => onRemove(d.customerId)}>✕</button>}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: "2px solid var(--color-border-strong, var(--color-border))", fontWeight: 700 }}>
            <td colSpan={4} className="py-1.5">Total</td>
            <td className="py-1.5 text-right">{Math.ceil(totalQty / konversi).toLocaleString("id-ID")} {product?.satuan ?? ""}</td>
            <td className="py-1.5 px-2"><AccountingRp n={totalQty * hst} /></td>
            <td className="py-1.5 px-2"><AccountingRp n={totalEntertain} /></td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>{label}</div>
      <div className="text-lg font-bold" style={{ color: "var(--color-blue)" }}>{value}</div>
      {sub && <div className="text-xs font-semibold mt-0.5" style={{ color: "var(--color-text-faint)" }}>{sub}</div>}
    </div>
  );
}

export interface PusatSummaryProduk {
  product: Product | undefined;
  dokter: PusatDokterForm[];
  skema: "DISKON" | "DP";
  diskonPct: string | number | null;
  listingRp: string | number | null;
}

/** "Total Semua Produk" — angka dan rumus sama dengan RingkasanPoa cabang. */
export function PusatTotalSemuaProduk({ produk, kpdm }: { produk: PusatSummaryProduk[]; kpdm: PusatKpdmForm[] }) {
  const rows = produk
    .filter((p) => p.product)
    .map((p) => {
      const hst = hargaSTFromProduct(p.product!);
      const qty = p.dokter.reduce((s, d) => s + dokterQty(d), 0);
      const nilai = qty * hst;
      const discountPct = p.skema === "DISKON" ? num(p.diskonPct) : 0;
      const listingRp = num(p.listingRp);
      const entertainRp = p.dokter.reduce((s, d) => s + num(d.entertainRp), 0);
      const listingPct = nilai ? (listingRp / nilai) * 100 : 0;
      const entertainPct = nilai ? (entertainRp / nilai) * 100 : 0;
      return { product: p.product!, qty, nilai, discountPct, listingRp, listingPct, entertainRp, entertainPct, totalBudgetPct: discountPct + listingPct + entertainPct };
    });
  if (rows.length === 0) return null;

  const totalSales = rows.reduce((s, r) => s + r.nilai, 0);
  const totalListing = rows.reduce((s, r) => s + r.listingRp, 0);
  const totalEntertainProduk = rows.reduce((s, r) => s + r.entertainRp, 0);
  const kpdmEntertain = kpdm.reduce((s, k) => s + num(k.entertainEstimasi), 0);

  return (
    <div className="rounded-xl p-5 mt-5" style={{ border: "2px dashed var(--color-blue)", background: "var(--color-surface, #fff)" }}>
      <div className="text-xs font-bold uppercase tracking-wide mb-4" style={{ color: "var(--color-text-faint)" }}>Total Semua Produk</div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-4">
        <Stat label="Jumlah Produk" value={String(rows.length)} />
        <Stat label="Total Estimasi Sales / bln" value={formatRp(totalSales)} />
        <Stat label="Total Biaya Listing (Rp)" value={formatRp(totalListing)} />
        <Stat label="Total Biaya Entertain (Rp)" value={formatRp(totalEntertainProduk + kpdmEntertain)} sub={`Entertain KPDM: ${formatRp(kpdmEntertain)}`} />
        <Stat label="Total % Budget (avg)" value={`${(rows.reduce((s, r) => s + r.totalBudgetPct, 0) / rows.length).toFixed(1)}%`} />
      </div>
      <hr className="mb-3" style={{ borderColor: "var(--color-border)" }} />
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: "var(--color-text-faint)" }}>
              <th className="text-left py-1">Produk</th>
              <th className="text-right py-1">Qty/bln</th>
              <th className="text-right py-1">Estimasi/bln</th>
              <th className="text-right py-1">Discount</th>
              <th className="text-right py-1">Biaya Listing</th>
              <th className="text-right py-1">Entertain</th>
              <th className="text-right py-1">% Budget</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--color-border)" }}>
                <td className="py-1.5 font-semibold" style={{ color: "var(--color-blue)" }}>{r.product.namaProduk}</td>
                <td className="py-1.5 text-right">{r.qty ? r.qty.toLocaleString("id-ID") : "-"} {r.product.satuanTerkecil ?? ""}</td>
                <td className="py-1.5 text-right">{formatRp(r.nilai)}</td>
                <td className="py-1.5 text-right">{r.discountPct.toFixed(1)}%</td>
                <td className="py-1.5 text-right">{r.listingPct.toFixed(1)}%</td>
                <td className="py-1.5 text-right">{r.entertainPct.toFixed(1)}%</td>
                <td className="py-1.5 text-right font-semibold">{r.totalBudgetPct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** KPDM list — read-only bila `onChange` kosong. Di cabang KPDM dipilih dari customer outlet; di pusat dari outlet mana pun di grup. */
export function PusatKpdmSection({
  kpdm, onChange, onRemove, picker,
}: {
  kpdm: PusatKpdmForm[];
  onChange?: (customerId: string, v: string) => void;
  onRemove?: (customerId: string) => void;
  picker?: React.ReactNode;
}) {
  const disabled = !onChange;
  return (
    <div className="mb-4">
      <span className="text-sm font-medium block mb-1">KPDM Standarisasi {!disabled && <span style={{ color: "var(--color-error)" }}>*</span>}</span>
      <p className="text-xs mb-2" style={{ color: "var(--color-text-faint)" }}>Bisa lebih dari satu KPDM, dari outlet mana pun di grup.</p>
      {kpdm.length === 0 ? (
        <p className="text-xs italic mb-2" style={{ color: "var(--color-text-faint)" }}>Belum ada KPDM dipilih.</p>
      ) : (
        <div className="space-y-2 mb-2">
          {kpdm.map((k) => (
            <div key={k.customerId} className="rounded-lg p-3" style={{ border: "1px solid var(--color-border)" }}>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[140px]">
                  <div className="text-sm font-medium">{k.nama}</div>
                  <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>{k.jabatan || "-"}</div>
                </div>
                <div className="w-40">
                  <RpInput label="Estimasi Entertain" value={k.entertainEstimasi} onChange={(v) => onChange?.(k.customerId, v)} disabled={disabled} />
                </div>
                {onRemove && <button type="button" className="text-xs" style={{ color: "var(--color-error)" }} onClick={() => onRemove(k.customerId)}>Hapus</button>}
              </div>
            </div>
          ))}
        </div>
      )}
      {picker}
    </div>
  );
}

/** Kartu pembungkus produk (dipakai di dua tempat supaya gaya identik dengan cabang). */
export function PusatProdukCard({ children }: { children: React.ReactNode }) {
  return <Card className="mb-4" style={{ background: "var(--color-bg-subtle)" }}>{children}</Card>;
}
