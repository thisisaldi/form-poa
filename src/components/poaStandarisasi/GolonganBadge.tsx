"use client";

import { useEffect, useState } from "react";
import { getGolonganSaatIniAction } from "@/app/actions/poaStandarisasi";

/** "Golongan yang Dipakai Saat Ini" for one dokter × produk — resolved Q1
 * (docs/poa-standarisasi/01-business-rules.md §7): per dokter, same function
 * that backs "Produk Kompetitor Utama" in the POA Estimasi form. */
export function GolonganBadge({ kodeCustomer, kodePI, kodeProduk }: { kodeCustomer: string; kodePI: string; kodeProduk: string }) {
  const hasDeps = !!kodeCustomer && !!kodePI && !!kodeProduk;
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [kompetitor, setKompetitor] = useState<{ namaProduk: string; pct: number }[]>([]);

  useEffect(() => {
    if (!hasDeps) return;
    let cancelled = false;
    getGolonganSaatIniAction(kodeCustomer, kodePI, kodeProduk)
      .then((info) => {
        if (cancelled) return;
        setKompetitor(info?.kompetitor ?? []);
        setState("done");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [hasDeps, kodeCustomer, kodePI, kodeProduk]);

  if (!hasDeps) {
    return null;
  }
  if (state === "loading") {
    return <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>Memuat data survey…</span>;
  }
  if (state === "error") {
    return <span className="text-xs" style={{ color: "var(--color-text-faint)" }}>Gagal memuat data survey.</span>;
  }
  if (kompetitor.length === 0) {
    return null;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {kompetitor.map((k, i) => (
        <span
          key={i}
          className="text-xs px-1.5 py-0.5 rounded"
          style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}
        >
          {k.namaProduk} ({k.pct}%)
        </span>
      ))}
    </span>
  );
}
