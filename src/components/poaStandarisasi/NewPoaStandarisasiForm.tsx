"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import type { Product } from "@/lib/masterData";
import type { CustomerOption } from "@/app/actions/customer";
import { createCustomerAction } from "@/app/actions/customer";
import {
  createPoaStandarisasiAction,
  getDokterOptionsAction,
  type PlanningProdukInput,
} from "@/app/actions/poaStandarisasi";
import {
  Stepper,
  PlanningPhase,
  emptyProduk,
  type ProdukFormState,
} from "@/components/poaStandarisasi/PoaStandarisasiWizard";

/**
 * Outlet is the top field of the SAME Planning Standarisasi form as Phase 1
 * of the real wizard (reuses <PlanningPhase>) — not a separate outlet-only
 * pre-step. Outlet still has to exist before the pengajuan row does (it's a
 * non-null FK), so submitting here creates the row AND saves everything else
 * (KPDM, jabatan, tipe, produk, dokter klinis) in one shot, then redirects
 * into the same wizard at /poa-standarisasi/[id] (2026-08-19 redesign).
 */
export function NewPoaStandarisasiForm({
  outletOptions,
  productOptions,
}: {
  outletOptions: { value: string; label: string; sublabel?: string }[];
  productOptions: Product[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [kodePI, setKodePI] = useState("");
  const [dokterList, setDokterList] = useState<CustomerOption[]>([]);

  // KPDM is a customer/dokter at the selected outlet (Nexus-backed, same
  // dokterList as Dokter Klinis) — not a separate master-data entity.
  // Jabatan is derived from that customer's spesialisasi, read-only.
  const [kpdmId, setKpdmId] = useState("");
  const [kpdmNama, setKpdmNama] = useState("");
  const [jabatanNama, setJabatanNama] = useState("");
  const [kpdmEntertainEstimasi, setKpdmEntertainEstimasi] = useState("");
  const [tipeStandarisasi, setTipeStandarisasi] = useState<"PERIODIC" | "SISIPAN" | "PERMANEN">("PERIODIC");
  const [periodeBulan, setPeriodeBulan] = useState("");
  const [jumlahBedRs, setJumlahBedRs] = useState("");
  const [estimasiTimelineSelesai, setEstimasiTimelineSelesai] = useState("");
  const [produkList, setProdukList] = useState<ProdukFormState[]>([emptyProduk()]);

  const dokterById = new Map(dokterList.map((d) => [d.id, d]));
  const productByKode = new Map(productOptions.map((p) => [p.kodeProduk, p]));

  async function handleKodePIChange(v: string) {
    setKodePI(v);
    setDokterList(v ? await getDokterOptionsAction(v) : []);
    // Outlet changed — the previously selected KPDM (a customer at the OLD outlet) no longer applies.
    setKpdmId(""); setKpdmNama(""); setJabatanNama("");
  }

  /** Materializes a "nexus:<...>" synthetic id into a real Customer row before it's used as a FK — same pattern as the real wizard's resolveDokterId. */
  async function resolveDokterId(rawId: string): Promise<string> {
    if (!rawId.startsWith("nexus:")) return rawId;
    const opt = dokterById.get(rawId);
    if (!opt || !kodePI) return rawId;
    const fd = new FormData();
    fd.set("namaCustomer", opt.namaCustomer);
    fd.set("spesialisasi", opt.spesialisasi);
    fd.set("kodePI", kodePI);
    if (opt.kodeCustomer) fd.set("kodeCustomer", opt.kodeCustomer);
    const res = await createCustomerAction(fd);
    if (!res.ok || !res.customerId) throw new Error(res.error ?? "Gagal mendaftarkan dokter.");
    setDokterList((prev) => prev.map((d) => (d.id === rawId ? { ...d, id: res.customerId! } : d)));
    return res.customerId;
  }

  async function handleSelectKpdm(rawId: string) {
    if (!rawId) { setKpdmId(""); setKpdmNama(""); setJabatanNama(""); return; }
    const opt = dokterById.get(rawId);
    const realId = await resolveDokterId(rawId);
    setKpdmId(realId);
    if (opt) {
      setKpdmNama(opt.namaCustomer);
      setJabatanNama(opt.spesialisasi);
    }
  }

  function updateProduk(idx: number, patch: Partial<ProdukFormState>) {
    setProdukList((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
  function addProduk() {
    setProdukList((prev) => [...prev, emptyProduk(prev[prev.length - 1])]);
  }
  function removeProduk(idx: number) {
    setProdukList((prev) => prev.filter((_, i) => i !== idx));
  }
  async function addDokterToProduk(idx: number, rawId: string) {
    if (!rawId) return;
    const realId = await resolveDokterId(rawId);
    setProdukList((prev) =>
      prev.map((p, i) =>
        i === idx && !p.dokterKlinis.some((dk) => dk.customerId === realId)
          ? { ...p, dokterKlinis: [...p.dokterKlinis, { customerId: realId, jumlahPasien: "", resepPerPasienSt: "", entertainRp: "" }] }
          : p
      )
    );
  }
  function removeDokterFromProduk(idx: number, customerId: string) {
    setProdukList((prev) => prev.map((p, i) => (i === idx ? { ...p, dokterKlinis: p.dokterKlinis.filter((dk) => dk.customerId !== customerId) } : p)));
  }
  function updateDokterKlinis(idx: number, customerId: string, patch: Partial<{ jumlahPasien: string; resepPerPasienSt: string; entertainRp: string }>) {
    setProdukList((prev) =>
      prev.map((p, i) =>
        i === idx ? { ...p, dokterKlinis: p.dokterKlinis.map((dk) => (dk.customerId === customerId ? { ...dk, ...patch } : dk)) } : p
      )
    );
  }

  function handleSubmit() {
    if (!kodePI) { setError("Outlet wajib dipilih."); return; }
    if (!kpdmId) { setError("KPDM wajib dipilih."); return; }
    setError(null);
    startTransition(async () => {
      try {
        await createPoaStandarisasiAction({
          kodePI,
          kpdmId,
          kpdmNama,
          jabatanNama: jabatanNama || null,
          kpdmEntertainEstimasi: kpdmEntertainEstimasi || null,
          tipeStandarisasi,
          periodeBulan: tipeStandarisasi === "PERMANEN" ? null : periodeBulan || null,
          jumlahBedRs: jumlahBedRs || null,
          estimasiTimelineSelesai: estimasiTimelineSelesai || null,
          produk: produkList
            .filter((p) => p.kodeProduk)
            .map(
              (p): PlanningProdukInput => ({
                id: p.id,
                kodeProduk: p.kodeProduk,
                estimasiDiskonPct: p.estimasiDiskonPct || null,
                estimasiBiayaListingRp: p.estimasiBiayaListingRp || null,
                dokterKlinis: p.dokterKlinis.map((dk) => ({
                  customerId: dk.customerId,
                  jumlahPasien: dk.jumlahPasien || null,
                  resepPerPasienSt: dk.resepPerPasienSt || null,
                  entertainRp: dk.entertainRp || null,
                })),
              })
            ),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Terjadi kesalahan.");
      }
    });
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-4">
        <h1>Pengajuan Standarisasi Baru</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          POA Standarisasi (Produk × Outlet) — wizard 5 phase.
        </p>
      </div>

      <Stepper currentIdx={0} />

      {error && (
        <div className="mb-4 rounded px-3 py-2 text-sm" style={{ background: "var(--color-error-bg, #FDECEA)", color: "var(--color-error)" }}>
          {error}
        </div>
      )}

      <PlanningPhase
        canEdit={true}
        kodePI={kodePI}
        namaOutlet=""
        outletPicker={{ options: outletOptions, onChange: handleKodePIChange }}
        kpdmId={kpdmId}
        onSelectKpdm={handleSelectKpdm}
        jabatanNama={jabatanNama}
        kpdmEntertainEstimasi={kpdmEntertainEstimasi}
        setKpdmEntertainEstimasi={setKpdmEntertainEstimasi}
        tipeStandarisasi={tipeStandarisasi}
        setTipeStandarisasi={setTipeStandarisasi}
        periodeBulan={periodeBulan}
        setPeriodeBulan={setPeriodeBulan}
        jumlahBedRs={jumlahBedRs}
        setJumlahBedRs={setJumlahBedRs}
        estimasiTimelineSelesai={estimasiTimelineSelesai}
        setEstimasiTimelineSelesai={setEstimasiTimelineSelesai}
        produkList={produkList}
        productOptions={productOptions}
        productByKode={productByKode}
        dokterList={dokterList}
        dokterById={dokterById}
        updateProduk={updateProduk}
        addProduk={addProduk}
        removeProduk={removeProduk}
        addDokterToProduk={addDokterToProduk}
        removeDokterFromProduk={removeDokterFromProduk}
        updateDokterKlinis={updateDokterKlinis}
      />

      <div className="flex gap-3 pt-1">
        <Button type="button" disabled={pending || !kodePI || !kpdmId} onClick={handleSubmit}>
          {pending ? "Membuat…" : "Buat & Simpan"}
        </Button>
        <Link href="/poa-standarisasi">
          <Button type="button" variant="secondary">Batal</Button>
        </Link>
      </div>
    </div>
  );
}
