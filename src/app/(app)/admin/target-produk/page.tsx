import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { Card } from "@/components/ui/Card";
import { TargetProdukForm } from "@/components/admin/TargetProdukForm";

export const metadata = { title: "Simulasi Target Produk · Form POA" };

export default async function TargetProdukPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (session.role !== "NSM" && session.role !== "ADMIN") redirect("/dashboard");

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1>Simulasi Target Produk Fokus per Kuartal</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Target quantity &amp; value per SM/NSM untuk semua produk fokus — ratio sales historis + pemerataan
          produktivitas, mengikuti metodologi &ldquo;Turunan Target Produk&rdquo;.
        </p>
      </div>

      <Card>
        <TargetProdukForm />
      </Card>
    </div>
  );
}
