import { useState, useTransition, useEffect, useMemo } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { BlastInBadge, InsScBadge } from "@/components/ui/BlastInBadge";
import { deleteSalesCounterFormAction } from "@/app/actions/scActions";
import { formatRp } from "./SalesCounterStatsPanel";
import type { ScDraftFormItem } from "../types";
import { getB3PeriodInfo } from "@/lib/b3Utils";
import { getScOutletB3SalesAction, getScCashbackPoaAction } from "@/app/actions/canvasser";
import { calculateCashbackDetails } from "../edit/hooks/useSalesCounterCashback";

function StatTile({ label, value, sub, emphasize = false }: { label: string; value: string; sub?: string; emphasize?: boolean }) {
  return (
    <div className="rounded-md px-2.5 py-2 min-w-0" style={{ background: "var(--color-bg-subtle)", border: "1px solid var(--color-border)" }}>
      <p className="text-[11px] leading-tight" style={{ color: "var(--color-text-faint)" }}>{label}</p>
      <p className={`leading-tight truncate ${emphasize ? "text-sm font-bold" : "text-sm font-semibold"}`} style={{ color: "var(--color-text)" }}>
        {value}
      </p>
      {sub && <p className="text-[11px] leading-tight mt-0.5 truncate" style={{ color: "var(--color-text-faint)" }}>{sub}</p>}
    </div>
  );
}

function formatMonthLabel(m: string) {
  if (m.length !== 6) return m;
  const year = m.slice(0, 4);
  const monthIndex = parseInt(m.slice(4, 6), 10) - 1;
  return new Date(parseInt(year), monthIndex).toLocaleString("id-ID", { month: "short", year: "numeric" });
}

export function SalesCounterOutletCard({
  draft,
  checked,
  onToggle,
  selectable = true,
  poaId,
  userCanEdit,
}: {
  draft: ScDraftFormItem;
  checked: boolean;
  onToggle: () => void;
  selectable?: boolean;
  poaId: string;
  userCanEdit?: boolean;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();

  const [b3SalesMap, setB3SalesMap] = useState<Map<string, number>>(new Map());
  const [cashbackData, setCashbackData] = useState<any>(null);

  useEffect(() => {
    getScCashbackPoaAction().then((res) => setCashbackData(res));
  }, []);
  const [b3RangeLabel, setB3RangeLabel] = useState<string>("");

  const isExpanded = detailOpen;

  useEffect(() => {
    if (!isExpanded || !draft.kodePI) return;
    const proCodes = draft.products.map((p) => p.kodeProduk).filter(Boolean);
    if (proCodes.length === 0) return;

    const b3Info = getB3PeriodInfo(draft.periodeAwal || draft.period || poaId);
    setB3RangeLabel(b3Info.rangeLabel);

    getScOutletB3SalesAction(b3Info.period, draft.kodePI, proCodes).then((res) => {
      const map = new Map<string, number>();
      if (res?.data && Array.isArray(res.data)) {
        for (const item of res.data) {
          if (item.pro_code) map.set(item.pro_code, item.average_sales || 0);
        }
      }
      setB3SalesMap(map);
    });
  }, [isExpanded, draft.kodePI, draft.products, poaId]);

  const days = draft.hariKerjaBulan || 0;
  const lama = draft.lamaPeriode || 3;

  const cbDetails = useMemo(() => {
    return calculateCashbackDetails({
      cashbackData,
      selectedProducts: draft.products.map((p) => ({
        kodeProduk: p.kodeProduk,
        pembeliHari: String(p.pembeliHari || 0),
        qtyCustomerBaru: String(p.qtyCustomerBaru || 0),
        persenCashback: String(p.persenCashback || 0),
      })),
      masterProducts: draft.products.map((p) => ({
        kodeProduk: p.kodeProduk,
        hna: String(p.hnaSJ || 0),
        konversiPembagi: String(p.konversiPembagi || 1),
      })),
      hariKerjaBulan: draft.hariKerjaBulan,
      lamaPeriode: draft.lamaPeriode,
    });
  }, [cashbackData, draft]);

  // Compute stats per outlet draft
  let outletEstSales = 0;
  let outletNilaiSc = 0;
  let totalWeightedMatriks = 0;

  for (const p of draft.products) {
    const hnaSJ = p.hnaSJ || 0;
    const konv = p.konversiPembagi || 1;
    const hnaST = hnaSJ / konv;

    const estMonth = (p.pembeliHari || 0) * (p.qtyCustomerBaru || 0) * days * hnaST;
    const estFull = estMonth * lama;
    
    const qtySjBln = konv > 0 ? ((p.pembeliHari || 0) * (p.qtyCustomerBaru || 0) * days) / konv : 0;
    const scVal = p.salesCounterValue;
    const scMin = p.salesCounterMinimum || 0;

    let valScPerMonth = 0;
    if (scVal != null && scVal > 0) {
      valScPerMonth = qtySjBln >= scMin ? qtySjBln * scVal : 0;
    } else {
      valScPerMonth = estMonth * ((p.persenMatriksSc || 0) / 100);
    }
    const valScFull = valScPerMonth * lama;

    outletEstSales += estFull;
    outletNilaiSc += valScFull;
    totalWeightedMatriks += estFull * (p.persenMatriksSc || 0);
  }

  const avgMatriks = outletEstSales > 0 ? totalWeightedMatriks / outletEstSales : 0;
  const totalEntertain = draft.entertainItems.reduce((s, e) => s + (e.biayaEntertain || 0), 0);
  const canvasserNames = draft.persons.map((p) => `${p.personName} (${p.positionName})`).join(", ");

  function handleDelete() {
    if (!confirm(`Hapus rencana POA SC untuk ${draft.namaOutlet}?`)) return;
    startDelete(async () => {
      await deleteSalesCounterFormAction(draft.id);
    });
  }

  return (
    <div className="py-3 px-2.5 rounded-lg" style={{ opacity: checked ? 1 : 0.5, border: "1px solid var(--color-border)" }}>
      <div className="flex items-start gap-3">
        {selectable && (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            className="h-4 w-4 shrink-0 rounded mt-0.5"
            style={{ accentColor: "var(--color-blue)" }}
          />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
              {draft.kodePI ? `${draft.kodePI} · ` : ""}{draft.namaOutlet}
            </span>
          </div>

          <p className="text-xs font-medium truncate mt-0.5" style={{ color: "var(--color-text-muted)" }}>
            SC: {canvasserNames || "Tidak ada SC"}
          </p>
          <p className="text-[11px] truncate" style={{ color: "var(--color-text-faint)" }}>
            Hari Kerja: {days} hr/bln · Visit: {draft.rencanaVisitMinggu} kali/bln · Survey Pasien: {draft.surveyPasienHarian} pasien/hr
          </p>

          {/* Stat grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-2.5">
            <StatTile label="Estimasi Sales" value={outletEstSales > 0 ? formatRp(outletEstSales) : "-"} emphasize />
            <StatTile
              label="Nilai SC (Insentif)"
              value={outletNilaiSc > 0 ? formatRp(outletNilaiSc) : "-"}
              sub={draft.persons.length > 0 && outletNilaiSc > 0 ? `${formatRp(outletNilaiSc / draft.persons.length)} / orang` : undefined}
              emphasize
            />
            <StatTile label="Variasi Produk" value={`${draft.products.length} produk`} />
            <StatTile label="Entertain SC" value={totalEntertain > 0 ? formatRp(totalEntertain) : "-"} />
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusBadge status={draft.status} version={draft.version} />
          <p className="text-xs font-medium whitespace-nowrap" style={{ color: "var(--color-text)" }}>
            {draft.products.length} produk
          </p>

          <div className="flex items-center gap-2 mt-1">
            <Link
              href={`/sc/${poaId}/edit/${draft.id}`}
              className="text-xs font-medium px-2.5 py-1 rounded-md whitespace-nowrap"
              style={userCanEdit ? { background: "var(--color-blue)", color: "#fff" } : { background: "var(--color-blue-light, #eff6ff)", color: "var(--color-blue)", border: "1px solid var(--color-blue)" }}>
              {userCanEdit ? "Edit" : "Lihat"}
            </Link>
            {userCanEdit && (
              <button type="button" disabled={isDeleting} onClick={handleDelete} className="text-xs" style={{ color: "var(--color-red)" }}>
                Hapus
              </button>
            )}
          </div>

          <button type="button" onClick={() => setDetailOpen((v) => !v)} className="text-xs whitespace-nowrap mt-1" style={{ color: "var(--color-text-faint)" }}>
            Detail {detailOpen ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {detailOpen && (
        <div className="mt-3 space-y-3 pt-2" style={{ borderTop: "1px solid var(--color-border)" }}>
          {/* Products table */}
          <div className="rounded-lg border overflow-hidden overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: "var(--color-bg-subtle)" }}>
                  <th className="text-left px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>Produk SC</th>
                  <th className="text-right px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>Pembeli/Hr</th>
                  <th className="text-right px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>Qty/Pembeli</th>
                  <th className="text-right px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>Estimasi Sales</th>
                  <th className="text-right px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>Nilai SC</th>
                  <th className="text-right px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>Value Cashback</th>
                  <th className="text-right px-2.5 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>
                    <div>Growth Sebelumnya</div>
                    {b3RangeLabel && (
                      <div className="text-[10px] font-normal normal-case opacity-75">
                        ({b3RangeLabel})
                      </div>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {draft.products.map((p) => {
                  const hnaSJ = p.hnaSJ || 0;
                  const konv = p.konversiPembagi || 1;
                  const hnaST = hnaSJ / konv;

                  const estSalesFull = (p.pembeliHari || 0) * (p.qtyCustomerBaru || 0) * days * hnaST * lama;
                  const qtySjBln = konv > 0 ? ((p.pembeliHari || 0) * (p.qtyCustomerBaru || 0) * days) / konv : 0;
                  const scVal = p.salesCounterValue;
                  const scMin = p.salesCounterMinimum || 0;

                  let nilaiScPerMonth = 0;
                  if (scVal != null && scVal > 0) {
                    nilaiScPerMonth = qtySjBln >= scMin ? qtySjBln * scVal : 0;
                  } else {
                    nilaiScPerMonth = ((p.pembeliHari || 0) * (p.qtyCustomerBaru || 0) * days * hnaST) * ((p.persenMatriksSc || 0) / 100);
                  }
                  const nilaiScFull = nilaiScPerMonth * lama;
                  const valCashbackFull = cashbackData
                    ? (cbDetails.resultMap.get(p.kodeProduk) ?? 0)
                    : estSalesFull * ((p.persenCashback || 0) / 100);

                  const avgSales = b3SalesMap.get(p.kodeProduk) ?? 0;
                  const salesHistorical = avgSales * lama;
                  let growthPct = 0;
                  if (salesHistorical > 0 && estSalesFull > 0) {
                    growthPct = ((estSalesFull - salesHistorical) / salesHistorical) * 100;
                  }

                  return (
                    <tr key={p.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                      <td className="px-2.5 py-2 font-medium" style={{ color: "var(--color-text)" }}>{p.namaProduk}</td>
                      <td className="px-2.5 py-2 text-right" style={{ color: "var(--color-text-muted)" }}>{p.pembeliHari || 0}</td>
                      <td className="px-2.5 py-2 text-right" style={{ color: "var(--color-text-muted)" }}>{p.qtyCustomerBaru || 0}</td>
                      <td className="px-2.5 py-2 text-right" style={{ color: "var(--color-text)" }}>{estSalesFull > 0 ? formatRp(estSalesFull) : "-"}</td>
                      <td className="px-2.5 py-2 text-right font-semibold" style={{ color: "var(--color-blue)" }}>{nilaiScFull > 0 ? formatRp(nilaiScFull) : "-"}</td>
                      <td className="px-2.5 py-2 text-right" style={{ color: "var(--color-text-muted)" }}>{valCashbackFull > 0 ? formatRp(valCashbackFull) : "-"}</td>
                      <td className="px-2.5 py-2 text-right" style={{ color: "var(--color-text-muted)" }}>
                        {salesHistorical > 0 ? (
                          <span className={growthPct > 0 ? "text-emerald-600 font-semibold" : growthPct < 0 ? "text-rose-600 font-semibold" : ""}>
                            {growthPct > 0 ? `+${growthPct.toFixed(1)}%` : `${growthPct.toFixed(1)}%`}
                          </span>
                        ) : (
                          "0%"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {b3RangeLabel && (
              <p className="text-[11px] px-3 py-1.5 border-t" style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)", background: "var(--color-bg-subtle)" }}>
                * Growth Sebelumnya dihitung dari histori rata-rata penjualan B3 ({b3RangeLabel})
              </p>
            )}
          </div>

          {/* Entertain items breakdown if present */}
          {draft.entertainItems.length > 0 && (
            <div className="rounded-lg border p-2.5" style={{ borderColor: "var(--color-border)", background: "var(--color-bg-subtle)" }}>
              <p className="text-xs font-semibold mb-1" style={{ color: "var(--color-text-muted)" }}>Rencana Entertain SC Bulanan</p>
              <div className="flex gap-4 flex-wrap">
                {draft.entertainItems.map((e) => (
                  <span key={e.id} className="text-xs" style={{ color: "var(--color-text)" }}>
                    {formatMonthLabel(e.periodeMonth)}: <strong>{formatRp(e.biayaEntertain)}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
