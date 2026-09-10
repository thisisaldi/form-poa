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
  // Re-opened to MR 2026-09-10 (user request) — see new/page.tsx's note.
  // ASM/SM/NSM still blocked here on purpose: user wants atasan approval done
  // through its own dedicated view, not this same wizard page.
  if (session.role !== "ADMIN" && session.role !== "MR") redirect("/dashboard");

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
