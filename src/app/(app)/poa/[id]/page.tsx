import { notFound, redirect } from "next/navigation";
import type { PoaAuditLog as AuditLogType, User as UserType, PoaLineItem } from "@prisma/client";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canView, canEdit } from "@/lib/authz";
import { approvePoaAction } from "@/app/actions/poa";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { DraftChecklist } from "@/components/poa/DraftChecklist";

export const metadata = { title: "Detail POA · Form POA" };

function formatRp(n: number) {
  if (n >= 1_000_000_000) return `Rp${(n / 1_000_000_000).toFixed(1).replace(".", ",")} M`;
  if (n >= 1_000_000)     return `Rp${(n / 1_000_000).toFixed(1).replace(".", ",")} Jt`;
  return "Rp" + Math.round(n).toLocaleString("id-ID");
}

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
  const approveWithId = approvePoaAction.bind(null, id);

  const isMR = session.role === "MR";
  const isFullyApproved = poa.status === "APPROVED_BY_NSM";
  const isDraft = poa.status === "DRAFT";

  const allItems = (poa as typeof poa & { items: PoaLineItem[] }).items;

  // Aggregate stats
  const toNum = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
  let estimasiTotal = 0, budgetWeighted = 0;
  for (const it of allItems) {
    const base = toNum(it.rencanaTotalBiaya);
    estimasiTotal += base;
    budgetWeighted += base * (
      toNum(it.persenPsspDokter) + toNum(it.persenPsspKpdm) +
      toNum(it.persenDiskon) + toNum(it.persenDp) +
      toNum(it.persenListingFee) + toNum(it.persenEntertain)
    );
  }
  const target      = poa.target ? parseFloat(poa.target.toString()) : null;
  const ratioEst    = target && target > 0 ? (estimasiTotal / target) * 100 : null;
  const pctBudget   = estimasiTotal > 0 ? (budgetWeighted / estimasiTotal) * 100 : null;
  const budgetOver  = pctBudget != null && pctBudget > 42.5;
  const budgetWarn  = pctBudget != null && pctBudget > 38 && !budgetOver;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1>Detail POA</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Periode {poa.period} · {poa.owner.name} ({poa.owner.nip})
            {poa.currentHolder && (
              <span className="ml-2" style={{ color: "var(--color-text-faint)" }}>
                · Pemegang: {poa.currentHolder.name} ({poa.currentHolder.role})
              </span>
            )}
          </p>

          {/* Stats bar */}
          {allItems.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
              <div>
                <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Target</p>
                <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                  {target != null ? formatRp(target) : <span style={{ color: "var(--color-text-faint)" }}>—</span>}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Estimasi</p>
                <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                  {estimasiTotal > 0 ? formatRp(estimasiTotal) : <span style={{ color: "var(--color-text-faint)" }}>—</span>}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Ratio %</p>
                <p className="text-sm font-semibold"
                  style={{ color: ratioEst == null ? "var(--color-text-faint)" : ratioEst >= 100 ? "var(--color-success, #16a34a)" : "var(--color-warning, #f59e0b)" }}>
                  {ratioEst != null ? `${ratioEst.toFixed(1)}%` : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>% Budget</p>
                <p className="text-sm font-semibold"
                  style={{ color: budgetOver ? "var(--color-red)" : budgetWarn ? "var(--color-warning, #f59e0b)" : "var(--color-text-muted)" }}>
                  {pctBudget != null ? `${pctBudget.toFixed(1)}%` : "—"}
                </p>
              </div>
            </div>
          )}
        </div>
        <StatusBadge status={poa.status} />
      </div>

      {/* Export button (non-draft) */}
      {!isDraft && (
        <div>
          <a href={`/api/poa/${id}/export`}>
            <Button size="sm" variant="ghost">↓ Export Excel</Button>
          </a>
        </div>
      )}

      {/* Checklist + stats panel */}
      {allItems.length === 0 ? (
        <Card>
          <p className="text-sm py-4" style={{ color: "var(--color-text-muted)" }}>
            {userCanEdit
              ? <a href={`/poa/${id}/edit`} style={{ color: "var(--color-blue)" }}>+ Tambah rencana pertama</a>
              : "Belum ada baris."}
          </p>
        </Card>
      ) : (
        <DraftChecklist
          items={allItems}
          poaId={id}
          showSubmit={userCanEdit && isMR && isDraft}
          userCanEdit={userCanEdit && isDraft}
        />
      )}

      {/* Actions — approver only (MR submit is inside DraftChecklist) */}
      {userCanEdit && !isMR && !isFullyApproved && (
        <Card>
          <CardHeader>
            <CardTitle>Tindakan</CardTitle>
          </CardHeader>
          <div className="flex gap-3">
            <form action={approveWithId}>
              <Button type="submit" style={{ background: "var(--color-green, #16a34a)", color: "#fff" }}>
                Approve &amp; Teruskan
              </Button>
            </form>
          </div>
        </Card>
      )}

      {isFullyApproved && (
        <div className="rounded-md px-4 py-3 text-sm font-medium"
          style={{ background: "var(--color-green-light)", color: "var(--color-green)" }}>
          POA ini telah sepenuhnya disetujui oleh NSM.
        </div>
      )}

      {/* Audit log */}
      <details>
        <summary className="cursor-pointer select-none list-none">
          <Card>
            <div className="flex items-center justify-between">
              <p className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>Riwayat Aktivitas</p>
              <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Klik untuk lihat ▼</p>
            </div>
          </Card>
        </summary>
        <Card className="mt-2">
          {poa.auditLogs.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Belum ada aktivitas.</p>
          ) : (
            <ol className="relative space-y-4 pl-5 border-l" style={{ borderColor: "var(--color-border)" }}>
              {(poa.auditLogs as (AuditLogType & { actor: UserType })[]).map((log) => (
                <li key={log.id} className="relative">
                  <span className="absolute left-[-1.4rem] mt-1 h-2.5 w-2.5 rounded-full border-2 border-white"
                    style={{ background: "var(--color-blue)" }} />
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
      </details>
    </div>
  );
}
