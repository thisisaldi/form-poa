import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SalesCounterDetailTabs } from "@/components/sc/SalesCounterDetailTabs";
import { displayRole } from "@/lib/role";
import { EditQuarterControl } from "@/components/poa/EditQuarterControl";
import { getSalesCounterDetailData } from "./_services/getSalesCounterDetailData";
import type { PoaAuditLog, User } from "@prisma/client";

export const metadata = { title: "Detail POA Sales Counter · Form POA" };

const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREATE: "membuat draft SC",
  UPDATE: "mengedit SC",
  SUBMIT: "mengajukan SC",
  APPROVE: "menyetujui SC",
  REVISE: "mengedit SC (kembali ke Revisi)",
  REJECT: "menolak SC",
  CANCEL: "membatalkan approval SC",
};

export default async function SalesCounterDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const { id } = await params;
  const { period } = await searchParams;

  const data = await getSalesCounterDetailData(id, period, session.userId, session.role);
  if (!data) notFound();
  if (!data.hasAccess || !data.poa || !data.scDrafts) redirect("/dashboard");

  const {
    poa,
    userCanEdit,
    isOwner,
    scDrafts,
    salesSummary,
    targetValueFromGT,
  } = data;

  const isDraft = poa.status === "DRAFT";
  const isRevisi = poa.status === "REVISI";
  const isFullyApproved = poa.status === "APPROVED_BY_NSM";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1>Detail POA Sales Counter</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            {userCanEdit && (isDraft || isRevisi)
              ? <EditQuarterControl poaId={poa.id} period={poa.period} />
              : `Periode ${poa.period}`}
            {" "}· {poa.owner.name} ({poa.owner.nip})
            {poa.currentHolder && (
              <span className="ml-2" style={{ color: "var(--color-text-faint)" }}>
                · Pemegang: {poa.currentHolder.name} ({displayRole(poa.currentHolder.role, poa.currentHolder.jabatan)})
              </span>
            )}
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--color-text-faint)" }}>
            Note: Satuan nilai uang di halaman ini dalam Juta (dibagi 1.000.000)
          </p>
        </div>
        <StatusBadge status={poa.status} version={poa.version} />
      </div>

      {/* Export button */}
      <div>
        <a href={`/api/sc/${id}/export`}>
          <Button size="sm" variant="ghost">↓ Export Excel</Button>
        </a>
      </div>

      <SalesCounterDetailTabs
        scDrafts={scDrafts}
        poaId={id}
        poaPeriod={poa.period}
        poaStatus={poa.status}
        poaVersion={poa.version}
        showSubmit={userCanEdit && isOwner && (isDraft || isRevisi)}
        userCanEdit={userCanEdit}
        selectable={isOwner}
        salesSummary={salesSummary}
        targetArea={targetValueFromGT ?? undefined}
      />

      {isFullyApproved && (
        <div className="rounded-md px-4 py-3 text-sm font-medium"
          style={{ background: "var(--color-green-light)", color: "var(--color-green)" }}>
          POA Sales Counter ini telah sepenuhnya disetujui oleh NSM.
        </div>
      )}

      <details>
        <summary className="cursor-pointer select-none list-none">
          <Card><p className="font-semibold text-sm">Riwayat Aktivitas SC</p></Card>
        </summary>
        <Card className="mt-2">
          {poa.auditLogs.length === 0 ? <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Belum ada aktivitas.</p> : (
            <ol className="relative space-y-4 pl-5 border-l" style={{ borderColor: "var(--color-border)" }}>
              {(poa.auditLogs as (PoaAuditLog & { actor: User })[]).map((log) => (
                <li key={log.id} className="relative">
                  <span
                    className="absolute left-[-1.4rem] mt-1 h-2.5 w-2.5 rounded-full border-2 border-white"
                    style={{ background: "var(--color-blue)" }}
                  />
                  <p className="text-xs font-mono" style={{ color: "var(--color-text-faint)" }}>
                    {new Date(log.createdAt).toLocaleString("id-ID", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                  <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                    {log.actor.name}
                    <span className="ml-1.5 font-normal" style={{ color: "var(--color-text-muted)" }}>
                      {AUDIT_ACTION_LABELS[log.action] ?? log.action.toLowerCase()}
                    </span>
                  </p>
                  {log.toStatus && log.toStatus !== log.fromStatus && (
                    <p className="mt-0.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
                      → {log.toStatus.replace(/_/g, " ")}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </details>
    </div>
  );
}
