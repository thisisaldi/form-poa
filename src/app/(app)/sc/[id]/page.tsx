import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SalesCounterDetailTabs } from "@/components/sc/SalesCounterDetailTabs";
import { displayRole } from "@/lib/role";
import { EditQuarterControl } from "@/components/poa/EditQuarterControl";
import { getSalesCounterDetailData } from "./_services/getSalesCounterDetailData";
import { SalesCounterActivityTimeline } from "@/components/sc/detail/SalesCounterActivityTimeline";

export const metadata = { title: "Detail POA Sales Counter · Form POA" };

export default async function SalesCounterDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const { id } = await params;

  const data = await getSalesCounterDetailData(id, session.userId, session.role);
  if (!data) notFound();
  if (!data.hasAccess || !data.poa || !data.scDrafts) redirect("/sc/dashboard");

  const {
    poa,
    userCanEdit,
    isOwner,
    scDrafts,
    salesSummary,
    targetValueFromGT,
    totalCoverageScOutlets,
    historyQuarterLabel,
  } = data;

  const hasSubmittableOutlets = scDrafts.some((d) => d.status === "DRAFT" || d.status === "REVISI");
  const canEditQuarter = userCanEdit && isOwner && (scDrafts.length === 0 || scDrafts.every((d) => d.status === "DRAFT" || d.status === "REVISI"));
  const isFullyApproved = scDrafts.length > 0 && scDrafts.every((d) => d.status === "APPROVED_BY_NSM");
  const isApproverRole = ["ASM", "SM", "NSM", "ADMIN"].includes(session.role);
  const canApprove =
    isApproverRole &&
    scDrafts.some((d) => {
      if (d.status === "DRAFT" || d.status === "REVISI" || d.status === "APPROVED_BY_NSM") return false;
      if (session.role === "ADMIN") return true;
      if (session.role === "ASM") return d.status === "SUBMITTED_TO_ASM";
      if (session.role === "SM") return d.status === "SUBMITTED_TO_SM" || d.status === "SUBMITTED_TO_ASM";
      if (session.role === "NSM") return ["SUBMITTED_TO_NSM", "SUBMITTED_TO_SM", "SUBMITTED_TO_ASM"].includes(d.status);
      return false;
    });

  const canFastTrack =
    (session.role === "NSM" || session.role === "ADMIN") &&
    scDrafts.some((d) =>
      ["SUBMITTED_TO_ASM", "APPROVED_BY_ASM", "SUBMITTED_TO_SM", "APPROVED_BY_SM", "SUBMITTED_TO_NSM"].includes(d.status)
    );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1>Detail POA Sales Counter</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            {canEditQuarter
              ? <EditQuarterControl poaId={poa.id} period={poa.period} isSc={true} />
              : `Periode ${poa.period}`}
            {" "}· {poa.owner.name} ({poa.owner.nip})
            {poa.currentHolder && (
              <span className="ml-2" style={{ color: "var(--color-text-faint)" }}>
                · Pemegang: {poa.currentHolder.name} ({displayRole(poa.currentHolder.role, poa.currentHolder.jabatan)})
              </span>
            )}
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--color-text-faint)" }}>
            Note: Nilai uang di halaman ini ditampilkan dalam format ringkas dengan suffix Jt (Juta) atau Rb (Ribu).
          </p>
        </div>
        <StatusBadge status={poa.status} version={poa.version} />
      </div>

      <SalesCounterDetailTabs
        scDrafts={scDrafts}
        poaId={id}
        poaPeriod={poa.period}
        poaStatus={poa.status}
        poaVersion={poa.version}
        showSubmit={isOwner && hasSubmittableOutlets}
        userCanEdit={userCanEdit}
        canApprove={canApprove}
        canFastTrack={canFastTrack}
        userRole={session.role}
        selectable={isOwner || canApprove}
        salesSummary={salesSummary}
        targetArea={targetValueFromGT ?? undefined}
        totalCoverageScOutlets={totalCoverageScOutlets}
        historyQuarterLabel={historyQuarterLabel}
      />

      {isFullyApproved && (
        <div className="rounded-md px-4 py-3 text-sm font-medium"
          style={{ background: "var(--color-green-light)", color: "var(--color-green)" }}>
          POA Sales Counter ini telah sepenuhnya disetujui oleh NSM.
        </div>
      )}

      <details className="group">
        <summary
          className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden [&::marker]:hidden"
          style={{ listStyle: "none" }}
        >
          <Card className="flex items-center justify-between hover:bg-[var(--color-bg-subtle)] transition-colors cursor-pointer">
            <p className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>
              Riwayat Aktivitas SC
            </p>
            <span
              className="text-xs transition-transform duration-200 group-open:rotate-180"
              style={{ color: "var(--color-text-muted)" }}
            >
              ▼
            </span>
          </Card>
        </summary>
        <Card className="mt-2 p-0 overflow-hidden">
          <SalesCounterActivityTimeline
            auditLogs={poa.auditLogs}
            outlets={scDrafts}
          />
        </Card>
      </details>
    </div>
  );
}
