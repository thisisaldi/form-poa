import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Sidebar } from "@/components/layout/Sidebar";

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
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-8">{children}</div>
      </main>
    </div>
  );
}
