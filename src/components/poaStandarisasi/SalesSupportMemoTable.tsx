"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { toggleSpNonSalesMemoSignedAction, type SalesSupportMemoRow } from "@/app/actions/poaStandarisasi";

type Filter = "all" | "pending" | "signed";
type SignState = { signed: boolean; by: string | null };

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Semua" },
  { id: "pending", label: "Belum di-sign" },
  { id: "signed", label: "Sudah di-sign" },
];

const TH = "pb-3 pr-3 text-left text-xs font-medium uppercase tracking-wide whitespace-nowrap";

function formatTanggal(d: Date | string): string {
  return new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function docUrl(driveFileId: string): string {
  return `/api/poa-standarisasi/dokumen/${driveFileId}`;
}

export function SalesSupportMemoTable({ rows }: { rows: SalesSupportMemoRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sign, setSign] = useState<Record<string, SignState>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, { signed: !!r.signedAt, by: r.signedByNama }]))
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const total = rows.length;
  const signedCount = rows.filter((r) => sign[r.id]?.signed).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const isSigned = !!sign[r.id]?.signed;
      if (filter === "pending" && isSigned) return false;
      if (filter === "signed" && !isSigned) return false;
      if (!q) return true;
      return [r.nomor, r.namaOutlet, r.kodePI, r.namaPengusul].some((v) => v.toLowerCase().includes(q));
    });
  }, [rows, sign, filter, query]);

  function toggleOpen(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleToggleSigned(id: string, next: boolean) {
    const before = sign[id] ?? { signed: false, by: null };
    setSign((prev) => ({ ...prev, [id]: { signed: next, by: next ? "Anda" : null } }));
    setErrors((prev) => ({ ...prev, [id]: "" }));
    setPendingId(id);
    startTransition(async () => {
      try {
        await toggleSpNonSalesMemoSignedAction(id, next);
      } catch (e) {
        setSign((prev) => ({ ...prev, [id]: before }));
        setErrors((prev) => ({ ...prev, [id]: e instanceof Error ? e.message : "Gagal menyimpan." }));
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <SummaryTile label="Total memo" value={total} />
        <SummaryTile label="Belum di-sign" value={total - signedCount} color="#b45309" />
        <SummaryTile label="Sudah di-sign" value={signedCount} color="var(--color-status-approved, #008f42)" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Memo</CardTitle>
          <div className="flex items-center gap-2">
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className="text-xs font-medium px-3 py-1.5 rounded-md whitespace-nowrap transition-colors"
                  style={active
                    ? { background: "var(--color-blue)", color: "#fff", border: "1px solid var(--color-blue)" }
                    : { background: "var(--color-bg)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </CardHeader>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari nomor memo, outlet, atau pengusul…"
          className="w-full max-w-sm rounded px-3 py-2 text-sm mb-4"
          style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}
        />

        {total === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
            Belum ada memo yang digenerate.
          </p>
        ) : visible.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
            Tidak ada memo yang cocok dengan filter.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  {["Nomor Memo", "Outlet", "Pengusul", "Produk", "Status", "Aksi"].map((h) => (
                    <th key={h} className={TH} style={{ color: "var(--color-text-faint)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {visible.map((r) => {
                  const st = sign[r.id] ?? { signed: false, by: null };
                  const isOpen = open.has(r.id);
                  return (
                    <Fragment key={r.id}>
                      <tr>
                        <td className="py-3 pr-3 align-top">
                          <div className="font-semibold whitespace-nowrap" style={{ color: "var(--color-text)" }}>{r.nomor}</div>
                          <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>{formatTanggal(r.generatedAt)}</div>
                        </td>
                        <td className="py-3 pr-3 align-top">
                          <div style={{ color: "var(--color-text)" }}>{r.namaOutlet}</div>
                          <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>{r.kodePI}</div>
                        </td>
                        <td className="py-3 pr-3 align-top" style={{ color: "var(--color-text-muted)" }}>{r.namaPengusul}</td>
                        <td className="py-3 pr-3 align-top">
                          <button
                            type="button"
                            onClick={() => toggleOpen(r.id)}
                            className="text-xs font-medium underline decoration-dotted whitespace-nowrap"
                            style={{ color: "var(--color-blue)" }}
                            aria-expanded={isOpen}
                          >
                            {r.produk.length} produk {isOpen ? "▲" : "▼"}
                          </button>
                        </td>
                        <td className="py-3 pr-3 align-top">
                          <span
                            className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap"
                            style={st.signed
                              ? { background: "var(--color-status-approved-bg, #E6F5EC)", color: "var(--color-status-approved, #008f42)" }
                              : { background: "var(--color-warning-bg, #fef3c7)", color: "#b45309" }}
                          >
                            {st.signed ? "Sudah di-sign" : "Belum di-sign"}
                          </span>
                          {st.signed && st.by && (
                            <div className="text-[11px] mt-1" style={{ color: "var(--color-text-faint)" }}>oleh {st.by}</div>
                          )}
                        </td>
                        <td className="py-3 align-top">
                          <div className="flex flex-col items-start gap-2">
                            <a href={docUrl(r.driveFileId)} target="_blank" rel="noreferrer">
                              <Button size="sm" variant="secondary">↓ Unduh Memo</Button>
                            </a>
                            <label className="flex items-center gap-1.5 text-xs cursor-pointer whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                              <input
                                type="checkbox"
                                checked={st.signed}
                                disabled={pendingId === r.id}
                                onChange={(e) => handleToggleSigned(r.id, e.target.checked)}
                              />
                              Sudah di-sign
                            </label>
                            {errors[r.id] && <div className="text-xs" style={{ color: "var(--color-error)" }}>{errors[r.id]}</div>}
                          </div>
                        </td>
                      </tr>

                      {isOpen && (
                        <tr>
                          <td colSpan={6} className="pb-4 pr-3">
                            <div className="rounded-md p-4 grid grid-cols-1 md:grid-cols-2 gap-5" style={{ background: "var(--color-bg-subtle)", border: "1px solid var(--color-border)" }}>
                              <div>
                                <div className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: "var(--color-text-faint)" }}>Produk diminta</div>
                                {r.produk.length === 0 ? (
                                  <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Tidak ada produk.</p>
                                ) : (
                                  <table className="w-full text-xs">
                                    <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                                      {r.produk.map((p) => (
                                        <tr key={p.kodeProduk}>
                                          <td className="py-1.5 pr-3">
                                            <div className="font-medium" style={{ color: "var(--color-text)" }}>{p.namaProduk}</div>
                                            <div style={{ color: "var(--color-text-faint)" }}>{p.kodeProduk}</div>
                                          </td>
                                          <td className="py-1.5 text-right whitespace-nowrap font-semibold" style={{ color: "var(--color-text)" }}>
                                            {p.qty != null ? `${p.qty.toLocaleString("id-ID")} ${p.satuan}` : "-"}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                              <div className="space-y-4">
                                <div>
                                  <div className="text-xs font-medium uppercase tracking-wide mb-1" style={{ color: "var(--color-text-faint)" }}>Alasan</div>
                                  <p className="text-sm" style={{ color: "var(--color-text)" }}>{r.alasan ?? "-"}</p>
                                </div>
                                <div>
                                  <div className="text-xs font-medium uppercase tracking-wide mb-1" style={{ color: "var(--color-text-faint)" }}>Bukti standarisasi (untuk GOJ)</div>
                                  {r.buktiStandarisasi.length === 0 ? (
                                    <p className="text-xs font-medium" style={{ color: "var(--color-error)" }}>⚠ Belum ada bukti standarisasi diupload</p>
                                  ) : (
                                    <ul className="space-y-1">
                                      {r.buktiStandarisasi.map((doc) => (
                                        <li key={doc.id}>
                                          <a href={docUrl(doc.driveFileId)} target="_blank" rel="noreferrer" className="text-xs font-medium underline" style={{ color: "var(--color-blue)" }}>
                                            {doc.fileName}
                                          </a>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function SummaryTile({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <Card>
      <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>{label}</div>
      <div className="text-2xl font-bold" style={{ color: color ?? "var(--color-text)" }}>{value}</div>
    </Card>
  );
}
