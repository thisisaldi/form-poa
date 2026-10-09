"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Combobox } from "@/components/ui/Combobox";
import type { Product } from "@/lib/masterData";
import {
  createPusatAction,
  getPusatGroupDokterAction,
  getPusatGroupOutletsAction,
  getPusatProdukPreviewAction,
  type PusatProdukInput,
  type PusatProdukPreview,
} from "@/app/actions/poaStandarisasiPusat";
import { discountApprovalLevel, levelsUpTo, type ApprovalLevel } from "@/lib/discountApprovalLevel";
import { isAutoApprovedLevel } from "@/lib/hka";
import {
  DEFAULT_DISKON_DISTRIBUTOR_PCT,
  MARGIN_CAP_PCT,
  MonthYearPicker,
  PERIODE_PERIODIC_OPTIONS,
  RpInput,
  Stepper,
  UnitCountInput,
  formatRp,
  hargaSTFromProduct,
} from "@/components/poaStandarisasi/PoaStandarisasiWizard";
import {
  GroupDokterPicker,
  PusatDokterTable,
  PusatKpdmSection,
  PusatProdukCard,
  PusatTotalSemuaProduk,
  dokterQty,
  type PusatDokterForm,
  type PusatKpdmForm,
} from "@/components/poaStandarisasi/PusatPlanningParts";
import { PusatGroupSidebar } from "@/components/poaStandarisasi/PusatGroupSidebar";

interface ProdukForm {
  kodeProduk: string;
  skemaPembayaran: "DISKON" | "DP";
  estimasiDiskonPct: string;
  estimasiDiskonDistributorPct: string;
  estimasiValueDpRp: string;
  estimasiBiayaListingRp: string;
  catatan: string;
  dokter: PusatDokterForm[];
}

const emptyProduk = (): ProdukForm => ({
  kodeProduk: "", skemaPembayaran: "DISKON", estimasiDiskonPct: "", estimasiDiskonDistributorPct: "",
  estimasiValueDpRp: "", estimasiBiayaListingRp: "", catatan: "", dokter: [],
});

/** Planning Standarisasi Pusat (Produk × Grup HKA) — tata letak sama dengan PlanningPhase cabang (docs/poa-standarisasi-pusat/04-layout-parity.md). */
export function PusatCreateForm({
  groups,
  productOptions,
  creatorLevel,
}: {
  groups: { hkaGroup: string; jumlahOutlet: number }[];
  productOptions: Product[];
  /** Level tertinggi yang otomatis disetujui untuk pembuat ini (null = tidak ada). */
  creatorLevel: ApprovalLevel | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hkaGroup, setHkaGroup] = useState("");
  const [outlets, setOutlets] = useState<{ kodePI: string; namaOutlet: string }[]>([]);
  const [tipe, setTipe] = useState<"PERIODIC" | "SISIPAN" | "PERMANEN">("PERIODIC");
  const [periodeBulan, setPeriodeBulan] = useState("");
  const [timeline, setTimeline] = useState("");
  const [kpdmList, setKpdmList] = useState<PusatKpdmForm[]>([]);
  const [produkList, setProdukList] = useState<ProdukForm[]>([emptyProduk()]);
  const [preview, setPreview] = useState<Record<string, PusatProdukPreview>>({});

  const productByKode = new Map(productOptions.map((p) => [p.kodeProduk, p]));
  const baseProductOptions = productOptions.map((p) => ({ value: p.kodeProduk, label: p.namaProduk, sublabel: p.kodeProduk }));

  useEffect(() => {
    setOutlets([]);
    if (!hkaGroup) return;
    let cancelled = false;
    getPusatGroupOutletsAction(hkaGroup).then((r) => { if (!cancelled) setOutlets(r); });
    return () => { cancelled = true; };
  }, [hkaGroup]);

  function update(idx: number, patch: Partial<ProdukForm>) {
    setProdukList((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
  function updateDokter(idx: number, customerId: string, patch: Partial<PusatDokterForm>) {
    setProdukList((prev) => prev.map((p, i) => (i === idx ? { ...p, dokter: p.dokter.map((d) => (d.customerId === customerId ? { ...d, ...patch } : d)) } : p)));
  }

  // Status Pengajuan / DPL / diskon live / baseline margin untuk produk di grup — refetch hanya saat grup atau SET produk berubah.
  const kodeProdukKey = [...new Set(produkList.map((p) => p.kodeProduk).filter(Boolean))].sort().join(",");
  useEffect(() => {
    if (!hkaGroup || !kodeProdukKey) { setPreview({}); return; }
    let cancelled = false;
    getPusatProdukPreviewAction(hkaGroup, kodeProdukKey.split(",")).then((map) => {
      if (cancelled) return;
      setPreview(map);
      // Default diskon dari Exodus hanya saat field masih kosong (tidak menimpa ketikan MR), sama seperti cabang.
      setProdukList((prev) => prev.map((p) => {
        const pv = p.kodeProduk ? map[p.kodeProduk] : undefined;
        if (!pv) return p;
        const patch: Partial<ProdukForm> = {};
        if (!p.estimasiDiskonPct && pv.diskon) patch.estimasiDiskonPct = String(pv.diskon.principalPct);
        if (!p.estimasiDiskonDistributorPct) patch.estimasiDiskonDistributorPct = pv.diskon ? String(pv.diskon.distributorPct) : DEFAULT_DISKON_DISTRIBUTOR_PCT;
        return Object.keys(patch).length ? { ...p, ...patch } : p;
      }));
    });
    return () => { cancelled = true; };
  }, [hkaGroup, kodeProdukKey]);

  function handleSubmit() {
    const filled = produkList.filter((p) => p.kodeProduk);
    if (!hkaGroup) return setError("Grup RS wajib dipilih.");
    if ((tipe === "PERIODIC" || tipe === "SISIPAN") && !periodeBulan) return setError("Periode wajib diisi.");
    if (kpdmList.length === 0) return setError("KPDM wajib dipilih minimal 1.");
    if (filled.length === 0) return setError("Tambahkan minimal 1 produk.");
    if (filled.some((p) => p.dokter.length === 0)) return setError("Setiap produk wajib punya minimal 1 dokter user.");
    setError(null);
    startTransition(async () => {
      const res = await createPusatAction({
        hkaGroup,
        tipeStandarisasi: tipe,
        periodeBulan: tipe === "PERMANEN" ? null : periodeBulan || null,
        estimasiTimelineSelesai: timeline || null,
        kpdmList: kpdmList.map((k) => ({ customerId: k.customerId, nama: k.nama, jabatan: k.jabatan || null, entertainEstimasi: k.entertainEstimasi || null })),
        produk: filled.map((p): PusatProdukInput => ({
          kodeProduk: p.kodeProduk,
          skemaPembayaran: p.skemaPembayaran,
          estimasiDiskonPct: p.estimasiDiskonPct || null,
          estimasiDiskonDistributorPct: p.estimasiDiskonDistributorPct || null,
          estimasiValueDpRp: p.estimasiValueDpRp || null,
          estimasiBiayaListingRp: p.estimasiBiayaListingRp || null,
          catatan: p.catatan || null,
          dokter: p.dokter.map((d) => ({
            customerId: d.customerId,
            jumlahPasien: d.jumlahPasien || null,
            jumlahHariPraktekPerBulan: d.jumlahHariPraktekPerBulan || null,
            resepPerPasienSt: d.resepPerPasienSt || null,
            entertainRp: d.entertainRp || null,
          })),
        })),
      });
      if (res.error) return setError(res.error);
      router.push(`/poa-standarisasi/pusat/${res.id}`);
    });
  }

  const loadDokter = (kodePI: string) => getPusatGroupDokterAction(hkaGroup, kodePI);

  return (
    <div className="max-w-5xl">
      <div className="mb-4">
        <Link href="/poa-standarisasi/pusat" className="text-xs font-medium" style={{ color: "var(--color-blue)" }}>
          ← Daftar Standarisasi Pusat
        </Link>
        <h1 className="mt-1">Standarisasi Pusat Baru</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          POA Standarisasi Pusat (Produk × Grup RS) — Hospital Key Account
        </p>
      </div>

      <Stepper currentIdx={0} />
      {hkaGroup && <PusatGroupSidebar hkaGroup={hkaGroup} outlets={outlets} productByKode={productByKode} />}

      {error && (
        <div className="mb-4 rounded px-3 py-2 text-sm" style={{ background: "var(--color-error-bg, #FDECEA)", color: "var(--color-error)" }}>
          {error}
        </div>
      )}

      <Card className="mb-4">
        <CardHeader><CardTitle>Planning Standarisasi</CardTitle></CardHeader>
        <div className="max-w-lg mb-4">
          <span className="text-sm font-medium block mb-1">Grup RS <span style={{ color: "var(--color-error)" }}>*</span></span>
          <Combobox
            name="hkaGroup"
            options={groups.map((g) => ({ value: g.hkaGroup, label: g.hkaGroup, tag: `${g.jumlahOutlet} outlet`, tagColor: "indigo" as const }))}
            value={hkaGroup}
            onChange={(v) => { setHkaGroup(v); setKpdmList([]); setProdukList((prev) => prev.map((p) => ({ ...p, dokter: [] }))); }}
            placeholder="Cari grup RS…"
            required
            emptyMessage="Belum ada grup HKA."
          />
        </div>

        <PusatKpdmSection
          kpdm={kpdmList}
          onChange={(cid, v) => setKpdmList((prev) => prev.map((k) => (k.customerId === cid ? { ...k, entertainEstimasi: v } : k)))}
          onRemove={(cid) => setKpdmList((prev) => prev.filter((k) => k.customerId !== cid))}
          picker={hkaGroup ? (
            <GroupDokterPicker
              outlets={outlets}
              loadDokter={loadDokter}
              excludeIds={new Set(kpdmList.map((k) => k.customerId))}
              onPick={(c) => setKpdmList((prev) => [...prev, { customerId: c.customerId, nama: c.nama, jabatan: c.jabatan, entertainEstimasi: "" }])}
              onError={setError}
              placeholder="+ Tambah KPDM…"
            />
          ) : <p className="text-xs italic" style={{ color: "var(--color-text-faint)" }}>Pilih grup RS dulu.</p>}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <span className="text-sm font-medium block mb-1">Tipe Standarisasi <span style={{ color: "var(--color-error)" }}>*</span></span>
            <Combobox
              name="tipeStandarisasi"
              options={[
                { value: "PERIODIC", label: "Standarisasi Periodic" },
                { value: "SISIPAN", label: "Standarisasi Sisipan" },
                { value: "PERMANEN", label: "Standarisasi Non Periodic" },
              ]}
              value={tipe}
              onChange={(v) => { setTipe(v as typeof tipe); setPeriodeBulan(""); }}
            />
          </div>
          {tipe === "PERIODIC" && (
            <div>
              <span className="text-sm font-medium block mb-1">Periode <span style={{ color: "var(--color-error)" }}>*</span></span>
              <Combobox
                name="periodeBulan"
                options={PERIODE_PERIODIC_OPTIONS.map((n) => ({ value: String(n), label: `${n} Bulan` }))}
                value={periodeBulan}
                onChange={setPeriodeBulan}
                placeholder="Pilih periode…"
              />
            </div>
          )}
          {tipe === "SISIPAN" && <UnitCountInput label="Periode" unit="Bulan" value={periodeBulan} onChange={setPeriodeBulan} />}
        </div>

        <div className="max-w-sm">
          <MonthYearPicker label="Target Finalisasi Standarisasi" value={timeline} onChange={setTimeline} />
        </div>
      </Card>

      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold">Produk diajukan ({produkList.length})</span>
      </div>

      {produkList.map((p, idx) => {
        const product = productByKode.get(p.kodeProduk);
        const pv = p.kodeProduk ? preview[p.kodeProduk] : undefined;
        const hst = product ? hargaSTFromProduct(product) : 0;
        const totalSales = p.dokter.reduce((s, d) => s + dokterQty(d), 0) * hst;
        const dipakaiLain = new Set(produkList.filter((_, i) => i !== idx && produkList[i].kodeProduk).map((pp) => pp.kodeProduk));
        const pct = p.skemaPembayaran === "DISKON" ? parseFloat(p.estimasiDiskonPct) || 0 : 0;
        const top = discountApprovalLevel(pct);
        const butuh = levelsUpTo(top).filter((l) => !isAutoApprovedLevel(l, creatorLevel));
        const dplHabis = pv?.dplAkhir && isEndingThisQuarter(pv.dplAkhir) ? pv.dplAkhir : null;
        return (
          <PusatProdukCard key={idx}>
            <div className="flex justify-between items-start mb-2">
              <span className="text-sm font-semibold" style={{ color: "var(--color-blue)" }}>{idx + 1}. {product?.namaProduk ?? "Produk belum dipilih"}</span>
              {produkList.length > 1 && (
                <button type="button" className="text-xs" style={{ color: "var(--color-error)" }} onClick={() => setProdukList((prev) => prev.filter((_, i) => i !== idx))}>Hapus</button>
              )}
            </div>

            <div className="flex gap-3 items-start flex-wrap">
              <div className="flex-1 min-w-[220px]">
                <span className="text-xs font-medium block mb-1">Nama Produk *</span>
                <Combobox
                  name={`produk-${idx}`}
                  options={baseProductOptions.filter((o) => !dipakaiLain.has(o.value))}
                  value={p.kodeProduk}
                  onChange={(v) => update(idx, { kodeProduk: v, estimasiDiskonPct: "", estimasiDiskonDistributorPct: "" })}
                  placeholder="Cari produk…"
                />
              </div>
              <div className="w-40 shrink-0">
                <span className="text-xs font-medium block mb-1">Status Pengajuan</span>
                <div
                  className="rounded px-3 py-2 text-sm font-semibold"
                  style={{
                    background: pv?.statusPengajuan === "PERPANJANGAN" ? "var(--color-blue-light)" : "var(--color-bg-subtle)",
                    color: pv?.statusPengajuan === "PERPANJANGAN" ? "var(--color-blue)" : "var(--color-text-muted)",
                    border: "1px solid var(--color-border)",
                  }}
                  title="Otomatis: Perpanjangan kalau di salah satu outlet grup produk ini punya sales 3 bulan terakhir DAN DPL aktif. Baru kalau tidak ada."
                >
                  {pv?.statusPengajuan === "PERPANJANGAN" ? "Perpanjangan" : "Baru"}
                </div>
                {dplHabis && (
                  <div className="text-[11px] font-semibold mt-1" style={{ color: "#d97706" }} title="DPL aktif produk ini di outlet grup berakhir di kuartal berjalan">
                    ⚠ DPL habis {dplHabis.slice(4)}/{dplHabis.slice(0, 4)}
                  </div>
                )}
              </div>
              <div className="w-40 shrink-0">
                <span className="text-xs font-medium block mb-1">Skema</span>
                <Combobox
                  name={`skema-${idx}`}
                  options={[{ value: "DISKON", label: "Diskon" }, { value: "DP", label: "DP" }]}
                  value={p.skemaPembayaran}
                  onChange={(v) => update(idx, { skemaPembayaran: v as "DISKON" | "DP" })}
                />
              </div>
              {p.skemaPembayaran === "DP" ? (
                <div className="w-44 shrink-0">
                  <span className="text-xs font-medium block mb-1">Value DP</span>
                  <RpInput value={p.estimasiValueDpRp} onChange={(v) => update(idx, { estimasiValueDpRp: v })} />
                </div>
              ) : (
                <>
                  <div className="w-32 shrink-0">
                    <span className="text-xs font-medium block mb-1 whitespace-nowrap">Diskon (PI)</span>
                    <UnitCountInput unit="%" value={p.estimasiDiskonPct} onChange={(v) => update(idx, { estimasiDiskonPct: v })} />
                  </div>
                  <div className="w-32 shrink-0">
                    <span className="text-xs font-medium block mb-1 whitespace-nowrap">Diskon (Dist.)</span>
                    <UnitCountInput unit="%" value={p.estimasiDiskonDistributorPct} onChange={(v) => update(idx, { estimasiDiskonDistributorPct: v })} />
                  </div>
                </>
              )}
              <div className="w-36 shrink-0">
                <span className="text-xs font-medium block mb-1 whitespace-nowrap">Estimasi Biaya Listing</span>
                <RpInput value={p.estimasiBiayaListingRp} onChange={(v) => update(idx, { estimasiBiayaListingRp: v })} />
              </div>
            </div>

            {product && (
              <div className="text-xs mt-2 mb-1" style={{ color: "var(--color-text-muted)" }}>
                <div className="flex gap-4">
                  <span>HNA SJ: <strong>{formatRp(parseFloat(product.hna))}</strong> ({product.satuan})</span>
                  <span>HNA ST: <strong>{formatRp(hst)}</strong> ({product.satuanTerkecil ?? product.satuan})</span>
                </div>
                {(product.qtyPerRxPasien != null || product.jumlahPemberianPerHari != null) && (
                  <div className="mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                    <span className="font-medium">Rekomendasi Resep: </span>
                    {product.qtyPerRxPasien != null && product.lamaPemberianHari != null
                      ? `${product.qtyPerRxPasien} ${product.satuanTerkecil ?? product.satuan} / ${product.lamaPemberianHari} hari`
                      : "-"}
                    {product.jumlahPemberianPerHari != null && <> · Dosis per hari: {product.jumlahPemberianPerHari} / hari</>}
                  </div>
                )}
              </div>
            )}

            {p.skemaPembayaran === "DISKON" && pv?.baseline && (() => {
              // Rumus peringatan margin sama dengan cabang (PlanningPhase), dasar dari outlet grup yang diwakili `baseline`.
              const salesLama = pv.baseline.sales12Bln / 12;
              const diskonBaru = (parseFloat(p.estimasiDiskonPct) || 0) + (parseFloat(p.estimasiDiskonDistributorPct) || 0);
              const marginBaruPct = MARGIN_CAP_PCT - (diskonBaru - pv.baseline.diskonLamaPct);
              const growthPct = salesLama > 0 ? (totalSales / salesLama - 1) * 100 : null;
              const turun = marginBaruPct < MARGIN_CAP_PCT;
              return (
                <div className="flex gap-4 mt-1.5 px-3 py-2 rounded-lg text-xs" style={{ background: "var(--color-bg-subtle)", border: `1px solid ${turun ? "var(--color-error)" : "var(--color-border)"}` }}>
                  <div>
                    <div style={{ color: "var(--color-text-faint)" }}>Sales/bln</div>
                    <div className="font-semibold" style={{ color: "var(--color-text)" }}>
                      {formatRp(salesLama)} <span style={{ color: "var(--color-text-faint)" }}>→</span> {formatRp(totalSales)}
                      {growthPct != null && (
                        <span className="ml-1 font-normal" style={{ color: growthPct >= 0 ? "var(--color-success, #16a34a)" : "var(--color-error)" }}>({growthPct >= 0 ? "+" : ""}{growthPct.toFixed(1)}%)</span>
                      )}
                    </div>
                  </div>
                  <div style={{ borderLeft: "1px solid var(--color-border)" }} />
                  <div>
                    <div style={{ color: "var(--color-text-faint)" }}>Margin</div>
                    <div className="font-semibold" style={{ color: turun ? "var(--color-error)" : "var(--color-success, #16a34a)" }}>
                      {MARGIN_CAP_PCT}% <span style={{ color: "var(--color-text-faint)" }}>→</span> {marginBaruPct.toFixed(1)}%
                    </div>
                  </div>
                  <div style={{ borderLeft: "1px solid var(--color-border)" }} />
                  <div>
                    <div style={{ color: "var(--color-text-faint)" }}>Diskon</div>
                    <div className="font-semibold" style={{ color: "var(--color-text)" }}>
                      {pv.baseline.diskonLamaPct.toFixed(1)}% <span style={{ color: "var(--color-text-faint)" }}>→</span> {diskonBaru.toFixed(1)}%
                    </div>
                  </div>
                </div>
              );
            })()}

            <hr className="my-3" style={{ borderColor: "var(--color-border)" }} />
            <span className="text-xs font-bold uppercase tracking-wide block mb-2" style={{ color: "var(--color-text-faint)" }}>Dokter User</span>
            <PusatDokterTable
              dokter={p.dokter}
              product={product}
              onChange={(cid, patch) => updateDokter(idx, cid, patch)}
              onRemove={(cid) => update(idx, { dokter: p.dokter.filter((d) => d.customerId !== cid) })}
            />
            {hkaGroup ? (
              <GroupDokterPicker
                outlets={outlets}
                loadDokter={loadDokter}
                excludeIds={new Set(p.dokter.map((d) => d.customerId))}
                onPick={(c) => update(idx, { dokter: [...p.dokter, { customerId: c.customerId, nama: c.nama, spesialisasi: c.spesialisasi, jumlahPasien: "", jumlahHariPraktekPerBulan: "", resepPerPasienSt: "", entertainRp: "" }] })}
                onError={setError}
                placeholder="+ Tambah dokter user…"
              />
            ) : <p className="text-xs italic" style={{ color: "var(--color-text-faint)" }}>Pilih grup RS dulu.</p>}

            <div className="mt-3">
              <span className="text-xs font-medium block mb-1">Catatan</span>
              <input type="text" className="input-field text-sm w-full" value={p.catatan} onChange={(e) => update(idx, { catatan: e.target.value })} placeholder="Opsional" />
            </div>

            {p.kodeProduk && (
              <div className="mt-3 text-xs rounded px-3 py-2" style={{ background: "var(--color-blue-light)", color: "var(--color-blue)" }}>
                Level approval sampai <strong>{top}</strong>
                {butuh.length === 0 ? " — semua level otomatis disetujui (setara level Anda)." : ` — menunggu persetujuan: ${butuh.join(", ")}.`}
              </div>
            )}
          </PusatProdukCard>
        );
      })}

      <div className="mb-4">
        <Button type="button" variant="secondary" onClick={() => setProdukList((prev) => [...prev, emptyProduk()])}>+ Tambah Produk</Button>
      </div>

      <PusatTotalSemuaProduk
        kpdm={kpdmList}
        produk={produkList.filter((p) => p.kodeProduk).map((p) => ({ product: productByKode.get(p.kodeProduk), dokter: p.dokter, skema: p.skemaPembayaran, diskonPct: p.estimasiDiskonPct, listingRp: p.estimasiBiayaListingRp }))}
      />

      <div className="flex justify-end gap-2 mt-4">
        <Link href="/poa-standarisasi/pusat"><Button type="button" variant="secondary">Batal</Button></Link>
        <Button type="button" disabled={pending || !hkaGroup} onClick={handleSubmit}>
          {pending ? "Membuat…" : "Buat & Lanjut ke Approval Atasan"}
        </Button>
      </div>
    </div>
  );
}

/** DPL berakhir di kuartal kalender berjalan (definisi sama dengan badge "DPL habis" di cabang). */
function isEndingThisQuarter(prdAkhir: string): boolean {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3);
  const y = parseInt(prdAkhir.slice(0, 4), 10);
  const m = parseInt(prdAkhir.slice(4), 10) - 1;
  return y === now.getFullYear() && Math.floor(m / 3) === q && prdAkhir >= `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
}
