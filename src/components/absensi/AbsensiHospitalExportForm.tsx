"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const toYmd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function AbsensiHospitalExportForm() {
  const today = new Date();
  const [start, setStart] = useState(toYmd(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [end, setEnd] = useState(toYmd(today));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/absensi-hospital/export?start=${start}&end=${end}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `Gagal (${res.status})`);
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `Absensi_Hospital_${start}_${end}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Gagal terhubung ke server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Input type="date" label="Dari tanggal" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
        <Input type="date" label="Sampai tanggal" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        <Button onClick={download} loading={loading} disabled={!start || !end}>
          Download Excel
        </Button>
      </div>
      <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
        Rentang maksimal 1 bulan. Proses bisa makan waktu sekitar 30 detik karena data ditarik langsung dari SIPP. Kolom keterangan hanya berisi
        &quot;Telat&quot;. Izin dan cuti belum tersedia dari SIPP.
      </p>
      {error && (
        <p className="text-sm" style={{ color: "var(--color-error)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
