"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export default function CustomerNewPage() {
  const router = useRouter();

  return (
    <div className="max-w-2xl mx-auto py-16 px-4">
      <div className="rounded-xl border p-10 flex flex-col items-center text-center gap-3"
        style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}>
        <span className="text-4xl">🚧</span>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-text)" }}>
          Segera Hadir
        </h1>
        <p className="text-sm max-w-md" style={{ color: "var(--color-text-muted)" }}>
          Fitur Daftar Dokter Baru masih dalam pengembangan dan belum dapat digunakan.
        </p>
        <Button type="button" size="sm" className="mt-4" onClick={() => router.back()}>
          Kembali
        </Button>
      </div>
    </div>
  );
}
