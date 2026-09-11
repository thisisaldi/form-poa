"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approvePoaStandarisasiAtasanAction, getPoaStandarisasiDetail, type PoaStandarisasiDetail } from "@/app/actions/poaStandarisasi";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export interface PendingPoaStandarisasiRow {
  id: string;
  ownerName: string;
  namaOutlet: string;
  jumlahProduk: number;
  pendingLevel: "ASM" | "SM" | "NSM";
}

/** Dedicated "tampilan atasan" for POA Standarisasi Phase 2 (2026-09-10 user
 * request) — a simple tick-to-approve list, separate from the MR-facing
 * wizard at /poa-standarisasi/[id] (which stays MR-only, see that page's
 * access note). One row per pengajuan, Setujui/Tolak act on `pendingLevel`
 * (whichever of ASM/SM/NSM is still awaiting action in the sequential
 * chain — see getPendingPoaStandarisasiForAtasanAction). */
export function PoaStandarisasiApprovalSection({ pending }: { pending: PendingPoaStandarisasiRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Record<string, PoaStandarisasiDetail | null>>({});
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);

  function act(id: string, level: "ASM" | "SM" | "NSM", decision: "DISETUJUI" | "DITOLAK") {
    setError(null);
    setActingId(id);
    startTransition(async () => {
      try {
        await approvePoaStandarisasiAtasanAction(id, level, decision);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal memproses approval.");
      }
    });
  }

  function toggleDetail(id: string) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!(id in detailById)) {
      setLoadingDetailId(id);
      getPoaStandarisasiDetail(id)
        .then((detail) => setDetailById((prev) => ({ ...prev, [id]: detail })))
        .finally(() => setLoadingDetailId(null));
    }
  }

  if (pending.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">POA Standarisasi — Menunggu Approval Anda</h2>
      {error && <p className="text-sm" style={{ color: "var(--color-red, #dc2626)" }}>{error}</p>}
      <div className="space-y-2">
        {pending.map((p) => (
          <Card key={p.id}>
            <div className="flex items-center justify-between gap-3 py-1">
              <div>
                <p className="text-sm font-medium">
                  {p.namaOutlet} — {p.ownerName}
                </p>
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                  {p.jumlahProduk} produk · Level: {p.pendingLevel}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" variant="ghost" onClick={() => toggleDetail(p.id)}>
                  {expandedId === p.id ? "Tutup Detail" : "Lihat Detail"}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={isPending && actingId === p.id}
                  onClick={() => act(p.id, p.pendingLevel, "DITOLAK")}
                >
                  Tolak
                </Button>
                <Button
                  size="sm"
                  disabled={isPending && actingId === p.id}
                  onClick={() => act(p.id, p.pendingLevel, "DISETUJUI")}
                  style={{ background: "var(--color-green, #16a34a)", color: "#fff" }}
                >
                  Setujui
                </Button>
              </div>
            </div>
            {expandedId === p.id && (
              <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
                {loadingDetailId === p.id ? (
                  <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Memuat detail…</p>
                ) : (
                  <PoaStandarisasiDetailSummary detail={detailById[p.id] ?? null} />
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function PoaStandarisasiDetailSummary({ detail }: { detail: PoaStandarisasiDetail | null }) {
  if (!detail) {
    return <p className="text-xs" style={{ color: "var(--color-red, #dc2626)" }}>Gagal memuat detail, atau Anda tidak berhak melihat pengajuan ini.</p>;
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div><span style={{ color: "var(--color-text-muted)" }}>Outlet:</span> {detail.outlet.namaOutlet}</div>
        <div><span style={{ color: "var(--color-text-muted)" }}>Kota:</span> {detail.outlet.kota ?? "-"}</div>
        <div><span style={{ color: "var(--color-text-muted)" }}>Tipe:</span> {detail.tipeStandarisasi}</div>
        <div><span style={{ color: "var(--color-text-muted)" }}>Periode (bulan):</span> {detail.periodeBulan ?? "-"}</div>
      </div>

      {detail.kpdmList.length > 0 && (
        <div>
          <p className="text-xs font-medium">KPDM Standarisasi</p>
          <ul className="mt-1 list-disc pl-4 text-xs" style={{ color: "var(--color-text-muted)" }}>
            {detail.kpdmList.map((k) => (
              <li key={k.id}>{k.namaSnapshot}{k.jabatanSnapshot ? ` — ${k.jabatanSnapshot}` : ""}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-xs font-medium">Produk & Dokter Klinis</p>
        <div className="mt-1 space-y-2">
          {detail.produk.map((prod) => (
            <div key={prod.id} className="rounded border px-2.5 py-2" style={{ borderColor: "var(--color-border)" }}>
              <p className="text-xs font-medium">{prod.product.namaProduk} <span style={{ color: "var(--color-text-muted)" }}>({prod.statusPengajuan})</span></p>
              {prod.dokterApproval.length > 0 ? (
                <ul className="mt-1 list-disc pl-4 text-xs" style={{ color: "var(--color-text-muted)" }}>
                  {prod.dokterApproval.map((da) => (
                    <li key={da.id}>{da.customer.namaCustomer}{da.sudahTtd ? " ✓ Sudah TTD" : ""}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>Belum ada dokter.</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
