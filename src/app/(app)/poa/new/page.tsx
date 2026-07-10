import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { createPoaAction } from "@/app/actions/poa";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";

export const metadata = { title: "Buat POA Baru · POA System" };

export default async function NewPoaPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (session.role !== "MR") redirect("/dashboard");

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h1>Buat POA Baru</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Tentukan periode terlebih dahulu. Konten form dapat diisi setelah draft dibuat.
        </p>
      </div>

      <Card>
        <form action={createPoaAction} className="flex flex-col gap-4">
          <Input
            name="period"
            label="Periode"
            placeholder="Contoh: 2026-07"
            hint="Format: YYYY-MM (bulanan) atau YYYY-Q1 (kuartalan). Disesuaikan dengan kebutuhan."
            required
            autoFocus
          />
          <div className="flex gap-3 pt-1">
            <Button type="submit">Buat Draft</Button>
            <Link href="/dashboard">
              <Button type="button" variant="secondary">Batal</Button>
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
