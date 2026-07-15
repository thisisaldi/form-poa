import { redirect } from "next/navigation";
import Link from "next/link";
import type { PoaForm as PoaFormType, User as UserType } from "@prisma/client";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getPendingActionFilter } from "@/lib/authz";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export const metadata = { title: "Persetujuan · Form POA" };

export default async function ApprovalsPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  if (session.role === "MR") redirect("/dashboard");

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });
  const filter = getPendingActionFilter(actor);

  const pending = await prisma.poaForm.findMany({
    where: filter,
    include: { owner: true },
    orderBy: { updatedAt: "asc" },
  });

  return (
    <div className="space-y-5">
      <div>
        <h1>Persetujuan</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
          POA yang menunggu tindakan Anda sebagai {session.role}
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
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="border-b"
                  style={{ borderColor: "var(--color-border)", background: "var(--color-bg-subtle)" }}
                >
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>MR</th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Periode</th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Status</th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Masuk</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {(pending as (PoaFormType & { owner: UserType })[]).map((poa) => (
                  <tr key={poa.id} className="hover:bg-(--color-bg-subtle) transition-colors">
                    <td className="px-5 py-3.5">
                      <p className="font-medium" style={{ color: "var(--color-text)" }}>{poa.owner.name}</p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>{poa.owner.nip}</p>
                    </td>
                    <td className="px-5 py-3.5" style={{ color: "var(--color-text)" }}>{poa.period}</td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={poa.status} />
                    </td>
                    <td className="px-5 py-3.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {new Date(poa.updatedAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Link href={`/poa/${poa.id}`}>
                        <Button size="sm">Review</Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
