"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { createPusatAction, type PusatProdukInput } from "@/app/actions/poaStandarisasiPusat";

interface ProdukForm {
  kodeProduk: string;
  skemaPembayaran: "DISKON" | "DP";
  estimasiDiskonPct: string;
  estimasiDiskonDistributorPct: string;
  estimasiValueDpRp: string;
  catatan: string;
}

const emptyProduk = (): ProdukForm => ({ kodeProduk: "", skemaPembayaran: "DISKON", estimasiDiskonPct: "", estimasiDiskonDistributorPct: "", estimasiValueDpRp: "", catatan: "" });

const selectCls = "w-full rounded border border-[var(--color-border)] bg-white px-3 py-2 text-sm";

/** Form buat pengajuan standarisasi pusat (Produk x Grup HKA) — docs/poa-standarisasi-pusat/. */
export function PusatCreateForm({
  groups,
  productOptions,
}: {
  groups: { hkaGroup: string; jumlahOutlet: number }[];
  productOptions: { kodeProduk: string; namaProduk: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hkaGroup, setHkaGroup] = useState("");
  const [tipe, setTipe] = useState<"PERIODIC" | "SISIPAN" | "PERMANEN">("PERIODIC");
  const [periodeBulan, setPeriodeBulan] = useState("");
  const [produkList, setProdukList] = useState<ProdukForm[]>([emptyProduk()]);

  function update(idx: number, patch: Partial<ProdukForm>) {
    setProdukList((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  function handleSubmit() {
    const filled = produkList.filter((p) => p.kodeProduk);
    if (!hkaGroup) return setError("Grup wajib dipilih.");
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
    <div className="max-w-4xl space-y-4">
      <div>
        <h1>Standarisasi Pusat Baru</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Produk × Grup Hospital Key Account. Level approval ditentukan dari diskon PI per produk; level sampai level Anda otomatis disetujui.
        </p>
      </div>

      {error && (
        <div className="rounded px-3 py-2 text-sm" style={{ background: "var(--color-error-bg, #FDECEA)", color: "var(--color-error)" }}>{error}</div>
      )}

      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Grup RS
            <select className={selectCls} value={hkaGroup} onChange={(e) => setHkaGroup(e.target.value)}>
              <option value="">— pilih grup —</option>
              {groups.map((g) => <option key={g.hkaGroup} value={g.hkaGroup}>{g.hkaGroup} ({g.jumlahOutlet} outlet)</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Tipe
            <select className={selectCls} value={tipe} onChange={(e) => setTipe(e.target.value as typeof tipe)}>
              <option value="PERIODIC">Periodic</option>
              <option value="SISIPAN">Sisipan</option>
              <option value="PERMANEN">Permanen</option>
            </select>
          </label>
          {tipe !== "PERMANEN" && (
            <Input label="Periode (bulan)" type="number" min={1} value={periodeBulan} onChange={(e) => setPeriodeBulan(e.target.value)} />
          )}
        </div>
      </Card>

      {produkList.map((p, idx) => (
        <Card key={idx}>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
              Produk
              <select className={selectCls} value={p.kodeProduk} onChange={(e) => update(idx, { kodeProduk: e.target.value })}>
                <option value="">— pilih produk —</option>
                {productOptions.map((o) => <option key={o.kodeProduk} value={o.kodeProduk}>{o.namaProduk}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Skema
              <select className={selectCls} value={p.skemaPembayaran} onChange={(e) => update(idx, { skemaPembayaran: e.target.value as "DISKON" | "DP" })}>
                <option value="DISKON">Diskon</option>
                <option value="DP">DP</option>
              </select>
            </label>
            <div className="flex items-end justify-end">
              {produkList.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => setProdukList((prev) => prev.filter((_, i) => i !== idx))}>Hapus</Button>}
            </div>
            {p.skemaPembayaran === "DISKON" ? (
              <>
                <Input label="Estimasi Diskon PI (%)" type="number" min={0} max={100} step="0.01" value={p.estimasiDiskonPct} onChange={(e) => update(idx, { estimasiDiskonPct: e.target.value })} />
                <Input label="Estimasi Diskon Distributor (%)" type="number" min={0} max={100} step="0.01" value={p.estimasiDiskonDistributorPct} onChange={(e) => update(idx, { estimasiDiskonDistributorPct: e.target.value })} />
              </>
            ) : (
              <Input label="Value DP (Rp)" type="number" min={0} value={p.estimasiValueDpRp} onChange={(e) => update(idx, { estimasiValueDpRp: e.target.value })} />
            )}
            <div className="sm:col-span-2">
              <Input label="Catatan" value={p.catatan} onChange={(e) => update(idx, { catatan: e.target.value })} />
            </div>
          </div>
        </Card>
      ))}

      <div className="flex gap-3">
        <Button type="button" variant="secondary" onClick={() => setProdukList((prev) => [...prev, emptyProduk()])}>+ Tambah Produk</Button>
        <Button type="button" disabled={pending} onClick={handleSubmit}>{pending ? "Membuat…" : "Buat & Lanjut ke Approval"}</Button>
        <Link href="/poa-standarisasi/pusat"><Button type="button" variant="ghost">Batal</Button></Link>
      </div>
    </div>
  );
}
