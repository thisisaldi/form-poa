import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getProducts } from "@/lib/masterData";
import {
  getPoaStandarisasiDetail,
  listKpdmOptions,
  listJabatanOptions,
  getDokterOptionsAction,
} from "@/app/actions/poaStandarisasi";
import { canEditPoaStandarisasi, canApprovePoaStandarisasiAtasan } from "@/lib/authz";
import { PoaStandarisasiWizard } from "@/components/poaStandarisasi/PoaStandarisasiWizard";

export default async function PoaStandarisasiDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  // ADMIN-only while this feature is under review (2026-08-14), same
  // convention as /monitoring.
  if (session.role !== "ADMIN") redirect("/dashboard");

  const pengajuan = await getPoaStandarisasiDetail(id);
  if (!pengajuan) notFound();

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });

  const [productOptions, kpdmOptions, jabatanOptions, dokterOptions, canApproveAsm, canApproveSm] = await Promise.all([
    getProducts(),
    listKpdmOptions(),
    listJabatanOptions(),
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
      dokterOptions={dokterOptions}
      canEdit={canEdit}
      canApproveAsm={canApproveAsm}
      canApproveSm={canApproveSm}
      isOwner={pengajuan.ownerId === session.userId}
    />
  );
}
