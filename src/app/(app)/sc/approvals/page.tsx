import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getAppSetting } from "@/lib/appSettings";
import { displayRole } from "@/lib/role";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SalesCounterApprovalsSummaryChecklist } from "@/components/sc/SalesCounterApprovalsChecklist";
import { ScToastProvider } from "@/components/sc/ui/ScToast";
import { LegacySalesCounterApprovalsPage } from "./LegacyApprovalsPage";
import { getScApprovalsSummaryData } from "./_services/getScApprovalsSummaryData";

export const metadata = { title: "Persetujuan Sales Counter · Form POA" };

export default async function SalesCounterApprovalsPage({
  searchParams,
}: {
  searchParams?: Promise<{ period?: string; page?: string }>;
}) {
  if (await getAppSetting("sc.approvalsSummary.disabled")) {
    return <LegacySalesCounterApprovalsPage searchParams={searchParams} />;
  }

  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const actor = await prisma.user.findUnique({
    where: { nip: session.userId },
  });

  if (!actor || !["ASM", "SM", "NSM", "ADMIN"].includes(actor.role)) {
    redirect("/sc/dashboard");
  }

  const params = searchParams ? await searchParams : {};
  const data = await getScApprovalsSummaryData(actor, {
    period: params?.period,
    page: Number(params?.page) || 1,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Persetujuan Sales Counter</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
          POA Sales Counter yang menunggu tindakan Anda sebagai {displayRole(actor.role, actor.jabatan)}
        </p>
      </div>

      {data.totalFormCount === 0 && data.availablePeriods.length === 0 ? (
        <Card>
          <div className="py-12 text-center">
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              Tidak ada pengajuan Sales Counter yang menunggu persetujuan Anda saat ini.
            </p>
            <Link href="/sc/dashboard" className="mt-3 inline-block">
              <Button variant="ghost" size="sm">
                Kembali ke Dashboard
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <ScToastProvider>
          <SalesCounterApprovalsSummaryChecklist
            mrGroups={data.mrGroups}
            userRole={actor.role}
            availablePeriods={data.availablePeriods}
            selectedPeriod={data.selectedPeriod}
            metrics={data.metrics}
            quarterMonths={data.quarterMonths}
            totalOutletCount={data.totalFormCount}
            allOutletIds={data.allFormIds}
            pagedDrafts={data.pagedDrafts}
            outletPage={data.outletPage}
            outletTotalPages={data.outletTotalPages}
            uncomputedCount={data.uncomputedCount}
          />
        </ScToastProvider>
      )}
    </div>
  );
}
