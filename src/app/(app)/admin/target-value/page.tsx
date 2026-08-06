import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { Card } from "@/components/ui/Card";
import { TargetHospitalValueForm } from "@/components/admin/TargetHospitalValueForm";

export const metadata = { title: "Target Value · Form POA" };

export default async function TargetValuePage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (session.role !== "NSM" && session.role !== "ADMIN") redirect("/dashboard");

  return (
    <div className="max-w-6xl space-y-5">
      <div>
        <h1>Target Value per Hospital (GT)</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Target penjualan Rupiah bulanan per GT (Agu-Des 2026), dari &ldquo;Target Hospital (in Value).xlsx&rdquo;.
          Ini target value keseluruhan, bukan target produk kontes — lihat halaman{" "}
          <a href="/admin/target-produk" style={{ color: "var(--color-blue)" }}>Target Produk Kontes</a> untuk itu.
          NSM hanya melihat/mengubah GT di struktur sendiri; Admin melihat semua.
        </p>
      </div>

      <Card>
        <TargetHospitalValueForm />
      </Card>
    </div>
  );
}
