"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  getKontesProductsWithRampAction,
  setTambahanTargetBulkAction,
  getKontesProductsSummaryAction,
  applyQuarterlyTargetsAction,
} from "@/app/actions/targetCalculation";
import type { QuarterlyKontesSummary } from "@/lib/targetCalculation";
import { formatCurrency as formatRp } from "@/lib/format";

function formatQty(n: number) {
  return Math.round(n).toLocaleString("id-ID");
}

export function TargetProdukForm() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [quarterNum, setQuarterNum] = useState("3");
  const [products, setProducts] = useState<{ kodeProduk: string; namaProduk: string; monthlyRamp: string }[] | null>(null);
  const [summary, setSummary] = useState<QuarterlyKontesSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const quarter = `${year}-Q${quarterNum}`;
  const curYear = new Date().getFullYear();

  async function loadProducts() {
    setError(null); setMsg(null); setSummary(null);
    setIsPending(true);
    try {
      const rows = await getKontesProductsWithRampAction(quarter);
      setProducts(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat produk kontes.");
    } finally {
      setIsPending(false);
    }
  }

  function updateRamp(kodeProduk: string, monthlyRamp: string) {
    setProducts((prev) => prev?.map((p) => p.kodeProduk === kodeProduk ? { ...p, monthlyRamp } : p) ?? null);
  }

  async function handleSaveAndCompute() {
    if (!products) return;
    setError(null); setMsg(null);
    setIsPending(true);
    try {
      const entries = products
        .filter((p) => p.monthlyRamp.trim() !== "")
        .map((p) => ({ kodeProduk: p.kodeProduk, monthlyRamp: parseFloat(p.monthlyRamp) }));
      const saveRes = await setTambahanTargetBulkAction(quarter, entries);
      if (!saveRes.ok) { setError(saveRes.error ?? "Gagal menyimpan."); return; }

      const calc = await getKontesProductsSummaryAction(quarter);
      if (!calc.ok || !calc.result) { setError(calc.error ?? "Gagal menghitung."); return; }
      setSummary(calc.result);
    } finally {
      setIsPending(false);
    }
  }

  async function handleApply() {
    setMsg(null); setError(null);
    setIsPending(true);
    try {
      const res = await applyQuarterlyTargetsAction(quarter);
      if (!res.ok) { setError(res.error ?? "Gagal menerapkan."); return; }
      setMsg(`Target diterapkan ke ${res.applied} draft POA.${res.skipped ? ` ${res.skipped} MR dilewati (belum punya draft POA di kuartal ini).` : ""}`);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Kuartal</span>
          <div className="flex gap-1">
            <select value={year} onChange={(e) => setYear(e.target.value)} className="input-field">
              {[curYear - 1, curYear, curYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={quarterNum} onChange={(e) => setQuarterNum(e.target.value)} className="input-field">
              <option value="1">Q1</option>
              <option value="2">Q2</option>
              <option value="3">Q3</option>
              <option value="4">Q4</option>
            </select>
          </div>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={loadProducts} disabled={isPending}>
          {isPending && !products ? "Memuat…" : "Muat Produk Kontes"}
        </Button>
      </div>

      {error && (
        <p className="text-sm px-3 py-2 rounded-md" style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>
      )}

      {products && (
        <div className="space-y-3">
          <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
            {products.length} produk kontes. Isi &ldquo;Tambahan Target&rdquo; (kenaikan qty per bulan) untuk tiap produk, lalu hitung.
          </p>
          <div className="overflow-x-auto max-h-96 overflow-y-auto rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
            <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
              <thead className="sticky top-0" style={{ background: "var(--color-bg-subtle)" }}>
                <tr>
                  <th className="text-left py-2 px-3">Kode</th>
                  <th className="text-left py-2 px-3">Produk</th>
                  <th className="text-right py-2 px-3">Tambahan Target (qty/bln)</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.kodeProduk} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <td className="py-1.5 px-3 font-mono">{p.kodeProduk}</td>
                    <td className="py-1.5 px-3">{p.namaProduk}</td>
                    <td className="py-1.5 px-3">
                      <input type="number" min="0" step="0.01" placeholder="0"
                        value={p.monthlyRamp}
                        onChange={(e) => updateRamp(p.kodeProduk, e.target.value)}
                        className="input-field text-right" style={{ maxWidth: 120, marginLeft: "auto" }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button type="button" size="sm" onClick={handleSaveAndCompute} disabled={isPending}>
            {isPending ? "Menghitung…" : "Simpan & Hitung Summary"}
          </Button>
        </div>
      )}

      {summary && (
        <div className="space-y-5 pt-4 border-t" style={{ borderColor: "var(--color-border)" }}>
          {summary.productsMissingRamp.length > 0 && (
            <p className="text-xs px-3 py-2 rounded-md" style={{ background: "var(--color-warning-bg, #FBF3E3)", color: "var(--color-warning, #C99A3D)" }}>
              {summary.productsMissingRamp.length} produk belum diisi Tambahan Target (dianggap 0): {summary.productsMissingRamp.map((p) => p.namaProduk).join(", ")}
            </p>
          )}

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-faint)" }}>
              Summary per NSM
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <th className="text-left py-1.5 pr-2">NSM</th>
                    <th className="text-right py-1.5 px-2">Target Qty</th>
                    <th className="text-right py-1.5 pl-2">Target Value</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byNsm.map((n) => (
                    <tr key={n.nsmNip} style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <td className="py-1.5 pr-2">{n.nsmName}</td>
                      <td className="text-right py-1.5 px-2 font-semibold">{formatQty(n.totalQty)}</td>
                      <td className="text-right py-1.5 pl-2 font-semibold" style={{ color: "var(--color-blue)" }}>{formatRp(n.totalValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-faint)" }}>
              Summary per SM
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <th className="text-left py-1.5 pr-2">SM</th>
                    <th className="text-right py-1.5 px-2">FF</th>
                    <th className="text-right py-1.5 px-2">Target Qty</th>
                    <th className="text-right py-1.5 pl-2">Target Value</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.bySm.map((s) => (
                    <tr key={s.smNip} style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <td className="py-1.5 pr-2">{s.smName}</td>
                      <td className="text-right py-1.5 px-2">{s.ffCount}</td>
                      <td className="text-right py-1.5 px-2 font-semibold">{formatQty(s.totalQty)}</td>
                      <td className="text-right py-1.5 pl-2 font-semibold" style={{ color: "var(--color-blue)" }}>{formatRp(s.totalValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {msg && (
            <p className="text-sm px-3 py-2 rounded-md" style={{ background: "var(--color-green-light, #E6F5EC)", color: "var(--color-green, #008f42)" }}>{msg}</p>
          )}

          <Button type="button" size="sm" variant="secondary" onClick={handleApply} disabled={isPending}>
            {isPending ? "Menerapkan…" : "Terapkan ke Draft POA (per MR)"}
          </Button>
        </div>
      )}
    </div>
  );
}
