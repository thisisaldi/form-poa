import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { Card } from "@/components/ui/Card";
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
    <div className="max-w-7xl w-full space-y-3">
      <Link href={`/sc/${id}`} className="text-xs inline-flex items-center gap-1"
        style={{ color: "var(--color-text-faint)" }}>
        ← Kembali ke Draft
      </Link>

      <Card>
        <SalesCounterLineItemEditor
          poaId={id}
          poaPeriod={poa.period}
          ownerName={poa.owner.name}
          outlets={outlets}
          products={products}
          savedDrafts={savedDrafts}
        />
      </Card>
    </div>
  );
}