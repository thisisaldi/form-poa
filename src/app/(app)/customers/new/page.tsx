"use client";

import { useState, useEffect, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Combobox } from "@/components/ui/Combobox";
import { Button } from "@/components/ui/Button";
import {
  saveDraftAction,
  submitCustomerPengajuanAction,
  type CustomerPengajuanData,
  type RekeningItem,
  type OrganisasiItem,
  type OutletPengajuan,
  type JadwalHari,
} from "@/app/actions/customerPengajuan";

// ─── Constants ────────────────────────────────────────────────────────────────

const JABATAN_OPTIONS = [
  "Dokter Umum", "Dokter Spesialis", "Dokter Sub Spesialis",
  "Dokter Gigi", "Apoteker", "Perawat", "Bidan", "Ahli Gizi", "Lainnya",
];

const SPESIALISASI_OPTIONS = [
  "ANAK (PEDIATRIC)", "PENYAKIT DALAM (INTERNIST)", "INTERNIST UMUM",
  "INTERNIST GASTRO", "INTERNIST ENDOKRIN", "INTERNIST PARU",
  "BEDAH (SURGEON)", "BEDAH UMUM", "BEDAH DIGESTIF", "BEDAH TULANG (ORTHOPEDI)",
  "BEDAH KANKER (ONKOLOGI)", "BEDAH ONKOLOGI", "BEDAH TORAK / JANTUNG",
  "BEDAH THORAKS & KARDIO VASKULAR (BTKV)", "BEDAH SYARAF", "BEDAH ANAK",
  "BEDAH PLASTIK", "BEDAH (UROLOGIS)", "BEDAH MULUT",
  "ANESTESI", "PENATA ANESTESI",
  "KANDUNGAN (OBSGYN)", "PARU (PULMONOLOGI)", "JANTUNG (KARDIOLOGI)",
  "SYARAF (NEUROLOGI)", "JIWA (PSIKIATER)", "HEMATOLOGI",
  "THT (ENT)", "THT & BEDAH KEPALA LEHER",
  "KULIT KELAMIN (DV)", "MATA (OPTAL)", "GIGI (DENTIST)",
  "REHAB MEDIK", "RADIOLOGI", "PATOLOGI KLINIK",
  "KANDUNG KEMIH (UROLOGIST)", "GASTROENTEROLOGY-HEPATOLOGY",
  "UMUM (GP)", "APOTEKER", "PERAWAT", "BIDAN", "AHLI GIZI",
  "BAGIAN PEMBELIAN", "DIREKSI", "LAINNYA",
];

const BANK_OPTIONS = [
  "BCA", "BNI", "BRI", "Bank Mandiri", "BTN", "CIMB Niaga",
  "Danamon", "Permata", "Maybank", "Mega", "OCBC NISP",
  "BSI (Bank Syariah Indonesia)", "BPD", "Lainnya",
];

const RELASI_OPTIONS = ["Diri Sendiri", "Suami/Istri", "Orang Tua", "Anak", "Keluarga Lain"];

const HARI_LIST = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

function emptyJadwal(): Record<string, JadwalHari> {
  return Object.fromEntries(
    HARI_LIST.map((h) => [h, { mulai: "", selesai: "", jumlahPasien: "", tidakPraktik: false }])
  );
}

function emptyData(): CustomerPengajuanData {
  return {
    namaLengkap: "", namaPanggilan: "", jabatan: "", tipeCustomer: "",
    tanggalLahir: "", jenisKelamin: "", alamatRumah: "", kota: "",
    nik: "", email: "", nomorHp1: "", nomorHp2: "", rekening: [],
    universitasS1: "", spesialisasi: "", universitasSpesialis: "",
    subSpesialisasi: "", organisasi: [], outletsPengajuan: [],
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: number }) {
  const steps = ["Informasi Umum", "Pendidikan & Spesialisasi", "Outlet"];
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = step > n;
        const active = step === n;
        return (
          <div key={n} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors"
                style={{
                  background: done || active ? "var(--color-primary)" : "var(--color-bg)",
                  borderColor: done || active ? "var(--color-primary)" : "var(--color-border)",
                  color: done || active ? "#fff" : "var(--color-text-faint)",
                }}>
                {done ? "✓" : n}
              </div>
              <span className="text-xs whitespace-nowrap" style={{ color: active ? "var(--color-primary)" : "var(--color-text-faint)" }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="flex-1 h-0.5 mx-2 mb-4"
                style={{ background: step > n ? "var(--color-primary)" : "var(--color-border)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
      {children}{required && <span style={{ color: "var(--color-red)" }}> *</span>}
    </span>
  );
}

function SectionTitle({ children, description }: { children: React.ReactNode; description?: string }) {
  return (
    <div className="mb-5">
      <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>{children}</p>
      {description && <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>{description}</p>}
    </div>
  );
}

// ─── Rekening Modal ───────────────────────────────────────────────────────────

function RekeningModal({ onClose, onAdd }: { onClose: () => void; onAdd: (r: RekeningItem) => void }) {
  const [val, setVal] = useState<RekeningItem>({ pemilik: "", nomor: "", bank: "", relasi: "" });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!val.pemilik || !val.nomor || !val.bank || !val.relasi) return;
    onAdd(val);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="rounded-xl border p-5 w-full max-w-md space-y-4"
        style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
        <div className="flex items-center justify-between">
          <p className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>Tambah Rekening</p>
          <button onClick={onClose} className="text-sm" style={{ color: "var(--color-text-faint)" }}>✕</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          {([
            ["pemilik", "Pemilik Rekening", true],
            ["nomor", "Nomor Rekening", true],
          ] as [keyof RekeningItem, string, boolean][]).map(([k, label, req]) => (
            <label key={k} className="flex flex-col gap-1">
              <FieldLabel required={req}>{label}</FieldLabel>
              <input className="input-field" value={val[k]} required={req}
                onChange={(e) => setVal((v) => ({ ...v, [k]: e.target.value }))} />
            </label>
          ))}
          <label className="flex flex-col gap-1">
            <FieldLabel required>Bank</FieldLabel>
            <select className="input-field" value={val.bank} required
              onChange={(e) => setVal((v) => ({ ...v, bank: e.target.value }))}>
              <option value="">— Pilih Bank —</option>
              {BANK_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel required>Relasi</FieldLabel>
            <select className="input-field" value={val.relasi} required
              onChange={(e) => setVal((v) => ({ ...v, relasi: e.target.value }))}>
              <option value="">— Pilih Relasi —</option>
              {RELASI_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <div className="flex gap-2 pt-1">
            <Button type="submit" size="sm">Simpan</Button>
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>Batal</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Organisasi Modal ─────────────────────────────────────────────────────────

function OrganisasiModal({ onClose, onAdd }: { onClose: () => void; onAdd: (o: OrganisasiItem) => void }) {
  const [val, setVal] = useState<OrganisasiItem>({ namaOrganisasi: "", jabatanOrganisasi: "" });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!val.namaOrganisasi) return;
    onAdd(val);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="rounded-xl border p-5 w-full max-w-sm space-y-4"
        style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
        <div className="flex items-center justify-between">
          <p className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>Tambah Organisasi</p>
          <button onClick={onClose} className="text-sm" style={{ color: "var(--color-text-faint)" }}>✕</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="flex flex-col gap-1">
            <FieldLabel required>Nama Organisasi</FieldLabel>
            <input className="input-field" placeholder="Contoh: IDAI (Ikatan Dokter Anak Indonesia)"
              value={val.namaOrganisasi} required
              onChange={(e) => setVal((v) => ({ ...v, namaOrganisasi: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>Jabatan Organisasi</FieldLabel>
            <input className="input-field" placeholder="Contoh: Anggota"
              value={val.jabatanOrganisasi}
              onChange={(e) => setVal((v) => ({ ...v, jabatanOrganisasi: e.target.value }))} />
          </label>
          <div className="flex gap-2 pt-1">
            <Button type="submit" size="sm">Simpan</Button>
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>Batal</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Jadwal Praktik Modal ─────────────────────────────────────────────────────

function JadwalModal({
  hari, jadwal, onClose, onSave,
}: {
  hari: string;
  jadwal: JadwalHari;
  onClose: () => void;
  onSave: (h: string, j: JadwalHari) => void;
}) {
  const [val, setVal] = useState<JadwalHari>({ ...jadwal });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="rounded-xl border p-5 w-full max-w-sm space-y-4"
        style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
        <div className="flex items-center justify-between">
          <p className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>Edit Praktik — {hari}</p>
          <button onClick={onClose} className="text-sm" style={{ color: "var(--color-text-faint)" }}>✕</button>
        </div>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={val.tidakPraktik}
              onChange={(e) => setVal((v) => ({ ...v, tidakPraktik: e.target.checked }))} />
            <span style={{ color: "var(--color-text-muted)" }}>Tidak Praktik</span>
          </label>
          {!val.tidakPraktik && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <FieldLabel>Mulai Praktik</FieldLabel>
                  <input type="time" className="input-field" value={val.mulai}
                    onChange={(e) => setVal((v) => ({ ...v, mulai: e.target.value }))} />
                </label>
                <label className="flex flex-col gap-1">
                  <FieldLabel>Selesai Praktik</FieldLabel>
                  <input type="time" className="input-field" value={val.selesai}
                    onChange={(e) => setVal((v) => ({ ...v, selesai: e.target.value }))} />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <FieldLabel>Jumlah Pasien</FieldLabel>
                <input type="number" min="0" className="input-field" value={val.jumlahPasien}
                  onChange={(e) => setVal((v) => ({ ...v, jumlahPasien: e.target.value }))} />
              </label>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={() => { onSave(hari, val); onClose(); }}>Simpan</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>Batal</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Outlet Modal ─────────────────────────────────────────────────────────────

function OutletModal({
  outletOptions, onClose, onAdd,
}: {
  outletOptions: { value: string; label: string }[];
  onClose: () => void;
  onAdd: (o: OutletPengajuan) => void;
}) {
  const [kodePI, setKodePI] = useState("");
  const [jadwal, setJadwal] = useState<Record<string, JadwalHari>>(emptyJadwal());
  const [editingHari, setEditingHari] = useState<string | null>(null);

  const selectedOutlet = outletOptions.find((o) => o.value === kodePI);

  function handleSaveJadwal(hari: string, j: JadwalHari) {
    setJadwal((prev) => ({ ...prev, [hari]: j }));
  }

  function handleSubmit() {
    if (!kodePI) return;
    onAdd({ kodePI, namaOutlet: selectedOutlet?.label ?? kodePI, jadwal });
    onClose();
  }

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
        <div className="rounded-xl border p-5 w-full max-w-lg space-y-4"
          style={{ background: "var(--color-bg)", borderColor: "var(--color-border)", maxHeight: "90vh", overflowY: "auto" }}>
          <div className="flex items-center justify-between">
            <p className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>Tambah Outlet</p>
            <button onClick={onClose} className="text-sm" style={{ color: "var(--color-text-faint)" }}>✕</button>
          </div>

          <div className="flex flex-col gap-1">
            <FieldLabel required>Outlet</FieldLabel>
            <Combobox name="_outlet_pengajuan" value={kodePI} onChange={setKodePI}
              placeholder="Cari outlet…" options={outletOptions} />
          </div>

          {/* Jadwal Praktik table */}
          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-text-muted)" }}>Jadwal Praktik</p>
            <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: "var(--color-bg-subtle)" }}>
                    <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>Hari</th>
                    <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>Jam Operasional</th>
                    <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--color-text-muted)" }}>Pasien</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {HARI_LIST.map((hari) => {
                    const j = jadwal[hari];
                    return (
                      <tr key={hari} style={{ borderTop: "1px solid var(--color-border)" }}>
                        <td className="px-3 py-2" style={{ color: "var(--color-text)" }}>{hari}</td>
                        <td className="px-3 py-2" style={{ color: "var(--color-text-muted)" }}>
                          {j.tidakPraktik ? <span style={{ color: "var(--color-text-faint)" }}>Libur</span>
                            : j.mulai && j.selesai ? `${j.mulai} – ${j.selesai}`
                            : <span style={{ color: "var(--color-text-faint)" }}>—</span>}
                        </td>
                        <td className="px-3 py-2" style={{ color: "var(--color-text-muted)" }}>
                          {!j.tidakPraktik && j.jumlahPasien ? j.jumlahPasien : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button type="button" className="text-xs px-2 py-0.5 rounded border"
                            style={{ borderColor: "var(--color-border)", color: "var(--color-primary)" }}
                            onClick={() => setEditingHari(hari)}>
                            Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={handleSubmit} disabled={!kodePI}>Simpan</Button>
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>Batal</Button>
          </div>
        </div>
      </div>

      {editingHari && (
        <div style={{ zIndex: 60, position: "relative" }}>
          <JadwalModal
            hari={editingHari}
            jadwal={jadwal[editingHari]}
            onClose={() => setEditingHari(null)}
            onSave={handleSaveJadwal}
          />
        </div>
      )}
    </>
  );
}

// ─── Main Form ────────────────────────────────────────────────────────────────

export default function CustomerNewPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [data, setData] = useState<CustomerPengajuanData>(emptyData());
  const [draftId, setDraftId] = useState<string | undefined>();
  const [showRekeningModal, setShowRekeningModal] = useState(false);
  const [showOrganisasiModal, setShowOrganisasiModal] = useState(false);
  const [showOutletModal, setShowOutletModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Fetch outlets for Combobox
  const [outlets, setOutlets] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    fetch("/api/outlets")
      .then((r) => r.json())
      .then((list: { kodePI: string; namaOutlet: string }[]) =>
        setOutlets(list.map((o) => ({ value: o.kodePI, label: `${o.kodePI} — ${o.namaOutlet}` })))
      )
      .catch(() => {});
  }, []);

  function patch(partial: Partial<CustomerPengajuanData>) {
    setData((d) => ({ ...d, ...partial }));
  }

  function handleSaveDraft() {
    setError(null);
    startTransition(async () => {
      const res = await saveDraftAction(data, draftId);
      if (res.ok) {
        setDraftId(res.id);
        alert("Draft tersimpan.");
      } else {
        setError(res.error ?? "Gagal menyimpan draft.");
      }
    });
  }

  function handleSubmit() {
    setError(null);
    if (!data.namaLengkap || !data.nomorHp1 || !data.jabatan || !data.tipeCustomer) {
      setError("Lengkapi Step 1: Nama, HP, Jabatan, dan Tipe Customer wajib diisi.");
      return;
    }
    if (!data.spesialisasi) {
      setError("Lengkapi Step 2: Spesialisasi wajib diisi.");
      return;
    }
    startTransition(async () => {
      const res = await submitCustomerPengajuanAction(data, draftId);
      if (res.ok) {
        router.push("/dashboard");
      } else {
        setError(res.error ?? "Gagal submit.");
      }
    });
  }

  const spesOptions = useMemo(() =>
    SPESIALISASI_OPTIONS.map((s) => ({ value: s, label: s })), []);

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-text)" }}>Daftar Dokter Baru</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
          Pastikan seluruh informasi customer telah diisi dengan lengkap dan akurat.
        </p>
      </div>

      <StepIndicator step={step} />

      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg text-sm"
          style={{ background: "var(--color-red-light)", color: "var(--color-red)" }}>
          {error}
        </div>
      )}

      <div className="rounded-xl border p-5"
        style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>

        {/* ── Step 1: Informasi Umum ── */}
        {step === 1 && (
          <div className="space-y-5">
            <SectionTitle description="Pastikan seluruh informasi customer telah diisi dengan lengkap dan akurat.">
              Informasi Umum
            </SectionTitle>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <FieldLabel required>Nama Lengkap</FieldLabel>
                <input className="input-field" placeholder="Masukkan Nama Sesuai KTP"
                  value={data.namaLengkap} onChange={(e) => patch({ namaLengkap: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <FieldLabel required>Nama Panggilan</FieldLabel>
                <input className="input-field" placeholder="Masukkan Nama Panggilan"
                  value={data.namaPanggilan} onChange={(e) => patch({ namaPanggilan: e.target.value })} />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <FieldLabel required>Jabatan</FieldLabel>
                <select className="input-field" value={data.jabatan}
                  onChange={(e) => patch({ jabatan: e.target.value })}>
                  <option value="">— Pilih Jabatan —</option>
                  {JABATAN_OPTIONS.map((j) => <option key={j} value={j}>{j}</option>)}
                </select>
              </label>
              <div className="flex flex-col gap-1">
                <FieldLabel required>Tipe Customer</FieldLabel>
                <div className="flex items-center gap-6 py-2">
                  {["NEGERI", "SWASTA"].map((t) => (
                    <label key={t} className="flex items-center gap-2 cursor-pointer text-sm"
                      style={{ color: "var(--color-text-muted)" }}>
                      <input type="radio" name="tipeCustomer" value={t}
                        checked={data.tipeCustomer === t}
                        onChange={() => patch({ tipeCustomer: t })} />
                      {t.charAt(0) + t.slice(1).toLowerCase()}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <FieldLabel>Tanggal Lahir</FieldLabel>
                <input type="date" className="input-field"
                  value={data.tanggalLahir} onChange={(e) => patch({ tanggalLahir: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <FieldLabel>Jenis Kelamin</FieldLabel>
                <select className="input-field" value={data.jenisKelamin}
                  onChange={(e) => patch({ jenisKelamin: e.target.value })}>
                  <option value="">— Pilih —</option>
                  <option value="L">Laki-laki</option>
                  <option value="P">Perempuan</option>
                </select>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <FieldLabel>Alamat Rumah</FieldLabel>
                <input className="input-field" placeholder="Masukkan alamat tanpa menuliskan 'Jalan'"
                  value={data.alamatRumah} onChange={(e) => patch({ alamatRumah: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <FieldLabel>Kota</FieldLabel>
                <input className="input-field" placeholder="Pilih Kota"
                  value={data.kota} onChange={(e) => patch({ kota: e.target.value })} />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <FieldLabel>NIK <span className="font-normal" style={{ color: "var(--color-text-faint)" }}>(16 digit)</span></FieldLabel>
                <input className="input-field" placeholder="Masukkan NIK" maxLength={16}
                  value={data.nik} onChange={(e) => patch({ nik: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <FieldLabel>Email</FieldLabel>
                <input type="email" className="input-field" placeholder="Masukkan Email"
                  value={data.email} onChange={(e) => patch({ email: e.target.value })} />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <FieldLabel required>Nomor HP 1</FieldLabel>
                <input type="tel" className="input-field" placeholder="Masukkan Nomor HP"
                  value={data.nomorHp1} onChange={(e) => patch({ nomorHp1: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <FieldLabel>Nomor HP 2</FieldLabel>
                <input type="tel" className="input-field" placeholder="Masukkan Nomor HP"
                  value={data.nomorHp2} onChange={(e) => patch({ nomorHp2: e.target.value })} />
              </label>
            </div>

            {/* Rekening */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <FieldLabel>Nomor Rekening</FieldLabel>
                <button type="button" onClick={() => setShowRekeningModal(true)}
                  className="text-xs font-medium" style={{ color: "var(--color-primary)" }}>
                  + Tambah Rekening
                </button>
              </div>
              {data.rekening.length === 0 ? (
                <p className="text-xs text-center py-3" style={{ color: "var(--color-text-faint)" }}>Belum Ada Rekening</p>
              ) : (
                <div className="space-y-1">
                  {data.rekening.map((r, i) => (
                    <div key={i} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg"
                      style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>
                      <span>{r.bank} · {r.nomor} · {r.pemilik} ({r.relasi})</span>
                      <button type="button" style={{ color: "var(--color-red)" }}
                        onClick={() => patch({ rekening: data.rekening.filter((_, j) => j !== i) })}>
                        × Hapus
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: Pendidikan & Spesialisasi ── */}
        {step === 2 && (
          <div className="space-y-5">
            <SectionTitle description="Pastikan seluruh informasi customer telah diisi dengan lengkap dan akurat.">
              Pendidikan, Spesialisasi &amp; Organisasi
            </SectionTitle>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <FieldLabel>Universitas S1</FieldLabel>
                <input className="input-field" placeholder="Pilih Universitas S1"
                  value={data.universitasS1} onChange={(e) => patch({ universitasS1: e.target.value })} />
              </label>
              <div className="flex flex-col gap-1">
                <FieldLabel required>Spesialisasi</FieldLabel>
                <Combobox name="_spesialisasi_pengajuan" value={data.spesialisasi}
                  onChange={(v) => patch({ spesialisasi: v })}
                  placeholder="Pilih Spesialisasi" options={spesOptions} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <FieldLabel>Universitas Spesialisasi</FieldLabel>
                <input className="input-field" placeholder="Pilih Universitas Spesialisasi"
                  value={data.universitasSpesialis} onChange={(e) => patch({ universitasSpesialis: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <FieldLabel>Sub-Spesialisasi</FieldLabel>
                <input className="input-field" placeholder="Pilih Sub-Spesialisasi"
                  value={data.subSpesialisasi} onChange={(e) => patch({ subSpesialisasi: e.target.value })} />
              </label>
            </div>

            {/* Organisasi */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <FieldLabel>Organisasi</FieldLabel>
                <button type="button" onClick={() => setShowOrganisasiModal(true)}
                  className="text-xs font-medium" style={{ color: "var(--color-primary)" }}>
                  + Tambah Organisasi
                </button>
              </div>
              {data.organisasi.length === 0 ? (
                <p className="text-xs text-center py-3" style={{ color: "var(--color-text-faint)" }}>Belum Ada Organisasi</p>
              ) : (
                <div className="space-y-1">
                  {data.organisasi.map((o, i) => (
                    <div key={i} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg"
                      style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>
                      <span>{o.namaOrganisasi}{o.jabatanOrganisasi ? ` · ${o.jabatanOrganisasi}` : ""}</span>
                      <button type="button" style={{ color: "var(--color-red)" }}
                        onClick={() => patch({ organisasi: data.organisasi.filter((_, j) => j !== i) })}>
                        × Hapus
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Step 3: Outlet ── */}
        {step === 3 && (
          <div className="space-y-5">
            <div className="flex items-start justify-between">
              <SectionTitle description="Pastikan seluruh informasi customer telah diisi dengan lengkap dan akurat.">
                Outlet
              </SectionTitle>
              <button type="button" onClick={() => setShowOutletModal(true)}
                className="text-xs font-medium shrink-0" style={{ color: "var(--color-primary)" }}>
                + Tambah Outlet
              </button>
            </div>

            {data.outletsPengajuan.length === 0 ? (
              <p className="text-xs text-center py-6" style={{ color: "var(--color-text-faint)" }}>Belum Ada Outlet</p>
            ) : (
              <div className="space-y-3">
                {data.outletsPengajuan.map((o, i) => (
                  <div key={i} className="rounded-lg border p-3 space-y-2"
                    style={{ borderColor: "var(--color-border)", background: "var(--color-bg-subtle)" }}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{o.namaOutlet}</span>
                      <button type="button" className="text-xs" style={{ color: "var(--color-red)" }}
                        onClick={() => patch({ outletsPengajuan: data.outletsPengajuan.filter((_, j) => j !== i) })}>
                        × Hapus
                      </button>
                    </div>
                    <div className="text-xs space-y-0.5">
                      {HARI_LIST.map((hari) => {
                        const j = o.jadwal[hari];
                        if (!j || j.tidakPraktik) return null;
                        if (!j.mulai && !j.selesai && !j.jumlahPasien) return null;
                        return (
                          <span key={hari} className="inline-flex gap-1 mr-3" style={{ color: "var(--color-text-muted)" }}>
                            <strong>{hari.slice(0, 3)}</strong> {j.mulai}–{j.selesai}
                            {j.jumlahPasien && ` (${j.jumlahPasien} pasien)`}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-5">
        <Button type="button" variant="ghost" size="sm"
          onClick={() => step > 1 ? setStep(step - 1) : router.back()}
          disabled={isPending}>
          Kembali
        </Button>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" size="sm"
            onClick={handleSaveDraft} disabled={isPending}>
            {isPending ? "Menyimpan…" : "Simpan Draft"}
          </Button>
          {step < 3 ? (
            <Button type="button" size="sm" onClick={() => { setError(null); setStep(step + 1); }}>
              Lanjut
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={handleSubmit} disabled={isPending}>
              {isPending ? "Menyimpan…" : "Submit"}
            </Button>
          )}
        </div>
      </div>

      {/* Modals */}
      {showRekeningModal && (
        <RekeningModal
          onClose={() => setShowRekeningModal(false)}
          onAdd={(r) => patch({ rekening: [...data.rekening, r] })}
        />
      )}
      {showOrganisasiModal && (
        <OrganisasiModal
          onClose={() => setShowOrganisasiModal(false)}
          onAdd={(o) => patch({ organisasi: [...data.organisasi, o] })}
        />
      )}
      {showOutletModal && (
        <OutletModal
          outletOptions={outlets}
          onClose={() => setShowOutletModal(false)}
          onAdd={(o) => patch({ outletsPengajuan: [...data.outletsPengajuan, o] })}
        />
      )}
    </div>
  );
}
