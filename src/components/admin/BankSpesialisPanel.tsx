"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  addBankSpesialisAction, getBankSpesialisAdminAction, removeBankSpesialisAction, updateBankKeteranganAction,
  type BankSpesialisAdminRow,
} from "@/app/actions/bankSpesialis";

/**
 * Bank Spesialis: produk kontes per spesialis dokter (docs/poa-bank-spesialis/). Produk yang ada di sini =
 * Produk Kontes dan dasar WARNING "produk tidak sesuai spesialisasi". Perubahan berlaku tanpa deploy.
 */
export function BankSpesialisPanel() {
  const [rows, setRows] = useState<BankSpesialisAdminRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spes, setSpes] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [add, setAdd] = useState({ spesialis: "", kodeProduk: "", keterangan: "" });
  const [, startTransition] = useTransition();

  async function load() {
    try { setRows(await getBankSpesialisAdminAction()); } catch (e) { setError(e instanceof Error ? e.message : "Gagal memuat."); }
  }
  useEffect(() => { if (open && !rows) void load(); }, [open, rows]);

  const names = useMemo(() => [...new Set((rows ?? []).map((r) => r.spesialis))].sort(), [rows]);
  const produkUnik = useMemo(() => new Set((rows ?? []).map((r) => r.kodeProduk)).size, [rows]);
  const shown = useMemo(() => {
    const needle = q.trim().toUpperCase();
    return (rows ?? []).filter(
      (r) => (!spes || r.spesialis === spes) && (!needle || r.namaProduk.toUpperCase().includes(needle) || r.kodeProduk.includes(needle)),
    );
  }, [rows, spes, q]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "Gagal.");
      await load();
    });
  }

  return (
    <details className="rounded-lg border p-4" style={{ borderColor: "var(--color-border)" }} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-sm font-semibold" style={{ color: "var(--color-text)" }}>
        Bank Spesialis — Produk Kontes per Spesialis
        {rows && <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-text-faint)" }}>{produkUnik} produk kontes · {rows.length} pasangan · {names.length} spesialis</span>}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
          Produk yang ada di daftar ini = Produk Kontes. Bila produk yang diestimasi MR tidak terdaftar untuk spesialisasi dokternya, MR melihat WARNING (tidak memblokir). Perubahan berlaku dalam hitungan detik.
        </p>
        {error && <p className="text-xs" style={{ color: "var(--color-red)" }}>{error}</p>}
        {!rows ? <p className="text-xs">Memuat…</p> : (
          <>
            <div className="flex flex-wrap gap-2">
              <select value={spes} onChange={(e) => setSpes(e.target.value)} className="input-field text-xs">
                <option value="">Semua spesialis</option>
                {names.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama / kode produk…" className="input-field text-xs flex-1 min-w-[12rem]" />
            </div>

            <form
              className="flex flex-wrap gap-2 items-end rounded-md px-3 py-2"
              style={{ background: "var(--color-bg-subtle)" }}
              onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await addBankSpesialisAction(add); if (r.ok) setAdd({ ...add, kodeProduk: "", keterangan: "" }); return r; }); }}
            >
              <select value={add.spesialis} onChange={(e) => setAdd({ ...add, spesialis: e.target.value })} required className="input-field text-xs">
                <option value="">Spesialis…</option>
                {names.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <input value={add.kodeProduk} onChange={(e) => setAdd({ ...add, kodeProduk: e.target.value })} required placeholder="Kode produk (mis. 009342)" className="input-field text-xs w-44" />
              <input value={add.keterangan} onChange={(e) => setAdd({ ...add, keterangan: e.target.value })} placeholder="Keterangan (opsional)" className="input-field text-xs flex-1 min-w-[10rem]" />
              <button type="submit" className="text-xs font-semibold px-3 py-1.5 rounded-md border">Tambah</button>
            </form>

            <div className="max-h-[28rem] overflow-auto rounded-md border" style={{ borderColor: "var(--color-border)" }}>
              <table className="w-full text-xs">
                <thead className="sticky top-0" style={{ background: "var(--color-bg-subtle)" }}>
                  <tr className="text-left">
                    <th className="px-2 py-1.5">Spesialis</th><th className="px-2 py-1.5">Kode</th><th className="px-2 py-1.5">Produk</th>
                    <th className="px-2 py-1.5">Keterangan</th><th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                      <td className="px-2 py-1">{r.spesialis}</td>
                      <td className="px-2 py-1 font-mono">{r.kodeProduk}</td>
                      <td className="px-2 py-1">{r.namaProduk}</td>
                      <td className="px-2 py-1">
                        <input
                          defaultValue={r.keterangan ?? ""}
                          onBlur={(e) => { if (e.target.value.trim() !== (r.keterangan ?? "")) run(() => updateBankKeteranganAction(r.id, e.target.value)); }}
                          className="input-field text-xs w-full"
                        />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <button type="button" className="text-xs" style={{ color: "var(--color-red)" }}
                          onClick={() => { if (confirm(`Hapus ${r.namaProduk} dari ${r.spesialis}?`)) run(() => removeBankSpesialisAction(r.id)); }}>
                          Hapus
                        </button>
                      </td>
                    </tr>
                  ))}
                  {shown.length === 0 && <tr><td colSpan={5} className="px-2 py-3 text-center">Tidak ada data.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>Menampilkan {shown.length} dari {rows.length} pasangan.</p>
          </>
        )}
      </div>
    </details>
  );
}
