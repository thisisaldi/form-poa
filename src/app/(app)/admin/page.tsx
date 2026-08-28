import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getCustomers } from "@/lib/masterData";
import { prisma } from "@/lib/prisma";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { MaintenanceModeToggle } from "@/components/admin/MaintenanceModeToggle";
import { PoaDoctorsApiCredentialPanel } from "@/components/admin/PoaDoctorsApiCredentialPanel";
import { GoogleDriveConfigPanel } from "@/components/admin/GoogleDriveConfigPanel";

export const metadata = { title: "Admin · Form POA" };

const BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function formatPeriode(periode: string): string {
  const m = periode.match(/^(\d{4})(\d{2})$/);
  if (!m) return periode;
  const [, year, month] = m;
  const label = BULAN_ID[parseInt(month, 10) - 1];
  return label ? `${label} ${year}` : periode;
}

export default async function AdminPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/dashboard");

  const [customers, orgStrukturMeta] = await Promise.all([
    getCustomers(),
    prisma.orgStrukturMeta.findUnique({ where: { id: 1 } }),
  ]);
  const outlets = customers
    .filter((c) => c.kodePI != null)
    .map((c) => ({ kodePI: c.kodePI as string, namaOutlet: c.namaOutlet, groupRS: c.groupRS ?? null }));

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1>Admin</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Tambah data master - user staff, outlet, user (dokter) dengan spesialisasi, dan produk.
        </p>
        {orgStrukturMeta && (
          <p className="mt-1.5 text-xs" style={{ color: "var(--color-text-faint)" }}>
            Struktur organisasi: <strong>{formatPeriode(orgStrukturMeta.periode)}</strong>
            {" "}(diupdate {orgStrukturMeta.importedAt.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
            {" "}dari {orgStrukturMeta.sourceFile})
          </p>
        )}
      </div>
      <MaintenanceModeToggle />
      <PoaDoctorsApiCredentialPanel />
      <GoogleDriveConfigPanel />
      <AdminTabs outlets={outlets} />
    </div>
  );
}
