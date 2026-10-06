"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import type { LeaderboardRow } from "@/app/actions/kpi";

const MEDAL = ["var(--color-warning)", "var(--color-text-faint)", "#A0602B"];
const group = (role: string) => (role === "MR" || role === "SPV" ? "MR/SPV" : role);
const nf = (n: number) => n.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Leaderboard view (docs/kpi-monitoring/04-final-layout.md §2). Rank is computed on the full list, so filters never renumber it. */
export function KpiLeaderboardView({ scheme, rows, unscored }: { scheme: "hospital" | "non-hospital"; rows: LeaderboardRow[]; unscored: number }) {
  const hospital = scheme === "hospital";
  const [role, setRole] = useState("ALL");
  const [area, setArea] = useState("");
  const [q, setQ] = useState("");

  const ranked = useMemo(() => rows.map((r, i) => ({ ...r, rank: i + 1 })), [rows]);
  const roles = useMemo(() => ["ALL", ...[...new Set(rows.map((r) => group(r.role)))].sort()], [rows]);
  const areas = useMemo(() => [...new Set(rows.map((r) => r.area).filter((a): a is string => !!a))].sort(), [rows]);
  const list = ranked.filter((r) => (role === "ALL" || group(r.role) === role) && (!area || r.area === area) && (!q || `${r.name}${r.nip}${r.area ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const top = list.slice(0, 3);

  const totals = rows.map((r) => r.total);
  const stats = [
    ["Personil", String(rows.length), unscored ? `+${unscored} belum lengkap, tidak diperingkat` : hospital ? "skema Hospital" : "skema Non-Hospital"],
    ["Rata-rata Point", totals.length ? nf(totals.reduce((s, x) => s + x, 0) / totals.length) : "–", ""],
    ["Point tertinggi", totals.length ? nf(Math.max(...totals)) : "–", ""],
    ["Point terendah", totals.length ? nf(Math.min(...totals)) : "–", ""],
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(([k, v, s]) => (
          <Card key={k} className="p-4!">
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{k}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{v}</p>
            {s && <p className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>{s}</p>}
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border" style={{ borderColor: "var(--color-border)" }}>
          {roles.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className="px-3 py-1.5 text-sm"
              style={role === r ? { background: "var(--color-blue)", color: "#fff" } : { background: "var(--color-surface)", color: "var(--color-text-muted)" }}
            >
              {r === "ALL" ? "Semua" : r}
            </button>
          ))}
        </div>
        {hospital && (
          <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area" className="rounded-md border px-3 py-1.5 text-sm" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}>
            <option value="">Semua area</option>
            {areas.map((a) => <option key={a}>{a}</option>)}
          </select>
        )}
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={hospital ? "Cari nama / NIP…" : "Cari nama, NIP, atau wilayah…"}
          aria-label="Cari personil"
          className="ml-auto rounded-md border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
        />
      </div>

      {top.length > 0 && (
        <Card>
          <h2 className="text-base font-semibold">Top 3</h2>
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Point tertinggi dari data yang sedang ditampilkan</p>
          <div className="mt-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
            {[1, 0, 2].filter((i) => top[i]).map((i) => (
              <div
                key={top[i].nip}
                className={`rounded-md border p-4 text-center ${i === 0 ? "sm:py-7" : ""}`}
                style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)", borderTop: `4px solid ${MEDAL[i]}` }}
              >
                <span className="mb-2 inline-grid h-8 w-8 place-items-center rounded-full text-sm font-bold text-white" style={{ background: MEDAL[i] }}>{top[i].rank}</span>
                <p className="font-semibold">{top[i].name}</p>
                <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>{top[i].role}{top[i].area ? ` · ${top[i].area}` : ""}</p>
                <p className="mt-1 text-3xl font-bold tabular-nums">{nf(top[i].total)}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card padded={false}>
        <div className="p-5 pb-3">
          <h2 className="text-base font-semibold">Leaderboard</h2>
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            {hospital ? "Point per pilar dan point total." : "Point total."} {list.length} dari {rows.length} personil.
          </p>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>
              <tr className="text-left text-xs">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Personil</th>
                <th className="px-3 py-2">{hospital ? "Role · Area" : "Jabatan · Wilayah"}</th>
                {hospital && ["Sales · 50%", "Call Activity · 25%", "Customer Aktif · 15%", "Absensi · 10%"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 text-right">{h}</th>)}
                <th className="px-3 py-2 text-right">Point</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.nip} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                  <td className="whitespace-nowrap px-3 py-2 font-bold">{r.rank}<Move rank={r.rank} prev={r.prevRank} show={hospital} /></td>
                  <td className="px-3 py-2">{r.name}<span className="block text-[11px]" style={{ color: "var(--color-text-faint)" }}>{r.nip}</span></td>
                  <td className="whitespace-nowrap px-3 py-2">{hospital ? `${r.role}${r.area ? ` · ${r.area}` : ""}` : `${r.role}${r.area ? ` · ${r.area}` : ""}`}</td>
                  {hospital && r.pillars && [r.pillars.sales, r.pillars.activity, r.pillars.customer, r.pillars.absensi].map((v, i) => <td key={i} className="px-3 py-2 text-right tabular-nums">{nf(v)}</td>)}
                  <td className="px-3 py-2 text-right text-lg font-bold tabular-nums">{nf(r.total)}</td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={hospital ? 8 : 4} className="px-3 py-6 text-center" style={{ color: "var(--color-text-faint)" }}>Tidak ada data</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="p-4 text-[11px]" style={{ color: "var(--color-text-faint)" }}>
          {hospital ? "Point per pilar = nilai band × bobot. Total maksimum 100. " : ""}Peringkat dihitung dari seluruh personil yang datanya lengkap.
        </p>
      </Card>
    </div>
  );
}

/** ▲▼ vs previous month's rank (Hospital only). */
function Move({ rank, prev, show }: { rank: number; prev: number | null; show: boolean }) {
  if (!show || prev == null) return null;
  const d = prev - rank;
  if (d === 0) return <span className="ml-1 text-[11px]" style={{ color: "var(--color-text-faint)" }}>–</span>;
  return <span className="ml-1 text-[11px]" style={{ color: d > 0 ? "var(--color-green)" : "var(--color-error)" }}>{d > 0 ? `▲${d}` : `▼${-d}`}</span>;
}
