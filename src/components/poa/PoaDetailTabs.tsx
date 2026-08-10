"use client";

import { useMemo, useState } from "react";
import type { PoaLineItem, PoaStatus } from "@prisma/client";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { DraftChecklist, ActivePsspListCard, formatRp } from "@/components/poa/DraftChecklist";
import { quarterToMonths, quarterLabelFromMonths } from "@/lib/quarterUtils";
import { computeActivePsspStats } from "@/lib/activePssp";
import type { ActivePsspRow } from "@/app/actions/customer";

type TabKey = "drafting" | "produkKontes" | "pssp";

interface KontesProductTarget {
  kodeProduk: string;
  namaProduk: string;
  quarterlyTargetQty: number;
  quarterlyTargetValue: number;
  estimasiQty: number;
  estimasiValue: number;
}

// Splits the Detail POA page into 3 tabs: Drafting (checklist + light summaries),
// Produk Kontes (full per-product quarterly target breakdown), History PSSP Aktif
// (full per-doctor/per-contract breakdown) — the last two used to sit inline as
// full detail on every page load; now only their summary shows in Drafting.
export function PoaDetailTabs({
  items, poaId, poaPeriod, poaStatus, poaVersion, showSubmit, userCanEdit,
  selectable = true, activePssp = [], outletPsspInfo = {}, everPsspKodeCust = [], kontesProductTargets, salesSummary, targetArea,
}: {
  items: PoaLineItem[];
  poaId?: string;
  poaPeriod: string;
  poaStatus?: PoaStatus;
  poaVersion?: number;
  showSubmit?: boolean;
  userCanEdit?: boolean;
  selectable?: boolean;
  activePssp?: ActivePsspRow[];
  /** Per-outlet stats for "Informasi PSSP Outlet" dropdown (2026-08-10) —
   * server-computed in poa/[id]/page.tsx, batched once (not per-row). */
  outletPsspInfo?: Record<string, { userCount: number; rencanaTercacahEstimasi: number; rencanaTercacahNilaiPssp: number; aktifTercacahEstimasi: number; aktifTercacahNilaiPssp: number }>;
  /** kodeCust values that have EVER had a PSSP contract (see getPsspEverKodeCust) — passed through to DraftChecklist. */
  everPsspKodeCust?: string[];
  kontesProductTargets: KontesProductTarget[];
  salesSummary?: { historisTahunLalu: number; historisTahunLaluLabel: string; salesYtd: number; growthPct: number };
  /** Real Target Value for this POA's MR (see poa/[id]/page.tsx's targetValueFromGT) — undefined falls back to DraftChecklist's dummy placeholder. */
  targetArea?: number;
}) {
  const [tab, setTab] = useState<TabKey>("drafting");

  const quarterMonths = useMemo(() => {
    try { return quarterToMonths(poaPeriod); } catch { return []; }
  }, [poaPeriod]);

  const aktifPsspStats = useMemo(
    () => computeActivePsspStats(activePssp, quarterMonths),
    [activePssp, quarterMonths]
  );
  const qLabel = quarterLabelFromMonths(quarterMonths);

  const kontesWithTarget = kontesProductTargets.filter((p) => p.quarterlyTargetQty > 0);
  const kontesTotalQty = kontesProductTargets.reduce((s, p) => s + p.quarterlyTargetQty, 0);
  const kontesTotalValue = kontesProductTargets.reduce((s, p) => s + p.quarterlyTargetValue, 0);
  const kontesTotalEstimasiQty = kontesProductTargets.reduce((s, p) => s + p.estimasiQty, 0);
  const kontesTotalEstimasiValue = kontesProductTargets.reduce((s, p) => s + p.estimasiValue, 0);

  const tabs: { key: TabKey; label: string }[] = [
    { key: "drafting", label: "Drafting" },
    { key: "produkKontes", label: kontesProductTargets.length > 0 ? `Produk Kontes (${kontesProductTargets.length})` : "Produk Kontes" },
    { key: "pssp", label: aktifPsspStats.kontrakTotal > 0 ? `History PSSP Aktif (${aktifPsspStats.kontrakTotal})` : "History PSSP Aktif" },
  ];

  return (
    <div className="space-y-4">
      {/* Tab switcher */}
      <div className="flex gap-1 border-b overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className="px-3 py-2 text-sm font-medium whitespace-nowrap -mb-px border-b-2 transition-colors"
            style={{
              borderColor: tab === t.key ? "var(--color-blue)" : "transparent",
              color: tab === t.key ? "var(--color-blue)" : "var(--color-text-faint)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Drafting — checklist + light summaries of the other two tabs */}
      {tab === "drafting" && (
        <div className="space-y-4">
          {kontesProductTargets.length > 0 && (
            <Card>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
                    Target Produk Kontes (Kuartal {qLabel})
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                    {kontesWithTarget.length} dari {kontesProductTargets.length} produk kontes punya target · total {Math.round(kontesTotalQty).toLocaleString("id-ID")} unit ({formatRp(kontesTotalValue)}) ·
                    estimasi draft ini {Math.round(kontesTotalEstimasiQty).toLocaleString("id-ID")} unit ({formatRp(kontesTotalEstimasiValue)})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setTab("produkKontes")}
                  className="text-xs font-medium shrink-0"
                  style={{ color: "var(--color-blue)" }}
                >
                  Lihat detail →
                </button>
              </div>
            </Card>
          )}

          {items.length === 0 ? (
            <Card>
              <p className="text-sm py-4" style={{ color: "var(--color-text-muted)" }}>
                {userCanEdit
                  ? <a href={`/poa/${poaId}/edit`} style={{ color: "var(--color-blue)" }}>+ Tambah rencana pertama</a>
                  : "Belum ada baris."}
              </p>
            </Card>
          ) : (
            <DraftChecklist
              items={items}
              poaId={poaId}
              poaPeriod={poaPeriod}
              poaStatus={poaStatus}
              poaVersion={poaVersion}
              showSubmit={showSubmit}
              userCanEdit={userCanEdit}
              selectable={selectable}
              activePssp={activePssp}
              outletPsspInfo={outletPsspInfo}
              everPsspKodeCust={everPsspKodeCust}
              salesSummary={salesSummary}
              targetArea={targetArea}
            />
          )}
        </div>
      )}

      {/* Produk Kontes — full per-product quarterly target detail */}
      {tab === "produkKontes" && (
        kontesProductTargets.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Target Produk Kontes (Kuartal {qLabel})</CardTitle>
            </CardHeader>
            <p className="text-xs mb-3" style={{ color: "var(--color-text-muted)" }}>
              Target kuantitas &amp; nilai per produk kontes untuk territory SM dari MR ini, {poaPeriod} -
              dari mesin simulasi target yang sama dengan halaman Admin, dibandingkan dengan estimasi
              yang sudah direncanakan MR ini di draft POA.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <th className="text-left py-1.5 pr-3 font-medium" style={{ color: "var(--color-text-faint)" }}>Produk Kontes</th>
                    <th className="text-right py-1.5 pr-3 font-medium" style={{ color: "var(--color-text-faint)" }}>Target Unit (Kuartal)</th>
                    <th className="text-right py-1.5 pr-3 font-medium" style={{ color: "var(--color-text-faint)" }}>Nilai Target</th>
                    <th className="text-right py-1.5 pr-3 font-medium" style={{ color: "var(--color-text-faint)" }}>Estimasi Unit (Draft Ini)</th>
                    <th className="text-right py-1.5 pr-3 font-medium" style={{ color: "var(--color-text-faint)" }}>Estimasi Nilai (Draft Ini)</th>
                  </tr>
                </thead>
                <tbody>
                  {kontesProductTargets.map((p) => (
                    <tr key={p.kodeProduk} style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <td className="py-1.5 pr-3" style={{ color: "var(--color-text)" }}>{p.namaProduk}</td>
                      <td className="py-1.5 pr-3 text-right" style={{ color: "var(--color-text)" }}>
                        {Math.round(p.quarterlyTargetQty).toLocaleString("id-ID")}
                      </td>
                      <td className="py-1.5 pr-3 text-right" style={{ color: "var(--color-text)" }}>
                        {formatRp(p.quarterlyTargetValue)}
                      </td>
                      <td className="py-1.5 pr-3 text-right" style={{ color: "var(--color-text-muted)" }}>
                        {p.estimasiQty > 0 ? Math.round(p.estimasiQty).toLocaleString("id-ID") : "-"}
                      </td>
                      <td className="py-1.5 pr-3 text-right" style={{ color: "var(--color-text-muted)" }}>
                        {p.estimasiValue > 0 ? formatRp(p.estimasiValue) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Card>
            <p className="text-sm py-2" style={{ color: "var(--color-text-muted)" }}>
              Tidak ada data target produk kontes untuk periode ini.
            </p>
          </Card>
        )
      )}

      {/* History PSSP Aktif — full per-doctor/per-contract detail */}
      {tab === "pssp" && (
        activePssp.length > 0 ? (
          <ActivePsspListCard rows={activePssp} quarterMonths={quarterMonths} />
        ) : (
          <Card>
            <p className="text-sm py-2" style={{ color: "var(--color-text-muted)" }}>
              Tidak ada kontrak PSSP aktif untuk dokter di outlet yang sama dengan POA ini.
            </p>
          </Card>
        )
      )}
    </div>
  );
}
