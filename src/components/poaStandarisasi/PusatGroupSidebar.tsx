"use client";

/**
 * Panel samping Planning pusat (Data Survey / Produk Rekomendasi / Standarisasi & Historis Sales).
 * Di cabang panel ini per satu outlet; di pusat datanya tetap per outlet, jadi semua outlet pada
 * grup yang dipilih tersedia lewat pemilih outlet (docs/poa-standarisasi-pusat/04-layout-parity.md, Q3).
 * Memakai ulang RekomendasiSidebar cabang apa adanya (tidak dimodifikasi).
 */
import { useEffect, useState } from "react";
import { Combobox } from "@/components/ui/Combobox";
import type { Product } from "@/lib/masterData";
import { RekomendasiSidebar } from "@/components/poaStandarisasi/RekomendasiSidebar";

export function PusatGroupSidebar({
  hkaGroup, outlets, productByKode,
}: {
  hkaGroup: string;
  outlets: { kodePI: string; namaOutlet: string }[];
  productByKode: Map<string, Product>;
}) {
  const [kodePI, setKodePI] = useState("");

  // Grup berganti -> pilih outlet pertama grup baru (outlets dimuat async oleh parent).
  useEffect(() => { setKodePI(outlets[0]?.kodePI ?? ""); }, [hkaGroup, outlets]);

  if (outlets.length === 0) return null;
  return (
    <>
      <div className="mb-4 max-w-lg">
        <span className="text-xs font-medium block mb-1">Data referensi outlet grup {hkaGroup} (panel kanan)</span>
        <Combobox
          name="pusat-sidebar-outlet"
          options={outlets.map((o) => ({ value: o.kodePI, label: o.namaOutlet, sublabel: o.kodePI }))}
          value={kodePI}
          onChange={setKodePI}
          placeholder="Pilih outlet…"
        />
      </div>
      {kodePI && <RekomendasiSidebar kodePI={kodePI} productByKode={productByKode} />}
    </>
  );
}
