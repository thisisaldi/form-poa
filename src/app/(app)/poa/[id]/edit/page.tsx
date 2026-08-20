import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canAddNewDoctor } from "@/lib/authz";
import { getOutletsByUser, getProducts } from "@/lib/masterData";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { LineItemEditor } from "@/components/poa/LineItemEditor";

export const metadata = { title: "Tambah Rencana POA · Form POA" };

export default async function EditPoaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const { id } = await params;
  const [poa, actor, rawOutlets, products] = await Promise.all([
    prisma.poaForm.findUnique({
      where: { id },
      include: { owner: true },
    }),
    prisma.user.findUniqueOrThrow({ where: { nip: session.userId } }),
    getOutletsByUser(session.userId),
    getProducts(),
  ]);

  const outlets = rawOutlets
    .filter((o) => o.kodePI != null)
    .map((o) => ({ kodePI: o.kodePI as string, namaOutlet: o.namaOutlet, groupRS: o.groupRS ?? null }));

  if (!poa) notFound();
  if (!(await canAddNewDoctor(actor, poa))) redirect(`/poa/${id}`);

  return (
    <div className="max-w-3xl space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link href={`/poa/${id}`} className="text-xs mb-1 inline-flex items-center gap-1"
            style={{ color: "var(--color-text-faint)" }}>
            ← Kembali ke Draft
          </Link>
          <h1>Tambah Rencana POA</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Periode {poa.period} · {poa.owner.name}
          </p>
        </div>
        <StatusBadge status={poa.status} version={poa.version} />
      </div>

      <Card>
        <LineItemEditor
          poaId={id}
          poaPeriod={poa.period}
          initialItems={[]}
          outlets={outlets}
          products={products}
          formOnly
          redirectTo={`/poa/${id}`}
        />
      </Card>
    </div>
  );
}
