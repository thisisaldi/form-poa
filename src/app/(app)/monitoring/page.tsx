import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { Card } from "@/components/ui/Card";

export const metadata = { title: "Monitoring · POA System" };

export default async function MonitoringPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  if (session.role === "MR") redirect("/dashboard");

  return (
    <div className="space-y-5">
      <div>
        <h1>Monitoring</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Rekapitulasi dan monitoring POA seluruh wilayah
        </p>
      </div>

      <Card>
        <div className="py-16 text-center">
          {/* Placeholder illustration */}
          <div
            className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-xl"
            style={{ background: "var(--color-bg-subtle)" }}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-8 w-8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              style={{ color: "var(--color-text-faint)" }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5l4-4 3 3 5-5 4 4" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 20h18M3 4h18" />
            </svg>
          </div>
          <h2 className="text-base font-semibold" style={{ color: "var(--color-text)" }}>
            Monitoring — Segera Hadir
          </h2>
          <p className="mt-2 max-w-sm mx-auto text-sm" style={{ color: "var(--color-text-muted)" }}>
            Halaman ini akan menampilkan rekapitulasi status POA, pencapaian target,
            dan grafik kinerja. Kolom-kolom akan didefinisikan setelah skema form POA selesai.
          </p>
        </div>
      </Card>
    </div>
  );
}
