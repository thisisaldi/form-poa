import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canEdit } from "@/lib/authz";
import { getProducts } from "@/lib/masterData";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Card } from "@/components/ui/Card";
import { EditPanel } from "@/components/poa/LineItemEditor";

export const metadata = { title: "Edit Rencana POA · Form POA" };

export default async function EditItemPage({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const { id, itemId } = await params;
  const [poa, actor, products, item] = await Promise.all([
    prisma.poaForm.findUnique({ where: { id }, include: { owner: true } }),
    prisma.user.findUniqueOrThrow({ where: { nip: session.userId } }),
    getProducts(),
    prisma.poaLineItem.findUnique({ where: { id: itemId } }),
  ]);

  if (!poa || !item || item.poaId !== id) notFound();
  if (!canEdit(actor, poa)) redirect(`/poa/${id}`);

  const backUrl = `/poa/${id}`;

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <Link href={backUrl} className="text-xs mb-1 inline-flex items-center gap-1"
            style={{ color: "var(--color-text-faint)" }}>
            ← Kembali ke Draft
          </Link>
          <h1>Edit Rencana POA</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Periode {poa.period} · {poa.owner.name}
          </p>
        </div>
        <StatusBadge status={poa.status} />
      </div>

      <Card>
        <EditPanel
          item={item}
          poaId={id}
          products={products}
          redirectTo={backUrl}
        />
      </Card>
    </div>
  );
}
