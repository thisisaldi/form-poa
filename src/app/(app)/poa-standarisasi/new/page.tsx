import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getOutletsByUser, getProducts } from "@/lib/masterData";
import { prisma } from "@/lib/prisma";
import { NewPoaStandarisasiForm } from "@/components/poaStandarisasi/NewPoaStandarisasiForm";

export default async function NewPoaStandarisasiPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  // Re-opened to MR 2026-09-10 (user request) — was ADMIN-only since
  // 2026-08-28 pending review. ASM/SM/NSM (Phase 2 approval + read-only,
  // docs/poa-standarisasi/03-ui-and-access.md) still NOT reopened here —
  // separate follow-up, user wants atasan approval done through its own
  // dedicated view rather than this same wizard.
  if (session.role !== "ADMIN" && session.role !== "MR") redirect("/dashboard");

  const [outlets, productOptions] = await Promise.all([
    getOutletsByUser(session.userId),
    getProducts(),
  ]);

  // ADMIN sees every outlet company-wide here (getOutletsByUser → getCustomers()
  // for ADMIN, docs/PERFORMANCE.md §2) — a per-outlet Nexus/count lookup in a
  // loop would be a real N+1 at that scale, so this is ONE grouped count query
  // against the local CustomerOutlet table instead (indexed on kodePI).
  const userCounts = await prisma.customerOutlet.groupBy({
    by: ["kodePI"],
    where: { kodePI: { in: outlets.map((o) => o.kodeRequest) } },
    _count: { customerId: true },
  });
  const userCountByKodePI = new Map(userCounts.map((c: (typeof userCounts)[number]) => [c.kodePI, c._count.customerId]));

  // Chain-first sort, group name shown as sublabel — same convention as the
  // outlet Combobox in POA Estimasi (LineItemEditor's isChainGroup + sublabel).
  const isChainGroup = (groupRS?: string | null) => !!groupRS && groupRS !== "NON CHAIN";
  const outletOptions = [...outlets]
    .sort((a, b) => (isChainGroup(a.groupRS) ? 0 : 1) - (isChainGroup(b.groupRS) ? 0 : 1))
    .map((o) => ({
      value: o.kodeRequest,
      label: o.namaCust,
      sublabel: o.groupRS ?? "NON CHAIN",
      tag: `${userCountByKodePI.get(o.kodeRequest) ?? 0} user`,
      tagColor: "indigo" as const,
    }));

  return (
    <NewPoaStandarisasiForm
      outletOptions={outletOptions}
      productOptions={productOptions}
    />
  );
}
