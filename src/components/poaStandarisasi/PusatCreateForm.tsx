"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Combobox } from "@/components/ui/Combobox";
import type { Product } from "@/lib/masterData";
import { createPusatAction, type PusatProdukInput } from "@/app/actions/poaStandarisasiPusat";
import { discountApprovalLevel, levelsUpTo, type ApprovalLevel } from "@/lib/discountApprovalLevel";
import { isAutoApprovedLevel } from "@/lib/hka";
import { PERIODE_PERIODIC_OPTIONS, RpInput, Stepper, UnitCountInput } from "@/components/poaStandarisasi/PoaStandarisasiWizard";

interface ProdukForm {
  kodeProduk: string;
  skemaPembayaran: "DISKON" | "DP";
  estimasiDiskonPct: string;
  estimasiDiskonDistributorPct: string;
  estimasiValueDpRp: string;
  catatan: string;
}

const emptyProduk = (): ProdukForm => ({ kodeProduk: "", skemaPembayaran: "DISKON", estimasiDiskonPct: "", estimasiDiskonDistributorPct: "", estimasiValueDpRp: "", catatan: "" });

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

/** Planning Standarisasi Pusat (Produk × Grup HKA) — pola sama dengan PlanningPhase cabang: Stepper, Combobox, kartu produk. */
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
  const [tipe, setTipe] = useState<"PERIODIC" | "SISIPAN" | "PERMANEN">("PERIODIC");
  const [periodeBulan, setPeriodeBulan] = useState("");
  const [produkList, setProdukList] = useState<ProdukForm[]>([emptyProduk()]);

  const productByKode = new Map(productOptions.map((p) => [p.kodeProduk, p]));
  const baseProductOptions = productOptions.map((p) => ({ value: p.kodeProduk, label: p.namaProduk, sublabel: p.kodeProduk }));

  function update(idx: number, patch: Partial<ProdukForm>) {
    setProdukList((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  function handleSubmit() {
    const filled = produkList.filter((p) => p.kodeProduk);
    if (!hkaGroup) return setError("Grup RS wajib dipilih.");
    if ((tipe === "PERIODIC" || tipe === "SISIPAN") && !periodeBulan) return setError("Periode wajib diisi.");
    if (filled.length === 0) return setError("Tambahkan minimal 1 produk.");
    setError(null);
    startTransition(async () => {
      const res = await createPusatAction({
        hkaGroup,
        tipeStandarisasi: tipe,
        periodeBulan: tipe === "PERMANEN" ? null : periodeBulan || null,
        produk: filled.map((p): PusatProdukInput => ({
          kodeProduk: p.kodeProduk,
          skemaPembayaran: p.skemaPembayaran,
          estimasiDiskonPct: p.estimasiDiskonPct || null,
          estimasiDiskonDistributorPct: p.estimasiDiskonDistributorPct || null,
          estimasiValueDpRp: p.estimasiValueDpRp || null,
          catatan: p.catatan || null,
        })),
      });
      if (res.error) return setError(res.error);
      router.push(`/poa-standarisasi/pusat/${res.id}`);
    });
  }

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
            onChange={setHkaGroup}
            placeholder="Cari grup RS…"
            required
            emptyMessage="Belum ada grup HKA."
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
      </Card>

      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold">Produk diajukan ({produkList.length})</span>
      </div>

      {produkList.map((p, idx) => {
        const product = productByKode.get(p.kodeProduk);
        const dipakaiLain = new Set(produkList.filter((_, i) => i !== idx && produkList[i].kodeProduk).map((pp) => pp.kodeProduk));
        const pct = p.skemaPembayaran === "DISKON" ? parseFloat(p.estimasiDiskonPct) || 0 : 0;
        const top = discountApprovalLevel(pct);
        const butuh = levelsUpTo(top).filter((l) => !isAutoApprovedLevel(l, creatorLevel));
        return (
          <Card key={idx} className="mb-4" style={{ background: "var(--color-bg-subtle)" }}>
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
                  onChange={(v) => update(idx, { kodeProduk: v })}
                  placeholder="Cari produk…"
                />
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
            </div>

            {product && (
              <div className="text-xs mt-2" style={{ color: "var(--color-text-muted)" }}>
                HNA SJ: <strong>{rp(parseFloat(product.hna))}</strong> ({product.satuan})
              </div>
            )}

            <div className="mt-3">
              <span className="text-xs font-medium block mb-1">Catatan</span>
              <input
                type="text"
                className="input-field text-sm w-full"
                value={p.catatan}
                onChange={(e) => update(idx, { catatan: e.target.value })}
                placeholder="Opsional"
              />
            </div>

            {p.kodeProduk && (
              <div className="mt-3 text-xs rounded px-3 py-2" style={{ background: "var(--color-blue-light)", color: "var(--color-blue)" }}>
                Level approval sampai <strong>{top}</strong>
                {butuh.length === 0
                  ? " — semua level otomatis disetujui (setara level Anda)."
                  : ` — menunggu persetujuan: ${butuh.join(", ")}.`}
              </div>
            )}
          </Card>
        );
      })}

      <div className="mb-4">
        <Button type="button" variant="secondary" onClick={() => setProdukList((prev) => [...prev, emptyProduk()])}>+ Tambah Produk</Button>
      </div>

      <div className="flex justify-end gap-2">
        <Link href="/poa-standarisasi/pusat"><Button type="button" variant="secondary">Batal</Button></Link>
        <Button type="button" disabled={pending || !hkaGroup} onClick={handleSubmit}>
          {pending ? "Membuat…" : "Buat & Lanjut ke Approval Atasan"}
        </Button>
      </div>
    </div>
  );
}
