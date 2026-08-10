"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

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
  uploadedAt: string;
}

/** "Input Data Survey" (2026-08-10, item #10 dari daftar 13 task baru) — MR
 * pilih outlet + periode, upload file Excel, diteruskan ke Google Drive.
 * Lihat docs/survey-pasien-features/. */
export function SurveyUploadForm({ outlets }: { outlets: OutletOption[] }) {
  const [kodePI, setKodePI] = useState("");
  const [periodeYear, setPeriodeYear] = useState(String(new Date().getFullYear()));
  const [periodeMonth, setPeriodeMonth] = useState(String(new Date().getMonth() + 1).padStart(2, "0"));
  const [file, setFile] = useState<File | null>(null);
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!kodePI || !file) return;
    setPending(true);
    setMessage(null);
    try {
      const fd = new FormData();
      fd.set("kodePI", kodePI);
      fd.set("periode", `${periodeYear}${periodeMonth}`);
      fd.set("file", file);
      const res = await fetch("/api/survey/upload", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) {
        setMessage({ text: body.error ?? "Upload gagal.", type: "error" });
      } else {
        setMessage({ text: `Berhasil diupload: ${body.namaFile}`, type: "success" });
        setFile(null);
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
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1>Input Data Survey</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Upload file Excel data survey — file akan diteruskan ke shared drive tim.
        </p>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>Nama RS / Outlet</span>
            <select value={kodePI} onChange={(e) => setKodePI(e.target.value)} className="input-field" required>
              <option value="">Pilih outlet…</option>
              {outlets.map((o) => (
                <option key={o.kodePI} value={o.kodePI}>{o.namaOutlet}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>Periode</span>
            <div className="flex gap-3">
              <select value={periodeMonth} onChange={(e) => setPeriodeMonth(e.target.value)} className="input-field flex-1" required>
                {months.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select value={periodeYear} onChange={(e) => setPeriodeYear(e.target.value)} className="input-field flex-1" required>
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>File Excel</span>
            <input
              id="survey-file-input"
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="input-field"
              required
            />
            <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Format .xlsx/.xls, maksimum 50 MB.</p>
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
            <Button type="submit" disabled={pending || !kodePI || !file}>
              {pending ? "Mengupload…" : "Upload"}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <p className="text-sm font-semibold mb-3" style={{ color: "var(--color-text)" }}>Riwayat Upload Saya</p>
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
                  <th className="text-left py-1.5 px-2 font-medium" style={{ color: "var(--color-text-faint)" }}>Waktu Upload</th>
                  <th className="text-left py-1.5 px-2 font-medium" style={{ color: "var(--color-text-faint)" }}>File</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <td className="py-1.5 px-2" style={{ color: "var(--color-text)" }}>{h.namaOutlet}</td>
                    <td className="py-1.5 px-2" style={{ color: "var(--color-text)" }}>{h.periode}</td>
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
