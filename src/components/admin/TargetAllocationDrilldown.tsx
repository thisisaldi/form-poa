"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  listKontesProductsAction,
  getTargetChildrenAction,
  setTargetAllocationsAction,
  deleteTargetAllocationAction,
  applyManualTargetsAction,
  type TargetChildRow,
} from "@/app/actions/targetCalculation";

const LEVELS = ["NSM", "SM", "ASM", "MR"] as const;
type Level = (typeof LEVELS)[number];
const LEVEL_LABEL: Record<Level, string> = { NSM: "NSM", SM: "Area (SM)", ASM: "ASM", MR: "MR" };

interface Crumb { level: Level; nip: string; name: string }

function formatQty(n: number) {
  return Math.round(n).toLocaleString("id-ID");
}

export function TargetAllocationDrilldown() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [quarterNum, setQuarterNum] = useState("3");
  const [products, setProducts] = useState<{ kodeProduk: string; namaProduk: string }[]>([]);
  const [kodeProduk, setKodeProduk] = useState("");

  const [path, setPath] = useState<Crumb[]>([]); // selected NSM → SM → ASM so far
  const [parentQty, setParentQty] = useState<number | null>(null);
  const [rows, setRows] = useState<TargetChildRow[]>([]);
  const [edited, setEdited] = useState<Record<string, string>>({}); // nip → qty being typed

  const [loading, startLoad] = useTransition();
  const [saving, startSave] = useTransition();
  const [applying, startApply] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [toDelete, setToDelete] = useState<TargetChildRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const quarter = `${year}-Q${quarterNum}`;
  const curYear = new Date().getFullYear();
  const level: Level = LEVELS[path.length];

  useEffect(() => {
    listKontesProductsAction().then(setProducts).catch(() => setProducts([]));
  }, []);

  function loadLevel(nextPath: Crumb[]) {
    if (!kodeProduk) { setError("Pilih produk kontes dulu."); return; }
    setError(null); setNotice(null);
    const parentNip = nextPath.length > 0 ? nextPath[nextPath.length - 1].nip : null;
    const lvl = LEVELS[nextPath.length];
    startLoad(async () => {
      const result = await getTargetChildrenAction(kodeProduk, quarter, lvl, parentNip);
      setParentQty(result.parentQty);
      setRows(result.children);
      setEdited({});
      setPath(nextPath);
    });
  }

  function handleProductOrQuarterChange(nextKodeProduk: string, nextQuarter?: { year?: string; quarterNum?: string }) {
    setKodeProduk(nextKodeProduk);
    if (nextQuarter?.year) setYear(nextQuarter.year);
    if (nextQuarter?.quarterNum) setQuarterNum(nextQuarter.quarterNum);
    setPath([]); setRows([]); setParentQty(null); setEdited({}); setError(null); setNotice(null);
  }

  function drillInto(row: TargetChildRow) {
    if (row.role === "MR") return; // leaf — nothing to drill into
    loadLevel([...path, { level: row.role, nip: row.nip, name: row.name }]);
  }

  function jumpToCrumb(index: number) {
    // index -1 = root (no crumbs)
    loadLevel(path.slice(0, index + 1));
  }

  function handleSave() {
    const entries = Object.entries(edited)
      .map(([nip, v]) => ({ nip, qty: parseFloat(v) }))
      .filter((e) => !isNaN(e.qty));
    if (entries.length === 0) return;
    setError(null); setNotice(null);
    startSave(async () => {
      const result = await setTargetAllocationsAction(kodeProduk, quarter, entries);
      if (!result.ok) { setError(result.error ?? "Gagal menyimpan."); return; }
      setNotice(`${entries.length} baris tersimpan.`);
      loadLevel(path);
    });
  }

  function confirmDelete() {
    if (!toDelete) return;
    setError(null); setNotice(null);
    startDelete(async () => {
      const result = await deleteTargetAllocationAction(kodeProduk, quarter, toDelete.nip);
      if (!result.ok) { setError(result.error ?? "Gagal menghapus."); setToDelete(null); return; }
      setNotice(`Alokasi ${toDelete.name} dihapus.`);
      setToDelete(null);
      loadLevel(path);
    });
  }

  function handleApply() {
    setError(null); setNotice(null);
    startApply(async () => {
      const result = await applyManualTargetsAction(quarter);
      if (!result.ok) { setError(result.error ?? "Gagal menerapkan."); return; }
      setNotice(`Target diterapkan ke ${result.applied} draft POA.${result.skipped ? ` ${result.skipped} MR dilewati (belum punya draft POA di kuartal ini).` : ""}`);
    });
  }

  const totalAllocated = rows.reduce((sum, r) => {
    const v = edited[r.nip] !== undefined ? parseFloat(edited[r.nip]) : r.qty;
    return sum + (isNaN(v) ? 0 : v);
  }, 0);
  const sisa = parentQty != null ? parentQty - totalAllocated : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Kuartal</span>
          <div className="flex gap-1">
            <select value={year} onChange={(e) => handleProductOrQuarterChange(kodeProduk, { year: e.target.value })} className="input-field">
              {[curYear - 1, curYear, curYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={quarterNum} onChange={(e) => handleProductOrQuarterChange(kodeProduk, { quarterNum: e.target.value })} className="input-field">
              <option value="1">Q1</option>
              <option value="2">Q2</option>
              <option value="3">Q3</option>
              <option value="4">Q4</option>
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Produk Kontes</span>
          <select value={kodeProduk} onChange={(e) => handleProductOrQuarterChange(e.target.value)} className="input-field">
            <option value="">- Pilih produk -</option>
            {products.map((p) => <option key={p.kodeProduk} value={p.kodeProduk}>{p.namaProduk}</option>)}
          </select>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={() => loadLevel([])} disabled={!kodeProduk || loading}>
          {loading ? "Memuat…" : "Muat"}
        </Button>
      </div>

      {error && <p className="text-sm px-3 py-2 rounded-md" style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>}
      {notice && <p className="text-sm px-3 py-2 rounded-md" style={{ background: "var(--color-success-bg, #dcfce7)", color: "var(--color-success, #16a34a)" }}>{notice}</p>}

      {kodeProduk && (rows.length > 0 || path.length > 0) && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1 text-xs" style={{ color: "var(--color-text-faint)" }}>
            <button type="button" onClick={() => jumpToCrumb(-1)} className="underline" style={{ color: "var(--color-blue)" }}>Semua NSM</button>
            {path.map((c, i) => (
              <span key={c.nip} className="flex items-center gap-1">
                <span>›</span>
                <button type="button" onClick={() => jumpToCrumb(i)} className="underline" style={{ color: "var(--color-blue)" }}>{c.name}</button>
              </span>
            ))}
          </div>

          <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
            Level: <strong>{LEVEL_LABEL[level]}</strong>
            {parentQty != null && (
              <> · Total {path[path.length - 1]?.name}: <strong>{formatQty(parentQty)}</strong>
                {" · "}Teralokasi: <strong>{formatQty(totalAllocated)}</strong>
                {" · "}Sisa: <strong style={{ color: sisa != null && sisa < 0 ? "var(--color-red)" : undefined }}>{sisa != null ? formatQty(sisa) : "-"}</strong>
              </>
            )}
          </p>

          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
            <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
              <thead style={{ background: "var(--color-bg-subtle)" }}>
                <tr>
                  <th className="text-left py-2 px-3">{LEVEL_LABEL[level]}</th>
                  <th className="text-right py-2 px-3">Target Qty (Kuartal)</th>
                  <th className="text-right py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={3} className="py-3 px-3 text-center" style={{ color: "var(--color-text-faint)" }}>Tidak ada data di level ini.</td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.nip} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <td className="py-1.5 px-3">
                      {r.name} <span style={{ color: "var(--color-text-faint)" }}>({r.nip})</span>
                    </td>
                    <td className="py-1.5 px-3">
                      <input type="number" min="0" step="0.01"
                        value={edited[r.nip] ?? String(r.qty)}
                        onChange={(e) => setEdited((prev) => ({ ...prev, [r.nip]: e.target.value }))}
                        className="input-field text-right" style={{ maxWidth: 120, marginLeft: "auto" }} />
                    </td>
                    <td className="py-1.5 px-3 text-right whitespace-nowrap">
                      {r.role !== "MR" && (
                        <button type="button" onClick={() => drillInto(r)} className="text-xs font-medium mr-3" style={{ color: "var(--color-blue)" }}>
                          Detail →
                        </button>
                      )}
                      <button type="button" onClick={() => setToDelete(r)} className="text-xs font-medium" style={{ color: "var(--color-red)" }}>
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={handleSave} disabled={saving || Object.keys(edited).length === 0}>
              {saving ? "Menyimpan…" : "Simpan Perubahan"}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={handleApply} disabled={applying}>
              {applying ? "Menerapkan…" : "Terapkan ke Draft POA (semua produk, kuartal ini)"}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete} tone="danger" title="Hapus alokasi?"
        message={`Alokasi ${toDelete?.name} (${toDelete?.nip}) untuk produk ini di kuartal ${quarter} akan dihapus - beda dengan menyimpan qty 0, baris ini jadi "belum diset" lagi.`}
        confirmLabel="Hapus" confirmPending={deleting}
        onConfirm={confirmDelete} onCancel={() => setToDelete(null)} />
    </div>
  );
}
