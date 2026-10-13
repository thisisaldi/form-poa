"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { StandarisasiDashboardOutletRow } from "@/app/actions/poaStandarisasi";

export function StandarisasiDashboardTable({ rows, canOpenDetail }: { rows: StandarisasiDashboardOutletRow[]; canOpenDetail: boolean }) {
  const [query, setQuery] = useState("");
  const [dplFilter, setDplFilter] = useState<"" | "APPROVED" | "PENDING" | "REJECTED">("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!q || r.namaOutlet.toLowerCase().includes(q) || r.kodePI.toLowerCase().includes(q)) &&
        (!dplFilter || r.dpl.some((d) => d.status === dplFilter))
    );
  }, [rows, query, dplFilter]);

  function toggle(kodePI: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(kodePI)) next.delete(kodePI); else next.add(kodePI);
      return next;
    });
  }

  if (rows.length === 0) {
    return <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>Belum ada pengajuan POA Standarisasi.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari outlet (nama atau kode)…"
          className="w-full max-w-sm rounded px-3 py-2 text-sm"
          style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}
        />
        <select
          value={dplFilter}
          onChange={(e) => setDplFilter(e.target.value as typeof dplFilter)}
          className="rounded px-3 py-2 text-sm"
          style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}
          aria-label="Filter status DPL/DPF"
        >
          <option value="">Semua status DPL/DPF</option>
          <option value="APPROVED">Ada DPL/DPF Approved</option>
          <option value="PENDING">Ada DPL/DPF Pending</option>
          <option value="REJECTED">Ada DPL/DPF Rejected</option>
        </select>
      </div>

      {filtered.length === 0 && <p className="text-sm" style={{ color: "var(--color-text-faint)" }}>Tidak ada outlet yang cocok.</p>}

      <div className="space-y-2">
        {filtered.map((r) => {
          const isOpen = open.has(r.kodePI);
          return (
            <div key={r.kodePI} className="rounded-xl border" style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
              <button type="button" onClick={() => toggle(r.kodePI)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate" style={{ color: "var(--color-text)" }}>{r.namaOutlet}</div>
                  <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>{r.kodePI}</div>
                </div>
                <Pill color="#008f42">{r.sudah.length} sudah</Pill>
                <Pill color="#ea580c">{r.onProgress.length} on progress</Pill>
                {r.gagal > 0 && <Pill color="#dc2626">{r.gagal} gagal</Pill>}
                {r.dpl.some((d) => d.status === "APPROVED") && <Pill color="#008f42">{r.dpl.filter((d) => d.status === "APPROVED").length} DPL/DPF approved</Pill>}
                {r.dpl.some((d) => d.status === "PENDING") && <Pill color="#ea580c">{r.dpl.filter((d) => d.status === "PENDING").length} DPL/DPF pending</Pill>}
                <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>{isOpen ? "▲" : "▼"}</span>
              </button>

              {isOpen && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 pb-4 pt-1 border-t" style={{ borderColor: "var(--color-border)" }}>
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide mb-1.5 mt-2" style={{ color: "#008f42" }}>Sudah standarisasi</div>
                    {r.sudah.length === 0 ? (
                      <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Belum ada.</p>
                    ) : (
                      <ul className="space-y-1">
                        {r.sudah.map((p) => (
                          <li key={p.kodeProduk} className="text-xs flex justify-between gap-2">
                            <span style={{ color: "var(--color-text)" }}>{p.namaProduk}</span>
                            <span style={{ color: "var(--color-text-faint)" }}>{new Date(p.submittedAt).toLocaleDateString("id-ID")}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide mb-1.5 mt-2" style={{ color: "#ea580c" }}>On progress</div>
                    {r.onProgress.length === 0 ? (
                      <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Tidak ada.</p>
                    ) : (
                      <ul className="space-y-1">
                        {r.onProgress.map((p) => (
                          <li key={`${p.pengajuanId}-${p.kodeProduk}`} className="text-xs flex justify-between gap-2">
                            <span style={{ color: "var(--color-text)" }}>{p.namaProduk}</span>
                            <span style={{ color: "var(--color-text-faint)" }} className="text-right">
                              {p.phaseLabel} · {p.ownerNama}
                              {canOpenDetail && (
                                <> · <Link href={`/poa-standarisasi/${p.pengajuanId}`} className="font-medium" style={{ color: "var(--color-blue)" }}>Buka</Link></>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {r.dpl.length > 0 && (
                    <div className="md:col-span-2">
                      <div className="text-xs font-bold uppercase tracking-wide mb-1.5 mt-2" style={{ color: "var(--color-text-muted)" }}>Request DPL/DPF ke Exodus</div>
                      <ul className="space-y-1">
                        {r.dpl.map((d) => (
                          <li key={d.id} className="text-xs flex justify-between gap-2">
                            <span style={{ color: "var(--color-text)" }}>
                              {d.tipe} · {d.distributorKode} · {d.produk.join(", ") || "-"}
                            </span>
                            <span className="text-right whitespace-nowrap" style={{ color: DPL_COLOR[d.status] }}>
                              {DPL_LABEL[d.status]} · {new Date(d.submittedAt).toLocaleDateString("id-ID")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const DPL_LABEL = { APPROVED: "Approved", PENDING: "Pending", REJECTED: "Rejected" } as const;
const DPL_COLOR = { APPROVED: "#008f42", PENDING: "#ea580c", REJECTED: "#dc2626" } as const;

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap"
      style={{ color, border: `1px solid ${color}`, background: `color-mix(in srgb, ${color} 10%, transparent)` }}
    >
      {children}
    </span>
  );
}
