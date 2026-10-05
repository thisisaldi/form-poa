import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getProducts } from "@/lib/masterData";
import { POA_STANDARISASI_VIEW_ROLES } from "@/lib/role";
import { getPoaStandarisasiDetail, getDokterOptionsAction } from "@/app/actions/poaStandarisasi";
import { canEditPoaStandarisasi, canApprovePoaStandarisasiAtasan, isPoaStandarisasiLevelApprover } from "@/lib/authz";
import { APPROVAL_LEVELS } from "@/lib/discountApprovalLevel";
import { PoaStandarisasiWizard } from "@/components/poaStandarisasi/PoaStandarisasiWizard";

export default async function PoaStandarisasiDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  // Dibuka ke role sales chain 2026-09-29 (user: "ikuti POA PSSP", membalik keputusan 2026-09-10 yang MR/ADMIN saja).
  // Akses per pengajuan dijaga canViewPoaStandarisasi di getPoaStandarisasiDetail (null -> notFound); edit tetap owner-only.
  if (!POA_STANDARISASI_VIEW_ROLES.includes(session.role)) redirect("/dashboard");

  const pengajuan = await getPoaStandarisasiDetail(id);
  if (!pengajuan) notFound();

  const actor = await prisma.user.findUniqueOrThrow({ where: { nip: session.userId } });

  const [productOptions, dokterOptions, canApproveAsm, canApproveSm, canApproveNsm, levelFlags] = await Promise.all([
    getProducts(),
    getDokterOptionsAction(pengajuan.kodePI),
    canApprovePoaStandarisasiAtasan(actor, pengajuan, "ASM"),
    canApprovePoaStandarisasiAtasan(actor, pengajuan, "SM"),
    canApprovePoaStandarisasiAtasan(actor, pengajuan, "NSM"),
    Promise.all(APPROVAL_LEVELS.map((l) => isPoaStandarisasiLevelApprover(actor, pengajuan, l))),
  ]);
  const myApproverLevels = APPROVAL_LEVELS.filter((_, i) => levelFlags[i]);

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
      myApproverLevels={myApproverLevels}
      isOwner={pengajuan.ownerId === session.userId}
    />
  );
}
