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

export const metadata = { title: "Detail POA · Form POA" };

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

  const isMR = session.role === "MR";
  const isFullyApproved = poa.status === "APPROVED_BY_NSM";
  const isDraft = poa.status === "DRAFT";

  const allItems = (poa as typeof poa & { items: PoaLineItem[] }).items;

  // Budget warning — computed server-side so atasan bisa lihat tanpa interaksi
  const budgetWarning = (() => {
    if (allItems.length === 0) return null;
    const toNum = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
    let estimasiTotal = 0, budgetTotal = 0;
    for (const it of allItems) {
      const base = toNum(it.rencanaTotalBiaya);
      estimasiTotal += base;
      budgetTotal   += base * (
        toNum(it.persenPsspDokter) + toNum(it.persenPsspKpdm) +
        toNum(it.persenDiskon) + toNum(it.persenDp) + toNum(it.persenListingFee) +
        toNum(it.persenEntertain)
      );
    }
    const ratio = estimasiTotal > 0 ? budgetTotal / estimasiTotal : 0;
    if (ratio <= 0) return null;
    if (ratio > 0.425) return { level: "danger"  as const, pct: (ratio * 100).toFixed(1) };
    if (ratio > 0.38)  return { level: "warning" as const, pct: (ratio * 100).toFixed(1) };
    return               { level: "ok"      as const, pct: (ratio * 100).toFixed(1) };
  })();

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

      {/* Budget warning banner */}
      {budgetWarning && (
        <div className="rounded-lg px-4 py-3 text-sm flex items-start gap-3"
          style={budgetWarning.level === "danger"
            ? { background: "#fee2e2", color: "#dc2626", border: "1px solid #fca5a5" }
            : budgetWarning.level === "warning"
            ? { background: "#fff7ed", color: "#92400e", border: "1px solid #fcd34d" }
            : { background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" }}>
          <span className="text-base leading-none mt-0.5">
            {budgetWarning.level === "danger" ? "!" : budgetWarning.level === "warning" ? "⚠" : "✓"}
          </span>
          <div>
            <p className="font-semibold">
              {budgetWarning.level === "danger"
                ? `Anggaran melebihi batas — ${budgetWarning.pct}% dari estimasi`
                : budgetWarning.level === "warning"
                ? `Anggaran mendekati batas — ${budgetWarning.pct}% dari estimasi`
                : `Anggaran aman — ${budgetWarning.pct}% dari estimasi`}
            </p>
            <p className="text-xs mt-0.5 opacity-80">
              {budgetWarning.level === "danger"
                ? "Total budget (PSSP + Discount + Entertain) melebihi batas 42,5% dari estimasi. Perlu ditinjau."
                : budgetWarning.level === "warning"
                ? "Total budget mendekati batas 42,5%. Perhatikan agar tidak melebihi batas."
                : "Total budget di bawah 38% dari estimasi."}
            </p>
          </div>
        </div>
      )}

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
            <CardTitle>{isMR ? "Ajukan POA" : "Tindakan"}</CardTitle>
          </CardHeader>
          <div className="flex gap-3">
            {isMR ? (
              <form action={submitWithId}>
                <Button type="submit">Ajukan ke Atasan</Button>
              </form>
            ) : (
              <form action={approveWithId}>
                <Button type="submit" style={{ background: "var(--color-green, #16a34a)", color: "#fff" }}>
                  Approve &amp; Teruskan
                </Button>
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

      {/* Audit log — hidden by default */}
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
      </details>
    </div>
  );
}

