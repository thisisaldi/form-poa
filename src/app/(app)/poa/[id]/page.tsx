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
import { formatPeriodeRange } from "@/lib/poaUtils";

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

  return (
    <div className="max-w-2xl space-y-5">
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

      {/* Line items */}
      <Card>
        <CardHeader>
          <CardTitle>Baris POA</CardTitle>
          <div className="flex gap-2">
            {userCanEdit && (
              <Link href={`/poa/${id}/edit`}>
                <Button size="sm" variant="secondary">Edit</Button>
              </Link>
            )}
            <a href={`/api/poa/${id}/export`}>
              <Button size="sm" variant="ghost">↓ Export Excel</Button>
            </a>
          </div>
        </CardHeader>
        {(poa as typeof poa & { items: PoaLineItem[] }).items.length === 0 ? (
          <p className="text-sm py-4" style={{ color: "var(--color-text-muted)" }}>
            Belum ada baris.{userCanEdit && " Klik Edit untuk menambahkan."}
          </p>
        ) : (
          <LineItemsTable items={(poa as typeof poa & { items: PoaLineItem[] }).items} />
        )}
      </Card>

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

const STATUS_STANDARISASI_LABELS: Record<string, string> = {
  SUDAH_STANDARISASI: "Sudah",
  PROSES_PENGAJUAN: "Proses",
  BELUM_STANDARISASI: "Belum",
};

function LineItemsTable({ items }: { items: PoaLineItem[] }) {
  // Group by kodeRequest
  const groups = new Map<string, PoaLineItem[]>();
  for (const item of items) {
    const g = groups.get(item.kodeRequest) ?? [];
    g.push(item);
    groups.set(item.kodeRequest, g);
  }

  return (
    <div className="space-y-3">
      {Array.from(groups.entries()).map(([kodeRequest, rows]) => {
        const first = rows[0];
        return (
          <div
            key={kodeRequest}
            className="rounded-md border overflow-hidden"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div
              className="px-4 py-2 text-xs font-semibold uppercase tracking-wide"
              style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}
            >
              {first.kodeRequest} · {first.namaCust} · {first.spesialisasi} · {first.namaOutlet}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <th className="px-3 py-2 text-left text-xs font-medium" style={{ color: "var(--color-text-faint)" }}>Produk</th>
                  <th className="px-3 py-2 text-left text-xs font-medium" style={{ color: "var(--color-text-faint)" }}>Periode</th>
                  <th className="px-3 py-2 text-left text-xs font-medium" style={{ color: "var(--color-text-faint)" }}>Rencana Biaya</th>
                  <th className="px-3 py-2 text-left text-xs font-medium" style={{ color: "var(--color-text-faint)" }}>Visit/Minggu</th>
                  <th className="px-3 py-2 text-left text-xs font-medium" style={{ color: "var(--color-text-faint)" }}>Standarisasi</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {rows.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2">
                      <p className="font-medium" style={{ color: "var(--color-text)" }}>{item.namaProduk}</p>
                      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{item.kodeProduk}</p>
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: "var(--color-text)" }}>
                      {formatPeriodeRange(item.periodeAwal, item.lamaPeriode)}
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: "var(--color-text)" }}>
                      Rp {parseInt(item.rencanaTotalBiaya.toString()).toLocaleString("id-ID")}
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: "var(--color-text)" }}>{item.rencanaVisitMinggu}×</td>
                    <td className="px-3 py-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {item.statusStandarisasi ? STATUS_STANDARISASI_LABELS[item.statusStandarisasi] : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
