"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approvePoaStandarisasiAtasanAction } from "@/app/actions/poaStandarisasi";
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
          </Card>
        ))}
      </div>
    </div>
  );
}
