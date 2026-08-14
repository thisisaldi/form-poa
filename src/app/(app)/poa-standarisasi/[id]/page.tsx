import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getProducts } from "@/lib/masterData";
import {
  getPoaStandarisasiDetail,
  listKpdmOptions,
  listJabatanOptions,
  listDistributorOptions,
  getDokterOptionsAction,
} from "@/app/actions/poaStandarisasi";
import { canEditPoaStandarisasi, canApprovePoaStandarisasiAtasan } from "@/lib/authz";
import { PoaStandarisasiWizard } from "@/components/poaStandarisasi/PoaStandarisasiWizard";

export default async function PoaStandarisasiDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const pengajuan = await getPoaStandarisasiDetail(id);
  if (!pengajuan) notFound();

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });

  const [productOptions, kpdmOptions, jabatanOptions, distributorOptions, dokterOptions, canApproveAsm, canApproveSm] = await Promise.all([
    getProducts(),
    listKpdmOptions(),
    listJabatanOptions(),
    listDistributorOptions(),
    getDokterOptionsAction(pengajuan.kodePI),
    canApprovePoaStandarisasiAtasan(actor, pengajuan, "ASM"),
    canApprovePoaStandarisasiAtasan(actor, pengajuan, "SM"),
  ]);

  const canEdit = canEditPoaStandarisasi(actor, pengajuan);

  return (
    <PoaStandarisasiWizard
      pengajuan={pengajuan}
      productOptions={productOptions}
      kpdmOptions={kpdmOptions}
      jabatanOptions={jabatanOptions}
      distributorOptions={distributorOptions}
      dokterOptions={dokterOptions}
      canEdit={canEdit}
      canApproveAsm={canApproveAsm}
      canApproveSm={canApproveSm}
      isOwner={pengajuan.ownerId === session.userId}
    />
  );
}
