"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { SURVEY_SUMBER_OPTIONS } from "@/lib/surveySumber";

interface OutletOption {
  kodePI: string;
  namaOutlet: string;
}

interface UploadLogRow {
  id: string;
  namaOutlet: string;
  periode: string;
  namaFile: string;
  driveFileId: string;
  biayaData: number | null;
  sumber: string | null;
  uploadedAt: string;
}

function formatRp(n: number): string {
  return `Rp ${n.toLocaleString("id-ID")}`;
}

/** Same visual language as LineItemEditor.tsx's UnitInput (POA form) — a
 * bordered input with a "Rp" unit suffix — kept local here rather than
 * imported since UnitInput isn't exported and Biaya Data's needs (plain
 * numeric, no stepper) are simpler than its full feature set. */
function RpInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    if (v === "" || /^\d*\.?\d*$/.test(v)) onChange(v);
  }
  return (
    <div className="flex items-stretch rounded-md overflow-hidden"
      style={{ border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }}>
      <span className="flex items-center px-2.5 text-sm shrink-0"
        style={{ color: "var(--color-text-faint)", borderRight: "1px solid var(--color-border-strong)", background: "var(--color-bg-subtle)" }}>
        Rp
      </span>
      <input type="text" inputMode="decimal" placeholder="0"
        value={value}
        onChange={handleChange}
        className="flex-1 min-w-0 w-0 px-2.5 py-1.5 text-sm outline-none"
        style={{ background: "transparent", color: "var(--color-text)" }} />
    </div>
  );
}

const ALLOWED_EXT = [".xlsx", ".xls", ".zip"];
const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/** "Input Data Survey" (2026-08-10, item #10 dari daftar 13 task baru;
 * diperluas 2026-08-13 dengan Biaya Data/Sumber/ZIP — docs/TODO.md #18) — MR
 * pilih outlet + periode + sumber data, upload file (Excel/ZIP), diteruskan
 * ke Google Drive. Lihat docs/survey-pasien-features/. UI dipercantik
 * (2026-08-13) mengikuti pola input form POA: Combobox searchable untuk
 * outlet, unit "Rp" pada Biaya Data. */
export function SurveyUploadForm({ outlets }: { outlets: OutletOption[] }) {
  const [kodePI, setKodePI] = useState("");
  const [periodeYear, setPeriodeYear] = useState(String(new Date().getFullYear()));
  const [periodeMonth, setPeriodeMonth] = useState(String(new Date().getMonth() + 1).padStart(2, "0"));
  const [sumber, setSumber] = useState("");
  const [biayaData, setBiayaData] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [history, setHistory] = useState<UploadLogRow[] | null>(null);

  async function loadHistory() {
    try {
      const res = await fetch("/api/survey/upload");
      if (res.ok) setHistory(await res.json());
    } catch {
      // best-effort — riwayat cuma nice-to-have, tidak boleh mengganggu form utama
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadHistory(); }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (f) {
      const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
      if (!ALLOWED_EXT.includes(ext)) {
        setFileError("File harus berformat .xlsx, .xls, atau .zip.");
        setFile(null);
        e.target.value = "";
        return;
      }
    }
    setFileError(null);
    setFile(f);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!kodePI || !file) return;
    setPending(true);
    setMessage(null);
    try {
      const fd = new FormData();
      fd.set("kodePI", kodePI);
      fd.set("periode", `${periodeYear}${periodeMonth}`);
      if (sumber) fd.set("sumber", sumber);
      if (biayaData) fd.set("biayaData", biayaData);
      fd.set("file", file);
      const res = await fetch("/api/survey/upload", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) {
        if (body.detail) console.error("[survey upload]", body.detail);
        setMessage({ text: body.error ?? "Upload gagal.", type: "error" });
      } else {
        setMessage({ text: `Berhasil diupload: ${body.namaFile}`, type: "success" });
        setFile(null);
        setBiayaData("");
        setSumber("");
        const input = document.getElementById("survey-file-input") as HTMLInputElement | null;
        if (input) input.value = "";
        loadHistory();
      }
    } catch {
      setMessage({ text: "Upload gagal, coba lagi.", type: "error" });
    } finally {
      setPending(false);
    }
  }

  const currentYear = new Date().getFullYear();
  const years = [currentYear - 1, currentYear, currentYear + 1].map(String);
  const outletOptions = outlets.map((o) => ({ value: o.kodePI, label: o.namaOutlet }));
  const monthOptions = MONTH_NAMES.map((label, i) => ({ value: String(i + 1).padStart(2, "0"), label: `${String(i + 1).padStart(2, "0")} - ${label}` }));
  const yearOptions = years.map((y) => ({ value: y, label: y }));
  const sumberOptions = SURVEY_SUMBER_OPTIONS.map((s) => ({ value: s, label: s }));

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1>Input Data Survey</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Upload file data survey — file akan diteruskan ke shared drive tim.
        </p>
      </div>

      <p className="text-xs px-3 py-2 rounded-md" style={{ color: "var(--color-blue)", background: "var(--color-blue-light, #eff6ff)" }}>
        Tolong cari data flashdisk (bisa dari Peresepan / Pembelian / RME), bisa dari Pembelian / IT / Gudang / Depo.
      </p>

      <Card>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Plain <div> wrappers, NOT <label> — a <label> forwards clicks to
              its first control, which refocuses the Combobox's text input
              right after an option click closes it (native browser
              label-activation behavior), immediately reopening the list.
              Bug reported 2026-08-13; LineItemEditor.tsx's own Combobox
              usages already avoid this by using <div>, not <label>. */}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>Nama RS / Outlet</span>
            <Combobox
              name="kodePI"
              options={outletOptions}
              value={kodePI}
              onChange={setKodePI}
              placeholder="Cari outlet…"
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>Periode</span>
            <div className="flex gap-3">
              <div className="flex-1">
                <Combobox name="periodeMonth" options={monthOptions} value={periodeMonth} onChange={setPeriodeMonth} required />
              </div>
              <div className="flex-1">
                <Combobox name="periodeYear" options={yearOptions} value={periodeYear} onChange={setPeriodeYear} required />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
              Sumber <span className="font-normal" style={{ color: "var(--color-text-faint)" }}>(opsional)</span>
            </span>
            <Combobox name="sumber" options={sumberOptions} value={sumber} onChange={setSumber} placeholder="Pilih sumber…" />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
              Biaya Data <span className="font-normal" style={{ color: "var(--color-text-faint)" }}>(opsional)</span>
            </span>
            <RpInput value={biayaData} onChange={setBiayaData} />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>File</span>
            <input
              id="survey-file-input"
              type="file"
              accept=".xlsx,.xls,.zip"
              onChange={handleFileChange}
              className="input-field"
              required
            />
            <p className="text-xs" style={{ color: fileError ? "var(--color-red)" : "var(--color-text-faint)" }}>
              {fileError ?? "Format .xlsx/.xls/.zip, maksimum 50 MB."}
            </p>
          </div>

          {message && (
            <p className="text-sm px-3 py-2 rounded-md"
              style={{
                background: message.type === "error" ? "var(--color-red-light)" : "var(--color-green-light)",
                color: message.type === "error" ? "var(--color-red)" : "var(--color-green)",
              }}>
              {message.text}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <Button type="submit" disabled={pending || !kodePI || !file || !!fileError}>
              {pending ? "Mengupload…" : "Upload"}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat Upload Saya</CardTitle>
        </CardHeader>
        {!history ? (
          <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Memuat…</p>
        ) : history.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Belum ada riwayat upload.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <th className="text-left py-1.5 px-2 font-medium" style={{ color: "var(--color-text-faint)" }}>Outlet</th>
                  <th className="text-left py-1.5 px-2 font-medium" style={{ color: "var(--color-text-faint)" }}>Periode</th>
                  <th className="text-left py-1.5 px-2 font-medium" style={{ color: "var(--color-text-faint)" }}>Sumber</th>
                  <th className="text-right py-1.5 px-2 font-medium" style={{ color: "var(--color-text-faint)" }}>Biaya Data</th>
                  <th className="text-left py-1.5 px-2 font-medium" style={{ color: "var(--color-text-faint)" }}>Waktu Upload</th>
                  <th className="text-left py-1.5 px-2 font-medium" style={{ color: "var(--color-text-faint)" }}>File</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <td className="py-1.5 px-2" style={{ color: "var(--color-text)" }}>{h.namaOutlet}</td>
                    <td className="py-1.5 px-2" style={{ color: "var(--color-text)" }}>{h.periode}</td>
                    <td className="py-1.5 px-2" style={{ color: "var(--color-text-muted)" }}>{h.sumber ?? "-"}</td>
                    <td className="py-1.5 px-2 text-right" style={{ color: "var(--color-text-muted)" }}>
                      {h.biayaData != null ? formatRp(h.biayaData) : "-"}
                    </td>
                    <td className="py-1.5 px-2" style={{ color: "var(--color-text-muted)" }}>{new Date(h.uploadedAt).toLocaleString("id-ID")}</td>
                    <td className="py-1.5 px-2">
                      <a href={`https://drive.google.com/file/d/${h.driveFileId}/view`} target="_blank" rel="noreferrer"
                        style={{ color: "var(--color-blue)" }}>
                        Buka
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
