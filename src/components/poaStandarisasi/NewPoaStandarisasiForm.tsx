"use client";

import Link from "next/link";
import { useState } from "react";
import { Combobox } from "@/components/ui/Combobox";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { createPoaStandarisasiAction } from "@/app/actions/poaStandarisasi";

export function NewPoaStandarisasiForm({ outletOptions }: { outletOptions: { value: string; label: string }[] }) {
  const [kodePI, setKodePI] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!kodePI) return;
    setPending(true);
    const fd = new FormData();
    fd.set("kodePI", kodePI);
    await createPoaStandarisasiAction(fd);
    setPending(false);
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
            Nama Outlet <span style={{ color: "var(--color-error)" }}>*</span>
          </span>
          <Combobox
            name="kodePI"
            options={outletOptions}
            value={kodePI}
            onChange={setKodePI}
            placeholder="Cari outlet…"
            required
            emptyMessage="Tidak ada outlet di coverage Anda."
          />
        </div>

        <div className="flex gap-3 pt-1">
          <Button type="submit" disabled={pending || !kodePI}>
            {pending ? "Membuat…" : "Buat Draft"}
          </Button>
          <Link href="/dashboard">
            <Button type="button" variant="secondary">Batal</Button>
          </Link>
        </div>
      </form>
    </Card>
  );
}
