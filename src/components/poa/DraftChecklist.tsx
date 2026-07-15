"use client";

import { useState, useMemo } from "react";
import type { PoaLineItem } from "@prisma/client";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { spesLabel } from "@/lib/spesialisasi";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRp(n: number) {
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1).replace(".", ",")} M`;
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1).replace(".", ",")} Jt`;
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

function toNum(v: unknown): number {
  return parseFloat(String(v ?? 0)) || 0;
}

function doctorKey(item: PoaLineItem): string {
  return `${item.kodePI ?? ""}|${item.namaCust}`;
}

// ─── Stats computation ────────────────────────────────────────────────────────

function computeStats(items: PoaLineItem[]) {
  let estimasiTotal = 0, psspTotal = 0, discountTotal = 0, entertainTotal = 0;
  for (const it of items) {
    const base = toNum(it.rencanaTotalBiaya);
    estimasiTotal += base;
    psspTotal += base * (toNum(it.persenPsspDokter) + toNum(it.persenPsspKpdm));
    discountTotal += base * (toNum(it.persenDiskon) + toNum(it.persenDp) + toNum(it.persenListingFee));
    entertainTotal += base * toNum(it.persenEntertain);
  }
  const budgetTotal = psspTotal + discountTotal + entertainTotal;
  const productSet = new Set(items.map((i) => i.kodeProduk));
  const sudah = items.filter((i) => i.statusStandarisasi === "SUDAH_STANDARISASI").length;
  const proses = items.filter((i) => i.statusStandarisasi === "PROSES_PENGAJUAN").length;
  return {
    estimasiTotal, psspTotal, discountTotal, entertainTotal, budgetTotal,
    productCount: productSet.size,
    totalPengajuan: items.length,
    sudahStandar: sudah,
    prosesStandar: proses,
    gap: items.length - sudah,
  };
}

// ─── Stats display ────────────────────────────────────────────────────────────

function StatCell({ label, value, sub, warn }: {
  label: string; value: React.ReactNode; sub?: string; warn?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs font-medium uppercase tracking-wider"
        style={{ color: "var(--color-text-faint)" }}>{label}</div>
      <div className="text-sm font-semibold"
        style={{ color: warn ? "var(--color-red, #dc2626)" : "var(--color-text)" }}>{value}</div>
      {sub && <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>{sub}</div>}
    </div>
  );
}

function SectionDivider({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-full text-xs font-semibold uppercase tracking-wider pt-1"
      style={{ color: "var(--color-text-faint)", borderTop: "1px solid var(--color-border)" }}>
      {children}
    </div>
  );
}

function StatsPanel({
  items, selectedDoctorCount, totalDoctorCount,
}: {
  items: PoaLineItem[];
  selectedDoctorCount: number;
  totalDoctorCount: number;
}) {
  const s = computeStats(items);
  const allSelected = selectedDoctorCount === totalDoctorCount;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ringkasan POA</CardTitle>
        <span className="text-xs px-2 py-0.5 rounded"
          style={{ background: "var(--color-bg-subtle)", color: allSelected ? "var(--color-text-faint)" : "var(--color-primary)" }}>
          {allSelected
            ? `${totalDoctorCount} dokter · ${items.length} baris`
            : `${selectedDoctorCount} / ${totalDoctorCount} dokter dipilih`}
        </span>
      </CardHeader>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">

        <SectionDivider>Estimasi Penjualan</SectionDivider>
        <StatCell label="Total Estimasi" value={formatRp(s.estimasiTotal)} />
        <StatCell label="Target Area" value="—" sub="pending" />
        <StatCell label="Ratio Estimasi" value="—" sub="min 140%" />

        <SectionDivider>Anggaran</SectionDivider>
        <StatCell label="Biaya PSSP" value={formatRp(s.psspTotal)}
          sub={s.estimasiTotal > 0 ? `${((s.psspTotal / s.estimasiTotal) * 100).toFixed(1)}% est` : undefined} />
        <StatCell label="Discount + DPL + DPF" value={formatRp(s.discountTotal)}
          sub={s.estimasiTotal > 0 ? `${((s.discountTotal / s.estimasiTotal) * 100).toFixed(1)}% est` : undefined} />
        <StatCell label="Entertain" value={formatRp(s.entertainTotal)}
          sub={s.estimasiTotal > 0 ? `${((s.entertainTotal / s.estimasiTotal) * 100).toFixed(1)}% est` : undefined} />
        <StatCell label="Total Budget" value={formatRp(s.budgetTotal)} />
        <StatCell label="Ratio Budget / Target" value="—" sub="pending" />

        <SectionDivider>Cakupan</SectionDivider>
        <StatCell label="Customer" value={selectedDoctorCount}
          warn={selectedDoctorCount < 30}
          sub={selectedDoctorCount < 30 ? "⚠ kurang dari 30" : "≥ 30 ✓"} />
        <StatCell label="Variasi Produk" value={`${s.productCount} / 22`}
          warn={s.productCount < 22}
          sub={s.productCount < 22 ? `gap ${22 - s.productCount}` : "terpenuhi ✓"} />
        <StatCell label="Total Pengajuan" value={s.totalPengajuan} />

        <SectionDivider>Standarisasi</SectionDivider>
        <StatCell label="Sudah Listing" value={s.sudahStandar}
          sub={`${s.totalPengajuan > 0 ? ((s.sudahStandar / s.totalPengajuan) * 100).toFixed(0) : 0}% total`} />
        <StatCell label="Proses" value={s.prosesStandar} />
        <StatCell label="Gap (Belum)" value={s.gap} warn={s.gap > 0}
          sub={s.gap > 0 ? "perlu listing" : "semua listing ✓"} />

        <SectionDivider>Data Sales</SectionDivider>
        <StatCell label="Historis 2025" value="—" sub="pending" />
        <StatCell label="Sales YTD 2026" value="—" sub="pending" />
        <StatCell label="Sales YTD + Estimasi" value="—" sub="pending" />
        <StatCell label="Growth YTD" value="—" sub="pending" />
        <StatCell label="Achievement YTD + Est" value="—" sub="pending" />
      </div>
    </Card>
  );
}

// ─── Doctor row ───────────────────────────────────────────────────────────────

function DoctorRow({
  doctorItems, checked, onToggle,
}: {
  doctorItems: PoaLineItem[];
  checked: boolean;
  onToggle: () => void;
}) {
  const first = doctorItems[0];
  const totalEst = doctorItems.reduce((s, it) => s + toNum(it.rencanaTotalBiaya), 0);
  const isDokterBaru = !first.kodeCust;

  return (
    <label className="flex items-center gap-3 py-2.5 px-1 cursor-pointer rounded-md group"
      style={{ opacity: checked ? 1 : 0.45 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="h-4 w-4 shrink-0 rounded accent-[var(--color-primary)]"
        style={{ accentColor: "var(--color-primary)" }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
            {first.namaCust}
          </span>
          {isDokterBaru && (
            <span className="text-xs px-1.5 py-0.5 rounded shrink-0"
              style={{ background: "var(--color-warning-light, #fff7ed)", color: "var(--color-warning, #92400e)", border: "1px solid var(--color-warning-border, #fcd34d)" }}>
              Baru
            </span>
          )}
          <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>·</span>
          <span className="text-xs truncate" style={{ color: "var(--color-text-muted)" }}>
            {spesLabel(first.spesialisasi)}
          </span>
        </div>
        <div className="text-xs mt-0.5 truncate" style={{ color: "var(--color-text-faint)" }}>
          {first.namaOutlet}
        </div>
      </div>
      <div className="text-right shrink-0 space-y-0.5">
        <div className="text-xs font-medium" style={{ color: "var(--color-text)" }}>
          {doctorItems.length} produk
        </div>
        {totalEst > 0 && (
          <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>
            {formatRp(totalEst)}
          </div>
        )}
      </div>
    </label>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function DraftChecklist({ items }: { items: PoaLineItem[] }) {
  // Group by doctor (outlet + doctor name)
  const groups = useMemo(() => {
    const map = new Map<string, PoaLineItem[]>();
    for (const item of items) {
      const key = doctorKey(item);
      const g = map.get(key) ?? [];
      g.push(item);
      map.set(key, g);
    }
    return map;
  }, [items]);

  const allKeys = useMemo(() => [...groups.keys()], [groups]);

  // All checked by default
  const [checked, setChecked] = useState<Set<string>>(() => new Set(allKeys));

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setChecked(checked.size === allKeys.length ? new Set() : new Set(allKeys));
  }

  // Items from checked doctors only
  const selectedItems = useMemo(
    () => items.filter((it) => checked.has(doctorKey(it))),
    [items, checked]
  );

  if (items.length === 0) return null;

  const allChecked = checked.size === allKeys.length;

  return (
    <div className="space-y-4">
      {/* Stats — updates with checklist */}
      <StatsPanel
        items={selectedItems}
        selectedDoctorCount={checked.size}
        totalDoctorCount={allKeys.length}
      />

      {/* Compact checklist */}
      <Card>
        <CardHeader>
          <CardTitle>Baris POA</CardTitle>
          <button
            type="button"
            className="text-xs"
            style={{ color: "var(--color-blue)" }}
            onClick={toggleAll}
          >
            {allChecked ? "Batalkan semua" : "Pilih semua"}
          </button>
        </CardHeader>

        <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
          {[...groups.entries()].map(([key, doctorItems]) => (
            <DoctorRow
              key={key}
              doctorItems={doctorItems}
              checked={checked.has(key)}
              onToggle={() => toggle(key)}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
