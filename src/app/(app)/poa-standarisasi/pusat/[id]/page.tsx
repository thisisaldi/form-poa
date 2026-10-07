import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getPusatDetail, getPusatGroupOutletsAction } from "@/app/actions/poaStandarisasiPusat";
import { PusatDetailView } from "@/components/poaStandarisasi/PusatDetail";

export default async function PusatDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const detail = await getPusatDetail(id);
  if (!detail) notFound();
  const groupOutlets = await getPusatGroupOutletsAction(detail.hkaGroup);

  return <PusatDetailView detail={detail} groupOutlets={groupOutlets} />;
}
