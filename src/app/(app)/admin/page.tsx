import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getCustomers } from "@/lib/masterData";
import { AdminTabs } from "@/components/admin/AdminTabs";

export const metadata = { title: "Admin · Form POA" };

export default async function AdminPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/dashboard");

  const customers = await getCustomers();
  const outlets = customers
    .filter((c) => c.kodePI != null)
    .map((c) => ({ kodePI: c.kodePI as string, namaOutlet: c.namaOutlet, groupRS: c.groupRS ?? null }));

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1>Admin</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Tambah data master — user staff, outlet, user (dokter) dengan spesialisasi, dan produk.
        </p>
      </div>
      <AdminTabs outlets={outlets} />
    </div>
  );
}
