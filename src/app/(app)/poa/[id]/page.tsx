import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { PoaAuditLog as AuditLogType, User as UserType, PoaLineItem } from "@prisma/client";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canView, canEdit } from "@/lib/authz";
import { submitPoaAction, approvePoaAction } from "@/app/actions/poa";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { DraftChecklist } from "@/components/poa/DraftChecklist";

export const metadata = { title: "Detail POA · POA System" };

export default async function PoaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const { id } = await params;
  const [poa, actor] = await Promise.all([
    prisma.poaForm.findUnique({
      where: { id },
      include: {
        owner: true,
        currentHolder: true,
        items: { orderBy: { createdAt: "asc" } },
        auditLogs: {
          include: { actor: true },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.user.findUniqueOrThrow({ where: { nip: session.userId } }),
  ]);

  if (!poa) notFound();

  const hasAccess = await canView(actor, poa);
  if (!hasAccess) redirect("/dashboard");

  const userCanEdit = canEdit(actor, poa);
  const submitWithId = submitPoaAction.bind(null, id);
  const approveWithId = approvePoaAction.bind(null, id);

  const isApprover = ["ASM", "SM", "NSM"].includes(session.role);
  const isFullyApproved = poa.status === "APPROVED_BY_NSM";
  const isDraft = poa.status === "DRAFT";

  const allItems = (poa as typeof poa & { items: PoaLineItem[] }).items;

  return (
    <div className="max-w-3xl space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1>Detail POA</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Periode {poa.period} · {poa.owner.name} ({poa.owner.nip})
          </p>
        </div>
        <StatusBadge status={poa.status} />
      </div>

      {/* Meta */}
      <Card>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>MR</dt>
            <dd className="mt-0.5 font-medium" style={{ color: "var(--color-text)" }}>{poa.owner.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>NIP</dt>
            <dd className="mt-0.5" style={{ color: "var(--color-text)" }}>{poa.owner.nip}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Periode</dt>
            <dd className="mt-0.5" style={{ color: "var(--color-text)" }}>{poa.period}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Status</dt>
            <dd className="mt-0.5"><StatusBadge status={poa.status} /></dd>
          </div>
          {poa.currentHolder && (
            <div className="col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Pemegang saat ini</dt>
              <dd className="mt-0.5" style={{ color: "var(--color-text)" }}>
                {poa.currentHolder.name} ({poa.currentHolder.role})
              </dd>
            </div>
          )}
        </dl>
      </Card>

      {/* Checklist + stats (client, interactive) */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {userCanEdit && (
            <Link href={`/poa/${id}/edit`}>
              <Button size="sm" variant="secondary">+ Tambah Rencana POA</Button>
            </Link>
          )}
          {!isDraft && (
            <a href={`/api/poa/${id}/export`}>
              <Button size="sm" variant="ghost">↓ Export Excel</Button>
            </a>
          )}
        </div>
      </div>

      {allItems.length === 0 ? (
        <Card>
          <p className="text-sm py-4" style={{ color: "var(--color-text-muted)" }}>
            Belum ada baris.{userCanEdit && " Klik tombol di atas untuk mulai."}
          </p>
        </Card>
      ) : (
        <DraftChecklist items={allItems} />
      )}

      {/* Actions */}
      {userCanEdit && !isFullyApproved && (
        <Card>
          <CardHeader>
            <CardTitle>
              {isApprover ? "Tindakan Persetujuan" : "Submit"}
            </CardTitle>
          </CardHeader>
          <div className="flex gap-3">
            {isApprover ? (
              <>
                <form action={approveWithId}>
                  <Button type="submit" style={{ background: "var(--color-green)" }}>
                    Approve
                  </Button>
                </form>
                <form action={submitWithId}>
                  <Button type="submit">Submit ke Atas</Button>
                </form>
              </>
            ) : (
              <form action={submitWithId}>
                <Button type="submit">Submit ke Atasan</Button>
              </form>
            )}
          </div>
        </Card>
      )}

      {isFullyApproved && (
        <div
          className="rounded-md px-4 py-3 text-sm font-medium"
          style={{ background: "var(--color-green-light)", color: "var(--color-green)" }}
        >
          POA ini telah sepenuhnya disetujui oleh NSM.
        </div>
      )}

      {/* Audit log */}
      <Card>
        <CardHeader>
          <CardTitle>Riwayat Aktivitas</CardTitle>
        </CardHeader>
        {poa.auditLogs.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Belum ada aktivitas.</p>
        ) : (
          <ol className="relative space-y-4 pl-5 border-l" style={{ borderColor: "var(--color-border)" }}>
            {(poa.auditLogs as (AuditLogType & { actor: UserType })[]).map((log) => (
              <li key={log.id} className="relative">
                <span
                  className="absolute left-[-1.4rem] mt-1 h-2.5 w-2.5 rounded-full border-2 border-white"
                  style={{ background: "var(--color-blue)" }}
                />
                <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                  {new Date(log.createdAt).toLocaleString("id-ID")}
                </p>
                <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                  {log.actor.name}
                  <span className="ml-1.5 font-normal" style={{ color: "var(--color-text-muted)" }}>
                    {log.action.toLowerCase()}
                  </span>
                </p>
                {log.toStatus && (
                  <p className="mt-0.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
                    → {log.toStatus.replace(/_/g, " ")}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

