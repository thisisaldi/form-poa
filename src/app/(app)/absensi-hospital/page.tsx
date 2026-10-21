import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { Card } from "@/components/ui/Card";
import { AbsensiHospitalExportForm } from "@/components/absensi/AbsensiHospitalExportForm";

export const metadata = { title: "Absensi Hospital · Form POA" };

/** Download Excel absensi SIPP divisi Hospital — SFE/ADMIN (lihat /api/absensi-hospital/export). */
export default async function AbsensiHospitalPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (session.role !== "SFE" && session.role !== "ADMIN") redirect("/dashboard");

  return (
    <div className="space-y-5">
      <div>
        <h1>Absensi Hospital</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Data absen dari SIPP untuk semua orang di struktur Hospital, termasuk yang sudah nonaktif. NIP lama orang yang sama ikut digabung.
        </p>
      </div>
      <Card>
        <AbsensiHospitalExportForm />
      </Card>
    </div>
  );
}
