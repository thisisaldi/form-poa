"use client";

import { Card } from "@/components/ui/Card";

const TEXT    = "var(--color-text)";
const MUTED   = "var(--color-text-muted)";
const FAINT   = "var(--color-text-faint)";
const BORDER  = "var(--color-border)";
const GREEN   = "var(--color-green)";
const WARNING = "var(--color-warning)";
const DANGER  = "var(--color-red)";

export interface KriteriaBucket {
  /** Distinct products in this paket classified under this kategori/status,
   * across every outlet in the visible territory (deduped by kodeProduk —
   * see summary/page.tsx for the dedup rule when a product's classification
   * differs across outlets). */
  total: number;
  /** Of those, how many already have >=1 submitted POA line item. */
  covered: number;
}

export interface PaketRekomendasiStat {
  paket: string;
  /** Distinct doctors in the visible territory whose spesialisasi is the
   * target audience for this paket (SPESIALISASI_TO_PAKET), regardless of
   * whether they've been planned for yet. */
  doctorTotal: number;
  /** Of those, how many have >=1 submitted line item for a product
   * belonging to this same paket. */
  doctorCovered: number;
  lowHangingFruit: KriteriaBucket;
  blueOcean: KriteriaBucket;
  redOcean: KriteriaBucket;
  standarisasi: KriteriaBucket;
}

/** Doctor headcount / kategori-product-coverage bar — reused for both the
 * per-paket doctor line and each of the 4 kategori buckets below it. */
function CoverageBar({ label, covered, total, color }: { label: string; covered: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(100, (covered / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs" style={{ color: MUTED }}>{label}</span>
        <span className="text-xs font-semibold" style={{ color: TEXT }}>
          {total > 0 ? `${covered}/${total}` : "-"}
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: BORDER }}>
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

const PAKET_DISPLAY_LABEL: Record<string, string> = {
  "PAKET PENCERNAAN": "Paket Pencernaan",
  "PAKET PEDIATRIC": "Paket Pediatric",
  "PAKET PERNAPASAN": "Paket Pernapasan",
  "PAKET ONKOLOGI": "Paket Onkologi",
  "PAKET PAIN": "Paket Pain",
  "PAKET PSIKIATRI": "Paket Psikiatri",
};

/**
 * Per Produk Rekomendasi tab (2026-07-31) — one section per Produk Fokus
 * paket (see PAKET_BY_PRODUK in paketProduk.ts), each showing:
 *  - doctor coverage: of every doctor in the visible territory whose
 *    spesialisasi is this paket's target audience, how many already have a
 *    submitted POA line item for a product in this same paket.
 *  - a Low Hanging Fruit / Blue Ocean / Red Ocean / Standarisasi product
 *    breakdown (OutletProductKriteria.kategori/kriteriaBaru), each also as
 *    a submitted-vs-total fraction.
 * All figures computed server-side in summary/page.tsx — this component is
 * purely presentational.
 */
export function ProdukRekomendasiView({ stats }: { stats: PaketRekomendasiStat[] }) {
  if (stats.length === 0) {
    return (
      <Card>
        <p className="py-8 text-center text-sm" style={{ color: MUTED }}>Belum ada data.</p>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {stats.map((s) => (
        <Card key={s.paket}>
          <p className="font-semibold text-sm mb-4" style={{ color: TEXT }}>
            {PAKET_DISPLAY_LABEL[s.paket] ?? s.paket}
          </p>

          <div className="rounded-lg p-3 mb-4" style={{ background: "var(--color-bg-subtle)", border: `1px solid ${BORDER}` }}>
            <CoverageBar label="Dokter sudah di POA" covered={s.doctorCovered} total={s.doctorTotal} color="var(--color-blue)" />
            {s.doctorTotal === 0 && (
              <p className="text-xs mt-1.5" style={{ color: FAINT }}>Belum ada dokter dengan spesialisasi terkait paket ini di wilayah ini.</p>
            )}
          </div>

          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: FAINT }}>Kategori Produk</p>
          <div className="space-y-2.5">
            <CoverageBar label="Low Hanging Fruit" covered={s.lowHangingFruit.covered} total={s.lowHangingFruit.total} color={GREEN} />
            <CoverageBar label="Blue Ocean" covered={s.blueOcean.covered} total={s.blueOcean.total} color="var(--color-blue)" />
            <CoverageBar label="Red Ocean" covered={s.redOcean.covered} total={s.redOcean.total} color={DANGER} />
            <CoverageBar label="Standarisasi" covered={s.standarisasi.covered} total={s.standarisasi.total} color={WARNING} />
          </div>
        </Card>
      ))}
    </div>
  );
}
