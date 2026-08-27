import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SalesCounterLineItemEditor } from "@/components/sc/edit/SalesCounterLineItemEditor";
import { getSalesCounterEditData } from "../_services/getSalesCounterEditData";

export const metadata = { title: "Tambah Rencana POA Sales Counter · Form POA" };

export default async function EditSalesCounterPoaPage({
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

  const data = await getSalesCounterEditData(id, period, session.userId, session.role);
  if (!data) notFound();
  if (!data.userCanEdit || !data.outlets || !data.products || !data.poa) redirect(`/sc/${id}`);

  const { poa, outlets, products, savedDrafts } = data;

  return (
    <div className="max-w-7xl w-full space-y-5">
      <div>
        <Link href={`/sc/${id}`} className="text-xs mb-1 inline-flex items-center gap-1"
          style={{ color: "var(--color-text-faint)" }}>
          ← Kembali ke Draft
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1>Tambah Rencana POA Sales Counter</h1>
            <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
              Periode {poa.period} · {poa.owner.name}
            </p>
          </div>
          <StatusBadge status={poa.status} version={poa.version} />
        </div>
      </div>

      <Card>
        <SalesCounterLineItemEditor
          poaId={id}
          poaPeriod={poa.period}
          outlets={outlets}
          products={products}
          savedDrafts={savedDrafts}
        />
      </Card>
    </div>
  );
}