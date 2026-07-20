"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Combobox } from "@/components/ui/Combobox";
import { SPESIALISASI_PM_LABEL, spesLabel } from "@/lib/spesialisasi";
import {
  createUserAction, updateUserAction, deleteUserAction, searchUsersAction, type UserRow,
  createOutletAction, updateOutletAction, deleteOutletAction, searchOutletsAction, type OutletRow,
  createProductAction, updateProductAction, deleteProductAction, searchProductsAction, type ProductRow,
  updateCustomerAction, deleteCustomerAction, searchCustomersAction, type CustomerRow,
} from "@/app/actions/admin";
import { createCustomerAction } from "@/app/actions/customer";

type TabKey = "user" | "outlet" | "dokter" | "produk";

interface OutletOption { kodePI: string; namaOutlet: string; groupRS?: string | null }

const ROLE_OPTIONS = ["MR", "ASM", "SM", "NSM", "GM", "ADMIN"] as const;
const KATEGORI_OPTIONS = ["A", "B", "C"];

function Req() {
  return <span style={{ color: "var(--color-red)", marginLeft: 2 }}>*</span>;
}
function Opt() {
  return <span className="ml-1 text-xs" style={{ color: "var(--color-text-faint)", fontWeight: 400 }}>(opsional)</span>;
}
const ERR_RING = { outline: "2px solid var(--color-red)", outlineOffset: 2, borderRadius: 6 } as const;

function Field({ label, required, attempted, invalid, children }: {
  label: string; required?: boolean; attempted: boolean; invalid: boolean; children: React.ReactNode;
}) {
  const showErr = attempted && invalid;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs" style={{ color: showErr ? "var(--color-red)" : "var(--color-text-muted)" }}>
        {label}{required ? <Req /> : <Opt />}
      </span>
      <div style={showErr ? ERR_RING : undefined}>{children}</div>
      {showErr && <span className="text-xs" style={{ color: "var(--color-red)" }}>Wajib diisi</span>}
    </label>
  );
}

function SearchBox({ query, onQueryChange, onSearch, searching, placeholder }: {
  query: string; onQueryChange: (v: string) => void; onSearch: () => void; searching: boolean; placeholder: string;
}) {
  return (
    <div className="flex gap-2">
      <input
        type="text" value={query} placeholder={placeholder}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSearch(); } }}
        className="input-field flex-1" />
      <Button type="button" size="sm" variant="secondary" onClick={onSearch} disabled={searching}>
        {searching ? "Mencari…" : "Cari"}
      </Button>
    </div>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex gap-2 shrink-0">
      <button type="button" onClick={onEdit} className="text-xs font-medium" style={{ color: "var(--color-blue)" }}>Edit</button>
      <button type="button" onClick={onDelete} className="text-xs font-medium" style={{ color: "var(--color-red)" }}>Hapus</button>
    </div>
  );
}

// ─── Tab: Tambah/Edit User (staff) ──────────────────────────────────────────

function UserTab() {
  const emptyForm = { nip: "", name: "", role: "", email: "", nipAtasan: "", isActive: true };
  const [form, setForm] = useState(emptyForm);
  const [editingNip, setEditingNip] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserRow[]>([]);
  const [searching, startSearch] = useTransition();
  const [toDelete, setToDelete] = useState<UserRow | null>(null);
  const [deleting, startDelete] = useTransition();

  function runSearch() { startSearch(async () => setResults(await searchUsersAction(query))); }

  function startEdit(row: UserRow) {
    setEditingNip(row.nip);
    setForm({ nip: row.nip, name: row.name, role: row.role, email: row.email ?? "", nipAtasan: row.nipAtasan ?? "", isActive: row.isActive });
    setAttempted(false); setError(null); setNotice(null);
  }
  function cancelEdit() { setEditingNip(null); setForm(emptyForm); setAttempted(false); setError(null); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nip.trim() || !form.name.trim() || !form.role) { setAttempted(true); return; }
    setError(null); setNotice(null);
    const fd = new FormData();
    fd.set("nip", form.nip.trim());
    fd.set("name", form.name.trim());
    fd.set("role", form.role);
    fd.set("email", form.email.trim());
    fd.set("nipAtasan", form.nipAtasan.trim());
    fd.set("isActive", form.isActive ? "true" : "false");
    startTransition(async () => {
      const result = editingNip ? await updateUserAction(fd) : await createUserAction(fd);
      if (result.ok) {
        setNotice(editingNip ? "User berhasil diupdate." : "User berhasil ditambahkan.");
        setResults((rs) => rs.map((r) => (r.nip === form.nip ? { ...r, ...form, email: form.email || null, nipAtasan: form.nipAtasan || null } : r)));
        cancelEdit();
      } else {
        setError(result.error ?? "Gagal menyimpan user.");
      }
    });
  }

  function confirmDelete() {
    if (!toDelete) return;
    startDelete(async () => {
      const result = await deleteUserAction(toDelete.nip);
      if (result.ok) {
        setResults((rs) => rs.filter((r) => r.nip !== toDelete.nip));
        setToDelete(null);
      } else {
        setError(result.error ?? "Gagal menghapus user.");
        setToDelete(null);
      }
    });
  }

  return (
    <div className="space-y-5">
      <Card>
        <p className="font-semibold text-sm mb-3" style={{ color: "var(--color-text)" }}>
          {editingNip ? `Edit User — ${editingNip}` : "Tambah User"}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm px-3 py-2 rounded-md" style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>}
          {notice && <p className="text-sm px-3 py-2 rounded-md" style={{ background: "var(--color-success-bg, #dcfce7)", color: "var(--color-success, #16a34a)" }}>{notice}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="NIP" required attempted={attempted} invalid={!form.nip.trim()}>
              <input type="text" value={form.nip} disabled={!!editingNip}
                onChange={(e) => setForm({ ...form, nip: e.target.value })}
                placeholder="mis. P250431" className="input-field w-full" />
            </Field>
            <Field label="Nama" required attempted={attempted} invalid={!form.name.trim()}>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nama lengkap" className="input-field w-full" />
            </Field>
            <Field label="Role" required attempted={attempted} invalid={!form.role}>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="input-field w-full">
                <option value="">— Pilih —</option>
                {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Email" attempted={attempted} invalid={false}>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="nama@pharos.co.id" className="input-field w-full" />
            </Field>
            <Field label="NIP Atasan" attempted={attempted} invalid={false}>
              <input type="text" value={form.nipAtasan} onChange={(e) => setForm({ ...form, nipAtasan: e.target.value })} placeholder="NIP atasan langsung (kalau ada)" className="input-field w-full" />
            </Field>
            {editingNip && (
              <label className="flex items-center gap-2 text-sm cursor-pointer pt-5">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="rounded" />
                <span style={{ color: "var(--color-text-muted)" }}>Aktif</span>
              </label>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Menyimpan…" : editingNip ? "Update User" : "Tambah User"}
            </Button>
            {editingNip && <Button type="button" size="sm" variant="ghost" onClick={cancelEdit}>Batal Edit</Button>}
          </div>
        </form>
      </Card>

      <Card>
        <p className="font-semibold text-sm mb-3" style={{ color: "var(--color-text)" }}>Cari / Kelola User</p>
        <SearchBox query={query} onQueryChange={setQuery} onSearch={runSearch} searching={searching} placeholder="Cari NIP atau nama…" />
        <div className="mt-3 divide-y" style={{ borderColor: "var(--color-border)" }}>
          {results.length === 0 && <p className="text-xs py-3" style={{ color: "var(--color-text-faint)" }}>Belum ada hasil pencarian.</p>}
          {results.map((r) => (
            <div key={r.nip} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate" style={{ color: "var(--color-text)" }}>{r.name} <span style={{ color: "var(--color-text-faint)" }}>({r.nip})</span></p>
                <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>{r.role}{!r.isActive && " · nonaktif"}</p>
              </div>
              <RowActions onEdit={() => startEdit(r)} onDelete={() => setToDelete(r)} />
            </div>
          ))}
        </div>
      </Card>

      <ConfirmDialog
        open={!!toDelete} tone="danger" title="Hapus user?"
        message={`${toDelete?.name} (${toDelete?.nip}) akan dihapus permanen. Kalau masih ada POA/assignment terkait, penghapusan akan gagal.`}
        confirmLabel="Hapus" confirmPending={deleting}
        onConfirm={confirmDelete} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// ─── Tab: Tambah/Edit Outlet ─────────────────────────────────────────────────

function OutletTab() {
  const emptyForm = {
    kodePI: "", namaOutlet: "", groupRS: "", sector: "", subSektor: "", kota: "", propinsi: "",
    kategori: "", namaGT: "", namaSub: "", namaArea: "", namaReg: "",
  };
  const [form, setForm] = useState(emptyForm);
  const [editingKodePI, setEditingKodePI] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OutletRow[]>([]);
  const [searching, startSearch] = useTransition();
  const [toDelete, setToDelete] = useState<OutletRow | null>(null);
  const [deleting, startDelete] = useTransition();

  function runSearch() { startSearch(async () => setResults(await searchOutletsAction(query))); }

  function startEdit(row: OutletRow) {
    setEditingKodePI(row.kodePI);
    setForm({
      kodePI: row.kodePI, namaOutlet: row.namaOutlet, groupRS: row.groupRS ?? "",
      sector: row.sector ?? "", subSektor: row.subSektor ?? "", kota: row.kota ?? "", propinsi: row.propinsi ?? "",
      kategori: row.kategori ?? "", namaGT: row.namaGT ?? "", namaSub: row.namaSub ?? "", namaArea: row.namaArea ?? "", namaReg: row.namaReg ?? "",
    });
    setAttempted(false); setError(null); setNotice(null);
  }
  function cancelEdit() { setEditingKodePI(null); setForm(emptyForm); setAttempted(false); setError(null); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.kodePI.trim() || !form.namaOutlet.trim()) { setAttempted(true); return; }
    setError(null); setNotice(null);
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.set(k, v.trim()));
    startTransition(async () => {
      const result = editingKodePI ? await updateOutletAction(fd) : await createOutletAction(fd);
      if (result.ok) {
        setNotice(editingKodePI ? "Outlet berhasil diupdate." : "Outlet berhasil ditambahkan.");
        cancelEdit();
      } else {
        setError(result.error ?? "Gagal menyimpan outlet.");
      }
    });
  }

  function confirmDelete() {
    if (!toDelete) return;
    startDelete(async () => {
      const result = await deleteOutletAction(toDelete.kodePI);
      if (result.ok) { setResults((rs) => rs.filter((r) => r.kodePI !== toDelete.kodePI)); setToDelete(null); }
      else { setError(result.error ?? "Gagal menghapus outlet."); setToDelete(null); }
    });
  }

  return (
    <div className="space-y-5">
      <Card>
        <p className="font-semibold text-sm mb-3" style={{ color: "var(--color-text)" }}>
          {editingKodePI ? `Edit Outlet — ${editingKodePI}` : "Tambah Outlet"}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm px-3 py-2 rounded-md" style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>}
          {notice && <p className="text-sm px-3 py-2 rounded-md" style={{ background: "var(--color-success-bg, #dcfce7)", color: "var(--color-success, #16a34a)" }}>{notice}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Kode PI" required attempted={attempted} invalid={!form.kodePI.trim()}>
              <input type="text" value={form.kodePI} disabled={!!editingKodePI} onChange={(e) => setForm({ ...form, kodePI: e.target.value })} placeholder="mis. F1234567" className="input-field w-full" />
            </Field>
            <Field label="Nama Outlet" required attempted={attempted} invalid={!form.namaOutlet.trim()}>
              <input type="text" value={form.namaOutlet} onChange={(e) => setForm({ ...form, namaOutlet: e.target.value })} placeholder="Nama RS/Apotek/Klinik" className="input-field w-full" />
            </Field>
            <Field label="Grup Chain" attempted={attempted} invalid={false}>
              <input type="text" value={form.groupRS} onChange={(e) => setForm({ ...form, groupRS: e.target.value })} placeholder="mis. HERMINA GRUP" className="input-field w-full" />
            </Field>
            <Field label="Kategori Outlet" attempted={attempted} invalid={false}>
              <select value={form.kategori} onChange={(e) => setForm({ ...form, kategori: e.target.value })} className="input-field w-full">
                <option value="">— Pilih —</option>
                {KATEGORI_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </Field>
            <Field label="Kota" attempted={attempted} invalid={false}>
              <input type="text" value={form.kota} onChange={(e) => setForm({ ...form, kota: e.target.value })} className="input-field w-full" />
            </Field>
            <Field label="Provinsi" attempted={attempted} invalid={false}>
              <input type="text" value={form.propinsi} onChange={(e) => setForm({ ...form, propinsi: e.target.value })} className="input-field w-full" />
            </Field>
            <Field label="Sector" attempted={attempted} invalid={false}>
              <input type="text" value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })} className="input-field w-full" />
            </Field>
            <Field label="Sub Sektor" attempted={attempted} invalid={false}>
              <input type="text" value={form.subSektor} onChange={(e) => setForm({ ...form, subSektor: e.target.value })} className="input-field w-full" />
            </Field>
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider pt-1" style={{ color: "var(--color-text-faint)" }}>Territory (opsional)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Nama Region" attempted={attempted} invalid={false}>
              <input type="text" value={form.namaReg} onChange={(e) => setForm({ ...form, namaReg: e.target.value })} className="input-field w-full" />
            </Field>
            <Field label="Nama Area" attempted={attempted} invalid={false}>
              <input type="text" value={form.namaArea} onChange={(e) => setForm({ ...form, namaArea: e.target.value })} className="input-field w-full" />
            </Field>
            <Field label="Nama Sub Area" attempted={attempted} invalid={false}>
              <input type="text" value={form.namaSub} onChange={(e) => setForm({ ...form, namaSub: e.target.value })} className="input-field w-full" />
            </Field>
            <Field label="Nama GT" attempted={attempted} invalid={false}>
              <input type="text" value={form.namaGT} onChange={(e) => setForm({ ...form, namaGT: e.target.value })} className="input-field w-full" />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={isPending}>{isPending ? "Menyimpan…" : editingKodePI ? "Update Outlet" : "Tambah Outlet"}</Button>
            {editingKodePI && <Button type="button" size="sm" variant="ghost" onClick={cancelEdit}>Batal Edit</Button>}
          </div>
        </form>
      </Card>

      <Card>
        <p className="font-semibold text-sm mb-3" style={{ color: "var(--color-text)" }}>Cari / Kelola Outlet</p>
        <SearchBox query={query} onQueryChange={setQuery} onSearch={runSearch} searching={searching} placeholder="Cari Kode PI atau nama outlet…" />
        <div className="mt-3 divide-y" style={{ borderColor: "var(--color-border)" }}>
          {results.length === 0 && <p className="text-xs py-3" style={{ color: "var(--color-text-faint)" }}>Belum ada hasil pencarian.</p>}
          {results.map((r) => (
            <div key={r.kodePI} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate" style={{ color: "var(--color-text)" }}>{r.namaOutlet} <span style={{ color: "var(--color-text-faint)" }}>({r.kodePI})</span></p>
                <p className="text-xs truncate" style={{ color: "var(--color-text-faint)" }}>{r.groupRS ?? "NON CHAIN"}{r.kota ? ` · ${r.kota}` : ""}</p>
              </div>
              <RowActions onEdit={() => startEdit(r)} onDelete={() => setToDelete(r)} />
            </div>
          ))}
        </div>
      </Card>

      <ConfirmDialog
        open={!!toDelete} tone="danger" title="Hapus outlet?"
        message={`${toDelete?.namaOutlet} (${toDelete?.kodePI}) akan dihapus. Semua assignment MR dan data dokter yang terhubung ke outlet ini akan ikut terhapus.`}
        confirmLabel="Hapus" confirmPending={deleting}
        onConfirm={confirmDelete} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// ─── Tab: Tambah/Edit User + Spesialisasi (dokter) ──────────────────────────

function DokterTab({ outlets }: { outlets: OutletOption[] }) {
  const emptyForm = { namaCustomer: "", spesialisasi: "", kodePI: "", isFokus: false };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerRow[]>([]);
  const [searching, startSearch] = useTransition();
  const [toDelete, setToDelete] = useState<CustomerRow | null>(null);
  const [deleting, startDelete] = useTransition();

  const outletOptions = outlets.map((o) => ({
    value: o.kodePI, label: `${o.kodePI} - ${o.namaOutlet}`, sublabel: o.groupRS ?? "NON CHAIN",
  }));
  const spesOptions = Object.entries(SPESIALISASI_PM_LABEL).map(([db, pm]) => ({ value: db, label: pm }));

  function runSearch() { startSearch(async () => setResults(await searchCustomersAction(query))); }

  function startEdit(row: CustomerRow) {
    setEditingId(row.customerOutletId);
    setForm({ namaCustomer: row.namaCustomer, spesialisasi: row.spesialisasi, kodePI: row.kodePI, isFokus: row.isFokus });
    setAttempted(false); setError(null); setNotice(null);
  }
  function cancelEdit() { setEditingId(null); setForm(emptyForm); setAttempted(false); setError(null); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.namaCustomer.trim() || !form.spesialisasi || !form.kodePI) { setAttempted(true); return; }
    setError(null); setNotice(null);
    const fd = new FormData();
    fd.set("namaCustomer", form.namaCustomer.trim());
    fd.set("spesialisasi", form.spesialisasi);
    fd.set("kodePI", form.kodePI);
    fd.set("isFokus", form.isFokus ? "true" : "false");
    if (editingId) fd.set("customerOutletId", editingId);
    startTransition(async () => {
      const result = editingId ? await updateCustomerAction(fd) : await createCustomerAction(fd);
      if (result.ok) {
        setNotice(editingId ? "Data dokter berhasil diupdate." : "Dokter berhasil ditambahkan.");
        cancelEdit();
      } else {
        setError(result.error ?? "Gagal menyimpan data dokter.");
      }
    });
  }

  function confirmDelete() {
    if (!toDelete) return;
    startDelete(async () => {
      const result = await deleteCustomerAction(toDelete.customerOutletId);
      if (result.ok) { setResults((rs) => rs.filter((r) => r.customerOutletId !== toDelete.customerOutletId)); setToDelete(null); }
      else { setError(result.error ?? "Gagal menghapus data dokter."); setToDelete(null); }
    });
  }

  return (
    <div className="space-y-5">
      <Card>
        <p className="font-semibold text-sm mb-3" style={{ color: "var(--color-text)" }}>
          {editingId ? "Edit User + Spesialisasi" : "Tambah User + Spesialisasi"}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm px-3 py-2 rounded-md" style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>}
          {notice && <p className="text-sm px-3 py-2 rounded-md" style={{ background: "var(--color-success-bg, #dcfce7)", color: "var(--color-success, #16a34a)" }}>{notice}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Outlet" required attempted={attempted} invalid={!form.kodePI}>
              <Combobox name="_outlet_admin" value={form.kodePI} onChange={(v) => setForm({ ...form, kodePI: v })} placeholder="Cari outlet…" options={outletOptions} />
            </Field>
            <Field label="Nama User" required attempted={attempted} invalid={!form.namaCustomer.trim()}>
              <input type="text" value={form.namaCustomer} onChange={(e) => setForm({ ...form, namaCustomer: e.target.value })} placeholder="dr. Nama Lengkap" className="input-field w-full" />
            </Field>
            <Field label="Spesialisasi" required attempted={attempted} invalid={!form.spesialisasi}>
              <select value={form.spesialisasi} onChange={(e) => setForm({ ...form, spesialisasi: e.target.value })} className="input-field w-full">
                <option value="">— Pilih —</option>
                {spesOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.isFokus} onChange={(e) => setForm({ ...form, isFokus: e.target.checked })} className="rounded" />
            <span style={{ color: "var(--color-text-muted)" }}>Termasuk Rekomendasi PM</span>
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={isPending}>{isPending ? "Menyimpan…" : editingId ? "Update" : "Tambah User"}</Button>
            {editingId && <Button type="button" size="sm" variant="ghost" onClick={cancelEdit}>Batal Edit</Button>}
          </div>
        </form>
      </Card>

      <Card>
        <p className="font-semibold text-sm mb-3" style={{ color: "var(--color-text)" }}>Cari / Kelola User + Spesialisasi</p>
        <SearchBox query={query} onQueryChange={setQuery} onSearch={runSearch} searching={searching} placeholder="Cari nama dokter/user…" />
        <div className="mt-3 divide-y" style={{ borderColor: "var(--color-border)" }}>
          {results.length === 0 && <p className="text-xs py-3" style={{ color: "var(--color-text-faint)" }}>Belum ada hasil pencarian.</p>}
          {results.map((r) => (
            <div key={r.customerOutletId} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate" style={{ color: "var(--color-text)" }}>{r.namaCustomer} <span style={{ color: "var(--color-text-faint)" }}>({spesLabel(r.spesialisasi)})</span></p>
                <p className="text-xs truncate" style={{ color: "var(--color-text-faint)" }}>{r.namaOutlet}{r.isFokus && " · ⭐ Rekomendasi PM"}</p>
              </div>
              <RowActions onEdit={() => startEdit(r)} onDelete={() => setToDelete(r)} />
            </div>
          ))}
        </div>
      </Card>

      <ConfirmDialog
        open={!!toDelete} tone="danger" title="Hapus data dokter?"
        message={`${toDelete?.namaCustomer} di outlet ${toDelete?.namaOutlet} akan dihapus.`}
        confirmLabel="Hapus" confirmPending={deleting}
        onConfirm={confirmDelete} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// ─── Tab: Tambah/Edit Produk ─────────────────────────────────────────────────

function ProdukTab() {
  const emptyForm = {
    kodeProduk: "", namaProduk: "", namaGroupBrand: "", satuan: "", hna: "",
    zatAktif: "", nilaiRPersen: "", satuanTerkecil: "", konversiPembagi: "",
  };
  const [form, setForm] = useState(emptyForm);
  const [editingKode, setEditingKode] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductRow[]>([]);
  const [searching, startSearch] = useTransition();
  const [toDelete, setToDelete] = useState<ProductRow | null>(null);
  const [deleting, startDelete] = useTransition();

  const hnaInvalid = !form.hna.trim() || isNaN(parseFloat(form.hna)) || parseFloat(form.hna) < 0;

  function runSearch() { startSearch(async () => setResults(await searchProductsAction(query))); }

  function startEdit(row: ProductRow) {
    setEditingKode(row.kodeProduk);
    setForm({
      kodeProduk: row.kodeProduk, namaProduk: row.namaProduk, namaGroupBrand: row.namaGroupBrand, satuan: row.satuan,
      hna: row.hna, zatAktif: row.zatAktif ?? "", nilaiRPersen: row.nilaiRPersen ?? "",
      satuanTerkecil: row.satuanTerkecil ?? "", konversiPembagi: row.konversiPembagi ?? "",
    });
    setAttempted(false); setError(null); setNotice(null);
  }
  function cancelEdit() { setEditingKode(null); setForm(emptyForm); setAttempted(false); setError(null); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.kodeProduk.trim() || !form.namaProduk.trim() || !form.namaGroupBrand.trim() || !form.satuan.trim() || hnaInvalid) {
      setAttempted(true);
      return;
    }
    setError(null); setNotice(null);
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.set(k, v.trim()));
    startTransition(async () => {
      const result = editingKode ? await updateProductAction(fd) : await createProductAction(fd);
      if (result.ok) {
        setNotice(editingKode ? "Produk berhasil diupdate." : "Produk berhasil ditambahkan.");
        cancelEdit();
      } else {
        setError(result.error ?? "Gagal menyimpan produk.");
      }
    });
  }

  function confirmDelete() {
    if (!toDelete) return;
    startDelete(async () => {
      const result = await deleteProductAction(toDelete.kodeProduk);
      if (result.ok) { setResults((rs) => rs.filter((r) => r.kodeProduk !== toDelete.kodeProduk)); setToDelete(null); }
      else { setError(result.error ?? "Gagal menghapus produk."); setToDelete(null); }
    });
  }

  return (
    <div className="space-y-5">
      <Card>
        <p className="font-semibold text-sm mb-3" style={{ color: "var(--color-text)" }}>
          {editingKode ? `Edit Produk — ${editingKode}` : "Tambah Produk"}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm px-3 py-2 rounded-md" style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>{error}</p>}
          {notice && <p className="text-sm px-3 py-2 rounded-md" style={{ background: "var(--color-success-bg, #dcfce7)", color: "var(--color-success, #16a34a)" }}>{notice}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Kode Produk" required attempted={attempted} invalid={!form.kodeProduk.trim()}>
              <input type="text" value={form.kodeProduk} disabled={!!editingKode} onChange={(e) => setForm({ ...form, kodeProduk: e.target.value })} placeholder="mis. 013390" className="input-field w-full" />
            </Field>
            <Field label="Nama Produk" required attempted={attempted} invalid={!form.namaProduk.trim()}>
              <input type="text" value={form.namaProduk} onChange={(e) => setForm({ ...form, namaProduk: e.target.value })} className="input-field w-full" />
            </Field>
            <Field label="Group Brand" required attempted={attempted} invalid={!form.namaGroupBrand.trim()}>
              <input type="text" value={form.namaGroupBrand} onChange={(e) => setForm({ ...form, namaGroupBrand: e.target.value })} placeholder="mis. ETHICAL" className="input-field w-full" />
            </Field>
            <Field label="Satuan (SJ)" required attempted={attempted} invalid={!form.satuan.trim()}>
              <input type="text" value={form.satuan} onChange={(e) => setForm({ ...form, satuan: e.target.value })} placeholder="mis. BOX" className="input-field w-full" />
            </Field>
            <Field label="HNA per SJ (Rp)" required attempted={attempted} invalid={hnaInvalid}>
              <input type="number" min="0" step="0.01" value={form.hna} onChange={(e) => setForm({ ...form, hna: e.target.value })} className="input-field w-full" />
            </Field>
            <Field label="Zat Aktif" attempted={attempted} invalid={false}>
              <input type="text" value={form.zatAktif} onChange={(e) => setForm({ ...form, zatAktif: e.target.value })} className="input-field w-full" />
            </Field>
            <Field label="Nilai R (%)" attempted={attempted} invalid={false}>
              <input type="number" min="0" step="0.01" value={form.nilaiRPersen} onChange={(e) => setForm({ ...form, nilaiRPersen: e.target.value })} placeholder="mis. 12.5" className="input-field w-full" />
            </Field>
            <Field label="Satuan Terkecil (ST)" attempted={attempted} invalid={false}>
              <input type="text" value={form.satuanTerkecil} onChange={(e) => setForm({ ...form, satuanTerkecil: e.target.value })} placeholder="mis. TABLET" className="input-field w-full" />
            </Field>
            <Field label="Konversi ST per SJ" attempted={attempted} invalid={false}>
              <input type="number" min="0" step="1" value={form.konversiPembagi} onChange={(e) => setForm({ ...form, konversiPembagi: e.target.value })} placeholder="mis. 10" className="input-field w-full" />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={isPending}>{isPending ? "Menyimpan…" : editingKode ? "Update Produk" : "Tambah Produk"}</Button>
            {editingKode && <Button type="button" size="sm" variant="ghost" onClick={cancelEdit}>Batal Edit</Button>}
          </div>
        </form>
      </Card>

      <Card>
        <p className="font-semibold text-sm mb-3" style={{ color: "var(--color-text)" }}>Cari / Kelola Produk</p>
        <SearchBox query={query} onQueryChange={setQuery} onSearch={runSearch} searching={searching} placeholder="Cari kode atau nama produk…" />
        <div className="mt-3 divide-y" style={{ borderColor: "var(--color-border)" }}>
          {results.length === 0 && <p className="text-xs py-3" style={{ color: "var(--color-text-faint)" }}>Belum ada hasil pencarian.</p>}
          {results.map((r) => (
            <div key={r.kodeProduk} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate" style={{ color: "var(--color-text)" }}>{r.namaProduk} <span style={{ color: "var(--color-text-faint)" }}>({r.kodeProduk})</span></p>
                <p className="text-xs truncate" style={{ color: "var(--color-text-faint)" }}>{r.namaGroupBrand} · Rp {parseFloat(r.hna).toLocaleString("id-ID")}</p>
              </div>
              <RowActions onEdit={() => startEdit(r)} onDelete={() => setToDelete(r)} />
            </div>
          ))}
        </div>
      </Card>

      <ConfirmDialog
        open={!!toDelete} tone="danger" title="Hapus produk?"
        message={`${toDelete?.namaProduk} (${toDelete?.kodeProduk}) akan dihapus. Riwayat POA lama tidak terpengaruh.`}
        confirmLabel="Hapus" confirmPending={deleting}
        onConfirm={confirmDelete} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// ─── Tabs shell ──────────────────────────────────────────────────────────────

export function AdminTabs({ outlets }: { outlets: OutletOption[] }) {
  const [tab, setTab] = useState<TabKey>("user");

  const tabs: { key: TabKey; label: string }[] = [
    { key: "user", label: "Tambah User" },
    { key: "outlet", label: "Tambah Outlet" },
    { key: "dokter", label: "Tambah User + Spesialisasi" },
    { key: "produk", label: "Tambah Produk" },
  ];

  return (
    <div className="space-y-4">
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

      {tab === "user" && <UserTab />}
      {tab === "outlet" && <OutletTab />}
      {tab === "dokter" && <DokterTab outlets={outlets} />}
      {tab === "produk" && <ProdukTab />}
    </div>
  );
}
