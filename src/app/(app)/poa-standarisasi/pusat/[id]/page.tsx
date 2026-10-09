import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getPusatDetail, getPusatGroupOutletsAction } from "@/app/actions/poaStandarisasiPusat";
import { getProducts } from "@/lib/masterData";
import { PusatDetailView } from "@/components/poaStandarisasi/PusatDetail";

export default async function PusatDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const detail = await getPusatDetail(id);
  if (!detail) notFound();
  const [groupOutlets, products] = await Promise.all([getPusatGroupOutletsAction(detail.hkaGroup), getProducts()]);

  return <PusatDetailView detail={detail} groupOutlets={groupOutlets} productOptions={products} />;
}
