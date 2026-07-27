import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { Card } from "@/components/ui/Card";
import { TargetProdukForm } from "@/components/admin/TargetProdukForm";
import { TargetAllocationDrilldown } from "@/components/admin/TargetAllocationDrilldown";

export const metadata = { title: "Target Produk Fokus · Form POA" };

export default async function TargetProdukPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (session.role !== "NSM" && session.role !== "ADMIN") redirect("/dashboard");

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1>Target Produk Fokus per Kuartal</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Atur target quantity per produk fokus secara manual, bertingkat: NSM → Area (SM) → ASM → MR.
          Set total NSM dulu, lalu alokasikan ke Area di bawahnya, lalu ke ASM, lalu ke MR - baru terapkan ke draft POA.
        </p>
      </div>

      <Card>
        <TargetAllocationDrilldown />
      </Card>

      <div>
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Simulasi Algoritma (referensi lama)</h2>
        <p className="mt-1 text-xs" style={{ color: "var(--color-text-faint)" }}>
          Perhitungan otomatis dari ratio sales historis + pemerataan produktivitas - dipertahankan sebagai
          pembanding, tapi target di atas (alokasi manual) yang sekarang jadi acuan utama.
        </p>
      </div>
      <Card>
        <TargetProdukForm />
      </Card>
    </div>
  );
}
