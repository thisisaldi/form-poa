"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import type { PoaLineItem } from "@prisma/client";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { spesLabel } from "@/lib/spesialisasi";
import { getAllPakets } from "@/lib/paketProduk";
import { submitPoaWithSelectionAction } from "@/app/actions/poa";
import { deleteLineItemAction } from "@/app/actions/lineItem";

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

// ─── Dummy data (deterministik, ganti saat data aktual tersedia) ──────────────

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

interface DummySales {
  historis2025: number;
  salesYtd: number;
  growthPct: number;
}

function computeDummyTarget(seed: string, totalEstimasi: number): number {
  const h = hashSeed(seed);
  const fraction = 0.60 + (h % 16) / 100; // 60–75% → ratio estimasi/target ≈ 133–167%
  return Math.max(totalEstimasi * fraction, 1_000_000);
}

function computeDummySales(seed: string, totalEstimasi: number): DummySales {
  const h = hashSeed(seed);
  const base = Math.max(totalEstimasi, 5_000_000);
  const historis2025 = base * (10 + (h % 10));
  const growthFactor = 0.88 + (h % 25) / 100;
  const salesYtd = historis2025 * growthFactor * (7 / 12);
  return { historis2025, salesYtd, growthPct: (growthFactor - 1) * 100 };
}

// ─── Stats computation ────────────────────────────────────────────────────────

function computeStats(items: PoaLineItem[]) {
  let estimasiTotal = 0, psspTotal = 0, discountTotal = 0, entertainTotal = 0;
  for (const it of items) {
    const base = toNum(it.rencanaTotalBiaya);
    estimasiTotal  += base;
    psspTotal      += base * (toNum(it.persenPsspDokter) + toNum(it.persenPsspKpdm));
    discountTotal  += base * (toNum(it.persenDiskon) + toNum(it.persenDp) + toNum(it.persenListingFee));
    entertainTotal += base * toNum(it.persenEntertain);
  }
  const sudah  = items.filter((i) => i.statusStandarisasi === "SUDAH_STANDARISASI").length;
  const proses = items.filter((i) => i.statusStandarisasi === "PROSES_PENGAJUAN").length;
  return {
    estimasiTotal, psspTotal, discountTotal, entertainTotal,
    budgetTotal: psspTotal + discountTotal + entertainTotal,
    productCount: new Set(items.filter((i) => getAllPakets(i.namaProduk).length > 0).map((i) => i.kodeProduk)).size,
    totalPengajuan: items.length,
    sudahStandar: sudah,
    prosesStandar: proses,
    gap: items.length - sudah,
  };
}

// ─── UI primitives ────────────────────────────────────────────────────────────

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
      <div className="h-full rounded-full transition-all duration-300"
        style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest mb-3 pt-1"
      style={{ color: "var(--color-text-faint)", borderTop: "1px solid var(--color-border)" }}>
      {children}
    </p>
  );
}

// ─── Stats Panel ─────────────────────────────────────────────────────────────

function StatsPanel({
  items, selectedDoctorCount, totalDoctorCount, targetArea, dummySales,
}: {
  items: PoaLineItem[];
  selectedDoctorCount: number;
  totalDoctorCount: number;
  targetArea: number;
  dummySales: DummySales;
}) {
  const [salesOpen, setSalesOpen] = useState(false);
  const s = computeStats(items);

  const ratioEst     = targetArea > 0 ? (s.estimasiTotal / targetArea) * 100 : 0;
  const ratioBudget  = targetArea > 0 ? (s.budgetTotal / targetArea) * 100 : 0;
  const salesPlusEst = dummySales.salesYtd + s.estimasiTotal;
  const achievePct   = targetArea > 0 ? (salesPlusEst / targetArea) * 100 : 0;

  const allSelected  = selectedDoctorCount === totalDoctorCount;
  const DANGER       = "var(--color-danger, #dc2626)";
  const MUTED        = "var(--color-text-muted)";
  const FAINT        = "var(--color-text-faint)";
  const TEXT         = "var(--color-text)";
  const BORDER       = "var(--color-border)";
  const BG           = "var(--color-bg-subtle)";
  const PRIMARY      = "var(--color-primary, #2563eb)";

  return (
    <Card>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-5">
        <p className="font-semibold text-base" style={{ color: TEXT }}>Ringkasan POA</p>
        <span className="text-xs px-2 py-0.5 rounded" style={{ background: BG, color: FAINT }}>
          {allSelected
            ? `${totalDoctorCount} user dipilih`
            : `${selectedDoctorCount} dari ${totalDoctorCount} user`}
        </span>
      </div>

      {/* ── 1. Estimasi vs Target ── */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        {[
          { label: "Estimasi POA",  value: s.estimasiTotal > 0 ? formatRp(s.estimasiTotal) : "—", span: false },
          { label: "Target Area ★", value: formatRp(targetArea), span: false },
          {
            label: "Rasio Estimasi",
            value: ratioEst > 0 ? `${ratioEst.toFixed(0)}%` : "—",
            sub: ratioEst >= 140 ? "Memenuhi target" : ratioEst > 0 ? "Di bawah 140%" : undefined,
            danger: ratioEst > 0 && ratioEst < 140,
            span: true,
          },
        ].map(({ label, value, sub, danger, span }) => (
          <div key={label} className={`rounded-lg p-3 space-y-0.5${span ? " col-span-2" : ""}`}
            style={{ background: BG, border: `1px solid ${BORDER}` }}>
            <p className="text-xs" style={{ color: MUTED }}>{label}</p>
            <p className={`font-bold leading-tight ${span ? "text-lg" : "text-base"}`} style={{ color: danger ? DANGER : TEXT }}>{value}</p>
            {sub && <p className="text-xs" style={{ color: danger ? DANGER : FAINT }}>{sub}</p>}
          </div>
        ))}
      </div>

      {/* Ratio bar */}
      {ratioEst > 0 && (
        <div className="mb-5 space-y-1">
          <div className="flex justify-between text-xs" style={{ color: FAINT }}>
            <span>0%</span>
            <span>Target 140%</span>
            <span>200%</span>
          </div>
          <div className="relative h-2 rounded-full overflow-hidden" style={{ background: BORDER }}>
            <div className="h-full rounded-full transition-all duration-300"
              style={{ width: `${Math.min(ratioEst / 2, 100)}%`, background: ratioEst >= 140 ? PRIMARY : DANGER }} />
            <div className="absolute top-0 bottom-0 w-px" style={{ left: "70%", background: MUTED }} />
          </div>
        </div>
      )}

      {/* ── 2. Anggaran ── */}
      <SectionTitle>Anggaran</SectionTitle>
      <div className="space-y-2.5 mb-5">
        {[
          { label: "PSSP",               value: s.psspTotal },
          { label: "Discount + DPL + DPF", value: s.discountTotal },
          { label: "Entertain",          value: s.entertainTotal },
        ].map(({ label, value }) => {
          const pct = s.estimasiTotal > 0 ? (value / s.estimasiTotal) * 100 : 0;
          return (
            <div key={label}>
              <div className="flex justify-between text-xs mb-1">
                <span style={{ color: MUTED }}>{label}</span>
                <span style={{ color: TEXT }}>
                  {value > 0 ? formatRp(value) : "—"}
                  {pct > 0 && <span style={{ color: FAINT }}> · {pct.toFixed(1)}%</span>}
                </span>
              </div>
              <Bar pct={pct * 5} color={PRIMARY} />
            </div>
          );
        })}
        <div className="flex justify-between pt-2 text-sm font-semibold"
          style={{ borderTop: `1px solid ${BORDER}`, color: TEXT }}>
          <span>Total Budget</span>
          <span>
            {formatRp(s.budgetTotal)}
            {ratioBudget > 0 && (
              <span className="ml-1.5 text-xs font-normal" style={{ color: FAINT }}>
                ({ratioBudget.toFixed(1)}% dari target ★)
              </span>
            )}
          </span>
        </div>
      </div>

      {/* ── 3. Cakupan ── */}
      <SectionTitle>Cakupan</SectionTitle>
      <div className="grid grid-cols-2 gap-3 mb-5">
        {[
          {
            label: "User",
            value: selectedDoctorCount,
            sub: selectedDoctorCount >= 30 ? "min. 30 ✓" : `min. 30 (kurang ${30 - selectedDoctorCount})`,
            danger: selectedDoctorCount < 30,
          },
          {
            label: "Produk Fokus",
            value: `${s.productCount}/22`,
            sub: s.productCount >= 22 ? "terpenuhi ✓" : `kurang ${22 - s.productCount}`,
            danger: s.productCount < 22,
          },
        ].map(({ label, value, sub, danger }) => (
          <div key={label} className="rounded-lg p-3" style={{ background: BG, border: `1px solid ${BORDER}` }}>
            <p className="text-xs mb-0.5" style={{ color: MUTED }}>{label}</p>
            <p className="text-xl font-bold" style={{ color: danger ? DANGER : TEXT }}>{value}</p>
            {sub && <p className="text-xs mt-0.5" style={{ color: danger ? DANGER : FAINT }}>{sub}</p>}
          </div>
        ))}
        <div className="col-span-2 flex justify-between items-center rounded-lg px-3 py-2"
          style={{ background: BG, border: `1px solid ${BORDER}` }}>
          <p className="text-xs" style={{ color: MUTED }}>Total baris pengajuan</p>
          <p className="text-sm font-bold" style={{ color: TEXT }}>{s.totalPengajuan}</p>
        </div>
      </div>

      {/* ── 4. Listing / Standarisasi ── */}
      <SectionTitle>Listing Produk</SectionTitle>
      <div className="mb-5 space-y-2">
        {s.totalPengajuan > 0 ? (
          <>
            <div className="h-2 rounded-full overflow-hidden flex" style={{ background: BORDER }}>
              <div className="h-full transition-all duration-300"
                style={{ width: `${(s.sudahStandar / s.totalPengajuan) * 100}%`, background: PRIMARY }} />
              <div className="h-full transition-all duration-300"
                style={{ width: `${(s.prosesStandar / s.totalPengajuan) * 100}%`, background: MUTED, opacity: 0.4 }} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
              <span style={{ color: MUTED }}>Sudah listing <span style={{ color: TEXT, fontWeight: 600 }}>{s.sudahStandar}</span></span>
              <span style={{ color: MUTED }}>Proses <span style={{ color: TEXT, fontWeight: 600 }}>{s.prosesStandar}</span></span>
              {s.gap > 0 && (
                <span style={{ color: DANGER }}>Belum <span style={{ fontWeight: 600 }}>{s.gap}</span> — perlu ditindaklanjuti</span>
              )}
              {s.gap === 0 && <span style={{ color: MUTED }}>Semua sudah listing ✓</span>}
            </div>
          </>
        ) : (
          <p className="text-xs" style={{ color: FAINT }}>Tidak ada data.</p>
        )}
      </div>

      {/* ── 5. Data Sales (collapsible, dummy) ── */}
      <button
        type="button"
        onClick={() => setSalesOpen((v) => !v)}
        className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-left"
        style={{ background: BG, border: `1px solid ${BORDER}` }}>
        <span className="text-xs" style={{ color: MUTED }}>
          Data Sales <span style={{ color: FAINT }}>★ data sementara</span>
        </span>
        <span className="text-xs" style={{ color: FAINT }}>{salesOpen ? "▲" : "▼"}</span>
      </button>

      {salesOpen && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            { label: "Historis 2025",       value: formatRp(dummySales.historis2025) },
            { label: "Sales YTD 2026",      value: formatRp(dummySales.salesYtd) },
            { label: "Sales YTD + Estimasi", value: formatRp(salesPlusEst) },
            { label: "Growth YTD",          value: `${dummySales.growthPct >= 0 ? "+" : ""}${dummySales.growthPct.toFixed(1)}%`, danger: dummySales.growthPct < 0 },
            { label: "Achievement YTD+Est", value: achievePct > 0 ? `${achievePct.toFixed(1)}%` : "—", danger: achievePct > 0 && achievePct < 100 },
          ].map(({ label, value, danger }) => (
            <div key={label} className="rounded-lg p-2.5"
              style={{ background: BG, border: `1px solid ${BORDER}` }}>
              <p className="text-xs mb-0.5" style={{ color: FAINT }}>{label}</p>
              <p className="text-sm font-semibold" style={{ color: danger ? DANGER : TEXT }}>{value}</p>
            </div>
          ))}
          <p className="col-span-full text-xs mt-1" style={{ color: FAINT }}>
            ★ Data dummy — akan diganti data aktual.
          </p>
        </div>
      )}
    </Card>
  );
}

// ─── Doctor row ───────────────────────────────────────────────────────────────

function DoctorRow({
  doctorItems, checked, onToggle, totalEstimasi, poaId, userCanEdit,
}: {
  doctorItems: PoaLineItem[];
  checked: boolean;
  onToggle: () => void;
  totalEstimasi: number;
  poaId?: string;
  userCanEdit?: boolean;
}) {
  const first = doctorItems[0];
  const rowEst = doctorItems.reduce((s, it) => s + toNum(it.rencanaTotalBiaya), 0);
  const isDokterBaru = !first.kodeCust;
  const contribPct = totalEstimasi > 0 ? (rowEst / totalEstimasi) * 100 : 0;
  const [isDeleting, startDelete] = useTransition();

  function handleDelete(itemId: string) {
    if (!poaId) return;
    if (!confirm("Hapus baris ini?")) return;
    startDelete(() => deleteLineItemAction(poaId, itemId));
  }

  return (
    <div className="flex items-center gap-3 py-3 px-2 rounded-lg" style={{ opacity: checked ? 1 : 0.5 }}>
      <label className="flex items-center gap-3 cursor-pointer flex-1 min-w-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="h-4 w-4 shrink-0 rounded"
          style={{ accentColor: "var(--color-primary)" }}
        />
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
              {first.namaCust}
            </span>
            {isDokterBaru && (
              <span className="text-xs px-1.5 py-0.5 rounded font-medium shrink-0"
                style={{ background: "#fff7ed", color: "#92400e", border: "1px solid #fcd34d" }}>
                Baru
              </span>
            )}
            <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>
              {spesLabel(first.spesialisasi)}
            </span>
          </div>
          <p className="text-xs truncate" style={{ color: "var(--color-text-faint)" }}>
            {first.namaOutlet}
          </p>
          {checked && contribPct > 0 && (
            <div className="h-1 rounded-full overflow-hidden mt-1" style={{ background: "var(--color-border)" }}>
              <div className="h-full rounded-full" style={{ width: `${contribPct}%`, background: "var(--color-primary, #2563eb)", opacity: 0.5 }} />
            </div>
          )}
        </div>
      </label>

      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right">
          <p className="text-xs font-medium" style={{ color: "var(--color-text)" }}>
            {doctorItems.length} produk
          </p>
          {rowEst > 0 && (
            <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>{formatRp(rowEst)}</p>
          )}
          {contribPct > 0 && (
            <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>{contribPct.toFixed(1)}%</p>
          )}
        </div>
        {userCanEdit && poaId && (
          <div className="flex flex-col gap-1 items-end">
            <Link href={`/poa/${poaId}/items/${doctorItems[0].id}/edit`}
              className="text-xs font-medium" style={{ color: "var(--color-blue)" }}>
              Edit
            </Link>
            <button
              type="button"
              disabled={isDeleting}
              onClick={() => handleDelete(doctorItems[0].id)}
              className="text-xs" style={{ color: "var(--color-red)" }}>
              Hapus
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function DraftChecklist({ items, poaId, showSubmit, userCanEdit }: {
  items: PoaLineItem[];
  poaId?: string;
  showSubmit?: boolean;
  userCanEdit?: boolean;
}) {
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

  // Stable dummy values (not affected by checklist)
  const { targetArea, salesDummy } = useMemo(() => {
    const totalEst = items.reduce((s, it) => s + toNum(it.rencanaTotalBiaya), 0);
    const seed = items.length > 0 ? (items[0].kodePI ?? items[0].namaCust ?? "x") : "x";
    return {
      targetArea: computeDummyTarget(seed, totalEst),
      salesDummy: computeDummySales(seed, totalEst),
    };
  }, [items]);

  const selectedItems = useMemo(
    () => items.filter((it) => checked.has(doctorKey(it))),
    [items, checked],
  );

  // Total estimasi of selected items (for contribution bars)
  const selectedEstimasi = useMemo(
    () => selectedItems.reduce((s, it) => s + toNum(it.rencanaTotalBiaya), 0),
    [selectedItems],
  );

  const [isSubmitting, startSubmit] = useTransition();

  function handleSubmit() {
    if (!poaId || checked.size === 0) return;
    const keepIds = items
      .filter((it) => checked.has(doctorKey(it)))
      .map((it) => it.id);
    startSubmit(() => submitPoaWithSelectionAction(poaId, keepIds));
  }

  if (items.length === 0) return null;

  const allChecked = checked.size === allKeys.length;

  return (
    <div className="grid md:grid-cols-[3fr_2fr] gap-5 items-start">
      {/* Left: checklist */}
      <div className="space-y-4 min-w-0">
        {/* Stats visible on mobile (above checklist) */}
        <div className="md:hidden">
          <StatsPanel
            items={selectedItems}
            selectedDoctorCount={checked.size}
            totalDoctorCount={allKeys.length}
            targetArea={targetArea}
            dummySales={salesDummy}
          />
        </div>

        <Card>
          {/* Checklist header */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>Daftar User</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
                Centang user yang ingin dihitung statistiknya
              </p>
            </div>
            <div className="flex items-center gap-2">
              {userCanEdit && poaId && (
                <Link href={`/poa/${poaId}/edit`}
                  className="text-xs px-2.5 py-1 rounded-md font-medium"
                  style={{ background: "var(--color-primary)", color: "#fff" }}>
                  + Tambah
                </Link>
              )}
              <button
                type="button"
                className="text-xs px-2.5 py-1 rounded-md font-medium"
                style={{ background: "var(--color-bg-subtle)", color: "var(--color-blue)", border: "1px solid var(--color-border)" }}
                onClick={toggleAll}
              >
                {allChecked ? "Batal semua" : "Pilih semua"}
              </button>
            </div>
          </div>

          <div className="space-y-0.5">
            {[...groups.entries()].map(([key, doctorItems]) => (
              <DoctorRow
                key={key}
                doctorItems={doctorItems}
                checked={checked.has(key)}
                onToggle={() => toggle(key)}
                totalEstimasi={selectedEstimasi}
                poaId={poaId}
                userCanEdit={userCanEdit}
              />
            ))}
          </div>
        </Card>

        {showSubmit && poaId && (
          <div className="rounded-lg border p-4"
            style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
            <p className="text-sm font-medium mb-1" style={{ color: "var(--color-text)" }}>
              Ajukan ke Atasan
            </p>
            <p className="text-xs mb-3" style={{ color: "var(--color-text-muted)" }}>
              {checked.size === allKeys.length
                ? `Semua ${allKeys.length} user akan diajukan.`
                : checked.size === 0
                ? "Pilih minimal 1 user untuk diajukan."
                : `${checked.size} dari ${allKeys.length} user dipilih — ${allKeys.length - checked.size} user tidak dicentang akan dihapus dari POA.`}
            </p>
            <Button
              type="button"
              disabled={checked.size === 0 || isSubmitting}
              onClick={handleSubmit}>
              {isSubmitting ? "Mengajukan…" : "Ajukan ke Atasan"}
            </Button>
          </div>
        )}
      </div>

      {/* Right: stats panel — sticky, scrollable internally so it never enlarges the page */}
      <div className="hidden md:block sticky top-8 max-h-[calc(100vh-5rem)] overflow-y-auto">
        <StatsPanel
          items={selectedItems}
          selectedDoctorCount={checked.size}
          totalDoctorCount={allKeys.length}
          targetArea={targetArea}
          dummySales={salesDummy}
        />
      </div>
    </div>
  );
}
