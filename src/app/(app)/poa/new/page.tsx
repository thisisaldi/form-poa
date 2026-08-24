"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createPoaAction } from "@/app/actions/poa";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default function NewPoaPage() {
  const router = useRouter();
  const currentMonth = new Date().getMonth();
  const defaultQuarter = `Q${Math.floor(currentMonth / 3) + 1}`;
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [quarter, setQuarter] = useState(defaultQuarter);
  const [pending, setPending] = useState(false);

  const currentYear = new Date().getFullYear();
  const years = [currentYear - 1, currentYear, currentYear + 1].map(String);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const fd = new FormData();
    fd.set("period", `${year}-${quarter}`);
    await createPoaAction(fd);
    // createPoaAction redirects — if we get here something failed
    router.push("/dashboard");
  }

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h1>Buat POA Baru</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Tentukan periode terlebih dahulu. Konten form dapat diisi setelah draft dibuat.
        </p>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>Periode</span>
            <div className="flex gap-3">
              <select
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="input-field flex-1"
                required
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <select
                value={quarter}
                onChange={(e) => setQuarter(e.target.value)}
                className="input-field flex-1"
                required
              >
                <option value="Q1">Q1 (Jan - Mar)</option>
                <option value="Q2">Q2 (Apr - Jun)</option>
                <option value="Q3">Q3 (Jul - Sep)</option>
                <option value="Q4">Q4 (Okt - Des)</option>
              </select>
            </div>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-text-faint)" }}>
              Periode POA: <strong>{year}-{quarter}</strong>
            </p>
          </div>

          <div className="flex gap-3 pt-1">
            <Button type="submit" disabled={pending}>
              {pending ? "Membuat…" : "Buat Draft"}
            </Button>
            <Link href="/dashboard">
              <Button type="button" variant="secondary">Batal</Button>
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
