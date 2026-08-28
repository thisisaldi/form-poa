import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getPendingActionScFilter } from "@/lib/authz";
import { SalesCounterApprovalsChecklist } from "@/components/sc/SalesCounterApprovalsChecklist";

export const metadata = { title: "Persetujuan Sales Counter · Form POA" };

export default async function SalesCounterApprovalsPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const actor = await prisma.user.findUnique({
    where: { nip: session.userId },
  });

  if (!actor || !["ASM", "SM", "NSM", "ADMIN"].includes(actor.role)) {
    redirect("/sc/dashboard");
  }

  const pendingFilter = getPendingActionScFilter(actor);

  const pendingForms = await prisma.poaScForm.findMany({
    where: pendingFilter,
    include: {
      owner: true,
      products: true,
      persons: true,
      entertainItems: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  // Group forms by owner (MR) & period for manager review
  const groupedMap = new Map<string, { owner: any; period: string; forms: any[] }>();

  for (const form of pendingForms) {
    const key = `${form.period}_${form.ownerId}`;
    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        owner: form.owner,
        period: form.period,
        forms: [],
      });
    }
    groupedMap.get(key)!.forms.push(form);
  }

  const mrGroups = Array.from(groupedMap.values()).map((g) => ({
    ownerNip: g.owner.nip,
    ownerName: g.owner.name,
    period: g.period,
    outletCount: g.forms.length,
    totalBudgetSc: g.forms.reduce((sum, f) => {
      const prodSum = f.products.reduce((ps: number, p: any) => ps + Number(p.rencanaTotalBiaya.toString()), 0);
      const entSum = f.entertainItems.reduce((es: number, e: any) => es + Number(e.biayaEntertain.toString()), 0);
      return sum + prodSum + entSum;
    }, 0),
    forms: g.forms.map((f) => ({
      id: f.id,
      kodePI: f.kodePI,
      namaOutlet: f.namaOutlet,
      status: f.status,
      version: f.version,
    })),
  }));

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Persetujuan Sales Counter</h1>
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          Daftar pengajuan POA Sales Counter dari MR yang membutuhkan persetujuan Anda.
        </p>
      </div>

      <SalesCounterApprovalsChecklist mrGroups={mrGroups} />
    </div>
  );
}
