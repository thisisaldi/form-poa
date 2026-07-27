import { redirect } from "next/navigation";
import Link from "next/link";
import type { PoaLineItem } from "@prisma/client";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getPendingActionFilter } from "@/lib/authz";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ApprovalsChecklist, type PendingPoaRow } from "@/components/poa/ApprovalsChecklist";
import { getActivePsspByCustomers } from "@/app/actions/customer";
import { displayRole } from "@/lib/role";

export const metadata = { title: "Persetujuan · Form POA" };

export default async function ApprovalsPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  if (session.role === "MR") redirect("/dashboard");

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  const filter = getPendingActionFilter(actor);

  const pending = await prisma.poaForm.findMany({
    where: filter,
    include: {
      owner: true,
      items: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { updatedAt: "asc" },
  });

  const activePssp = await getActivePsspByCustomers(
    (pending as PendingPoaRow[])
      .flatMap((p) => p.items.map((it: PoaLineItem) => it.kodeCust))
      .filter((v: string | null): v is string => !!v)
  );

  return (
    <div className="space-y-5">
      <div>
        <h1>Persetujuan</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
          POA yang menunggu tindakan Anda sebagai {displayRole(session.role, actor.jabatan)}
        </p>
      </div>

      {pending.length === 0 ? (
        <Card>
          <div className="py-12 text-center">
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              Tidak ada POA yang menunggu tindakan Anda saat ini.
            </p>
            <Link href="/dashboard" className="mt-3 inline-block">
              <Button variant="ghost" size="sm">Kembali ke Dashboard</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <ApprovalsChecklist pending={pending} activePssp={activePssp} actorRole={actor.role} />
      )}
    </div>
  );
}
