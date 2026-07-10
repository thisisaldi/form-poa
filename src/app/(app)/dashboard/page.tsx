import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getVisiblePoaFilter, getPendingActionFilter } from "@/lib/authz";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import type { Role, PoaForm as PoaFormType, User as UserType } from "@prisma/client";

export const metadata = { title: "Dashboard · POA System" };

export default async function DashboardPage() {
  const session = (await getCurrentUser())!;
  // Layout already validated this user exists — use findUnique with null-guard
  // rather than findUniqueOrThrow to avoid a crash on stale sessions mid-render.
  const actor = await prisma.user.findUnique({ where: { nip: session.userId } });
  if (!actor) return null; // layout redirect handles this, component won't render

  const [visibleFilter, pendingFilter] = await Promise.all([
    getVisiblePoaFilter(actor),
    Promise.resolve(getPendingActionFilter(actor)),
  ]);

  const [recentPoas, pendingPoas] = await Promise.all([
    prisma.poaForm.findMany({
      where: visibleFilter,
      include: { owner: true },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    prisma.poaForm.findMany({
      where: pendingFilter,
      include: { owner: true },
      orderBy: { updatedAt: "asc" },
      take: 5,
    }),
  ]);

  const isMR = session.role === "MR";

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1>Dashboard</h1>
          <p style={{ color: "var(--color-text-muted)" }} className="mt-0.5 text-sm">
            Selamat datang, {session.name}
            <span
              className="ml-2 rounded px-1.5 py-0.5 text-xs font-medium"
              style={{
                background: "var(--color-blue-light)",
                color: "var(--color-blue)",
              }}
            >
              {session.role}
            </span>
          </p>
        </div>
        {isMR && (
          <Link href="/poa/new">
            <Button>+ Buat POA Baru</Button>
          </Link>
        )}
      </div>

      {/* Pending action (managers) */}
      {!isMR && pendingPoas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Menunggu Tindakan Anda</CardTitle>
            <Link href="/approvals" className="text-xs" style={{ color: "var(--color-blue)" }}>
              Lihat semua →
            </Link>
          </CardHeader>
          <ul className="divide-y" style={{ borderColor: "var(--color-border)" }}>
            {(pendingPoas as (PoaFormType & { owner: UserType })[]).map((poa) => (
              <li key={poa.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                    {poa.owner.name}
                    <span className="ml-1 text-xs font-normal" style={{ color: "var(--color-text-muted)" }}>
                      ({poa.owner.nip})
                    </span>
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                    Periode: {poa.period}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={poa.status} />
                  <Link href={`/poa/${poa.id}`}>
                    <Button size="sm" variant="secondary">Review</Button>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* All visible POAs */}
      <Card>
        <CardHeader>
          <CardTitle>{isMR ? "POA Saya" : "Semua POA"}</CardTitle>
        </CardHeader>
        {recentPoas.length === 0 ? (
          <EmptyState isMR={isMR} role={session.role as Role} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <th className="pb-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>MR</th>
                  <th className="pb-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Periode</th>
                  <th className="pb-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Status</th>
                  <th className="pb-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Update</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {(recentPoas as (PoaFormType & { owner: UserType })[]).map((poa) => (
                  <tr key={poa.id}>
                    <td className="py-3">
                      <p className="font-medium" style={{ color: "var(--color-text)" }}>{poa.owner.name}</p>
                      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{poa.owner.nip}</p>
                    </td>
                    <td className="py-3" style={{ color: "var(--color-text)" }}>{poa.period}</td>
                    <td className="py-3"><StatusBadge status={poa.status} /></td>
                    <td className="py-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {new Date(poa.updatedAt).toLocaleDateString("id-ID")}
                    </td>
                    <td className="py-3 text-right">
                      <Link href={`/poa/${poa.id}`} style={{ color: "var(--color-blue)" }} className="text-xs font-medium">
                        Lihat
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function EmptyState({ isMR, role }: { isMR: boolean; role: Role }) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        {isMR
          ? "Belum ada POA. Buat POA pertama Anda."
          : `Belum ada POA yang perlu ditinjau sebagai ${role}.`}
      </p>
      {isMR && (
        <Link href="/poa/new" className="mt-3 inline-block">
          <Button size="sm">Buat POA</Button>
        </Link>
      )}
    </div>
  );
}
