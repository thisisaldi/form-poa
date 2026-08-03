import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Sidebar } from "@/components/layout/Sidebar";
import { MaintenanceScreen } from "@/components/layout/MaintenanceScreen";
import { getMaintenanceState, maintenanceMessage } from "@/lib/maintenance";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session.isLoggedIn) redirect("/login");

  // Validate the userId still exists — guards against stale cookies after switching
  // between real DB and mock mode, or after a user is deactivated.
  // Layouts can't modify cookies directly, so we redirect to the logout route
  // which clears the session cookie as a Route Handler.
  const user = await prisma.user.findUnique({ where: { nip: session.userId } });
  if (!user || !user.isActive) {
    redirect("/api/auth/logout");
  }

  // Site-wide maintenance lockout (2026-07-31) — every (app) route funnels
  // through this one layout, so gating here blocks navigation everywhere at
  // once rather than needing a check per page. ADMIN is exempt so they can
  // still reach /admin to turn it back off; every other role sees ONLY this
  // screen no matter what URL they hit.
  //
  // viewOnly (2026-08-03) is a softer sibling — non-ADMIN roles keep normal
  // navigation/read access here (just a banner below), the actual write
  // block happens per mutation via isWriteBlocked/assertWritable in
  // src/lib/maintenance.ts, called from every "use server" write action.
  let viewOnlyBanner: string | null = null;
  if (session.role !== "ADMIN") {
    const maintenance = await getMaintenanceState();
    if (maintenance.enabled) {
      return <MaintenanceScreen message={maintenanceMessage(maintenance)} />;
    }
    if (maintenance.viewOnly) {
      viewOnlyBanner = maintenance.message?.trim() ||
        "Sistem sedang mode view-only untuk maintenance/migrasi data. Anda masih bisa melihat semua halaman, tapi perubahan data (submit, approve, edit, dst) sementara dinonaktifkan.";
    }
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--color-bg)" }}>
      <Sidebar
        userRole={session.role}
        userJabatan={user.jabatan}
        userName={session.name}
        userNip={session.nip}
      />
      {/* pt-14 accounts for the fixed mobile top bar; md:pt-0 removes it on desktop */}
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-8">
          {viewOnlyBanner && (
            <div className="mb-4 rounded-md px-4 py-3 text-sm font-medium"
              style={{ background: "var(--color-warning-bg, #fef3c7)", color: "var(--color-warning, #f59e0b)" }}>
              🛠️ {viewOnlyBanner}
            </div>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
