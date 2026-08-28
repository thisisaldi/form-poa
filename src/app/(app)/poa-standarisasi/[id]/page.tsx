import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getProducts } from "@/lib/masterData";
import { getPoaStandarisasiDetail, getDokterOptionsAction } from "@/app/actions/poaStandarisasi";
import { canEditPoaStandarisasi, canApprovePoaStandarisasiAtasan } from "@/lib/authz";
import { PoaStandarisasiWizard } from "@/components/poaStandarisasi/PoaStandarisasiWizard";

export default async function PoaStandarisasiDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  // Opened to MR (tim sales) 2026-08-28 — was ADMIN-only while under review.
  // getPoaStandarisasiDetail already gates per-pengajuan via
  // canViewPoaStandarisasi (owner MR, or ASM/SM/NSM in the approval chain,
  // or ADMIN/GM/SFE/VIEWER company-wide) and returns null otherwise.
  const pengajuan = await getPoaStandarisasiDetail(id);
  if (!pengajuan) notFound();

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });

  const [productOptions, dokterOptions, canApproveAsm, canApproveSm, canApproveNsm] = await Promise.all([
    getProducts(),
    getDokterOptionsAction(pengajuan.kodePI),
    canApprovePoaStandarisasiAtasan(actor, pengajuan, "ASM"),
    canApprovePoaStandarisasiAtasan(actor, pengajuan, "SM"),
    canApprovePoaStandarisasiAtasan(actor, pengajuan, "NSM"),
  ]);

  const canEdit = canEditPoaStandarisasi(actor, pengajuan);

  return (
    <PoaStandarisasiWizard
      pengajuan={pengajuan}
      productOptions={productOptions}
      dokterOptions={dokterOptions}
      canEdit={canEdit}
      canApproveAsm={canApproveAsm}
      canApproveSm={canApproveSm}
      canApproveNsm={canApproveNsm}
      isOwner={pengajuan.ownerId === session.userId}
    />
  );
}
